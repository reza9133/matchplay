#!/usr/bin/env bash
# One command for everything: static check, the local test suite, then the live Studionet run.
#   bash scripts/run-all.sh                      all of it
#   bash scripts/run-all.sh --only tournament    extra arguments go to the live run (scripts/e2e.mjs)
#   SKIP_LOCAL=1 bash scripts/run-all.sh         live run only
#   SKIP_LIVE=1  bash scripts/run-all.sh         local checks only
# Accounts are read from the environment (Codespaces secrets) or from .env (created by `npm run keys`).
cd "$(dirname "$0")/.." || exit 1
mkdir -p reports
STAMP="$(date -u +%Y-%m-%dT%H-%M-%S)"
LOCAL_STATUS="skipped"; LIVE_STATUS="skipped"; LINT_STATUS="skipped"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

if [ "${SKIP_LOCAL:-0}" != "1" ]; then
  echo "== static check of the contract"
  if command -v genvm-lint >/dev/null 2>&1; then
    if genvm-lint check contracts/matchplay.py; then LINT_STATUS="passed"; else LINT_STATUS="FAILED"; fi
  else
    echo "genvm-lint is not installed (run: bash scripts/setup.sh)"; LINT_STATUS="not installed"
  fi

  echo; echo "== local test suite (no network)"
  if python3 -m pytest -q --junitxml="reports/local-tests-$STAMP.xml"; then LOCAL_STATUS="passed"; else LOCAL_STATUS="FAILED"; fi
fi

if [ "${SKIP_LIVE:-0}" != "1" ]; then
  echo; echo "== live run on Studionet"
  if [ -z "${HOST_KEY:-}" ]; then
    echo "HOST_KEY is not set. Run 'npm run keys' (or add Codespaces secrets), then run this again."
    LIVE_STATUS="not run (no keys)"
  elif [ ! -d node_modules/genlayer-js ]; then
    echo "node packages are missing (run: bash scripts/setup.sh)"; LIVE_STATUS="not run (no packages)"
  else
    if node scripts/e2e.mjs "$@"; then LIVE_STATUS="passed"; else LIVE_STATUS="FAILED"; fi
  fi
fi

SUMMARY="reports/summary-$STAMP.md"
{
  echo "# Matchplay run summary"
  echo
  echo "- time (UTC): $STAMP"
  echo "- static check: $LINT_STATUS"
  echo "- local tests: $LOCAL_STATUS (junit: reports/local-tests-$STAMP.xml)"
  echo "- live Studionet run: $LIVE_STATUS (latest report: $(ls -t reports/matchplay-e2e-*.html 2>/dev/null | head -1))"
} > "$SUMMARY"
echo; echo "== summary"; cat "$SUMMARY"
case "$LINT_STATUS$LOCAL_STATUS$LIVE_STATUS" in *FAILED*) exit 1 ;; esac
exit 0
