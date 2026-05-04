# hindsight

A post-implementation code review agent that runs automatically after [Claude Code](https://docs.claude.com/en/docs/claude-code/overview) finishes a task. It reviews the changes with fresh eyes and asks: *now that we have a working solution, is there a cleaner approach?*

Currently runs in **advisory mode** — reviews are appended to a log file you tail in a side terminal. The agent never blocks or modifies your Claude Code workflow.

## Why?

When Claude Code (or any agent) is mid-task, it makes local decisions to keep the work moving. Abstractions get introduced, helpers get extracted, patterns emerge that made sense in flight. Once the task is done and the solution actually works, those choices often look different. A fresh second pass — done by an agent that never saw the journey, only the destination — catches things the original pass can't.

That's hindsight: a separate agent, with its own system prompt and its own tools, that reviews the *finished* state and tells you whether there's a cleaner version.

## How it works

```
Claude Code finishes a task
        │
        ▼
   Stop hook fires
        │
        ▼
  Hash the working tree
        │
   ┌────┴────┐
   ▼         ▼
 cached?   miss?
   │         │
   │         ▼
   │     Phase 1: Triage (Haiku)
   │     Was source code added or refactored?
   │         │
   │         ▼
   │     Phase 2: Deep review (Sonnet)
   │     Is there a cleaner solution now?
   │         │
   └─────────┴──► Append to reviews.log
```

1. **Stop hook fires** when Claude Code finishes responding
2. **Hash the working tree** (`git diff HEAD` + untracked files)
3. **Cache check** — if we've reviewed this exact state, replay the cached verdict and exit
4. **Phase 1 (triage)** — was source code actually added or refactored? Cheap Haiku call
5. **Phase 2 (deep review)** — only if triage says yes. Sonnet call that looks for cleaner solutions
6. **Cache the result and append to the log**

Every run produces a log entry, even skips. The log is the single source of truth for what the agent has done.

## Requirements

- **Node.js 20+**
- **An [Anthropic API key](https://console.anthropic.com/settings/keys)**
- **[Claude Code](https://docs.claude.com/en/docs/claude-code/overview) installed and working**
- **Git** (the agent operates on git working trees)

## Install

```bash
git clone https://github.com/dwbra/hindsight-agent.git
cd hindsight-agent
npm install
```

(Or use `pnpm` / `yarn` — your choice.)

## Setup

### 1. Set your Anthropic API key

Add to your shell environment:

```bash
export ANTHROPIC_API_KEY="sk-ant-api03-..."
```

> **Where to put this matters for hooks.** Put it in `~/.zshenv` (zsh) or `~/.bash_profile` (bash). Files like `~/.zshrc` only run for interactive shells — Claude Code's hook spawns a non-interactive subshell, which won't see vars defined there.

Open a new terminal and verify:

```bash
echo $ANTHROPIC_API_KEY
node -e 'console.log(process.env.ANTHROPIC_API_KEY ? "OK" : "missing")'
```

Both should succeed.

### 2. Test it standalone

From any git repository with uncommitted changes:

```bash
node /absolute/path/to/hindsight-agent/index.js
```

Expected output: triage runs, then either a skip message or a full review depending on whether code changed.

> **If you use a Node version manager** (fnm, nvm, asdf, volta), `node` may not be on the PATH that Claude Code uses to spawn hooks. You can find your Node binary's absolute path with `which node` and use that explicitly in step 3 below.

### 3. Wire it to Claude Code

Edit your Claude Code settings — either:

- **`~/.claude/settings.json`** (global, applies everywhere)
- **`<project>/.claude/settings.json`** (per-project, only that project)

Add the `Stop` hook:

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node /absolute/path/to/hindsight-agent/index.js"
          }
        ]
      }
    ]
  }
}
```

Replace `/absolute/path/to/hindsight-agent/index.js` with the real path. If you're using a Node version manager, replace `node` with the absolute path to the binary too:

```json
"command": "/path/to/your/node /absolute/path/to/hindsight-agent/index.js"
```

If `settings.json` already exists, **merge** the `hooks` block in rather than replacing the file.

### 4. Restart Claude Code

Quit and relaunch so the new settings load.

## Daily workflow

Open a side terminal and tail the review log:

```bash
tail -f /path/to/hindsight-agent/reviews.log
```

Then work in Claude Code as normal. Every time it finishes a task, a new entry streams into your tail:

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

## Configuration

Models used per phase are defined in `lib/agent-loop.js`:

```javascript
export const MODELS = {
  HAIKU: "claude-haiku-4-5",
  SONNET: "claude-sonnet-4-6",
  OPUS: "claude-opus-4-7",
};
```

Triage uses Haiku (fast and cheap), deep review uses Sonnet. If you want to use Opus for the deep review, change the model passed to `deepReview()` in `index.js`.

## File layout

```
hindsight/
├── index.js              ← entry point invoked by the Stop hook
├── lib/
│   ├── agent-loop.js     ← generic agent loop (model + tools)
│   ├── cache.js          ← diff hashing + on-disk cache
│   ├── logger.js         ← append-only review log
│   └── tools.js          ← tool schemas and handlers
├── review-cache.json     ← created on first run (gitignored)
└── reviews.log           ← created on first run (gitignored)
```

## Resetting

```bash
# Wipe the cache (forces re-review of everything)
rm review-cache.json

# Clear the log
> reviews.log
```

## Behaviour notes

- **Exits 0 on errors** — a failed review never blocks Claude Code
- **Cache** grows unbounded under normal use; soft cap at 5MB triggers eviction down to the 1000 most recent entries
- **`process.cwd()`** of the hook process is the project Claude Code was working in, so `git diff` "just works"
- **Untracked files** are included in the hash and the review (uncommitted new files would otherwise be invisible to `git diff`)
- **Triage parse failures** are logged to stderr but not cached, so retries can recover
- **Non-git directories** are detected and skipped cleanly (the agent needs git to operate)

## Roadmap: feedback mode

Currently the agent is advisory — you read the log and decide what to act on. The planned next phase is **feedback mode**, where reviews are fed back into Claude Code automatically.

### How it would work

Claude Code's Stop hook protocol allows hooks to "block" by exiting with code 2 and writing to stderr. Anything written to stderr is fed back into the conversation as if the user had said it. So the change is:

```javascript
// Currently:
console.log(review);
process.exit(0);  // advisory — review goes to log only

// Feedback mode:
if (verdict === "worth_refactoring") {
  console.error(
    `Hindsight flagged a potential refactor:\n\n${review}\n\n` +
    `Reply with: \`show\` to see the proposed diff, \`apply\` to implement it, ` +
    `or describe what you'd like to do instead.`
  );
  process.exit(2);  // Claude Code surfaces the prompt and waits for the user
}
```

Only `worth_refactoring` triggers the prompt — `clean` and `minor` verdicts stay log-only so the user isn't interrupted for low-signal reviews. The question is phrased *as* the stderr message, so Claude Code handles the branching in-conversation (no separate UI required).

### Prerequisites before enabling

1. **Calibrated trust** — at least a week of advisory-mode use to confirm reviews are reliably useful. Feedback mode amplifies signal *and* noise.
2. **Structured severity output** — the deep review prompt needs to return JSON with an explicit `verdict` field (`clean`, `minor`, `worth_refactoring`). Only `worth_refactoring` should trigger feedback mode.
3. **Recursion guard** — Stop hooks can fire in response to Claude Code's response to a previous Stop hook. The hook input includes a `stop_hook_active` boolean; the agent must check it and bail if true.
4. **Escape hatch** — an env var like `HINDSIGHT_MODE=advisory` to force back to log-only without editing config.

### Why log-mode still matters in feedback mode

The log becomes the audit trail for every auto-applied refactor. Without it, you'll look at a commit later and wonder why the code shifted mid-session. With it, you have the answer.

## Costs

Rough per-run costs at current Anthropic pricing:

- Skip path (no API calls): **$0**
- Cache hit (no API calls): **$0**
- Triage only, no code changes: **fractions of a cent** (Haiku, small context)
- Triage + deep review: **a few cents** depending on diff size

The cache means you only pay for unique working-tree states. In practice this is very cheap unless you're running Claude Code constantly across many projects.

Set a monthly spending cap in the [Anthropic Console](https://console.anthropic.com/settings/limits) while you're getting comfortable.

## Contributing

Issues and PRs welcome. Particularly interested in:

- Better triage prompts (the model occasionally over- or under-reports)
- Additional tools the deep review could benefit from (e.g. running tests, viewing recent commit history)
- Feedback-mode implementation

## License

MIT