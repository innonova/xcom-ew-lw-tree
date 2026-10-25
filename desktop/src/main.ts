// The Long War Tech Tree as a Windows app (features/desktop-app.md): the
// site, bundled, in a locked-down window, with the game's files and the save
// folder in reach through a narrow bridge (preload.ts). Every file operation
// is confined to the game folder or the save folder the app found or the
// player chose; the page never sees Node.

import { app, BrowserWindow, dialog, ipcMain, net, Notification, protocol, shell } from 'electron'
import { spawn } from 'node:child_process'
import { createReadStream, promises as fs, readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { BaseStore } from './bases'
import { BundleStore } from './bundles'
import { DEFAULT_UPDATE, KEYS_VERSION, ROOT_KEYS } from './keys'
import {
  findGame,
  gameDirUnder,
  inside,
  listInside,
  listTree,
  readInside,
  removeInside,
  writeInside,
} from './game'

const SCHEME = 'app'
const HOST = 'lwtree'
const ORIGIN = `${SCHEME}://${HOST}`
/** The built site (desktop/site, from the repository's dist/). */
const SITE = process.env.LWTREE_SITE ?? path.join(__dirname, '..', 'site')
/** How often to ask for updates while the app runs. */
const CHECK_EVERY_MS = 6 * 3600_000
// As on the website, the page can reach nothing but itself.
const CSP =
  "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"

// WebGL (the 3D soldier, features/game-soldiers.md) on a machine without a
// GPU Chromium will use: its software renderer. Chromium calls it unsafe for
// untrusted pages; this window only ever loads the app's own site.
app.commandLine.appendSwitch('enable-unsafe-swiftshader')

// For tests: their own settings, and a game folder given on the command line.
if (process.env.LWTREE_USER_DATA) app.setPath('userData', process.env.LWTREE_USER_DATA)
const argGameDir = process.argv
  .find((a) => a.startsWith('--game-dir='))
  ?.slice('--game-dir='.length)

// --- The site bundle and its updates (bundles.ts, features/desktop-updates.md)

function baseInfo(): { version: string } {
  try {
    return JSON.parse(readFileSync(path.join(SITE, '.bundle-info.json'), 'utf8'))
  } catch {
    return { version: '0.0.0' }
  }
}
/**
 * Where updates come from: the build's update.json (the release workflow
 * writes it: trusted-updates' base, the product, the channel), else staging.
 */
function updateTarget(): typeof DEFAULT_UPDATE {
  try {
    const t = JSON.parse(readFileSync(path.join(app.getAppPath(), 'update.json'), 'utf8'))
    if (typeof t.base === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(t.channel) && typeof t.product === 'string')
      return { base: t.base, product: t.product, channel: t.channel }
  } catch {
    // None in this build.
  }
  return DEFAULT_UPDATE
}
const UPDATE = updateTarget()
// Tests point the app at their own server, channel and root key; LWTREE_UPDATE_URL="" turns updates off.
const updateUrl = process.env.LWTREE_UPDATE_URL ?? UPDATE.base
/** Left by an update's install, so the app comes to the front when it starts again. */
const UPDATED_MARK = path.join(app.getPath('userData'), 'updated.mark')

const bundles = new BundleStore({
  dir: path.join(app.getPath('userData'), 'bundles'),
  baseDir: SITE,
  baseVersion: baseInfo().version,
  shellVersion: app.getVersion(),
  trusted: updateUrl
    ? {
        base: updateUrl,
        product: UPDATE.product,
        channel: process.env.LWTREE_UPDATE_CHANNEL ?? UPDATE.channel,
        platform: 'win-x64',
        rootKeys: process.env.LWTREE_UPDATE_ROOT_KEYS ? JSON.parse(process.env.LWTREE_UPDATE_ROOT_KEYS) : ROOT_KEYS,
        keysVersion: process.env.LWTREE_UPDATE_KEYS_VERSION ? Number(process.env.LWTREE_UPDATE_KEYS_VERSION) : KEYS_VERSION,
      }
    : undefined,
  fetch: (u) => net.fetch(u, { cache: 'no-store' }),
  onChange: () => tellAll(),
})
/** The update state to every window (set up with the window's bridge). */
let tellAll = () => {}

protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
])

// --- Settings: the folders found or chosen -------------------------------------

interface Settings {
  gameRoot?: string
  savesDir?: string
}
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json')
let settings: Settings = {}
async function loadSettings() {
  try {
    settings = JSON.parse(await fs.readFile(settingsFile(), 'utf8'))
  } catch {
    settings = {}
  }
}
async function saveSettings() {
  await fs.mkdir(path.dirname(settingsFile()), { recursive: true })
  await fs.writeFile(settingsFile(), JSON.stringify(settings, null, 1))
}

/**
 * The player's library (features/game-bases.md): their mods and the
 * installers they drop in, in a folder they can see (LWTREE_LIBRARY stands in
 * for it in tests).
 */
const libraryDir = () =>
  process.env.LWTREE_LIBRARY ?? path.join(app.getPath('documents'), 'Long War Tech Tree')

/**
 * Where unpacked bases are kept: the machine's own app data (not the roaming
 * profile; they are large and can be unpacked again). LWTREE_CACHE in tests.
 */
const cacheDir = () =>
  process.env.LWTREE_CACHE ??
  (process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'Long War Tech Tree', 'bases')
    : path.join(app.getPath('userData'), 'bases'))
let baseStore: BaseStore | undefined
const bases = () => (baseStore ??= new BaseStore(libraryDir(), cacheDir()))

/** The game's own save folder (LWTREE_SAVES stands in for it in tests). */
const defaultSaves = () =>
  process.env.LWTREE_SAVES ??
  path.join(app.getPath('documents'), 'My Games', 'XCOM - Enemy Within', 'XComGame', 'SaveData')

// --- The bridge ----------------------------------------------------------------

const str = (v: unknown) => {
  if (typeof v !== 'string') throw new Error('bad argument')
  return v
}
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const needGame = () => {
  if (!settings.gameRoot) throw new Error('no game folder')
  return settings.gameRoot
}
/**
 * A game path: under XComGame, or with "xew:" under XEW (Long War's own
 * backups, read; XComEW.exe, the one file there the app writes).
 */
const EXE = 'Binaries/Win32/XComEW.exe'
function gamePath(p: string, write = false): { root: string; rel: string } {
  const root = needGame()
  if (!p.startsWith('xew:')) return { root, rel: p }
  const rel = p.slice(4)
  if (write && rel.toLowerCase() !== EXE.toLowerCase()) throw new Error('not allowed')
  return { root: path.dirname(root), rel }
}
async function hashFile(file: string): Promise<{ size: number; sha256: string } | null> {
  try {
    const h = createHash('sha256')
    let size = 0
    for await (const chunk of createReadStream(file)) {
      h.update(chunk as Buffer)
      size += (chunk as Buffer).length
    }
    return { size, sha256: h.digest('hex') }
  } catch {
    return null
  }
}
const needSaves = () => {
  if (!settings.savesDir) throw new Error('no save folder')
  return settings.savesDir
}
/**
 * Whether a URL is the app's own page. (A custom scheme's URL has the origin
 * "null", so scheme and host are compared.)
 */
function ours(url: string | undefined): boolean {
  try {
    const u = new URL(url ?? '')
    return u.protocol === `${SCHEME}:` && u.host === HOST
  } catch {
    return false
  }
}
const gameInfo = () => (settings.gameRoot ? { root: settings.gameRoot } : null)

function bridge(win: BrowserWindow) {
  const handle = (channel: string, f: (...args: unknown[]) => unknown) =>
    ipcMain.handle(channel, (event, ...args) => {
      // Only our own page may use the bridge.
      if (!ours(event.senderFrame?.url)) throw new Error('not allowed')
      return f(...args)
    })

  handle('app:info', () => ({ version: app.getVersion(), platform: process.platform }))
  handle('app:open', (url) => {
    const u = new URL(str(url))
    if (u.protocol === 'https:' || u.protocol === 'http:') void shell.openExternal(u.href)
  })

  handle('game:current', () => gameInfo())
  handle('game:find', async () => {
    const given = argGameDir ? await gameDirUnder(argGameDir) : null
    const found = given ? { root: given, looked: [argGameDir!] } : await findGame()
    if (found) {
      settings.gameRoot = found.root
      await saveSettings()
    }
    return { game: gameInfo(), looked: found?.looked ?? [] }
  })
  handle('game:choose', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'The game folder (XCom-Enemy-Unknown, or its XEW)',
      properties: ['openDirectory'],
      defaultPath: settings.gameRoot,
    })
    if (r.canceled || !r.filePaths[0]) return { game: gameInfo(), error: null }
    const root = await gameDirUnder(r.filePaths[0])
    if (!root)
      return {
        game: gameInfo(),
        error: `No game files (XEW\\XComGame with CookedPCConsole and Config) in ${r.filePaths[0]}.`,
      }
    settings.gameRoot = root
    await saveSettings()
    return { game: gameInfo(), error: null }
  })
  handle('game:forget', async () => {
    delete settings.gameRoot
    await saveSettings()
  })
  handle('game:read', (p, start, end) => {
    const g = gamePath(str(p))
    return readInside(g.root, g.rel, num(start), num(end))
  })
  handle('game:list', async (p) => (await listInside(needGame(), str(p))).map((e) => e.name))
  handle('game:write', (p, data) => {
    if (!(data instanceof Uint8Array)) throw new Error('bad data')
    const g = gamePath(str(p), true)
    return writeInside(g.root, g.rel, data)
  })
  handle('game:remove', (p) => removeInside(needGame(), str(p)))
  handle('game:hash', async (p) => {
    const g = gamePath(str(p))
    return hashFile(await inside(g.root, g.rel))
  })
  // A copy into the game, from the game itself or from an unpacked base: to a
  // temporary file beside the target, then into place at once.
  handle('game:copy', async (from, to) => {
    const f = from as { game?: unknown; base?: unknown; path?: unknown }
    let source: string
    if (typeof f?.game === 'string') {
      const g = gamePath(f.game)
      source = await inside(g.root, g.rel)
    } else source = await bases().file(str(f?.base), str(f?.path))
    const g = gamePath(str(to), true)
    const target = await inside(g.root, g.rel)
    await fs.mkdir(path.dirname(target), { recursive: true })
    const tmp = path.join(path.dirname(target), `.lwtree-${process.pid}-${Date.now()}`)
    try {
      await fs.copyFile(source, tmp)
      await fs.rename(tmp, target)
    } catch (e) {
      await fs.rm(tmp, { force: true })
      throw e
    }
  })

  // The game versions in the library (bases.ts, features/game-bases.md).
  handle('bases:list', () => bases().list())
  handle('bases:unpack', (id) =>
    bases().unpack(str(id), (done, total) => {
      if (!win.isDestroyed()) win.webContents.send('bases:progress', { id, done, total })
    }),
  )
  handle('bases:doc', (id, name) => bases().doc(str(id), str(name)))
  handle(
    'bases:read',
    async (id, p) => new Uint8Array(await fs.readFile(await bases().file(str(id), str(p)))),
  )

  handle('library:info', async () => {
    await fs.mkdir(path.join(libraryDir(), 'Mods'), { recursive: true })
    return { dir: libraryDir() }
  })
  handle('library:files', () => listTree(libraryDir()))
  handle('library:read', (p) => readInside(libraryDir(), str(p)))
  handle('library:write', (p, data) => {
    if (!(data instanceof Uint8Array)) throw new Error('bad data')
    return writeInside(libraryDir(), str(p), data)
  })
  // A mod taken out goes to the recycle bin, not away; where there is none, or
  // the library is a test's (LWTREE_LIBRARY), to the library's own .trash.
  handle('library:trash', async (p) => {
    const target = await inside(libraryDir(), str(p))
    try {
      if (process.env.LWTREE_LIBRARY) throw new Error('a test library')
      await shell.trashItem(target)
    } catch {
      const bin = path.join(libraryDir(), '.trash', String(Date.now()))
      await fs.mkdir(bin, { recursive: true })
      await fs.rename(target, path.join(bin, path.basename(target)))
    }
  })
  handle('library:open', async () => {
    await fs.mkdir(libraryDir(), { recursive: true })
    await shell.openPath(libraryDir())
  })

  handle('saves:current', () => settings.savesDir ?? null)
  handle('saves:choose', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'The save folder (SaveData)',
      properties: ['openDirectory'],
      defaultPath: settings.savesDir ?? defaultSaves(),
    })
    if (r.canceled || !r.filePaths[0]) return settings.savesDir ?? null
    settings.savesDir = r.filePaths[0]
    await saveSettings()
    return settings.savesDir
  })
  handle('saves:default', async () => {
    const dir = defaultSaves()
    if (
      !(await fs
        .stat(dir)
        .then((s) => s.isDirectory())
        .catch(() => false))
    )
      return null
    settings.savesDir = dir
    await saveSettings()
    return dir
  })
  handle('saves:forget', async () => {
    delete settings.savesDir
    await saveSettings()
  })
  // Open one file through the app's own dialog, starting where it belongs (a
  // page's file input always opens where the last dialog was).
  handle('file:open', async (kind) => {
    const k = str(kind)
    const defaultPath =
      k === 'save'
        ? (settings.savesDir ?? defaultSaves())
        : settings.gameRoot
          ? path.join(settings.gameRoot, 'Config')
          : undefined
    const r = await dialog.showOpenDialog(win, {
      title: k === 'save' ? 'A save' : 'DefaultGameCore.ini',
      properties: ['openFile'],
      defaultPath,
      filters:
        k === 'ini'
          ? [
              { name: 'INI', extensions: ['ini'] },
              { name: 'All files', extensions: ['*'] },
            ]
          : [],
    })
    const file = r.filePaths[0]
    if (r.canceled || !file) return null
    return { name: path.basename(file), data: new Uint8Array(await fs.readFile(file)) }
  })
  handle('saves:list', () => listInside(needSaves(), ''))

  const tell = () => {
    if (!win.isDestroyed()) win.webContents.send('bundle:state', bundles.state)
  }
  tellAll = tell
  handle('bundle:state', () => bundles.state)
  handle('bundle:check', async () => {
    const s = await bundles.check()
    tell()
    return s
  })
  handle('bundle:good', () => bundles.good())
  handle('bundle:restart', async () => {
    if (!bundles.activate()) return false
    await win.webContents.session.clearCache()
    win.reload()
    return true
  })
  handle('shell:install', async () => {
    const installer = await bundles.fetchShell()
    if (!installer) return false
    const version = bundles.state.shell?.version ?? 'the new version'
    // The page says it is installing; give it a moment to be read, say it
    // outside the app too (nothing of ours is on screen while NSIS runs),
    // and leave a mark so the app comes to the front when it starts again.
    setTimeout(() => {
      if (Notification.isSupported())
        new Notification({
          title: 'Long War Tech Tree',
          body: `Installing app ${version}: it starts again by itself in about 20 seconds.`,
        }).show()
      void fs
        .writeFile(UPDATED_MARK, version)
        .catch(() => undefined)
        .finally(() => {
          // NSIS, per user, silently; it starts the app again when done.
          spawn(installer, ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref()
          app.quit()
        })
    }, 1500)
    return true
  })
  const check = () => void bundles.check().then(tell)
  setTimeout(check, 10_000)
  setInterval(check, CHECK_EVERY_MS)
  handle('saves:read', (name, start, end) =>
    readInside(needSaves(), path.basename(str(name)), num(start), num(end)),
  )
}

// --- The window ----------------------------------------------------------------

async function serveSite(request: Request): Promise<Response> {
  const url = new URL(request.url)
  if (url.host !== HOST) return new Response('not found', { status: 404 })
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'
  const site = bundles.activeDir
  const file = path.join(site, rel)
  if (path.relative(site, file).startsWith('..')) return new Response('not found', { status: 404 })
  const found = await fs
    .stat(file)
    .then((s) => s.isFile())
    .catch(() => false)
  const res = await net.fetch(pathToFileURL(found ? file : path.join(site, 'index.html')).href)
  const headers = new Headers(res.headers)
  headers.set('Content-Security-Policy', CSP)
  if (rel.endsWith('.js')) headers.set('Content-Type', 'text/javascript')
  return new Response(res.body, { status: res.status, headers })
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1500,
    height: 950,
    title: 'Long War Tech Tree',
    autoHideMenuBar: true,
    backgroundColor: '#08121c',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  })
  // The page stays on the app; links to the web open in the browser.
  win.webContents.on('will-navigate', (e, url) => {
    if (!ours(url)) {
      e.preventDefault()
      if (/^https?:/.test(url)) void shell.openExternal(url)
    }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  bridge(win)
  await win.loadURL(`${ORIGIN}/`)
  // Started again by the installer after an update: Windows keeps a window it
  // did not see the person ask for behind the others; bring it forward.
  if (
    await fs.rm(UPDATED_MARK).then(
      () => true,
      () => false,
    )
  ) {
    win.setAlwaysOnTop(true)
    win.show()
    win.focus()
    setTimeout(() => !win.isDestroyed() && win.setAlwaysOnTop(false), 400)
  }
}

// One app at a time per profile: a second start brings the window forward
// rather than opening another on the same profile (the bench found two
// windows disagreeing about which save was loaded).
if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })
  app.whenReady().then(async () => {
    await loadSettings()
    await bundles.start()
    protocol.handle(SCHEME, serveSite)
    await createWindow()
  })
}
app.on('window-all-closed', () => app.quit())
