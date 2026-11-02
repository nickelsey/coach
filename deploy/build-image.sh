#!/bin/sh
# Builds the API image for the NAS (linux/amd64) on this machine.
#
# Synology's kernel lacks seccomp, which Docker's builder needs for RUN steps,
# so images can't be built on the NAS. They run there fine.
#
#   ./build-image.sh                 # writes dist/coach-api.tar
#   ./build-image.sh user@nas-host   # also copies it over, loads it and
#                                    # restarts the project (asks for sudo)
#
# REMOTE_DIR overrides where the project lives on the NAS.
set -eu
cd "$(dirname "$0")"

mkdir -p dist
docker buildx build --platform linux/amd64 -t coach-api:latest \
  --output type=docker,dest=dist/coach-api.tar ../server
echo "built dist/coach-api.tar"

[ $# -eq 0 ] && exit 0

NAS=$1
REMOTE_DIR=${REMOTE_DIR:-/volume1/docker/coach/deploy}
DOCKER=/usr/local/bin/docker # not on sudo's PATH on DSM

# -O: legacy scp protocol, which works without enabling SFTP in DSM.
scp -O dist/coach-api.tar "$NAS:$REMOTE_DIR/coach-api.tar"
ssh -t "$NAS" "sudo $DOCKER load -i $REMOTE_DIR/coach-api.tar \
  && rm $REMOTE_DIR/coach-api.tar \
  && cd $REMOTE_DIR && sudo $DOCKER compose up -d"
