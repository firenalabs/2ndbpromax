#!/usr/bin/env bash
set -e
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
if ! command -v node >/dev/null 2>&1; then
  printf 'Para iniciar, instale Node.js 22 ou superior.\n'
  exit 1
fi
exec node sistema/iniciar.mjs "$@"
