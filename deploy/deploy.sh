#!/bin/sh
# Deploys one release to one environment on the NAS. Called by coach-deploy
# (deploy/nas/), which CI runs over SSH; not meant to be run directly.
#
#   deploy.sh <dev|prod> <commit-sha> <image>
#
# Prod is backed up first, and a failed backup stops the deploy. The new
# version must answer /healthz with its own commit within a minute; if it
# doesn't, the previous release is started again and the deploy fails.
set -eu
PATH=$PATH:/usr/local/bin # docker isn't on root's PATH on DSM

ROOT=${COACH_ROOT:-/volume1/docker/coach}
env=$1 sha=$2 image=$3
here=$(cd "$(dirname "$0")" && pwd)
dir=$ROOT/$env

fail() {
  echo "DEPLOY FAILED: $*" >&2
  exit 1
}

# compose_at <image> <release-dir> <docker compose arguments>
compose_at() {
  c_image=$1 c_rel=$2
  shift 2
  COACH_ROOT=$ROOT COACH_API_IMAGE=$c_image COACH_COMPOSE_FILE=$c_rel/deploy/compose.yaml \
    sh "$here/compose.sh" "$env" "$@"
}

# start <image> <release-dir> <version>: brings the project up and waits for
# the API to report that version.
start() {
  mkdir -p "$dir/config"
  cp "$2/deploy/config/serve.json" "$dir/config/serve.json"
  compose_at "$1" "$2" up -d --remove-orphans || return 1
  i=0
  while [ $i -lt 30 ]; do
    # The API listens only inside the ts container's network namespace.
    if compose_at "$1" "$2" exec -T ts wget -qO- http://127.0.0.1:8080/healthz 2>/dev/null |
      grep -q "\"version\":\"$3\""; then
      return 0
    fi
    i=$((i + 1))
    sleep 2
  done
  return 1
}

[ -f "$dir/.env" ] || fail "$dir/.env is missing"

prev_sha='' prev_image=''
if [ -f "$dir/release.env" ]; then
  prev_sha=$(sed -n 's/^COACH_RELEASE=//p' "$dir/release.env")
  prev_image=$(sed -n 's/^COACH_API_IMAGE=//p' "$dir/release.env")
fi

compose_at "$image" "$here/.." pull -q api || fail "could not pull $image"

# The first deploy of an environment has no database to back up yet.
if [ "$env" = prod ] && [ -n "$(compose_at "$image" "$here/.." ps -q db)" ]; then
  backup_dir=$(sed -n 's/^BACKUP_DIR=//p' "$dir/.env" | tail -1)
  COACH_ROOT=$ROOT COACH_ENV=prod COACH_API_IMAGE=$image COACH_COMPOSE_FILE=$here/compose.yaml \
    sh "$here/backup.sh" "${backup_dir:-/volume1/backups/coach}" || fail "backup failed, nothing was changed"
fi

if ! start "$image" "$here/.." "$sha"; then
  compose_at "$image" "$here/.." logs --tail 40 api >&2 || true
  if [ -n "$prev_sha" ] && [ -d "$dir/releases/$prev_sha" ]; then
    echo "rolling back to $prev_sha" >&2
    start "$prev_image" "$dir/releases/$prev_sha" "$prev_sha" ||
      fail "$sha did not come up, and neither did the rollback to $prev_sha"
    fail "$sha did not come up; rolled back to $prev_sha"
  fi
  fail "$sha did not come up, and there is no previous release to roll back to"
fi

printf 'COACH_RELEASE=%s\nCOACH_API_IMAGE=%s\n' "$sha" "$image" >"$dir/release.env.tmp"
mv "$dir/release.env.tmp" "$dir/release.env"
ln -sfn "releases/$sha" "$dir/current"

# Keep the five most recently deployed releases.
touch "$dir/releases/$sha"
# shellcheck disable=SC2012 # the names are commit hashes
ls -t "$dir/releases" | tail -n +6 | while read -r old; do
  rm -rf "${dir:?}/releases/$old"
done
echo "deployed $sha to $env"
