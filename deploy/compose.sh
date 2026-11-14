#!/bin/sh
# Runs docker compose for one environment on the NAS, with the right project
# name, env file and release. Use it for anything by hand, as root:
#
#   compose.sh prod ps
#   compose.sh dev logs -f api
#   compose.sh prod restart ts
#
# Each environment lives in $COACH_ROOT/<env>/ (see deploy/README.md).
set -eu
PATH=$PATH:/usr/local/bin # docker isn't on root's PATH on DSM

ROOT=${COACH_ROOT:-/volume1/docker/coach}
env=${1:?usage: compose.sh <dev|prod> <docker compose arguments>}
shift
case "$env" in dev | prod) ;; *) echo "environment must be dev or prod" >&2; exit 2 ;; esac
dir=$ROOT/$env

# release.env records what is deployed. deploy.sh overrides both of these
# while a deploy is in progress.
if [ -z "${COACH_API_IMAGE:-}" ]; then
  # shellcheck disable=SC1091
  . "$dir/release.env"
fi
export COACH_API_IMAGE
export CONFIG_DIR="$dir/config"

exec docker compose -p "coach-$env" --env-file "$dir/.env" \
  -f "${COACH_COMPOSE_FILE:-$dir/current/deploy/compose.yaml}" "$@"
