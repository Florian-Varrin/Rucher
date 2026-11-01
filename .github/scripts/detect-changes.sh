#!/usr/bin/env bash
# Writes carnet=true|false and cli=true|false to $GITHUB_OUTPUT from `changeset status`.
set -euo pipefail

output="${GITHUB_OUTPUT:-/dev/stdout}"

pnpm changeset status --output=changeset-status.json || true

if [ ! -s changeset-status.json ]; then
  echo "::error::No changeset status output — nothing to release on master."
  exit 1
fi

released() {
  if jq -e --arg name "$1" 'any(.releases[]; .name == $name)' changeset-status.json >/dev/null; then
    echo true
  else
    echo false
  fi
}

carnet=$(released @rucher/carnet)
cli=$(released @rucher/cli)
rm -f changeset-status.json

if [ "$carnet" != "true" ] && [ "$cli" != "true" ]; then
  echo "::error::No pending changesets — nothing to release on master."
  exit 1
fi

echo "carnet=$carnet" >> "$output"
echo "cli=$cli" >> "$output"
