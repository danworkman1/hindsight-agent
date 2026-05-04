# Structured Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade hindsight's deep review to return structured JSON (`verdict`, `prose`, `files`, `suggestions`), render it as tiered log entries, and bump the cache schema to v2.

**Architecture:** `deepReview()` is updated to require JSON output from the model. A new `lib/parse.js` holds the shared `extractJsonObject` utility (already used by triage). `logReview()` gains a pure `renderReview()` function tested in isolation. The cache version bumps to 2; old entries are silently dropped on first run.

**Tech Stack:** Node.js 20+ (ESM), `node:test` (built-in test runner), `@anthropic-ai/sdk`

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `lib/parse.js` | Exports `extractJsonObject` — shared by triage and deepReview |
| Create | `tests/parse.test.js` | Tests for extractJsonObject with the new 4-field shape |
| Create | `tests/logger.test.js` | Tests for renderReview across all three verdict tiers |
| Create | `tests/cache.test.js` | Tests for cache v2 schema read/write |
| Modify | `package.json` | Add `"test"` script |
| Modify | `lib/cache.js` | Bump CACHE_VERSION to 2, add `getCachePath()`, update `setCachedReview` |
| Modify | `lib/logger.js` | Extract `renderReview`, update `logReview` signature |
| Modify | `index.js` | Import from `lib/parse.js`, update `deepReview` prompt + return type, wire `main()` |

---

## Task 1: Add test infrastructure

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add test script**

Open `package.json` and replace the `scripts` block:

```json
"scripts": {
  "start": "node index.js",
  "test": "node --test"
}
```

`node --test` (no arguments) auto-discovers any file matching `**/*.test.js` under the project root, which is where our test files will live.

- [ ] **Step 2: Verify the runner works**

Run: `eval "$(/opt/homebrew/bin/fnm env)" && node --test`

Expected: `# tests 0` (or similar — no test files exist yet, runner exits 0)

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: add node:test runner script"
```

---

## Task 2: Extract extractJsonObject into lib/parse.js

Currently `extractJsonObject` is a private function inside `index.js`. It needs to be shared with tests and will also be reused by the updated `deepReview`. Move it to `lib/parse.js`.

**Files:**
- Create: `lib/parse.js`
- Create: `tests/parse.test.js`
- Modify: `index.js` (remove local definition, add import)

- [ ] **Step 1: Write the failing tests**

Create `tests/parse.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `eval "$(/opt/homebrew/bin/fnm env)" && node --test tests/parse.test.js`

Expected: `Error: Cannot find module '../lib/parse.js'`

- [ ] **Step 3: Create lib/parse.js**

```js
// lib/parse.js
// Shared JSON extraction utility. Models sometimes wrap JSON in prose or
// markdown fences despite instructions — this finds the first valid {...} block.

/**
 * Find the first valid JSON object in a string.
 * Returns the parsed object, or null if none found.
 */
export function extractJsonObject(text) {
  for (let start = text.indexOf("{"); start !== -1; start = text.indexOf("{", start + 1)) {
    for (let end = text.lastIndexOf("}"); end > start; end = text.lastIndexOf("}", end - 1)) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        // try a smaller slice
      }
    }
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `eval "$(/opt/homebrew/bin/fnm env)" && node --test tests/parse.test.js`

Expected: `# pass 5` — all tests green

- [ ] **Step 5: Update index.js to import from lib/parse.js**

In `index.js`, add the import at the top with the other imports:

```js
import { extractJsonObject } from "./lib/parse.js";
```

Then delete the local `extractJsonObject` function definition (lines 92–105 in the current file):

```js
// DELETE this entire function — it now lives in lib/parse.js
function extractJsonObject(text) {
  for (let start = text.indexOf("{"); start !== -1; start = text.indexOf("{", start + 1)) {
    for (let end = text.lastIndexOf("}"); end > start; end = text.lastIndexOf("}", end - 1)) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        // try a smaller slice
      }
    }
  }
  return null;
}
```

- [ ] **Step 6: Verify the agent still starts without errors**

Run: `eval "$(/opt/homebrew/bin/fnm env)" && node index.js 2>&1 | head -5`

Expected: either `✓ Not a git repo` / `✓ No changes in working tree` / triage output — no import errors.

- [ ] **Step 7: Commit**

```bash
git add lib/parse.js tests/parse.test.js index.js
git commit -m "refactor: extract extractJsonObject into lib/parse.js"
```

---

## Task 3: Update deepReview() prompt and return type

`deepReview()` currently returns a raw string. After this task it returns a parsed object `{ verdict, prose, files, suggestions }` or falls back to a safe default on parse failure.

**Files:**
- Modify: `index.js` (deepReview function only — do not touch main() yet)

- [ ] **Step 1: Replace the deepReview system prompt and return value**

In `index.js`, replace the entire `deepReview` function (currently lines 111–134) with:

```js
async function deepReview(triageSummary) {
  const system = `You are a senior engineer doing a post-implementation review. The code WORKS — your job is not to find bugs, but to ask: now that we have a working solution and the full picture, is there a cleaner approach?

Look for:
- Abstractions that became unnecessary once the solution crystallised
- Code that could be simpler, shorter, or more idiomatic
- Patterns that were appropriate mid-flight but redundant in hindsight
- Opportunities to delete code

Be concrete. Reference files and lines. If the solution is already clean, say so plainly — do not invent improvements.

Your ENTIRE response must be a single JSON object and nothing else. No prose before, no prose after, no markdown fences.

Schema:
{
  "verdict": "clean" | "minor" | "worth_refactoring",
  "prose": "string — omit or use empty string for clean verdict",
  "files": ["array of affected file paths — empty for clean"],
  "suggestions": [
    {
      "file": "path/to/file.ts",
      "lines": "45-67",
      "issue": "what the problem is",
      "fix": "what to do instead"
    }
  ]
}

Rules:
- verdict "clean": solution is good. prose = "". files = []. suggestions = [].
- verdict "minor": small notes not worth acting on. prose = full explanation. files = affected files. suggestions = [].
- verdict "worth_refactoring": meaningful improvement available. prose = full explanation. files = affected files. suggestions = one entry per distinct change.
- Line numbers in suggestions are best-effort — prose is authoritative if they conflict.`;

  const raw = await runAgent({
    system,
    userPrompt: `A coding session just completed. Triage summary: ${triageSummary}\n\nReview the changes and assess whether there is a cleaner solution now.`,
    tools,
    toolHandlers,
    maxIterations: 15,
    model: MODELS.SONNET,
  });

  const parsed = extractJsonObject(raw);

  if (!parsed || !parsed.verdict) {
    console.error("[deepReview] Could not parse JSON from model response:");
    console.error("---");
    console.error(raw);
    console.error("---");
    // Safe fallback — treat as clean so we don't block or crash
    return { verdict: "clean", prose: "", files: [], suggestions: [] };
  }

  return {
    verdict: parsed.verdict,
    prose: parsed.prose ?? "",
    files: Array.isArray(parsed.files) ? parsed.files : [],
    suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
  };
}
```

- [ ] **Step 2: Verify no syntax errors**

Run: `eval "$(/opt/homebrew/bin/fnm env)" && node --check index.js`

Expected: exits 0 with no output

- [ ] **Step 3: Commit**

```bash
git add index.js
git commit -m "feat: update deepReview prompt to return structured JSON"
```

---

## Task 4: Update cache schema to v2

**Files:**
- Modify: `lib/cache.js`
- Create: `tests/cache.test.js`

- [ ] **Step 1: Write failing cache tests**

Create `tests/cache.test.js`:

```js
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Set before importing cache so getCachePath() reads the test path
const tmpDir = mkdtempSync(join(tmpdir(), "hindsight-cache-test-"));
process.env.HINDSIGHT_CACHE_PATH = join(tmpDir, "test-cache.json");

const { getCachedReview, setCachedReview } = await import("../lib/cache.js");

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `eval "$(/opt/homebrew/bin/fnm env)" && node --test tests/cache.test.js`

Expected: tests fail because `setCachedReview` doesn't accept the new fields yet

- [ ] **Step 3: Update lib/cache.js**

Make three changes:

**Change 1** — Replace the module-level `CACHE_PATH` constant with a function (enables test path override):

```js
// Replace this line:
const CACHE_PATH = join(__dirname, "..", "review-cache.json");

// With this function:
function getCachePath() {
  return process.env.HINDSIGHT_CACHE_PATH ?? join(__dirname, "..", "review-cache.json");
}
```

**Change 2** — Bump the version constant:

```js
// Change:
const CACHE_VERSION = 1;
// To:
const CACHE_VERSION = 2;
```

**Change 3** — Update `loadCache`, `saveCache`, and `setCachedReview` to call `getCachePath()` instead of `CACHE_PATH`. There are four occurrences total. Find each `CACHE_PATH` reference in the function bodies and replace with `getCachePath()`:

In `loadCache()`:
```js
if (!existsSync(getCachePath())) {
  return { version: CACHE_VERSION, entries: {} };
}
const raw = readFileSync(getCachePath(), "utf-8");
```

In `saveCache()`:
```js
if (existsSync(getCachePath())) {
  try {
    currentSize = statSync(getCachePath()).size;
```

```js
writeFileSync(getCachePath(), JSON.stringify(cache, null, 2), "utf-8");
```

Also in `saveCache`, update the `mkdirSync` line:
```js
const dir = dirname(getCachePath());
```

**Change 4** — Update `setCachedReview` to accept and store the new fields:

```js
export function setCachedReview(hash, { changed, summary, verdict, prose, files, suggestions }) {
  if (!hash) return;

  const cache = loadCache();
  cache.entries[hash] = {
    changed,
    summary,
    verdict,
    prose,
    files,
    suggestions,
    reviewedAt: new Date().toISOString(),
    cwd: process.cwd(),
  };
  saveCache(cache);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `eval "$(/opt/homebrew/bin/fnm env)" && node --test tests/cache.test.js`

Expected: `# pass 4`

- [ ] **Step 5: Run all tests to check nothing broke**

Run: `eval "$(/opt/homebrew/bin/fnm env)" && node --test`

Expected: all previously passing tests still pass

- [ ] **Step 6: Commit**

```bash
git add lib/cache.js tests/cache.test.js
git commit -m "feat: bump cache schema to v2 with structured review fields"
```

---

## Task 5: Extract renderReview and update logReview

**Files:**
- Modify: `lib/logger.js`
- Create: `tests/logger.test.js`

- [ ] **Step 1: Write failing logger tests**

Create `tests/logger.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `eval "$(/opt/homebrew/bin/fnm env)" && node --test tests/logger.test.js`

Expected: `Error: renderReview is not exported from lib/logger.js`

- [ ] **Step 3: Rewrite lib/logger.js**

Replace the entire file contents with:

```js
// lib/logger.js
// Append-only log of every agent run. Each entry is tagged with a project
// name (basename of cwd) so you can grep by project later.

import { appendFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_PATH = join(__dirname, "..", "reviews.log");

const DIVIDER = "─".repeat(48);

function projectTag() {
  return basename(process.cwd()) || "unknown";
}

function ensureLogDir() {
  const dir = dirname(LOG_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/**
 * Pure rendering function — exported for testing.
 * Takes all data explicitly so tests can pass controlled values.
 *
 * @param {object} opts
 * @param {string} opts.ts - ISO timestamp string
 * @param {string} opts.project - project tag
 * @param {string} opts.tag - log tag e.g. "REVIEW" or "REVIEW cached"
 * @param {string} opts.summary - one-line triage summary
 * @param {string} opts.verdict - "clean" | "minor" | "worth_refactoring"
 * @param {string} opts.prose - full review prose
 * @param {string[]} opts.files - affected file paths
 * @param {Array} opts.suggestions - suggestion cards (worth_refactoring only)
 */
export function renderReview({ ts, project, tag, summary, verdict, prose, files, suggestions }) {
  if (verdict === "clean") {
    return `\n[${ts}] [${project}] [${tag}] ${summary} — clean\n`;
  }

  const lines = [
    "",
    `[${ts}] [${project}] [${tag}] ${summary}`,
    "",
    `Verdict: ${verdict === "worth_refactoring" ? "worth refactoring" : "minor suggestions"}`,
  ];

  if (verdict === "worth_refactoring" && suggestions.length > 0) {
    lines.push("");
    for (const s of suggestions) {
      lines.push(`${s.file}${s.lines ? ` (lines ${s.lines})` : ""}`);
      lines.push(`  Issue: ${s.issue}`);
      lines.push(`  Fix:   ${s.fix}`);
      lines.push("");
    }
  }

  if (prose) {
    lines.push(DIVIDER);
    lines.push(prose);
    lines.push(DIVIDER);
  }

  lines.push("");
  return lines.join("\n");
}

/**
 * Log a one-line entry for skip events.
 */
export function logSkip(kind, note) {
  ensureLogDir();
  const ts = new Date().toISOString();
  const line = `[${ts}] [${projectTag()}] [${kind}] ${note}\n`;
  appendFileSync(LOG_PATH, line);
}

/**
 * Log a full review entry.
 *
 * @param {object} opts
 * @param {string} opts.summary - one-line triage summary
 * @param {string} opts.verdict - "clean" | "minor" | "worth_refactoring"
 * @param {string} opts.prose - full review prose
 * @param {string[]} opts.files - affected file paths
 * @param {Array} opts.suggestions - suggestion cards
 * @param {boolean} [opts.fromCache] - true if this is a cache replay
 */
export function logReview({ summary, verdict, prose, files, suggestions, fromCache = false }) {
  ensureLogDir();
  const entry = renderReview({
    ts: new Date().toISOString(),
    project: projectTag(),
    tag: fromCache ? "REVIEW cached" : "REVIEW",
    summary,
    verdict,
    prose,
    files,
    suggestions,
  });
  appendFileSync(LOG_PATH, entry);
}
```

- [ ] **Step 4: Run logger tests to verify they pass**

Run: `eval "$(/opt/homebrew/bin/fnm env)" && node --test tests/logger.test.js`

Expected: `# pass 6`

- [ ] **Step 5: Run all tests**

Run: `eval "$(/opt/homebrew/bin/fnm env)" && node --test`

Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add lib/logger.js tests/logger.test.js
git commit -m "feat: extract renderReview with tiered verdict rendering"
```

---

## Task 6: Wire main() together

Connect the structured `deepReview` result to `setCachedReview` and `logReview`. Update the cache-replay path. Capture `hookInput` from `readHookInput`.

**Files:**
- Modify: `index.js` (main function and readHookInput only)

- [ ] **Step 1: Update readHookInput to return its value**

In `index.js`, `readHookInput` already returns the parsed object — the issue is `main()` calls it and throws away the return value. In `main()`, find this line:

```js
readHookInput(); // currently unused, but consume stdin so the hook process doesn't hang
```

Replace it with:

```js
const hookInput = readHookInput(); // stop_hook_active will be used in feedback mode
```

- [ ] **Step 2: Update the cache-replay path**

In `main()`, find the cached branch (starting around `if (cached) {`). Replace the `logReview` call inside it:

```js
// Old:
logReview({
  summary: cached.summary,
  review: cached.review,
  fromCache: true,
});

// New:
logReview({
  summary: cached.summary,
  verdict: cached.verdict,
  prose: cached.prose,
  files: cached.files,
  suggestions: cached.suggestions,
  fromCache: true,
});
```

Add `renderReview` to the existing logger import at the top of `index.js`:

```js
// Change:
import { logReview, logSkip } from "./lib/logger.js";
// To:
import { logReview, logSkip, renderReview } from "./lib/logger.js";
```

Also add `basename` to the top of `index.js` (no path imports exist today):

```js
import { basename } from "path";
```

Then replace the cached console output block:

```js
// Old:
console.log("─".repeat(60));
console.log(cached.review);
console.log("─".repeat(60));

// New:
console.log(renderReview({
  ts: new Date().toISOString(),
  project: basename(process.cwd()),
  tag: "REVIEW cached",
  summary: cached.summary,
  verdict: cached.verdict,
  prose: cached.prose,
  files: cached.files ?? [],
  suggestions: cached.suggestions ?? [],
}));
```

- [ ] **Step 3: Update the changed:false cache write**

Find where a non-changed result is cached (after `if (!changed) {`):

```js
// Old:
setCachedReview(hash, {
  changed: false,
  summary,
  review: `No substantive code changes: ${summary}`,
});

// New:
setCachedReview(hash, {
  changed: false,
  summary,
  verdict: "clean",
  prose: "",
  files: [],
  suggestions: [],
});
```

- [ ] **Step 4: Update the deep review result handling**

Find the section after `const review = await deepReview(summary);` and replace it:

```js
// Old:
const review = await deepReview(summary);
setCachedReview(hash, { changed: true, summary, review });
logReview({ summary, review });

console.log("─".repeat(60));
console.log(review);
console.log("─".repeat(60));

// New:
const result = await deepReview(summary);
setCachedReview(hash, { changed: true, summary, ...result });
logReview({ summary, ...result });

console.log(renderReview({
  ts: new Date().toISOString(),
  project: basename(process.cwd()),
  tag: "REVIEW",
  summary,
  ...result,
}));
```

- [ ] **Step 5: Verify no syntax errors**

Run: `eval "$(/opt/homebrew/bin/fnm env)" && node --check index.js`

Expected: exits 0 with no output

- [ ] **Step 6: Run all tests**

Run: `eval "$(/opt/homebrew/bin/fnm env)" && node --test`

Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add index.js
git commit -m "feat: wire structured deepReview result through cache and logger"
```

---

## Task 7: Manual smoke test

Verify the full agent runs end-to-end and the log looks correct.

**Files:** none

- [ ] **Step 1: Run the agent against this repo**

From the hindsight-agent directory (which has uncommitted changes — the README.md modification from the initial git status):

Run: `eval "$(/opt/homebrew/bin/fnm env)" && node index.js`

Expected: triage runs, deep review runs (or skips if no source changes), output matches the new tiered format.

- [ ] **Step 2: Check the log entry**

Run: `tail -20 reviews.log`

Expected for a `worth_refactoring` result:
```
[2026-05-04T...] [hindsight-agent] [REVIEW] <summary>

Verdict: worth refactoring

<file> (lines <n-m>)
  Issue: ...
  Fix:   ...

────────────────────────────────────────
<prose>
────────────────────────────────────────
```

Expected for a `clean` result:
```
[2026-05-04T...] [hindsight-agent] [REVIEW] <summary> — clean
```

- [ ] **Step 3: Check the cache entry**

```bash
eval "$(/opt/homebrew/bin/fnm env)" && node --input-type=module <<'EOF'
import { readFileSync } from 'fs';
const c = JSON.parse(readFileSync('review-cache.json', 'utf8'));
const entries = Object.values(c.entries);
console.log(JSON.stringify(entries.at(-1), null, 2));
EOF
```

Expected: a v2 entry with `verdict`, `prose`, `files`, `suggestions` fields present. No `review` field.

- [ ] **Step 4: Wipe cache and verify cold-start works**

```bash
rm review-cache.json
eval "$(/opt/homebrew/bin/fnm env)" && node index.js
```

Expected: runs cleanly, creates a fresh cache file with a v2 entry.
