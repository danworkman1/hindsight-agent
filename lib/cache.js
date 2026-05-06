// lib/cache.js
// Caches review verdicts keyed by a hash of the working-tree state.
// Strategy: grow unbounded under normal use; soft cap at 5MB triggers
// eviction down to the 1000 most recent entries. Eviction only runs on writes.

import { createHash } from "crypto";
import { execSync, execFileSync } from "child_process";
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from "fs";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const CACHE_VERSION = 2;
const SIZE_THRESHOLD_BYTES = 5 * 1024 * 1024; // 5MB
const EVICT_KEEP_COUNT = 1000;

// Doc/text files excluded from the hash so writing a plan.md after a review
// doesn't bust the cache when the underlying code is unchanged.
const DOC_EXTENSIONS = [".md", ".mdx", ".markdown", ".txt", ".rst"];

function isDocPath(path) {
  const lower = path.toLowerCase();
  return DOC_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function getCachePath() {
  return process.env.HINDSIGHT_CACHE_PATH ?? join(__dirname, "..", "review-cache.json");
}

/**
 * Compute a deterministic hash of the current working-tree state.
 * Captures both modified/deleted files (via git diff) and untracked files.
 *
 * Returns:
 *   - { status: "ok", hash: string } when changes exist
 *   - { status: "no_changes" } when in a git repo with a clean working tree
 *   - { status: "not_a_repo" } when not in a git repo at all
 */
export function computeDiffHash() {
  // First check if we're even in a git repo. This is fast and gives us
  // a clean way to distinguish "not a repo" from "repo with no changes".
  try {
    execSync("git rev-parse --is-inside-work-tree", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    return { status: "not_a_repo" };
  }

  let diff = "";
  try {
    const changedFiles = execSync("git diff HEAD --name-only", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    })
      .split("\n")
      .filter(Boolean)
      .filter((path) => !isDocPath(path));

    if (changedFiles.length > 0) {
      diff = execFileSync("git", ["diff", "HEAD", "--", ...changedFiles], {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    }
  } catch {
    // Repo exists but has no commits yet — diff against empty tree
    diff = "";
  }

  let untrackedContent = "";
  try {
    const untrackedList = execSync("git ls-files --others --exclude-standard", {
      encoding: "utf-8",
    })
      .split("\n")
      .filter(Boolean)
      .filter((path) => !isDocPath(path))
      .sort();

    for (const path of untrackedList) {
      try {
        const content = readFileSync(path, "utf-8");
        untrackedContent += `\n--- UNTRACKED: ${path} ---\n${content}`;
      } catch {
        untrackedContent += `\n--- UNTRACKED (binary/unreadable): ${path} ---\n`;
      }
    }
  } catch {
    // ls-files failed; proceed with just the diff
  }

  const combined = diff + untrackedContent;

  if (combined.trim() === "") {
    return { status: "no_changes" };
  }

  return {
    status: "ok",
    hash: createHash("sha256").update(combined).digest("hex"),
  };
}

/**
 * Load the cache from disk. Returns a fresh empty cache if missing,
 * malformed, or on a different version.
 */
function loadCache() {
  if (!existsSync(getCachePath())) {
    return { version: CACHE_VERSION, entries: {} };
  }

  try {
    const raw = readFileSync(getCachePath(), "utf-8");
    const parsed = JSON.parse(raw);

    if (parsed.version !== CACHE_VERSION) {
      // Version mismatch — treat as empty, will be overwritten on next save
      return { version: CACHE_VERSION, entries: {} };
    }

    return parsed;
  } catch {
    // Corrupted file — start fresh rather than crashing
    return { version: CACHE_VERSION, entries: {} };
  }
}

/**
 * Save the cache, evicting if file size has grown past the threshold.
 */
function saveCache(cache) {
  const cachePath = getCachePath();
  const dir = dirname(cachePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  let currentSize = 0;
  if (existsSync(cachePath)) {
    try {
      currentSize = statSync(cachePath).size;
    } catch {
      currentSize = 0;
    }
  }

  if (currentSize > SIZE_THRESHOLD_BYTES) {
    cache.entries = evictOldest(cache.entries, EVICT_KEEP_COUNT);
  }

  writeFileSync(cachePath, JSON.stringify(cache, null, 2), "utf-8");
}

/**
 * Keep only the N most-recently-reviewed entries.
 */
function evictOldest(entries, keepCount) {
  const sorted = Object.entries(entries).sort(
    ([, a], [, b]) => new Date(b.reviewedAt) - new Date(a.reviewedAt)
  );

  const kept = sorted.slice(0, keepCount);
  return Object.fromEntries(kept);
}

/**
 * Look up a previously-cached review for this diff hash.
 * Returns the cached entry or null.
 */
export function getCachedReview(hash) {
  if (!hash) return null;
  const cache = loadCache();
  return cache.entries[hash] || null;
}

/**
 * Store a review result keyed by diff hash.
 */
export function setCachedReview(hash, { changed, summary, verdict, prose, files, suggestions }) {
  if (!hash) return;

  const cache = loadCache();
  cache.entries[hash] = {
    changed,
    summary,
    verdict,
    prose,
    files,
    suggestions,
    reviewedAt: new Date().toISOString(),
    cwd: process.cwd(),
  };
  saveCache(cache);
}
