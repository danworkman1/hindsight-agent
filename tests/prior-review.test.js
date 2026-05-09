import { test } from "node:test";
import assert from "node:assert/strict";
import { formatPriorReviewForPrompt } from "../lib/prior-review.js";

test("returns empty string for null input", () => {
  assert.equal(formatPriorReviewForPrompt(null), "");
});

test("formats clean prior review", () => {
  const out = formatPriorReviewForPrompt({
    verdict: "clean",
    prose: "",
    files: [],
    suggestions: [],
  });
  assert.match(out, /PRIOR REVIEW/);
  assert.match(out, /clean/);
  assert.match(out, /reassess independently/i);
});

test("formats worth_refactoring prior review with suggestions", () => {
  const out = formatPriorReviewForPrompt({
    verdict: "worth_refactoring",
    prose: "Two issues found.",
    files: ["src/a.js"],
    suggestions: [
      { file: "src/a.js", lines: "10-20", issue: "Dupe logic", fix: "Extract helper" },
    ],
  });
  assert.match(out, /worth_refactoring/);
  assert.match(out, /Dupe logic/);
  assert.match(out, /Extract helper/);
  assert.match(out, /src\/a\.js/);
});

test("includes anti-anchoring instruction", () => {
  const out = formatPriorReviewForPrompt({
    verdict: "minor",
    prose: "small note",
    files: [],
    suggestions: [],
  });
  assert.match(out, /may have been wrong/i);
});
