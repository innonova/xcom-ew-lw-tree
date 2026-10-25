---
title: "upkit: inline assembly for bytecode UnrealScript cannot say (hand
  patches, keep their bytes)"
status: done
priority: 2
dependsOn:
  - upkit
---

## Purpose

The person, 2026-10-22, after the first night of upkit: could the things
upkit cannot handle yet be handled "by adding a kind of inline assembly?",
and then: "yeah i think that is worth doing".

Long War's packages are full of hand patches: bytecode modders wrote in hex,
which no UnrealScript compiles to. upkit decompiles such a function to the
source closest to it and says above it that the bytes differ; edited, it
compiles to clean code, losing what the hand patch did differently, or is
refused (a member of a subclass read without a cast, another function's
local, a stray token). About 420 of Long War's functions are like that
(XComGame 176, XComStrategyGame 245), and LWR's own package has 36 (built
against stubs of the game's classes).

The reader of a decompiled function should see ordinary UnrealScript with
the few places where the bytes say something else written as an escape the
compiler reads back to exactly those bytes. Then a modder edits a hand
patched function and keeps everything about it they did not touch.

## Requirements

- An expression-level escape, `__asm(Token, operands…)`, usable anywhere an
  expression or a statement is: one odd token inside an otherwise ordinary
  statement stays one escape, not a statement of hex.
- Operands are symbolic: objects by path, names as names, sub-expressions as
  source (which may hold escapes themselves). The compiler resolves them as
  it resolves source (imports added where needed), and memory sizes come out
  as the engine counts them. No raw reference bytes.
- A value the compiler would compute (a context's skip, a conditional's
  sizes) is written `_` when the bytes hold what it would compute, and as a
  number only when they hold something else (a hand patch's stale skip).
- The decompiler writes the escapes itself, as few as it can: only the nodes
  where the plain source does not compile back to the bytes, or does not
  compile at all. A function that comes back without them is written
  without them.
- What the escape's value is (its type) is known to the compiler where the
  operands say it (a property's type, a call's return), so the code around
  it compiles as around any expression.
- Not: a way around the compiler's checks for code people write. The escape
  is for what the bytes already hold; the README says so.

Also in this feature (found on the way, not assembly):
- the two vanilla cheat functions that call with arguments left out and come
  back as `__EmptyParmValue`: a decompiler fix. (Found otherwise on the way:
  not a decompiler bug, see the report.)

## Verification

The round trip is the measure, as for upkit: every function of Long War's
XComGame and XComStrategyGame and of LWRebalance.u decompiled and compiled
back; the share that comes back byte for byte should go from 98.5% / 95.4% /
97.6% to nearly all. Vanilla must stay where it is (all but the C++-only
cases, which upkit-natives addresses). An edit next to an escape (a
statement added before it, a value changed in it) must compile, through
PatchUPK too.

## Report (2026-10-22)

Done; in `upkit/` (README: "What compiles back" and "upkit's own syntax").

### What changed

- `__asm(Token, operands…)`, an expression or a statement: the token by name
  (`StructMember`, `Context`, `ByteConst`, `Native129`, `LabelTable` …),
  its operands as the token table has them: objects by path (an import with
  its package first; the reference as a number where no path names it
  alone), names as `'Name'`, numbers, strings, children as source. `_` is a
  skip the compiler computes; a number there pins a hand patch's stale one.
  A context's member compiles in its object's scope. An escape takes the
  type its operands say (a variable's, a call's return, a cast's) and no
  conversion around it.
- The decompiler writes escapes only where the source would not compile
  back to the bytes, found by compiling and looking: where the bytes part
  (offsets and sizes compared last, as they follow from what comes after),
  that node; where the source does not compile, every node on the line
  naming what it does not know, else the least of the line that compiles;
  a parent when a node will not come out right alone; a whole statement as
  the last resort; then each escape dropped that the bytes do not need.
  `decompile` says so above such a function.
- Two more statements of upkit's own syntax, for what is not a node:
  `__ParmSlots(n);` (fewer optional-parameter slots than the flags say: a
  parameter made optional by its flag alone) and `__NoStateEnd;` (a state's
  code that writes its own closing: stop, padding, label table). A closing
  `return` of another function's return value, or a `Return(Nothing)` in a
  function with a value, is now the script's own statement, not the
  compiler's epilogue.
- `roundtrip` measures the source as `decompile` writes it (with escapes).

### Measured

Every function and every state's code of the corpus compiles back from its
decompiled source, byte for byte:

| Package | Before | Now | Functions with `__asm` (escapes) |
|---|---|---|---|
| XComGame (Long War 1.0) | 98.5% | 11,756 of 11,756 | 176 (945) |
| XComStrategyGame (Long War 1.0) | 95.4% | 5,349 of 5,349 | 244 (1,652) |
| LWRebalance.u | 97.6% | 1,484 of 1,484 | 36 (90) |
| Engine, XComGame, XComStrategyGame (vanilla) | all but 5 | all | 2 (8), after upkit-natives |

States' code: Long War's 262 all (252 before); vanilla's 269 as before.
Hand-written PatcherGUI mods in the samples: all 16 functions they change
(7 before). Of Long War's escaped functions, 140 of XComStrategyGame's 244
have three escapes or fewer; a few carry many (`XGItemTree.BuildItems`,
232: a byte constant passed where an int is wanted, line after line).

- An edit next to escapes: a statement added to
  `XGFundingCouncil.OnValidRequestAdded`, compiled as a whole package and as
  a mod script; the result decompiles to the edit and the very same escapes
  (the hand patch's bytes kept), and PatchUPK makes the same package from
  the script as `--out` writes (test).
- An escape written by hand compiles to exactly its node (test); Long War's
  XComStrategyGame round trip and vanilla's are held at every function by
  tests.
- 132 tests in `upkit/` pass (21 with `PATCHUPK`); lint and types clean. (135 with upkit-natives.)

### Found on the way

- The vanilla cheats' `__EmptyParmValue` is not a decompiler bug: Epic's
  compiler wrapped the left-out arguments in the class's implicit Outer
  context, `Context(Outer, 9, Outer, 0, EmptyParmValue)`, which the escape
  says as it is. Modelling that for two cheat functions is not worth it.
- Long War copied code between functions with its return value
  (`UIScreen.GetFlagPath` returns `UIUtilities.GetFoundryImagePath`'s), and
  nested a context inside a context's member, which no source nesting says.

### Not done

- The three vanilla functions that read members of C++-only classes came
  back as escapes; with upkit-natives (the class parents inferred) they are
  plain source.
- An escape is verbose where the difference is one byte (`__asm(StructMember,
  X.T.f, X.T, 0, 1, kRequest)` for a flag). A shorter form for the common
  cases (a constant's width, a member's flags) would read better; the
  general one is enough to keep the bytes.
- Nothing upkit writes has been loaded by the game yet (upkit's report).
