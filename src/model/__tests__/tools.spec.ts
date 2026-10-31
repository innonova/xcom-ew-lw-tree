import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { optionProblem, parseModScript, scriptFor } from '@innonova/upkit/patchupk'
import { exportsByPath, headerSizeOf, readUpk } from '@innonova/upkit/upk'
import { fileKind, installKind } from '../../state/tools'

// A script in the shape of wghost81's Soldier Gender Probability.
const GENDER = `MOD_NAME=Soldier Gender Probability
AUTHOR=wghost81 aka Wasteland Ghost
DESCRIPTION=Set soldier gender probability

UPK_FILE=XComGame.upk
OBJECT=XGCharacterGenerator.CreateTSoldier

// Female probability: change 25 to whatever value you like between 0 and 100
ALIAS=FemaleProb:<%b25>

REL_OFFSET=0x121
[MODDED_CODE]
0F 35 <XGTacticalGameCoreNativeBase.TAppearance.iGender>
`
// And of eclipse666's EXALT Reminder: the description in a leading comment.
const EXALT = `/*
EXALT Reminder Mod for Long War - eclipse666

It will create "Scan for EXALT" reminders in the event list.
*/

UPK_FILE = XComStrategyGame.upk
OBJECT = XGHeadQuarters.OrderStaff : AUTO

// Create a reminder this many days after a covert extraction (default 9):
ALIAS=DaysAfterCovertOp:<%b 9>
ALIAS= fChance: <%f 0.5> // a multiplier

[REPLACEMENT_CODE]
07 [@notexaltreminder]
`

describe('PatcherGUI scripts (model/patchupk.ts)', () => {
  it('reads the name, author, description, target and options', () => {
    const m = parseModScript(GENDER, 'SoldierGenderEW.txt')
    expect([m.name, m.author, m.description]).toEqual([
      'Soldier Gender Probability',
      'wghost81 aka Wasteland Ghost',
      'Set soldier gender probability',
    ])
    expect(m.targets).toEqual([
      {
        upk: 'XComGame.upk',
        object: 'XGCharacterGenerator.CreateTSoldier',
        auto: false,
        sections: ['MODDED_CODE'],
      },
    ])
    expect(m.options).toEqual([
      {
        name: 'FemaleProb',
        kind: 'b',
        value: '25',
        help: 'Female probability: change 25 to whatever value you like between 0 and 100',
      },
    ])
  })

  it('takes the description from a leading comment, and options with comments beside them', () => {
    const m = parseModScript(EXALT, 'EXALTReminder.txt')
    expect(m.name).toBe('EXALT Reminder Mod for Long War')
    expect(m.author).toBe('eclipse666')
    expect(m.description).toContain('Scan for EXALT')
    expect(m.targets[0]).toMatchObject({ object: 'XGHeadQuarters.OrderStaff', auto: true })
    expect(m.options.map((o) => [o.name, o.kind, o.value, o.help])).toEqual([
      [
        'DaysAfterCovertOp',
        'b',
        '9',
        'Create a reminder this many days after a covert extraction (default 9):',
      ],
      ['fChance', 'f', '0.5', 'a multiplier'],
    ])
  })

  it('checks option values against their kind', () => {
    expect(optionProblem('b', '300')).not.toBe('')
    expect(optionProblem('b', '9')).toBe('')
    expect(optionProblem('f', '0.25')).toBe('')
    expect(optionProblem('f', 'x')).not.toBe('')
  })

  it('tells Long War scripts from plain Enemy Within ones by name', () => {
    expect(scriptFor('Sightlines_LW.txt')).toBe('lw')
    expect(scriptFor('Sightlines_EW.txt')).toBe('ew')
    expect(scriptFor('LightningReflexes.txt')).toBeUndefined()
  })

  it('counts only text files with UPK_FILE lines as scripts', () => {
    expect(fileKind('a.txt', GENDER)).toBe('script')
    expect(fileKind('CHANGELOG.txt', 'v1.4: fixes')).toBe('doc')
    expect(fileKind('Sightlines.u')).toBe('package')
    expect(fileKind('DefaultSightlines.ini', '[x]')).toBe('config')
  })
})

describe('installs (state/tools.ts)', () => {
  it('knows LWR by LWRebalance.u and Long War 1.0 by LongWar.upk', () => {
    expect(installKind(['XComGame.upk', 'LongWar.upk', 'LWRebalance.u'])).toBe('lwr')
    expect(installKind(['XComGame.upk', 'longwar.upk'])).toBe('lw')
    expect(installKind(['XComGame.upk'])).toBe('ew')
  })
})

const cooked = resolve(import.meta.dirname, '../../../samples/CookedPCConsole/XComStrategyGame.upk')
describe.skipIf(!existsSync(cooked))('reading a package (model/upk.ts)', () => {
  it('reads the tables from the header part alone, with full export names', () => {
    const b = new Uint8Array(readFileSync(cooked))
    const pk = readUpk(b.subarray(0, headerSizeOf(b.subarray(0, 64))))
    expect([pk.version, pk.compressed, pk.names.length, pk.exports.length]).toEqual([
      845,
      false,
      13854,
      22619,
    ])
    const paths = exportsByPath(pk)
    expect(paths.has('XGHeadQuarters.OrderStaff')).toBe(true)
    expect(paths.has('XGInterceptionEngagement.UpdateWeapons')).toBe(true)
  })
})
