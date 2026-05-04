#!/usr/bin/env node
// review-agent.js
// Entry point invoked by Claude Code's Stop hook (or run manually for testing).
//
// Flow:
//   1. Compute a hash of the current working-tree state
//   2. If we've reviewed this exact state before, replay the cached result and exit
//   3. Otherwise, run Phase 1 (triage): was code actually changed?
//   4. If yes, run Phase 2 (deep review): is there a cleaner solution?
//   5. Cache the result and print it

import { readFileSync } from "fs";
import { basename } from "path";
import { runAgent, MODELS } from "./lib/agent-loop.js";
import { tools, toolHandlers } from "./lib/tools.js";
import { computeDiffHash, getCachedReview, setCachedReview } from "./lib/cache.js";
import { logReview, logSkip, renderReview } from "./lib/logger.js";
import { extractJsonObject } from "./lib/parse.js";

// ---------------------------------------------------------------------------
// Stdin handling — the Stop hook pipes a JSON object describing the session.
// ---------------------------------------------------------------------------
function readHookInput() {
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

Your ENTIRE response must be a single JSON object and nothing else. No prose before, no prose after, no markdown fences.

Schema:
{"changed": boolean, "summary": "one-line description"}

Examples of valid responses:
{"changed": true, "summary": "Added new auth middleware in src/auth.ts"}
{"changed": false, "summary": "Only README.md was modified"}

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

  const parsed = extractJsonObject(result);

  if (!parsed) {
    console.error("[triage] Could not parse JSON from model response:");
    console.error("---");
    console.error(result);
    console.error("---");
    return { changed: false, summary: "Could not parse triage output" };
  }

  return {
    changed: Boolean(parsed.changed),
    summary: String(parsed.summary || ""),
  };
}

// ---------------------------------------------------------------------------
// Phase 2: Deep review. Only runs when triage says code changed.
// Returns a structured object { verdict, prose, files, suggestions }
// ---------------------------------------------------------------------------
async function deepReview(triageSummary) {
  const system = `You are a senior engineer doing a post-implementation review. The code WORKS — your job is not to find bugs, but to ask: now that we have a working solution and the full picture, is there a cleaner approach?

Look for:
- Abstractions that became unnecessary once the solution crystallised
- Code that could be simpler, shorter, or more idiomatic
- Patterns that were appropriate mid-flight but redundant in hindsight
- Opportunities to delete code

Be concrete. Reference files and lines. If the solution is already clean, say so plainly — do not invent improvements.

Your ENTIRE response must be a single JSON object and nothing else. No prose before, no prose after, no markdown fences.

Schema:
{
  "verdict": "clean" | "minor" | "worth_refactoring",
  "prose": "string — omit or use empty string for clean verdict",
  "files": ["array of affected file paths — empty for clean"],
  "suggestions": [
    {
      "file": "path/to/file.ts",
      "lines": "45-67",
      "issue": "what the problem is",
      "fix": "what to do instead"
    }
  ]
}

Rules:
- verdict "clean": solution is good. prose = "". files = []. suggestions = [].
- verdict "minor": small notes not worth acting on. prose = full explanation. files = affected files. suggestions = [].
- verdict "worth_refactoring": meaningful improvement available. prose = full explanation. files = affected files. suggestions = one entry per distinct change.
- Line numbers in suggestions are best-effort — prose is authoritative if they conflict.`;

  const raw = await runAgent({
    system,
    userPrompt: `A coding session just completed. Triage summary: ${triageSummary}\n\nReview the changes and assess whether there is a cleaner solution now.`,
    tools,
    toolHandlers,
    maxIterations: 15,
    model: MODELS.SONNET,
  });

  const parsed = extractJsonObject(raw);

  if (!parsed || !parsed.verdict) {
    console.error("[deepReview] Could not parse JSON from model response:");
    console.error("---");
    console.error(raw);
    console.error("---");
    // Safe fallback — treat as clean so we don't block or crash
    return { verdict: "clean", prose: "", files: [], suggestions: [] };
  }

  return {
    verdict: parsed.verdict,
    prose: parsed.prose ?? "",
    files: Array.isArray(parsed.files) ? parsed.files : [],
    suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const hookInput = readHookInput(); // stop_hook_active will be used in feedback mode

  // 1. Hash the current state
  const diffResult = computeDiffHash();

  if (diffResult.status === "not_a_repo") {
    console.log("✓ Not a git repo — skipping review.");
    logSkip("skip", "not a git repo");
    return;
  }

  if (diffResult.status === "no_changes") {
    console.log("✓ No changes in working tree — skipping review.");
    logSkip("skip", "no changes in working tree");
    return;
  }

  const hash = diffResult.hash;

  // 2. Cache check
  const cached = getCachedReview(hash);
  if (cached) {
    console.log("✓ Already reviewed this state (cached).");
    console.log(renderReview({
      ts: new Date().toISOString(),
      project: basename(process.cwd()),
      tag: "REVIEW cached",
      summary: cached.summary,
      verdict: cached.verdict,
      prose: cached.prose ?? "",
      files: cached.files ?? [],
      suggestions: cached.suggestions ?? [],
    }));

    if (cached.changed) {
      logReview({
        summary: cached.summary,
        verdict: cached.verdict,
        prose: cached.prose ?? "",
        files: cached.files ?? [],
        suggestions: cached.suggestions ?? [],
        fromCache: true,
      });
    } else {
      logSkip("cached", `no substantive changes — ${cached.summary}`);
    }
    return;
  }

  // 3. Triage
  const { changed, summary } = await triage();

  const triageFailed = summary === "Could not parse triage output";

  if (!changed) {
    console.log(`✓ No substantive code changes — skipping deep review. (${summary})`);
    // Don't cache parse failures — let the next run try again
    if (!triageFailed) {
      setCachedReview(hash, {
        changed: false,
        summary,
        verdict: "clean",
        prose: "",
        files: [],
        suggestions: [],
      });
    }
    logSkip("skip", `triage said no — ${summary}`);
    return;
  }

  // 4. Deep review
  console.log(`→ Code changed: ${summary}`);
  console.log(`→ Running deep review...\n`);

  const result = await deepReview(summary);

  // 5. Cache, log, and print
  setCachedReview(hash, { changed: true, summary, ...result });
  logReview({ summary, ...result });

  console.log(renderReview({
    ts: new Date().toISOString(),
    project: basename(process.cwd()),
    tag: "REVIEW",
    summary,
    ...result,
  }));
}

main().catch((err) => {
  console.error("Reviewer agent failed:", err.message);
  // Exit 0 so a hook failure never blocks Claude Code
  process.exit(0);
});
