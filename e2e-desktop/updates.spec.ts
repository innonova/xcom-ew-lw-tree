import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { type Server } from 'node:http'
import { createServer } from 'node:https'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

// The desktop app's updates (features/desktop-updates.md, release-signing.md)
// against a local trusted-updates (desktop/src/trusted.ts) signing with test
// keys: a newer site is fetched, checked, offered, and served after a restart
// into it; a channel file signed by a stranger, or a download that is not the
// one it names, is refused and said.

const root = resolve(import.meta.dirname, '..')
const electronBin = join(
  root,
  'desktop/node_modules/electron/dist',
  process.platform === 'win32' ? 'electron.exe' : 'electron',
)
const require = createRequire(import.meta.url)
const { packBundle, sha256 } = require(join(root, 'desktop/dist/bundle-format.js'))

const pair = () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  return {
    key: privateKey,
    raw: publicKey.export({ type: 'spki', format: 'der' }).subarray(12).toString('base64'),
  }
}
const rootKey = pair()
const channelKey = pair()
const ROOT_KEYS = JSON.stringify([{ id: 'root.test.1', ed25519: rootKey.raw }])

const envelope = (body: object, id: string, key: KeyObject) => {
  const text = JSON.stringify(body)
  return JSON.stringify({
    body: text,
    key: id,
    signature: sign(null, Buffer.from(text), key).toString('base64'),
  })
}
const stamp = (d: Date) => d.toISOString().replace(/\.\d+Z$/, 'Z')
const keysJson = () =>
  envelope(
    {
      type: 'keys',
      format: 1,
      product: 'lwtree',
      version: 1,
      issued: stamp(new Date()),
      channels: {},
      testers: [{ id: 'lwtree.testers.1', ed25519: channelKey.raw }],
      revoked: [],
    },
    'root.test.1',
    rootKey.key,
  )
/** The channel file offering this bundle file, as trusted-updates signs it. */
function channelJson(channel: string, version: string, data: string, url: string, key = channelKey.key) {
  return envelope(
    {
      type: 'channel',
      format: 1,
      product: 'lwtree',
      channel,
      issued: stamp(new Date()),
      expires: stamp(new Date(Date.now() + 30 * 86400_000)),
      artifacts: [
        {
          kind: 'bundle',
          version,
          name: `bundle-${version}.json`,
          url: `${url}/bundle-${version}.json`,
          size: Buffer.byteLength(data),
          sha256: sha256(Buffer.from(data)),
          commit: 'c0ffee',
          run: 'https://ci.test/1',
        },
      ],
      revoked: [],
    },
    'lwtree.testers.1',
    key,
  )
}

/** The built site with a mark in its title, as a plain bundle file: what "a newer site" looks like here. */
async function newerSite(version: string) {
  const dir = mkdtempSync(join(tmpdir(), 'lwtree-newer-'))
  cpSync(join(root, 'dist'), dir, {
    recursive: true,
    filter: (src) => !/[\\/](app|bundle)([\\/]|$)/.test(src.slice(join(root, 'dist').length)),
  })
  const index = join(dir, 'index.html')
  writeFileSync(
    index,
    readFileSync(index, 'utf8').replace(/<title>[^<]*/, `<title>Newer site ${version}`),
  )
  const payload = await packBundle(dir, {
    version,
    minShellVersion: '0.2.0',
    releaseDate: new Date().toISOString(),
  })
  return JSON.stringify(payload)
}

function serve(
  files: Record<string, string> = {},
  asked: string[] = [],
): Promise<{ url: string; server: Server }> {
  return new Promise((done) => {
    const tls = join(root, 'e2e-desktop/fixtures/localhost-test')
    const server = createServer({ cert: readFileSync(`${tls}.crt`), key: readFileSync(`${tls}.key`) }, (req, res) => {
      const body = files[(req.url ?? '').split('?')[0]!.replace(/^\//, '')]
      asked.push((req.url ?? '').split('?')[0]!)
      res.writeHead(body ? 200 : 404, { 'Content-Type': 'application/json' })
      res.end(body ?? '')
    })
    server.listen(0, '127.0.0.1', () => {
      const a = server.address() as { port: number }
      done({ url: `https://127.0.0.1:${a.port}`, server })
    })
  })
}

let app: ElectronApplication | undefined
let server: Server | undefined
test.afterEach(async () => {
  await app?.close()
  server?.close()
})

/** The app pointed at `url` for the "test" channel; or, with `appDir`, at what its update.json says. */
async function launch(url: string, appDir?: string) {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
  delete env.ELECTRON_RUN_AS_NODE
  app = await electron.launch({
    executablePath: electronBin,
    // The local server's certificate is the fixture's own (fixtures/README.md).
    args: ['--ignore-certificate-errors', appDir ?? join(root, 'desktop')],
    env: {
      ...env,
      LWTREE_SITE: join(root, 'dist'),
      LWTREE_USER_DATA: mkdtempSync(join(tmpdir(), 'lwtree-upd-')),
      LWTREE_LIBRARY: mkdtempSync(join(tmpdir(), 'lwtree-lib-')),
      ...(appDir ? {} : { LWTREE_UPDATE_URL: url, LWTREE_UPDATE_CHANNEL: 'test' }),
      LWTREE_UPDATE_ROOT_KEYS: ROOT_KEYS,
      LWTREE_UPDATE_KEYS_VERSION: '1',
    },
  })
  const page = await app.firstWindow()
  await page.evaluate(() => localStorage.setItem('lwtree.helpSeen.v1', '1'))
  await page.reload()
  return page
}

/** A local trusted-updates and download host offering `version` on `channel`. */
async function offering(version: string, channel = 'test', asked?: string[]) {
  const files: Record<string, string> = {}
  const s = await serve(files, asked)
  server = s.server
  const data = await newerSite(version)
  files['lwtree/keys.json'] = keysJson()
  files[`lwtree/${channel}.json`] = channelJson(channel, version, data, s.url)
  files[`bundle-${version}.json`] = data
  return { url: s.url, files, data }
}

test('a newer released site: fetched, offered, and served after restarting into it', async () => {
  const v = '2099.0101.000000'
  const s = await offering(v)
  const page = await launch(s.url)
  await expect(page).not.toHaveTitle(/Newer site/)
  await page.getByRole('button', { name: 'Help', exact: true }).click()
  await page.getByRole('button', { name: 'Check for updates' }).click()
  // Said where it was asked for, with what to do; and marked in the header.
  const help = page.getByRole('dialog', { name: 'How this works' })
  await expect(help).toContainText(`A new site is ready: ${v}.`)
  await expect(page.getByRole('button', { name: 'Update ready' })).toBeVisible()
  await help.getByRole('button', { name: 'Restart into it' }).click()
  await expect(page).toHaveTitle(`Newer site ${v}`)
  // After the restart, said once.
  await expect(
    page.getByRole('status').filter({ hasText: `Updated: now on site ${v}.` }),
  ).toBeVisible()
})

test('a channel file signed by a stranger is refused and said; the app keeps its own', async () => {
  const v = '2099.0101.000000'
  const s = await offering(v)
  s.files['lwtree/test.json'] = channelJson('test', v, s.data, s.url, pair().key)
  const page = await launch(s.url)
  await page.getByRole('button', { name: 'Help', exact: true }).click()
  await page.getByRole('button', { name: 'Check for updates' }).click()
  await expect(
    page.getByText("Couldn't confirm this app is up to date (channel-signature)."),
  ).toBeVisible()
  await expect(page.getByText(/A new site is ready/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Update ready' })).toHaveCount(0)
  await expect(page).not.toHaveTitle(/Newer site/)
})

test('a download that is not the one the channel file names is refused', async () => {
  const v = '2099.0101.000000'
  const s = await offering(v)
  // The same size, other bytes (the files inside are base64: changed here in the open).
  s.files[`bundle-${v}.json`] = s.data.replace('"minShellVersion":"0.2.0"', '"minShellVersion":"0.2.1"')
  expect(s.files[`bundle-${v}.json`]).not.toBe(s.data)
  const page = await launch(s.url)
  await page.getByRole('button', { name: 'Help', exact: true }).click()
  await page.getByRole('button', { name: 'Check for updates' }).click()
  await expect(page.getByText(/last check failed: .*not the one announced/i)).toBeVisible()
  await expect(page.getByText(/A new site is ready/)).toHaveCount(0)
  await expect(page).not.toHaveTitle(/Newer site/)
})

test('a build takes its updates from the service, product and channel its update.json names', async () => {
  const v = '2099.0101.000000'
  const asked: string[] = []
  const s = await offering(v, 'production', asked)
  // The app as built: its code and an update.json, as the release workflow packs it.
  const dir = mkdtempSync(join(tmpdir(), 'lwtree-build-'))
  cpSync(join(root, 'desktop/package.json'), join(dir, 'package.json'))
  cpSync(join(root, 'desktop/dist'), join(dir, 'dist'), { recursive: true })
  writeFileSync(
    join(dir, 'update.json'),
    JSON.stringify({ base: s.url, product: 'lwtree', channel: 'production' }),
  )
  const page = await launch(s.url, dir)
  await page.getByRole('button', { name: 'Help', exact: true }).click()
  await page.getByRole('button', { name: 'Check for updates' }).click()
  await expect(page.getByRole('dialog', { name: 'How this works' })).toContainText(
    `A new site is ready: ${v}.`,
  )
  expect(asked).toContain('/lwtree/production.json')
  expect(asked).not.toContain('/lwtree/staging.json')
})
