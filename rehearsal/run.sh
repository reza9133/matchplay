#!/usr/bin/env bash
# Offline rehearsal of the live run: the real contract runs in the local test runner, a stub plays genlayer-js and
# the network, and scripts/e2e.mjs runs against it unchanged. It checks the script's logic, not the real AI.
#   bash rehearsal/run.sh                                   all default scenarios
#   bash rehearsal/run.sh --only tournament,strike
#   REHEARSAL_SPEED=60 bash rehearsal/run.sh --with-void    the clock runs 60x faster (the default is 120)
#   FINALITY_DELAY=90 bash rehearsal/run.sh                 transfers only arrive 90 chain-seconds after the claim
#   JUDGE=biased | noisy | flaky   bash rehearsal/run.sh    how the scripted judge behaves (default: honest)
set -e
here="$(cd "$(dirname "$0")/.." && pwd)"
work="$here/.rehearsal-tmp"
rm -rf "$work"
mkdir -p "$work"
cp -r "$here/scripts" "$work/scripts"
ln -s "$here/contracts" "$work/contracts"
cp -r "$here/rehearsal/stub/node_modules" "$work/node_modules"
cp "$here/package.json" "$work/package.json"
export REHEARSAL_ROOT="$here"
export REHEARSAL_SPEED="${REHEARSAL_SPEED:-120}"
export HOST_KEY=0x$(printf '1%.0s' $(seq 1 64))
export ALICE_KEY=0x$(printf '2%.0s' $(seq 1 64))
export BOB_KEY=0x$(printf '3%.0s' $(seq 1 64))
export CAROL_KEY=0x$(printf '4%.0s' $(seq 1 64))
export DAVE_KEY=0x$(printf '5%.0s' $(seq 1 64))
export MATCHPLAY_ADDRESS=0x$(printf 'ab%.0s' $(seq 1 20))
export REPORT_DIR="$here/reports/rehearsal"
export SKIP_ECHO_PROBE=1   # the offline network has its own echo page
cd "$work"
node scripts/e2e.mjs "$@"
