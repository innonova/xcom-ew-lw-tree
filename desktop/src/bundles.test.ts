import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { packBundle, sha256, unpack } from './bundle-format'
import { BundleStore, type Fetch } from './bundles'

const pair = () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  return {
    /** The 32 raw bytes, base64, as trusted-updates writes keys. */
    raw: publicKey.export({ type: 'spki', format: 'der' }).subarray(12).toString('base64'),
    key: privateKey,
  }
}
const theirs = pair()
// trusted-updates in miniature (trusted.ts): a root key, and the channel's key it vouches for.
const root = pair()
const channelKey = pair()
const envelope = (body: object, id: string, key = channelKey.key) => {
  const text = JSON.stringify(body)
  return JSON.stringify({ body: text, key: id, signature: sign(null, Buffer.from(text), key).toString('base64') })
}
const KEYS_JSON = envelope(
  {
    type: 'keys', format: 1, product: 'lwtree', version: 1, issued: '2026-10-25T00:00:00Z',
    channels: {}, testers: [{ id: 'lwtree.testers.1', ed25519: channelKey.raw }], revoked: [],
  },
  'root.test.1',
  root.key,
)
let issued = 0
/** The channel file, naming files under the test server; a newer `issued` each time. */
function channel(artifacts: { kind: string; platform?: string; version: string; file: string; data: Uint8Array }[], revoked: { kind: string; version: string; sha256: string }[] = [], key = channelKey.key) {
  issued++
  return envelope(
    {
      type: 'channel', format: 1, product: 'lwtree', channel: 'test',
      issued: new Date(Date.UTC(2026, 9, 25, 0, 0, issued)).toISOString().replace('.000', ''),
      expires: '2099-01-01T00:00:00Z',
      artifacts: artifacts.map((a) => ({
        kind: a.kind, ...(a.platform ? { platform: a.platform } : {}), version: a.version, name: a.file,
        url: `https://downloads.test/${a.file}`, size: a.data.length, sha256: sha256(a.data), commit: 'c0ffee', run: 'https://ci.test/1',
      })),
      revoked: revoked.map((r) => ({ ...r, reason: 'test' })),
    },
    'lwtree.testers.1',
    key,
  )
}

function site(marker: string) {
  const dir = mkdtempSync(path.join(tmpdir(), 'lwtree-site-'))
  mkdirSync(path.join(dir, 'assets'))
  writeFileSync(path.join(dir, 'index.html'), `<html>${marker}</html>`)
  writeFileSync(path.join(dir, 'assets', 'app.js'), `console.log(${JSON.stringify(marker)})`)
  return dir
}
/** A plain bundle file, as the release workflow publishes it. */
async function bundle(version: string, minShellVersion = '0.2.0') {
  const payload = await packBundle(site(`site ${version}`), { version, minShellVersion, releaseDate: '2026-10-19T00:00:00Z' })
  return Buffer.from(JSON.stringify(payload))
}

/** The update server and the download host in memory: path → bytes. */
function server(files: Record<string, unknown>): Fetch {
  return async (url) => {
    const p = new URL(url).pathname.replace(/^\//, '')
    const body = files[p]
    if (body === undefined) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }
    const bytes = body instanceof Uint8Array ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    }
  }
}
/** The files of a channel offering this bundle (and a shell, if given). */
async function offering(version: string, minShellVersion = '0.2.0', shell?: { version: string; data: Uint8Array }) {
  const data = await bundle(version, minShellVersion)
  const artifacts = [{ kind: 'bundle', version, file: `bundle-${version}.json`, data }]
  if (shell) artifacts.push({ kind: 'shell', platform: 'win-x64', version: shell.version, file: `Setup-${shell.version}.exe`, data: shell.data } as never)
  const files: Record<string, unknown> = { 'lwtree/keys.json': KEYS_JSON, 'lwtree/test.json': channel(artifacts) }
  for (const a of artifacts) files[a.file] = a.data
  return files
}
function store(files: Record<string, unknown>, shellVersion = '0.2.0', dir = mkdtempSync(path.join(tmpdir(), 'lwtree-bundles-'))) {
  return new BundleStore({
    dir,
    baseDir: site('base'),
    baseVersion: '2026.1019.100000',
    shellVersion,
    trusted: {
      base: 'https://updates.test',
      product: 'lwtree',
      channel: 'test',
      platform: 'win-x64',
      rootKeys: [{ id: 'root.test.1', ed25519: root.raw }],
      keysVersion: 1,
    },
    fetch: server(files),
  })
}
const served = (s: BundleStore) => readFileSync(path.join(s.activeDir, 'index.html'), 'utf8')

test('refuses a damaged file or a path out of the bundle', async () => {
  const payload = await packBundle(site('x'), {
    version: '1',
    minShellVersion: '0',
    releaseDate: '',
  })
  const bad = { ...payload, files: payload.files.map((f) => ({ ...f, sha256: '0'.repeat(64) })) }
  assert.throws(() => [...unpack(bad)], /damaged/)
  const out = { ...payload, files: [{ ...payload.files[0]!, path: '../evil.html' }] }
  assert.throws(() => [...unpack(out)], /bad path/)
})

test('installs a newer bundle for the next start, and serves it once restarted into', async () => {
  const s = store(await offering('2026.1019.120000'))
  await s.start()
  assert.equal(served(s), '<html>base</html>')
  const st = await s.check()
  assert.equal(st.error, undefined)
  assert.equal(st.ready, '2026.1019.120000')
  assert.equal(served(s), '<html>base</html>') // not until the player says so
  assert.ok(s.activate())
  assert.equal(served(s), '<html>site 2026.1019.120000</html>')
})

test('installs nothing older, equal or for a newer shell', async () => {
  for (const [files, why] of [
    [await offering('2026.1019.090000'), 'older'],
    [await offering('2026.1019.100000'), 'equal'],
    [await offering('2026.1019.120000', '0.9.0'), 'newer shell'],
  ] as const) {
    const s = store(files)
    await s.start()
    const st = await s.check()
    assert.equal(st.ready, undefined, why)
    assert.equal(served(s), '<html>base</html>', why)
  }
})

test('a download that is not what the signed channel file names is refused', async () => {
  const files = await offering('2026.1019.120000')
  files['bundle-2026.1019.120000.json'] = await bundle('2026.1019.130000')
  const s = store(files)
  await s.start()
  const st = await s.check()
  assert.match(st.error ?? '', /not the one announced \(file-(size|sha256)\)/)
  assert.equal(st.ready, undefined)
})

test('a channel file signed by a key trusted-updates does not vouch for: refused, and said', async () => {
  const files = await offering('2026.1019.120000')
  files['lwtree/test.json'] = channel([{ kind: 'bundle', version: '2026.1019.120000', file: 'bundle-2026.1019.120000.json', data: files['bundle-2026.1019.120000.json'] as Uint8Array }], [], theirs.key)
  const s = store(files)
  await s.start()
  const st = await s.check()
  assert.equal(st.unconfirmed, 'channel-signature')
  assert.match(st.error ?? '', /^Couldn't confirm this app is up to date \(channel-signature\)/)
  assert.equal(st.ready, undefined)
  // No trusted-updates at all: the same, said.
  const gone = store({})
  await gone.start()
  assert.equal((await gone.check()).unconfirmed, 'fetch')
})

/** Until a newer shell fetched in the background is in, or refused. */
async function settled(s: BundleStore) {
  for (let i = 0; i < 200 && s.state.shell?.fetching; i++) await new Promise((r) => setTimeout(r, 10))
}

test('a bundle that needs a newer shell brings the shell, checked before it may run', async () => {
  const exe = Buffer.from('MZ pretend installer')
  const files = await offering('2026.1019.120000', '0.9.0', { version: '0.9.0', data: exe })
  const s = store(files)
  await s.start()
  // Fetched in the background: the check does not wait for it.
  const st = await s.check()
  assert.equal(st.shell?.fetching, true)
  await settled(s)
  assert.deepEqual(st.shell, { version: '0.9.0', needed: true, downloaded: true, fetching: false })
  assert.ok(s.installer && readFileSync(s.installer).equals(exe))
  // A download that is not the one announced: refused.
  const swapped = store({ ...files, 'Setup-0.9.0.exe': Buffer.from('MZ something else!!') })
  await swapped.start()
  await swapped.check()
  await settled(swapped)
  assert.match(swapped.state.error ?? '', /not the one announced/)
  assert.equal(swapped.installer, undefined)
})

test('a bundle it runs that was withdrawn is moved off, to the one offered, older or not', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lwtree-bundles-'))
  const bad = await bundle('2026.1019.120000')
  const a = store(await offering('2026.1019.120000'), '0.2.0', dir)
  await a.start()
  await a.check()
  assert.ok(a.activate())
  await a.good()
  // Withdrawn; the channel offers an older one.
  const older = await bundle('2026.1019.110000')
  const files: Record<string, unknown> = {
    'lwtree/keys.json': KEYS_JSON,
    'lwtree/test.json': channel([{ kind: 'bundle', version: '2026.1019.110000', file: 'bundle-2026.1019.110000.json', data: older }], [{ kind: 'bundle', version: '2026.1019.120000', sha256: sha256(bad) }]),
    'bundle-2026.1019.110000.json': older,
  }
  const b = store(files, '0.2.0', dir)
  await b.start()
  assert.equal(served(b), '<html>site 2026.1019.120000</html>')
  const st = await b.check()
  assert.equal(st.error, undefined)
  assert.equal(st.ready, '2026.1019.110000')
  assert.ok(b.activate())
  assert.equal(served(b), '<html>site 2026.1019.110000</html>')
})

test('rolls back a bundle that never says it started, and does not take it again', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lwtree-bundles-'))
  const files = await offering('2026.1019.120000')
  const a = store(files, '0.2.0', dir)
  await a.start()
  await a.check()
  // Next start serves it; it never reports good; the start after rolls back.
  const b = store(files, '0.2.0', dir)
  await b.start()
  assert.equal(served(b), '<html>site 2026.1019.120000</html>')
  const c = store(files, '0.2.0', dir)
  await c.start()
  assert.equal(served(c), '<html>base</html>')
  assert.equal((await c.check()).ready, undefined)
})

test('a bundle that reports good stays, and a partial one is never served', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lwtree-bundles-'))
  const files = await offering('2026.1019.120000')
  const a = store(files, '0.2.0', dir)
  await a.start()
  await a.check()
  for (let i = 0; i < 3; i++) {
    const s = store(files, '0.2.0', dir)
    await s.start()
    assert.equal(served(s), '<html>site 2026.1019.120000</html>')
    await s.good()
  }
  rmSync(path.join(dir, '2026.1019.120000', 'assets', 'app.js'))
  const broken = store(files, '0.2.0', dir)
  await broken.start()
  assert.equal(served(broken), '<html>base</html>')
})
