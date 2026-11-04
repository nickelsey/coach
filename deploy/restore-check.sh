#!/bin/sh
# Weekly proof that the backups work: restores the newest dump into a scratch
# database and compares it with the live one. Never touches the live database.
# On the Synology, run it from Control Panel > Task Scheduler as root, with
# "send run details by email only when the script terminates abnormally":
#   /volume1/docker/coach/deploy/restore-check.sh /volume1/backups/coach
#
# Fails (exit 1) if the newest dump is missing, too old, won't restore, or has
# far fewer rows than the live database.
set -eu
PATH=$PATH:/usr/local/bin # docker isn't on root's PATH on DSM

BACKUP_DIR=${1:?usage: restore-check.sh <backup-dir> [max-age-hours]}
MAX_AGE_HOURS=${2:-26}
DB=${COACH_DB_CONTAINER:-coach-db}
SCRATCH=coach_restore

fail() {
  echo "RESTORE CHECK FAILED: $*" >&2
  exit 1
}

psql_at() { # psql_at <database> <sql>
  docker exec "$DB" psql -U coach -d "$1" -v ON_ERROR_STOP=1 -tAc "$2"
}

latest=$(ls -t "$BACKUP_DIR"/coach-*.dump 2>/dev/null | head -1)
[ -n "$latest" ] || fail "no dumps in $BACKUP_DIR"
[ -z "$(find "$latest" -mmin +$((MAX_AGE_HOURS * 60)))" ] ||
  fail "newest dump is older than $MAX_AGE_HOURS hours: $latest"

trap 'docker exec "$DB" dropdb -U coach --if-exists "$SCRATCH" >/dev/null 2>&1 || true' EXIT
docker exec "$DB" dropdb -U coach --if-exists "$SCRATCH"
docker exec "$DB" createdb -U coach "$SCRATCH"
docker exec -i "$DB" pg_restore -U coach -d "$SCRATCH" --exit-on-error <"$latest" ||
  fail "pg_restore could not restore $latest"

tables=$(psql_at coach "select tablename from pg_tables where schemaname = 'public' order by 1")
[ -n "$tables" ] || fail "live database has no tables"

for t in $tables; do
  live=$(psql_at coach "select count(*) from \"$t\"")
  rest=$(psql_at "$SCRATCH" "select count(*) from \"$t\"") || fail "$t is missing from the restore"
  # The live table may have grown since the dump, so allow some slack: the
  # larger of 50 rows or 10%.
  slack=$((live / 10))
  [ "$slack" -ge 50 ] || slack=50
  [ "$rest" -ge $((live - slack)) ] || fail "$t looks short: $rest restored, $live live"
  [ "$live" -eq 0 ] || [ "$rest" -gt 0 ] || fail "$t restored empty, $live live"
  echo "ok $t: $rest restored, $live live"
done
echo "restore check passed: $latest"
