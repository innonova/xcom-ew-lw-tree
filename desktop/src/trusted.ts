// The client of innonova's trusted-updates (features/release-signing.md): is
// there an update, and is it ours? Written from the service's specification,
// format 1 (docs/format.md in innonova/trusted-updates, §5 "What a client
// does"), and checked against its test vectors (test-vectors/trusted-updates).
// Electron-free, so its tests run in plain Node.
//
// keys.json, signed by a root key built in here, says which keys may sign
// which channel; the channel file, signed by one of those, names the current
// artifact of each kind and what was withdrawn. A check either accepts both,
// with a decision per kind, or rejects with a reason and changes nothing.

import { createHash, createPublicKey, verify } from 'node:crypto'

export interface PublicKey {
  id: string
  /** Ed25519, the 32 raw bytes in base64. */
  ed25519: string
}

export interface Artifact {
  kind: string
  platform?: string
  version: string
  name: string
  url: string
  size: number
  sha256: string
  attested_sha256?: string
  commit: string
  run: string
}

interface Revoked {
  kind: string
  platform?: string
  version: string
  sha256: string
  reason: string
}

interface KeysBody {
  type: 'keys'
  format: 1
  product: string
  version: number
  issued: string
  channels: Record<string, PublicKey[]>
  testers: PublicKey[]
  revoked: { id: string; ed25519: string; channel?: string; reason: string; revoked: string; valid_until?: string }[]
}

export interface ChannelBody {
  type: 'channel'
  format: 1
  product: string
  channel: string
  issued: string
  expires: string
  artifacts: Artifact[]
  revoked: Revoked[]
}

/** Kept between checks; replaced only after a check that succeeded. */
export interface TrustState {
  keys_version: number
  channel_issued?: string
}

export interface Installed {
  version: string
  /** When it is known (a downloaded artifact); revocation then goes by it. */
  sha256?: string
}

export interface CheckInput {
  rootKeys: PublicKey[]
  product: string
  channel: string
  platform: string
  kinds: string[]
  now: Date
  state: TrustState
  installed: Record<string, Installed | undefined>
}

/** A document's text by its name ("keys.json", "<channel>.json"), or undefined when the fetch failed. */
export type Fetcher = (name: string) => Promise<string | undefined>

export type Action = 'update' | 'move' | 'none' | 'revoked'
export interface Decision {
  action: Action
  /** The artifact to install, for update and move. */
  artifact?: Artifact
}

export type CheckResult =
  | { result: 'ok'; decisions: Record<string, Decision>; state: TrustState; channel: ChannelBody }
  | { result: 'rejected'; reason: string }

const TOLERANCE_MS = 24 * 3600 * 1000
const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/
const HASH = /^[0-9a-f]{64}$/
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

// --- Values --------------------------------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const isName = (v: unknown): v is string => typeof v === 'string' && NAME.test(v)
const isTime = (v: unknown): v is string => typeof v === 'string' && TIME.test(v) && !Number.isNaN(Date.parse(v))
const time = (v: string) => Date.parse(v)
const raw = (b64: unknown, length: number): Buffer | null => {
  if (typeof b64 !== 'string' || !BASE64.test(b64)) return null
  const b = Buffer.from(b64, 'base64')
  return b.length === length ? b : null
}
const isKey = (v: unknown): v is PublicKey => isObject(v) && typeof v.id === 'string' && raw(v.ed25519, 32) !== null

/** Versions as the format compares them: numeric parts, then pre-release as SemVer; build metadata ignored. */
interface Version {
  parts: number[]
  pre: string[]
}
function parseVersion(v: string): Version | null {
  const m = /^(\d+(?:\.\d+)*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(v)
  if (!m) return null
  return { parts: m[1]!.split('.').map(Number), pre: m[2] ? m[2].split('.') : [] }
}
/** Whether `a` is newer than `b`; a version not of the form is never newer than anything. */
export function newer(a: string, b: string | undefined): boolean {
  const x = parseVersion(a)
  if (!x) return false
  if (b === undefined) return true
  const y = parseVersion(b)
  if (!y) return true
  for (let i = 0; i < Math.max(x.parts.length, y.parts.length); i++) {
    const d = (x.parts[i] ?? 0) - (y.parts[i] ?? 0)
    if (d) return d > 0
  }
  // A pre-release is lower than the same version without one.
  if (!x.pre.length || !y.pre.length) return !x.pre.length && y.pre.length > 0
  for (let i = 0; i < Math.min(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i]!
    const q = y.pre[i]!
    if (p === q) continue
    const pn = /^\d+$/.test(p)
    const qn = /^\d+$/.test(q)
    if (pn && qn) return Number(p) > Number(q)
    if (pn !== qn) return !pn // numeric identifiers are lower than others
    return p > q
  }
  return x.pre.length > y.pre.length
}

// --- Envelopes -----------------------------------------------------------------

const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex')

/** The envelope's body, if its signature verifies with one of the keys (by the envelope's key id); else null. */
function opened(text: string, keys: PublicKey[]): string | null {
  let env: unknown
  try {
    env = JSON.parse(text)
  } catch {
    return null
  }
  if (!isObject(env) || typeof env.body !== 'string' || typeof env.key !== 'string') return null
  const key = keys.find((k) => k.id === env.key)
  const signature = raw(env.signature, 64)
  const publicKey = key && raw(key.ed25519, 32)
  if (!key || !signature || !publicKey) return null
  try {
    const ok = verify(null, Buffer.from(env.body, 'utf8'), createPublicKey({ key: Buffer.concat([SPKI_ED25519, publicKey]), format: 'der', type: 'spki' }), signature)
    return ok ? env.body : null
  } catch {
    return null
  }
}

// --- Bodies ----------------------------------------------------------------------

function keysBody(body: string): KeysBody | null {
  let b: unknown
  try {
    b = JSON.parse(body)
  } catch {
    return null
  }
  if (!isObject(b) || b.type !== 'keys' || b.format !== 1) return null
  if (!isName(b.product) || !Number.isInteger(b.version) || (b.version as number) < 1 || !isTime(b.issued)) return null
  if (!isObject(b.channels) || !Array.isArray(b.testers) || !Array.isArray(b.revoked)) return null
  const all: PublicKey[] = [...b.testers]
  for (const [name, list] of Object.entries(b.channels)) {
    if (!isName(name) || !Array.isArray(list)) return null
    all.push(...list)
  }
  for (const r of b.revoked) {
    if (!isObject(r) || typeof r.reason !== 'string' || !isTime(r.revoked)) return null
    if (r.channel !== undefined && !isName(r.channel)) return null
    if (r.valid_until !== undefined && !isTime(r.valid_until)) return null
    // A compromised key must say from when it may have been used by others.
    if (r.reason === 'compromised' && r.valid_until === undefined) return null
    all.push(r as unknown as PublicKey)
  }
  // The timestamp authorities: an id and a DER certificate in base64 each.
  if (b.timestamping !== undefined) {
    if (!Array.isArray(b.timestamping)) return null
    for (const t of b.timestamping)
      if (!isObject(t) || typeof t.id !== 'string' || typeof t.certificate !== 'string' || !t.certificate || !BASE64.test(t.certificate)) return null
  }
  // Every key whole, and one id one key wherever it appears.
  const byId = new Map<string, string>()
  for (const k of all) {
    if (!isKey(k)) return null
    if (byId.has(k.id) && byId.get(k.id) !== k.ed25519) return null
    byId.set(k.id, k.ed25519)
  }
  return b as unknown as KeysBody
}

function isArtifact(a: unknown): a is Artifact {
  return (
    isObject(a) &&
    isName(a.kind) &&
    (a.platform === undefined || isName(a.platform)) &&
    typeof a.version === 'string' &&
    typeof a.name === 'string' &&
    typeof a.url === 'string' &&
    /^https:\/\//.test(a.url) &&
    Number.isInteger(a.size) &&
    (a.size as number) >= 0 &&
    typeof a.sha256 === 'string' &&
    HASH.test(a.sha256) &&
    (a.attested_sha256 === undefined || (typeof a.attested_sha256 === 'string' && HASH.test(a.attested_sha256))) &&
    typeof a.commit === 'string' &&
    typeof a.run === 'string'
  )
}

function channelBody(body: string): ChannelBody | null {
  let b: unknown
  try {
    b = JSON.parse(body)
  } catch {
    return null
  }
  if (!isObject(b) || b.type !== 'channel' || b.format !== 1) return null
  if (!isName(b.product) || !isName(b.channel) || !isTime(b.issued) || !isTime(b.expires)) return null
  if (!Array.isArray(b.artifacts) || !Array.isArray(b.revoked)) return null
  if (!b.artifacts.every(isArtifact)) return null
  const pairs = new Set<string>()
  for (const a of b.artifacts as Artifact[]) {
    const pair = `${a.kind}\u0000${a.platform ?? ''}`
    if (pairs.has(pair)) return null
    pairs.add(pair)
  }
  for (const r of b.revoked) {
    if (!isObject(r) || !isName(r.kind) || typeof r.version !== 'string' || typeof r.sha256 !== 'string' || !HASH.test(r.sha256)) return null
    if (r.platform !== undefined && !isName(r.platform)) return null
  }
  return b as unknown as ChannelBody
}

// --- The check -----------------------------------------------------------------

/** format.md §5 "The check", steps 1 to 5: what to do for each kind, and the new state. */
export async function check(input: CheckInput, fetchDocument: Fetcher): Promise<CheckResult> {
  const reject = (reason: string): CheckResult => ({ result: 'rejected', reason })
  const now = input.now.getTime()

  // 1. keys.json, signed by a root key.
  const keysText = await fetchDocument('keys.json')
  if (keysText === undefined) return reject('fetch')
  const keysJson = opened(keysText, input.rootKeys)
  if (keysJson === null) return reject('keys-signature')
  const keys = keysBody(keysJson)
  if (!keys) return reject('keys-malformed')
  if (keys.product !== input.product) return reject('keys-product')
  if (keys.version < input.state.keys_version) return reject('keys-rollback')

  // 2. The keys that may sign the client's channel, without the revoked ones.
  const revokedIds = new Set(keys.revoked.map((r) => r.id))
  const allowed = (keys.channels[input.channel] ?? keys.testers).filter((k) => !revokedIds.has(k.id))

  // 3. The channel file, signed by one of them.
  const channelText = await fetchDocument(`${input.channel}.json`)
  if (channelText === undefined) return reject('fetch')
  const channelJson = opened(channelText, allowed)
  if (channelJson === null) return reject('channel-signature')
  const channel = channelBody(channelJson)
  if (!channel) return reject('channel-malformed')
  if (channel.product !== input.product || channel.channel !== input.channel) return reject('channel-mismatch')
  if (input.state.channel_issued !== undefined && time(channel.issued) < time(input.state.channel_issued)) return reject('channel-rollback')
  if (time(channel.issued) > now + TOLERANCE_MS) return reject('channel-future')
  if (time(channel.expires) + TOLERANCE_MS <= now) return reject('channel-expired')

  // 4. A decision per kind.
  const revokedSha = (kind: string, sha: string) => channel.revoked.some((r) => r.kind === kind && r.sha256 === sha)
  const decisions: Record<string, Decision> = {}
  for (const kind of input.kinds) {
    const offer =
      channel.artifacts.find((a) => a.kind === kind && a.platform === input.platform) ??
      channel.artifacts.find((a) => a.kind === kind && a.platform === undefined)
    const installed = input.installed[kind]
    const installedRevoked =
      !!installed &&
      channel.revoked.some(
        (r) =>
          r.kind === kind &&
          (r.platform === undefined || r.platform === input.platform) &&
          (installed.sha256 !== undefined ? r.sha256 === installed.sha256 : r.version === installed.version),
      )
    const usable = offer && !revokedSha(kind, offer.sha256) ? offer : undefined
    if (installedRevoked) decisions[kind] = usable ? { action: 'move', artifact: usable } : { action: 'revoked' }
    else if (usable && (!installed || newer(usable.version, installed.version))) decisions[kind] = { action: 'update', artifact: usable }
    else decisions[kind] = { action: 'none' }
  }

  // 5. The new state.
  return { result: 'ok', decisions, state: { keys_version: keys.version, channel_issued: channel.issued }, channel }
}

/** format.md §5 step 6: a downloaded file against its artifact, before it is used. */
export function checkFile(data: Uint8Array, artifact: { size: number; sha256: string }): 'ok' | 'file-size' | 'file-sha256' {
  if (data.length !== artifact.size) return 'file-size'
  return createHash('sha256').update(data).digest('hex') === artifact.sha256 ? 'ok' : 'file-sha256'
}
