import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readAnimSet, readClip, sampleClip } from '../anim'
import { posedBone, poseMesh, readSkelMesh, type LocalPose } from '../skelmesh'
import { Package, decompressPackage } from '@innonova/upkit/upk'

// The person's install (git-ignored samples/).
const C = resolve(import.meta.dirname, '../../../samples/CookedPCConsole')
const open = (f: string) =>
  new Package(decompressPackage(new Uint8Array(readFileSync(`${C}/${f}`))))
/** The idle the app stands the soldier in (state/soldier.ts). */
const IDLE = 'Loadout_DressUniform_IdleA'
describe.skipIf(!existsSync(`${C}/Soldier_MaleKevlar_SF.upk`))(
  'soldiers (model/skelmesh.ts)',
  () => {
    it('reads the male Kevlar body: bones, sections, vertices in the rest pose', () => {
      const p = new Package(
        decompressPackage(new Uint8Array(readFileSync(`${C}/Soldier_MaleKevlar_SF.upk`))),
      )
      const m = readSkelMesh(
        p,
        p.exports.findIndex((e) => e.type === 'SkeletalMesh' && e.name === 'SM_Lv1MedMale'),
      )
      expect(m.bones.length).toBe(109)
      expect(m.bones.slice(0, 3).map((b) => b.name)).toEqual(['RigRoot', 'RigPelvis', 'RigLThigh'])
      expect(m.sections).toEqual([
        { material: 0, firstIndex: 0, triangles: 4824 },
        { material: 1, firstIndex: 14472, triangles: 32 },
      ])
      expect(m.vertexCount).toBe(3091)
      expect(Math.max(...m.indices)).toBeLessThan(m.vertexCount)
      // About 120 units tall, feet at 0, and the normals of unit length.
      let top = 0
      for (let i = 2; i < m.positions.length; i += 3) top = Math.max(top, m.positions[i]!)
      expect(Math.round(top)).toBe(120)
      const n = Math.hypot(m.normals[0]!, m.normals[1]!, m.normals[2]!)
      expect(n).toBeGreaterThan(0.9)
      expect(n).toBeLessThan(1.1)
    })

    it('reads the barracks animations: every key, frame tables in order, loops that close', () => {
      const a = open('Anim_Barracks.upk')
      const set = readAnimSet(
        a,
        a.exports.findIndex((e) => e.type === 'AnimSet'),
      )
      expect(set.tracks.length).toBe(109)
      expect(set.rotationOnly).toBe(false)
      for (const s of set.sequences) {
        const clip = readClip(a, set, s.index)
        for (const [, t] of clip.tracks)
          for (const k of [t.rotation, t.position]) {
            if (!k || k.values.length < 2) continue
            expect(k.frames[0]).toBe(0)
            expect(k.frames.every((f, i) => !i || f > k.frames[i - 1]!)).toBe(true)
            expect(k.frames[k.frames.length - 1]!).toBeLessThanOrEqual(clip.frames - 1)
          }
      }
      const idle = readClip(a, set, set.sequences.find((s) => s.name === IDLE)!.index)
      expect(idle.frames).toBe(101)
      expect(idle.length).toBeCloseTo(3.33, 2)
      // It loops: its end is its start.
      const start = sampleClip(idle, 0).get('RigHead')!.rotation
      const end = sampleClip(idle, idle.length * 0.9999).get('RigHead')!.rotation
      expect(Math.abs(start.reduce((d, x, k) => d + x * end[k]!, 0))).toBeCloseTo(1, 4)
    })

    it('stands the body in the idle: arms at the sides, as tall, the head moving', () => {
      const a = open('Anim_Barracks.upk')
      const set = readAnimSet(
        a,
        a.exports.findIndex((e) => e.type === 'AnimSet'),
      )
      const idle = readClip(a, set, set.sequences.find((s) => s.name === IDLE)!.index)
      const p = open('Soldier_MaleKevlar_SF.upk')
      const m = readSkelMesh(
        p,
        p.exports.findIndex((e) => e.type === 'SkeletalMesh' && e.name === 'SM_Lv1MedMale'),
      )
      // As the app does (state/soldier.ts): rotations conjugated, positions where given.
      const poseAt = (seconds: number) => {
        const anim = sampleClip(idle, seconds)
        const pose = new Map<string, LocalPose>()
        for (const b of m.bones) {
          const k = anim.get(b.name)
          if (!k || b.parent < 0 || b.name === 'RigRoot') continue
          const q = k.rotation
          pose.set(b.name, {
            rotation: [-q[0], -q[1], -q[2], q[3]],
            position: k.position ?? b.position,
          })
        }
        return pose
      }
      const span = (xs: Float32Array, k: number) => {
        let lo = Infinity
        let hi = -Infinity
        for (let i = k; i < xs.length; i += 3) {
          lo = Math.min(lo, xs[i]!)
          hi = Math.max(hi, xs[i]!)
        }
        return [Math.round(lo) + 0, Math.round(hi) + 0]
      }
      const posed = poseMesh(m, poseAt(0))
      expect(span(m.positions, 0)).toEqual([-45, 45])
      expect(span(posed.positions, 0)).toEqual([-22, 27])
      expect(span(posed.positions, 2)).toEqual([0, 120])
      // Breathing: the head moves a little over the loop.
      const head = (t: number) => posedBone(m, poseAt(t), 'RigHead')!.position
      const moved = Math.hypot(...head(0).map((x, k) => x - head(idle.length / 2)[k]!))
      expect(moved).toBeGreaterThan(0.05)
      expect(moved).toBeLessThan(2)
    })

    it('opens a package compressed whole: Startup.upk and its color palettes', () => {
      const p = new Package(decompressPackage(new Uint8Array(readFileSync(`${C}/Startup.upk`))))
      const palettes = p.exports
        .filter((e) => e.type === 'XComLinearColorPalette')
        .map((e) => e.name)
      expect(palettes).toContain('ArmorTint')
      expect(palettes.length).toBe(10)
    })
  },
)
