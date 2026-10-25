# Long War Tech Tree

The XCOM: Enemy Within Long War 1.0 research tree and Foundry on one screen,
at **https://xcom.innonova.ch**, and those of Long War Rebalanced 2.06 (LWR)
beside them. Load a save to see where a campaign stands;
load a `DefaultGameCore.ini` to use your own costs. Everything is read in the
browser; nothing is uploaded (the site's Content-Security-Policy does not even
allow it).

## What it does

- **Research tree:** a lane per category, every prerequisite left of what
  needs it. Hover a tech for what it still needs (blue) and what it leads to
  (pink); rest on it to open its box with costs and unlocks.
- **Foundry board:** the same for Foundry projects, each beside the tech it
  needs.
- **From a save** (geoscape or mid-mission): researched, in progress,
  available and locked; days left at the campaign's research speed, with
  research credits and campaign bonuses; Foundry projects done and being
  built; the aliens' hidden counters (Stats).
- **Air war:** a UFO against your jets in turn, from the save's hangar or
  anything you pick: the odds under each stance, what every number does,
  and the fight to play, with Aim, Dodge and Boost. In LWR the jets fly
  together as a squadron, by its own rules.
- **Two versions:** Long War 1.0 and LWR 2.06, switched in the header. LWR's
  tree, Foundry, research speed, costs, bonuses and air war are read from its
  own files the same way as Long War 1.0's.
- **Desktop app** (`desktop/`, Electron, Windows): the same site with the
  game's files in reach, and **Tools**, which only the app has. It finds the
  game the way installers do and tells Long War 1.0 from LWR. Keep your
  PatcherGUI mods and mod folders with their options, see whether each is
  installed, set DefaultGameCore.ini values by name, and apply the whole
  setup to the game in one go (after a reinstall too): a plan first, the
  originals kept in `lwtree-backup/`. The patching is our own implementation
  of PatcherGUI's format, checked byte for byte against PatchUPK
  (`features/game-tools.md`, `features/desktop-app.md`). It updates itself
  from releases this repository's workflow built and attested, signed by
  innonova's trusted-updates (`features/release-signing.md`); anyone can
  check a download with
  `gh attestation verify <file> --repo innonova/xcom-ew-lw-tree`.
- **Planner:** pick techs or Foundry projects; get the research still needed,
  in order, with time and costs.
- **Live:** in Chromium browsers, point the page at your SaveData folder
  (`Documents\My Games\XCOM - Enemy Within\XComGame\SaveData`) and it follows
  new saves as you play, checking its numbers against the game's.

## Data

- `tech.json`, `longwar_foundry.json`, `longwar_bonuses.json`: the techs,
  Foundry projects and bonuses, from the game's config and localization.
- `data/techtree.json`: prerequisites, item and UFO checks, and research
  credit rules, read from the game's compiled script (`XGTechTree`) by
  `scripts/upk_techtree.py` (with `scripts/upk_script.py`).
- `ufopaedia.json`: where UFOpaedia links each unlock, extracted from its
  Long War Research and Foundry pages by `scripts/ufopaedia_links.py`.
- `data/airwar.json`: ships, weapons and how UFOs grow, from the game's
  script and INI by `scripts/upk_airwar.py`.
- `data/lwr/`: the same for LWR 2.06, all generated from its files: techs,
  Foundry, prices and bonuses by `scripts/game_data.py`, the rules by
  `upk_techtree.py` and `upk_airwar.py`.
- `public/ships/`: pictures of the UFOs and our jets, our own models
  rendered in Blender by `scripts/ufo_art.py`.
- `data/enums.json`: Enemy Within's item, tech, Foundry, facility and
  research-credit numbering, read from the game's own script packages by
  `scripts/upk_enums.py` (the packages are not committed).
- Saves are read by a TypeScript port of
  [xcomsave](https://github.com/tracktwo/xcomsave)'s reader (`src/save/`).
- How the numbers were worked out, and what is still unconfirmed:
  `docs/design.md` and the reports in `features/`.

## Repository

- `src/save/`: reading saves (`parse.ts`) and what the app takes from them
  (`campaign.ts`).
- `src/model/`: layout, research timing, bonuses, Foundry, planner, search.
- `src/components/`, `src/state/`: the UI.
- `fixtures/saves/`: test saves (see its README), checked in.
- `samples/`: git-ignored drop folder for game files that should not be
  published (Firaxis' `DefaultGameCore.ini`, a full save history).
- `features/`: one file per unit of work, with reports.
- `deploy/`: the nginx vhost and `deploy.sh`.

## Development

```sh
npm install
npm run dev              # http://localhost:5173
npm run test:unit        # vitest
npm run type-check
npm run lint
CI=1 npx playwright test --project=chromium   # end to end, against a build
deploy/deploy.sh         # build and publish the staging copy to xcom.innonova.ch
```

## Releasing to xcom.aek.dk

The estate (`innonova/iac`) serves https://xcom.aek.dk from signed releases
of this repository:

1. Tag: `git tag -a vX.Y.Z -m … && git push origin vX.Y.Z`. The release
   workflow (`.github/workflows/release.yml`) tests, builds, packs `dist/`
   as `xcom-dist.tar.gz`, signs it keyless with cosign and publishes it.
2. In `innonova/iac`, set `xcom.aek.dk: vX.Y.Z` under `sites:` in
   `environments/dev/versions.yml` and `environments/prod/versions.yml`
   and push: dev serves it at once. Production: once the push run has
   planned, `scripts/change-request.sh` in `innonova/iac` asks for it (the
   howto's "A change into production"); a person approves in the console.
