#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if ! compgen -G "$ROOT/tests/*.test.js" >/dev/null; then
  printf '[test-node] no test file found\n' >&2
  exit 2
fi

node --test "$ROOT"/tests/*.test.js
