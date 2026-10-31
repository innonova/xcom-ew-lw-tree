import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readMaterialInstance, readPalette } from '../material'
import { boneWorld, placeMesh, readSkelMesh } from '../skelmesh'
import { Package, decompressPackage } from '@innonova/upkit/upk'

// The person's install (git-ignored samples/).
const C = resolve(import.meta.dirname, '../../../samples/CookedPCConsole')
const open = (f: string) =>
  new Package(decompressPackage(new Uint8Array(readFileSync(`${C}/${f}`))))

describe.skipIf(!existsSync(`${C}/Startup.upk`))(
  'what soldiers are painted with (model/material.ts)',
  () => {
    it('the armor material: its textures and its own top and bottom colors', () => {
      const p = open('Soldier_MaleKevlar_SF.upk')
      const m = readMaterialInstance(
        p,
        p.exports.findIndex((e) => e.name === 'MInst_Lv1MedMale1'),
      )
      expect(m.parent).toBe('CHH_Soldiers')
      expect(Object.keys(m.textures).sort()).toEqual(['Diffuse', 'Normal', 'Spc_Ems_Ref_Opc'])
      expect(m.vectors.CMOD?.map((x) => x.toFixed(3))).toEqual(['0.255', '0.151', '0.045', '1.000'])
    })

    it('the armor tint palette: 32 entries, Long War’s colors 1 to 32', () => {
      const p = open('Startup.upk')
      const pal = readPalette(
        p,
        p.exports.findIndex((e) => e.name === 'ArmorTint' && e.type === 'XComLinearColorPalette'),
      )
      expect(pal.length).toBe(32)
      const srgb = (c: number[]) => c.slice(0, 3).map((x) => Math.round(Math.pow(x, 1 / 2.2) * 255))
      // Entry 17 is Long War's color 18, red with yellow; entry 31 its 32, black.
      expect(srgb(pal[17]!.primary)).toEqual([158, 11, 15])
      expect(srgb(pal[17]!.secondary)).toEqual([252, 230, 0])
      expect(srgb(pal[31]!.primary)).toEqual([45, 45, 45])
    })

    it('hair sits on the head: placed at the body’s head bone, its top meets the head’s', () => {
      const body = readSkelMesh(
        open('Soldier_MaleKevlar_SF.upk'),
        open('Soldier_MaleKevlar_SF.upk').exports.findIndex((e) => e.name === 'SM_Lv1MedMale'),
      )
      const hp = open('Hair_MaleHair_A_SF.upk')
      const hair = readSkelMesh(
        hp,
        hp.exports.findIndex((e) => e.type === 'SkeletalMesh'),
      )
      const hd = open('Head_CaucMale_A_SF.upk')
      const head = readSkelMesh(
        hd,
        hd.exports.findIndex((e) => e.type === 'SkeletalMesh'),
      )
      const placed = placeMesh(
        hair,
        boneWorld(body.bones)[body.bones.findIndex((b) => b.name === 'RigHead')]!,
      )
      const top = (m: { positions: Float32Array }) => {
        let z = -1e9
        for (let i = 2; i < m.positions.length; i += 3) z = Math.max(z, m.positions[i]!)
        return z
      }
      expect(Math.abs(top(placed) - top(head))).toBeLessThan(1)
    })
  },
)
