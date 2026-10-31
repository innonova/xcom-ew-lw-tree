// Putting a base under the player's setup (features/game-bases.md): plain
// Enemy Within, Long War, or LWR over Long War, with the mods, settings and
// mod files on top, all as one plan.
//
// Every file is known by its hash: the game's own (the table of plain Enemy
// Within's files), a base's (from the installers in the library), or one the
// app wrote. The setup is built from the base's files, or the game's own
// where the base has none, wherever those are found intact: in the game, in
// lwtree-backup/, or in Long War's own "(LW Backup)" copies. Before a file of
// the game's own is replaced, it is kept in lwtree-backup/ (if it is not
// there already); a file the app does not recognise is kept aside in
// lwtree-backup/found-<time>/. A file is removed only when the game does not
// have it and the app knows what it is.

import { iniBytes, iniText, mergeIni, setIniValues } from '@/model/inifile'
import { isUpkmod, runScript, scriptPackages } from '@innonova/upkit/modpatch'
import { scriptPackage, type Package } from '@innonova/upkit/upk'
import { applySettings } from '@/model/gamesettings'
import { hashOf, sha256, type CopySource, type GameFiles } from './gamefiles'
import { upkmodRunnerFor } from './upkmod'
import {
  BACKUP,
  GAME_INI,
  scriptFiles,
  sizeFileOf,
  type Change,
  type Managed,
  type Plan,
  type Wanted,
} from './setup'

/** The game's exe, under XEW: the one file outside XComGame the app writes. */
export const EXE = 'xew:Binaries/Win32/XComEW.exe'
export const EXE_BACKUP = `${BACKUP}/Binaries/Win32/XComEW.exe`

export interface ExePatch {
  description: string
  find: string
  replace: string
}
export interface BaseFileInfo {
  path: string
  size: number
  sha256: string
}
/** Long War or LWR, unpacked from the library (desktop/src/bases.ts). */
export interface BaseLayer {
  id: string
  kind: 'lw' | 'lwr'
  name: string
  /** By lower-case path under XComGame. */
  files: Map<string, BaseFileInfo>
  /** Paths its installer deletes (run_init.bat: the *.uncompressed_size files). */
  deletes: string[]
  exePatches: ExePatch[]
}
export interface BaseSetup {
  /** "Long War 1.0", "plain Enemy Within". */
  name: string
  /** The chosen base, bottom first: none for plain Enemy Within, [LW], or [LW, LWR]. */
  layers: BaseLayer[]
  /** Every base the library holds, to recognise their files. */
  known: BaseLayer[]
  /** Plain Enemy Within's files under XComGame: lower-case path → size and SHA-256 (or its start). */
  game: Map<string, { size: number; sha256: string }>
  read(layer: BaseLayer, path: string): Promise<Uint8Array>
}

type Hash = { size: number; sha256: string }
const lower = (s: string) => s.toLowerCase()
const isGame = (v: { size: number; sha256: string } | undefined, h: Hash | null) =>
  !!v && !!h && v.size === h.size && h.sha256.startsWith(v.sha256)
const stampOf = (d: Date) => d.toISOString().slice(0, 19).replace(/[:T]/g, '-')

function exeBytes(exe: Uint8Array, patches: ExePatch[], on: boolean): Uint8Array | string {
  const out = new Uint8Array(exe)
  const bytes = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)))
  const at = (b: Uint8Array) => {
    const hits: number[] = []
    for (let i = 0; i <= out.length - b.length; i++) {
      let k = 0
      while (k < b.length && out[i + k] === b[k]) k++
      if (k === b.length) hits.push(i)
    }
    return hits
  }
  for (const p of patches) {
    const [from, to] = on ? [bytes(p.find), bytes(p.replace)] : [bytes(p.replace), bytes(p.find)]
    const there = at(from)
    if (there.length === 1) out.set(to, there[0]!)
    else if (there.length > 1 || at(to).length !== 1)
      return `XComEW.exe is not one the Long War patch knows ("${p.description}"); it is left as it is.`
  }
  return out
}

export async function planBase(
  files: GameFiles,
  wanted: Wanted,
  managed: Managed,
  base: BaseSetup,
  now = new Date(),
): Promise<Plan> {
  const next: Managed = {
    originals: { ...managed.originals },
    written: Object.fromEntries(Object.entries(managed.written).map(([p, v]) => [p, [...v]])),
    created: [...managed.created],
  }
  const changes: Change[] = []
  const problems: string[] = []
  const found = `${BACKUP}/found-${stampOf(now)}`
  const hashes = new Map<string, Hash | null>()
  const hash = async (p: string) => {
    if (!hashes.has(p)) hashes.set(p, await hashOf(files, p))
    return hashes.get(p)!
  }

  /** The layer that provides a path, or the game itself, or nothing. */
  function target(lp: string): BaseLayer | 'game' | null {
    for (const l of [...base.layers].reverse()) if (l.files.has(lp)) return l
    if (base.layers.some((l) => l.deletes.some((d) => lower(d) === lp))) return null
    return base.game.has(lp) ? 'game' : null
  }
  /** What a file's bytes are: the game's own, a base's, the app's, or not known. */
  function known(path: string, h: Hash): 'game' | 'base' | 'ours' | null {
    const lp = lower(path)
    if (isGame(base.game.get(lp), h)) return 'game'
    if (base.known.some((l) => l.files.get(lp)?.sha256 === h.sha256)) return 'base'
    if (managed.written[path]?.includes(h.sha256)) return 'ours'
    return null
  }
  /** Where the game's own bytes of a file are, if anywhere. */
  async function gameCopy(path: string): Promise<{ from: string; hash: Hash } | null> {
    const v = base.game.get(lower(path))
    const name = path.split('/').pop()!
    for (const from of [path, `${BACKUP}/${path}`, `xew:Long War Files/(LW Backup) ${name}`]) {
      const h = await hash(from)
      if (isGame(v, h)) return { from, hash: h! }
    }
    return null
  }
  /** Copies to make before a file changes, so nothing is lost. */
  async function keepsFor(path: string, cur: Hash): Promise<Change['keep']> {
    const what = known(path, cur)
    if (what === 'base' || what === 'ours') return []
    if (what === null) return [{ from: path, to: `${found}/${path}`, sha256: cur.sha256 }]
    // The game's own: into lwtree-backup/, unless it is there already.
    const slot = `${BACKUP}/${path}`
    const there = await hash(slot)
    if (isGame(base.game.get(lower(path)), there)) return []
    const keep: NonNullable<Change['keep']> = []
    if (there && !known(path, there))
      keep.push({ from: slot, to: `${found}/${slot}`, sha256: there.sha256 })
    keep.push({ from: path, to: slot, sha256: cur.sha256 })
    next.originals[path] = cur.sha256
    return keep
  }
  const record = (path: string, sha: string) => {
    next.written[path] = [...new Set([...(next.written[path] ?? []), sha])].slice(-50)
  }

  /** The file as the base has it: bytes when they are to be worked on, else where to copy from. */
  async function baseOf(
    path: string,
    needBytes: boolean,
  ): Promise<
    | { absent: true }
    | { missing: true }
    | { bytes?: Uint8Array; source: CopySource; sha256: string; why: string }
  > {
    const t = target(lower(path))
    if (t === null) return { absent: true }
    if (t === 'game') {
      const c = await gameCopy(path)
      if (!c) return { missing: true }
      return {
        bytes: needBytes ? ((await files.read(c.from)) ?? undefined) : undefined,
        source: { game: c.from },
        sha256: c.hash.sha256,
        why: 'the game’s own',
      }
    }
    const f = t.files.get(lower(path))!
    return {
      bytes: needBytes ? await base.read(t, f.path) : undefined,
      source: { base: t.id, path: f.path },
      sha256: f.sha256,
      why: t.name,
    }
  }

  /** One file to the state wanted: written (bytes or a copy), removed, or left. */
  async function settle(
    path: string,
    want: { data?: Uint8Array; source?: CopySource; sha256: string } | null,
    why: string[],
  ) {
    const cur = await hash(path)
    if (!want) {
      if (!cur) return
      changes.push({ path, action: 'remove', why, keep: await keepsFor(path, cur) })
      next.created = next.created.filter((p) => p !== path)
      return
    }
    if (cur?.sha256 === want.sha256) return
    record(path, want.sha256)
    changes.push({
      path,
      action: cur ? 'write' : 'create',
      why,
      data: want.data,
      source: want.data ? undefined : want.source,
      sha256: want.sha256,
      keep: cur ? await keepsFor(path, cur) : [],
    })
  }
  const missingText = (path: string) =>
    `${path}: the game’s own copy is not at hand (a mod or version was put in before the app knew ` +
    `the game). Have Steam verify the game’s files, then apply again; it is left as it is.`

  // --- What the plan covers ------------------------------------------------------
  const scope = new Map<string, string>() // lower → path
  const add = (p: string) => scope.has(lower(p)) || scope.set(lower(p), p)
  for (const l of base.known) {
    for (const f of l.files.values()) add(f.path)
    for (const d of l.deletes) add(d)
  }
  for (const p of [...Object.keys(managed.originals), ...Object.keys(managed.written)])
    if (!p.startsWith('xew:')) add(p)

  // --- Packages: the base's, with every wanted script on them, in order -------------
  const upks = new Set<string>()
  for (const s of wanted.scripts) for (const n of scriptPackages(s.text)) upks.add(lower(n))
  const cooked = await files.list('CookedPCConsole')
  const pkgPath = (n: string) =>
    scope.get(`cookedpcconsole/${n}`) ??
    `CookedPCConsole/${cooked.find((f) => lower(f) === n) ?? n}`
  const pkgs = new Map<
    string,
    { path: string; base: Uint8Array; why: string; pkg: Package; plain: Uint8Array; compressed: boolean }
  >()
  for (const n of upks) {
    const path = pkgPath(n)
    add(path)
    const b = await baseOf(path, true)
    if ('missing' in b) problems.push(missingText(path))
    // A package shipped compressed is worked on decompressed (and written so if a mod changes it).
    if ('bytes' in b && b.bytes) pkgs.set(n, { path, base: b.bytes, why: b.why, ...scriptPackage(b.bytes) })
  }
  const results = new Map<string, Package>()
  const scriptWhy = new Map<string, string[]>()
  // .upkmod mods: compiled by upkit, with the base's script packages.
  const upkmod = await upkmodRunnerFor(
    wanted.scripts.map((s) => s.text),
    async (file) => {
      const b = await baseOf(pkgPath(lower(file)), true)
      return 'bytes' in b ? (b.bytes ?? null) : null
    },
  )
  for (const s of wanted.scripts) {
    const r = runScript(s.text, {
      open: (n) => (results.get(lower(n)) ?? pkgs.get(lower(n))?.pkg)?.clone(),
      values: s.values,
      readFile: scriptFiles(s),
      upkmod,
    })
    const err = r.steps.find((x) => x.status === 'error')
    if (err) {
      // A .upkmod that fits the base but not after the mods before it: it conflicts with them.
      let conflict = ''
      if (upkmod && isUpkmod(s.text)) {
        const alone = runScript(s.text, { open: (n) => pkgs.get(lower(n))?.pkg.clone(), readFile: scriptFiles(s), upkmod })
        const before = scriptWhy.get(lower(err.where.split(':')[0]!.trim())) ?? []
        if (alone.status !== 'does-not-fit' && before.length) conflict = `: it changes what ${before.join(', ')} changed before it`
      }
      problems.push(`${s.label} does not fit ${base.name} (${err.where}: ${err.note})${conflict}; it is left out.`)
      continue
    }
    for (const [n, pkg] of r.packages) {
      results.set(n, pkg)
      if (r.steps.some((x) => x.status === 'change' && x.where.toLowerCase().startsWith(n)))
        scriptWhy.set(n, [...(scriptWhy.get(n) ?? []), s.label])
    }
  }
  const done = new Set<string>()
  // Size files of packages compressed whole that are written decompressed: not there meanwhile.
  const sizeGone = new Map<string, string>()
  for (const [n, p] of pkgs) {
    // Unchanged by the scripts (a compressed one only read): the base's as it is.
    const changed = results.get(n)?.bytes
    const plainEqual = !!changed && changed.length === p.plain.length && changed.every((x, i) => x === p.plain[i])
    const data = changed && !plainEqual ? changed : p.base
    await settle(p.path, { data, sha256: await sha256(data) }, [p.why, ...(scriptWhy.get(n) ?? [])])
    done.add(lower(p.path))
    if (p.compressed && data !== p.base) {
      const sizePath = scope.get(lower(sizeFileOf(p.path))) ?? sizeFileOf(p.path)
      add(sizePath)
      sizeGone.set(lower(sizePath), `${p.path.split('/').pop()} is written decompressed`)
    }
  }

  // --- Config files: the base's, with the settings and mods' INI lines -------------
  const exists = async (path: string) => {
    if (scope.has(lower(path))) return target(lower(path)) !== null
    return !!(await hash(path))
  }
  const edits = new Map<string, { edit: (t: string) => string; why: string }[]>()
  const editConfig = (path: string, edit: (t: string) => string, why: string) =>
    edits.set(path, [...(edits.get(path) ?? []), { edit, why }])
  // The game settings first (features/game-settings.md); a line set by key below wins.
  const named = wanted.named ?? []
  if (named.length)
    editConfig(
      GAME_INI,
      (t) => {
        const { text, missing } = applySettings(t, named)
        for (const m of missing)
          problems.push(`“${m.name}” is not in ${base.name}'s DefaultGameCore.ini; it is left out.`)
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
          problems.push(`${m.key} is not in ${base.name}'s DefaultGameCore.ini; it is left out.`)
        return text
      },
      `${wanted.settings.length} setting${wanted.settings.length === 1 ? '' : 's'}`,
    )
  const keepCreated = new Set<string>()
  const config = await files.list('Config')
  for (const m of wanted.files)
    for (const f of m.files) {
      const name = f.path.split('/').pop()!
      const dir = f.kind === 'config' ? 'Config' : 'CookedPCConsole'
      const path =
        scope.get(lower(`${dir}/${name}`)) ??
        `${dir}/${(dir === 'Config' ? config : cooked).find((c) => lower(c) === lower(name)) ?? name}`
      const theirs = !managed.created.includes(path) && (await exists(path))
      if (theirs) {
        // The base or the game has it: an INI gets the mod's lines merged in; a
        // package is the game's own (LWR ships Sightlines.u).
        if (f.kind === 'config') editConfig(path, (t) => mergeIni(t, iniText(f.data)), m.label)
        continue
      }
      keepCreated.add(path)
      const sha = await sha256(f.data)
      if ((await hash(path))?.sha256 !== sha) {
        changes.push({ path, action: 'create', why: [m.label], data: f.data, sha256: sha })
        record(path, sha)
      }
      if (!next.created.includes(path)) next.created.push(path)
    }
  for (const [path, list] of edits) {
    add(path)
    const b = await baseOf(path, true)
    if ('absent' in b) {
      problems.push(`${path} is not in ${base.name}.`)
      continue
    }
    if ('missing' in b) {
      problems.push(missingText(path))
      continue
    }
    let text = iniText(b.bytes!)
    for (const e of list) text = e.edit(text)
    const data = iniBytes(text)
    await settle(path, { data, sha256: await sha256(data) }, [b.why, ...list.map((e) => e.why)])
    done.add(lower(path))
  }

  // --- Every other file a base touches: the base's, the game's own, or none -------
  for (const [lp, path] of [...scope].sort(([a], [b]) => a.localeCompare(b))) {
    if (done.has(lp) || keepCreated.has(path) || managed.created.includes(path)) continue
    if (sizeGone.has(lp)) {
      await settle(path, null, [sizeGone.get(lp)!])
      continue
    }
    const b = await baseOf(path, false)
    if ('missing' in b) {
      // Only a problem if the file is not the game's own already.
      const cur = await hash(path)
      if (!isGame(base.game.get(lp), cur)) problems.push(missingText(path))
      continue
    }
    if ('absent' in b) {
      const cur = await hash(path)
      if (!cur) continue
      // Gone only if the app knows what it is; anything else is kept aside first.
      await settle(path, null, [`not in ${base.name}`])
      continue
    }
    await settle(path, { source: b.source, sha256: b.sha256 }, [b.why])
  }

  // --- XComEW.exe: Long War's byte patches on, or off ------------------------------
  const patches = base.known.flatMap((l) => l.exePatches)
  if (patches.length) {
    const on = base.layers.some((l) => l.exePatches.length)
    const exe = await files.read(EXE)
    if (exe) {
      const want = exeBytes(exe, patches, on)
      if (typeof want === 'string') problems.push(want)
      else if (!want.every((x, i) => x === exe[i])) {
        const sha = await sha256(want)
        const keep = (await hash(EXE_BACKUP))
          ? []
          : [{ from: EXE, to: EXE_BACKUP, sha256: await sha256(exe) }]
        changes.push({
          path: EXE,
          action: 'write',
          why: [
            on
              ? `Long War's patches (${patches.map((p) => p.description).join('; ')})`
              : 'back to the game’s own',
          ],
          data: want,
          sha256: sha,
          keep,
        })
      }
    }
  }

  // --- Files the app put there for mods no longer wanted ---------------------------
  for (const path of managed.created)
    if (!keepCreated.has(path)) {
      if (await hash(path))
        changes.push({ path, action: 'remove', why: ['no longer in the setup'] })
      next.created = next.created.filter((p) => p !== path)
    }

  return { changes, problems, managed: next, base: base.name }
}
