// The Tools page's state (features/game-tools.md, features/desktop-app.md):
// the player's game folder, what is installed there, their mod library and
// INI settings, and putting all of it into the game.
//
// Tools exists only in the desktop app: a web page cannot reach the game's
// files well enough (Chrome hides .ini files and Program Files from pages).
// The app finds the game the way installers do, or the player chooses the
// folder; every file goes through its bridge (state/desktop.ts). The mod
// library is the player's library folder (state/library.ts); nothing leaves
// the machine.

import { markRaw, reactive } from 'vue'
import {
  CATALOGUE,
  SPLIT_PARTS,
  armorKitCodes,
  findSettings,
  settingsChanged,
  type FoundSetting,
} from '@/model/gamesettings'
import { iniEntries, iniText, setIniValues, type IniChange, type IniEntry } from '@/model/inifile'
import { isUpkmod, runScript, scriptPackages, type RunResult, type Step } from '@innonova/upkit/modpatch'
import { parseModScript, type ModScript } from '@innonova/upkit/patchupk'
import {
  Package,
  decompressPackage,
  exportsByPath,
  headerSizeOf,
  readEnum,
  readUpk,
  scriptPackage,
  type Upk,
} from '@innonova/upkit/upk'
import { planBase, type BaseLayer, type BaseSetup } from './baseplan'
import { loadGameImages } from './gameimages'
import { upkmodRunnerFor } from './upkmod'
import { desktop, desktopFiles, type BaseFound, type BaseManifest } from './desktop'
import type { GameFiles } from './gamefiles'
import { stored } from './idb'
import {
  MODS,
  emptySettings,
  emptyVersion,
  freeName,
  modsIn,
  orderOf,
  readSettings,
  safeName,
  writeSettings,
  type GameKind,
  type ModChoices,
  type LibrarySettings,
  type SavedSetup,
  type VersionSetup,
} from './library'
import {
  GAME_INI,
  applyPlan,
  emptyManaged,
  loadManaged,
  planSetup,
  scriptFiles,
  type Managed,
  type Plan,
  type Wanted,
} from './setup'
import { loadIni, setGame, state } from './store'

export type InstallKind = 'lw' | 'lwr' | 'ew'

export interface PackageInfo {
  size: number
  compressed: boolean
  /** Full names of its exports ("XGUnit.RecordKill"). */
  exports: ReadonlySet<string>
}

export interface Install {
  kind: InstallKind
  /** Where the game's files are, under the folder picked ("XEW/XComGame"). */
  path: string
  /** The INI was found and loaded into the site. */
  ini: string | null
  /** File names in CookedPCConsole. */
  cooked: string[]
}

export type ModFileKind = 'script' | 'package' | 'config' | 'doc' | 'other'

export interface ModFile {
  /** Path inside the mod ("Sightlines.u", or the file's name for a single script). */
  path: string
  size: number
  kind: ModFileKind
  data: Blob
  /** For scripts: what it patches and its options. */
  script?: ModScript
}

export interface Mod {
  /** Its name in the library's Mods folder. */
  id: string
  name: string
  files: ModFile[]
  /** Option values the player set, by script path, then option name. */
  values: Record<string, Record<string, string>>
  /** From a README, for mods whose scripts say nothing. */
  readme?: string
  /** Scripts the player wants in the game, by path (unset: not decided yet). */
  wanted?: Record<string, boolean>
  /** The mod's own files (packages, INIs) go into the game too. */
  wantFiles?: boolean
}

/** A mod as 0.2 and earlier kept it in IndexedDB (moved to the library once). */
type StoredMod = Omit<Mod, 'files'> & { addedAt: number; files: Omit<ModFile, 'script'>[] }

export type CheckStatus = RunResult['status'] | 'checking' | 'other-values'
export interface ScriptCheck {
  status: CheckStatus
  steps: Step[]
}

export const tools = reactive({
  /** Tools runs in the desktop app only. */
  supported: !!desktop,
  status: 'off' as 'off' | 'reading' | 'ready',
  /** Where the app looked for the game when it could not find it. */
  looked: [] as string[],
  error: null as string | null,
  install: null as Install | null,
  /** Package tables read so far, by lower-case file name; null: not in the install. */
  packages: {} as Record<string, PackageInfo | null | 'reading'>,
  /** The player's library folder (Documents\Long War Tech Tree). */
  library: null as string | null,
  mods: [] as Mod[],
  /** Setups saved by name (features/game-setups.md), newest first. */
  setups: [] as { name: string; saved: string }[],
  /** The saved setup the choices now match, if any. */
  setupInUse: null as string | null,
  /** The saved setup last used or saved: the one the current choices came from. */
  setupFrom: null as string | null,
  /** Long War and LWR as the library holds them (installers, zips, folders). */
  bases: [] as BaseFound[],
  /**
   * The game version chosen (features/version-setups.md): its setup is the one
   * shown and put into the game. Null: the one installed.
   */
  base: null as GameKind | null,
  /** Each script's state in the install, by `${mod id}:${path}`. */
  checks: {} as Record<string, ScriptCheck>,
  /** The install's DefaultGameCore.ini, as settings. */
  iniEntries: [] as IniEntry[],
  /** The player's INI settings. */
  settings: [] as IniChange[],
  /** Game settings the version's DefaultGameCore.ini has, with its own values (model/gamesettings.ts). */
  gameSettings: [] as FoundSetting[],
  /** Whose values those are: "Long War 1.0", or "the file as the app found it". */
  gameSettingsFrom: '',
  /** The player's game settings, by id. */
  gameValues: {} as Record<string, string>,
  /** Where the game's file now differs from the version's own (edits made by hand). */
  handEdits: [] as { def: FoundSetting; own: string; now: string }[],
  /** The color setting the 3D soldier wears (set when its row, or its class's headgear, is used). */
  soldierFor: '',
  /** Long War's Armor Kit codes: what the color and headgear numbers look like. */
  codes: { colors: new Map<string, string>(), headgear: new Map<string, string>() },
  /** Putting the setup into the game. */
  plan: null as Plan | null,
  busy: null as string | null,
  log: [] as string[],
})

let files: GameFiles | null = null
let managed: Managed = emptyManaged()
/** The install's packages as they are now, by lower-case name (for the checks). */
let current = new Map<string, Package | null>()
const lower = (s: string) => s.toLowerCase()
export const checkKey = (m: Mod, f: ModFile) => `${m.id}:${f.path}`

// --- The game folder -----------------------------------------------------------

/** LWR ships LWRebalance.u; Long War 1.0 LongWar.upk; neither is plain Enemy Within. */
export function installKind(cooked: string[]): InstallKind {
  const has = (n: string) => cooked.some((c) => c.toLowerCase() === n.toLowerCase())
  if (has('LWRebalance.u')) return 'lwr'
  if (has('LongWar.upk')) return 'lw'
  return 'ew'
}

/** Reads what is installed, switches the site to that version and loads its INI. */
/**
 * The game's item enum (EItemType in XComGame.upk), to find an item's weapon
 * and armor lines (features/game-items.md); read once per install.
 */
let itemEnum: Promise<string[]> | null = null
function itemNames(): Promise<string[]> {
  itemEnum ??= (async () => {
    try {
      const b = files ? await files.read('CookedPCConsole/XComGame.upk') : null
      return b ? readEnum(new Package(decompressPackage(b)), 'EItemType') : []
    } catch {
      return []
    }
  })()
  return itemEnum
}

async function readInstall(): Promise<void> {
  if (!desktop) return
  tools.packages = {}
  tools.checks = {}
  current = new Map()
  itemEnum = null
  const game = await desktop.game.current()
  if (!game) {
    Object.assign(tools, { status: 'off', install: null, iniEntries: [] })
    files = null
    return
  }
  tools.status = 'reading'
  tools.error = null
  try {
    files = desktopFiles(desktop)
    const cooked = await files.list('CookedPCConsole')
    const kind = installKind(cooked)
    let ini: string | null = null
    const iniBytes = await files.read(GAME_INI)
    tools.iniEntries = markRaw(iniBytes ? iniEntries(iniText(iniBytes)) : [])
    if (kind !== 'ew') {
      setGame(kind)
      if (iniBytes) {
        loadIni('DefaultGameCore.ini', iniText(iniBytes))
        if (state.ini) ini = 'DefaultGameCore.ini'
      }
    }
    tools.install = { kind, path: game.root, ini, cooked }
    showVersion()
    managed = await loadManaged(files)
    await loadGameSettings(iniBytes ? iniText(iniBytes) : null)
    // The game's own pictures, for the views (features/game-images.md), in the background.
    void loadGameImages(files)
    tools.status = 'ready'
    void checkMods()
  } catch (e) {
    tools.error = (e as Error).message
    tools.status = 'off'
  }
}

/** A package's tables, read once per install (only the header part of the file). */
export async function readPackage(name: string): Promise<void> {
  const key = lower(name)
  if (!desktop || !tools.install || key in tools.packages) return
  const real = tools.install.cooked.find((c) => lower(c) === key)
  if (!real) {
    tools.packages[key] = null
    return
  }
  tools.packages[key] = 'reading'
  try {
    const path = `CookedPCConsole/${real}`
    // The tables from the header alone; a package the game ships compressed (whole, or in
    // chunks) read whole and decompressed, as mods are applied to it.
    let pk: Upk | null = null
    try {
      const head = (await desktop.game.read(path, 0, 64))!
      pk = readUpk((await desktop.game.read(path, 0, headerSizeOf(head)))!)
    } catch {
      pk = null
    }
    const compressed = !pk || pk.compressed
    if (compressed) pk = scriptPackage((await desktop.game.read(path))!).pkg
    tools.packages[key] = {
      size: 0,
      compressed,
      exports: markRaw(new Set(exportsByPath(pk!).keys())),
    }
  } catch {
    tools.packages[key] = null
  }
}

/** Finds the game the way installers do (Steam's registration with Windows). */
export async function findGameFolder(): Promise<void> {
  if (!desktop) return
  tools.status = 'reading'
  const r = await desktop.game.find()
  tools.looked = r.game ? [] : r.looked
  await readInstall()
}

/** The player chooses the folder. */
export async function chooseGameFolder(): Promise<void> {
  if (!desktop) return
  const r = await desktop.game.choose()
  tools.error = r.error
  if (r.game) {
    tools.looked = []
    await readInstall()
  }
}

export async function rereadInstall(): Promise<void> {
  await readInstall()
}

export async function forgetGameFolder(): Promise<void> {
  if (!desktop) return
  await desktop.game.forget()
  files = null
  void loadGameImages(null)
  current = new Map()
  Object.assign(tools, {
    status: 'off',
    error: null,
    install: null,
    packages: {},
    checks: {},
    iniEntries: [],
    plan: null,
    looked: [],
  })
}

/** The version in the game folder the app knows, for moving an older settings.json over. */
async function installedKind(): Promise<GameKind> {
  if (!desktop || !(await desktop.game.current())) return 'lw'
  return installKind(await desktopFiles(desktop).list('CookedPCConsole'))
}

/** On start-up in the app: the library, the settings, and the game (found the first time). */
export async function restoreTools(): Promise<void> {
  if (!desktop) return
  const lib = desktop.library
  if (lib) {
    try {
      tools.library = (await lib.info()).dir
      const read = await readSettings(lib, installedKind)
      choices = read?.settings ?? emptySettings()
      tools.base = choices.base ?? null
      // An older file moved over is written in its new shape at once, not at the first change.
      if (read?.moved) await saveChoices()
      await moveOldLibrary()
    } catch (e) {
      tools.error = `Could not read the library folder: ${(e as Error).message}`
    }
    await loadMods()
    await loadBases()
    // A mod copied into the folder by hand turns up when the app is back in front.
    window.addEventListener('focus', () => void rereadLibrary())
    desktop.bases?.onProgress((p) => {
      const b = tools.bases.find((x) => x.id === p.id)
      if (b && tools.busy?.startsWith('Unpacking'))
        tools.busy = `Unpacking ${b.name}: ${p.done + 1} of ${p.total} files (once)…`
    })
  }
  if (await desktop.game.current()) await readInstall()
  else await findGameFolder()
}

// --- Is it installed? ------------------------------------------------------------

async function currentPackage(name: string): Promise<Package | null> {
  const key = lower(name)
  if (current.has(key)) return current.get(key)!
  let pkg: Package | null = null
  const real = tools.install?.cooked.find((c) => lower(c) === key)
  if (files && real) {
    const bytes = await files.read(`CookedPCConsole/${real}`)
    try {
      // Decompressed if the game ships it compressed, as a mod is applied to it.
      pkg = bytes ? markRaw(scriptPackage(bytes).pkg) : null
    } catch {
      pkg = null
    }
  }
  current.set(key, pkg)
  return pkg
}

const upkNames = (text: string) => scriptPackages(text)

let checkRun = 0
/** Runs every script against the install as it is (on copies) and records what it finds. */
export async function checkMods(): Promise<void> {
  if (!files || !tools.install) return
  const run = ++checkRun
  const scripts = tools.mods.flatMap((m) =>
    m.files.filter((f) => f.kind === 'script').map((f) => ({ m, f })),
  )
  for (const { m, f } of scripts)
    tools.checks[checkKey(m, f)] = {
      status: 'checking',
      steps: tools.checks[checkKey(m, f)]?.steps ?? [],
    }
  // .upkmod mods: compiled by upkit, with the install's script packages.
  const texts = await Promise.all(scripts.map(({ f }) => f.data.text()))
  const upkmod = await upkmodRunnerFor(texts, async (file) => {
    const real = tools.install?.cooked.find((c) => lower(c) === lower(file))
    return real && files ? files.read(`CookedPCConsole/${real}`) : null
  })
  if (run !== checkRun) return
  for (const { m, f } of scripts) {
    const text = await f.data.text()
    for (const n of upkNames(text)) await currentPackage(n)
    if (run !== checkRun) return
    const open = (n: string) => current.get(lower(n))?.clone()
    const values = m.values[f.path] ?? {}
    const readFile = scriptFiles({ files: await filesBeside(m, f) })
    const r = runScript(text, { open, values, readFile, upkmod })
    let status: CheckStatus = r.status
    if (status !== 'installed' && Object.keys(values).length) {
      if (runScript(text, { open, readFile, upkmod }).status === 'installed') status = 'other-values'
    }
    tools.checks[checkKey(m, f)] = { status, steps: markRaw(r.steps) }
    // A mod first seen in the game counts as wanted there, in the setup of
    // the version installed (not in another version's).
    if (m.wanted?.[f.path] === undefined && gameKind() === tools.install.kind) {
      m.wanted = {
        ...m.wanted,
        [f.path]: status === 'installed' || status === 'other-values',
      }
      await save(m)
    }
    await new Promise((res) => setTimeout(res, 0))
  }
}

// --- The mod library: the player's library folder (state/library.ts) -------------

export function fileKind(path: string, text?: string): ModFileKind {
  const name = path.toLowerCase()
  if (/\.(u|upk)$/.test(name)) return 'package'
  if (name.endsWith('.ini')) return 'config'
  if (name.endsWith('.txt') && text !== undefined && /^\s*UPK_FILE\s*=/m.test(text)) return 'script'
  // A mod of upkit's own: source diffs (features/upkit-source-mods.md).
  if (name.endsWith('.upkmod') && text !== undefined && isUpkmod(text)) return 'script'
  if (/\.(txt|md|pdf|html?)$/.test(name)) return 'doc'
  return 'other'
}

/** The player's choices: settings.json in the library. */
let choices: LibrarySettings = emptySettings()
/** A version's setup in the choices (the chosen version's, by default), made when first needed. */
function setupOf(kind: GameKind = gameKind()): VersionSetup {
  return (choices.versions[kind] ??= emptyVersion())
}

/**
 * The chosen version's setup into the page: each mod as ticked and set for
 * it, in its order; its INI lines, game settings and saved setups.
 */
function showVersion(): void {
  const v = setupOf()
  for (const m of tools.mods) {
    const c = v.mods[m.id] ?? {}
    m.values = c.values ?? {}
    m.wanted = c.wanted
    m.wantFiles = c.wantFiles
  }
  const order = orderOf(
    tools.mods.map((m) => m.id),
    v.order,
  )
  tools.mods = order.map((id) => tools.mods.find((m) => m.id === id)!)
  v.order = order
  tools.settings = v.ini
  tools.gameValues = { ...v.game }
  tools.plan = null
  listSetups()
}
/** The library's Mods listing as last read, to see whether it changed. */
let listing = ''
let writing = Promise.resolve()

/** Writes settings.json, one write at a time. */
function saveChoices(): Promise<void> {
  const lib = desktop?.library
  if (!lib) return Promise.resolve()
  tools.setupInUse = setupInUse()
  const snapshot = JSON.parse(JSON.stringify(choices)) as LibrarySettings
  writing = writing
    .then(() => writeSettings(lib, snapshot))
    .catch((e) => {
      tools.error = `Could not write settings.json in the library: ${(e as Error).message}`
    })
  return writing
}

/** The first paragraph of a README, for a mod whose scripts carry no description. */
function readmeIntro(text: string): string {
  return (
    text
      .replace(/\r/g, '')
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .find((p) => p && !p.startsWith('#')) ?? ''
  )
}

/** Reads the mods in the library's Mods folder, in the player's order. */
async function loadMods(): Promise<void> {
  const lib = desktop?.library
  if (!lib) {
    tools.mods = []
    return
  }
  const files = await lib.files()
  listing = JSON.stringify(files.filter((f) => f.path.startsWith(`${MODS}/`)))
  const mods: Mod[] = []
  for (const g of modsIn(files)) {
    const modFiles: ModFile[] = []
    let readme: string | undefined
    for (const f of g.files) {
      const name = f.rel.split('/').pop()!
      const textual = /\.(txt|md|ini|upkmod)$/i.test(name)
      // Docs and other files are listed, not read.
      const bytes = textual || /\.(u|upk)$/i.test(name) ? await lib.read(f.path) : null
      const text = textual && bytes ? new TextDecoder().decode(bytes) : undefined
      const kind = fileKind(f.rel, text)
      if (/^readme/i.test(name) && text) readme = readmeIntro(text)
      modFiles.push({
        path: f.rel,
        size: f.size,
        kind,
        data: new Blob(bytes ? [bytes as BlobPart] : []),
        script: kind === 'script' ? parseModScript(text!, f.rel) : undefined,
      })
    }
    // A file on its own in Mods that is not a mod script is not a mod.
    if (!g.folder && modFiles[0]!.kind !== 'script') continue
    const c = setupOf().mods[g.id] ?? {}
    mods.push({
      id: g.id,
      name: g.folder ? g.id : modFiles[0]!.script!.name,
      files: modFiles,
      values: c.values ?? {},
      wanted: c.wanted,
      wantFiles: c.wantFiles,
      readme,
    })
  }
  const order = orderOf(
    mods.map((m) => m.id),
    setupOf().order,
  )
  tools.mods = order.map((id) => mods.find((m) => m.id === id)!)
  if (JSON.stringify(order) !== JSON.stringify(setupOf().order)) {
    setupOf().order = order
    void saveChoices()
  }
}

/** Reads the library again if its Mods folder changed (a mod copied in by hand). */
export async function rereadLibrary(): Promise<void> {
  const lib = desktop?.library
  if (!lib) return
  const files = await lib.files()
  void loadBases()
  if (JSON.stringify(files.filter((f) => f.path.startsWith(`${MODS}/`))) === listing) return
  await loadMods()
  void checkMods()
}

// --- The game version under the mods (features/game-bases.md) --------------------

async function loadBases(): Promise<void> {
  if (!desktop?.bases) return
  try {
    tools.bases = await desktop.bases.list()
  } catch (e) {
    tools.error = `Could not look through the library: ${(e as Error).message}`
  }
}

/** The Long War and LWR the library holds that a version would use. */
function basesFor(choice: GameKind): { lw?: BaseFound; lwr?: BaseFound } {
  const lws = tools.bases.filter((b) => b.kind === 'lw')
  const lw = lws.find((b) => b.version === '1.0') ?? lws[0]
  const lwr = tools.bases
    .filter((b) => b.kind === 'lwr')
    .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))[0]
  return choice === 'lw' ? { lw } : choice === 'lwr' ? { lw, lwr } : {}
}

/** Whether the library holds what it takes to put a version into the game. */
export function baseAvailable(choice: GameKind): boolean {
  if (choice === 'ew') return tools.bases.length > 0
  const { lw, lwr } = basesFor(choice)
  return choice === 'lw' ? !!lw : !!lw && !!lwr
}
/**
 * Whether a version can be chosen: the library can put it in, or it is the
 * one installed (the setup then goes on top of the game as it is).
 */
export function canChoose(choice: GameKind): boolean {
  return baseAvailable(choice) || tools.install?.kind === choice
}
export function baseName(choice: GameKind): string {
  const { lw, lwr } = basesFor(choice)
  if (choice === 'ew') return 'plain Enemy Within'
  if (choice === 'lw') return lw?.name ?? 'Long War'
  return lwr?.name ?? 'Long War Rebalanced'
}

/** Chooses a version: its own setup comes up, to be put into the game when the player applies. */
export async function setBase(choice: GameKind): Promise<void> {
  tools.base = choice
  choices.base = choice
  showVersion()
  await saveChoices()
  const current = files ? await files.read(GAME_INI) : null
  await loadGameSettings(current ? iniText(current) : null)
  void checkMods()
  // Its own files (settings, soldiers) come from its download: unpacked now, once.
  if (desktop?.bases && baseAvailable(choice) && tools.bases.some((b) => !b.unpacked)) {
    try {
      await baseSetup(choice)
      const now = files ? await files.read(GAME_INI) : null
      await loadGameSettings(now ? iniText(now) : null)
    } catch (e) {
      tools.error = (e as Error).message
    } finally {
      tools.busy = null
    }
  }
}

const layerOf = (m: BaseManifest): BaseLayer => ({
  id: m.id,
  kind: m.kind,
  name: m.name,
  files: new Map(m.files.map((f) => [f.path.toLowerCase(), f])),
  deletes: m.deletes,
  exePatches: m.exePatches,
})

/** Everything the planner needs for a base: every base in the library unpacked, the game's own files. */
async function baseSetup(choice: GameKind): Promise<BaseSetup> {
  const api = desktop!.bases!
  const known: BaseLayer[] = []
  // Every version in the library, to know their files when another is chosen.
  for (const [i, b] of tools.bases.entries()) {
    const of = tools.bases.length > 1 ? `, ${i + 1} of ${tools.bases.length} in the library` : ''
    tools.busy = b.unpacked
      ? `Reading ${b.name}${of}…`
      : b.kind === 'lw'
        ? `Unpacking ${b.name}${of}: reading the installer first (once, about 20 seconds)…`
        : `Unpacking ${b.name}${of}, once…`
    known.push(layerOf(await api.unpack(b.id)))
  }
  const { lw, lwr } = basesFor(choice)
  const layers = [lw, lwr].filter(Boolean).map((b) => known.find((k) => k.id === b!.id)!)
  const table = (await import('@/data/game-files.json')).default as unknown as Record<
    string,
    [number, string]
  >
  const game = new Map(
    Object.entries(table).map(([p, [size, sha256]]) => [p.toLowerCase(), { size, sha256 }]),
  )
  tools.bases = tools.bases.map((b) => ({ ...b, unpacked: true }))
  return {
    name: baseName(choice),
    layers,
    known,
    game,
    read: (layer, path) => api.read(layer.id, path),
  }
}

export function openLibrary(): void {
  void desktop?.library?.open()
}

async function save(m: Mod): Promise<void> {
  setupOf().mods[m.id] = { values: m.values, wanted: m.wanted, wantFiles: m.wantFiles }
  await saveChoices()
}

/**
 * Adds mods to the library: a script file on its own goes into Mods as it
 * is; files picked as a folder (they carry a relative path) become a folder
 * there, named after theirs.
 */
export async function addModFiles(picked: File[]): Promise<number> {
  const lib = desktop?.library
  if (!lib) return 0
  const groups = new Map<string, File[]>()
  for (const f of picked) {
    const folder = f.webkitRelativePath.split('/')[0]
    const key = folder && f.webkitRelativePath.includes('/') ? `dir:${folder}` : `file:${f.name}`
    groups.set(key, [...(groups.get(key) ?? []), f])
  }
  const taken = new Set(
    (await lib.files())
      .filter((f) => f.path.startsWith(`${MODS}/`))
      .map((f) => f.path.split('/')[1]!),
  )
  let added = 0
  for (const [key, group] of groups) {
    if (key.startsWith('file:')) {
      const f = group[0]!
      // A lone file that is not a mod script is not a mod.
      if (fileKind(f.name, await f.text()) !== 'script') continue
      const id = freeName(safeName(f.name), taken)
      await lib.write(`${MODS}/${id}`, new Uint8Array(await f.arrayBuffer()))
      taken.add(id)
    } else {
      const id = freeName(safeName(key.slice(4)), taken)
      for (const f of group) {
        const rel = f.webkitRelativePath.split('/').slice(1).join('/')
        await lib.write(`${MODS}/${id}/${rel}`, new Uint8Array(await f.arrayBuffer()))
      }
      taken.add(id)
    }
    added++
  }
  if (added) {
    await loadMods()
    void checkMods()
  }
  return added
}

/** Takes a mod out of the library: its files go to the recycle bin. */
export async function removeMod(id: string): Promise<void> {
  const lib = desktop?.library
  if (!lib) return
  try {
    await lib.trash(`${MODS}/${id}`)
  } catch (e) {
    tools.error = `Could not remove ${id}: ${(e as Error).message}`
    return
  }
  tools.mods = tools.mods.filter((m) => m.id !== id)
  // Gone from the library: from every version's setup.
  for (const v of Object.values(choices.versions)) {
    delete v.mods[id]
    v.order = v.order.filter((x) => x !== id)
  }
  await saveChoices()
}

/** Sets one option of one script; an empty value goes back to the script's own. */
export async function setOption(id: string, script: string, option: string, value: string) {
  const m = tools.mods.find((x) => x.id === id)
  if (!m) return
  const v = { ...m.values[script] }
  if (value === '') delete v[option]
  else v[option] = value
  m.values = { ...m.values, [script]: v }
  await save(m)
  void checkMods()
}

export async function setWanted(id: string, script: string, want: boolean) {
  const m = tools.mods.find((x) => x.id === id)
  if (!m) return
  m.wanted = { ...m.wanted, [script]: want }
  await save(m)
}

export async function setWantFiles(id: string, want: boolean) {
  const m = tools.mods.find((x) => x.id === id)
  if (!m) return
  m.wantFiles = want
  await save(m)
}

/**
 * Mods and settings kept in the app's IndexedDB before the library folder
 * (0.2 and earlier): written out to the library once, then dropped there.
 */
async function moveOldLibrary(): Promise<void> {
  const lib = desktop?.library
  if (!lib) return
  const old = await stored<StoredMod[]>('mods', 'readonly', (s) => s.getAll()).catch(
    () => [] as StoredMod[],
  )
  const oldIni = await stored<IniChange[] | undefined>('state', 'readonly', (s) =>
    s.get('settings'),
  ).catch(() => undefined)
  if (!old.length && !oldIni?.length) return
  const taken = new Set(
    (await lib.files())
      .filter((f) => f.path.startsWith(`${MODS}/`))
      .map((f) => f.path.split('/')[1]!),
  )
  for (const m of old.sort((a, b) => a.addedAt - b.addedAt)) {
    const only = m.files.length === 1 ? m.files[0]! : null
    const loose = !!only && only.kind === 'script' && !only.path.includes('/')
    const id = freeName(safeName(loose ? only!.path : m.name), taken)
    taken.add(id)
    for (const f of m.files) {
      const data = new Uint8Array(await f.data.arrayBuffer())
      await lib.write(loose ? `${MODS}/${id}` : `${MODS}/${id}/${f.path}`, data)
    }
    setupOf().mods[id] = { values: m.values, wanted: m.wanted, wantFiles: m.wantFiles }
    setupOf().order.push(id)
  }
  if (oldIni?.length && !setupOf().ini.length) setupOf().ini = oldIni
  await saveChoices()
  await stored('mods', 'readwrite', (s) => s.clear()).catch(() => undefined)
  await stored('state', 'readwrite', (s) => s.delete('settings')).catch(() => undefined)
}

// --- INI settings ----------------------------------------------------------------

const sameSetting = (a: IniChange, b: IniChange) =>
  a.section === b.section && a.key === b.key && a.occurrence === b.occurrence

/** Sets (or, with value null, drops) one of the player's INI settings. */
export async function setSetting(entry: IniChange, value: string | null) {
  const rest = tools.settings.filter((s) => !sameSetting(s, entry))
  tools.settings = value === null ? rest : [...rest, { ...entry, value }]
  setupOf().ini = JSON.parse(JSON.stringify(tools.settings))
  await saveChoices()
}

// --- Game settings in the player's words (features/game-settings.md) ------------

/**
 * The version's own DefaultGameCore.ini: the chosen base's (if the library
 * holds it unpacked), else the original the app kept, else the file as it is.
 */
async function ownIni(current: string | null): Promise<{ text: string; from: string } | null> {
  if (!files) return null
  const kind = gameKind()
  if (kind !== 'ew' && desktop?.bases) {
    const { lw, lwr } = basesFor(kind)
    const top = kind === 'lwr' ? lwr : lw
    if (top?.unpacked) {
      try {
        return {
          text: iniText(await desktop.bases.read(top.id, GAME_INI)),
          from: `${top.name}’s own`,
        }
      } catch {
        // not in that base: below
      }
    }
  }
  const kept = await files.read(`lwtree-backup/${GAME_INI}`)
  if (kept) return { text: iniText(kept), from: 'the original the app kept' }
  return current === null ? null : { text: current, from: 'the game’s file as it is' }
}

/**
 * A split setting's half saved equal to the version's own is none of the
 * player's: Long War's point costs were one value (xxyy) until 2026-10-20,
 * and a saved 103 comes back as defense 1 (Long War's own) and mobility 3.
 * Taken out of the current choices and the saved setups alike, so a setup
 * still reads as in use.
 */
function pruneSplitHalves(kind: GameKind) {
  const own = new Map(
    tools.gameSettings.filter((d) => SPLIT_PARTS.has(d.id)).map((d) => [d.id, d.value]),
  )
  const pruned = (v?: Record<string, string>) =>
    v && Object.fromEntries(Object.entries(v).filter(([id, x]) => own.get(id) !== x))
  tools.gameValues = pruned(tools.gameValues)!
  const v = setupOf(kind)
  v.game = pruned(v.game)!
  for (const s of Object.values(v.setups)) s.game = pruned(s.game)!
}

/** The version chosen, whose setup is shown: the one picked, else the one installed. */
export function gameKind(): GameKind {
  return tools.base ?? tools.install?.kind ?? 'lw'
}

async function loadGameSettings(current: string | null): Promise<void> {
  tools.gameValues = { ...setupOf().game }
  const own = await ownIni(current)
  // The version's own file with the player's own lines set in it, as the setup writes them
  // ("any line of DefaultGameCore.ini"): a value they set there is the one a setting shows,
  // and the app's own write is no edit by hand.
  const ownText = own && tools.settings.length ? setIniValues(own.text, tools.settings).text : own?.text
  const names = await itemNames()
  tools.gameSettings = markRaw(ownText ? findSettings(ownText, names) : [])
  tools.gameSettingsFrom = own?.from ?? ''
  pruneSplitHalves(gameKind())
  // Hand edits: where the file differs from the version's own, other than by
  // the player's settings already. Only for the version in the game: another
  // version's own file differs from the game's everywhere they differ.
  tools.handEdits = markRaw(
    ownText && current !== null && ownText !== current && gameKind() === tools.install?.kind
      ? settingsChanged(ownText, current, names).filter(
          (c) => tools.gameValues[c.def.id] !== c.now,
        )
      : [],
  )
  // Long War's Armor Kit codes: beside the game (its installer put them there), or in its base.
  let codes = files
    ? await files.read('xew:Long_War_EW_Armor_Kit_Codes.txt').catch(() => null)
    : null
  for (const b of tools.bases.filter((x) => x.kind === 'lw' && x.unpacked))
    codes ??=
      (await desktop?.bases?.doc?.(b.id, 'Long_War_EW_Armor_Kit_Codes.txt').catch(() => null)) ??
      null
  tools.codes = markRaw(
    codes ? armorKitCodes(iniText(codes)) : { colors: new Map(), headgear: new Map() },
  )
}

/**
 * Which DefaultContent.ini the soldier is drawn from (features/game-soldiers.md),
 * as a key that changes when it does: the chosen version's own once the
 * library has it unpacked, else the game's.
 */
export function contentKey(): string {
  const kind = gameKind()
  if (kind === tools.install?.kind) return `game:${kind}`
  const { lw, lwr } = basesFor(kind)
  const top = kind === 'lwr' ? lwr : kind === 'lw' ? lw : undefined
  return top?.unpacked ? `base:${top.id}` : kind === 'ew' ? 'backup' : `game:${kind}`
}

/**
 * The chosen version's DefaultContent.ini: the soldiers' heads, hair and
 * armor kits. LWR dresses its soldiers otherwise than Long War (its Kevlar
 * wears the LMG kit with any rifle), so another version than the one in the
 * game is drawn from its own file: from the library, or for plain Enemy
 * Within the original the app kept.
 */
export async function versionContent(): Promise<Uint8Array | null> {
  const key = contentKey()
  const path = 'Config/DefaultContent.ini'
  if (key.startsWith('base:') && desktop?.bases)
    try {
      return await desktop.bases.read(key.slice(5), path)
    } catch {
      // not in that version's files: the game's below
    }
  if (key === 'backup' && files) {
    const kept = await files.read(`lwtree-backup/${path}`)
    if (kept) return kept
  }
  return (await desktop?.game.read(path)) ?? null
}

/** A game setting's name by its id, where the catalogue knows it. */
function settingName(id: string): string {
  return CATALOGUE.find((d) => d.id === id)?.name ?? id
}

/** Sets (or, with null or the version's own value, drops) one game setting. */
export async function setGameValue(id: string, value: string | null): Promise<void> {
  const own = tools.gameSettings.find((s) => s.id === id)?.value
  const next = { ...tools.gameValues }
  if (value === null || value.trim() === '' || value.trim() === own) delete next[id]
  else next[id] = value.trim()
  tools.gameValues = next
  setupOf().game = { ...next }
  await saveChoices()
}

/** The game's file as edited by hand becomes the player's settings. */
export async function adoptHandEdits(): Promise<void> {
  const next = { ...tools.gameValues }
  for (const c of tools.handEdits) next[c.def.id] = c.now
  tools.gameValues = next
  tools.handEdits = []
  setupOf().game = { ...next }
  await saveChoices()
}

// --- Setups saved by name (features/game-setups.md) -------------------------------

/** The choices that make up the chosen version's setup, as they are now. */
function snapshot(): Omit<SavedSetup, 'saved'> {
  const mods: Record<string, ModChoices> = {}
  for (const m of tools.mods)
    mods[m.id] = JSON.parse(
      JSON.stringify({ values: m.values, wanted: m.wanted ?? {}, wantFiles: !!m.wantFiles }),
    )
  return JSON.parse(JSON.stringify({ mods, ini: tools.settings, game: tools.gameValues }))
}
/** The same choices: what was ticked and set (a mod never ticked counts as not). */
function sameSetup(a: Omit<SavedSetup, 'saved'>, b: Omit<SavedSetup, 'saved'>): boolean {
  const norm = (s: Omit<SavedSetup, 'saved'>) => {
    const mods = Object.fromEntries(
      Object.entries(s.mods)
        .map(([id, c]) => {
          const wanted = Object.fromEntries(Object.entries(c.wanted ?? {}).filter(([, w]) => w))
          const values = Object.fromEntries(
            Object.entries(c.values ?? {}).filter(([, v]) => Object.keys(v).length),
          )
          return [id, { wanted, values, files: !!c.wantFiles }] as const
        })
        .filter(([, c]) => Object.keys(c.wanted).length || c.files)
        .sort(([x], [y]) => x.localeCompare(y)),
    )
    const sorted = (o: object): unknown =>
      Array.isArray(o)
        ? o.map((x) => (x && typeof x === 'object' ? sorted(x) : x))
        : Object.fromEntries(
            Object.entries(o)
              .sort(([x], [y]) => x.localeCompare(y))
              .map(([k, v]) => [k, v && typeof v === 'object' ? sorted(v) : v]),
          )
    return JSON.stringify(sorted({ mods, ini: s.ini, game: s.game }))
  }
  return norm(a) === norm(b)
}
function setupInUse(): string | null {
  const now = snapshot()
  return Object.entries(setupOf().setups).find(([, s]) => sameSetup(s, now))?.[0] ?? null
}
function listSetups() {
  const v = setupOf()
  tools.setups = Object.entries(v.setups)
    .map(([name, s]) => ({ name, saved: s.saved }))
    .sort((a, b) => b.saved.localeCompare(a.saved))
  tools.setupInUse = setupInUse()
  const from = tools.setupInUse ?? v.setupFrom ?? null
  tools.setupFrom = from && v.setups[from] ? from : null
}

/**
 * A name for the setup as it is now, to offer when saving: how many mods are
 * ticked and settings set ("2 mods · 14 settings"), made unique among the
 * version's saved ones. The version needs no saying: the setups are its own.
 */
export function suggestSetupName(): string {
  const mods = tools.mods.filter((m) => Object.values(m.wanted ?? {}).some(Boolean)).length
  const settings = Object.keys(tools.gameValues).length + tools.settings.length
  const parts: string[] = []
  if (mods) parts.push(`${mods} mod${mods === 1 ? '' : 's'}`)
  if (settings) parts.push(`${settings} setting${settings === 1 ? '' : 's'}`)
  const base = parts.join(' · ') || 'As it comes'
  let name = base
  for (let n = 2; tools.setups.some((x) => x.name === name); n++) name = `${base} (${n})`
  return name
}

/** Saves the setup as it is now under a name (replacing one of that name). */
export async function saveSetup(name: string): Promise<void> {
  const n = name.trim()
  if (!n) return
  const v = setupOf()
  v.setups = { ...v.setups, [n]: { saved: new Date().toISOString(), ...snapshot() } }
  v.setupFrom = n
  listSetups()
  await saveChoices()
}

/**
 * Puts one of the version's saved setups back: every mod as it was ticked
 * and set then (mods added since are left out), the INI and game settings.
 * Written into the game when the player applies, as always.
 */
export async function useSetup(name: string): Promise<void> {
  const v = setupOf()
  const s = v.setups[name]
  if (!s) return
  for (const m of tools.mods) {
    const c = s.mods[m.id]
    m.values = { ...c?.values }
    m.wanted = Object.fromEntries(
      m.files.filter((f) => f.kind === 'script').map((f) => [f.path, !!c?.wanted?.[f.path]]),
    )
    m.wantFiles = !!c?.wantFiles
    v.mods[m.id] = { values: m.values, wanted: m.wanted, wantFiles: m.wantFiles }
  }
  v.ini = JSON.parse(JSON.stringify(s.ini))
  tools.settings = v.ini
  v.game = JSON.parse(JSON.stringify(s.game))
  tools.plan = null
  v.setupFrom = name
  const current = files ? await files.read(GAME_INI) : null
  await loadGameSettings(current ? iniText(current) : null)
  listSetups()
  await saveChoices()
  void checkMods()
}

/**
 * The choices back to what the game has now (features/game-setups.md): the
 * version installed, and in its setup the mods ticked whose scripts are in
 * the game (one in it with other option values than the player's set keeps
 * the script's own); the game settings the game's file has where they differ
 * from the version's own; the INI lines the file already has. Applied, it
 * changes nothing.
 */
export async function resetToGame(): Promise<void> {
  if (!files || !tools.install) return
  tools.base = tools.install.kind
  choices.base = tools.install.kind
  showVersion()
  const v = setupOf()
  for (const m of tools.mods) {
    const scripts = m.files.filter((f) => f.kind === 'script')
    const status = (f: ModFile) => tools.checks[checkKey(m, f)]?.status
    m.wanted = Object.fromEntries(
      scripts.map((f) => [f.path, status(f) === 'installed' || status(f) === 'other-values']),
    )
    m.values = Object.fromEntries(
      Object.entries(m.values).filter(
        ([path]) => !scripts.some((f) => f.path === path && status(f) === 'other-values'),
      ),
    )
    v.mods[m.id] = { values: m.values, wanted: m.wanted, wantFiles: m.wantFiles }
  }
  // INI lines: those the game's file already has.
  tools.settings = tools.settings.filter(
    (c) =>
      tools.iniEntries.find(
        (e) => e.section === c.section && e.key === c.key && e.occurrence === c.occurrence,
      )?.value === c.value,
  )
  v.ini = tools.settings
  // Game settings: everything the file has that the version's own does not.
  tools.gameValues = {}
  v.game = {}
  tools.plan = null
  const current = await files.read(GAME_INI)
  await loadGameSettings(current ? iniText(current) : null)
  const values = Object.fromEntries(tools.handEdits.map((c) => [c.def.id, c.now]))
  tools.gameValues = values
  tools.handEdits = []
  v.game = { ...values }
  delete v.setupFrom
  listSetups()
  await saveChoices()
  void checkMods()
}

export async function deleteSetup(name: string): Promise<void> {
  const v = setupOf()
  const next = { ...v.setups }
  delete next[name]
  v.setups = next
  if (v.setupFrom === name) delete v.setupFrom
  listSetups()
  await saveChoices()
}

// --- Putting the setup into the game ---------------------------------------------

async function wantedSetup(everything: boolean): Promise<Wanted> {
  const wanted: Wanted = {
    scripts: [],
    files: [],
    settings: everything ? [...tools.settings] : [],
    named: everything
      ? tools.gameSettings
          .filter((d) => tools.gameValues[d.id] !== undefined)
          .map((def) => ({ def, value: tools.gameValues[def.id]! }))
      : [],
  }
  if (!everything) return wanted
  for (const m of tools.mods) {
    for (const f of m.files)
      if (f.kind === 'script' && m.wanted?.[f.path])
        wanted.scripts.push({
          label: `${m.name}${scriptsOf(m) > 1 ? ` (${f.path})` : ''}`,
          text: await f.data.text(),
          values: { ...m.values[f.path] },
          files: await filesBeside(m, f),
        })
    if (m.wantFiles) {
      const own = m.files.filter((f) => f.kind === 'package' || f.kind === 'config')
      wanted.files.push({
        label: m.name,
        files: await Promise.all(
          own.map(async (f) => ({
            path: f.path,
            kind: f.kind as 'package' | 'config',
            data: new Uint8Array(await f.data.arrayBuffer()),
          })),
        ),
      })
    }
  }
  return wanted
}
const scriptsOf = (m: Mod) => m.files.filter((f) => f.kind === 'script').length

/**
 * The data files beside a script in its mod (what MODDED_FILE and BULK_FILE
 * name: object data, a table entry, bulk data), by lower-case path from the
 * script's folder. Not its packages, configs or documents.
 */
async function filesBeside(m: Mod, script: ModFile): Promise<Record<string, Uint8Array>> {
  const dir = script.path.includes('/') ? script.path.slice(0, script.path.lastIndexOf('/') + 1) : ''
  const out: Record<string, Uint8Array> = {}
  for (const f of m.files)
    if (f.kind === 'other' && f.path.startsWith(dir))
      out[f.path.slice(dir.length).toLowerCase()] = new Uint8Array(await f.data.arrayBuffer())
  return out
}

/**
 * Works out what putting the setup into the game would change (or, with
 * `everything` false, putting every file back as it was). Asks for write
 * access first, while the click that asked for it still counts.
 */
export async function makePlan(everything = true): Promise<void> {
  if (!files) return
  tools.log = []
  if (!(await files.canWrite(true))) {
    tools.error = 'The browser did not allow changes to the game folder.'
    return
  }
  tools.error = null
  tools.busy = 'Working out what changes…'
  const kind = gameKind()
  try {
    if (desktop?.bases && baseAvailable(kind)) {
      const base = await baseSetup(kind)
      // The version's own file is in hand now (it may only just have been
      // unpacked): the game settings are found in it, not in the game's file.
      const current = await files.read(GAME_INI)
      await loadGameSettings(current ? iniText(current) : null)
      tools.busy = 'Working out what changes…'
      tools.plan = markRaw(await planBase(files, await wantedSetup(everything), managed, base))
    } else if (kind === tools.install?.kind)
      tools.plan = markRaw(await planSetup(files, await wantedSetup(everything), managed))
    else throw new Error(`The library has nothing to put ${baseName(kind)} into the game from.`)
    if (everything) {
      const found = new Set(tools.gameSettings.map((d) => d.id))
      for (const id of Object.keys(tools.gameValues))
        if (!found.has(id))
          tools.plan.problems.push(
            `The setting “${settingName(id)}” is not in ${baseName(kind)}'s DefaultGameCore.ini; it is left out.`,
          )
    }
  } catch (e) {
    tools.error = (e as Error).message
  } finally {
    tools.busy = null
  }
}

export function cancelPlan() {
  tools.plan = null
}

/** Writes the plan, keeps the bookkeeping, and reads the install again. */
export async function applyPlanNow(): Promise<void> {
  if (!files || !tools.plan || !tools.install) return
  const plan = tools.plan
  tools.busy = 'Writing…'
  try {
    tools.log = await applyPlan(files, plan, (done, total, path) => {
      tools.busy = `Writing ${done + 1} of ${total}: ${path}`
    })
    managed = plan.managed
    tools.plan = null
  } catch (e) {
    tools.error = `Stopped: ${(e as Error).message}. The originals are in lwtree-backup/.`
  } finally {
    tools.busy = null
  }
  const log = tools.log
  await readInstall()
  tools.log = log
}
