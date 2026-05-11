#!/usr/bin/env bash
# PostToolUse hook for the Bash tool. Fires after every Bash command Claude runs.
# Filters for successful git commit/amend/rebase invocations and triggers a
# hindsight review against the appropriate range.
#
# Engine resolution: prefers a globally-installed `hindsight-agent` for speed,
# falls back to npx (which fetches and caches on first run).

set -euo pipefail

payload=$(cat)

cmd=$(printf '%s' "$payload"      | jq -r '.tool_input.command // ""')
exit_code=$(printf '%s' "$payload" | jq -r '.tool_result.exit_code // 1')
cwd=$(printf '%s' "$payload"       | jq -r '.cwd // ""')

[[ "$exit_code" == "0" ]] || exit 0
[[ -n "$cwd" ]] || exit 0
cd "$cwd"

case "$cmd" in
  *"git rebase"*)
    git rev-parse ORIG_HEAD >/dev/null 2>&1 || exit 0
    base="ORIG_HEAD"
    ;;
  *"git commit"*)
    base="HEAD~1"
    ;;
  *)
    exit 0
    ;;
esac

if command -v hindsight-agent >/dev/null 2>&1; then
  exec hindsight-agent --base "$base"
else
  exec npx --prefer-offline -y -p hindsight-agent hindsight-agent --base "$base"
fi
