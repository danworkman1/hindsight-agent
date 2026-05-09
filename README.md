# hindsight-agent

A post-implementation code review agent that runs automatically after each `git commit`. It reviews the changes with fresh eyes and asks: *now that we have a working solution, is there a cleaner approach?*

Currently runs in **advisory mode** — reviews are appended to a log file you tail in a side terminal. The agent never blocks your workflow.

## Why?

When Claude Code (or any agent) is mid-task, it makes local decisions to keep the work moving. Abstractions get introduced, helpers get extracted, patterns emerge that made sense in flight. Once the task is done and the solution actually works, those choices often look different. A fresh second pass — done by an agent that never saw the journey, only the destination — catches things the original pass can't.

That's hindsight: a separate agent, with its own system prompt and its own tools, that reviews the *finished* state and tells you whether there's a cleaner version.

## How it works

```
git commit
    │
    ▼
post-commit hook fires
    │
    ▼
Read commit metadata (branch, message, SHA)
    │
    ▼
Skip rules (main branch, WIP, [no-review], cap=3)
    │
    ▼
Hash HEAD~1..HEAD diff
    │
┌───┴───┐
▼       ▼
cached?  miss?
    │       │
    │       ▼
    │   Phase 1: Triage (Haiku)
    │       │
    │       ▼
    │   Phase 2: Deep review (Sonnet)
    │   with prior review on this branch as context
    │       │
    └───────┴──► Append to reviews.log
```

1. **Post-commit hook fires** when you `git commit`
2. **Skip rules check** — main/master, WIP messages, `[no-review]` tag, or branch cap (3 reviews) short-circuit before any model call
3. **Hash the commit diff** (`HEAD~1..HEAD`, doc files excluded)
4. **Cache check** — if we've reviewed this exact diff, replay the cached verdict and exit
5. **Phase 1 (triage)** — was source code actually added or refactored? Cheap Haiku call
6. **Phase 2 (deep review)** — only if triage says yes. Sonnet call with the prior review on this branch (if any) as context, so the model reassesses rather than relitigates
7. **Cache the result and append to the log**

Every run produces a log entry, even skips. The log is the single source of truth for what the agent has done.

## Requirements

- **Node.js 20+**
- **An [Anthropic API key](https://console.anthropic.com/settings/keys)**
- **Git** (the agent operates on git working trees)

## Install

Install once, globally:

```bash
npm install -g hindsight-agent
# or: pnpm add -g hindsight-agent
# or: yarn global add hindsight-agent
```

You can also skip the global install and use `npx hindsight-agent ...` for everything below.

## Setup

### 1. Set your Anthropic API key

Add to your shell environment:

```bash
export ANTHROPIC_API_KEY="sk-ant-api03-..."
```

> **Where to put this matters for hooks.** Put it in `~/.zshenv` (zsh) or `~/.bash_profile` (bash). Files like `~/.zshrc` only run for interactive shells — the post-commit hook spawns a non-interactive subshell, which won't see vars defined there.

Open a new terminal and verify:

```bash
echo $ANTHROPIC_API_KEY
```

### 2. Install the post-commit hook in a repo

```bash
cd /path/to/your/project
npx hindsight-agent init
```

This:

- writes `.git/hooks/post-commit` (detached so `git commit` returns immediately)
- adds `reviews.log` and `review-cache.json` to your `.gitignore`
- prints the exact `tail -f` command for this repo
- prints an optional Stop-hook snippet for `~/.claude/settings.json` (feedback mode)

The hook invokes `bin/run-with-node.sh`, a wrapper that resolves a usable `node` binary at fire time across fnm, nvm, volta, asdf, mise, homebrew, and `/usr/bin` — so the hook keeps working when you upgrade or switch node managers. If it picks wrong, override with `HINDSIGHT_NODE=/absolute/path/to/node` before running `init`.

### 3. Tail the log

In a side terminal:

```bash
tail -f reviews.log
```

Now every commit you make in this repo streams a review entry into your tail. That's it.

### 4. (Optional) Enable feedback mode

After `init` finishes, paste the printed Stop-hook block into `~/.claude/settings.json` and restart Claude Code. Worth-refactoring reviews will be surfaced back into the active Claude Code session — see [Feedback mode](#feedback-mode).

### Uninstall

From the repo:

```bash
npx hindsight-agent uninstall
```

Removes the post-commit hook. Your `reviews.log` and `review-cache.json` are kept; delete them yourself if you no longer want them.

### Test it without committing

```bash
npx hindsight-agent --force --base main
```

Runs a one-off review of the current branch against `main`, bypassing cache and skip rules.

## CLI reference

```
hindsight-agent [subcommand] [options]
```

### Subcommands

| Subcommand | Description |
|------------|-------------|
| `init` | Install the post-commit hook in the current git repo |
| `uninstall` | Remove the post-commit hook from the current git repo |
| `help` | Print usage |
| _(none)_ | Run a review (this is what the hook invokes) |

### Review-mode flags

| Flag | Description |
|------|-------------|
| `--path <dir>` | Run against this repo instead of cwd |
| `--base <ref>` | Diff against this ref instead of HEAD~1 (e.g. `main` to review the whole branch) |
| `--force` | Skip cache, skip-rules, and the no-changes guard — always run triage + deep review |
| `--triage-model <model>` | Model for Phase 1 triage. Default: `haiku` |
| `--review-model <model>` | Model for Phase 2 deep review. Default: `sonnet` |

**Model values:** `haiku`, `sonnet`, `opus` (or a raw Anthropic model ID).

### Examples

```bash
# Review the last commit in cwd (same as the post-commit hook)
hindsight-agent

# Force a review of everything on this branch vs main
hindsight-agent --force --base main

# Point at a different repo
hindsight-agent --path ~/coding/my-project --force --base main

# Use Opus for the deep review pass
hindsight-agent --force --base main --review-model opus

# Use Haiku for everything (cheapest)
hindsight-agent --force --triage-model haiku --review-model haiku

# Test without a real commit (empty commit)
git commit --allow-empty -m "test: trigger hindsight"
```

## Daily workflow

Open a side terminal in the repo and tail the review log:

```bash
tail -f reviews.log
```

Then commit as normal. Every time you commit, a new entry streams into your tail:

```
[2026-05-03T10:15:11Z] [my-project] [skip] no changes in working tree
[2026-05-03T10:25:42Z] [my-project] [REVIEW] Added auth middleware in src/auth.ts

**Verdict: clean**
The implementation is straightforward and well-scoped...

[2026-05-03T10:31:08Z] [my-project] [REVIEW] Refactored user fetching into a hook

**Verdict: worth refactoring**
The new `useUserData` hook duplicates logic that already lives in
`useAuth`. Consider consolidating...
```

Skim each entry as it arrives:
- `[skip]` lines you ignore — agent ran, nothing to review
- `[REVIEW] ... clean` you ignore — code looks good
- `[REVIEW] ... worth refactoring` you read — the agent thinks there's a cleaner approach

When a review is worth acting on, paste the relevant bits back into Claude Code and let it apply the changes.

## Useful log commands

```bash
# Just the substantive reviews, no skip noise
grep -A30 "\[REVIEW\]" reviews.log

# Everything for one project
grep "\[my-project\]" reviews.log

# Today's activity
grep "$(date -u +%Y-%m-%d)" reviews.log

# Chronological one-line summary of every run
grep -E "^\[2[0-9]" reviews.log
```

## Resetting

In the repo:

```bash
# Wipe the cache (forces re-review of everything)
rm review-cache.json

# Clear the log
> reviews.log
```

## Behaviour notes

- **Exits 0 on errors** — a failed review never blocks commits
- **Cache** grows unbounded under normal use; soft cap at 5MB triggers eviction down to the 1000 most recent entries
- **`process.cwd()`** of the hook process is the project you committed in, so `git diff` "just works" — or pass `--path` to override
- **Untracked files** are included in the hash and the review (uncommitted new files would otherwise be invisible to `git diff`)
- **Triage parse failures** are recorded in `reviews.log` but not cached, so retries can recover
- **Non-git directories** are detected and skipped cleanly
- **Branch cap**: 3 reviews per branch. After that, commits log a `[CAP]` line and skip the model call. Use `--force` to override
- **Skipped commit messages**: `wip`, `WIP`, `[no-review]`
- **Skipped branches**: `main`, `master` (squash-merges and CI commits don't burn reviews)
- **Prior review context**: when re-reviewing a branch, the prior verdict and suggestions are fed into the prompt so the model reassesses rather than repeating itself
- **`--base <ref>`**: diffs the entire range `<ref>..HEAD` instead of `HEAD~1..HEAD` — useful for reviewing a full feature branch in one pass

## Feedback mode

`surface.js` is a Claude Code Stop-hook entry point. When the post-commit pipeline lands a `worth_refactoring` review for the current HEAD, surface writes it to stderr and exits 2 — Claude Code's protocol for injecting a prompt back into the conversation. Each review is surfaced at most once (tracked via the `surfaced` flag in the cache). The hook respects `stop_hook_active` so it can't recurse on its own output.

Wire it up by pasting the Stop-hook block printed by `npx hindsight-agent init` into `~/.claude/settings.json`, then restart Claude Code. The block uses `bin/run-with-node.sh` so it picks up the same auto-resolved node as the post-commit hook.

### Defer-to-worktree (planned)

Alongside `show` and `apply`, the prompt should offer a third path: **defer the refactor to a separate worktree**. When chosen, Claude Code creates a new git worktree (on a fresh branch) and drops a markdown file at its root containing the verdict, prose, affected files, and the full suggestions list — a self-contained brief that a future session can pick up cold.

## Costs

Rough per-run costs at current Anthropic pricing:

- Skip path (no API calls): **$0**
- Cache hit (no API calls): **$0**
- Triage only, no code changes: **fractions of a cent** (Haiku, small context)
- Triage + deep review: **a few cents** depending on diff size

The cache means you only pay for unique working-tree states. In practice this is very cheap unless you're running it constantly across many projects.

Set a monthly spending cap in the [Anthropic Console](https://console.anthropic.com/settings/limits) while you're getting comfortable.

## Contributing

Issues and PRs welcome. Particularly interested in:

- Better triage prompts (the model occasionally over- or under-reports)
- Additional tools the deep review could benefit from (e.g. running tests, viewing recent commit history)
- Feedback-mode implementation

## License

MIT
