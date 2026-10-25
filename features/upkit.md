---
title: "upkit: an UnrealScript decompiler and recompiler for Enemy Within's
  packages, as a standalone tool"
status: done
priority: 2
---

## Purpose

The person, 2026-10-21, on the bytecode reader written for the tree's rules
(scripts/upk_script.py): "how complete is it and how hard would it be to
close the loop and make a full decompiler+recompiler as a stand alone tool?"
Then: "it should support outputting full upk's too in case someone want to
build something more serious but supporting the patch mode for the most
common use case is a good call", and: see how far it gets by 07:00 CEST on
2026-10-22.

XCOM: Enemy Within has no SDK; its mods are bytecode patches (PatchUPK /
PatcherGUI scripts), written by hand in hex or PatchUPK's pseudo-code after
reading the code in UE Explorer, which decompiles but does not compile. A
tool that decompiles a function to UnrealScript and compiles the edited
source back closes that loop.

## The shape

- `upkit/` in this repository for now (its own repository once it stands):
  TypeScript, run by Node directly, no build step; its own tests.
- Library and command line:
  - read a package (compressed or not): names, imports, exports, every
    object's fields;
  - bytecode: every token decoded to a tree and encoded back;
  - decompile a function, a state or a class to UnrealScript;
  - compile UnrealScript (a function body, a class) back to bytecode
    against the package's own types;
  - write: a whole package (functions replaced, objects grown and moved),
    or a PatchUPK script with the change, for the common case.

## Verification: the game's own code is the test

Every phase is measured over every function of XComGame.upk,
XComStrategyGame.upk and LWRebalance.u (about 18,600 functions):
- the bytecode: decoded to exactly its stored length, memory size equal to
  the stored one, encoded back byte for byte;
- the objects: each read to exactly its end;
- the compiler: decompile, compile, and the bytecode comes out identical.
  The share that does is the measure of how far it is.

Decompiled code stays on the user's machine; nothing of the game's goes into
the repository.

## Report (2026-10-22)

Written through the night and kept current; the state below is as of the
last commit before 07:00 (finished at 05:05). The second half of the night
went to the mod-script side, checked against PatchUPK itself (imports,
locals and every kind of declaration as mod scripts; a bug of PatchUPK's
that every such script now works around), to closing the last gaps with
Epic's compiler on the vanilla packages, and to sweeps of edits over
hundreds of classes, which found bugs of upkit's (listed below, fixed).

upkit is in `upkit/` (TypeScript, run by Node 24 directly, or as one file:
`node upkit/build.mjs` writes `upkit/dist/upkit.mjs`). `npx vitest run` in
`upkit/` runs its tests on the game's packages in the git-ignored `samples/`
(skipped without them). `upkit/README.md` is the manual: the common case
first, every command, what compiles back, how the source reads, upkit's own
syntax for what UnrealScript cannot say, and the files.

### What it does

- Reads every package of the game, compressed or not; writes any of them back
  byte for byte. Decodes and encodes every script (41,666 in the corpus) byte
  for byte; reads every object to its end.
- Decompiles a function, a state's code, a whole class (constants, enums,
  structs, variables, functions, states, defaultproperties with components),
  or a whole package (`export`: a .uc per class). The source reads as written
  where that is provably the same code: `for`, `continue`, `else if`, the
  conversions the compiler makes on its own left out (each function so
  written is compiled and kept only if its bytes are the same).
- Compiles back what was edited in a function's or a whole class's source:
  bodies, state code (labels, the label table), defaultproperties and a
  struct's structdefaultproperties (a value from its type; the rest kept
  byte for byte). Mistakes are refused with the function and the line (a
  type where another is wanted, a missing cast, too many arguments, an
  unknown name, a parse error); so is a changed declaration of something the
  package has (a function's parameters, a variable's type or category, a
  struct's members, a state's or class's declaration, a replication block),
  which is not compiled: what the package has keeps its declarations (but
  for the modifiers and enum values below).
- Writes the change two ways: as a PatchUPK mod script (`--patch`, the
  common case), adding the names, imports and locals the code needs; or as a
  whole package (`--out`). Both take new declarations too (member
  variables, functions, states, structs, enums, constants, delegates,
  interfaces, a new class with its replication), values added to an enum,
  and changed modifiers (a variable made `config`, say, to be set from an
  ini; a function made `exec`); a mod script with any of these is made from
  the whole package. `new` builds a new script package, with a start for its
  .int and .ini.
- `diff`: two versions of a package compared, each changed function, and
  each class's changed declarations and defaults, as a diff of its source
  (Long War changed 653 of XComStrategyGame's functions and states, the
  declarations of 10 of its classes and the defaults of 6).

### How far it is, measured

Decompiled and compiled back in place, byte for byte:

| Package | Functions | Identical |
|---|---|---|
| Core (vanilla) | 311 | 100% |
| Engine (vanilla) | 4,341 | 99.95% |
| XComGame (vanilla) | 11,756 | 99.99% |
| XComStrategyGame (vanilla) | 5,349 | 99.96% |
| GFxUI, GameFramework, IpDrv, OnlineSubsystemSteamworks (vanilla) | 1,154 | 100% |
| XComGame (Long War 1.0) | 11,756 | 98.5% |
| XComStrategyGame (Long War 1.0) | 5,349 | 95.4% |
| LWRebalance.u | 1,484 | 97.6% |

States' code, the same way: all 269 of the vanilla packages', LWRebalance's
7, and 252 of Long War's 262. The 5 vanilla functions left each name what the
cooked packages lack (a cheat's empty argument, members of C++-only classes,
a property cooking dropped). Long War's packages carry hand patches
(bytecode no source compiles to: flags set otherwise, stale jumps, nested
contexts, arguments a function no longer takes); `decompile` says so above
such a function, and `roundtrip --list` names them all, each with where its
source and its bytes part. The vanilla packages came from the win VM's
install into `samples/ew/`.

- Every class's defaultproperties, compiled from the text alone, come back
  byte for byte (all seven corpus packages and vanilla).
- Every class, decompiled, reads back as unchanged (nothing compiled when
  nothing was edited).
- Built anew from source: LWR's `LWRebalance.u`, every class decompiled and
  built as a new package with `new`, has 97.5% of its 1,493 functions and
  states token for token as the original Unreal compiler made them, and
  99.7% of its 9,235 objects the same declarations. Twelve more mod packages
  beside it rebuild with 97.1% of their code the same.
- The rebuilt LWRebalance.u imports what the original does, as it does
  (2,828 imports the same, none of another class).
- Mod scripts, checked against PatchUPK itself (built on Linux from wghost's
  UPKUtils source; the tests run it when `PATCHUPK` names the binary):
  - Every function of Engine, XComGame, XComStrategyGame and LWRebalance.u
    (22,930), written back as a mod script and applied, comes out byte for
    byte with the engine's memory size. (This found that PatchUPK cannot
    read a name with a space in it as `<Name>`; such a name now goes in as
    its bytes.)
  - Edits, each applied to the original, make the same package as `--out`
    (names, imports, export entries, every object's bytes): a function's code
    the same size, grown, shrunk, naming a name the package lacks, adding
    imports (a class; another package's function), adding locals (after the
    return value; where the function had no children); defaults the same
    size and grown; a state's code with a label added; declarations (a member
    variable and a function; a constant, an enum, a struct and a state; a new
    class in the package); a value added to an enum and used; a variable made
    `config`. The app's own implementation agrees on the four it can apply
    (it takes neither imports nor objects).
  - Declarations on 60 more classes of both packages (20 picked, 40 at
    random): a member variable and a function using it on the 52 that are
    not native, a function alone on 45 (the native ones among them): each
    the same package as `--out`. A variable for a native class is refused
    (its C++ fixes them). On the 40 random ones also a statement added to a
    function (the 30 that have one) and a default changed (a number, a bool
    or a string; the 33 that have one), a new state with a function, and a
    constant, an enum and a struct together (all 40): the same. And a
    statement after `Begin:` in the states of 21 classes: the same. Last, a
    function added to every class of XComStrategyGame (241) and to 200 of
    XComGame's at random: all the same.
  - On the win VM, the PatchUPK.exe Long War's Mod Manager ships made the
    same packages as `--out` from five of these scripts (imports, locals, a
    member variable and a function, a new class).
- On Windows (the VM's Node 24, its vanilla and its LW + LWR installs, paths
  with spaces) the one-file build decompiles, exports, diffs, writes a mod
  script and a whole package. As built at the end of the night, run there
  on the LW + LWR install: a member variable and a function declared, as a
  mod script that Long War's PatchUPK.exe applied, and as a whole package;
  the two the same, byte for byte.
- Lint-clean as the repository lints; the app's own unit tests leave
  upkit's to upkit (they had been picking them up). 129 tests in `upkit/`
  (21 of them need `PATCHUPK`).

### Found by the checks, and fixed

- Any edit of a native class's source with `--out` (or with new
  declarations) failed as "a new native class needs C++" (a sweep of
  declarations over 20 classes).
- A class source that only declared constants, enums, structs or states read
  as nothing edited (found while adding enum values).
- A name with a space in it broke PatchUPK's pseudo-code (every function of
  XComGame through PatchUPK).
- `diff` against a version kept outside the game's folder showed 50 of a
  class's functions changed for one (the final smoke run of the one-file
  build).

### Not verified, and not done

- (Loaded by the game since: see "In the game" below.)
- The app's own PatchUPK implementation (`src/model/modpatch.ts`, which its
  game tools install mods with) takes neither `[ADD_IMPORT_ENTRY]` nor
  `[ADD_EXPORT_ENTRY]`, so a mod script that adds imports, locals or
  declarations needs PatcherGUI / PatchUPK to apply it. Teaching the app
  those two would be a feature of the app's own (not started). PatchUPK's
  `[ADD_EXPORT_ENTRY]` does not link what it adds (it writes the link at the
  end of the file: a stream's reading and writing positions apart); upkit's
  scripts write every link themselves.
- Not compiled: native functions; a changed declaration of something the
  package has, beyond the modifiers above and values added to an enum (a
  function's parameters, a variable's type, a struct's members: refused,
  with that said). Replication is compiled for new classes only. Members
  added to a struct the package has would be the next such step (as enum
  values are); not done, as a struct a native class uses has its size fixed
  in C++, and checking that across the game's packages wants care.
- Mods people wrote by hand (the samples' PatcherGUI scripts): 7 of the 16
  functions they change compile back byte for byte; the rest is hex no
  compiler writes (a fixed skip of 10, a call short of an argument).
- upkit lives in this repository; standing on its own needs a repository of
  its own (a person's decision: its name, its licence), with the test that
  uses the app's PatchUPK implementation moved or dropped. `upkit/package.json`
  is ready for that (private for now).

### To check in the game (a machine with a GPU, the game installed)

Smallest risk first; each step undone by restoring the package (keep a copy).
`G` is the game's `XEW/XComGame/CookedPCConsole`; `upkit.mjs` the one-file
build (`node upkit/build.mjs`).

1. A mod script, the common case:

   ```
   node upkit.mjs class "$G/XComStrategyGame.upk" XGFacility_Labs > Labs.uc
   # in Labs.uc, GetResearchPerHour's body: return 1000;
   node upkit.mjs compile "$G/XComStrategyGame.upk" XGFacility_Labs Labs.uc --patch labs.txt
   ```

   Apply `labs.txt` with PatcherGUI; research should finish within a day.
2. The same change as a whole package: `--out XComStrategyGame.upk.new`
   instead of `--patch`, copied over the game's `XComStrategyGame.upk` (on
   an install whose exe has the hash check off, as Long War's has): the same
   result tells that upkit's packages load.
3. A new member variable and a function in a class, used from an edited
   function, both ways (`--patch`, and `--out`): tells that new declarations
   load and run, and that PatchUPK's appended objects do.
4. A new script package (`new`, a class extending XComMutator) loaded the way
   Long War's mutators are: tells that a package upkit made from nothing loads.

## Report (2026-10-22, in the game)

On wingpu (a machine with a GPU, vanilla Enemy Within from Steam), driven
from here through `am exec` (the desktop session) with tools for starting
the game, screenshots and input (learnings #171, #172). The game's files were
backed up before each test and are as shipped again at the end; the game
runs windowed there (its own settings, for screenshots).

| What | How | In the game |
|---|---|---|
| Changed code in XComGame.upk | `--out`: `UIInterfaceMgr.OnInit` (runs at the main menu) logging a line | loaded, ran: `ScriptLog: upkit was here: UIInterfaceMgr.OnInit ran (compiled by upkit)` |
| New declarations | `--out`: a member variable and a function in `UIInterfaceMgr`, called twice | ran: `m_iUpkitCount = 2`, then `5` (the variable keeps its value) |
| The same as a mod script | `--patch`, applied by Long War's PatchUPK.exe to the uncompressed original | loaded, ran: the same two lines |
| A package from nothing | `new UpkitTest.u` (a class extending Actor), spawned by name from the changed XComGame | loaded, ran: `upkit package loaded: UpkitTest.UpkitHello.PostBeginPlay ran` |

Found and fixed on the way:
- A class in a seek-free package (inside a package object,
  `XComUIShell.UIFinalShell`) named bare in its source was taken for a new
  class and declared again; now found by its path (`class`, `compile`, and
  a class's source in a whole package), with a test.
- A package upkit adds objects to now counts them in its net objects: the
  new package's objects had been logged as having an invalid net index (the
  game ran on).

Found and fixed later the same day (a correction to the first reading):
- A seek-free package (`XComUIShell_SF.upk`, the main menu's screen) written
  by upkit crashed the game as it loaded it (an array assertion). It was
  first taken for a check of the package's contents. It is not one: the
  package exactly as shipped, only uncompressed, crashes the same way. The
  earlier run that seemed to load it had read a stale log; the game had not
  started. Vanilla stores these packages in compressed chunks with a flag
  in the header saying so; upkit took the chunks off but kept the flag, and
  the game then reads the plain bytes as compressed. Long War's own
  seek-free packages (UICollection_*_SF, gfxInterception_SF, its changed
  Flash movies and textures) have the flag off. upkit now clears it when it
  takes the chunks off (a package compressed whole keeps it inside and loads
  so, as Long War's XComGame.upk does). In the game, with the flag off: the
  unchanged package loads, and so does the menu's `SetText` edited to label
  the first button `SINGLE PLAYER (upkit)`, which the menu shows; upkit's
  output with the fix is byte for byte that package (test for the flag).
  Nothing in the exe checks packages' contents as they load: its SHA tables
  are filled for the startup packages and used for the network, and the
  message for a failed check is never referenced.

Found, not fixed:
- PatchUPK does not count the objects it adds in the package's net
  objects; where a package counts no more than it has, the game logs the
  added ones as invalid (as above). XComGame.upk counts more than it has, so
  the mod-script test above ran clean.
- Not checked in play: a change seen in a campaign (research speed, the
  first step of the plan above); the code paths are the same ones the menu
  tests ran.
