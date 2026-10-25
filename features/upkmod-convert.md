---
title: "PatchUPK mods converted to .upkmod: the same change as source diffs,
  checked object by object"
status: done
priority: 2
dependsOn:
  - upkit-source-mods
---

## Purpose

The person, 2026-10-23, agreeing to the next steps after upkit-source-mods
("go for it"): convert existing mods to `.upkmod`.

The `.upkmod` format is only worth as much as the mods written in it.
Players have PatcherGUI scripts. A modder with a working script should be
able to get the same mod as source diffs without writing it again, and then
gain what the format gives:
- one mod for several game versions;
- mods that combine in one function;
- conflicts said in source terms.

This is also the format's real test, on mods people wrote by hand. Sightlines
ships an EW script and an LW script; as source diffs they might be one mod.

## Requirements

- `upkit convert <mod.txt> --game <folder> [--out <mod.upkmod>]`:
  1. the script applied to the folder's packages, in memory (as `upkit
     apply` does);
  2. every class it changed decompiled before and after, and diffed;
  3. the `.upkmod` written from those diffs (`add` hunks for new
     declarations, a new class whole).
  The packages must be without the mod: a script that reads as installed
  already is refused, saying so.
- **Checked object by object.** The `.upkmod`, applied to the same
  packages, must make every object as the script makes it, compared by path.
  An object whose bytes differ is said: what the source cannot carry.
- **What is not code is not converted, and said.** A Flash movie, a texture,
  or an object outside every class (Enhanced Tactical Info patches the
  tactical UI's movie). No `.upkmod` is written unless everything converts,
  or `--partial` is given, which converts the code and lists the rest.
- **Options.** A script's ALIAS values are taken as the script has them
  (`.upkmod` has no options yet), and the conversion says so.
- Name, author and description come from the script's header.

## Verification

- The sample mods (EXALT Reminder, Lightning Reflexes, Soldier Gender,
  Sightlines EW and LW, the Mutator Enabler) converted on the packages they
  were made for, without them, and checked object by object. Enhanced
  Tactical Info refused as not code.
- Each converted mod applied to the other versions (vanilla, Long War 1.0,
  LWR 2.06): where it fits, and where and why it does not. Sightlines' two
  scripts compared: does one `.upkmod` serve both?
- In the game: one converted mod applied and seen working.

## Report (2026-10-23)

Done: `upkit convert` (`upkit/src/convert.ts`; README, "Mods as source
diffs"). Committed, not deployed.

### What changed

- `upkit convert <mod.txt> --game <folder> [--out …] [--partial] [--with
  <mod it needs.txt>]…`:
  - the script is applied in memory (`--with` scripts first, not part of
    it);
  - the classes whose objects it changed (an object's outermost class, or a
    default object's class) are decompiled before and after and diffed;
  - additions become `add` hunks;
  - more context is used where a hunk is not found once.
  - Checked by applying the `.upkmod` to the same packages: every class it
    changes must decompile to what the script leaves.
  - Refused: packages that have the mod already, a script that does not fit.
    What is not code is listed, and nothing is written unless `--partial`.
  - Options are taken as the script has them, and the conversion says so.
- **Two faults in the applier found on the way**, fixed for every
  `.upkmod`, with tests unchanged and green:
  - A mod's hunks were applied one after another, so a mod that opens a
    block in one hunk and closes it in another (EXALT Reminder wraps code in
    an `else`) left the source unbalanced between them, and the next hunk
    found no end to its function. Now all of a mod's hunks are found on the
    source as it was, then made from the last to the first.
  - A hunk replaced its whole anchor, context included, so two hunks of
    neighbouring blocks collided on shared context lines. Now only its
    changed lines are made; the context only finds the place.
- upkit's own notes (`// upkit: …`) are left out of diffs.
- Also: an object was compared by path, and two can share one
  (`MarcPackage.boxCursor`): now by its index where it is the same object.
  Header fields are made one line.

### Verified

- **Every sample mod converts on the version it was made for**, checked as
  above:
  - Long War 1.0 (its installer's packages over vanilla's): Lightning
    Reflexes, Soldier Gender, EXALT Reminder, Sightlines (LW);
  - vanilla: Soldier Gender, the Mutator Enabler, Sightlines (EW) with
    `--with` the Enabler.
  - Enhanced Tactical Info: its code converts, its Flash movie is listed as
    not code, nothing written; `--partial` writes the code.
- **On the other versions**, each converted mod refuses, naming the function
  whose lines differ: vanilla, Long War 1.0 and LWR 2.06 rewrote the
  functions these scripts replace. Sightlines' two scripts convert to
  different mods, so one `.upkmod` does not serve both as converted. The
  scripts replace whole functions with version-specific code, and the
  conversion is faithful to that: it keeps constants written shorter,
  padding statements and hand-patch `__asm`. A mod written as small edits
  travels (upkit-source-mods: one mod on Long War and LWR).
- Tests (`upkit/test/convert.spec.ts`):
  - Lightning Reflexes converted, its options note, applies on Long War and
    refuses on vanilla;
  - Enhanced Tactical Info refused, then `--partial`;
  - Sightlines needs `--with` and leaves the Enabler and upkit's notes out;
  - a mod already installed refused.
  - The `.upkmod` tests are green with the new applier.
- **In the game (wingpu, vanilla)**: the converted Mutator Enabler,
  Sightlines and Soldier Gender, applied by `upkit apply` to the shipped
  packages, load and the game runs to the main menu. The Enabler's code runs
  at start: the log shows it looking for `XComMutator.XComMutatorLoader`
  (Sightlines' mutator package, which a real install puts beside it). Files
  restored.

### Not done

- What the converted Sightlines and Soldier Gender do in a battle or a new
  campaign was not seen: that is the campaign-level check, still open.
- A tidy option (dropping padding statements, keeping constants as the
  version had them) would make converted mods smaller and travel further,
  at the price of not being byte for byte what the script makes.

## Report (2026-10-23, later): --tidy

The person, on the tidy option, the campaign check and staging: "all three
sound good to me".

- `upkit convert --tidy`: in the lines the mod adds or changes (the
  original's own left alone), padding statements (`;` alone, a variable
  alone) are left out. Where a changed line is the original's but for a float
  constant's precision (`6.2831855` → `6.28319`), the original's is kept.
  The conversion says how many of each, and is checked against the tidied
  source.
- Measured on Long War 1.0's packages:

  | Mod | Plain | Tidy | On vanilla, changes not fitting (plain → tidy) | On LWR |
  |---|---|---|---|---|
  | Lightning Reflexes | 144 lines | 94 (24 padding, 3 constants) | 9 → 7 of 7 | 11 → 9 |
  | Soldier Gender | 34 | 23 (11 padding) | 1 → 1 | 1 → 1 |
  | EXALT Reminder | 112 | 112 | 1 of 8 | 3 of 5 |
  | Sightlines (LW) | 218 | 217 | 2 of 14 | 3 of 4 |

  What still does not fit is where the other version's own code differs in
  the lines the mod touches. Examples: Long War's `AddNotice` for EXALT
  Reminder, and a watch on `m_iMovesActionsPerformed` that only Long War has
  for Sightlines. Tidying does not change that, as it should not.
- Test: Lightning Reflexes tidied has no padding line and not the shortened
  constant, is under 80% of the plain one's size, and applies.

## Report (2026-10-23, later): in a campaign

On wingpu, with Steam Cloud switched off there for good (the person: "maybe
we just turn off cloud sync on wingpu permanently"), so a test campaign's
saves reach nobody's account.

- Soldier Gender, converted on vanilla's packages (its option as the script
  has it: 100% female), applied by `upkit apply` to the shipped
  XComGame.upk.
- A new campaign (Normal, no tutorial): base confirmed, first mission
  launched. Its autosave read with the app's own save reader
  (`src/save/parse.ts`, TSoldier.kAppearance.iGender): **12 soldiers, 12
  female**. Without the mod each is a coin flip: all twelve by chance is 1 in
  4,096. The Skyranger and the mission showed women too.
- The game's autosave at the launch overwrote one of the person's saves
  (save1741, an old autosave slot). The whole SaveData folder had been
  copied first: save1741 and profile.bin were put back, and every save
  checked against the copy by hash (none differs, none added). The game's
  files were restored (hash checked). Learning #176.
