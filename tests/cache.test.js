import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const tmpDir = mkdtempSync(join(tmpdir(), "hindsight-cache-test-"));
process.env.HINDSIGHT_CACHE_PATH = join(tmpDir, "test-cache.json");

const { getCachedReview, setCachedReview, getBranchReviewCount, getLastBranchReview } = await import("../lib/cache.js");

after(() => rmSync(tmpDir, { recursive: true, force: true }));

test("setCachedReview stores v2 schema fields", () => {
  setCachedReview("abc123", {
    changed: true,
    summary: "Added auth middleware",
    verdict: "worth_refactoring",
    prose: "Two issues found.",
    files: ["src/auth.ts"],
    suggestions: [{ file: "src/auth.ts", lines: "45-67", issue: "Dupe", fix: "Extract" }],
  });

  const entry = getCachedReview("abc123");
  assert.equal(entry.verdict, "worth_refactoring");
  assert.equal(entry.prose, "Two issues found.");
  assert.deepEqual(entry.files, ["src/auth.ts"]);
  assert.equal(entry.suggestions.length, 1);
  assert.equal(entry.suggestions[0].file, "src/auth.ts");
  assert.ok(entry.reviewedAt);
});

test("setCachedReview stores clean entry with empty arrays", () => {
  setCachedReview("def456", {
    changed: false,
    summary: "Only README changed",
    verdict: "clean",
    prose: "",
    files: [],
    suggestions: [],
  });

  const entry = getCachedReview("def456");
  assert.equal(entry.verdict, "clean");
  assert.deepEqual(entry.files, []);
  assert.deepEqual(entry.suggestions, []);
});

test("getCachedReview returns null for unknown hash", () => {
  const result = getCachedReview("nonexistent-hash");
  assert.equal(result, null);
});

test("getCachedReview returns null for null hash", () => {
  const result = getCachedReview(null);
  assert.equal(result, null);
});

test("setCachedReview updates branchIndex when branch is provided", () => {
  setCachedReview("hash-A", {
    changed: true,
    summary: "feature 1",
    verdict: "clean",
    prose: "",
    files: [],
    suggestions: [],
    branch: "feat/x",
    commitSha: "abc123",
  });
  setCachedReview("hash-B", {
    changed: true,
    summary: "feature 2",
    verdict: "minor",
    prose: "ok",
    files: [],
    suggestions: [],
    branch: "feat/x",
    commitSha: "def456",
  });

  assert.equal(getBranchReviewCount("feat/x"), 2);
  const last = getLastBranchReview("feat/x");
  assert.equal(last.commitSha, "def456");
  assert.equal(last.verdict, "minor");
});

test("getBranchReviewCount returns 0 for unknown branch", () => {
  assert.equal(getBranchReviewCount("nope"), 0);
});

test("getLastBranchReview returns null for unknown branch", () => {
  assert.equal(getLastBranchReview("nope"), null);
});

test("getLastBranchReview returns object with hash field", () => {
  setCachedReview("hash-C", {
    changed: true,
    summary: "x",
    verdict: "clean",
    prose: "",
    files: [],
    suggestions: [],
    branch: "feat/z",
    commitSha: "sha-z",
  });
  const last = getLastBranchReview("feat/z");
  assert.equal(last.hash, "hash-C");
  assert.equal(last.commitSha, "sha-z");
});

test("setCachedReview with duplicate hash does not double-push to branchIndex", () => {
  setCachedReview("hash-D", {
    changed: true,
    summary: "x",
    verdict: "clean",
    prose: "",
    files: [],
    suggestions: [],
    branch: "feat/dedupe",
    commitSha: "sha1",
  });
  setCachedReview("hash-D", {
    changed: true,
    summary: "x",
    verdict: "clean",
    prose: "",
    files: [],
    suggestions: [],
    branch: "feat/dedupe",
    commitSha: "sha1",
  });
  assert.equal(getBranchReviewCount("feat/dedupe"), 1);
});
