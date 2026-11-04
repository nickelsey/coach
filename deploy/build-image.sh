#!/bin/sh
# Builds the API image for the NAS (linux/amd64) on this machine.
#
# Synology's kernel lacks seccomp, which Docker's builder needs for RUN steps,
# so images can't be built on the NAS. They run there fine.
#
#   ./build-image.sh                 # writes dist/coach-api.tar
#   ./build-image.sh user@nas-host   # also copies it and the deploy files over,
#                                    # backs up the database, loads the image
#                                    # and restarts the project (asks for sudo)
#
# If the backup fails, nothing is deployed. REMOTE_DIR and BACKUP_DIR override
# where the project and its backups live on the NAS.
set -eu
cd "$(dirname "$0")"

mkdir -p dist
docker buildx build --platform linux/amd64 -t coach-api:latest \
  --output type=docker,dest=dist/coach-api.tar ../server
echo "built dist/coach-api.tar"

[ $# -eq 0 ] && exit 0

NAS=$1
REMOTE_DIR=${REMOTE_DIR:-/volume1/docker/coach/deploy}
BACKUP_DIR=${BACKUP_DIR:-/volume1/backups/coach}
DOCKER=/usr/local/bin/docker # not on sudo's PATH on DSM

# -O: legacy scp protocol, which works without enabling SFTP in DSM.
scp -O dist/coach-api.tar compose.yaml serve.json backup.sh restore-check.sh "$NAS:$REMOTE_DIR/"
ssh "$NAS" "mkdir -p $REMOTE_DIR/sql"
scp -O sql/*.sql "$NAS:$REMOTE_DIR/sql/"
# The very first deploy has no database to back up yet.
ssh -t "$NAS" "set -e; cd $REMOTE_DIR
  if sudo $DOCKER ps --format '{{.Names}}' | grep -qx coach-db; then
    sudo sh backup.sh $BACKUP_DIR
  else
    echo 'no running database, skipping the backup'
  fi
  sudo $DOCKER load -i coach-api.tar
  rm coach-api.tar
  sudo $DOCKER compose up -d"
