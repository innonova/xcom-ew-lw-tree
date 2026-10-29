#!/usr/bin/env bash
# Build the site and publish it to xcom.innonova.ch (nginx on www, /srv/xcom).
# Usage: deploy/deploy.sh [--skip-build]
#
# Its download page links the newest staging installer on GitHub (a prerelease
# of .github/workflows/release.yml), as a release's site links its own. The
# desktop app's updates do not come from here: trusted-updates signs them
# (features/release-signing.md).
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "${1:-}" != "--skip-build" ]]; then
  repo=innonova/xcom-ew-lw-tree
  installer=$(gh api "repos/$repo/releases?per_page=30" --jq \
    '[.[] | select(.prerelease) | .tag_name as $t | .assets[] | select(.name | test("^LongWarTechTree-Setup-.*\\.exe$")) | "\($t)/\(.name)"][0] // empty' || true)
  [[ -n "$installer" ]] && export VITE_LWTREE_INSTALLER="https://github.com/$repo/releases/download/$installer"
  echo "installer: ${VITE_LWTREE_INSTALLER:-none}"
  npm run build
fi

# --delete-after keeps the old assets in place until the new index.html is up.
rsync -rlt --delete-after --chmod=D755,F644 dist/ www:/srv/xcom/
echo "published: https://xcom.innonova.ch"
