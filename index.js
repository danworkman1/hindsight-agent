#!/usr/bin/env node
// review-agent.js
// Entry point invoked after each commit.
//
// Flow:
//   1. Compute a hash of the HEAD~1..HEAD commit diff
//   2. If we've reviewed this exact commit range before, replay the cached result and exit
//   3. Otherwise, run Phase 1 (triage): was code actually changed?
//   4. If yes, run Phase 2 (deep review): is there a cleaner solution?
//   5. Cache the result and append it to reviews.log

import { execSync } from "child_process";
import { runAgent, MODELS } from "./lib/agent-loop.js";
import { tools, toolHandlers } from "./lib/tools.js";
import { computeCommitRangeHash, getCachedReview, setCachedReview, getBranchReviewCount, getLastBranchReview } from "./lib/cache.js";
import { shouldSkip, REVIEW_CAP } from "./lib/skip-rules.js";
import { formatPriorReviewForPrompt } from "./lib/prior-review.js";
import { logReview, logSkip, logError, logCapHit } from "./lib/logger.js";
import { extractJsonObject } from "./lib/parse.js";

// ---------------------------------------------------------------------------
// Commit metadata — branch, message, and SHA of the latest commit.
// ---------------------------------------------------------------------------
function readCommitMetadata() {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf-8" }).trim();
    const message = execSync("git log -1 --pretty=%B", { encoding: "utf-8" }).trim();
    const sha = execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
    return { branch, message, sha };
  } catch {
    return { branch: "", message: "", sha: "" };
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
    logError("triage", "Could not parse JSON from model response", result);
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
async function deepReview(triageSummary, priorReview) {
  const priorContext = formatPriorReviewForPrompt(priorReview);

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
- Line numbers in suggestions are best-effort — prose is authoritative if they conflict.${priorContext}`;

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
    logError("deepReview", "Could not parse JSON from model response", raw);
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
  const force = process.argv.includes("--force");

  const meta = readCommitMetadata();
  if (!meta.branch) {
    logSkip("skip", "not a git repo");
    return;
  }

  const diffResult = computeCommitRangeHash();
  if (diffResult.status === "not_a_repo") {
    logSkip("skip", "not a git repo");
    return;
  }
  if (diffResult.status === "no_parent") {
    logSkip("skip", "initial commit has no parent to diff against");
    return;
  }
  if (diffResult.status === "no_changes") {
    logSkip("skip", "commit had no non-doc changes");
    return;
  }

  const reviewCount = getBranchReviewCount(meta.branch);

  if (!force) {
    const skipDecision = shouldSkip({
      branch: meta.branch,
      commitMessage: meta.message,
      reviewCount,
    });
    if (skipDecision.skip) {
      if (skipDecision.reason.startsWith("branch review cap")) {
        logCapHit(meta.branch, reviewCount, REVIEW_CAP);
      } else {
        logSkip("skip", skipDecision.reason);
      }
      return;
    }
  }

  const hash = diffResult.hash;
  const cached = getCachedReview(hash);
  if (cached) {
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

  const { changed, summary } = await triage();
  const triageFailed = summary === "Could not parse triage output";

  if (!changed) {
    if (!triageFailed) {
      setCachedReview(hash, {
        changed: false,
        summary,
        verdict: "clean",
        prose: "",
        files: [],
        suggestions: [],
        branch: meta.branch,
        commitSha: meta.sha,
      });
    }
    logSkip("skip", `triage said no — ${summary}`);
    return;
  }

  const priorReview = getLastBranchReview(meta.branch);
  const result = await deepReview(summary, priorReview);

  setCachedReview(hash, {
    changed: true,
    summary,
    ...result,
    branch: meta.branch,
    commitSha: meta.sha,
  });
  logReview({ summary, ...result });
}

main().catch((err) => {
  logError("fatal", `Reviewer agent failed: ${err.message}`, err.stack);
  // Exit 0 so a hook failure never blocks Claude Code
  process.exit(0);
});
