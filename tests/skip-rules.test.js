import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldSkip, REVIEW_CAP } from "../lib/skip-rules.js";

test("skips main branch", () => {
  const r = shouldSkip({ branch: "main", commitMessage: "feat: x", reviewCount: 0 });
  assert.equal(r.skip, true);
  assert.match(r.reason, /main/);
});

test("skips master branch", () => {
  const r = shouldSkip({ branch: "master", commitMessage: "feat: x", reviewCount: 0 });
  assert.equal(r.skip, true);
});

test("skips WIP commit messages", () => {
  for (const msg of ["wip", "WIP: foo", "wip: bar", "chore: wip something"]) {
    const r = shouldSkip({ branch: "feat/x", commitMessage: msg, reviewCount: 0 });
    assert.equal(r.skip, true, `expected skip for: ${msg}`);
    assert.match(r.reason, /wip/i);
  }
});

test("skips [no-review] tag", () => {
  const r = shouldSkip({ branch: "feat/x", commitMessage: "fix: tweak [no-review]", reviewCount: 0 });
  assert.equal(r.skip, true);
  assert.match(r.reason, /no-review/);
});

test("skips when branch cap reached", () => {
  const r = shouldSkip({ branch: "feat/x", commitMessage: "feat: y", reviewCount: REVIEW_CAP });
  assert.equal(r.skip, true);
  assert.match(r.reason, /cap/);
});

test("does not skip on normal commit under cap", () => {
  const r = shouldSkip({ branch: "feat/x", commitMessage: "feat: y", reviewCount: 0 });
  assert.equal(r.skip, false);
});

test("REVIEW_CAP is 3", () => {
  assert.equal(REVIEW_CAP, 3);
});
