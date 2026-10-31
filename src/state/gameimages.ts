// The game's own pictures, in the desktop app only (features/game-images.md):
// research, Foundry, items, credits and the air war's ships, read from the
// player's install and shown where the site has its own. Nothing of the game
// is served by the website or kept in the repository; here they are decoded
// on this machine, when first shown, and held in memory.
//
// Where they are:
// - XComShell.upk: UILibrary_StrategyImages (research, items, facilities…);
// - LongWar.upk: Long War's own (its techs, Foundry, items, class icons);
// - gfxInterception_SF.upk: the air war's ships;
// - UICollection_Strategy_SF.upk: the strategy screens' (class icons…).
// Which picture belongs to which research, Foundry project or item is the
// game's own table: Long War's MultiplayerLoadoutSlots in DefaultContent.ini
// (read by UIUtilities.GetTechImagePath and its siblings).

import { reactive } from 'vue'
import { decodeImage, largestMip, readTexture } from '@/model/texture'
import { Package, decompressPackage, exportPath } from '@innonova/upkit/upk'
import type { GameFiles } from './gamefiles'

/** The packages, and what their texture paths start with. */
const SOURCES: [file: string, prefix: string][] = [
  ['XComShell.upk', ''],
  ['LongWar.upk', 'LongWar.'],
  ['gfxInterception_SF.upk', ''],
  ['UICollection_Strategy_SF.upk', ''],
]

/** The table's categories (iPointValue) the site uses. */
const KIND = { item: 0, tech: 2, foundry: 3, credit: 4 } as const
export type ImageKind = keyof typeof KIND

/**
 * The air war's ships by the image number the game gives them: the
 * interception screen's own pictures. Long War's extra UFOs share their
 * parent's number, and so its picture, as in the game.
 */
const SHIPS: Record<number, string> = {
  68: 'gfxInterception.interceptor0000',
  69: 'UILibrary_StrategyImages.ScienceIcons.IC_Firestorm',
  80: 'gfxInterception.alien_smallscout',
  81: 'gfxInterception.alien_largescout',
  82: 'gfxInterception.alien_abductor',
  83: 'gfxInterception.alien_supplyship',
  84: 'gfxInterception.alien_battleship',
  85: 'gfxInterception.alien_ethereal',
}

export const gameImages = reactive({
  /** Pictures can be shown (the app found the game and its packages). */
  ready: false,
  /** Bumped when pictures come or go, so views ask again. */
  version: 0,
  error: null as string | null,
})

let textures = new Map<string, { pkg: Package; index: number }>()
let table = new Map<string, string>()
const urls = new Map<string, string | null>()
let loading = 0

/** The table rows: MultiplayerLoadoutSlots=(strUnitName="…", iPointValue=n, iIconType=m). */
export function pictureTable(ini: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const line of ini.split(/\r?\n/)) {
    if (!/^\s*MultiplayerLoadoutSlots\s*=/i.test(line)) continue
    const path = /strUnitName\s*=\s*"([^"|]+)/i.exec(line)?.[1]
    const kind = /iPointValue\s*=\s*(\d+)/i.exec(line)?.[1]
    const id = /iIconType\s*=\s*(\d+)/i.exec(line)?.[1]
    if (path && kind && id && !out.has(`${kind}:${id}`)) out.set(`${kind}:${id}`, path)
  }
  return out
}

/** Reads the install's pictures (in the background; views update when it is done). */
export async function loadGameImages(files: GameFiles | null): Promise<void> {
  const run = ++loading
  textures = new Map()
  table = new Map()
  urls.clear()
  Object.assign(gameImages, { ready: false, error: null })
  gameImages.version++
  if (!files) return
  try {
    const next = new Map<string, { pkg: Package; index: number }>()
    for (const [file, prefix] of SOURCES) {
      const b = await files.read(`CookedPCConsole/${file}`)
      if (!b || run !== loading) continue
      const pkg = new Package(decompressPackage(b))
      pkg.exports.forEach((e, index) => {
        if (e.type === 'Texture2D')
          next.set(`${prefix}${exportPath(pkg, index)}`.toLowerCase(), { pkg, index })
      })
      await new Promise((r) => setTimeout(r, 0))
    }
    const content = await files.read('Config/DefaultContent.ini')
    if (run !== loading) return
    textures = next
    table = content ? pictureTable(new TextDecoder('latin1').decode(content)) : new Map()
    gameImages.ready = textures.size > 0
  } catch (e) {
    gameImages.error = (e as Error).message
  }
  gameImages.version++
}

/** A picture by its game path ("UILibrary_StrategyImages.ScienceIcons.IC_Xenobiology"), as a data URL. */
export function pictureUrl(path: string | undefined): string | null {
  if (!path || !gameImages.ready) return null
  const key = path.replace(/^img:\/\/\//i, '').toLowerCase()
  if (urls.has(key)) return urls.get(key)!
  let url: string | null = null
  const t = textures.get(key)
  if (t) {
    try {
      const tex = readTexture(t.pkg, t.index)
      const mip = largestMip(tex)
      if (mip?.data) {
        const rgba = decodeImage(tex.format, mip.data, mip.width, mip.height)
        const canvas = document.createElement('canvas')
        canvas.width = mip.width
        canvas.height = mip.height
        canvas
          .getContext('2d')!
          .putImageData(new ImageData(rgba as ImageDataArray, mip.width, mip.height), 0, 0)
        url = canvas.toDataURL('image/png')
      }
    } catch {
      url = null
    }
  }
  urls.set(key, url)
  return url
}

/** The game path of the picture the game gives a research, Foundry project, item or credit. */
export const picturePath = (kind: ImageKind, id: number) => table.get(`${KIND[kind]}:${id}`)

/** Whether the install has a picture at that path. */
export const hasPicture = (path: string | undefined) =>
  !!path && textures.has(path.replace(/^img:\/\/\//i, '').toLowerCase())

/** The picture the game gives a research, Foundry project, item or credit, by its id. */
export function gamePicture(kind: ImageKind, id: number): string | null {
  return pictureUrl(picturePath(kind, id))
}

/** The game path of an air war ship's picture. */
export const shipPicturePath = (image: number) => SHIPS[image]

/** An air war ship's picture, by the image number the game gives it (data/airwar.json). */
export function shipPicture(image: number | undefined): string | null {
  return image === undefined ? null : pictureUrl(SHIPS[image])
}
