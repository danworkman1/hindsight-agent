#!/usr/bin/env node
// surface.js
// Stop-hook entry point. Surfaces an unread `worth_refactoring` review
// for the current HEAD back to Claude Code via exit 2 + stderr.
//
// Disabled unless HINDSIGHT_FEEDBACK_MODE=on. When disabled, exits 0 silently
// so installation can happen now and activation later.

import { execSync } from "child_process";
import { getReviewByCommitSha, markSurfaced } from "./lib/cache.js";
import { logSkip } from "./lib/logger.js";

function getHeadSha() {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
}

function main() {
  if (process.env.HINDSIGHT_FEEDBACK_MODE !== "on") {
    process.exit(0);
  }

  const sha = getHeadSha();
  if (!sha) {
    process.exit(0);
  }

  const review = getReviewByCommitSha(sha);
  if (!review) {
    process.exit(0);
  }

  if (review.verdict !== "worth_refactoring") {
    process.exit(0);
  }

  if (review.surfaced) {
    process.exit(0);
  }

  markSurfaced(review.hash);

  const suggestionLines = (review.suggestions || [])
    .map((s) => `  - ${s.file}${s.lines ? `:${s.lines}` : ""} — ${s.issue} (fix: ${s.fix})`)
    .join("\n");

  const message =
    `Hindsight flagged a potential refactor on the latest commit (${sha.slice(0, 7)}):\n\n` +
    `${review.prose}\n\n` +
    (suggestionLines ? `Suggestions:\n${suggestionLines}\n\n` : "") +
    `Reply with: \`show\` to see the proposed diff, \`apply\` to implement it, ` +
    `or describe what you'd like to do instead.`;

  process.stderr.write(message + "\n");
  process.exit(2);
}

try {
  main();
} catch (err) {
  logSkip("surface-error", err.message);
  process.exit(0);
}
