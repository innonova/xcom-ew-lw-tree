---
title: "Mods as source diffs: a file type of our own (.upkmod), applied to the
  decompiled source and compiled against the player's own packages"
status: done
priority: 3
dependsOn:
  - upkit-apply
  - tools-mods-complete
---

## Purpose

The person, 2026-10-22/23, step by step:
- a mode of our own "that lets us do better and possibly more advanced
  things", made so it "cannot be used wrong by accident";
- a file ending "to make it clear when we are using our special mode", and
  "an entirely distinct syntax … that patchupk would just treat as one big
  noop … so there is no overlap of potential for confusion" (agreed: "yeah i
  think that makes a lot of sense");
- "multiple mods applied to that same file must be one of the most
  complicated problems … what if we were to take advantage of our decompile
  recompile and shipped mods as something more akin to git diffs that could
  anchor on text rather than indices?";
- "git is pretty good at being whitespace agnostic, maybe we could use a
  canonical format during the process?" (agreed: "go for it").

What goes wrong with mods today (PatchUPK scripts):
- **Two mods replacing one function.** REPLACEMENT_CODE swaps in a whole
  function, so the second mod silently erases the first.
- **Byte-pattern anchors.** FIND_HEX and BEFORE_HEX search for exact bytes.
  When another mod or another game version changed them, the anchor misses,
  or matches somewhere else.
- **Index numbers.** Mods written in hex carry name and object numbers that
  differ between plain Enemy Within, Long War and LWR.
- (Objects moving inside the file are not the problem: scripts name objects
  by path, and the export table says where each one is now.)

A mod should instead be a change to the source, as a diff of the class's
UnrealScript with a few unchanged lines around each change as its anchor,
like a git patch. It is applied to the player's own code, decompiled, and
compiled back. Then:
- two mods that change different lines of one function combine;
- one mod fits every game version whose code still has its anchor lines;
- no index appears anywhere: the compiler resolves names against the
  player's own package;
- a conflict is said in source terms ("both mods change this line of
  `GetResearchPerHour`"), not left as a silent overwrite;
- making a mod is decompiling, editing, and letting upkit write the diff.

What a player and a modder see:
- a mod of ours is a `.upkmod` file, and its first line says so;
- PatcherGUI refuses it instead of misreading it;
- the site and `upkit apply` take it, beside PatcherGUI's scripts, which
  keep their meaning exactly.

## Facts

PatchUPK, built from UPKUtils 9b2fd07, tried 2026-10-23:
- It acts only on lines it reads as its own commands (`KEY=` of its own
  keys, `[SECTION]`). Every other line is skipped without a word: plain
  text, a key it does not know, garbage between commands.
- Anything inside `{ … }` is a comment to it, across lines.
- A file with no command of its own: `Bad/unknown mod file format!`, exit 1,
  nothing written. A file in another syntax is refused, not applied.
- A file with commands and other text: the commands run, the rest is
  skipped.
- The file's name and ending do not matter to it. PatcherGUI, a separate
  program, was not checked.

upkit, as of upkit-asm and upkit-natives:
- every function and state of the corpus compiles back from its decompiled
  source byte for byte (hand patches through `__asm`);
- `upkit diff` already writes changed functions, declarations and defaults
  as source diffs;
- compiling a class's source compiles what was edited in it, new
  declarations included.

## Requirements

- **The file type.** `.upkmod`, its first line `upkit mod <version>` (the
  format's version), then a few header fields:
  - `name:`, `author:`, `description:`;
  - the package(s) it changes;
  - the game versions it was made and tested on.
  Then the diffs: per class, unified-diff hunks of the class's source, in
  the form `upkit class` writes it. The hunks cover functions, states,
  declarations and defaults, and a new class is a diff from nothing.
- **No overlap with PatchUPK scripts**:
  - a file whose first line is the header is ours;
  - any other file is a PatchUPK script and means exactly what it means
    today (upkit-apply);
  - our writer checks every file it writes with the same PatchUPK-compatible
    reader the engine uses, and never writes one in which PatchUPK would
    find a command;
  - our reader refuses a `.upkmod` in which PatchUPK would find one;
  - a format version newer than the tools know is refused, saying so.
- **Applying** one or more mods, in order:
  1. the classes they touch, decompiled from the package as it is to be
     built on (the original, as the site's planners build from originals);
  2. each mod's hunks applied in turn, the later on what the earlier left;
  3. what changed compiled once, against the package and its neighbours in
     the install;
  4. everything else left byte for byte as it was.
  A hunk whose anchor is not found, or found more than once, does not fit,
  and says where and why in source terms. So does a hunk whose lines another
  mod has already changed: a conflict, naming both mods.
- **Matching anchors on a canonical form**, not on characters:
  - *Tokens*: both sides through upkit's lexer. Spacing, line breaks and
    comments do not count; identifiers compare without case (UnrealScript
    ignores case); fragments such as a lone `if (x)` or `}` work.
  - *Names resolved*: a reference compares by the object it means, so
    `class'XGUnit'` and `class'XComGame.XGUnit'` match, and so do `self.m_iX`
    and `m_iX`.
  - *Meaning, later if needed*: anchor statements compiled to upkit's decoded
    bytecode tree, references by path, compared with the function's own,
    which is immune to how any upkit version prints. The format must allow
    adding this without changing.
- **The decompiler's output** no longer has to stay the same character for
  character. A later upkit may print code better, as long as it still reads
  the old text. A golden copy of the corpus's decompiled source, checked in
  the tests (generated locally, nothing of the game's in the repository),
  makes sure a printing change never changes the tokens or the meaning a
  mod's anchors match.
- **Making a mod**: an upkit command that writes a `.upkmod` from an edited
  class source (`upkit compile … --upkmod <file>`, say), from the same edit
  `--patch` and `--out` take today.
- **Where it works**: `upkit apply` and `restore`, and the site's Tools page.
  A `.upkmod` is listed as a mod, checked, applied and taken out like a
  PatcherGUI script, and its conflicts and misfits are shown in its card.
- **Mods outside the tested versions**: applied when they fit, and the page
  and `upkit apply` say they were not tested there.
- **What stays with PatchUPK scripts**: changes that only make sense in
  bytes (Flash movies, textures, a hand patch nobody can say in source).
  Those scripts keep working as they do.
- **The fixes of the retired `:UPKIT1` marker** (an insert that inserts,
  unknown commands as errors, additions counted in the generation) apply
  wherever this format writes at that level: the compiler's own writing of
  new objects already counts them.

## A sketch, to be challenged

```
upkit mod 1
name: Faster labs
author: …
package: XComStrategyGame.upk
tested: Long War 1.0, Long War Rebalanced 2.06

--- XGFacility_Labs
@@ function int GetResearchPerHour() @@
     iResearch = GetResearchPerHourNoBonus();
-    iResearch = iResearch * (1 + m_fLabBonus);
+    iResearch = iResearch * (2 + m_fLabBonus);
     return iResearch;
```

(A hunk names the function or block it is in, rather than line numbers, so
it can be found wherever the function is and whatever lines come before it.)

## Open questions

- Hunks: how much context by default, and what a hunk may span (a whole
  function, part of one, declarations).
- Two mods touching neighbouring lines: merged as git merges them, or a
  conflict.
- A mod that fits one version only in part: refuse it whole, or apply what
  fits.
- Options a player sets (as PatcherGUI's ALIAS literals are today).
- The site's bundle with upkit's compiler (loaded only when a `.upkmod` is
  there?), and reading the game's Core and Engine before compiling.

## Verification

- PatchUPK, given any `.upkmod` our tools write, refuses it and writes
  nothing (live with `PATCHUPK`).
- Our tools: a header with a PatchUPK command in the file refused, a newer
  version refused, PatchUPK scripts unchanged in meaning (upkit-apply's
  tests stay green).
- Canonical matching: anchors that differ only in spacing, line breaks,
  comments, case or qualification match; anchors that differ in code do not.
- Two mods editing one function apply together and compile to what both
  diffs say; two mods editing one line are reported as a conflict, naming
  both.
- One mod applies to Long War 1.0 and to LWR, and fails where its anchors
  are missing, saying where.
- The golden copy: the corpus decompiles to the same tokens as recorded.
- In the game: a `.upkmod` applied by the site or `upkit apply` runs.

## Report (2026-10-23)

Built: upkit's side (`upkit/src/upkmod.ts`, `upkmodrun.ts`; README: "Mods as
source diffs (.upkmod)"), the site's (Tools page, both planners, the check),
and in the game. Committed, not deployed.

### What changed

- **The format**: a first line `upkit mod 1`; header fields `name`,
  `author`, `description`, `package`, `tested`; then per class
  `--- <package> <Class>` (or `(new)`) and hunks `@@ <block> @@`. The block
  is a function's or state's first line, nested with ` > `, or `class`, or
  `add` for anchorless additions.
- **Anchors on canonical code**: tokens from upkit's lexer.
  - Spacing, line breaks and comments do not count.
  - Identifiers and names compare without case.
  - Qualifiers are dropped: a name's package and outers, `self.`. This is a
    syntactic stand-in for the spec's "names resolved": two classes of one
    name in different packages would compare equal, which the game's
    packages do not have.
  - Numbers compare by value.
  - A hunk is found once within its block, or does not fit.
- **Additions** (variables, constants, functions, states) are `add` hunks,
  placed where upkit prints what it compiles. They are not anchored, so they
  port between versions.
- **Writing** (`upkit compile … --upkmod`) works from the round trip: edit
  compiled, result decompiled, diffed against the original. So a mod's added
  lines are what the package shows once applied, and it reads as installed.
  It is checked by applying it: it must make byte for byte the package
  `--out` makes. More context is added when a hunk is not found once.
- **Applying**: classes decompiled from the package as the run has it, hunks
  applied in order, edited classes compiled once (keep layout). Mods apply
  whole or not at all.
- **The engine** (`runScript`) recognises a `.upkmod` by its first line and
  hands it to the runner its caller gives:
  - `upkit apply` gives upkit's, reading the game's other packages from the
    folder;
  - the site loads upkit's compiler only when a wanted mod is a `.upkmod`
    (a chunk of its own, 178 kB, 56 kB gzipped), with the game's script
    packages read first.
- **The site**:
  - `.upkmod` files are listed as mods (the library, the picker) with a card
    naming the classes and functions they change;
  - they are checked, applied and taken out like scripts;
  - a `.upkmod` that fits the original but not after the mods before it says
    which of them it conflicts with ("it changes what Double labs changed
    before it").
  - For the browser: a Vite plugin points upkit's `node:fs`/`node:path`
    imports at stand-ins (the Linker reads no folders there), the same for
    the app's type check; the Linker takes a function giving packages by
    name; upkit's two `process.env` reads are guarded.
- **Also**: `upkit apply` no longer counts a package as changed because it
  was only opened (decompressed) for the compiler, and it takes the new
  packages a `.upkmod` leaves. The site's test config gets an ES2023 lib.

### Verified

- upkit (`test/upkmod.spec.ts`):
  - **format**: read and written; refused: another first line, version 2, a
    PatchUPK command in it, a hunk without anchor;
  - **canonical anchors**: spacing, case, qualifiers, `self.`, comments and
    numbers match; another number does not;
  - **round trip**: a mod with a new variable, a new function and a changed
    line makes the very package `--out` makes, and applied again reads as
    installed;
  - **combining**: two mods in one function combine; a third on the first
    one's line does not fit;
  - **two versions**: one mod written on Long War 1.0 applies to LWR 2.06
    (`AddScientists`, which LWR left as it was), and refuses where LWR
    rewrote the lines (`GetResearchPerHour`);
  - **classes**: a new class is added, then reads as there already; the main
    menu's seek-free class is edited;
  - **command line**: `compile --upkmod`, `apply` (installed the second
    time), `restore` byte for byte; PatchUPK, given the `.upkmod`, says
    `Bad/unknown mod file format!` and writes nothing (live with `PATCHUPK`).
- **The golden copy** (`test/golden.spec.ts`): every class of Long War's
  and vanilla's XComStrategyGame.upk decompiles to the canonical tokens
  recorded. One SHA-256 per class is committed, nothing of the game's.
- **The site** (`setup.spec.ts`): a `.upkmod` planned and written on an
  in-memory Long War install, then nothing to do; a second mod on the same
  line reported as conflicting with the first, by name.
- **The desktop app**, on a stand-in Long War folder: a `.upkmod` added
  through the picker reads "installed" once applied (its card seen), and the
  originals are restored byte for byte (`real-install.spec.ts`, which now
  also takes `.upkmod` files).
- **In the game (wingpu)**: a `.upkmod` adding a variable and a function to
  `UIInterfaceMgr` and calling it from `OnInit`, applied by `upkit apply` to
  the shipped compressed XComGame.upk:
  `ScriptLog: upkit .upkmod: a mod as source diffs ran (1)`. Restored,
  hashes checked.
- Lint, types, both builds; 258 site tests, the desktop suite (13 passed);
  upkit's suite with PatchUPK live.

### Not done (the open questions, decided for now)

- **Neighbouring changes**: a hunk carries up to three context lines. Two
  mods whose changed lines are within that distance conflict, which is
  stricter than git's merge. `add` hunks never conflict on place.
- **A mod that fits only in part** is refused whole.
- **`tested:`** is read and kept, but neither the site nor `upkit apply`
  says yet when the install is another version; that needs version names
  both understand.
- **Options a player sets** (as ALIAS literals) are not in the format.
- **Matching on meaning** (the compiled statement trees) is not built. The
  format leaves room for it: a block or hunk header could say so.
