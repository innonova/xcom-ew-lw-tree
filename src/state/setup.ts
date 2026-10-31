// Putting the player's setup into the game (features/game-tools.md): the
// mods they want, their files, their INI settings. Everything is worked out
// first (a plan: which files change, and why) and written only when the
// player says so.
//
// Each file the page changes is first copied, as it was, to
// XComGame/lwtree-backup/; that copy is the file's original. The setup is
// always built from the originals: mods are applied to them in library
// order, settings set, mod files merged in. So taking a mod out of the setup
// takes it out of the game. If a file is neither its original nor what the
// page last wrote (the game was reinstalled, or another tool changed it), the
// file as it now is becomes the new original.

import { isUpkmod, runScript, scriptPackages } from '@innonova/upkit/modpatch'
import { iniBytes, iniText, mergeIni, setIniValues, type IniChange } from '@/model/inifile'
import { scriptPackage, type Package } from '@innonova/upkit/upk'
import { applySettings, type SettingDef } from '@/model/gamesettings'
import { hashOf, sha256, type CopySource, type GameFiles } from './gamefiles'
import { upkmodRunnerFor } from './upkmod'

export const BACKUP = 'lwtree-backup'
export const GAME_INI = 'Config/DefaultGameCore.ini'

/** What the page knows about files it manages (kept per game folder). */
export interface Managed {
  /** SHA-256 of each file's original (its backup). */
  originals: Record<string, string>
  /**
   * SHA-256 of every version the page has written of each file. All of them,
   * not the last: a file found in any of these states is the page's own work,
   * even after an apply that was cut short.
   */
  written: Record<string, string[]>
  /** Files the page put there that the game did not have (mod files). */
  created: string[]
}
export const emptyManaged = (): Managed => ({ originals: {}, written: {}, created: [] })

/**
 * The bookkeeping lives beside the backups, in the game folder: it goes with
 * the install, not with the app's own data (a reinstall of the app, or a
 * second copy, finds the same record).
 */
export const MANIFEST = `${BACKUP}/manifest.json`

export async function loadManaged(files: GameFiles): Promise<Managed> {
  const b = await files.read(MANIFEST)
  if (!b) return emptyManaged()
  try {
    const m = { ...emptyManaged(), ...JSON.parse(new TextDecoder().decode(b)) } as Managed
    // Records from before 2026-10-19 kept one hash per file.
    for (const [p, v] of Object.entries(m.written as Record<string, string | string[]>))
      m.written[p] = Array.isArray(v) ? v : [v]
    return m
  } catch {
    return emptyManaged()
  }
}

/** Ours: the file is in a state the page wrote. */
const wroteIt = (managed: Managed, path: string, sha: string) =>
  managed.written[path]?.includes(sha) ?? false

export interface WantedScript {
  /** Shown in messages: "Lightning Reflexes (LightningReflexes.txt)". */
  label: string
  text: string
  values: Record<string, string>
  /** The files beside it in its mod (MODDED_FILE, BULK_FILE), by lower-case path from the script's folder. */
  files?: Record<string, Uint8Array>
}

/** The engine's file reader for a script: its mod's files beside it, in any case, with \ or /. */
export const scriptFiles = (s: { files?: Record<string, Uint8Array> }) => (name: string) =>
  s.files?.[name.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()]

/** The size file beside a package compressed whole: gone while the package is written decompressed. */
export const sizeFileOf = (path: string) => `${path}.uncompressed_size`
export interface WantedFiles {
  label: string
  files: { path: string; kind: 'package' | 'config'; data: Uint8Array }[]
}
export interface Wanted {
  scripts: WantedScript[]
  files: WantedFiles[]
  settings: IniChange[]
  /** Game settings in the player's words (model/gamesettings.ts), by their definitions. */
  named?: { def: SettingDef; value: string }[]
}

export interface Change {
  path: string
  action: 'write' | 'create' | 'remove'
  why: string[]
  data?: Uint8Array
  /** Written by copying (a base's file, or the game's own from where it is kept), not from data. */
  source?: CopySource
  /** SHA-256 of what is written (checked after a copy). */
  sha256?: string
  /** The file's current bytes become its original: copy them to the backup first. */
  backup?: Uint8Array
  /** Copies made before the file changes (the game's own, or a file the app does not know). */
  keep?: { from: string; to: string; sha256: string }[]
}
export interface Plan {
  changes: Change[]
  /** Things the setup asks for that cannot be done; they are left out. */
  problems: string[]
  /** Managed as it will be once the plan is written. */
  managed: Managed
  /** The base the plan puts in, when one was chosen (features/game-bases.md). */
  base?: string
}

const same = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((x, i) => x === b[i])
const lower = (s: string) => s.toLowerCase()

/** The original of a file the page may change, and its current bytes. */
async function original(
  files: GameFiles,
  path: string,
  managed: Managed,
): Promise<{ current: Uint8Array | null; base: Uint8Array | null; fresh: boolean }> {
  const current = await files.read(path)
  if (!current) return { current, base: null, fresh: false }
  const known = managed.originals[path]
  const backup = await files.read(`${BACKUP}/${path}`)
  if (known) {
    const sha = await sha256(current)
    if (wroteIt(managed, path, sha) || sha === known) {
      if (backup && (await sha256(backup)) === known) return { current, base: backup, fresh: false }
    }
  } else if (backup) {
    // A backup without a record (the record was lost): the backup is the
    // safer original; it is never overwritten on a guess.
    return { current, base: backup, fresh: false }
  }
  return { current, base: current, fresh: true }
}

export async function planSetup(files: GameFiles, wanted: Wanted, managed: Managed): Promise<Plan> {
  const next: Managed = {
    originals: { ...managed.originals },
    written: Object.fromEntries(Object.entries(managed.written).map(([p, v]) => [p, [...v]])),
    created: [...managed.created],
  }
  const changes: Change[] = []
  const problems: string[] = []
  const why = new Map<string, string[]>()
  const reason = (path: string, r: string) => why.set(path, [...(why.get(path) ?? []), r])

  async function settle(
    path: string,
    base: Uint8Array,
    current: Uint8Array,
    fresh: boolean,
    data: Uint8Array,
  ) {
    if (fresh || !next.originals[path]) next.originals[path] = await sha256(base)
    if (same(data, current)) return
    const sha = await sha256(data)
    next.written[path] = [...new Set([...(next.written[path] ?? []), sha])].slice(-50)
    changes.push({
      path,
      action: 'write',
      why: why.get(path) ?? ['back to its original'],
      data,
      backup: fresh ? current : undefined,
    })
  }

  // --- Packages: originals, then every wanted script on them in order ---------
  const upks = new Set<string>()
  for (const s of wanted.scripts) for (const n of scriptPackages(s.text)) upks.add(lower(n))
  for (const p of Object.keys(managed.originals))
    if (/^cookedpcconsole\/[^/]+\.upk$/i.test(p)) upks.add(lower(p.split('/')[1]!))
  // And whatever has a backup, record or not.
  for (const f of await files.list(`${BACKUP}/CookedPCConsole`))
    if (/\.upk$/i.test(f)) upks.add(lower(f))

  const bases = new Map<
    string,
    {
      path: string
      base: Uint8Array
      current: Uint8Array
      fresh: boolean
      pkg: Package
      plain: Uint8Array
      compressed: boolean
    }
  >()
  for (const name of upks) {
    const path = `CookedPCConsole/${(await files.list('CookedPCConsole')).find((f) => lower(f) === name) ?? name}`
    const o = await original(files, path, managed)
    if (!o.current || !o.base) continue
    // A package the game ships compressed is worked on decompressed (and written so if a mod changes it).
    bases.set(name, { path, base: o.base, current: o.current, fresh: o.fresh, ...scriptPackage(o.base) })
  }
  const results = new Map<string, Package>()
  const cooked = await files.list('CookedPCConsole')
  // .upkmod mods: compiled by upkit, with the game's script packages as they are originally.
  const upkmod = await upkmodRunnerFor(
    wanted.scripts.map((s) => s.text),
    async (file) => {
      const name = cooked.find((f) => lower(f) === lower(file))
      return name ? (await original(files, `CookedPCConsole/${name}`, managed)).base : null
    },
  )
  // Who changed each package so far (a .upkmod that fits the original but not after them: a conflict).
  const changedBy = new Map<string, string[]>()
  for (const s of wanted.scripts) {
    const r = runScript(s.text, {
      open: (n) => (results.get(lower(n)) ?? bases.get(lower(n))?.pkg)?.clone(),
      values: s.values,
      readFile: scriptFiles(s),
      upkmod,
    })
    const err = r.steps.find((x) => x.status === 'error')
    if (err) {
      problems.push(`${s.label} does not fit this install (${err.where}: ${err.note})${conflictWith(s, err.where)}; it is left out.`)
      continue
    }
    for (const [n, pkg] of r.packages) {
      results.set(n, pkg)
      if (r.steps.some((x) => x.status === 'change' && x.where.toLowerCase().startsWith(n))) {
        reason(bases.get(n)!.path, s.label)
        changedBy.set(n, [...(changedBy.get(n) ?? []), s.label])
      }
    }
  }
  /** For a .upkmod that fits the packages as they were before the mods ahead of it: which of them it conflicts with. */
  function conflictWith(s: WantedScript, where: string): string {
    if (!upkmod || !isUpkmod(s.text)) return ''
    const alone = runScript(s.text, { open: (n) => bases.get(lower(n))?.pkg.clone(), readFile: scriptFiles(s), upkmod })
    if (alone.status === 'does-not-fit') return ''
    const n = lower(where.split(':')[0]!.trim())
    const before = changedBy.get(n) ?? [...changedBy.values()].flat()
    return before.length ? `: it changes what ${before.join(', ')} changed before it` : ''
  }
  for (const [n, b] of bases) {
    // Unchanged by the scripts (a compressed one only read): its original as it is.
    const changed = results.get(n)?.bytes
    const data = changed && !same(changed, b.plain) ? changed : b.base
    await settle(b.path, b.base, b.current, b.fresh, data)
    // A package compressed whole, written decompressed: its size file goes (kept first), and
    // comes back with the original.
    if (!b.compressed) continue
    const name = cooked.find((f) => lower(f) === lower(sizeFileOf(b.path.split('/')[1]!)))
    const sizePath = `CookedPCConsole/${name ?? sizeFileOf(b.path.split('/')[1]!)}`
    const now = await files.read(sizePath)
    const kept = await files.read(`${BACKUP}/${sizePath}`)
    if (data !== b.base) {
      if (now) {
        if (!kept || !next.originals[sizePath]) next.originals[sizePath] = await sha256(now)
        changes.push({
          path: sizePath,
          action: 'remove',
          why: [`${b.path.split('/')[1]} is written decompressed`],
          backup: kept ? undefined : now,
        })
      }
    } else if (!now && kept && next.originals[sizePath]) {
      changes.push({ path: sizePath, action: 'write', why: ['back to its original'], data: kept })
    }
  }

  // --- Config files: settings and mods' INI lines on the originals ------------
  const configEdits = new Map<string, ((text: string) => string)[]>()
  const editConfig = (path: string, edit: (t: string) => string, r: string) => {
    configEdits.set(path, [...(configEdits.get(path) ?? []), edit])
    reason(path, r)
  }
  // The game settings first (features/game-settings.md); a line set by key below wins.
  const named = wanted.named ?? []
  if (named.length)
    editConfig(
      GAME_INI,
      (t) => {
        const { text, missing } = applySettings(t, named)
        for (const m of missing)
          problems.push(`“${m.name}” is not in DefaultGameCore.ini; it is left out.`)
        return text
      },
      `${named.length} game setting${named.length === 1 ? '' : 's'}`,
    )
  if (wanted.settings.length)
    editConfig(
      GAME_INI,
      (t) => {
        const { text, missing } = setIniValues(t, wanted.settings)
        for (const m of missing)
          problems.push(`${m.key} is not in DefaultGameCore.ini; it is left out.`)
        return text
      },
      `${wanted.settings.length} setting${wanted.settings.length === 1 ? '' : 's'}`,
    )
  const keep = new Set<string>()
  const config = await files.list('Config')
  for (const m of wanted.files)
    for (const f of m.files) {
      const name = f.path.split('/').pop()!
      if (f.kind === 'config') {
        const existing = config.find((c) => lower(c) === lower(name))
        const path = `Config/${existing ?? name}`
        if (existing && !managed.created.includes(path))
          editConfig(path, (t) => mergeIni(t, iniText(f.data)), m.label)
        else {
          keep.add(path)
          if (!existing || !same((await files.read(path)) ?? new Uint8Array(), f.data)) {
            changes.push({ path, action: 'create', why: [m.label], data: f.data })
            if (!next.created.includes(path)) next.created.push(path)
          }
        }
      } else {
        const existing = cooked.find((c) => lower(c) === lower(name))
        const path = `CookedPCConsole/${existing ?? name}`
        if (existing && !managed.created.includes(path)) continue // the game's own (LWR ships Sightlines.u)
        keep.add(path)
        if (!existing) {
          changes.push({ path, action: 'create', why: [m.label], data: f.data })
          if (!next.created.includes(path)) next.created.push(path)
        }
      }
    }
  const backedUpConfig = (await files.list(`${BACKUP}/Config`)).map((f) => `Config/${f}`)
  for (const path of [...Object.keys(managed.originals), ...backedUpConfig])
    if (path.startsWith('Config/')) configEdits.set(path, configEdits.get(path) ?? [])
  for (const [path, edits] of configEdits) {
    const o = await original(files, path, managed)
    if (!o.current || !o.base) {
      problems.push(`${path} is not in this install.`)
      continue
    }
    let text = iniText(o.base)
    for (const e of edits) text = e(text)
    await settle(path, o.base, o.current, o.fresh, iniBytes(text))
  }
  // Files the page put there for mods no longer wanted.
  for (const path of managed.created)
    if (!keep.has(path)) {
      changes.push({ path, action: 'remove', why: ['no longer in the setup'] })
      next.created = next.created.filter((p) => p !== path)
    }
  return { changes, problems, managed: next }
}

/**
 * Writes a plan: backups first, then the record (so whatever happens next,
 * every state a file can be left in is known as the page's own), then each
 * file, each checked by reading it back.
 */
export async function applyPlan(
  files: GameFiles,
  plan: Plan,
  progress?: (done: number, total: number, path: string) => void,
): Promise<string[]> {
  const log: string[] = []
  const copied = async (from: CopySource, to: string, sha: string) => {
    await files.copy!(from, to)
    if ((await hashOf(files, to))?.sha256 !== sha) throw new Error(`${to} did not copy whole`)
  }
  for (const c of plan.changes) {
    for (const k of c.keep ?? []) {
      await copied({ game: k.from }, k.to, k.sha256)
      log.push(`Kept ${k.from} as ${k.to}`)
    }
    if (c.backup) {
      await files.write(`${BACKUP}/${c.path}`, c.backup)
      const back = await files.read(`${BACKUP}/${c.path}`)
      if (!back || !same(back, c.backup))
        throw new Error(`the backup of ${c.path} did not read back the same`)
      log.push(`Kept the original of ${c.path} in ${BACKUP}/`)
    }
  }
  if (plan.changes.length)
    await files.write(MANIFEST, new TextEncoder().encode(JSON.stringify(plan.managed, null, 1)))
  for (const [i, c] of plan.changes.entries()) {
    progress?.(i, plan.changes.length, c.path)
    if (c.action === 'remove') {
      await files.remove(c.path)
      log.push(`Removed ${c.path}`)
      continue
    }
    if (c.source) await copied(c.source, c.path, c.sha256!)
    else {
      await files.write(c.path, c.data!)
      const back = await files.read(c.path)
      if (!back || !same(back, c.data!)) throw new Error(`${c.path} did not read back as written`)
    }
    log.push(`${c.action === 'create' ? 'Added' : 'Wrote'} ${c.path}`)
  }
  return log
}
