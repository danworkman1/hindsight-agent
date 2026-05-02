# hindsight-agent

A post-implementation code review agent triggered by Claude Code's `Stop` hook. After Claude Code finishes a task, this agent independently reviews the changes with fresh eyes and asks: *now that we have a working solution, is there a cleaner approach?*

## How it works

1. **Stop hook fires** when Claude Code finishes responding
2. **Hash the working tree** (`git diff HEAD` + untracked files)
3. **Cache check** — if we've reviewed this exact state, print the cached verdict and exit
4. **Phase 1 (triage)** — was source code actually added or refactored? Cheap call.
5. **Phase 2 (deep review)** — only if triage says yes. Looks for cleaner solutions.
6. **Cache the result** and print

## Setup

### 1. Install

```bash
cd ~/hindsight-agent
pnpm install
```

### 2. Set your API key

Add to `~/.zshrc` or `~/.bashrc`:

```bash
export ANTHROPIC_API_KEY=sk-...
```

Then `source` your rc file or open a new terminal.

### 3. Test standalone

```bash
cd ~/some-project-with-uncommitted-changes
node ~/code-reviewer-agent/index.js
```

You should see triage output and (if code changed) a review.

### 4. Wire to Claude Code

Edit `~/.claude/settings.json` (create it if it doesn't exist):

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "node /Users/YOUR_USERNAME/hindsight-agent/index.js"
          }
        ]
      }
    ]
  }
}
```

Replace `/Users/YOUR_USERNAME/` with your actual home path (`echo $HOME`).

If `settings.json` already exists, merge the `hooks` section into it rather than replacing the file.

### 5. Restart Claude Code

Start a new session. After the next task completes, you should see review output.

## Files

- `index.js` — entry point
- `lib/cache.js` — diff hashing and disk cache
- `lib/agent-loop.js` — generic agent loop (model + tools)
- `lib/tools.js` — tool schemas and handlers
- `review-cache.json` — created on first run (gitignored)

## Resetting the cache

```bash
rm ~/code-reviewer-agent/review-cache.json
```

## Notes

- Exits 0 on errors so a failed review never blocks Claude Code
- Cache grows unbounded under normal use; soft cap at 5MB triggers eviction to 1000 most recent entries
- `cwd` of the hook process is the project Claude Code was working in, so `git diff` "just works"
