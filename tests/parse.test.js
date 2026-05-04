import { test } from "node:test";
import assert from "node:assert/strict";
import { extractJsonObject } from "../lib/parse.js";

test("extracts a clean verdict shape", () => {
  const input = `{"verdict":"clean","prose":"","files":[],"suggestions":[]}`;
  const result = extractJsonObject(input);
  assert.equal(result.verdict, "clean");
  assert.deepEqual(result.suggestions, []);
});

test("extracts a worth_refactoring shape with suggestions", () => {
  const input = JSON.stringify({
    verdict: "worth_refactoring",
    prose: "Two issues found.",
    files: ["src/auth.ts"],
    suggestions: [
      { file: "src/auth.ts", lines: "45-67", issue: "Duplicates logic", fix: "Extract utility" },
    ],
  });
  const result = extractJsonObject(input);
  assert.equal(result.verdict, "worth_refactoring");
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].file, "src/auth.ts");
  assert.equal(result.suggestions[0].lines, "45-67");
});

test("extracts JSON wrapped in prose", () => {
  const input = `Here is my review:\n{"verdict":"minor","prose":"Small thing.","files":[],"suggestions":[]}\nThat's it.`;
  const result = extractJsonObject(input);
  assert.equal(result.verdict, "minor");
  assert.equal(result.prose, "Small thing.");
});

test("returns null for non-JSON input", () => {
  const result = extractJsonObject("This is not JSON at all.");
  assert.equal(result, null);
});

test("returns null for empty string", () => {
  const result = extractJsonObject("");
  assert.equal(result, null);
});

test("skips invalid JSON block and finds the valid one that follows", () => {
  const input = '{bad json} {"verdict":"clean","prose":"","files":[],"suggestions":[]}';
  const result = extractJsonObject(input);
  assert.equal(result.verdict, "clean");
});
