// A pose out of the game's animations (features/game-soldiers.md): an
// AnimSet's tracks by bone, and one frame of a sequence, decoded from its
// compressed track data. UE3 package version 845, as UE Viewer (MIT)
// documents the formats; nothing copied.

import type { Package } from '@innonova/upkit/upk'

export type Quat = [number, number, number, number]
export type Vec3 = [number, number, number]

export interface AnimSequenceInfo {
  index: number
  name: string
  frames: number
}
export interface AnimSetInfo {
  /** Bone name per track. */
  tracks: string[]
  /** Animated rotations only: positions come from the mesh's own skeleton. */
  rotationOnly: boolean
  sequences: AnimSequenceInfo[]
}
/** A bone's place relative to its parent in one frame. */
export interface BonePose {
  rotation: Quat
  position: Vec3 | null
}

const view = (pkg: Package) =>
  new DataView(pkg.bytes.buffer, pkg.bytes.byteOffset, pkg.bytes.byteLength)

/** Tagged properties: each name, type, the enum or struct name, and where its value is. */
function props(
  pkg: Package,
  start: number,
  end: number,
  on: (name: string, type: string, sub: string, at: number, size: number) => void,
): number {
  const v = view(pkg)
  let o = start
  const name = () => {
    const i = v.getInt32(o, true)
    o += 8
    return pkg.names[i] ?? ''
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
    const sub = type === 'StructProperty' || type === 'ByteProperty' ? name() : ''
    on(p, type, sub, o, size)
    o += size
  }
  return o
}

export function readAnimSet(pkg: Package, index: number): AnimSetInfo {
  const e = pkg.exports[index]!
  const v = view(pkg)
  const out: AnimSetInfo = { tracks: [], rotationOnly: false, sequences: [] }
  let seqRefs: number[] = []
  props(pkg, e.offset + 4, e.offset + e.size, (name, type, _s, at) => {
    if (name === 'bAnimRotationOnly') out.rotationOnly = pkg.bytes[at] !== 0
    if (name === 'TrackBoneNames' && type === 'ArrayProperty')
      out.tracks = Array.from(
        { length: v.getInt32(at, true) },
        (_, k) => pkg.names[v.getInt32(at + 4 + 8 * k, true)] ?? '',
      )
    if (name === 'Sequences' && type === 'ArrayProperty')
      seqRefs = Array.from({ length: v.getInt32(at, true) }, (_, k) =>
        v.getInt32(at + 4 + 4 * k, true),
      )
  })
  for (const r of seqRefs) {
    if (r <= 0) continue
    const s = readSequenceHeader(pkg, r - 1)
    out.sequences.push({ index: r - 1, name: s.name, frames: s.frames })
  }
  return out
}

interface SequenceHeader {
  name: string
  frames: number
  /** Seconds, at the normal rate. */
  length: number
  rotationFormat: string
  translationFormat: string
  keyFormat: string
  offsets: number[]
  /** Where the compressed bytes are, and how many. */
  stream: number
  streamSize: number
}

export function readSequenceHeader(pkg: Package, index: number): SequenceHeader {
  const e = pkg.exports[index]!
  const v = view(pkg)
  const h: SequenceHeader = {
    name: '',
    frames: 0,
    length: 0,
    rotationFormat: 'ACF_Float96NoW',
    translationFormat: 'ACF_None',
    keyFormat: 'AKF_ConstantKeyLerp',
    offsets: [],
    stream: 0,
    streamSize: 0,
  }
  const end = props(pkg, e.offset + 4, e.offset + e.size, (name, type, _s, at) => {
    if (name === 'SequenceName') h.name = pkg.names[v.getInt32(at, true)] ?? ''
    if (name === 'NumFrames') h.frames = v.getInt32(at, true)
    if (name === 'SequenceLength') h.length = v.getFloat32(at, true)
    if (name === 'RotationCompressionFormat')
      h.rotationFormat = pkg.names[v.getInt32(at, true)] ?? ''
    if (name === 'TranslationCompressionFormat')
      h.translationFormat = pkg.names[v.getInt32(at, true)] ?? ''
    if (name === 'KeyEncodingFormat') h.keyFormat = pkg.names[v.getInt32(at, true)] ?? ''
    if (name === 'CompressedTrackOffsets' && type === 'ArrayProperty')
      h.offsets = Array.from({ length: v.getInt32(at, true) }, (_, k) =>
        v.getInt32(at + 4 + 4 * k, true),
      )
  })
  // Then: the raw animation (bulk data, empty when cooked), the raw tracks
  // (an empty array), and the compressed bytes: the one array that ends the object.
  const objEnd = e.offset + e.size
  for (let o = end; o + 4 <= objEnd; o += 4) {
    const n = v.getInt32(o, true)
    if (n > 0 && o + 4 + n === objEnd) {
      h.stream = o + 4
      h.streamSize = n
      break
    }
  }
  if (!h.length) h.length = Math.max(1, h.frames - 1) / 30
  return h
}

/** A normalized −1..1 value out of an n-bit unsigned field. */
const unit = (x: number, bits: number) => {
  const half = (1 << (bits - 1)) - 1
  return (x - half) / half
}
const withW = (x: number, y: number, z: number): Quat => [
  x,
  y,
  z,
  Math.sqrt(Math.max(0, 1 - x * x - y * y - z * z)),
]

/** A track's keys and the frame each falls on (fractional where they are spread evenly). */
interface Keys<T> {
  frames: number[]
  values: T[]
}
/** A sequence, decoded: each bone's keys, to sample at any time. */
export interface Clip {
  name: string
  frames: number
  /** Seconds. */
  length: number
  tracks: Map<string, { rotation: Keys<Quat> | null; position: Keys<Vec3> | null }>
}

/** A sequence's keys, every one of them for per-track compression (the barracks' animations). */
export function readClip(pkg: Package, set: AnimSetInfo, index: number): Clip {
  const h = readSequenceHeader(pkg, index)
  const clip: Clip = { name: h.name, frames: h.frames, length: h.length, tracks: new Map() }
  if (!h.stream) return clip
  if (h.keyFormat === 'AKF_PerTrackCompression') {
    const v = view(pkg)
    const r = {
      f32: (o: number) => v.getFloat32(h.stream + o, true),
      u16: (o: number) => v.getUint16(h.stream + o, true),
      u32: (o: number) => v.getUint32(h.stream + o, true),
      u8: (o: number) => v.getUint8(h.stream + o),
    }
    set.tracks.forEach((bone, j) => {
      const [tOff, rOff] = h.offsets.slice(2 * j, 2 * j + 2) as [number, number]
      clip.tracks.set(bone, {
        position: tOff >= 0 ? (trackKeys(h, r, tOff, false) as Keys<Vec3>) : null,
        rotation: rOff >= 0 ? (trackKeys(h, r, rOff, true) as Keys<Quat>) : null,
      })
    })
    return clip
  }
  for (const [bone, b] of firstKeys(pkg, set, h))
    clip.tracks.set(bone, {
      rotation: { frames: [0], values: [b.rotation] },
      position: b.position ? { frames: [0], values: [b.position] } : null,
    })
  return clip
}

/** Each bone's place at a time in the clip (seconds, looping). */
export function sampleClip(clip: Clip, seconds: number): Map<string, BonePose> {
  const length = clip.length || 1
  const t = ((seconds % length) + length) % length
  const frame = (t / length) * Math.max(0, clip.frames - 1)
  const out = new Map<string, BonePose>()
  for (const [bone, tr] of clip.tracks) {
    const rotation = tr.rotation ? sample(tr.rotation, frame, nlerp) : ([0, 0, 0, 1] as Quat)
    const position = tr.position ? sample(tr.position, frame, lerp) : null
    out.set(bone, { rotation, position })
  }
  return out
}

/** The first frame's pose of each track of a sequence. */
export function readPose(pkg: Package, set: AnimSetInfo, index: number): Map<string, BonePose> {
  return sampleClip(readClip(pkg, set, index), 0)
}

function sample<T extends number[]>(
  k: Keys<T>,
  frame: number,
  mix: (a: T, b: T, f: number) => T,
): T {
  const n = k.values.length
  if (n === 1 || frame <= k.frames[0]!) return k.values[0]!
  if (frame >= k.frames[n - 1]!) return k.values[n - 1]!
  let i = 1
  while (k.frames[i]! < frame) i++
  const f0 = k.frames[i - 1]!
  const f1 = k.frames[i]!
  return mix(k.values[i - 1]!, k.values[i]!, f1 > f0 ? (frame - f0) / (f1 - f0) : 0)
}
const lerp = (a: Vec3, b: Vec3, f: number): Vec3 => [
  a[0] + (b[0] - a[0]) * f,
  a[1] + (b[1] - a[1]) * f,
  a[2] + (b[2] - a[2]) * f,
]
/** Between two rotations, the short way round, normalized. */
const nlerp = (a: Quat, b: Quat, f: number): Quat => {
  const s = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1
  const q = [0, 1, 2, 3].map((k) => a[k]! * (1 - f) + s * b[k]! * f) as Quat
  const l = Math.hypot(...q) || 1
  return q.map((x) => x / l) as Quat
}

/** The first key of each track, for the key formats other than per-track compression. */
function firstKeys(pkg: Package, set: AnimSetInfo, h: SequenceHeader): Map<string, BonePose> {
  const v = view(pkg)
  const out = new Map<string, BonePose>()
  if (!h.stream) return out
  const f32 = (o: number) => v.getFloat32(h.stream + o, true)
  const u16 = (o: number) => v.getUint16(h.stream + o, true)
  const u32 = (o: number) => v.getUint32(h.stream + o, true)
  set.tracks.forEach((bone, j) => {
    const [tOff, tKeys, rOff, rKeys] = h.offsets.slice(4 * j, 4 * j + 4) as number[]
    let position: Vec3 | null = null
    if (tKeys && tKeys > 0 && tOff! >= 0) {
      const fmt = tKeys === 1 ? 'ACF_None' : h.translationFormat
      if (fmt === 'ACF_IntervalFixed32NoW') {
        const mins = [f32(tOff!), f32(tOff! + 4), f32(tOff! + 8)]
        const ranges = [f32(tOff! + 12), f32(tOff! + 16), f32(tOff! + 20)]
        const p = u32(tOff! + 24)
        const q = [unit(p >>> 21, 11), unit((p >>> 10) & 2047, 11), unit(p & 1023, 10)]
        position = [0, 1, 2].map((k) => q[k]! * ranges[k]! + mins[k]!) as Vec3
      } else if (fmt === 'ACF_Fixed48NoW')
        position = [unit(u16(tOff!), 16), unit(u16(tOff! + 2), 16), unit(u16(tOff! + 4), 16)]
      else if (fmt !== 'ACF_Identity') position = [f32(tOff!), f32(tOff! + 4), f32(tOff! + 8)]
    }
    let rotation: Quat = [0, 0, 0, 1]
    if (rKeys && rKeys > 0 && rOff! >= 0) {
      const fmt = rKeys === 1 ? 'ACF_Float96NoW' : h.rotationFormat
      let o = rOff!
      let mins = [0, 0, 0]
      let ranges = [1, 1, 1]
      if (rKeys > 1 && fmt === 'ACF_IntervalFixed32NoW') {
        mins = [f32(o), f32(o + 4), f32(o + 8)]
        ranges = [f32(o + 12), f32(o + 16), f32(o + 20)]
        o += 24
      }
      if (fmt === 'ACF_None') rotation = [f32(o), f32(o + 4), f32(o + 8), f32(o + 12)]
      else if (fmt === 'ACF_Float96NoW') rotation = withW(f32(o), f32(o + 4), f32(o + 8))
      else if (fmt === 'ACF_Fixed48NoW')
        rotation = withW(unit(u16(o), 16), unit(u16(o + 2), 16), unit(u16(o + 4), 16))
      else if (fmt === 'ACF_Fixed32NoW' || fmt === 'ACF_IntervalFixed32NoW') {
        const p = u32(o)
        const q = [unit(p >>> 21, 11), unit((p >>> 10) & 2047, 11), unit(p & 1023, 10)]
        rotation = withW(...([0, 1, 2].map((k) => q[k]! * ranges[k]! + mins[k]!) as Vec3))
      } else if (fmt === 'ACF_Float32NoW') {
        const p = u32(o)
        // 11, 11 and 10 bit floats; rare: left as no rotation.
        void p
      }
    }
    out.set(bone, { rotation, position })
  })
  return out
}

/** The formats a per-track header names (its top four bits). */
const FORMATS = [
  'None',
  'Float96NoW',
  'Fixed48NoW',
  'IntervalFixed32NoW',
  'Fixed32NoW',
  'Float32NoW',
  'Identity',
]

/** Reads from the compressed bytes, by offset into them. */
interface Reader {
  f32: (o: number) => number
  u16: (o: number) => number
  u32: (o: number) => number
  u8: (o: number) => number
}

/** Three packed fields: 11, 11 and 10 bits, each −1..1. */
const fixed32 = (p: number): Vec3 => [
  (p >>> 21) / 1023 - 1,
  ((p >>> 10) & 2047) / 1023 - 1,
  (p & 1023) / 511 - 1,
]

/**
 * One track compressed on its own: a word holding its format, which of x, y, z
 * it stores (and, bit 8, whether a frame table follows), and how many keys;
 * for interval formats each stored component's minimum and range; the keys;
 * then, four-byte aligned, the frame of each key (bytes, or 16 bits past 255
 * frames). Without a frame table the keys are spread evenly.
 */
function trackKeys(h: SequenceHeader, r: Reader, at: number, rotation: boolean): Keys<number[]> {
  const w = r.u32(at)
  const format = FORMATS[w >>> 28] ?? '?'
  const mask = (w >>> 24) & 0xf
  const n = w & 0xffffff
  let o = at + 4
  const has = (k: number) => (mask & (1 << k)) !== 0
  const mins = [0, 0, 0]
  const ranges = [0, 0, 0]
  if (format === 'IntervalFixed32NoW')
    for (let k = 0; k < 3; k++)
      if (has(k)) {
        mins[k] = r.f32(o)
        ranges[k] = r.f32(o + 4)
        o += 8
      }
  const key = (): number[] => {
    if (format === 'Float96NoW') {
      if (rotation) {
        const q = withW(r.f32(o), r.f32(o + 4), r.f32(o + 8))
        o += 12
        return q
      }
      if (!(mask & 7)) {
        const p = [r.f32(o), r.f32(o + 4), r.f32(o + 8)]
        o += 12
        return p
      }
      return [0, 1, 2].map((k) => {
        if (!has(k)) return 0
        o += 4
        return r.f32(o - 4)
      })
    }
    if (format === 'Fixed48NoW') {
      // Rotations: −1..1 over 16 bits; translations: whole units about 255.
      const c = [0, 1, 2].map((k) => {
        if (!has(k)) return 0
        o += 2
        const x = r.u16(o - 2)
        return rotation ? (x - 32767) / 32767 : x - 255
      })
      return rotation ? withW(c[0]!, c[1]!, c[2]!) : c
    }
    if (format === 'Fixed32NoW' || format === 'IntervalFixed32NoW') {
      const q = fixed32(r.u32(o))
      o += 4
      const c =
        format === 'Fixed32NoW' ? q : ([0, 1, 2].map((k) => q[k]! * ranges[k]! + mins[k]!) as Vec3)
      return rotation ? withW(...c) : c
    }
    if (format === 'Float32NoW') {
      // 11, 11 and 10 bit floats; rare: left as no change.
      o += 4
      return rotation ? [0, 0, 0, 1] : [0, 0, 0]
    }
    return rotation ? [0, 0, 0, 1] : [0, 0, 0]
  }
  const values = Array.from({ length: Math.max(1, n) }, key)
  let frames: number[]
  if (values.length > 1 && mask & 8) {
    o = (o + 3) & ~3
    const wide = h.frames > 0xff
    frames = values.map((_, i) => (wide ? r.u16(o + 2 * i) : r.u8(o + i)))
  } else {
    const last = Math.max(0, h.frames - 1)
    frames = values.map((_, i) => (values.length > 1 ? (i * last) / (values.length - 1) : 0))
  }
  return { frames, values }
}
