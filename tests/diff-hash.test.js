import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { join } from "path";
import { tmpdir } from "os";

const repoDir = mkdtempSync(join(tmpdir(), "hindsight-diff-test-"));
const origCwd = process.cwd();

execSync("git init -q", { cwd: repoDir });
execSync("git config user.email test@test.com", { cwd: repoDir });
execSync("git config user.name test", { cwd: repoDir });
writeFileSync(join(repoDir, "app.js"), "export const x = 1;\n");
execSync("git add . && git commit -q -m initial", { cwd: repoDir, shell: "/bin/sh" });

process.chdir(repoDir);

const { computeDiffHash, computeCommitRangeHash } = await import("../lib/cache.js");

after(() => {
  process.chdir(origCwd);
  rmSync(repoDir, { recursive: true, force: true });
});

test("doc file changes don't affect the hash", () => {
  writeFileSync(join(repoDir, "app.js"), "export const x = 2;\n");
  const before = computeDiffHash();
  assert.equal(before.status, "ok");

  // Add a markdown plan file — should NOT change the hash
  writeFileSync(join(repoDir, "plan.md"), "# Plan\nFix things.\n");
  const after = computeDiffHash();
  assert.equal(after.status, "ok");
  assert.equal(after.hash, before.hash);

  // Modify a tracked code file — SHOULD change the hash
  writeFileSync(join(repoDir, "app.js"), "export const x = 3;\n");
  const changed = computeDiffHash();
  assert.notEqual(changed.hash, before.hash);
});

test("computeCommitRangeHash hashes HEAD~1..HEAD diff", () => {
  writeFileSync(join(repoDir, "feature.js"), "export const y = 1;\n");
  execSync("git add . && git commit -q -m 'add feature'", { cwd: repoDir, shell: "/bin/sh" });

  const result = computeCommitRangeHash();
  assert.equal(result.status, "ok");
  assert.ok(result.hash);
  assert.ok(result.commitSha);
});

test("computeCommitRangeHash returns no_parent for first commit", () => {
  const soloDir = mkdtempSync(join(tmpdir(), "hindsight-solo-"));
  execSync("git init -q", { cwd: soloDir });
  execSync("git config user.email t@t.com && git config user.name t", { cwd: soloDir, shell: "/bin/sh" });
  writeFileSync(join(soloDir, "a.js"), "x\n");
  execSync("git add . && git commit -q -m initial", { cwd: soloDir, shell: "/bin/sh" });

  const origCwd = process.cwd();
  process.chdir(soloDir);
  try {
    const result = computeCommitRangeHash();
    assert.equal(result.status, "no_parent");
  } finally {
    process.chdir(origCwd);
    rmSync(soloDir, { recursive: true, force: true });
  }
});

test("computeCommitRangeHash excludes doc files", () => {
  writeFileSync(join(repoDir, "code2.js"), "export const z = 2;\n");
  writeFileSync(join(repoDir, "notes.md"), "# notes\n");
  execSync("git add . && git commit -q -m 'code+docs'", { cwd: repoDir, shell: "/bin/sh" });
  const withDocs = computeCommitRangeHash().hash;

  execSync("git reset --hard HEAD~1", { cwd: repoDir, shell: "/bin/sh" });
  writeFileSync(join(repoDir, "code2.js"), "export const z = 2;\n");
  execSync("git add . && git commit -q -m 'code only'", { cwd: repoDir, shell: "/bin/sh" });
  const withoutDocs = computeCommitRangeHash().hash;

  assert.equal(withDocs, withoutDocs);
});

