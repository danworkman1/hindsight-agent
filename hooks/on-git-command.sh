#!/usr/bin/env bash
# PostToolUse hook for the Bash tool. Fires after every Bash command Claude runs.
# Filters for successful git commit/amend/rebase invocations and triggers a
# hindsight review against the appropriate range.

set -euo pipefail

payload=$(cat)

cmd=$(printf '%s' "$payload"      | jq -r '.tool_input.command // ""')
exit_code=$(printf '%s' "$payload" | jq -r '.tool_result.exit_code // 1')
cwd=$(printf '%s' "$payload"       | jq -r '.cwd // ""')

[[ "$exit_code" == "0" ]] || exit 0
[[ -n "$cwd" ]] || exit 0
cd "$cwd"

# Resolve the diff range based on which git operation just ran.
case "$cmd" in
  *"git rebase"*)
    git rev-parse ORIG_HEAD >/dev/null 2>&1 || exit 0
    base="ORIG_HEAD"
    ;;
  *"git commit"*)
    # Covers plain commit and --amend. After amend, HEAD~1 still points at the
    # original parent, so the diff captures the full amended commit.
    base="HEAD~1"
    ;;
  *)
    exit 0
    ;;
esac

# Use the CLI surface bundled with this plugin. The package's bin entry handles
# everything: lock acquisition, skip rules, cache, triage, deep review, logging.
exec "${CLAUDE_PLUGIN_ROOT}/index.js" --base "$base"
