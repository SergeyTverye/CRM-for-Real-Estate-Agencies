#!/usr/bin/env bash

set -euo pipefail
. "$(dirname "$0")/lib.sh"
require_docker; require_env
if [ "${1-}" = "--remote" ]; then backup_run replicate.sh --list --targets "${2:?укажите code}"; else backup_run list.sh; fi
