import { test } from "node:test";
import assert from "node:assert/strict";
import { renderReview } from "../lib/logger.js";

const BASE = {
  ts: "2026-05-04T09:00:00.000Z",
  project: "my-project",
  tag: "REVIEW",
  summary: "Added auth middleware",
};

test("clean verdict renders as a single line", () => {
  const result = renderReview({ ...BASE, verdict: "clean", prose: "", files: [], suggestions: [] });
  assert.match(result, /\[REVIEW\] Added auth middleware — clean/);
  assert.doesNotMatch(result, /Verdict:/);
  assert.doesNotMatch(result, /Issue:/);
});

test("clean verdict with fromCache tag", () => {
  const result = renderReview({
    ...BASE,
    tag: "REVIEW cached",
    verdict: "clean",
    prose: "",
    files: [],
    suggestions: [],
  });
  assert.match(result, /REVIEW cached/);
  assert.match(result, /— clean/);
});

test("minor verdict renders verdict header and prose, no suggestion cards", () => {
  const result = renderReview({
    ...BASE,
    verdict: "minor",
    prose: "One small thing on line 23.",
    files: ["src/auth.ts"],
    suggestions: [],
  });
  assert.match(result, /Verdict: minor suggestions/);
  assert.match(result, /One small thing on line 23\./);
  assert.doesNotMatch(result, /Issue:/);
  assert.doesNotMatch(result, /Fix:/);
});

test("worth_refactoring renders verdict, suggestion cards, and prose", () => {
  const result = renderReview({
    ...BASE,
    verdict: "worth_refactoring",
    prose: "Two areas to clean up.",
    files: ["src/auth.ts"],
    suggestions: [
      { file: "src/auth.ts", lines: "45-67", issue: "Duplicates logic", fix: "Extract utility" },
    ],
  });
  assert.match(result, /Verdict: worth refactoring/);
  assert.match(result, /src\/auth\.ts \(lines 45-67\)/);
  assert.match(result, /Issue: Duplicates logic/);
  assert.match(result, /Fix:   Extract utility/);
  assert.match(result, /Two areas to clean up\./);
});

test("worth_refactoring with multiple suggestions renders all cards", () => {
  const result = renderReview({
    ...BASE,
    verdict: "worth_refactoring",
    prose: "Two issues.",
    files: ["src/a.ts", "src/b.ts"],
    suggestions: [
      { file: "src/a.ts", lines: "10-20", issue: "Issue A", fix: "Fix A" },
      { file: "src/b.ts", lines: "5-8", issue: "Issue B", fix: "Fix B" },
    ],
  });
  assert.match(result, /src\/a\.ts \(lines 10-20\)/);
  assert.match(result, /Issue: Issue A/);
  assert.match(result, /src\/b\.ts \(lines 5-8\)/);
  assert.match(result, /Issue: Issue B/);
});

test("suggestion without lines omits the lines annotation", () => {
  const result = renderReview({
    ...BASE,
    verdict: "worth_refactoring",
    prose: "An issue.",
    files: ["src/auth.ts"],
    suggestions: [{ file: "src/auth.ts", issue: "No line info", fix: "Fix it" }],
  });
  assert.match(result, /src\/auth\.ts\n/);
  assert.doesNotMatch(result, /\(lines/);
});
