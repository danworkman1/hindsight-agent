# Hindsight Agent

Hindsight Agent is a post-implementation code review agent for Claude Code. Once Claude finishes a commit, it reviews the work with fresh eyes and asks the question the original pass can't: *now that we have a working solution, is there a cleaner approach?*

## Overview

When Claude Code is mid-task, it makes local decisions to keep the work moving. Abstractions get introduced, helpers get extracted, patterns emerge that made sense in flight. Once the task is done and the solution actually works, those choices often look different.

Hindsight is a separate agent — with its own system prompt, its own tools, and no memory of the journey — that reviews the *finished* state and surfaces refactor opportunities back into the active Claude session. It ships two ways: as a Claude Code plugin that fires automatically after every commit Claude makes, and as a CLI for manually kicking off reviews against any commit range.

## What I Built

The plugin installs through Claude Code's marketplace and wires itself into two hooks. A `PostToolUse` hook fires after `git commit`, `git commit --amend`, or `git rebase`, runs the review asynchronously so the Claude session never blocks, and appends every result to a local `reviews.log`. A `Stop` hook then surfaces any `worth_refactoring` verdicts directly back into the conversation via stderr — Claude reads them as a new prompt and can act on them before the user even sees the log.

The CLI is the same engine, exposed as `hindsight-agent` for one-off use: review the last commit, review a whole branch against main, force past the cache, or swap out the triage and deep-review models.

## Technical Architecture

The agent is built on Node.js 20+ and the Anthropic SDK, distributed as an npm package (`hindsight-agent`) and as a Claude Code plugin marketplace entry. The review pipeline runs in two phases:

1. A `PostToolUse` hook fires on git-related tool calls and resolves a commit range — `HEAD~1..HEAD` for commits and amends, `ORIG_HEAD..HEAD` for rebases.
2. Skip rules drop the run early for `main`/`master`, WIP commits, `[no-review]` tags, or branches that have hit their 3-review cap.
3. The diff is hashed (with doc files excluded) and checked against a per-branch cache.
4. On a miss, Phase 1 runs a fast triage pass with Haiku to decide whether the change is worth a deep look.
5. Phase 2 runs the deep review with Sonnet, injecting any prior verdict on the same branch as context so the model reassesses rather than repeating itself.
6. The structured JSON result is written to `reviews.log` and cached. If the verdict is `worth_refactoring`, the Stop hook surfaces it back into the next Claude turn.

## Sticking Points

### Evolving the trigger from `Stop` to `PostToolUse`
The first version was a pure `Stop` hook with `tail -f reviews.log` in a side terminal — I'd watch reviews stream by as Claude worked. That was great for iterating on prompts but fired on every session stop, including ones with no code changes. The fix was switching to a commit-based trigger: reviews now correspond 1:1 with actual diffs, and the cache key is the diff hash, so identical working-tree states never cost twice.

### Surfacing reviews back into the session without recursion
Once reviews were tied to commits, the next problem was getting the verdicts back in front of Claude without the user having to read a log file. Claude Code's Stop hook protocol allows a hook to exit 2 with a stderr message, which gets injected as a prompt. The catch is the Stop hook can re-fire on its own injected output. Hindsight tracks a `surfaced` flag per cache entry and honours the `stop_hook_active` payload field so each verdict lands exactly once.

### Async without blocking the session
Reviews call the Anthropic API and can take 10–30 seconds for a deep pass. The `PostToolUse` hook had to return immediately. It does — the hook spawns a detached subprocess, exits 0, and the review runs to completion in the background. Failures exit 0 too, so a broken review or a missing `ANTHROPIC_API_KEY` never blocks Claude or the user's commit.

### Distribution: script → npm package → Claude Code plugin
The project went through three distribution shapes. It started as a local script wired up by hand in `~/.claude/settings.json`. Then it became an npm package (`hindsight-agent`) with two bins so other people could install it globally. Then Claude Code's plugin marketplace landed and it became a plugin too — the plugin shells out to `npx hindsight-agent` on the first hook fire, so users don't need a separate `npm install` step. Both paths share the same engine, the same cache format, and the same log.

## Result

The final product is a working post-implementation review agent: a Claude Code plugin that fires after every commit Claude makes, surfaces refactor suggestions back into the live session, and falls back to a tailable log for everything else. The same engine ships as a standalone CLI for manual reviews. Diff-hash caching, per-branch review caps, and skip rules keep API costs to a few cents per substantive review and zero for everything else.

**Stack:** Node.js 20+, Anthropic SDK (Haiku for triage, Sonnet for deep review), Claude Code plugin hooks (`PostToolUse`, `Stop`), Git, npm.

**Timeline:** May 2026
