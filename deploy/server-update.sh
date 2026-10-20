#!/usr/bin/env bash
# Updates the server to the latest main and rebuilds the stack.
#
# Called by .github/workflows/deploy.yml through a restricted SSH key: in
# ~/.ssh/authorized_keys the deploy key may run this script and nothing else
# (see deploy/README.md, "פריסה אוטומטית"). Can also be run by hand.
#
# The whole body is inside main() so bash has read all of it before `git merge`
# replaces this file on disk.
set -euo pipefail

main() {
  cd "$HOME/finalProject"

  # One deploy at a time: two merges in a row must not build on top of each other.
  exec 9>/tmp/foresite-deploy.lock
  flock -n 9 || { echo "another deploy is already running"; exit 1; }

  local compose="docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml"

  git fetch --quiet origin main
  local before after
  before=$(git rev-parse --short HEAD)
  # --ff-only: if someone changed files on the server by hand, stop instead of merging.
  git merge --ff-only --quiet origin/main
  after=$(git rev-parse --short HEAD)
  echo "deploy: $before -> $after"

  $compose up -d --build --remove-orphans

  # The backend answers 401 on /projects without a token once it is up.
  local ok=0
  for _ in $(seq 1 45); do
    if $compose exec -T backend node -e \
      "fetch('http://localhost:3000/projects').then(r=>process.exit(r.status===401?0:1)).catch(()=>process.exit(1))" \
      >/dev/null 2>&1; then
      ok=1
      break
    fi
    sleep 2
  done
  $compose ps
  if [ "$ok" -ne 1 ]; then
    echo "deploy: the backend did not come up - see: $compose logs backend --tail 50"
    exit 1
  fi

  docker image prune -f >/dev/null   # old images from earlier builds
  echo "deploy: done ($after)"
}

main "$@"
exit
