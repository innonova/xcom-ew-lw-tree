---
title: "Our own patcher: PatchUPK's mod scripts applied by the app's engine,
  completed, and by upkit's command line"
status: done
priority: 2
dependsOn:
  - upkit
  - game-tools
---

## Purpose

The person, 2026-10-22, after the in-game checks: "should we make our own
patcher perhaps?", and then: "go for it".

Mods for Enemy Within are PatchUPK scripts (PatcherGUI's `.txt`). The one
program that applies them, PatchUPK, runs on Windows only, wants its
packages decompressed by hand first, and has two faults that showed in
upkit's work:
- the objects it adds are not linked into their owner's list of children,
  and 4 stray bytes are written at the end of the file;
- it does not count them among the package's net objects, so in a package
  that counts no more than it has, the game logs them as invalid.
upkit's scripts work around the first by writing the links themselves.

A modder or player should be able to apply any PatcherGUI mod, and any
script upkit writes, on any system:
- to the game's packages as they ship, compressed or not;
- with the result checked before anything is written;
- with the originals kept, so the mod can be taken out again.

The app already has its own engine for the format (`src/model/modpatch.ts`,
game-tools), written from PatchUPK's documentation and observed behaviour,
not from its code (UPKUtils is GPL v2). It does the common commands and
reports "does not fit" for the rest. Completing that engine and giving
upkit a command over it makes one patcher with two faces: the site's Tools
page and a command line.

## Requirements

- Every command PatchUPK's readme documents:
  - all scopes: package (`OFFSET`), name, import and export entries,
    objects;
  - all writes, finds and replacements, including `INSERT_CODE`,
    `REPLACE_*`, `MODDED_FILE` and `BULK_*`;
  - `RENAME`, `EXPAND_FUNCTION` and `EXPAND_UNDO`;
  - the `INPL` behaviour and `GUID`;
  - `ADD_NAME_ENTRY`, `ADD_IMPORT_ENTRY` and `ADD_EXPORT_ENTRY`.
- Ours is the same as PatchUPK's output, byte for byte, wherever a mod
  could see the difference: mods were made and tested against PatchUPK as it
  is, faults included (decided on the way: `INSERT_CODE` writes over the byte
  at its offset, against its readme's "insert", and ours does too). Where
  PatchUPK falls short of its readme and no mod can depend on it, ours does
  what the readme says, and the difference is named in a test:
  - an added export is linked to its owner (the readme: "links the new
    object to specified owner");
  - it is counted among the net objects;
  - no stray bytes are written.
- A package that ships compressed is applied to decompressed: chunks taken
  off, the stored-compressed flag cleared (the game fails on the flag
  otherwise, upkit's report), and a `.uncompressed_size` beside it removed.
  The packages are otherwise as PatchUPK would leave a hand-decompressed
  copy.
- Nothing is written unless every step of the script fits. A mod already
  applied reads as installed and changes nothing, as the engine does today.
- `upkit apply <mod.txt>… [--game <folder>] [--check]`:
  - the scripts in order;
  - each step's result;
  - the packages written in place, each original kept the first time it
    changes.
- `upkit restore [--game <folder>]` puts the originals back. PatchUPK's
  uninstall scripts are not written: the kept originals serve that
  purpose, and the app keeps its own.
- The site's engine gains the same commands, so the Tools page takes mods
  it reported as not fitting before.
- Not: PatcherGUI's interface, or the `.uninstall.txt` files.

## Verification

- PatchUPK built from its source (wghost/UPKUtils 9b2fd07) is the oracle.
  Each command is run by both on real packages and the results compared;
  the SHA-256 of PatchUPK's results are kept in the tests, as the engine's
  tests do, so they run without the binary.
- Every script upkit writes (the kinds of edit its tests cover) applies
  with our engine to exactly the package `--out` writes.
- The mods in the samples apply as before.
- In the game (wingpu): a mod that adds an object, applied by `upkit
  apply` to the packages as shipped, loads and runs.

## Report (2026-10-22)

Done: the site's engine completed (`src/model/modpatch.ts`, `upk.ts`), and
`upkit apply` / `upkit restore` over it (`upkit/src/apply.ts`; README:
"Applying mod scripts").

### What changed

- The engine takes every command PatchUPK's readme documents. New:
  - `OFFSET`, `NAME_ENTRY`, `IMPORT_ENTRY`, `EXPORT_ENTRY` scopes (a table
    entry is written in place, never resized);
  - `BYTE`, `FLOAT`, `INTEGER`, `UNSIGNED`, `NAMEIDX`, `OBJIDX`;
  - `INSERT_CODE`, `REPLACE_HEX`/`REPLACE_CODE`, `MODDED_FILE`/`FUNCTION_FILE`,
    `BULK_DATA`/`BULK_FILE` (files read beside the script);
  - `RENAME`/`NAMELIST_NAME`, `EXPAND_FUNCTION`, `EXPAND_UNDO`;
  - the `INPL` behaviour (resized in place, the objects after it moved),
    `GUID`;
  - `ADD_IMPORT_ENTRY`, `ADD_EXPORT_ENTRY`.
- What PatchUPK does, found by running it (its log says each write; its
  code was not read):
  - an added export's data is its own index (its net index), `None`, then
    zeros, at the end of the file;
  - `INSERT_CODE` grows the object by one byte less than the code and writes
    over the byte at the offset; one byte grows nothing;
  - `REPLACE_*` searches on from where the replacement starts;
  - `BULK_DATA` writes flags, count, size, the data's absolute offset, then
    the data, always within the object;
  - `EXPAND_FUNCTION` pads with nops before the script's last token and grows
    both sizes;
  - the `GUID` text is four little-endian words.
- Where ours differs, by design: an added export is linked as its owner's
  last child, counted in the last generation's net objects, given its
  (empty) depends entry, and no stray bytes are written; `REPLACE_*`
  replaces every place.
- `upkit apply <mod.txt>… --game <folder> [--check]`: packages opened in any
  case, decompressed where they ship compressed (whole, or in chunks, the
  stored-compressed flag cleared), each step said, nothing written unless all
  fits; the first time a file changes, it is kept (with its
  `.uncompressed_size`, which goes) in `upkit-backup` beside the folder;
  `upkit restore --game <folder>` puts them back.
- The engine's files are plain TypeScript Node runs (`.ts` imports, no
  parameter property), so upkit's command line uses them as they are; its
  one-file build carries them.
- An upkit bug found on the way: code after a class's `defaultproperties`
  block was dropped without a word; it is read now (test).

### Verified

- Against PatchUPK built from UPKUtils 9b2fd07, on LWR's
  XComStrategyGame.upk: each documented command (11 scripts: values,
  scopes, renames, `INSERT_CODE` three ways, `REPLACE_HEX` with `AUTO` and
  `INPL`, `MODDED_FILE`, `BULK_DATA`, expansions and undo) gives the same
  bytes; their SHA-256 are kept in `modpatch.spec.ts`, which runs PatchUPK
  too when `PATCHUPK` names it. `GUID` refuses another package as PatchUPK
  does. The additions: the same tables and objects as PatchUPK's but for
  the links, the count and the depends entries (asserted), and applied twice,
  installed already.
- Every script upkit writes that the tests cover (declarations of every
  kind, flags, a hand patch's function edited, a new class) applies with
  `upkit apply` to the same names, imports, exports and object data as
  `--out` writes.
- The packages as Steam ships them (XComGame.upk compressed whole,
  XComUIShell_SF.upk in chunks): applied, kept, checked again (installed
  already), a script that does not fit writing nothing, restored byte for
  byte (test).
- In the game (wingpu): `upkit apply` of a script that adds a variable and a
  function to `UIInterfaceMgr` and calls it from `OnInit`, to the shipped
  compressed XComGame.upk: `ScriptLog: upkit apply: a mod that adds objects
  ran (OnInit, 1)`. Restored after, hashes checked.
  - The first try kept the originals in `CookedPCConsole/upkit-backup`. The
    game reads packages under that folder's subfolders too: it showed
    "Ambiguous package name" in a message box (the person saw it), waited,
    and loaded the original. They are kept beside the folder now.

### Not done

- The site's Tools page gets the new commands, but gives the engine no file
  reader yet: a mod with `MODDED_FILE` or `BULK_FILE` still reads "does not
  fit" there. It also still refuses packages that ship compressed (it does
  not write decompressed ones).
- The generation's export and name counts are left as PatchUPK leaves them
  (upkit's `--out` counts them up); the game reads neither, as far as seen.
