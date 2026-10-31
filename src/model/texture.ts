// The game's pictures (features/game-images.md): a Texture2D read out of a
// package, its largest image taken from the package itself or from a
// texture cache (.tfc), and DXT decoded to RGBA. In the app only, from the
// player's own install; nothing of the game is kept here.
//
// The layout is UE3's for this game (package version 845): the object's
// net index, its tagged properties up to "None", then the texture's own
// data: its source art and its mips, each as bulk data (flags, element
// count, size on disk, offset in file, then the bytes when they are inline).

import { unchunk } from '@innonova/upkit/lzo'

export { unchunk }
import type { Package } from '@innonova/upkit/upk'

export interface TextureInfo {
  width: number
  height: number
  format: string
  /** The texture cache the large mips are in, if any ("Textures"). */
  cache: string
  mips: Mip[]
}
export interface Mip {
  width: number
  height: number
  /** Inline in the package (with its bytes), in the texture cache, or not stored. */
  where: 'inline' | 'cache' | 'none'
  data?: Uint8Array
  /** For the cache: where, how much, and whether LZO-compressed. */
  offset: number
  sizeOnDisk: number
  size: number
  lzo: boolean
}

const BULK_SEPARATE = 0x01
const BULK_LZO = 0x10
const BULK_UNUSED = 0x20

class R {
  v: DataView
  constructor(
    public b: Uint8Array,
    public o: number,
  ) {
    this.v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  }
  i32() {
    const x = this.v.getInt32(this.o, true)
    this.o += 4
    return x
  }
  u32() {
    const x = this.v.getUint32(this.o, true)
    this.o += 4
    return x
  }
}

/** Reads a texture export: its size, format and mips (bytes only for inline ones). */
export function readTexture(pkg: Package, index: number): TextureInfo {
  const e = pkg.exports[index]!
  const r = new R(pkg.bytes, e.offset)
  const name = () => {
    const i = r.i32()
    const n = r.i32()
    return (pkg.names[i] ?? `?${i}`) + (n ? `_${n - 1}` : '')
  }
  r.i32() // net index
  const props: Record<string, number | string> = {}
  for (;;) {
    const p = name()
    if (p === 'None') break
    const type = name()
    const size = r.i32()
    r.i32() // array index
    if (type === 'BoolProperty') {
      props[p] = pkg.bytes[r.o]!
      r.o += 1
      continue
    }
    if (type === 'StructProperty') name()
    if (type === 'ByteProperty') name() // the enum's name
    const start = r.o
    if (type === 'IntProperty') props[p] = r.i32()
    else if ((type === 'ByteProperty' && size === 8) || type === 'NameProperty') props[p] = name()
    r.o = start + size
  }
  /** One bulk data record: the bytes kept when inline. */
  const bulk = (): Omit<Mip, 'width' | 'height'> => {
    const flags = r.u32()
    const count = r.i32()
    const sizeOnDisk = r.i32()
    const offset = r.i32()
    if (flags & BULK_UNUSED || count === 0)
      return { where: 'none', offset, sizeOnDisk, size: count, lzo: false }
    if (flags & BULK_SEPARATE)
      return { where: 'cache', offset, sizeOnDisk, size: count, lzo: !!(flags & BULK_LZO) }
    const raw = pkg.bytes.subarray(r.o, r.o + sizeOnDisk)
    r.o += sizeOnDisk
    const data = flags & BULK_LZO ? unchunk(raw, count) : raw.slice()
    return { where: 'inline', data, offset, sizeOnDisk, size: count, lzo: !!(flags & BULK_LZO) }
  }
  bulk() // source art (not cooked in)
  const n = r.i32()
  const mips: Mip[] = []
  for (let i = 0; i < n; i++) {
    const b = bulk()
    const width = r.i32()
    const height = r.i32()
    mips.push({ ...b, width, height })
  }
  return {
    width: Number(props.SizeX ?? mips[0]?.width ?? 0),
    height: Number(props.SizeY ?? mips[0]?.height ?? 0),
    format: String(props.Format ?? 'PF_DXT1'),
    cache: String(props.TextureFileCacheName ?? ''),
    mips,
  }
}

/** The largest mip the texture has bytes for, or where in the cache it is. */
export function largestMip(t: TextureInfo): Mip | undefined {
  return t.mips.find((m) => m.where !== 'none')
}

// --- DXT ------------------------------------------------------------------------------

const rgb565 = (c: number): [number, number, number] => [
  (((c >> 11) & 31) * 255 + 15) / 31,
  (((c >> 5) & 63) * 255 + 31) / 63,
  ((c & 31) * 255 + 15) / 31,
]

/** DXT1, DXT3 or DXT5 (or uncompressed BGRA) to RGBA, row by row. */
export function decodeImage(
  format: string,
  data: Uint8Array,
  w: number,
  h: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4)
  if (format === 'PF_A8R8G8B8') {
    for (let i = 0; i < w * h; i++) {
      out[i * 4] = data[i * 4 + 2]!
      out[i * 4 + 1] = data[i * 4 + 1]!
      out[i * 4 + 2] = data[i * 4]!
      out[i * 4 + 3] = data[i * 4 + 3]!
    }
    return out
  }
  if (format === 'PF_G8') {
    for (let i = 0; i < w * h; i++) {
      out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = data[i]!
      out[i * 4 + 3] = 255
    }
    return out
  }
  const block = format === 'PF_DXT1' ? 8 : 16
  if (!['PF_DXT1', 'PF_DXT3', 'PF_DXT5'].includes(format))
    throw new Error(`a picture format the app does not read (${format})`)
  const bw = Math.max(1, Math.ceil(w / 4))
  const bh = Math.max(1, Math.ceil(h / 4))
  for (let by = 0; by < bh; by++)
    for (let bx = 0; bx < bw; bx++) {
      let p = (by * bw + bx) * block
      const alpha = new Uint8Array(16).fill(255)
      if (format === 'PF_DXT3') {
        for (let i = 0; i < 16; i++) alpha[i] = ((data[p + (i >> 1)]! >> ((i & 1) * 4)) & 15) * 17
        p += 8
      } else if (format === 'PF_DXT5') {
        const a0 = data[p]!
        const a1 = data[p + 1]!
        const pal = [a0, a1]
        if (a0 > a1) for (let i = 1; i < 7; i++) pal.push(((7 - i) * a0 + i * a1) / 7)
        else {
          for (let i = 1; i < 5; i++) pal.push(((5 - i) * a0 + i * a1) / 5)
          pal.push(0, 255)
        }
        let bits = 0
        for (let i = 0; i < 6; i++) bits += data[p + 2 + i]! * 2 ** (8 * i)
        for (let i = 0; i < 16; i++) alpha[i] = pal[Math.floor(bits / 2 ** (3 * i)) & 7]!
        p += 8
      }
      const c0 = data[p]! | (data[p + 1]! << 8)
      const c1 = data[p + 2]! | (data[p + 3]! << 8)
      const a = rgb565(c0)
      const b = rgb565(c1)
      const cols: number[][] =
        c0 > c1 || format !== 'PF_DXT1'
          ? [a, b, a.map((x, i) => (2 * x + b[i]!) / 3), a.map((x, i) => (x + 2 * b[i]!) / 3)]
          : [a, b, a.map((x, i) => (x + b[i]!) / 2), [0, 0, 0]]
      const transparent = format === 'PF_DXT1' && c0 <= c1
      const idx =
        (data[p + 4]! | (data[p + 5]! << 8) | (data[p + 6]! << 16) | (data[p + 7]! << 24)) >>> 0
      for (let i = 0; i < 16; i++) {
        const x = bx * 4 + (i & 3)
        const y = by * 4 + (i >> 2)
        if (x >= w || y >= h) continue
        const k = (idx >>> (2 * i)) & 3
        const o = (y * w + x) * 4
        out[o] = cols[k]![0]!
        out[o + 1] = cols[k]![1]!
        out[o + 2] = cols[k]![2]!
        out[o + 3] = transparent && k === 3 ? 0 : alpha[i]!
      }
    }
  return out
}
