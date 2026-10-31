import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Package, decompressPackage, readEnum } from '@innonova/upkit/upk'
import {
  applySettings,
  armorKitCodes,
  findSettings,
  settingsChanged,
  splitOldValues,
  type SettingDef,
} from '../gamesettings'

const FILE = [
  '[XComGame.XGTacticalGameCore]',
  'Characters=( strName="", iType=eChar_Civilian,   HP=3,  Mobility=11, kInventory=( iArmor=eItem_NONE, HP=99 ) )',
  'Characters=( strName="", iType=eChar_Soldier,    HP=4,  Offense=65,  Mobility=13, ShieldHP=0, kInventory=( iArmor=eItem_NONE ), eClass=eSC_None )',
  'NUM_STARTING_SOLDIERS=40',
  'ROOKIE_MOBILITY=104\t\t\t; xxyy: xx = Point cost for defense; yy = Point cost for mobility',
  'HIGH_WILL=3\t\t\t\t\t; Minimum Starting hp for rookie; midpoint set by soldier character entry',
  'HQ_BASE_POWER = 32\t\t\t; Sniper Color',
  'HQ_BASE_POWER = -1\t\t\t; Sniper Headgear',
  'Weapons=( strName="", iType=eItem_ArcThrower,  Properties[4]=eWP_Backpack,    Properties[5]=0,        iRange=27 )',
  ';Pistol slot arc thrower mod substitute line; comment out the line above and uncomment this one.',
  ';Weapons=( strName="", iType=eItem_ArcThrower,  Properties[4]=eWP_Backpack,    Properties[5]=eWP_Pistol,iRange=27 );',
  '; Arc Thrower',
  'Itembalance_Normal=(eItem=eItem_ArcThrower,\t\tiCash=100,\tiTime=10)',
  'BalanceMods_Classic=(eType=73,\t\t\t\tiDamage=0,\tiHP=0,\tiMobility=-2,\tiWill=40);',
  'NUM_STARTING_SOLDIERS=75   ; (LWR Default = 75) Male gender chance. Set to 100 to have all males.',
  '',
].join('\r\n')

const byId = (text: string) => new Map(findSettings(text).map((s) => [s.id, s]))
const def = (text: string, id: string): SettingDef => byId(text).get(id)!

describe('game settings in a player’s words (model/gamesettings.ts)', () => {
  it('finds each kind of setting, by key and comment, never by key alone', () => {
    const s = byId(FILE)
    expect(s.get('soldier.hp')?.value).toBe('4') // not the civilian's, not a nested HP
    expect(s.get('soldier.mobility')?.value).toBe('13')
    expect(s.get('campaign.starting-soldiers')?.value).toBe('40') // the uncommented one
    expect(s.get('lwr.num_starting_soldiers')?.name).toBe('Chance a recruit is male')
    expect(s.get('rookie.min-hp')?.value).toBe('3')
    expect(s.get('class.sniper.color')?.value).toBe('32')
    expect(s.get('class.sniper.headgear')?.type).toBe('headgear')
    expect(s.get('arcthrower.pistol')?.value).toBe('off')
    expect(s.get('item.73.mobility')).toMatchObject({
      name: 'Arc Thrower: mobility',
      item: { name: 'Arc Thrower', part: 'carried' },
      value: '-2',
    })
    expect(s.has('psi.gift')).toBe(false) // not in this file: not offered
  })

  it('Long War’s two point costs in one value: one setting each, the other half kept', () => {
    const s = byId(FILE)
    expect(s.get('rookie.cost-defense')?.value).toBe('1')
    expect(s.get('rookie.cost-mobility')?.value).toBe('4')
    const out = applySettings(FILE, [
      { def: def(FILE, 'rookie.cost-mobility'), value: '6' },
      { def: def(FILE, 'rookie.cost-defense'), value: '12' },
    ])
    expect(out.text).toContain('ROOKIE_MOBILITY=1206\t\t\t; xxyy')
    expect(
      applySettings(FILE, [{ def: def(FILE, 'rookie.cost-defense'), value: '0' }]).text,
    ).toContain('ROOKIE_MOBILITY=4\t')
    // Beyond two digits it cannot be written: said, not mangled.
    const bad = applySettings(FILE, [{ def: def(FILE, 'rookie.cost-mobility'), value: '100' }])
    expect(bad.missing.map((d) => d.id)).toEqual(['rookie.cost-mobility'])
    expect(bad.text).toBe(FILE)
  })

  it('values saved before the split come back as their two halves', () => {
    expect(splitOldValues({ 'rookie.cost-defense-mobility': '103', 'soldier.hp': '5' })).toEqual({
      'rookie.cost-defense': '1',
      'rookie.cost-mobility': '3',
      'soldier.hp': '5',
    })
    expect(splitOldValues({ 'item-mobility.73': '0' })).toEqual({ 'item.73.mobility': '0' })
    expect(splitOldValues({ 'rookie.cost-hp-will': '401' })).toEqual({
      'rookie.cost-hp': '4',
      'rookie.cost-will': '1',
    })
  })

  it('writes a value and nothing else on its line', () => {
    const { text, missing } = applySettings(FILE, [
      { def: def(FILE, 'soldier.hp'), value: '5' },
      { def: def(FILE, 'rookie.min-hp'), value: '4' },
      { def: def(FILE, 'class.sniper.color'), value: '16' },
      { def: def(FILE, 'item.73.mobility'), value: '0' },
      { def: def(FILE, 'arcthrower.pistol'), value: 'on' },
    ])
    expect(missing).toEqual([])
    const want = FILE.replace('HP=4,  Offense', 'HP=5,  Offense')
      .replace('HIGH_WILL=3\t', 'HIGH_WILL=4\t')
      .replace('HQ_BASE_POWER = 32\t', 'HQ_BASE_POWER = 16\t')
      .replace('iMobility=-2,', 'iMobility=0,')
      .replace(
        'Weapons=( strName="", iType=eItem_ArcThrower,  Properties[4]=eWP_Backpack,    Properties[5]=0,',
        ';Weapons=( strName="", iType=eItem_ArcThrower,  Properties[4]=eWP_Backpack,    Properties[5]=0,',
      )
      .replace(
        ';Weapons=( strName="", iType=eItem_ArcThrower,  Properties[4]=eWP_Backpack,    Properties[5]=eWP_Pistol',
        'Weapons=( strName="", iType=eItem_ArcThrower,  Properties[4]=eWP_Backpack,    Properties[5]=eWP_Pistol',
      )
    expect(text).toBe(want)
    expect(byId(text).get('arcthrower.pistol')?.value).toBe('on')
    // And back.
    expect(applySettings(text, [{ def: def(FILE, 'arcthrower.pistol'), value: 'off' }]).text).toBe(
      want
        .replace(
          ';Weapons=( strName="", iType=eItem_ArcThrower,  Properties[4]=eWP_Backpack,    Properties[5]=0,',
          'Weapons=( strName="", iType=eItem_ArcThrower,  Properties[4]=eWP_Backpack,    Properties[5]=0,',
        )
        .replace(
          'Weapons=( strName="", iType=eItem_ArcThrower,  Properties[4]=eWP_Backpack,    Properties[5]=eWP_Pistol',
          ';Weapons=( strName="", iType=eItem_ArcThrower,  Properties[4]=eWP_Backpack,    Properties[5]=eWP_Pistol',
        ),
    )
  })

  it('reads the Armor Kit codes Long War ships', () => {
    const codes = armorKitCodes(
      'Colors (thanks)\n0    tan top with black bottom\n32    black with black\n\nHeadgear (thanks)\n200 - Motorcycle helmet, closed \t\t(Deco 18)\n460 - Fedora\t\t\t(Deco 41)\n\nArmor deco:\n1 x\n',
    )
    expect([...codes.colors]).toEqual([
      ['0', 'tan top with black bottom'],
      ['32', 'black with black'],
    ])
    expect([...codes.headgear]).toEqual([
      ['200', 'Motorcycle helmet, closed'],
      ['460', 'Fedora'],
    ])
  })
})

// Long War's and LWR's own files, and the person's hand-edited one (git-ignored samples/).
const S = resolve(import.meta.dirname, '../../../samples')
const LW = `${S}/Long War Mod Manager 1.0d-620-1-0d/LongWarFiles/_Long War EW 1.0 for PC-88-1-0.exe/{app}/XComGame/Config/DefaultGameCore.ini`
const LWR = `${S}/lwr/LW Rebalance v2.06.00/Config/DefaultGameCore.ini`
const MINE = `${S}/DefaultGameCore.ini`
const read = (p: string) => readFileSync(p, 'latin1')

describe.skipIf(![LW, LWR, MINE].every(existsSync))('on the real files', () => {
  it('Long War: the catalogue finds its lines, with Long War’s values', () => {
    const s = byId(read(LW))
    expect(
      Object.fromEntries(
        [
          'campaign.starting-soldiers',
          'soldier.hp',
          'soldier.mobility',
          'rookie.min-hp',
          'psi.gift',
          'arcthrower.pistol',
          'arcthrower.stun',
          'class.sniper.color',
          'item.73.mobility',
        ].map((id) => [id, s.get(id)?.value]),
      ),
    ).toEqual({
      'campaign.starting-soldiers': '40',
      'soldier.hp': '4',
      'soldier.mobility': '13',
      'rookie.min-hp': '3',
      'psi.gift': '0.45',
      'arcthrower.pistol': 'off',
      'arcthrower.stun': '0.61',
      'class.sniper.color': '32',
      'item.73.mobility': '-2',
    })
  })

  it('LWR: keys Long War uses for other things are not offered as Long War’s', () => {
    const s = byId(read(LWR))
    expect(s.has('campaign.starting-soldiers')).toBe(false)
    expect(s.has('psi.gift')).toBe(false)
    expect(s.get('lwr.num_starting_soldiers')).toMatchObject({
      name: 'Chance a recruit is male',
      value: '75',
    })
    expect(s.has('arcthrower.pistol')).toBe(false) // LWR has no alternative line
    expect(s.get('soldier.hp')?.value).toBe('6')
  })

  it('LWR: every option named and placed by hand, none left to its comment', () => {
    const s = findSettings(read(LWR))
    const lwr = s.filter((d) => d.id.startsWith('lwr.'))
    expect(lwr.length).toBe(22)
    expect(lwr.filter((d) => d.group === 'LWR options').map((d) => d.name)).toEqual([])
    expect(byId(read(LWR)).get('lwr.species_point_limit')).toMatchObject({
      name: 'Barracks order',
      group: 'Interface',
      format: { kind: 'choice' },
    })
  })

  it('item mobility by the file’s own headings, the small items together', () => {
    for (const file of [LW, LWR]) {
      const items = findSettings(read(file)).filter((d) => d.group === 'Items')
      const of = (name: string) => items.find((d) => d.item?.name === name)?.section
      expect(items.every((d) => d.section)).toBe(true)
      expect(of('HE Grenade')).toBe('Grenades')
      expect(of('Carapace Armor')).toBe('Armor')
      expect(of('Laser Rifle')).toBe('Laser weapons')
      expect(of('Plasma Rifle')).toBe('Plasma weapons')
      expect(of('Medikit')).toBe('Small items')
      expect(of('Alien Trophy')).toBe('Small items')
      expect(of(file === LW ? 'MEC-1 Paladin' : 'MEC1 Paladin')).toBe('MEC suits')
    }
  })

  it('an item’s card: to build, as a weapon or armor, carried; packed numbers apart', () => {
    const XCG = `${S}/CookedPCConsole/XComGame.upk`
    const names = readEnum(
      new Package(decompressPackage(new Uint8Array(readFileSync(XCG)))),
      'EItemType',
    )
    const text = read(LW)
    const s = new Map(findSettings(text, names).map((d) => [d.id, d]))
    const card = (type: number) =>
      Object.fromEntries(
        [...s.values()]
          .filter((d) => d.item?.type === type)
          .map((d) => [d.id.split('.')[2], d.value]),
      )
    // The Mimic Beacon: meld and elerium in one number (25025), alloys and its perk in another.
    expect(card(88)).toMatchObject({
      cost: '150',
      meld: '25',
      elerium: '25',
      alloys: '2',
      days: '14',
    })
    // Long War's assault rifle (on the enum's ExaltAssaultRifle slot): 3 shots, 4 conserving.
    expect(card(212)).toMatchObject({ damage: '4', crit: '8', ammo: '3', 'ammo-conserving': '4' })
    // Carapace armor's own line.
    expect(card(60)).toMatchObject({ hp: '5', 'armor-mobility': '1', 'small-slots': '2' })
    // Written back into its field alone, the other half of a packed number kept.
    const out = applySettings(text, [
      { def: s.get('item.88.meld')!, value: '30' },
      { def: s.get('item.212.ammo')!, value: '5' },
      { def: s.get('item.60.hp')!, value: '6' },
    ]).text
    const changed = out.split(/\r?\n/).filter((l, i) => l !== text.split(/\r?\n/)[i])
    expect(changed).toHaveLength(3)
    expect(changed.join('\n')).toMatch(/eItem_MimicBeacon,.*iElerium=30025,/)
    expect(changed.join('\n')).toMatch(/iType=eItem_ExaltAssaultRifle,.*iSuppression=405,/)
    expect(changed.join('\n')).toMatch(/iType=eItem_ArmorCarapace,.*iHPBonus=6,/)
    // Without the enum, no weapon or armor parts; cost and carried still.
    const bare = findSettings(text).filter((d) => d.item?.type === 60)
    expect(new Set(bare.map((d) => d.item!.part))).toEqual(new Set(['build', 'carried']))
  })

  it('the person’s hand edits, read back as settings: exactly their list', () => {
    expect(
      settingsChanged(read(LW), read(MINE)).map((c) => `${c.def.id}: ${c.own} → ${c.now}`),
    ).toEqual([
      'campaign.starting-soldiers: 40 → 60',
      'soldier.hp: 4 → 5',
      'soldier.mobility: 13 → 14',
      'rookie.min-hp: 3 → 4',
      'rookie.min-mobility: 11 → 13',
      'rookie.cost-mobility: 4 → 3',
      'psi.gift: 0.45 → 0.65',
      'arcthrower.pistol: off → on',
      'arcthrower.stun: 0.61 → 0.85',
      'class.sniper.color: 32 → 16',
      'class.scout.color: 15 → 4',
      'class.rocketeer.color: 12 → 13',
      'class.assault.color: 21 → 18',
      'item.73.mobility: -2 → 0',
    ])
  })

  it('setting them on Long War’s own file gives the person’s file, but for spacing', () => {
    const own = read(LW)
    const s = byId(own)
    const { text, missing } = applySettings(
      own,
      settingsChanged(own, read(MINE)).map((c) => ({ def: s.get(c.def.id)!, value: c.now })),
    )
    expect(missing).toEqual([])
    const norm = (t: string) =>
      t
        .split(/\r?\n/)
        .map((l) => l.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
    expect(norm(text)).toEqual(norm(read(MINE)))
  })
})
