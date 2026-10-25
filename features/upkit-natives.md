---
title: "upkit: the native interface mapped (for upkit's compiler, and as a
  reference modders generate)"
status: done
priority: 3
dependsOn:
  - upkit
---

## Purpose

The person, 2026-10-22: "would it be worth mapping out and documenting the
entire native interface at least the parts already used, both for upkit's
own sake and for future mod makers?"

Enemy Within's script runs on C++ it cannot see: native functions, native
classes whose layout C++ fixes, events C++ calls, and classes that exist only
in C++ (`NetConnection`, `FracturedStaticMesh`, `StaticMesh` …), which the
script packages only import. upkit needs part of this to compile (three
vanilla functions do not come back because it cannot tell a C++-only class's
parent), and modders need all of it to know what they can call, override
and not change.

## Requirements

- Generated from the user's own packages by an upkit command, not committed:
  nothing of the game's goes into the repository. A modder runs it against
  their install and gets a readable reference (markdown).
- What the packages say: every native function (its index, owner, signature,
  flags: final, static, latent, iterator, operator and precedence); every
  event (what C++ calls, modders override); native classes (no new
  variables) and native structs.
- What the packages imply: the C++-only classes, their members as the
  packages import them (with types), and their parents as the shipped
  bytecode shows them (code reading a `StaticMesh` member on a
  `FracturedStaticMesh` says the one descends from the other), each with
  where it was seen.
- upkit's compiler uses the same inference, so the C++-only cases compile as
  plain source.
- What no package says, what a native does, is written in our own words as
  far as we know it, in the repository: a notes file keyed by function, each
  entry saying how it is known (observed, inferred from the bytecode that
  calls it, from what Unreal Engine 3 is publicly documented to do). The
  generated reference shows the note beside the declaration. The person,
  2026-10-22: "is there anything wrong with explaining in words what the do
  in so far as we know? … do we think general API documentation is a
  problem?" Not, as far as we can tell: behaviour and signatures are facts
  about an interface; the line is not to copy Epic's or Firaxis's own text
  (source comments, their documentation) or ship decompiled C++. The
  declarations themselves stay generated locally, out of caution.

## Verification

The three vanilla functions that do not come back today do, as plain source.
The inferred parents agree with what Unreal Engine 3 is known to have where
that is known; every inference names its evidence, so a wrong one can be
traced.

## Report (2026-10-22)

Done; in `upkit/` (`src/natives.ts`, `notes/natives.md`; README: "The native
interface").

### What changed

- `upkit natives <package>` writes the reference, from the game's packages
  beside the one given (or `--game`), to stdout: per package its native
  classes and native structs, its native functions (declaration as
  decompiled, native index, final, static, latent, iterator, operator and
  precedence) and its events; then the classes only C++ defines. For vanilla
  Enemy Within: 3,354 native functions, 2,249 events, 36 C++-only classes;
  generated in about a second.
- The C++-only classes: the classes the script packages import and none has.
  Their members are what the packages import of them; their parents, where
  the shipped bytecode reads a member of one class through a context on an
  object of the other (the object's class from its variable, its cast or the
  call returning it), the closest of those seen; what their object members
  hold, where the bytecode reads a member of some class on one. Each with
  where it was seen. Vanilla: `NetConnection` and `ChildConnection` descend
  from `Player` (`PlayerController.GetSplitscreenPlayerByIndex`),
  `FracturedStaticMesh` from `StaticMesh` (`XComFracLevelActor.PostBeginPlay`),
  `StaticMesh` from `Object`; `ChildConnection.Parent` holds a
  `NetConnection`. 32 others are not seen read through (Core's property
  classes and the like).
- The compiler finds a member of such a class through its parent, and gives
  such an object member the class the bytecode reads it as. The three
  vanilla functions that came back as `__asm` (upkit-asm) are plain source.
- `notes/natives.md`: what natives do in our own words, each with how it is
  known (UE3's known behaviour, observed in the game's code, inferred). A
  start of 22: Object's randoms, states, `IsA`, `Localize`,
  `DynamicLoadObject`, `SaveConfig`; Actor's `Spawn`, `Destroy`, timers,
  `Trace`, `Sleep`, `FinishAnim`, the actor iterators; and the game's own
  `XComEngine.SyncRand` / `SyncFRand`, which its shot roll uses instead of
  `Rand` (observed; that a save keeps their sequence is inferred). The
  generated reference shows each under its declaration; the one-file build
  carries the notes beside it.

### Verified

- Tests: the inferred parents and member class above, with their evidence;
  the three functions as plain source; the reference's entries (a native with
  its index and flags, a latent one, an event section, a C++-only class with
  its parent) and the command. Vanilla still comes back whole.

### Not done

- The notes are a start. What XCOM's own natives do (XComGame has 1,256) is
  not written beyond the random numbers; they would want observation, from
  how the game's code calls them.
- A C++-only class whose members are never read through a context on it has
  no parent in the reference (Core's property classes, `Level`, `World` …);
  nothing in the packages says it.
