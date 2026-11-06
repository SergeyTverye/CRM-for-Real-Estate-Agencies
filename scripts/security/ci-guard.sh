#!/bin/sh
# Run immediately before upload-artifact. Additional paths: --artifact path
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$root"
exec node scripts/security/confidential-guard.mjs --artifacts "$@"
