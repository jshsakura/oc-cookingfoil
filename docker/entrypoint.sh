#!/bin/sh
# Runs the server as PUID:PGID (1000:1000 by default, like most NAS images), so
# what it writes into your folders belongs to you and not to root.
#
# Started as root (the default): the data folder is handed to PUID:PGID, only
# the entries that belong to someone else. Folders Docker made as root to hold a
# mount (the mount itself, or retro/ and retro/roms/ under a nested
# retro/roms/<system> mount) are handed over too: a root-owned folder near the
# top that holds no files of its own. Library folders are never changed in bulk, since
# they can be large or on a NAS share; one the server cannot write is named in
# the log with the command that fixes it. PUID=0 keeps running as root.
#
# Started as another user (`user:` in compose): runs as that user, unchanged.
set -e

if [ "$(id -u)" != "0" ]; then exec "$@"; fi

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
umask "${UMASK:-022}"

case "$PUID$PGID" in *[!0-9]*|"") echo "[oc-cookingfoil] PUID and PGID must be numbers (got PUID=$PUID PGID=$PGID)" >&2; exit 1 ;; esac
if [ "$PUID" = "0" ]; then exec "$@"; fi

DATA="${COOK_DATA_DIR:-/data}"
mkdir -p "$DATA"
find "$DATA" -xdev \( ! -user "$PUID" -o ! -group "$PGID" \) -exec chown -h "$PUID:$PGID" {} + 2>/dev/null \
  || echo "[oc-cookingfoil] WARNING: could not hand $DATA to $PUID:$PGID; the server may fail to save settings" >&2

for dir in "${COOK_GAMES_DIR:-/games}" "${COOK_RETRO_DIR:-/retro}" "${COOK_PATCHES_DIR:-/patches}" "${COOK_SAVES_DIR:-/saves}" "${COOK_HOMEBREW_DIR:-/homebrew}"; do
  [ -d "$dir" ] || continue
  find "$dir" -xdev -maxdepth 2 -type d -user 0 2>/dev/null | while read -r made; do
    [ -z "$(find "$made" -mindepth 1 -maxdepth 1 ! -type d 2>/dev/null)" ] && chown "$PUID:$PGID" "$made" 2>/dev/null || true
  done
  if ! su-exec "$PUID:$PGID" test -w "$dir"; then
    echo "[oc-cookingfoil] WARNING: $dir is not writable by $PUID:$PGID. Uploads and sorting into it will fail." >&2
    echo "[oc-cookingfoil]   On the host: sudo chown -R $PUID:$PGID <the folder mounted at $dir>, or set PUID/PGID to its owner." >&2
  fi
done

exec su-exec "$PUID:$PGID" "$@"
