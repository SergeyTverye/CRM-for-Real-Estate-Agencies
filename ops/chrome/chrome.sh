#!/bin/sh
set -eu
exec "${SCRAPER_CHROME_PATH:-/usr/bin/chromium}" "$@"
