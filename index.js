#!/usr/bin/env node
// review-agent.js
// Entry point invoked by Claude Code's Stop hook (or run manually for testing).
//
// Flow:
//   1. Compute a hash of the current working-tree state
//   2. If we've reviewed this exact state before, print the cached result and exit
//   3. Otherwise, run Phase 1 (triage): was code actually changed?
//   4. If yes, run Phase 2 (deep review): is there a cleaner solution?
//   5. Cache the result and print it

import { readFileSync } from "fs";
import { runAgent, MODELS } from "./lib/agent-loop.js";
import { tools, toolHandlers } from "./lib/tools.js";
import { computeDiffHash, getCachedReview, setCachedReview } from "./lib/cache.js";

// ---------------------------------------------------------------------------
// Stdin handling — the Stop hook pipes a JSON object describing the session.
// We don't strictly need it yet, but read it gracefully so we don't break
// when run manually (no stdin) or when the schema gains fields later.
// ---------------------------------------------------------------------------
function readHookInput() {
  // If stdin is a TTY (interactive terminal), there's no piped input —
  // skip the read so manual runs don't hang waiting for keyboard input.
  if (process.stdin.isTTY) return {};

  try {
    const raw = readFileSync(0, "utf-8");
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Phase 1: Triage. Cheap call. Was code added or refactored?
// Returns { changed: boolean, summary: string }
// ---------------------------------------------------------------------------
async function triage() {
  const system = `You are a code change detector. Use the available tools to inspect the working tree and determine whether source code was added or refactored.

Respond with ONLY a JSON object on a single line, no markdown, no prose:
{"changed": boolean, "summary": "one-line description"}

Rules:
- "changed" is true ONLY if source code (functions, components, logic) was added or modified
- Pure documentation, comments, config tweaks, or formatting-only changes are NOT a "change" for our purposes
- If unsure, lean toward false — Phase 2 is expensive`;

  const result = await runAgent({
    system,
    userPrompt:
      "Inspect the working tree. Was source code added or refactored in this session?",
    tools,
    toolHandlers,
    maxIterations: 5,
    model: MODELS.HAIKU,
  });

  // Strip any accidental markdown fences and parse
  const cleaned = result
    .trim()
    .replace(/^```(?:json)?\s*/, "")
    .replace(/\s*```$/, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    return {
      changed: Boolean(parsed.changed),
      summary: String(parsed.summary || ""),
    };
  } catch {
    // If the model didn't give us valid JSON, fail safe: skip the deep review.
    return { changed: false, summary: "Could not parse triage output" };
  }
}

// ---------------------------------------------------------------------------
// Phase 2: Deep review. Only runs when triage says code changed.
// Returns the review text.
// ---------------------------------------------------------------------------
async function deepReview(triageSummary) {
  const system = `You are a senior engineer doing a post-implementation review. The code WORKS — your job is not to find bugs, but to ask: now that we have a working solution and the full picture, is there a cleaner approach?

Look for:
- Abstractions that became unnecessary once the solution crystallized
- Code that could be simpler, shorter, or more idiomatic
- Patterns that were appropriate mid-flight but redundant in hindsight
- Opportunities to delete code

Be concrete. Reference files and lines. If the solution is already clean, say so plainly — don't invent improvements.

Output format:
- Verdict: clean | minor suggestions | worth refactoring
- If not "clean", list specific suggestions with file references`;

  return runAgent({
    system,
    userPrompt: `A coding session just completed. Triage summary: ${triageSummary}\n\nReview the changes and assess whether there's a cleaner solution now.`,
    tools,
    toolHandlers,
    maxIterations: 15,
    model: MODELS.SONNET,
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  readHookInput(); // currently unused, but consume stdin so the hook process doesn't hang

  // 1. Hash the current state
  const hash = computeDiffHash();

  if (!hash) {
    // Not a git repo, or no changes at all — nothing to review
    console.log("✓ No changes detected — skipping review.");
    return;
  }

  // 2. Cache check
  const cached = getCachedReview(hash);
  if (cached) {
    console.log("✓ Already reviewed this state (cached).");
    console.log("─".repeat(60));
    console.log(cached.review);
    console.log("─".repeat(60));
    return;
  }

  // 3. Triage
  const { changed, summary } = await triage();

  if (!changed) {
    console.log(`✓ No substantive code changes — skipping deep review. (${summary})`);
    setCachedReview(hash, {
      changed: false,
      summary,
      review: `No substantive code changes: ${summary}`,
    });
    return;
  }

  // 4. Deep review
  console.log(`→ Code changed: ${summary}`);
  console.log(`→ Running deep review...\n`);

  const review = await deepReview(summary);

  // 5. Cache and print
  setCachedReview(hash, { changed: true, summary, review });

  console.log("─".repeat(60));
  console.log(review);
  console.log("─".repeat(60));
}

main().catch((err) => {
  console.error("Reviewer agent failed:", err.message);
  // Exit 0 so a hook failure never blocks Claude Code
  process.exit(0);
});