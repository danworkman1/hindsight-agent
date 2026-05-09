import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createHash } from "crypto";
import { logSkip } from "./logger.js";

const STALE_AFTER_MS = 5 * 60 * 1000;

export function getLockPath() {
  const repoKey = createHash("sha256").update(process.cwd()).digest("hex").slice(0, 16);
  return join(tmpdir(), `hindsight-${repoKey}.lock`);
}

export function acquireLock() {
  const path = getLockPath();
  if (existsSync(path)) {
    const age = Date.now() - parseInt(readFileSync(path, "utf-8") || "0", 10);
    if (age < STALE_AFTER_MS) return false;
    logSkip("lock", `reclaiming stale lock (${Math.round(age / 1000)}s old)`);
  }
  writeFileSync(path, String(Date.now()), "utf-8");
  return true;
}

export function releaseLock() {
  try {
    unlinkSync(getLockPath());
  } catch {
    /* already gone */
  }
}
