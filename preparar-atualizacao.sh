#!/usr/bin/env bash
set -e
cd -- "$(dirname -- "$0")"
node sistema/preparar-atualizacao.mjs
