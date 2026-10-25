---
title: "Going live: the desktop app in production, wherever its files are hosted"
status: done
priority: 1
dependsOn:
  - deploy
  - desktop-updates
  - desktop-app-page
---

## Purpose

The person, 2026-10-20, on going live: "i will look into some options lets
focus on preparing for it, i'm considering if maybe i should host the files
somewhere not on prem - current line is only 1G and if the LWR community is
interested that might hurt". Signing: "we can find a solution with the
existing cert and i want to set up azure signing too".

The site is already live at xcom.aek.dk: a signed release of this
repository, served by the estate (features/deploy.md). The desktop app is
not. Everything it needs from a server lives on staging, and every
installer built so far takes its updates from staging. The preparation is
for whatever the person chooses for hosting: nothing here should assume a
host.

What there is to serve, by size:
- The installer: 112 MB per download (a new player, or an update to the
  app shell itself).
- A site bundle: about 1 MB per site update, per installed app.
- The channel file (`bundle/<channel>.json`): under 1 KB, asked for every
  six hours by each running app.

## Prepared (2026-10-20)

- **An installer knows where its updates come from.**
  `scripts/build-desktop-win.sh <channel> <url>` packs an `update.json`
  into the app. The app then asks `<url>/bundle/<channel>.json` (main.ts,
  `updateTarget`). Without arguments the build is staging, as before.
  Installers for other channels go to `desktop/release/<channel>/`, so the
  staging deploy never offers one.
- **The files can live apart.** A channel file may name its bundle and its
  installer by full URL, and the shell resolves them against the update
  server (`at` in bundles.ts). `LWTREE_APP_URL` makes publish-bundle name
  the installer on another host. The next shell ships this, so every
  production shell can follow the installer if it moves.
- **One command makes a channel's files, and uploads nothing.**
  `deploy/publish-desktop.sh <channel>` writes
  `desktop/release/<channel>/publish/`:
  - `bundle/` (the channel file and the signed site bundle);
  - `app/` (the installer, LATEST, SHA256SUMS);
  - COMMIT.

  The files go up as they are, under the URL the installer was built for.
  The script refuses to run on a working tree with changes: a bundle is
  the site at a commit.

Not done, on purpose: no upload, no change to the release workflow or to
iac, no tag, no signing.

## For the person to decide

1. **Where the installer lives.** Recommended: **GitHub Releases** of this
   repository, which is public. GitHub's CDN serves it, the line carries
   nothing, it costs nothing, and the release page counts downloads. Build
   with `LWTREE_APP_URL=https://github.com/aek-innonova/xcom-ew-lw-tree/releases/download/<tag>`
   and upload `app/*` there (`gh release upload`). Any other static host
   or CDN works the same way.
2. **Where the channel file and the bundles live.** They are small, so
   they can sit with the site on xcom.aek.dk. But the site there is built
   by the release workflow, and the bundle signing key stays on this
   machine. The ways to bring the two together:
   - **(a)** The workflow takes `bundle/` and `app/LATEST` from a release
     asset uploaded from here (`publish-desktop.sh`'s output as a
     tarball), and packs them into the site it signs. The key stays here.
     This is my recommendation.
   - **(b)** The key goes into a GitHub Actions secret and the workflow
     signs. Simpler, but the key leaves this machine.
   - **(c)** A separate host for all the desktop files. The installer is
     then built for that URL, and the site needs a build-time link to the
     download: the site's CSP (`connect-src 'self'`) does not let it read
     `LATEST` from another origin.
3. **Signing.** The app's own updates are checked against our Ed25519 key
   whatever Authenticode says, so Authenticode is only about Windows'
   warning on the first download. Site updates never need it; only a new
   shell installer does, a few times a year.
   - **The existing certificate** is EV, on a USB key with a PIN for every
     signature (the person, 2026-10-20). electron-builder's own signing
     signs every exe in the build (the app, the uninstaller, the installer)
     on the build machine, so it does not fit. Instead, signing is a step
     by hand, on the machine the key is plugged into:
     build (unsigned) → sign the installer with signtool, timestamped
     (one PIN) → `publish-desktop.sh`.
     The order matters: publish signs the installer's exact bytes with our
     key, so an Authenticode signature added afterwards would make every
     app refuse the update. The installed app's own exe can stay
     unsigned: SmartScreen judges the downloaded installer, and the
     shell's self-update downloads carry no web mark.
   - **Azure Trusted Signing** (`win.azureSignOptions` in electron-builder
     26; credentials in the environment, never in the repository) signs
     every exe with no key to plug in, from the Windows VM or a workflow.
     It replaces the hand step once it is set up.
4. **The first production shell.** A version above the staging line (0.4.0)
   built with `production https://<host>`. Staging installs, the bench's
   included, stay on staging: nothing moves an app between channels, so a
   staging app moves to production only by installing the production
   installer.

## Report (2026-10-20)

Changed: `desktop/src/main.ts` (`updateTarget`), `desktop/src/bundles.ts`
(`at`), `desktop/electron-builder.yml` (packs `update.json`),
`scripts/build-desktop-win.sh` (channel and URL),
`scripts/publish-bundle.mjs` (`LWTREE_APP_URL`), and the new
`deploy/publish-desktop.sh`.

Verified:
- desktop unit tests (20, one new: names resolved under the server or by
  full URL);
- e2e-desktop, with a new test: an app built with an `update.json` naming a
  server and the channel "production" asks that server for
  `bundle/production.json` and offers its bundle, without the test's
  environment overrides. Before this change, such a build would have asked
  staging.
- `publish-desktop.sh` rehearsed on a throwaway channel ("rehearsal",
  with the 0.3.6 installer, and `LWTREE_APP_URL` set to a GitHub
  releases URL). It wrote the channel file naming the installer by that
  full URL, signed, with its size and sha256. The bundle (1.0 MB), the
  installer, LATEST, SHA256SUMS and COMMIT came out under
  `publish/`, and `dist/` was left without them. Afterwards the rehearsal
  folder was removed; nothing was uploaded.

Left open:
- the four decisions above;
- shells up to 0.3.6 join a channel file's names onto the server
  themselves, so the staging channel keeps naming its installer relative
  to the server until those installs are gone. A production channel
  starts with the new shell and is free of this.

## Report (2026-10-21, signing with Azure Artifact Signing)

The person: Azure Artifact Signing is set up with federated credentials for
a GitHub Action running in the "production" environment.

`.github/workflows/desktop.yml`, run by hand with a channel and an update
URL (staging and xcom.innonova.ch by default):
- on a Windows runner, in the "production" environment (limited to main);
  it writes the app's `update.json`, builds the site and the app as
  `scripts/build-desktop-win.sh` does;
- `azure/login` with the federated credential (OIDC, no secret);
- electron-builder with `azureSignOptions` (Microsoft's TrustedSigning
  module, authenticated through the logged-in Azure CLI) signs the app's
  exe, the uninstaller and the installer, with an RFC 3161 timestamp;
- a check that every exe's Authenticode signature is valid;
- the installer as the run's artifact.

Our Ed25519 signature stays on this machine and comes after: download the
artifact into desktop/release/ (or desktop/release/<channel>/), then
deploy.sh or publish-desktop.sh as before.

Needed before the first run, as variables of the "production" environment
(none secret): AZURE_CLIENT_ID, AZURE_TENANT_ID, optionally
AZURE_SUBSCRIPTION_ID, SIGNING_ENDPOINT, SIGNING_ACCOUNT, SIGNING_PROFILE.

## Report (2026-10-21, the first signed shell)

The action signs: after the role on the signing account was in place, run
39646782012 and then 39647405738 (shell 0.3.7) came out Valid, signed by
CN=innonova GmbH (issuer Microsoft ID Verified CS EOC CA 03), timestamped by
Microsoft Public RSA Time Stamping Authority.

The workflow needed three fixes on the way:
- log in without a subscription: the app registration sees none, and
  signing needs none;
- read the Azure ids from the environment's secrets;
- pass the publisher name electron-builder's schema requires
  (`SIGNING_PUBLISHER`, set to "innonova GmbH").

Shell 0.3.7 is the first signed one. It has the build's update target and
whole-URL file names (above). It is on staging, with our Ed25519 signature
added here over the signed bytes.

Bench (winbench, the person's install):
- **The update:** 0.3.6 → 0.3.7 through the app in about 22 s, no
  prompts.
- **Signatures:** the installed exe, the uninstaller and the downloaded
  installer are Valid. The website's installer is byte-identical to the
  one the app downloaded.
- **SmartScreen:** a download from the site, double-clicked, still gets
  "Windows protected your PC". The certificate is new and has no
  reputation yet, and "More info" names innonova GmbH. The desktop page
  now says so instead of "not code-signed".
- **The certificate:** valid to 24.10.2026, as Artifact Signing's
  certificates are short-lived; the timestamp keeps the signatures valid
  after that.
