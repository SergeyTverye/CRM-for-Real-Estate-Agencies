#!/usr/bin/env bash

set -euo pipefail
. "$(dirname "$0")/lib.sh"
require_docker; require_env
CODE="${1-}"; [ -n "$CODE" ] || fail "укажите код target"
dc up -d db >/dev/null; wait_healthy db 120 || fail "PostgreSQL недоступна"
backup_run probe.sh "$CODE"
