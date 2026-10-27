#!/bin/sh
set -eu
DATABASE_PATH="${DATABASE_PATH:-/data/misis/misis.sqlite}"
MISIS_CATALOG_PATH="${MISIS_CATALOG_PATH:-$(dirname "$DATABASE_PATH")/misis-data.json}"
export DATABASE_PATH MISIS_CATALOG_PATH
# Mounted storage may initially belong to root. Prepare only this app's paths,
# then run the web server and Telegram worker as the unprivileged node user.
mkdir -p "$(dirname "$DATABASE_PATH")" "$(dirname "$MISIS_CATALOG_PATH")"
if [ "$(id -u)" = 0 ]; then
  chown node:node "$(dirname "$DATABASE_PATH")" "$(dirname "$MISIS_CATALOG_PATH")"
  for file in "$DATABASE_PATH" "$DATABASE_PATH-wal" "$DATABASE_PATH-shm" "$MISIS_CATALOG_PATH"; do
    if [ -f "$file" ]; then chown node:node "$file"; fi
  done
  exec gosu node "$@"
fi
exec "$@"
