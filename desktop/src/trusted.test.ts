// The trusted-updates client against the service's own test vectors
// (test-vectors/trusted-updates: innonova/trusted-updates at v0.3.1): every
// case must come out as the vector says, as format.md §8 defines them.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { check, checkFile, newer, type Decision, type PublicKey } from './trusted'

const VECTORS = path.join(__dirname, '..', 'test-vectors', 'trusted-updates')
const read = (dir: string) =>
  readdirSync(path.join(VECTORS, dir))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({ file: f, v: JSON.parse(readFileSync(path.join(VECTORS, dir, f), 'utf8')) }))

interface Case {
  description: string
  given: {
    root_keys: PublicKey[]
    product: string
    channel: string
    platform: string
    kinds: string[]
    now: string
    state: { keys_version: number; channel_issued?: string; installed?: Record<string, { version: string; sha256?: string }> }
  }
  documents: Record<string, string>
  expect:
    | { result: 'ok'; decisions: Record<string, { action: string; version?: string; sha256?: string }>; state: { keys_version: number; channel_issued?: string } }
    | { result: 'rejected'; reason: string }
}

for (const { file, v } of read('cases')) {
  const c = v as Case
  test(`vector ${file}: ${c.description}`, async () => {
    const g = c.given
    const r = await check(
      {
        rootKeys: g.root_keys,
        product: g.product,
        channel: g.channel,
        platform: g.platform,
        kinds: g.kinds,
        now: new Date(g.now),
        state: { keys_version: g.state.keys_version, channel_issued: g.state.channel_issued },
        installed: g.state.installed ?? {},
      },
      // A missing document is a fetch that fails.
      async (name) => c.documents[name],
    )
    if (c.expect.result === 'rejected') {
      assert.deepEqual(r, { result: 'rejected', reason: c.expect.reason })
      return
    }
    assert.equal(r.result, 'ok', r.result === 'rejected' ? r.reason : '')
    if (r.result !== 'ok') return
    for (const [kind, d] of Object.entries(c.expect.decisions)) {
      const got: Decision = r.decisions[kind]!
      assert.equal(got.action, d.action, `${kind}: action`)
      if (d.version !== undefined) assert.equal(got.artifact?.version, d.version, `${kind}: version`)
      if (d.sha256 !== undefined) assert.equal(got.artifact?.sha256, d.sha256, `${kind}: sha256`)
    }
    assert.deepEqual(
      { keys_version: r.state.keys_version, ...(r.state.channel_issued ? { channel_issued: r.state.channel_issued } : {}) },
      c.expect.state,
    )
  })
}

for (const { file, v } of read('files')) {
  test(`file vector ${file}: ${v.description}`, () => {
    assert.equal(checkFile(Buffer.from(v.file_base64, 'base64'), v.artifact), v.expect)
  })
}

test('versions compare as format.md §1 says', () => {
  assert.equal(newer('1.10', '1.9'), true)
  assert.equal(newer('1.4', '1.4.0'), false)
  assert.equal(newer('1.4.0', '1.4.0-rc.1'), true)
  assert.equal(newer('1.4.0-rc.2', '1.4.0-rc.10'), false)
  assert.equal(newer('1.4.0-alpha', '1.4.0-1'), true)
  assert.equal(newer('2026.1025.120000', '2026.1023.155206'), true)
  assert.equal(newer('not-a-version', '1.0'), false)
  assert.equal(newer('1.0+build.7', '1.0'), false)
})
