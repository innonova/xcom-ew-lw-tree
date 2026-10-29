// Site bundles (features/desktop-updates.md, release-signing.md): the built
// site packed into one file. The release workflow attests it and
// trusted-updates signs its hash (desktop/src/trusted.ts); the shell
// (bundles.ts) checks the download against that and unpacks it.

import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'

export interface BundleFile {
  /** Relative path with "/" ("assets/index-abc.js"). */
  path: string
  size: number
  sha256: string
  /** The file, gzipped, in base64. */
  data: string
}

/** The bundle file: everything about the bundle, its version included. */
export interface BundlePayload {
  version: string
  /** The oldest shell that can run this bundle (its bridge calls). */
  minShellVersion: string
  releaseDate: string
  files: BundleFile[]
}

/** Numeric dot versions ("0.2.0", "2026.1019.183005"): < 0, 0, > 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d
  }
  return 0
}

export const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

async function walk(dir: string, base = dir): Promise<string[]> {
  const out: string[] = []
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walk(p, base)))
    else if (e.isFile()) out.push(path.relative(base, p).split(path.sep).join('/'))
  }
  return out.sort()
}

/** Packs a built site (leaving out the given top-level folders, such as app/ and bundle/). */
export async function packBundle(
  dir: string,
  meta: { version: string; minShellVersion: string; releaseDate: string },
  leaveOut: string[] = [],
): Promise<BundlePayload> {
  const files: BundleFile[] = []
  for (const rel of await walk(dir)) {
    if (leaveOut.includes(rel.split('/')[0]!)) continue
    const data = await fs.readFile(path.join(dir, rel))
    files.push({
      path: rel,
      size: data.length,
      sha256: sha256(data),
      data: gzipSync(data).toString('base64'),
    })
  }
  return { ...meta, files }
}

/** A bundle's files, unpacked and checked against their size and hash. */
export function* unpack(payload: BundlePayload): Generator<{ path: string; data: Buffer }> {
  for (const f of payload.files) {
    if (
      !f.path ||
      f.path.split('/').some((p) => !p || p === '.' || p === '..') ||
      /^[\\/]|:/.test(f.path)
    )
      throw new Error(`bad path in bundle: ${f.path}`)
    const data = gunzipSync(Buffer.from(f.data, 'base64'))
    if (data.length !== f.size || sha256(data) !== f.sha256)
      throw new Error(`damaged file in bundle: ${f.path}`)
    yield { path: f.path, data }
  }
}
