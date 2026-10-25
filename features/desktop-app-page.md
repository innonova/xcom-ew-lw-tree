---
title: "The desktop app shown on the website: what it does, screenshots,
  download, credits"
status: done
priority: 2
dependsOn:
  - desktop-app
  - desktop-updates
---

## Purpose

Before going live (2026-10-20), the person: "the tool being hidden in the
help menu is maybe a bit on the tame side maybe we could have a tool button
that shows some information about it and some screenshots". Screenshots
with Firaxis art are fine: a screenshot of the tool in use is a derivative
illustration, not the assets distributed. They live in the repository like
any other image, made from the app on this machine (no Windows build step).
Also: credit Long War and LWR, with links.

## What a visitor sees

- On the website (not in the app), a **Desktop app** button where the app
  shows Tools. It opens a page:
  - what the app adds, each with a screenshot: putting Long War or LWR into
    the game from their own downloads and taking them out; game settings
    and items in plain terms; class colours on a 3D soldier; the game's own
    art in the research tree and the air war;
  - the download (the newest installer, its checksum), what Windows says
    while the app is not code-signed, the requirements;
  - nothing uploaded; signed updates;
  - credits and links: Long War (Long War Studios, Nexus Mods 88), Long War
    Rebalance (Nexus Mods 686), UFOpaedia; and that this is an unofficial
    fan tool, not affiliated with Firaxis or 2K, XCOM being Take-Two's
    trademark.
- The footer carries the short form of the credits and disclaimer, on every
  page, in the app too.

## Verification

- e2e: the website shows the button and the page with its screenshots and
  the download link; the app does not show the button.
- Screenshots looked at, page looked at in a wide and a narrow window.

## Report (2026-10-20)

What changed:
- On the website (not in the app) a **Desktop app** button in the header
  opens `DesktopAppView.vue`. It has:
  - a hero: the research tree shot, the download (the newest installer
    found in `desktop/` with its version, plus the checksum link) and the
    requirements;
  - the unsigned-installer note, and "signed updates, nothing uploaded";
  - six features, each with its own screenshot: versions, apply,
    soldier stats, an item card, class colours, air war;
  - Credits, linking Long War (Nexus 88), Long War Rebalance (Nexus 686)
    and UFOpaedia, with the disclaimer (Firaxis/2K, Take-Two's trademark;
    the images belong to their owners, and the app ships none).
- The footer carries the short credit and disclaimer on every view, the app
  included. Help's desktop section now points to the page.
- Screenshots: `scripts/site-shots.sh` builds the site and runs
  `e2e-desktop/site-shots.spec.ts` (LWTREE_SHOTS=1) against the Electron app
  on this machine. The app runs on a stand-in game folder made from the
  person's packages, plus a library holding the LW installer and the LWR
  zip. The script then writes `public/desktop/*.webp` (7 files, 276 KB).
  Nothing about it needs Windows, and the deploy doesn't run it: the
  images are committed like any other.
- Also in this change: the apply console now updates a step's progress in
  its own line instead of adding a line for every tick (`stepOf` in
  `ApplyConsole.vue`).

Verified:
- lint, vue-tsc, vitest (233), build, site e2e under xvfb (26 passed,
  including the new page test: the button, the screenshots, the download
  link or its absence, the credits), test:desktop (10 passed; the app shows
  no Desktop app button).
- Looked at all seven screenshots, and at the page at 1440 and 520 wide.

Open:
- The download needs an installer in the deployed `desktop/` directory.
  Staging has one; a local preview says the installer is not on this copy.
- To redo the screenshots after a UI change, run `scripts/site-shots.sh`
  on this machine. It makes the stand-in game and the library fresh from
  `samples/`, which is not in git: that is the only thing it needs from
  here.
