// lib/logger.js
// Append-only log of every agent run. Each entry is tagged with a project
// name (basename of cwd) so you can grep by project later.

import { appendFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_PATH = join(__dirname, "..", "reviews.log");

/**
 * Get a short, log-friendly project identifier from cwd.
 * Just the directory's basename — collisions are possible but rare,
 * and the timestamp + full review content disambiguate when needed.
 */
function projectTag() {
  return basename(process.cwd()) || "unknown";
}

function ensureLogDir() {
  const dir = dirname(LOG_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/**
 * Log a one-line entry — used for skip events (no review, just record that
 * the agent ran and chose not to do a deep review).
 *
 * @param {string} kind - short tag like "skip" or "cached"
 * @param {string} note - one-line description
 */
export function logSkip(kind, note) {
  ensureLogDir();
  const ts = new Date().toISOString();
  const line = `[${ts}] [${projectTag()}] [${kind}] ${note}\n`;
  appendFileSync(LOG_PATH, line);
}

/**
 * Log a full review entry — used when the deep review actually runs or
 * when we replay a cached review.
 *
 * @param {object} opts
 * @param {string} opts.summary - one-line triage summary
 * @param {string} opts.review - full review text
 * @param {boolean} [opts.fromCache] - true if this is a cache replay
 */
export function logReview({ summary, review, fromCache = false }) {
  ensureLogDir();
  const ts = new Date().toISOString();
  const tag = fromCache ? "REVIEW cached" : "REVIEW";

  const entry = [
    "",
    `[${ts}] [${projectTag()}] [${tag}] ${summary}`,
    review,
    "",
  ].join("\n");

  appendFileSync(LOG_PATH, entry);
}