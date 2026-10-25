// When the site runs inside the desktop app (desktop/, features/desktop-app.md):
// the app's bridge, and the shapes the rest of the site already uses on top of
// it: GameFiles for Tools, a folder handle for the save-folder watcher.

import type { CopySource, GameFiles } from './gamefiles'

export interface DesktopGame {
  root: string
}
export interface SaveEntry {
  name: string
  size: number
  lastModified: number
}

/** A file in the player's library folder (state/library.ts). */
export interface LibraryFile {
  path: string
  size: number
  modified: number
}
/** The player's library folder: Documents\Long War Tech Tree (from shell 0.3.0). */
export interface DesktopLibrary {
  info(): Promise<{ dir: string }>
  files(): Promise<LibraryFile[]>
  read(path: string): Promise<Uint8Array | null>
  write(path: string, data: Uint8Array): Promise<void>
  /** To the recycle bin. */
  trash(path: string): Promise<void>
  /** Shows the folder in Explorer. */
  open(): Promise<void>
}

/** A game version in the library (desktop/src/bases.ts). */
export interface BaseFound {
  id: string
  kind: 'lw' | 'lwr'
  name: string
  version: string
  source: string
  unpacked: boolean
}
export interface BaseManifest extends Omit<BaseFound, 'unpacked'> {
  files: { path: string; size: number; sha256: string }[]
  deletes: string[]
  exePatches: { description: string; find: string; replace: string }[]
}

/** The shell's bundles and updates (desktop/src/bundles.ts). */
export interface BundleState {
  shellVersion: string
  serving: string
  base: string
  ready?: string
  /** A newer app: needed by the newest site or simply newer; fetched (and checked) yet, or being fetched (0.3.6 on). */
  shell?: { version: string; needed: boolean; downloaded: boolean; fetching?: boolean }
  checking: boolean
  lastCheck?: string
  error?: string
  /** Why the last check could not confirm what is current (trusted-updates refused or was out of reach; 0.4.0 on). */
  unconfirmed?: string
}

/** window.lwtreeDesktop, from desktop/src/preload.ts. */
export interface DesktopApi {
  info(): Promise<{ version: string; platform: string }>
  openExternal(url: string): Promise<void>
  /** The app's file dialog, starting in the save folder or the game's Config. */
  openFile(kind: 'save' | 'ini'): Promise<{ name: string; data: Uint8Array } | null>
  game: {
    current(): Promise<DesktopGame | null>
    find(): Promise<{ game: DesktopGame | null; looked: string[] }>
    choose(): Promise<{ game: DesktopGame | null; error: string | null }>
    forget(): Promise<void>
    read(path: string, start?: number, end?: number): Promise<Uint8Array | null>
    list(dir: string): Promise<string[]>
    write(path: string, data: Uint8Array): Promise<void>
    remove(path: string): Promise<void>
    /** From shell 0.3.0. */
    hash?(path: string): Promise<{ size: number; sha256: string } | null>
    copy?(from: CopySource, to: string): Promise<void>
  }
  /** From shell 0.3.0: check before use. */
  library?: DesktopLibrary
  /** The game versions in the library, from shell 0.3.0. */
  bases?: {
    list(): Promise<BaseFound[]>
    unpack(id: string): Promise<BaseManifest>
    read(id: string, path: string): Promise<Uint8Array>
    /** A base's own notes (Long War's Armor Kit codes). */
    doc(id: string, name: string): Promise<Uint8Array | null>
    onProgress(f: (p: { id: string; done: number; total: number }) => void): void
  }
  /** From shell 0.2.0 (older shells have no updates): check before use. */
  bundle?: {
    state(): Promise<BundleState>
    check(): Promise<BundleState>
    good(): Promise<void>
    restart(): Promise<boolean>
    installShell(): Promise<boolean>
    onState(f: (s: BundleState) => void): void
  }
  saves: {
    current(): Promise<string | null>
    choose(): Promise<string | null>
    useDefault(): Promise<string | null>
    forget(): Promise<void>
    list(): Promise<SaveEntry[]>
    read(name: string, start?: number, end?: number): Promise<Uint8Array | null>
  }
}

declare global {
  interface Window {
    lwtreeDesktop?: DesktopApi
  }
}

/** The app's bridge, or undefined on the website. */
export const desktop: DesktopApi | undefined =
  typeof window !== 'undefined' ? window.lwtreeDesktop : undefined

/** The game's files through the app. */
export function desktopFiles(api: DesktopApi): GameFiles {
  return {
    read: (path) => api.game.read(path),
    async file(path) {
      const b = await api.game.read(path)
      return b ? new File([b as BlobPart], path.split('/').pop()!) : null
    },
    list: (dir) => api.game.list(dir),
    write: (path, data) => api.game.write(path, data),
    remove: (path) => api.game.remove(path),
    canWrite: async () => true,
    hash: api.game.hash && ((path) => api.game.hash!(path)),
    copy: api.game.copy && ((from, to) => api.game.copy!(from, to)),
  }
}

/**
 * A save file as the watcher reads it (watch.ts): name, size and date from the
 * listing; bytes only when asked, whole or a slice.
 */
function saveFile(api: DesktopApi, e: SaveEntry, start?: number, end?: number) {
  const read = async () => (await api.saves.read(e.name, start, end)) ?? new Uint8Array()
  return {
    name: e.name,
    size: e.size,
    lastModified: e.lastModified,
    arrayBuffer: async () => {
      const b = await read()
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
    },
    slice: (s: number, t: number) => saveFile(api, e, s, t),
  }
}

/** The save folder as the watcher's folder handle (only what it uses). */
export function desktopSaveFolder(api: DesktopApi, folder: string) {
  return {
    name: folder.split(/[\\/]/).filter(Boolean).pop() ?? folder,
    kind: 'directory' as const,
    async *values() {
      for (const e of await api.saves.list())
        yield {
          kind: 'file' as const,
          name: e.name,
          getFile: async () => saveFile(api, e) as unknown as File,
        }
    },
    queryPermission: async () => 'granted' as const,
    requestPermission: async () => 'granted' as const,
  }
}
