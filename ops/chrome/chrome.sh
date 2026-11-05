#!/bin/sh
# Both Playwright browser:true and channel:chrome use this configurable executable.
set -eu
exec "${SCRAPER_CHROME_PATH:-/usr/bin/chromium}" "$@"
