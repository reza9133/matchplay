#!/usr/bin/env bash
# Installs everything the tests and the live run need. Safe to run more than once.
cd "$(dirname "$0")/.." || exit 1
set -e
echo "== python packages"
python3 -m pip install --quiet --upgrade pip
python3 -m pip install --quiet -r requirements.txt

# The local test runner downloads the GenVM runtime of the newest release. Some release candidates do not carry
# that archive (a 404), so a known-good runtime that matches the contract's header is placed in the cache first.
echo "== local GenVM runtime for the tests"
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/gltest-direct"
if ls "$CACHE"/genvm-universal-*.tar.xz >/dev/null 2>&1; then
  echo "already cached: $(ls "$CACHE"/genvm-universal-*.tar.xz | head -1)"
else
  mkdir -p "$CACHE"
  if curl -fL --retry 3 -o "$CACHE/genvm-universal-v0.2.16.tar.xz.part" "https://github.com/genlayerlabs/genvm/releases/download/v0.2.16/genvm-universal.tar.xz"; then
    mv "$CACHE/genvm-universal-v0.2.16.tar.xz.part" "$CACHE/genvm-universal-v0.2.16.tar.xz"
    echo "cached genvm v0.2.16"
  else
    rm -f "$CACHE/genvm-universal-v0.2.16.tar.xz.part"
    echo "warning: could not download the runtime; the test runner will try on its own"
  fi
fi

echo "== node packages"
npm install --no-audit --no-fund
echo "== done. Next:  npm run keys   then   bash scripts/run-all.sh"
