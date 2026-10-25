---
title: "Our patcher's own mode: scripts that say they are for it, read without
  PatchUPK's faults"
status: done
priority: 2
dependsOn:
  - upkit-apply
  - tools-mods-complete
---

## Purpose

The person, 2026-10-22, on upkit-apply copying PatchUPK where mods could
see it: "i cannot help but think having a separate mode that lets us do
better and possibly more advanced things could make sense, what if the way
to activate it is in the patch file itself so it cannot be used wrong by
accident?"

A script written for our patcher should mean what it says, without
PatchUPK's faults. It must never be applied by a patcher that would read it
otherwise: not PatcherGUI, not an older copy of ours. Scripts that do not
ask for the mode keep PatchUPK's meaning exactly (upkit-apply).

## How it is asked for: on the package line

`UPK_FILE=XComGame.upk:UPKIT1`. Found by trying PatchUPK (UPKUtils
9b2fd07):
- a key or section it does not know, it skips without a word, so a
  separate "mode" line would let PatchUPK apply the script with its own
  meaning;
- a specifier on `UPK_FILE` makes it look for a file named
  `xcomgame.upk:upkit1`, fail, and stop at that line, before anything is
  written ("Error reading package … Execution stopped at #… UPK_FILE").

An older copy of our engine stops the same way (no such package). The number
is the mode's version: a patcher that knows only an older one refuses a
script made for a newer one.

## Requirements

- Every `UPK_FILE` of a script in the mode carries the marker. A script that
  mixes lines with and without it is refused as a whole: PatchUPK would
  apply its unmarked part before stopping.
- A version the engine does not know is refused, saying so.
- Mode 1, what it means differently:
  - `INSERT_CODE` inserts: the object grows by the code's length, nothing is
    written over. Inside a function's or state's script, the script's serial
    and memory sizes grow with it (the memory size counted from the
    pseudo-code, as `BEFORE_CODE`/`AFTER_CODE` count it).
  - A key or section the format does not have is an error, not skipped (a
    misspelt key does nothing in PatchUPK).
  - Names and exports added are counted in the package's generation, as a
    package upkit writes counts them.
- Everything else as without the mode.
- The site and `upkit apply` take it (one engine). Everything that lists a
  script's packages reads the name without the marker.
- upkit's README says how to write for the mode and what it changes.

## Not yet (worth its own feature)

What only a patcher of ours could do, such as UnrealScript in a mod script
compiled at apply time against the player's own packages. Proposed in the
report, not built.

## Verification

- PatchUPK refuses a marked script before writing (live with `PATCHUPK`).
- The mode's `INSERT_CODE` (sizes included), the error on an unknown key,
  the generation counts, a mixed script refused, version 2 refused.
- A marked script checked and applied by the site's planner and by
  `upkit apply`.

## Report (2026-10-22)

Done, in the engine the site and `upkit apply` share (`src/model/modpatch.ts`;
upkit README: "upkit's mode").

### What changed

- `UPK_FILE=<package>:UPKIT<n>` asks for the mode:
  - `packageLine` reads the name and the mode;
  - `scriptPackages` lists a script's packages without the mark. The site's
    readers use it: the setup and base planners, the check, and the mod's
    targets (`patchupk.ts`).
- Refused, as the whole script, before anything is done:
  - a script whose package lines are marked in part;
  - a mode newer than 1;
  - in the mode, a line that looks like a key or section the format does
    not have (its line and text said).
- Mode 1:
  - `INSERT_CODE` inserts, and grows a script's serial and memory sizes when
    the insert is inside a script;
  - `ADD_NAME_ENTRY` and `ADD_EXPORT_ENTRY` count what they add in the
    package's last generation (`Package.countInGeneration`).

### Verified

- PatchUPK built from UPKUtils, given a marked script, stops at the package
  line ("Error reading package: ./xcomstrategygame.upk:upkit1") and leaves
  the package byte for byte (test, live with `PATCHUPK`).
- The mode's `INSERT_CODE`, the refusals (a misspelt key, a misspelt
  section, a script marked in part, mode 2; the misspelt key without the
  mode still skipped, as PatchUPK skips it), and the generation counts
  (tests).
- Lightning Reflexes with its package lines marked, through the site's setup
  planner: the same package as unmarked (PatchUPK's hash).
- A declaration upkit wrote, marked and applied by `upkit apply`: the very
  package `--out` writes, generation counts included.
- Lint, types; 262 site tests, 139 upkit tests with PatchUPK.

### Next

Proposed as its own feature, `upkit-source-mods` (planned): UnrealScript in
a mod script, compiled against the player's own packages when applied. Such
a mod fits more than one version, combines with others in one function, and
says what does not fit in source terms. It is the first thing worth doing
that only our patcher can do.

## Report (2026-10-23): retired

The person, 2026-10-23, asked whether our mode could have "an entirely
distinct syntax … that patchupk would just treat as one big noop … so there
is no overlap of potential for confusion", and agreed to the design that
followed ("yeah i think that makes a lot of sense"). It is now
`upkit-source-mods`: a file type of our own (`.upkmod`, first line
`upkit mod <version>`) that PatchUPK refuses as a whole
(`Bad/unknown mod file format!`, tried).

So the `:UPKIT1` marker is removed: from the engine, the site's readers of
package names, the tests and upkit's README. Nobody had used it. The
engine reads scripts as before this feature, keeping only `scriptPackages`,
the one list of a script's packages the site now uses. What the mode
changed (an insert that inserts, unknown commands as errors, additions
counted in the generation) is carried in upkit-source-mods' requirements,
for wherever that format edits at that level. A script with the marker is
now read as PatchUPK reads it: a package by that name, which no install
has, so it does not fit.
