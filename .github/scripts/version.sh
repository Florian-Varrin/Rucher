#!/usr/bin/env bash
# Expects CARNET_BUMPED and CLI_BUMPED (true|false), and RELEASE_CHANNEL stable (default) or beta;
# writes carnet_version and cli_version to $GITHUB_OUTPUT.
set -euo pipefail

output="${GITHUB_OUTPUT:-/dev/stdout}"
channel="${RELEASE_CHANNEL:-stable}"

in_pre_mode() {
  [ -f .changeset/pre.json ] && [ "$(jq -r .mode .changeset/pre.json)" = "pre" ]
}

# A beta line lives in Changesets pre mode on staging; merging it into master must end it there.
case "$channel" in
  beta) in_pre_mode || pnpm changeset pre enter beta ;;
  stable) if in_pre_mode; then pnpm changeset pre exit; fi ;;
  *)
    echo "::error::unknown RELEASE_CHANNEL $channel"
    exit 1
    ;;
esac

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

check_channel() {
  case "$channel:$1" in
    stable:*-*)
      echo "::error::prerelease version $1 — refusing to publish to stable"
      exit 1
      ;;
    beta:*-beta.*) ;;
    beta:*)
      echo "::error::version $1 is not a beta — refusing to publish to the beta channel"
      exit 1
      ;;
  esac
}
# Stable checks every package; a beta only what it bumps, since the other keeps its stable version.
if [ "$channel" = "stable" ] || [ "${CARNET_BUMPED:-false}" = "true" ]; then check_channel "$carnet_version"; fi
if [ "$channel" = "stable" ] || [ "${CLI_BUMPED:-false}" = "true" ]; then check_channel "$cli_version"; fi

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
