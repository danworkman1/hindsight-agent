import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const tmpHome = mkdtempSync(join(tmpdir(), "hindsight-lock-test-"));
process.env.TMPDIR = tmpHome;
process.env.HINDSIGHT_LOG_PATH = join(tmpHome, "test.log");
process.env.HINDSIGHT_CACHE_PATH = join(tmpHome, "test-cache.json");

const { acquireLock, releaseLock, getLockPath } = await import("../lib/lock.js");

beforeEach(() => {
  try { rmSync(getLockPath(), { force: true }); } catch {}
});

test("acquireLock writes a lock file and returns true", () => {
  assert.equal(acquireLock(), true);
  assert.ok(existsSync(getLockPath()));
});

test("acquireLock returns false when fresh lock exists", () => {
  acquireLock();
  assert.equal(acquireLock(), false);
});

test("acquireLock reclaims a stale lock (>5min old) and returns true", () => {
  const stale = String(Date.now() - 6 * 60 * 1000);
  writeFileSync(getLockPath(), stale, "utf-8");
  assert.equal(acquireLock(), true);
});

test("releaseLock removes the lock file", () => {
  acquireLock();
  releaseLock();
  assert.equal(existsSync(getLockPath()), false);
});

test("releaseLock is a no-op when file is gone", () => {
  releaseLock();
  releaseLock();
});
