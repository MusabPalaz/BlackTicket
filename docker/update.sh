#!/bin/sh
# Update Black Ticket in place.
#
#   sh update.sh           # move to the tag in .env, or to the bundle's release
#   sh update.sh v1.4.0    # move to a specific tag
#
# Run through `sh`: a zip carries no execute permission, so `./update.sh`
# straight out of an unpacked bundle fails with "Permission denied".
#
# The order matters and is the whole point of this script:
#
#   1. Back up first. Prisma has no down-migrations; if a release turns out to
#      be wrong, the way back is a restore, and a backup taken after the
#      migration ran is no way back at all.
#   2. Get the new images — from the registry, or from ./images if this is an
#      installation with no route to one.
#   3. `up -d` starts the one-shot migrate service, which must exit 0 before
#      the API is allowed to start. The schema is therefore never older than
#      the code talking to it.
#
# Nothing here ever runs `prisma migrate dev`, `db push` or the seed. Those
# reset or overwrite data and have no place on a running installation.
set -eu

cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "No .env here. Copy .env.example to .env and fill it in first." >&2
  exit 1
fi

# A release that arrives as a zip names itself: package.ps1 writes its tag into
# the bundle's .env.example. The .env kept from the previous install still names
# the old one, and without this `up -d` would quietly restart the old version
# beside the freshly loaded new images.
if [ $# -eq 0 ] && [ -d ./images ] && [ -f .env.example ]; then
  bundled=$(sed -n 's/^TAG=//p' .env.example | tr -d '\r' | head -n 1)
  current=$(sed -n 's/^TAG=//p' .env | tr -d '\r' | head -n 1)
  if [ -n "$bundled" ] && [ "$bundled" != latest ] && [ "$bundled" != "$current" ]; then
    echo "This bundle is $bundled; .env named ${current:-no version}."
    set -- "$bundled"
  fi
fi

if [ $# -ge 1 ]; then
  echo "Pinning TAG=$1"
  if grep -q '^TAG=' .env; then
    sed -i "s/^TAG=.*/TAG=$1/" .env
  else
    echo "TAG=$1" >> .env
  fi
fi

echo "==> Backing up before anything changes"
docker compose run --rm backup

# Two ways in, decided by what is actually here rather than by a flag someone
# has to remember. An air-gapped server gets image tars beside this script; one
# that can reach the registry gets nothing and pulls.
if [ -d ./images ] && [ -n "$(find ./images -name '*.tar' -print -quit 2>/dev/null)" ]; then
  echo "==> Loading images from ./images (no registry needed)"
  for tar in ./images/*.tar; do
    echo "    $tar"
    docker load -i "$tar"
  done
else
  echo "==> Pulling images"
  docker compose pull
fi

echo "==> Applying migrations and restarting"
docker compose up -d

echo "==> Waiting for the API to report healthy"
i=0
while [ $i -lt 60 ]; do
  status=$(docker compose ps --format '{{.Service}} {{.Health}}' | awk '$1=="api"{print $2}')
  case "$status" in
    healthy) echo "API is healthy."; exit 0 ;;
    unhealthy) echo "API is unhealthy. Check: docker compose logs api" >&2; exit 1 ;;
  esac
  i=$((i + 1))
  sleep 5
done

echo "API did not become healthy in time. Check: docker compose logs api migrate" >&2
exit 1
