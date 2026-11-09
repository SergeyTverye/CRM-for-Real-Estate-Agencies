#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$root"
exec node scripts/security/confidential-guard.mjs --artifacts "$@"
