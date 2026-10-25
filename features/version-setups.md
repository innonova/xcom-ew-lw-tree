---
title: Each game version its own setup; the version chosen with buttons; LWR's
  colours its own
status: done
priority: 1
dependsOn:
  - game-setups
  - game-bases
  - game-soldiers
---

## Purpose

The person, 2026-10-21: "maybe the different game versions should have their
own configuration bringing over the config from a LW game to an LWR game
isn't really a well defined action... the color selector just doesn't make
sense for LWR that seems to be a much more thought through element of LWR
... we should just not show the color picker for LWR ... switching between
the game types should be buttons rather than a radio selector, it is a
rather significant action and maybe the UX should reflect that".

Agreed in the conversation:
- Every version (plain Enemy Within, Long War, LWR) keeps its own setup:
  - which mods are ticked, their options and their order;
  - the INI lines;
  - the game settings;
  - the saved setups.

  Choosing a version means choosing its setup. Nothing carries over by
  itself.
- The version is chosen with buttons at the top of Tools, before the saved
  setups, since the setups now belong to a version. The one in the game is
  marked as such. No confirmation, because nothing is written until Apply,
  and Apply says plainly when it replaces the version in the game.
- "Leave it as it is installed" goes. The installed version is the one
  chosen until the player chooses another. If the library cannot put a
  version in, it can still be chosen when it is the one installed, and
  then the setup goes on top of the game as it is.
- LWR: the class colours are LWR's own (its mutator sets them at the first
  promotion and for some perks), shown and not edited. LWR's option
  that hands the colours back to the INI is not offered on that card;
  it can still be set as a raw INI line. Headgear and the rookie's look
  stay editable: LWR leaves them to the INI. The soldier can be shown in
  a perk's colour.

## Migration

`settings.json` gets `versions: { ew, lw, lwr }`, each holding `order`,
`mods`, `ini`, `game`, `setups` and `setupFrom`, plus `base`, the version
chosen.

An older file moves over like this:
- its mods, order and INI lines go to the version it had chosen, or to the
  version installed if it said "as installed";
- each saved setup goes to the version it was saved with, keeping only that
  version's game settings;
- each version keeps its game settings;
- the other versions start with no mods ticked.

A mod already in the game is ticked by itself only in the setup of the
version that is installed.

## Verification

- Unit: the migration (a 0.3 file with each `base`, setups with their
  versions); switching versions keeps each one's choices apart.
- Desktop e2e: switching with the buttons shows each version's own mods and
  settings and its saved setups; Apply on another version says that it
  replaces the version in the game; in LWR the class colours cannot be
  edited, while headgear can.
- Screenshots looked at; the site's screenshots made again.
- On the bench: an existing settings.json from the person's install
  migrates, and applying changes nothing that was not asked for.

## Report (2026-10-21)

What changed:
- **Settings:** `settings.json` keeps `versions: { ew, lw, lwr }`
  (`VersionSetup` in `state/library.ts`) and `base`, the version chosen.
  `fromShared` moves an older file over as described above, and runs once
  when the file is read. When the old file said "as installed", the app
  lists the game's packages to see which version that is.
- **State (`state/tools.ts`):**
  - `tools.base` is a version, or null for the one installed. `setupOf()`
    is the chosen version's setup, and `showVersion()` puts it on the page:
    each mod as ticked for that version, in its order, plus its INI lines,
    game settings and saved setups.
  - `setBase` switches. Saving, using, deleting and "back to what the game
    has" all work on the version's own setups; "back to what the game has"
    also switches to the version installed.
  - The plan puts the version in from the library when it can. When it
    can't, it goes on top of the game as it is, which only works for the
    version installed (`canChoose`).
  - A mod found in the game is ticked by itself only in the installed
    version's setup.
  - The suggested name for a saved setup no longer starts with the version
    ("2 mods · 14 settings").
- **Page:**
  - Three version buttons head the setup bar ("Version in the game"). Each
    shows its name and either "in the game", "from your library" or what it
    needs. The chosen one is highlighted and pressed.
  - The radios and "Leave it as it is installed" are gone. The old section
    now only lists the Long War and LWR downloads.
  - On another version than the installed one, the Apply button reads
    "Switch the game to …", and the console begins with "This replaces X in
    the game with Y, under its own setup."
- **LWR colours (`SoldierLooks.vue`):** in LWR the class colours are always
  LWR's own and read-only. Each class lists its perk colours as buttons that
  show that colour on the soldier. LWR's option to hand the colours back to
  the INI is left off the card. LWR's script was checked
  (`RebalanceMutator`): it sets only the armour tint, so headgear and the
  rookie's look stay editable.
- **Site:** the page's versions and apply screenshots were made again: the
  buttons, and a switch to LWR. `scripts/site-shots.sh` now hard-links the
  stand-in game's packages. The app's folder listing passes over symbolic
  links, so the earlier shots had taken that game for plain Enemy Within.

Verified:
- Unit tests: 235, including two for the migration: shared choices go to
  the chosen version, each saved setup to its own version, and "as
  installed" to the version installed.
- Desktop e2e (13). New:
  - each version keeps its own mods ticked and its own saved setups
    across switches, also as stored in `settings.json`;
  - switching is said on Apply's button and in the plan;
  - in LWR the class colours are LWR's own and not editable, a perk's
    colour shows on request, the option is off the card, and headgear
    stays editable.

  Updated for the new shape: an old-format `settings.json` migrates
  end to end in the game-settings test.
- Site e2e: 26 passed. Shell unit tests: 20 passed. Lint, vue-tsc and the
  build are clean.
- Looked at: the bar, the switch console, and the LWR colour card with
  the soldier, from the real packages.

Bench (2026-10-21, winbench, the person's install, site 2026.1021.055651):
- **The file before:** `base: ew`, six mods with none ticked, no INI
  lines, the person's 14 game values under Long War, and no saved setups.
- **After the migration:** the mods and their order went to plain Enemy
  Within, the version that file had chosen. Long War kept its 14 values
  unchanged, and LWR started empty. Nothing was lost or put in the wrong
  version. With no saved setups on the bench, that part was tested only
  by the unit tests.
- **Buttons:** plain Enemy Within was pressed and "in the game"; the other
  two showed "from your library". Switching between versions brought each
  one's choices back unchanged.
- **Plans** (all cancelled, nothing written):
  - plain Enemy Within: "Nothing to change";
  - Long War: begins "This replaces plain Enemy Within in the game with
    Long War 1.0", then its 14 settings;
  - LWR: the same opening, then 474 files.
- **LWR card:** as specified. A perk click showed its colour on the soldier
  (Scout, Hit and Run: pink).
- **Afterwards:** the game was still Steam's Enemy Within byte for byte,
  and the copy of the old `settings.json` was left beside the new one.

Found by the bench, and fixed: the migrated file was only written at the
player's first change, so the old shape stayed on disk and was migrated
again at every start. Now it is written at once (`readSettings` says
`moved`), and the game-settings e2e checks the file's new shape before
anything is changed.

Noted, left as it is: the header's version picker is the version the site
shows (it follows the install), separate from the version chosen in Tools.

## Report (2026-10-21, note a4510)

The person's note: after switching between LWR and Long War, "The game's file
differs from Long War Rebalanced 2.06.00's own in 792 settings, edited by
hand…" grew too long to be any use. The comparison ran against the chosen
version's own file even when another version was in the game, so every
difference between Long War and LWR counted as a hand edit. Hand edits are
now looked for only when the chosen version is the one in the game.

Verified with `scripts/site-shots.sh` on the real packages: it chooses LWR
over the Long War in the game, after a plan has unpacked LWR, and finds no
hand-edits list. Without the fix, the same run fails there.
