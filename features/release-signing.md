---
title: "Signing the desktop app's updates without a key anyone holds: attested builds, signed by the estate's trusted-updates"
status: review
priority: 2
dependsOn: [production, desktop-updates]
---

## Purpose

The person, 2026-10-23, on putting the desktop app into production: "the
electron app could download from github but what about the electron
updates, and the bundle updates?". Then, on the update key:
- "would it make sense to have it as a secret on github so the build can
  happen on push to main or some such?";
- "if a push to main signs then it signs where the key is seems not to
  matter much?";
- "if we want to take this seriously we need some signing infrastructure,
  also would it make sense to put github attestation into play?";
- "we could put the signature on a hash in the update information file
  keeping the attested bytes clean" (agreed: "go for it");
- "do we actually want to host the channel file on github?" (no: in the
  estate, under a name the person owns);
- "how do we actually design the signer so that we might reuse it for other
  apps and not as bespoke for this one, do we register repos with it and
  have it listen for something on the bus and then host something for each
  repo perhaps like trust.innonova.ch/reponame/something, it could also
  expose public keys and a revocation list";
- on TUF: "i think i prefer our own, taking on a complex dependency for
  something that critical, and the whole client thing is overrated it is
  literally fetch a url check a signature not rocket science". Decided: our
  own format, kept small.
- 2026-10-24: "if you look at the estate doc you will see that a trusted
  update service along the lines of what we discussed now exists - we will
  want to move the repo from my personal github to innonova". The estate's
  **trusted-updates** (`innonova/trusted-updates`) is that service, with
  its own small format; this app is its first product, `lwtree`. The
  proposal this file pointed to (`docs/trust-service.md`) is superseded and
  removed.

Every installed app runs whatever our update key signs: a bundle is site
code with the game's files and the player's library in reach, and a shell
update is an installer it executes. Whoever can get something signed can
run code on every player's PC. Players should be able to rely on this:
- an update reaches them only if it was built from this repository by its
  workflow, and a person released it;
- no copy of the key exists anywhere to be stolen;
- a compromised GitHub account cannot ship to them;
- anyone can check where a download came from.

Releasing should still be easy: staging on every push to main, production
on one approval.

## Facts (2026-10-25)

- **trusted-updates** (`https://trusted-updates.innonova.ch`, its
  `docs/products.md` and `docs/format.md` §5 and §6) publishes per product
  a `keys.json` signed by a root key (`root.aek.1`, `root.djm.1`) and per
  channel a signed channel file naming the current artifacts (URL, size,
  SHA-256, version) and what was revoked. It signs a build only when the
  product's own workflow attested it (actions/attest) together with a
  manifest, `trusted-updates.json`, on a GitHub release. Tester channels
  sign at once; end-user channels after a person approves in its admin UI.
  Channel files are re-signed weekly and hold for 30 days.
- **lwtree** is registered: `keys.json` version 2 (`lwtree.production.1`,
  `lwtree.testers.1`), `production.json` signed and empty. Its registration
  names the repository `innonova/xcom-ew-lw-tree`: the repository moves
  there from `aek-innonova` (the person; the Azure federated credential
  already expects the innonova organisation).
- **The website** (xcom.aek.dk) is a release of `release.yml` on tags `v*`,
  verified by the estate's web host against
  `https://github.com/<repo>/.github/workflows/release.yml@refs/tags/<tag>`
  (iac `sites/xcom.aek.dk.yml`, `ansible/roles/release/tasks/fetch.yml`).
- **Shells up to 0.3.7** read the old channel file,
  `xcom.innonova.ch/bundle/staging.json`, with bundles and installers
  signed by `lwtree-1` (`deploy/deploy.sh`, `scripts/publish-bundle.mjs`).

## Requirements

- **The app (shell 0.4.0)** knows trusted-updates' address, its product, its
  channel (`update.json`, written by the build), the two root keys and the
  `keys.json` version current when it was built (`desktop/src/keys.ts`),
  and nothing else about trust. Its check is format.md §5
  (`desktop/src/trusted.ts`), run against trusted-updates' test vectors
  (copied at tag v0.3.1, `desktop/test-vectors/trusted-updates/`):
  - for the bundle and the shell, an offer is taken when newer, or as a
    move when what it runs was revoked (it moves off, older or not);
  - every download is checked for size and SHA-256 before it is used;
  - what it learned (the `keys.json` version, the channel file's `issued`)
    is kept, so nothing older is taken later;
  - a check that cannot complete is said in Help ("Couldn't confirm this
    app is up to date (reason)."), and the app goes on with what it has.
- **The bundle is a plain file**, `bundle-<version>.json`: what the build
  made is what is attested and published. No signature of ours in it.
- **Releasing** (`.github/workflows/release.yml`), on GitHub-hosted runners:
  - a push to main: a prerelease `build-<run>` with the bundle, and a
    staging installer when no release has that shell version yet, for the
    `staging` channel (testers, signed at once);
  - a tag `v*`: the release `v*`, with the website's tarball (as before), the
    bundle and a production installer, for `production` (signed once a
    person approves);
  - the installer is Azure-signed before it is attested; the manifest and
    the files it names are attested in the same run.
  An installer's `update.json` names its channel, so a tag's installer is
  never offered on staging (it would move a tester's app to production).
  No key or signing secret in GitHub, none on any machine of ours.
- **The website's download page**, on a release, links the installer on
  that GitHub release and the release's page ("where it came from"); its
  CSP does not let it read another origin, so the link is built in.
- **Anyone can check a download**:
  `gh attestation verify <file> --repo innonova/xcom-ew-lw-tree`.
- **Shells up to 0.3.7** are moved over once: the staging 0.4.0 installer
  offered on the old channel file, signed with `lwtree-1`. Then `lwtree-1`,
  `publish-bundle.mjs` and the old channel file are retired.

## Verification

- The client against all of trusted-updates' vectors (cases and file
  checks).
- The store (`desktop/src/bundles.test.ts`) against a trusted-updates in
  miniature: a newer bundle installed and served after a restart; nothing
  older, equal or for a newer shell; a download that is not the one named;
  a channel file signed by a key `keys.json` does not vouch for, and no
  service at all, both said; a needed shell fetched and checked; moving
  off a revoked bundle to an older one; rollback of a bundle that never
  reports good.
- The app (`e2e-desktop/updates.spec.ts`), over https against a local
  trusted-updates: the same, seen in Help, and a build taking its service,
  product and channel from `update.json`.
- On staging, end to end: push to main, the attested release, trusted-updates
  signs `staging.json`, the bench's app installs 0.4.0 and updates to the
  next bundle; `gh attestation verify` on a downloaded installer and bundle.
- On production: a tag, the person's approval, `production.json` names it.

## Open questions

- Whether the app should also install older releases (a rollback by the
  player): trusted-updates' `older/` vectors and history are there for it.
  Not now.

## Report (2026-10-25)

**Done, in this repository, not pushed yet** (the repository has not moved;
a push to main now would start a release that Azure refuses):

- `desktop/src/trusted.ts`: the client, format.md §5. 58 of 58 vectors.
- `desktop/src/bundles.ts`: the store on trusted-updates. Kinds `bundle`
  and `shell`; the installed bundle's SHA-256 is kept, so a revocation of
  that exact build is seen; a rejection sets `unconfirmed` and is said in
  Help (`UpdatePanel.vue`) without "The last check failed:" in front.
  `desktop/src/keys.ts`: the root keys, `keys.json` version 2, staging by
  default. `main.ts`: `update.json` is `{ base, product, channel }`; tests
  set `LWTREE_UPDATE_URL`, `_CHANNEL`, `_ROOT_KEYS`, `_KEYS_VERSION`.
- A real bug found by the new tests, older than this work: `activate()`
  wrote the store's config without waiting, so a `good()` right after
  could leave the file half of each and the next start served the base.
  Writes now go one at a time.
- `.github/workflows/release.yml`: website and desktop releases from one
  workflow (plan, site, installer, release jobs), as the Requirements say.
  `desktop.yml` (the manual installer build) is gone; `scripts/build-bundle.mjs`
  writes the plain bundle. The production environment now admits tags `v*`
  beside main (set on GitHub; it moves with the repository).
- The shell is 0.4.0. `scripts/build-desktop-win.sh [<channel>]` writes the
  new `update.json` (bench builds, not attested).
- The download page: `VITE_LWTREE_INSTALLER`, set by the release build on
  tags; staging (`deploy.sh`) keeps `app/LATEST`.

**Verified**: the desktop suite, 79 Node tests and 14 Electron tests
(Linux, xvfb), among them the four update tests over https with a test
certificate (`e2e-desktop/fixtures/`, not a secret); the site's 259 unit
tests and type check; the workflow's manifest step run locally; a release
build of the site carries the installer link.

**Not verified yet**: the workflow itself (it runs first after the move),
trusted-updates signing our build, the bench's app updating through it, and
the Windows run of the suite.

**After the move** (mine): the remotes here and on win; push; watch the first
staging release and its signing; install 0.4.0 on the bench and see it take
the next bundle; then the 0.3.7 move-over on the old channel. Then a tag
(`v1.1.0`) for production: the person approves it in trusted-updates, and
iac's `sites/xcom.aek.dk.yml` changes to `repo: innonova/xcom-ew-lw-tree`
with the versions bump in the same change: the host verifies a release
against the repository it is told, so the new name cannot serve v1.0.1,
which was signed under `aek-innonova`.

## Report (2026-10-25, after the move)

- The repository is `innonova/xcom-ew-lw-tree`; the remotes here and on win
  follow it.
- The first run failed in CI: `setup.spec.ts` read the git-ignored samples
  while its tests were collected (a skipped suite's body still runs). Fixed;
  the unit tests pass without the samples (197, 57 skipped) and with them
  (259).
- build-4 was refused by trusted-updates: lwtree's registration still named
  `aek-innonova`. The service matches a repository by id and refuses a new
  name until a person confirms it (a released name can be taken). Fixed on
  its side; a refusal is final, so build-5 was dispatched by hand.
- **build-5 is signed**: `lwtree/staging.json` (key `lwtree.testers.1`, issued
  15:16:03, valid to 2026-11-24) names bundle 2026.1025.150228 and shell
  0.4.0 on the release. Our client (`desktop/dist/trusted.js`) with only the
  built-in root keys accepts it and the download's size and hash;
  `gh attestation verify` passes; trusted-updates' session checked the same
  with its reference client, and the channel file's timestamp.
- **The move-over from 0.3.7, on the bench**: `deploy/deploy.sh` offered
  build-5's installer (the same bytes trusted-updates signed) on the old
  channel file, signed with `lwtree-1`. The bench's 0.3.7 took the bundle
  and fetched and checked `shell-0.4.0.exe`; run as the app runs it
  (`/S --force-run`, from the desktop session), it installed 0.4.0
  (Authenticode valid), which started, checked trusted-updates and kept its
  state (`keys_version` 2, the channel file's `issued`).
- **The first update from trusted-updates**: a push to main made build-6, a
  bundle alone; trusted-updates signed it at 15:23:26, the channel file
  keeping build-5's shell (kinds version independently). The bench's 0.4.0,
  restarted, took bundle 2026.1025.152209 for its next start, with its
  SHA-256 kept, and tidied the 0.3.7-era files away. (Seen in the app's
  store; a screenshot showed only the terminal the capture ran in, over the
  app.)
- Pushes that change only notes (`features/`, `docs/`, `*.md`) no longer make
  a staging release: each one is an update every tester's app downloads.

**Left:** production. A tag `v1.1.0` releases the website and the desktop
app's production channel together; it needs the person twice: the approval
in trusted-updates' admin UI, and iac's production apply of
`sites/xcom.aek.dk.yml` (`repo: innonova/xcom-ew-lw-tree`) with the version
bump, which I push to iac once the tag's release exists. Then the old
staging channel file and `lwtree-1` retire (`publish-bundle.mjs`, the
legacy half of `deploy.sh`, `bundle-format.ts`'s signing).

## Report (2026-10-25, production)

- Tag `v1.1.0`: one release with the website's tarball (cosign, the innonova
  identity), the bundle 2026.1025.152547, the production installer 0.4.0 and
  the manifest for `production`. The person approved it in trusted-updates;
  `lwtree/production.json` (issued 15:47:38) names both. Our client, with
  only the built-in root keys, accepts it (an app on that bundle and shell:
  nothing to do).
- iac `b1a0b49`: `sites/xcom.aek.dk.yml` names `innonova/xcom-ew-lw-tree`,
  dev and prod at v1.1.0. Dev looked at from the seat (headers, the files,
  the download page in a browser through it); change request
  innonova/iac#209, applied. https://xcom.aek.dk/ serves v1.1.0, its
  download page linking the v1.1.0 installer on GitHub.
- Not done: the old staging channel file and `lwtree-1` still exist
  (`publish-bundle.mjs`, the legacy half of `deploy.sh`, the signing half of
  `bundle-format.ts`). The bench, the only 0.3.7 we know of, has moved;
  retiring them is a small change for when the person says no other 0.3.x
  is out there.
