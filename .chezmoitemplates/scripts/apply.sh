#!/usr/bin/env bash
set -euo pipefail

for target in "$@"; do
  if [[ -z "$target" ]]; then
    echo "Apply targets must not be empty." >&2
    exit 2
  fi
done

source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
exec chezmoi -S "$source_dir" apply "$@"
