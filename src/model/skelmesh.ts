// A soldier's body as the game stores it (features/game-images.md, the 3D
// try): a SkeletalMesh's bones, its first level of detail's sections and
// triangles, and its vertices as the GPU gets them (positions in the rest
// pose, normals, UVs). Layout of UE3 package version 845 on PC, as UE Viewer
// (MIT licence) documents it; nothing copied.

import type { Package } from '@innonova/upkit/upk'

export interface MeshBone {
  name: string
  parent: number
  /** Rotation (x, y, z, w) and position relative to the parent. */
  rotation: [number, number, number, number]
  position: [number, number, number]
}
export interface MeshSection {
  material: number
  firstIndex: number
  triangles: number
}
export interface SkelMesh {
  materials: number[]
  bones: MeshBone[]
  sections: MeshSection[]
  indices: Uint16Array | Uint32Array
  vertexCount: number
  /** x, y, z per vertex, in the rest pose. */
  positions: Float32Array
  /** x, y, z per vertex, unit length. */
  normals: Float32Array
  /** u, v per vertex (the first set). */
  uvs: Float32Array
  /** x, y, z of the tangent and the bitangent's sign, per vertex (for normal maps). */
  tangents: Float32Array
  /** Four bones (mesh bone indices) and weights (0–255) per vertex. */
  influences: { bones: Uint16Array; weights: Uint8Array }
}

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
  i16() {
    const x = this.v.getInt16(this.o, true)
    this.o += 2
    return x
  }
  u8() {
    return this.b[this.o++]!
  }
  f32() {
    const x = this.v.getFloat32(this.o, true)
    this.o += 4
    return x
  }
  skip(n: number) {
    this.o += n
  }
}

const half = (h: number) => {
  const s = h & 0x8000 ? -1 : 1
  const e = (h >> 10) & 31
  const f = h & 1023
  if (e === 0) return s * f * 2 ** -24
  if (e === 31) return f ? NaN : s * Infinity
  return s * (1 + f / 1024) * 2 ** (e - 15)
}
/** A packed normal: x, y, z in bytes 0..255 for −1..1. */
const unpackNormal = (b: number) => b / 127.5 - 1

export function readSkelMesh(pkg: Package, index: number): SkelMesh {
  const e = pkg.exports[index]!
  const r = new R(pkg.bytes, e.offset)
  const name = () => {
    const i = r.i32()
    r.i32()
    return pkg.names[i] ?? `?${i}`
  }
  r.i32() // net index
  for (;;) {
    const p = name()
    if (p === 'None') break
    const type = name()
    const size = r.i32()
    r.i32()
    if (type === 'BoolProperty') {
      r.skip(1)
      continue
    }
    if (type === 'StructProperty' || type === 'ByteProperty') name()
    r.skip(size)
  }
  r.skip(28) // bounds: origin, extent, sphere radius
  const materials = Array.from({ length: r.i32() }, () => r.i32())
  r.skip(12 + 12) // origin, rotation
  const bones: MeshBone[] = []
  for (let n = r.i32(), i = 0; i < n; i++) {
    const bone = name()
    r.u32() // flags
    const rotation: MeshBone['rotation'] = [r.f32(), r.f32(), r.f32(), r.f32()]
    const position: MeshBone['position'] = [r.f32(), r.f32(), r.f32()]
    r.i32() // children
    const parent = r.i32()
    r.u32() // color
    bones.push({ name: bone, parent, rotation, position })
  }
  r.i32() // skeletal depth
  if (r.i32() < 1) throw new Error('a mesh with no level of detail')
  // The first level of detail.
  const sections: MeshSection[] = []
  for (let n = r.i32(), i = 0; i < n; i++) {
    const material = r.i16()
    r.i16() // chunk
    const firstIndex = r.i32()
    const triangles = r.i32()
    r.u8()
    sections.push({ material, firstIndex, triangles })
  }
  r.i32() // index buffer: unknown
  const itemSize = r.u8()
  const elementSize = r.i32()
  const count = r.i32()
  if (elementSize !== itemSize) throw new Error('an index buffer the app does not read')
  const indices =
    itemSize === 2
      ? new Uint16Array(pkg.bytes.slice(r.o, r.o + 2 * count).buffer)
      : new Uint32Array(pkg.bytes.slice(r.o, r.o + 4 * count).buffer)
  r.skip(itemSize * count)
  r.skip(2 * r.i32()) // used bones
  const chunks: { firstVertex: number; boneMap: number[] }[] = []
  for (let n = r.i32(), i = 0; i < n; i++) {
    const firstVertex = r.i32()
    if (r.i32() || r.i32()) throw new Error('a mesh with CPU-skinned vertices')
    const boneMap = Array.from({ length: r.i32() }, () => r.i16())
    chunks.push({ firstVertex, boneMap })
    r.skip(12) // rigid and soft counts, max influences
  }
  r.i32() // size
  const vertexCount = r.i32()
  r.skip(r.i32()) // required bones
  {
    // Bulk data of ints (raw point indices).
    const flags = r.u32()
    r.i32()
    const sizeOnDisk = r.i32()
    r.i32()
    if (!(flags & 0x21)) r.skip(sizeOnDisk)
  }
  const uvSets = r.i32()
  // Then flags, the mesh's extension and origin (this game has one field
  // more than UE Viewer lists): the vertex array starts where its element
  // size and count are, the count being the vertex count above.
  let stride = 0
  for (let k = 0; k < 16 && !stride; k++) {
    const at = r.o + 4 * k
    if (r.v.getInt32(at + 4, true) === vertexCount && r.v.getInt32(at, true) >= 28) {
      stride = r.v.getInt32(at, true)
      r.o = at + 8
    }
  }
  if (!stride) throw new Error('the mesh is not laid out as expected (vertices)')
  const n = vertexCount
  // The UVs' precision shows in the vertex size: 4 bytes a set as halves, 8 as floats.
  const fullUVs = stride === 16 + 12 + 8 * uvSets
  const positions = new Float32Array(3 * n)
  const normals = new Float32Array(3 * n)
  const tangents = new Float32Array(4 * n)
  const bones4 = new Uint16Array(4 * n)
  const weights4 = new Uint8Array(4 * n)
  const uvs = new Float32Array(2 * n)
  for (let i = 0; i < n; i++) {
    const at = r.o + i * stride
    // Normal[0] (tangent), Normal[2] (normal), bone indices, bone weights, position, UVs.
    for (let k = 0; k < 3; k++) {
      normals[3 * i + k] = unpackNormal(pkg.bytes[at + 4 + k]!)
      tangents[4 * i + k] = unpackNormal(pkg.bytes[at + k]!)
    }
    // The normal's fourth byte carries the bitangent's sign.
    tangents[4 * i + 3] = pkg.bytes[at + 7]! >= 128 ? 1 : -1
    // Four influences: bone indices into the vertex's chunk's bone map, and weights.
    const chunk = [...chunks].reverse().find((c) => c.firstVertex <= i)
    for (let k = 0; k < 4; k++) {
      bones4[4 * i + k] = chunk?.boneMap[pkg.bytes[at + 8 + k]!] ?? 0
      weights4[4 * i + k] = pkg.bytes[at + 12 + k]!
    }
    const v = new DataView(pkg.bytes.buffer, pkg.bytes.byteOffset + at + 16, stride - 16)
    for (let k = 0; k < 3; k++) positions[3 * i + k] = v.getFloat32(4 * k, true)
    if (fullUVs) {
      uvs[2 * i] = v.getFloat32(12, true)
      uvs[2 * i + 1] = v.getFloat32(16, true)
    } else {
      uvs[2 * i] = half(v.getUint16(12, true))
      uvs[2 * i + 1] = half(v.getUint16(14, true))
    }
  }
  if (stride !== 16 + 12 + (fullUVs ? 8 : 4) * uvSets)
    throw new Error('the mesh is not laid out as expected (vertex size)')
  return {
    materials,
    bones,
    sections,
    indices,
    vertexCount,
    positions,
    normals,
    uvs,
    tangents,
    influences: { bones: bones4, weights: weights4 },
  }
}

type Quat = [number, number, number, number]
const qmul = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
]
function rotate(q: Quat, x: number, y: number, z: number): [number, number, number] {
  const r = qmul(qmul(q, [x, y, z, 0]), [-q[0], -q[1], -q[2], q[3]])
  return [r[0], r[1], r[2]]
}

/** Each bone's place in the mesh's space, in the rest pose (rotations as stored, parents first). */
export function boneWorld(
  bones: MeshBone[],
): { rotation: Quat; position: [number, number, number] }[] {
  const out: { rotation: Quat; position: [number, number, number] }[] = []
  bones.forEach((b, i) => {
    if (i === 0 || b.parent < 0 || b.parent >= i) {
      out.push({ rotation: [...b.rotation], position: [...b.position] })
      return
    }
    const p = out[b.parent]!
    const t = rotate(p.rotation, ...b.position)
    out.push({
      rotation: qmul(p.rotation, b.rotation),
      position: [t[0] + p.position[0], t[1] + p.position[1], t[2] + p.position[2]],
    })
  })
  return out
}

/** A mesh moved to a place (a bone's, for hair on its socket): positions and normals. */
export function placeMesh(
  m: SkelMesh,
  at: { rotation: Quat; position: [number, number, number] },
): SkelMesh {
  const positions = new Float32Array(m.positions.length)
  const normals = new Float32Array(m.normals.length)
  const tangents = new Float32Array(m.tangents.length)
  for (let i = 0; i < m.vertexCount; i++) {
    const p = rotate(
      at.rotation,
      m.positions[3 * i]!,
      m.positions[3 * i + 1]!,
      m.positions[3 * i + 2]!,
    )
    const n = rotate(at.rotation, m.normals[3 * i]!, m.normals[3 * i + 1]!, m.normals[3 * i + 2]!)
    const t = rotate(
      at.rotation,
      m.tangents[4 * i]!,
      m.tangents[4 * i + 1]!,
      m.tangents[4 * i + 2]!,
    )
    for (let k = 0; k < 3; k++) {
      positions[3 * i + k] = p[k]! + at.position[k]!
      normals[3 * i + k] = n[k]!
      tangents[4 * i + k] = t[k]!
    }
    tangents[4 * i + 3] = m.tangents[4 * i + 3]!
  }
  return { ...m, positions, normals, tangents }
}

/** A bone's place relative to its parent: rotation as the skeleton stores it, and position. */
export interface LocalPose {
  rotation: Quat
  position: [number, number, number]
}

/**
 * The mesh in a pose: each bone's local rotation and position by name (bones
 * the pose lacks keep the rest pose), every vertex moved by its bones'
 * weighted change from the rest pose. Positions, normals and tangents.
 */
export function poseMesh(m: SkelMesh, pose: Map<string, LocalPose>): SkelMesh {
  const rest = boneWorld(m.bones)
  const posed = boneWorld(
    m.bones.map((b) => {
      const p = pose.get(b.name)
      return p ? { ...b, rotation: p.rotation, position: p.position } : b
    }),
  )
  // Per bone: rest-space to posed-space, as a rotation and a translation.
  const moves = rest.map((r, i) => {
    const inv: Quat = [-r.rotation[0], -r.rotation[1], -r.rotation[2], r.rotation[3]]
    const q = qmul(posed[i]!.rotation, inv)
    const t = rotate(q, ...r.position)
    return {
      q,
      t: [posed[i]!.position[0] - t[0], posed[i]!.position[1] - t[1], posed[i]!.position[2] - t[2]],
    }
  })
  const positions = new Float32Array(m.positions.length)
  const normals = new Float32Array(m.normals.length)
  const tangents = new Float32Array(m.tangents.length)
  for (let i = 0; i < m.vertexCount; i++) {
    let wsum = 0
    for (let k = 0; k < 4; k++) {
      const w = m.influences.weights[4 * i + k]! / 255
      if (!w) continue
      const mv = moves[m.influences.bones[4 * i + k]!]
      if (!mv) continue
      wsum += w
      const p = rotate(mv.q, m.positions[3 * i]!, m.positions[3 * i + 1]!, m.positions[3 * i + 2]!)
      const n = rotate(mv.q, m.normals[3 * i]!, m.normals[3 * i + 1]!, m.normals[3 * i + 2]!)
      const t = rotate(mv.q, m.tangents[4 * i]!, m.tangents[4 * i + 1]!, m.tangents[4 * i + 2]!)
      for (let c = 0; c < 3; c++) {
        positions[3 * i + c]! += w * (p[c]! + mv.t[c]!)
        normals[3 * i + c]! += w * n[c]!
        tangents[4 * i + c]! += w * t[c]!
      }
    }
    if (wsum === 0)
      for (let c = 0; c < 3; c++) {
        positions[3 * i + c] = m.positions[3 * i + c]!
        normals[3 * i + c] = m.normals[3 * i + c]!
        tangents[4 * i + c] = m.tangents[4 * i + c]!
      }
    else if (wsum < 0.999)
      for (let c = 0; c < 3; c++) {
        positions[3 * i + c]! /= wsum
        normals[3 * i + c]! /= wsum
        tangents[4 * i + c]! /= wsum
      }
    tangents[4 * i + 3] = m.tangents[4 * i + 3]!
  }
  return { ...m, positions, normals, tangents }
}

/** A bone's place in the mesh's space in a pose (for hair and helmets on the head). */
export function posedBone(m: SkelMesh, pose: Map<string, LocalPose>, name: string) {
  const i = m.bones.findIndex((b) => b.name === name)
  if (i < 0) return undefined
  return boneWorld(
    m.bones.map((b) => {
      const p = pose.get(b.name)
      return p ? { ...b, rotation: p.rotation, position: p.position } : b
    }),
  )[i]
}
