#!/usr/bin/env bash
# Writes carnet=true|false and cli=true|false to $GITHUB_OUTPUT from `changeset status`.
set -euo pipefail

output="${GITHUB_OUTPUT:-/dev/stdout}"
branch="${RELEASE_BRANCH:-master}"

in_pre_mode() {
  [ -f .changeset/pre.json ] && [ "$(jq -r .mode .changeset/pre.json)" = "pre" ]
}

pnpm changeset status --output=changeset-status.json || true

if [ ! -s changeset-status.json ] && ! { [ "$branch" = "master" ] && in_pre_mode; }; then
  echo "::error::No changeset status output — nothing to release on $branch."
  exit 1
fi

# Leaving pre mode on master releases every package still on a beta version, even when its
# changesets were already used by the betas and changeset status no longer lists them.
released() {
  if [ -s changeset-status.json ] &&
    jq -e --arg name "$1" 'any(.releases[]; .name == $name)' changeset-status.json >/dev/null; then
    echo true
  elif [ "$branch" = "master" ] && in_pre_mode && jq -r .version "$2" | grep -q -- '-'; then
    echo true
  else
    echo false
  fi
}

carnet=$(released @rucher/carnet packages/carnet/package.json)
cli=$(released @rucher/cli packages/cli/package.json)
rm -f changeset-status.json

if [ "$carnet" != "true" ] && [ "$cli" != "true" ]; then
  echo "::error::No pending changesets — nothing to release on $branch."
  exit 1
fi

echo "carnet=$carnet" >> "$output"
echo "cli=$cli" >> "$output"
