#!/usr/bin/env bash
# Stop hook. Surfaces an unread `worth_refactoring` review for the current HEAD
# back to the Claude Code session via stderr + exit 2.
#
# Engine resolution: prefers a globally-installed `hindsight-surface` for speed,
# falls back to npx (which fetches and caches on first run).

set -euo pipefail

if command -v hindsight-surface >/dev/null 2>&1; then
  exec hindsight-surface
else
  exec npx --prefer-offline -y -p hindsight-agent hindsight-surface
fi
