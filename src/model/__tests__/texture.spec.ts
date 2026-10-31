import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { lzoDecompress } from '@innonova/upkit/lzo'
import { decodeImage, largestMip, readTexture } from '../texture'
import { Package, decompressPackage, exportPath } from '@innonova/upkit/upk'

const text = (b: Uint8Array) => new TextDecoder().decode(b)
const bytes = (...xs: (number | string)[]) =>
  Uint8Array.from(xs.flatMap((x) => (typeof x === 'string' ? [...x].map((c) => c.charCodeAt(0)) : [x])))

describe('the game’s pictures (model/lzo.ts, model/texture.ts)', () => {
  it('LZO1X: a literal run, a match behind it, the end marker', () => {
    // 17 + 5: five literals; then the end (a far match of distance 0).
    expect(text(lzoDecompress(bytes(22, 'hello', 0x11, 0, 0), 5))).toBe('hello')
    // "abc", then 6 bytes from 3 back: a short match (t ≥ 64), length (t >> 5) + 1.
    expect(text(lzoDecompress(bytes(20, 'abc', 168, 0, 0x11, 0, 0), 9))).toBe('abcabcabc')
    expect(() => lzoDecompress(bytes(20, 'abc', 168, 0, 0x11, 0, 0), 8)).toThrow(/overrun/)
  })

  it('DXT1 and DXT5 blocks to RGBA', () => {
    // DXT1: color 0 pure red, color 1 pure blue; every pixel index 1.
    const dxt1 = bytes(0x00, 0xf8, 0x1f, 0x00, 0x55, 0x55, 0x55, 0x55)
    const a = decodeImage('PF_DXT1', dxt1, 4, 4)
    expect(Array.from(a.slice(0, 4))).toEqual([0, 0, 255, 255])
    // DXT5: alpha 255 → 0 palette, all index 1 (alpha 0); color as above, index 0 (red).
    const dxt5 = bytes(255, 0, 0x49, 0x92, 0x24, 0x49, 0x92, 0x24, 0x00, 0xf8, 0x1f, 0x00, 0, 0, 0, 0)
    const b = decodeImage('PF_DXT5', dxt5, 4, 4)
    expect(Array.from(b.slice(0, 4))).toEqual([255, 0, 0, 0])
  })
})

// The person's install (git-ignored samples/): a research icon out of a
// compressed package, decoded; only its hash is kept here.
const C = resolve(import.meta.dirname, '../../../samples/CookedPCConsole')
describe.skipIf(!existsSync(`${C}/XComShell.upk`))('on the real files', () => {
  it('Xenobiology’s research icon, from the compressed XComShell.upk', () => {
    const p = new Package(decompressPackage(new Uint8Array(readFileSync(`${C}/XComShell.upk`))))
    const icons = p.exports
      .map((e, i) => ({ e, path: exportPath(p, i), i }))
      .filter((x) => x.e.type === 'Texture2D' && x.path.startsWith('UILibrary_StrategyImages.ScienceIcons.'))
    expect(icons.length).toBe(90)
    const t = readTexture(p, icons.find((x) => x.path.endsWith('.IC_Xenobiology'))!.i)
    expect([t.width, t.height, t.format]).toEqual([256, 128, 'PF_DXT5'])
    const m = largestMip(t)!
    expect(m.where).toBe('inline')
    const rgba = decodeImage(t.format, m.data!, m.width, m.height)
    expect(createHash('sha256').update(rgba).digest('hex').slice(0, 16)).toBe('fe5c2aec885a5d31')
  })
})
