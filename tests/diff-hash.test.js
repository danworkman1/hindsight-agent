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

const { computeDiffHash } = await import("../lib/cache.js");

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

