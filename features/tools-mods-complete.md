---
title: "Tools: mods that bring data files, and mods on packages the game ships
  compressed"
status: done
priority: 2
dependsOn:
  - game-tools
  - upkit-apply
---

## Purpose

The person, 2026-10-22, after upkit-apply: "yeah go ahead with the site". Two
gaps upkit-apply left on the Tools page:

- **Mods that bring data files.** The engine takes `MODDED_FILE` and
  `BULK_FILE` now, but the page gives it no files, so such a mod reads
  "does not fit".
- **Packages the game ships compressed.** Plain Enemy Within's XComGame.upk
  is compressed whole, and its seek-free packages in chunks. The page
  refuses those, so a mod for plain Enemy Within that patches them does
  not fit either.

A player with plain Enemy Within, or with a mod that carries its object
data in files, should see such mods checked, installed and taken out like
any other.

## Requirements

- A script's files: those in its mod beside it, by their path relative to
  the script (in any case, `\` or `/`). Used in checking and in both planners
  (a setup on the game as it is, and one on a base).
- A compressed package is worked on decompressed; a mod that changes it
  writes it decompressed, with the stored-compressed flag cleared (the game
  fails on the flag otherwise; upkit's report).
- A package compressed whole has a `.uncompressed_size` beside it, which
  must go while the package is decompressed. It is kept like any other file
  the page changes, and comes back when the package goes back to its
  original, for instance when the mod is unticked.
- A compressed package that no wanted mod changes stays as it is: not
  written decompressed because a script only looked at it.
- Nothing else about how setups are planned, kept and written changes.

## Verification

Planner tests on an in-memory game folder holding plain Enemy Within's
compressed XComGame.upk with its size file:
- a mod applied: the package written decompressed, flag clear, size file
  removed, both originals kept;
- unticked: both back as they were.

A mod with a `MODDED_FILE` checked and applied from its files.

## Report (2026-10-22)

Done, committed; not deployed anywhere yet (not to staging, nothing released).

### What changed

- **Data files.** Each script gets the files beside it in its mod (kind
  "other": object data, table entries, bulk data), by path from its folder,
  in any case and with either slash. They are used in checking and in both
  planners (`WantedScript.files`, `scriptFiles`).
- **Compressed packages.**
  - A package the game ships compressed (whole, or in chunks) is checked and
    planned on its decompressed bytes (`scriptPackage` in `model/upk.ts`).
  - The app's decompression now clears the stored-compressed flag, as
    upkit's does.
  - A mod that changes such a package writes it decompressed. One that only
    reads it, or finds itself installed already, leaves the compressed file
    as it is.
- **The size file.** When a package compressed whole is written
  decompressed, its `.uncompressed_size` is removed, its original kept first
  (in `lwtree-backup/`). When the package goes back to its original, the
  size file comes back. Both planners do this:
  - the setup on the game as it is;
  - a base, where the size file is the game's own and is wanted absent
    meanwhile.
- **The mods list.**
  - It no longer marks a mod "bad" because its package is compressed in the
    install.
  - The quick check of a mod's targets read only a package's header, which
    a package compressed whole does not have. It now reads such a package
    whole.

### Verified

- Planner tests on an in-memory game with plain Enemy Within's compressed
  XComGame.upk and its size file, and a mod with a `MODDED_FILE`:
  - applied: written decompressed, flag clear, the function's data the
    file's, size file gone, both originals kept;
  - applied again: nothing to do;
  - taken out: the compressed original and the size file back byte for byte;
  - a mod already there: nothing written;
  - its data file missing: "does not fit … is not there".
  - The same through the base planner, plain Enemy Within as the base.
- In the desktop app, on a stand-in plain Enemy Within folder (the shipped
  compressed XComGame.upk with its size file), with a mod upkit wrote:
  - checked, applied: the package written, the size file removed, both kept;
  - the mod reads "installed" (seen on the page);
  - the version alone written back: every file byte for byte as it was
    (`real-install.spec.ts`, run with `LWTREE_REAL_KIND=lw`, since the
    picker has no plain Enemy Within).
  - That test had gone stale with the setup bar, so it was updated: going
    back to the originals is now the setup menu's "… alone, without mods or
    settings…", and the console stays open with "Done". It also takes
    `LWTREE_REAL_SHOT` to save the page.
- Lint, types, 257 site tests, the desktop suite (13 passed, the bench ones
  skipped).

### Seen, not this feature's

- In that desktop run, the test set NUM_STARTING_SOLDIERS through "any line
  of DefaultGameCore.ini" and applied. Game settings then said the game's
  file "differs from the original the app kept … edited by hand or by
  another tool" (6 → 60), and showed 6. The app's own write was read as a
  hand edit.
