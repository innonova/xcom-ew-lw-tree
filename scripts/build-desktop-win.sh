#!/usr/bin/env bash
# Build the desktop app's Windows installer (features/desktop-app.md): the
# site and the app here, the installer on the Windows VM (ssh win), the
# result copied back to desktop/release/. Only the app's build inputs go to
# the VM (compiled code, the built site, config, icons), not the working tree.
#
#   scripts/build-desktop-win.sh [<channel>]
#
# The app takes its updates from trusted-updates' <channel> (its update.json;
# desktop/src/keys.ts has the address). Without arguments: staging, into
# desktop/release/; any other channel goes to desktop/release/<channel>/.
# A build made here is not attested: it is for the bench. Releases are built
# by .github/workflows/release.yml.
set -euo pipefail
cd "$(dirname "$0")/.."
channel=${1:-staging}
[[ "$channel" =~ ^[a-z0-9][a-z0-9._-]{0,63}$ ]] || { echo "usage: $0 [<channel>]" >&2; exit 2; }
out=desktop/release
[[ "$channel" == staging ]] || out=desktop/release/$channel

# The base bundle must be made with copy-site.mjs (npm run site), not a plain
# copy: it stamps site/.bundle-info.json with the bundle version and leaves out
# the staging extras. A `cp -r` here shipped a base bundle with no version, so
# installed apps read their site as 0.0.0 and re-downloaded the same bundle.
(cd desktop && npm run site && npm run build)
version=$(node -p "require('./desktop/package.json').version")
target=$(mktemp -d)
printf '{ "base": "https://trusted-updates.innonova.ch", "product": "lwtree", "channel": "%s" }\n' "$channel" > "$target/update.json"
tar czf /tmp/lwtree-desktop.tgz -C desktop package.json package-lock.json electron-builder.yml build dist site -C "$target" update.json
rm -rf "$target"
scp -q /tmp/lwtree-desktop.tgz win:lwtree-desktop.tgz
ssh win 'Remove-Item -Recurse -Force lwtree-desktop -ErrorAction SilentlyContinue;
  New-Item -ItemType Directory lwtree-desktop | Out-Null;
  tar -xzf lwtree-desktop.tgz -C lwtree-desktop; cd lwtree-desktop;
  npm ci --no-audit --no-fund *> npm.log;
  npx electron-builder --win nsis *> build.log; if ($LASTEXITCODE) { Get-Content build.log -Tail 20; exit 1 }'
mkdir -p "$out"
scp -q "win:lwtree-desktop/release/LongWarTechTree-Setup-$version.exe" "$out/"
echo "built $out/LongWarTechTree-Setup-$version.exe (updates from trusted-updates, $channel)"
