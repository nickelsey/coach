#!/bin/sh
# Nightly Postgres dump. On the Synology, run it from
# Control Panel > Task Scheduler as root, e.g.:
#   /volume1/docker/coach/deploy/backup.sh /volume1/backups/coach
# and include that folder in a Hyper Backup task for an off-box copy.
set -eu

BACKUP_DIR=${1:?usage: backup.sh <backup-dir> [keep-days]}
KEEP_DAYS=${2:-30}

mkdir -p "$BACKUP_DIR"
out="$BACKUP_DIR/coach-$(date +%Y%m%d-%H%M%S).dump"

# Custom format (-Fc) is compressed and restores with pg_restore.
docker exec coach-db pg_dump -U coach -d coach -Fc > "$out.tmp"
mv "$out.tmp" "$out"

find "$BACKUP_DIR" -name 'coach-*.dump' -mtime +"$KEEP_DAYS" -delete
echo "wrote $out"
