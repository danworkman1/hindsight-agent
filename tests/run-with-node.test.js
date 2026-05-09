// Tests for bin/run-with-node.sh — the wrapper that resolves a node binary
// and execs the given JS script. Hooks (post-commit, Stop) call it so users
// don't have to bake in a path that breaks when they switch version managers.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WRAPPER = join(__dirname, "..", "bin", "run-with-node.sh");
const REPO_ROOT = join(__dirname, "..");

function makeTempJs(contents) {
  const dir = mkdtempSync(join(tmpdir(), "hindsight-wrapper-test-"));
  const file = join(dir, "script.js");
  writeFileSync(file, contents);
  return { dir, file };
}

test("wrapper executes the given script via a real node and forwards stdout", () => {
  const { dir, file } = makeTempJs(`console.log("hello from", process.version);`);
  try {
    const result = spawnSync(WRAPPER, [file], { encoding: "utf-8" });
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.match(result.stdout, /^hello from v\d+\./);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("wrapper forwards extra args to the script", () => {
  const { dir, file } = makeTempJs(`console.log(process.argv.slice(2).join("|"));`);
  try {
    const result = spawnSync(WRAPPER, [file, "one", "two", "three"], { encoding: "utf-8" });
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.equal(result.stdout.trim(), "one|two|three");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("HINDSIGHT_NODE override is honored when set", () => {
  // Build a fake "node" that just prints a sentinel — proves the wrapper used
  // it instead of going through the real resolver.
  const dir = mkdtempSync(join(tmpdir(), "hindsight-fake-node-"));
  const fakeNode = join(dir, "fake-node");
  writeFileSync(fakeNode, `#!/bin/sh\necho "FAKE_NODE_RAN script=$1"\n`);
  chmodSync(fakeNode, 0o755);
  const scriptArg = "/some/script.js";
  try {
    const result = spawnSync(WRAPPER, [scriptArg], {
      encoding: "utf-8",
      env: { ...process.env, HINDSIGHT_NODE: fakeNode },
    });
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.equal(result.stdout.trim(), `FAKE_NODE_RAN script=${scriptArg}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("wrapper exits non-zero with helpful error when no node anywhere", () => {
  // PATH=/nonexistent and HOME=/nonexistent → none of the fallbacks resolve.
  const result = spawnSync(WRAPPER, ["/some/script.js"], {
    encoding: "utf-8",
    env: { PATH: "/nonexistent", HOME: "/nonexistent" },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /could not find a node binary/);
  assert.match(result.stderr, /HINDSIGHT_NODE/);
});

test("wrapper exits 2 with usage message when called with no args", () => {
  const result = spawnSync(WRAPPER, [], { encoding: "utf-8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /usage:/);
});

test("probe script reports a real node path", () => {
  const probe = join(REPO_ROOT, "scripts", "probe-node.js");
  const result = spawnSync(WRAPPER, [probe], { encoding: "utf-8" });
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.match(result.stdout.trim(), /node$/);
});
