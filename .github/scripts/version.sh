#!/usr/bin/env bash
# Expects CARNET_BUMPED and CLI_BUMPED (true|false); writes carnet_version and cli_version to $GITHUB_OUTPUT.
set -euo pipefail

output="${GITHUB_OUTPUT:-/dev/stdout}"

pnpm changeset version

carnet_version=$(jq -r .version packages/carnet/package.json)
cli_version=$(jq -r .version packages/cli/package.json)

# The plugin has no code of its own: it ships with the CLI it runs.
set_json() {
  jq --arg version "$cli_version" "$2" "$1" > "$1.next"
  mv "$1.next" "$1"
}
set_json plugin/.claude-plugin/plugin.json '.version = $version'
set_json .claude-plugin/marketplace.json '(.plugins[] | select(.name == "rucher") | .version) = $version'

# changeset and jq rewrite files in their own style; the bump commit must pass `vp check`.
pnpm exec vp fmt

for version in "$carnet_version" "$cli_version"; do
  case "$version" in
    *-*)
      echo "::error::prerelease version $version — refusing to publish to stable"
      exit 1
      ;;
  esac
done

check_tag() {
  if git rev-parse -q --verify "refs/tags/$1" >/dev/null; then
    echo "::error::tag $1 already exists — this version was already released"
    exit 1
  fi
}
if [ "${CARNET_BUMPED:-false}" = "true" ]; then check_tag "carnet-v$carnet_version"; fi
if [ "${CLI_BUMPED:-false}" = "true" ]; then check_tag "cli-v$cli_version"; fi

git add -A
git diff --cached --binary > version-bump.patch
git reset -q
if [ ! -s version-bump.patch ]; then
  echo "::error::changeset version produced no diff"
  exit 1
fi

echo "carnet_version=$carnet_version" >> "$output"
echo "cli_version=$cli_version" >> "$output"
