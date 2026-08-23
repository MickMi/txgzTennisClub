#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHANGED=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --changed) CHANGED=true; shift ;;
    --tier) shift 2 ;;
    *) shift ;;
  esac
done

FILES=()
if [[ "$CHANGED" == true ]]; then
  while IFS= read -r file; do
    [[ "$file" == *.js ]] || continue
    [[ "$file" == cloudfunctions/* || "$file" == miniprogram/* || "$file" == tests/* ]] || continue
    [[ -f "$ROOT/$file" ]] && FILES+=("$file")
  done < <(
    cd "$ROOT"
    {
      git diff --name-only --diff-filter=ACMR
      git diff --cached --name-only --diff-filter=ACMR
      git ls-files --others --exclude-standard
    } | sort -u
  )
else
  while IFS= read -r file; do
    FILES+=("${file#"$ROOT/"}")
  done < <(
    find "$ROOT/cloudfunctions" "$ROOT/miniprogram" "$ROOT/tests" \
      -type f -name '*.js' -not -path '*/node_modules/*' | sort
  )
fi

if [[ ${#FILES[@]} -eq 0 ]]; then
  printf '[compile-js] no JavaScript file selected\n'
  exit 77
fi

for file in "${FILES[@]}"; do
  node --check "$ROOT/$file"
done

printf '[compile-js] checked %s file(s)\n' "${#FILES[@]}"
