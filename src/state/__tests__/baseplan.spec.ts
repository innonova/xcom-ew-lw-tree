import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { EXE, EXE_BACKUP, planBase, type BaseLayer, type BaseSetup } from '../baseplan'
import type { CopySource, GameFiles } from '../gamefiles'
import { BACKUP, applyPlan, emptyManaged, type Managed, type Wanted } from '../setup'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Package, scriptPackage } from '@innonova/upkit/upk'

const utf8 = (s: string) => new TextEncoder().encode(s)
const str = (b: Uint8Array | undefined) => (b ? new TextDecoder().decode(b) : undefined)
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

// A small made-up game: what matters is which bytes are whose.
const GAME: Record<string, string> = {
  'CookedPCConsole/XComGame.upk': 'game upk',
  'CookedPCConsole/XComGame.upk.uncompressed_size': '12518488',
  'CookedPCConsole/DLC2_3_Furies.upk': 'game furies',
  'Config/DefaultGameCore.ini': '[XComGame.XGTacticalGameCore]\r\nA=0\r\n',
  'Localization/INT/XComGame.int': 'game int',
}
const EXE_GAME = 'MZ..\xaa\xbb..rest'
const LW: Record<string, string> = {
  'CookedPCConsole/XComGame.upk': 'lw upk',
  'CookedPCConsole/LongWar.upk': 'lw longwar',
  'Config/DefaultGameCore.ini': '[XComGame.XGTacticalGameCore]\r\nA=1\r\n',
  'Localization/INT/XComGame.int': 'lw int',
}
const LWR: Record<string, string> = {
  'CookedPCConsole/XComGame.upk': 'lwr upk',
  'CookedPCConsole/DLC2_3_Furies.upk': 'lwr furies',
  'CookedPCConsole/LWRebalance.u': 'lwr rebalance',
  'Config/DefaultGameCore.ini': '[XComGame.XGTacticalGameCore]\r\nA=2\r\n',
}
const latin1 = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)))

function layer(
  id: string,
  kind: 'lw' | 'lwr',
  name: string,
  files: Record<string, string>,
): BaseLayer {
  return {
    id,
    kind,
    name,
    files: new Map(
      Object.entries(files).map(([p, t]) => [
        p.toLowerCase(),
        { path: p, size: utf8(t).length, sha256: sha(utf8(t)) },
      ]),
    ),
    deletes: kind === 'lw' ? ['CookedPCConsole/XComGame.upk.uncompressed_size'] : [],
    exePatches: kind === 'lw' ? [{ description: 'phone home', find: 'aabb', replace: 'ccdd' }] : [],
  }
}
const lw = layer('lw-id', 'lw', 'Long War 1.0', LW)
const lwr = layer('lwr-id', 'lwr', 'Long War Rebalanced 2.06.00', LWR)
const content: Record<string, Record<string, string>> = { 'lw-id': LW, 'lwr-id': LWR }

function setup(which: 'ew' | 'lw' | 'lwr'): BaseSetup {
  return {
    name: which === 'ew' ? 'plain Enemy Within' : which === 'lw' ? lw.name : lwr.name,
    layers: which === 'ew' ? [] : which === 'lw' ? [lw] : [lw, lwr],
    known: [lw, lwr],
    game: new Map(
      Object.entries(GAME).map(([p, t]) => [
        p.toLowerCase(),
        { size: utf8(t).length, sha256: sha(utf8(t)).slice(0, 32) },
      ]),
    ),
    read: async (l, p) => utf8(content[l.id]![p]!),
  }
}

/** A game folder in memory, case-insensitive like Windows, with the app's copy and hash. */
function memoryGame(start: Record<string, Uint8Array>) {
  const map = new Map(Object.entries(start))
  const key = (p: string) => [...map.keys()].find((k) => k.toLowerCase() === p.toLowerCase()) ?? p
  const files: GameFiles = {
    read: async (p) => map.get(key(p))?.slice() ?? null,
    file: async () => null,
    list: async (dir) =>
      [...map.keys()]
        .filter((k) => k.startsWith(`${dir}/`) && !k.slice(dir.length + 1).includes('/'))
        .map((k) => k.slice(dir.length + 1)),
    write: async (p, d) => void map.set(key(p), d.slice()),
    remove: async (p) => void map.delete(key(p)),
    canWrite: async () => true,
    hash: async (p) => {
      const b = map.get(key(p))
      return b ? { size: b.length, sha256: sha(b) } : null
    },
    copy: async (from: CopySource, to: string) => {
      const b = 'game' in from ? map.get(key(from.game)) : utf8(content[from.base]![from.path]!)
      if (!b) throw new Error(`no ${JSON.stringify(from)}`)
      map.set(key(to), b.slice())
    },
  }
  return { files, map }
}
const plainGame = () =>
  memoryGame({
    ...Object.fromEntries(Object.entries(GAME).map(([p, t]) => [p, utf8(t)])),
    [EXE]: latin1(EXE_GAME),
  })
/** The game files only (no backups), as text. */
const state = (map: Map<string, Uint8Array>) =>
  Object.fromEntries(
    [...map]
      .filter(([p]) => !p.startsWith(BACKUP) && !p.startsWith('xew:Long War Files'))
      .map(([p, b]) => [p, p === EXE ? String.fromCharCode(...b) : str(b)])
      .sort(),
  )
const nothing: Wanted = { scripts: [], files: [], settings: [] }

async function switchTo(
  g: ReturnType<typeof memoryGame>,
  which: 'ew' | 'lw' | 'lwr',
  m: Managed,
  w = nothing,
) {
  const plan = await planBase(g.files, w, m, setup(which))
  await applyPlan(g.files, plan)
  return plan
}

describe('a base under the setup (state/baseplan.ts)', () => {
  it('puts Long War into plain Enemy Within, keeping the game’s own first', async () => {
    const g = plainGame()
    const plan = await switchTo(g, 'lw', emptyManaged())
    expect(plan.problems).toEqual([])
    expect(state(g.map)).toEqual(
      Object.fromEntries(
        Object.entries({
          ...LW,
          'CookedPCConsole/DLC2_3_Furies.upk': 'game furies',
          [EXE]: 'MZ..\xcc\xdd..rest',
        }).sort(),
      ),
    )
    // The game's own of everything replaced or deleted, and the exe as found.
    expect(str(g.map.get(`${BACKUP}/CookedPCConsole/XComGame.upk`))).toBe('game upk')
    expect(str(g.map.get(`${BACKUP}/CookedPCConsole/XComGame.upk.uncompressed_size`))).toBe(
      '12518488',
    )
    expect(String.fromCharCode(...g.map.get(EXE_BACKUP)!)).toBe(EXE_GAME)
  })

  it('EW → LW → LWR → LW → EW comes back byte for byte', async () => {
    const g = plainGame()
    const before = state(g.map)
    let m = emptyManaged()
    const seen: Record<string, (string | undefined)[]> = {}
    for (const which of ['lw', 'lwr', 'lw', 'ew'] as const) {
      const plan = await switchTo(g, which, m)
      expect(plan.problems).toEqual([])
      m = plan.managed
      seen[which] = ['CookedPCConsole/DLC2_3_Furies.upk', 'CookedPCConsole/LongWar.upk'].map(
        (p) => str(g.map.get(p)),
      )
    }
    // On LWR: LWR's Furies, over Long War's files.
    expect(seen.lwr).toEqual(['lwr furies', 'lw longwar'])
    expect(state(g.map)).toEqual(before)
    // And once there, nothing more to do.
    expect((await planBase(g.files, nothing, m, setup('ew'))).changes).toEqual([])
  })

  it('takes the game’s own from Long War’s own backups when Long War was installed first', async () => {
    // As Long War's installer leaves it: its files, its "(LW Backup)" copies, the exe patched.
    const g = memoryGame({
      ...Object.fromEntries(Object.entries({ ...GAME, ...LW }).map(([p, t]) => [p, utf8(t)])),
      [EXE]: latin1('MZ..\xcc\xdd..rest'),
      ...Object.fromEntries(
        Object.keys(LW)
          .filter((p) => GAME[p])
          .map((p) => [`xew:Long War Files/(LW Backup) ${p.split('/').pop()}`, utf8(GAME[p]!)]),
      ),
      'xew:Long War Files/(LW Backup) XComGame.upk.uncompressed_size': utf8(
        GAME['CookedPCConsole/XComGame.upk.uncompressed_size']!,
      ),
    })
    g.map.delete('CookedPCConsole/XComGame.upk.uncompressed_size')
    const plan = await switchTo(g, 'ew', emptyManaged())
    expect(plan.problems).toEqual([])
    expect(state(g.map)).toEqual(
      Object.fromEntries(Object.entries({ ...GAME, [EXE]: EXE_GAME }).sort()),
    )
  })

  it('refuses to guess the game’s own: LWR put in by hand, back to Long War', async () => {
    // LWR copied over Long War by hand: nothing kept the game's own Furies.
    const g = memoryGame({
      ...Object.fromEntries(
        Object.entries({ ...GAME, ...LW, ...LWR }).map(([p, t]) => [p, utf8(t)]),
      ),
      [EXE]: latin1('MZ..\xcc\xdd..rest'),
    })
    g.map.delete('CookedPCConsole/XComGame.upk.uncompressed_size')
    const plan = await switchTo(g, 'lw', emptyManaged())
    expect(plan.problems).toHaveLength(1)
    expect(plan.problems[0]).toMatch(/DLC2_3_Furies\.upk: .*Steam verify/)
    expect(str(g.map.get('CookedPCConsole/DLC2_3_Furies.upk'))).toBe('lwr furies') // left as it is
    expect(str(g.map.get('CookedPCConsole/XComGame.upk'))).toBe('lw upk')
    expect(g.map.has('CookedPCConsole/LWRebalance.u')).toBe(false)
  })

  it('keeps a file it does not recognise aside before replacing or removing it', async () => {
    const g = plainGame()
    let m = (await switchTo(g, 'lw', emptyManaged())).managed
    // Changed by another tool.
    g.map.set('CookedPCConsole/LongWar.upk', utf8('hand patched'))
    g.map.set('Config/DefaultGameCore.ini', utf8('[XComGame.XGTacticalGameCore]\r\nA=9\r\n'))
    const plan = await planBase(g.files, nothing, m, setup('ew'), new Date('2026-10-19T20:00:00Z'))
    const kept = plan.changes.flatMap((c) => c.keep ?? []).map((k) => k.to)
    expect(kept).toContain(`${BACKUP}/found-2026-10-19-20-00-00/CookedPCConsole/LongWar.upk`)
    expect(kept).toContain(`${BACKUP}/found-2026-10-19-20-00-00/Config/DefaultGameCore.ini`)
    await applyPlan(g.files, plan)
    m = plan.managed
    expect(str(g.map.get(`${BACKUP}/found-2026-10-19-20-00-00/CookedPCConsole/LongWar.upk`))).toBe(
      'hand patched',
    )
    expect(g.map.has('CookedPCConsole/LongWar.upk')).toBe(false)
    expect(str(g.map.get('Config/DefaultGameCore.ini'))).toBe(GAME['Config/DefaultGameCore.ini'])
  })

  it('sets the player’s INI values on the base’s own file', async () => {
    const g = plainGame()
    const w: Wanted = {
      ...nothing,
      settings: [{ section: 'XComGame.XGTacticalGameCore', key: 'A', occurrence: 0, value: '7' }],
    }
    const plan = await switchTo(g, 'lwr', emptyManaged(), w)
    expect(plan.problems).toEqual([])
    expect(str(g.map.get('Config/DefaultGameCore.ini'))).toBe(
      '[XComGame.XGTacticalGameCore]\r\nA=7\r\n',
    )
    // Without the setting: LWR's own again.
    await switchTo(g, 'lwr', plan.managed)
    expect(str(g.map.get('Config/DefaultGameCore.ini'))).toBe(LWR['Config/DefaultGameCore.ini'])
  })

  it('leaves an exe the Long War patch does not know, and says so', async () => {
    const g = plainGame()
    g.map.set(EXE, latin1('MZ..a different build'))
    const plan = await planBase(g.files, nothing, emptyManaged(), setup('lw'))
    expect(plan.problems.join(' ')).toMatch(/XComEW\.exe is not one the Long War patch knows/)
    expect(plan.changes.some((c) => c.path === EXE)).toBe(false)
  })
})

// Plain Enemy Within as the base, its XComGame.upk compressed whole (features/tools-mods-complete.md).
const ewGame = resolve(import.meta.dirname, '../../../samples/ew/CookedPCConsole/XComGame.upk')
describe.skipIf(!existsSync(ewGame))('a mod on plain Enemy Within’s compressed XComGame.upk, as a base', () => {
  it('written decompressed with its size file gone (the game’s own kept), and back when the mod is out', async () => {
    const upk = new Uint8Array(readFileSync(ewGame))
    const size = utf8('12518488')
    const files = { 'CookedPCConsole/XComGame.upk': upk, 'CookedPCConsole/XComGame.upk.uncompressed_size': size }
    const base: BaseSetup = {
      name: 'plain Enemy Within',
      layers: [],
      known: [],
      game: new Map(Object.entries(files).map(([p, b]) => [p.toLowerCase(), { size: b.length, sha256: sha(b).slice(0, 32) }])),
      read: async () => new Uint8Array(),
    }
    const g = memoryGame({ ...files })
    const plain = scriptPackage(upk).pkg
    const data = plain.exportData(plain.findObject('XGUnit.RecordKill', true)).slice()
    data[data.length - 1] = data[data.length - 1]! ^ 1
    const w: Wanted = {
      scripts: [{ label: 'Data file mod', text: 'UPK_FILE=XComGame.upk\nMODDED_FILE=XGUnit.RecordKill.Function\n', values: {}, files: { 'xgunit.recordkill.function': data } }],
      files: [],
      settings: [],
    }
    const plan = await planBase(g.files, w, emptyManaged(), base)
    expect(plan.problems).toEqual([])
    await applyPlan(g.files, plan)
    const written = new Package(g.map.get('CookedPCConsole/XComGame.upk')!)
    expect(written.compressed).toBe(false)
    expect(written.exportData(written.findObject('XGUnit.RecordKill', true))).toEqual(data)
    expect(g.map.has('CookedPCConsole/XComGame.upk.uncompressed_size')).toBe(false)
    expect(sha(g.map.get(`${BACKUP}/CookedPCConsole/XComGame.upk`)!)).toBe(sha(upk))
    expect(g.map.get(`${BACKUP}/CookedPCConsole/XComGame.upk.uncompressed_size`)).toEqual(size)

    const back = await planBase(g.files, { ...w, scripts: [] }, plan.managed, base)
    expect(back.problems).toEqual([])
    await applyPlan(g.files, back)
    expect(sha(g.map.get('CookedPCConsole/XComGame.upk')!)).toBe(sha(upk))
    expect(g.map.get('CookedPCConsole/XComGame.upk.uncompressed_size')).toEqual(size)
  })
})
