// What a soldier's parts are painted with (features/game-soldiers.md): a
// MaterialInstanceConstant's parent and parameters (textures by name, colors,
// numbers), and the game's color palettes (UnitPalettes in Startup.upk:
// armor tints, skin, hair). Tagged properties of UE3 package version 845.

import type { Package } from '@innonova/upkit/upk'

export interface MaterialInstance {
  /** The parent material's name ("CHH_Soldiers"). */
  parent: string
  /** Texture parameters: name → object reference (export index + 1, or −import). */
  textures: Record<string, number>
  vectors: Record<string, [number, number, number, number]>
  scalars: Record<string, number>
}

export type Color = [number, number, number, number]
export interface PaletteEntry {
  primary: Color
  secondary: Color
}

/** Reads tagged properties from an export's data: calls back on each, with a reader at its value. */
function walk(
  pkg: Package,
  start: number,
  end: number,
  on: (name: string, type: string, struct: string, at: number, size: number) => void,
) {
  const v = new DataView(pkg.bytes.buffer, pkg.bytes.byteOffset, pkg.bytes.byteLength)
  let o = start
  const name = () => {
    const i = v.getInt32(o, true)
    const n = v.getInt32(o + 4, true)
    o += 8
    return (pkg.names[i] ?? `?${i}`) + (n ? `_${n - 1}` : '')
  }
  while (o < end) {
    const p = name()
    if (p === 'None') return o
    const type = name()
    const size = v.getInt32(o, true)
    o += 8
    if (type === 'BoolProperty') {
      on(p, type, '', o, 1)
      o += 1
      continue
    }
    const struct = type === 'StructProperty' || type === 'ByteProperty' ? name() : ''
    on(p, type, struct, o, size)
    o += size
  }
  return o
}

const view = (pkg: Package) =>
  new DataView(pkg.bytes.buffer, pkg.bytes.byteOffset, pkg.bytes.byteLength)
const color = (v: DataView, at: number): Color =>
  [0, 1, 2, 3].map((k) => v.getFloat32(at + 4 * k, true)) as Color

/** An array property's elements: each a run of tagged properties. */
function elements(
  pkg: Package,
  at: number,
  size: number,
  each: (start: number, end: number) => number,
) {
  const v = view(pkg)
  const n = v.getInt32(at, true)
  let o = at + 4
  for (let i = 0; i < n && o < at + size; i++) o = each(o, at + size)
}

export function readMaterialInstance(pkg: Package, index: number): MaterialInstance {
  const e = pkg.exports[index]!
  const v = view(pkg)
  const out: MaterialInstance = { parent: '', textures: {}, vectors: {}, scalars: {} }
  const ref = (n: number) =>
    (n > 0 ? pkg.exports[n - 1]?.name : n < 0 ? pkg.imports[-n - 1]?.name : '') ?? ''
  walk(pkg, e.offset + 4, e.offset + e.size, (name, type, _s, at, size) => {
    if (name === 'Parent' && type === 'ObjectProperty') out.parent = ref(v.getInt32(at, true))
    const params = {
      TextureParameterValues: 't',
      VectorParameterValues: 'v',
      ScalarParameterValues: 's',
    }[name]
    if (type !== 'ArrayProperty' || !params) return
    elements(pkg, at, size, (start, end) => {
      let param = ''
      let value = 0 as number | Color
      const stop = walk(pkg, start, end, (n, t, st, a) => {
        if (n === 'ParameterName') param = pkg.names[v.getInt32(a, true)] ?? ''
        if (n === 'ParameterValue') {
          if (t === 'ObjectProperty') value = v.getInt32(a, true)
          else if (t === 'FloatProperty') value = v.getFloat32(a, true)
          else if (st === 'LinearColor') value = color(v, a)
        }
      })
      if (params === 't') out.textures[param] = value as number
      else if (params === 'v') out.vectors[param] = value as Color
      else out.scalars[param] = value as number
      return stop
    })
  })
  return out
}

/** An XComLinearColorPalette: its entries' primary and secondary colors (linear). */
export function readPalette(pkg: Package, index: number): PaletteEntry[] {
  const e = pkg.exports[index]!
  const v = view(pkg)
  const out: PaletteEntry[] = []
  walk(pkg, e.offset + 4, e.offset + e.size, (name, type, _s, at, size) => {
    if (name !== 'Entries' || type !== 'ArrayProperty') return
    elements(pkg, at, size, (start, end) => {
      const entry: PaletteEntry = { primary: [0, 0, 0, 1], secondary: [0, 0, 0, 1] }
      const stop = walk(pkg, start, end, (n, _t, st, a) => {
        if (st !== 'LinearColor') return
        if (n === 'Primary') entry.primary = color(v, a)
        if (n === 'Secondary') entry.secondary = color(v, a)
      })
      out.push(entry)
      return stop
    })
  })
  return out
}
