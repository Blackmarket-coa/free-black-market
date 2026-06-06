#!/bin/bash
#
# SessionStart hook for Claude Code on the web.
#
# The remote execution environment clones the repo fresh and only installs the
# backend's dependencies. This installs the JS dependencies for the packages we
# actively work on during web sessions (backend + vendor-panel) so that
# typechecks, linters and tests can run. Runs synchronously so deps are ready
# before the agent loop starts.
#
set -euo pipefail

# Only run in the ephemeral web/remote container. Local devs manage their own
# installs.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

# pnpm install is idempotent and benefits from the cached container layer, so
# re-runs (resume/clear/compact) are cheap.
for pkg in backend vendor-panel; do
  if [ -f "$ROOT/$pkg/package.json" ]; then
    echo "[session-start] pnpm install in $pkg…"
    (cd "$ROOT/$pkg" && pnpm install)
  fi
done

echo "[session-start] dependencies ready."
