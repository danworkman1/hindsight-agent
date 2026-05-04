# Hindsight: Structured Output Design

**Date:** 2026-05-04  
**Status:** Approved  
**Scope:** Phase 1 of feedback mode — structured deep review output, richer log rendering, cache schema upgrade. Exit 2 feedback mode is out of scope and documented as future work.

---

## Problem

The deep review currently returns free-form prose. The verdict (`clean`, `minor`, `worth_refactoring`) is buried in the text with no machine-readable signal. This has two consequences:

1. The advisory log is harder to skim than it needs to be — no consistent header, suggestions mixed into prose
2. When feedback mode (exit 2) is enabled, extracting the verdict requires fragile string parsing

The goal is to upgrade the deep review output to structured JSON now, while still in advisory/calibration mode, so the log improves immediately and feedback mode can be enabled cleanly later.

---

## What Does Not Change

- The two-phase flow (triage → deep review) is unchanged
- Exit behaviour: still exit 0, still advisory only
- `reviews.log` stays a plain-text append-only file (structured data lives in `review-cache.json`)
- `reviews.log` format stays human-readable, rendered from the structured data

---

## Deep Review Output Shape

The `deepReview()` system prompt is updated to require this JSON shape. The existing `extractJsonObject()` utility (already used for triage) handles parsing.

```json
{
  "verdict": "clean | minor | worth_refactoring",
  "prose": "Full human-readable review. Referenced files and lines. If clean, says so plainly.",
  "files": ["src/auth.ts", "src/hooks/useUserData.ts"],
  "suggestions": [
    {
      "file": "src/auth.ts",
      "lines": "45-67",
      "issue": "Duplicates session validation already in middleware.js",
      "fix": "Extract into shared validateSession() utility"
    }
  ]
}
```

**Field rules:**
- `verdict` — always present, one of three values
- `prose` — present for `minor` and `worth_refactoring`; omitted (or empty string) for `clean`
- `files` — always present, empty array `[]` for `clean` and `minor` verdicts
- `suggestions` — only populated for `worth_refactoring`; empty array `[]` for `clean` and `minor`
- Line numbers in `suggestions` are best-effort; prose is authoritative if they conflict

---

## Cache Schema (version 1 → 2)

`CACHE_VERSION` bumps from 1 to 2. The existing version-mismatch logic in `loadCache()` treats old entries as a cold cache — first run after upgrade re-reviews, no migration needed.

**Before:**
```json
{
  "changed": true,
  "summary": "Added auth middleware",
  "review": "prose string...",
  "reviewedAt": "...",
  "cwd": "..."
}
```

**After:**
```json
{
  "changed": true,
  "summary": "Added auth middleware",
  "verdict": "worth_refactoring",
  "prose": "The implementation works but...",
  "files": ["src/auth.ts"],
  "suggestions": [
    { "file": "src/auth.ts", "lines": "45-67", "issue": "...", "fix": "..." }
  ],
  "reviewedAt": "...",
  "cwd": "..."
}
```

---

## Log Rendering

The `logReview()` function in `lib/logger.js` is updated to render the structured fields.

**worth_refactoring entry:**
```
[2026-05-04T09:12:33Z] [my-project] [REVIEW] Added auth middleware

Verdict: worth refactoring

src/auth.ts (lines 45–67)
  Issue: Duplicates session validation already in middleware.js
  Fix:   Extract into shared validateSession() utility

────────────────────────────────────────────────
The implementation works but two areas could be tightened...
[prose]
────────────────────────────────────────────────
```

**minor entry:**
```
[2026-05-04T09:12:33Z] [my-project] [REVIEW] Added auth middleware

Verdict: minor suggestions

The implementation is solid. One small thing: the error message on
line 23 could be more descriptive, but it's not worth acting on.
```

**clean entry:**
```
[2026-05-04T09:12:33Z] [my-project] [REVIEW] Added auth middleware — clean
```

Rendering rules by verdict:
- `worth_refactoring` — verdict header + suggestion cards + prose
- `minor` — verdict header + prose only (no cards; not worth acting on, keep log lean)
- `clean` — single line, no prose, no cards

---

## Hook Input

`readHookInput()` currently discards the parsed stdin object. Extend it to return the parsed object so `stop_hook_active` is accessible in `main()`. No behaviour change now — the field is read but not acted on until feedback mode is enabled.

```js
// main() — extend for future feedback mode
const hookInput = readHookInput();
// hookInput.stop_hook_active will guard against recursion in phase 2
```

---

## Future Work (Out of Scope)

These are not built in this implementation but are enabled by the structured output:

**Recursion guard:**
```js
if (hookInput.stop_hook_active) {
  logSkip("skip", "stop_hook_active — recursion guard");
  process.exit(0);
}
```

**Feedback mode (exit 2):**
```js
if (process.env.HINDSIGHT_MODE !== "advisory" && verdict === "worth_refactoring") {
  const msg = buildFeedbackMessage(result); // uses files + suggestions
  process.stderr.write(msg);
  process.exit(2);
}
```

The `buildFeedbackMessage()` function would craft a targeted prompt for Claude Code referencing the specific files and suggestions, instructing it to show a before/after comparison and ask the user to approve before making any changes.

---

## Files Changed

| File | Change |
|------|--------|
| `index.js` | Update `deepReview()` prompt; parse structured JSON result; pass structured object to cache and logger; surface `stop_hook_active` from hook input |
| `lib/logger.js` | Update `logReview()` to render verdict header, suggestion cards, then prose |
| `lib/cache.js` | Bump `CACHE_VERSION` to 2; update `setCachedReview` to store structured fields |
