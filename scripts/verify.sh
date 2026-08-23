#!/usr/bin/env bash

set -u -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK_DIR="$SCRIPT_DIR/verify.d"
TIER="fast"
CHANGED=false
STRICT_UNKNOWN=false
ONLY=""
SKIPS=()

usage() {
  printf '%s\n' 'Usage: bash scripts/verify.sh [--tier fast|subsystem|release] [--changed] [--only NAME] [--skip NAME] [--strict-unknown]'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tier)
      [[ $# -ge 2 ]] || { usage >&2; exit 2; }
      TIER="$2"
      shift 2
      ;;
    --changed)
      CHANGED=true
      shift
      ;;
    --only)
      [[ $# -ge 2 ]] || { usage >&2; exit 2; }
      ONLY="$2"
      shift 2
      ;;
    --skip)
      [[ $# -ge 2 ]] || { usage >&2; exit 2; }
      SKIPS+=("$2")
      shift 2
      ;;
    --strict-unknown)
      STRICT_UNKNOWN=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

case "$TIER" in
  fast|subsystem|release) ;;
  *)
    printf 'Invalid tier: %s\n' "$TIER" >&2
    exit 2
    ;;
esac

should_skip() {
  local name="$1"
  local item
  for item in "${SKIPS[@]-}"; do
    if [[ "$name" == "$item" || "$name" == "$item.sh" ]]; then
      return 0
    fi
  done
  return 1
}

shopt -s nullglob
CHECKERS=("$CHECK_DIR"/*.sh)

if [[ ${#CHECKERS[@]} -eq 0 ]]; then
  printf '[verify] UNKNOWN: no checker found in %s\n' "$CHECK_DIR" >&2
  if [[ "$STRICT_UNKNOWN" == true ]]; then
    exit 2
  fi
  exit 0
fi

PASSED=0
FAILED=0
UNKNOWN=0
SKIPPED=0
STARTED_AT=$SECONDS

for checker in "${CHECKERS[@]}"; do
  name="$(basename "$checker")"
  short_name="${name%.sh}"

  if [[ -n "$ONLY" && "$ONLY" != "$name" && "$ONLY" != "$short_name" ]]; then
    continue
  fi
  if should_skip "$name"; then
    printf '[verify] SKIP %s (requested)\n' "$name"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  checker_args=(--tier "$TIER")
  if [[ "$CHANGED" == true ]]; then
    checker_args+=(--changed)
  fi

  printf '[verify] RUN  %s\n' "$name"
  bash "$checker" "${checker_args[@]}"
  code=$?
  case "$code" in
    0)
      PASSED=$((PASSED + 1))
      printf '[verify] PASS %s\n' "$name"
      ;;
    1)
      FAILED=$((FAILED + 1))
      printf '[verify] FAIL %s\n' "$name" >&2
      ;;
    2)
      UNKNOWN=$((UNKNOWN + 1))
      printf '[verify] UNKNOWN %s\n' "$name" >&2
      ;;
    77)
      SKIPPED=$((SKIPPED + 1))
      printf '[verify] SKIP %s\n' "$name"
      ;;
    *)
      FAILED=$((FAILED + 1))
      printf '[verify] FAIL %s (unexpected exit %s)\n' "$name" "$code" >&2
      ;;
  esac
done

elapsed=$((SECONDS - STARTED_AT))
printf '[verify] SUMMARY pass=%s fail=%s unknown=%s skip=%s duration=%ss tier=%s\n' \
  "$PASSED" "$FAILED" "$UNKNOWN" "$SKIPPED" "$elapsed" "$TIER"

if [[ "$FAILED" -gt 0 ]]; then
  exit 1
fi
if [[ "$STRICT_UNKNOWN" == true && "$UNKNOWN" -gt 0 ]]; then
  exit 2
fi
exit 0
