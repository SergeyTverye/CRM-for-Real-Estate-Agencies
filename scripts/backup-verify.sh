#!/usr/bin/env bash

set -euo pipefail
. "$(dirname "$0")/lib.sh"
require_docker; require_env
ID="${1-}"; [ -n "$ID" ] || fail "укажите backup_id"; shift || true
backup_run verify.sh "$ID"
if [ "${1-}" = "--targets" ] || [ "${1-}" = "--target" ]; then backup_run replicate.sh "$ID" --targets "${2:-all}" --verify-only; fi
