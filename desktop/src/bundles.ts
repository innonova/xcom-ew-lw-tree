// The shell's site bundles and its updates (features/desktop-updates.md),
// after Mimiri's bundle manager: the base bundle shipped with the installer,
// newer bundles kept in the app's user data, the active one served, a new one
// switched to at the player's restart, rolled back if it never reports that
// it started. What is new, and that it is ours, comes from innonova's
// trusted-updates (trusted.ts, features/release-signing.md): a bundle or a
// shell is taken only as its signed channel file names it, size and SHA-256.
// Electron-free, so its tests run in plain Node.

import { randomUUID } from 'node:crypto'
import { existsSync, promises as fs, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { compareVersions, unpack, type BundlePayload } from './bundle-format'
import { check, checkFile, type Artifact, type PublicKey, type TrustState } from './trusted'

interface Config {
  /** "base" or a version under bundles/. */
  active: string
  previous?: string
  /** A version switched to that has not yet reported a good start, and how often it was started. */
  unproven?: string
  starts?: number
  /** Versions that failed: never installed again. */
  bad?: string[]
  /** What trusted-updates checks keep between checks (trusted.ts). */
  trust?: TrustState
  /** The SHA-256 of each bundle downloaded, by version: how a revocation names it. */
  sha256?: Record<string, string>
}

export interface BundleState {
  shellVersion: string
  /** The bundle being served. */
  serving: string
  base: string
  /** A newer bundle installed and waiting for a restart. */
  ready?: string
  /** A newer shell the server offers (the bundle needs it, or it is simply newer). */
  shell?: { version: string; needed: boolean; downloaded: boolean; fetching?: boolean }
  checking: boolean
  lastCheck?: string
  error?: string
  /** The last check could not confirm the app is up to date (trusted-updates' reason). */
  unconfirmed?: string
}

export type Fetch = (
  url: string,
) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>

export interface StoreOptions {
  /** Where bundles live (user data). */
  dir: string
  /** The bundle shipped with the shell, and its version. */
  baseDir: string
  baseVersion: string
  shellVersion: string
  /** Where updates come from; none: no updates. */
  trusted?: TrustedUpdates
  fetch: Fetch
  /** Called when the state changes outside a check (a newer app fetched in the background). */
  onChange?: () => void
}

/** Whether a bundle folder is whole: its manifest's files all there at their size. */
export function bundleIsWhole(dir: string): boolean {
  try {
    if (!existsSync(path.join(dir, 'index.html'))) return false
    const manifest = JSON.parse(readFileSync(path.join(dir, '.bundle-manifest.json'), 'utf8')) as {
      path: string
      size: number
    }[]
    return manifest.every((f) => {
      const p = path.join(dir, f.path)
      return existsSync(p) && statSync(p).size === f.size
    })
  } catch {
    return false
  }
}

/** trusted-updates for this app: its documents at `<base>/<product>/`, and what is built in. */
export interface TrustedUpdates {
  /** "https://trusted-updates.innonova.ch". */
  base: string
  product: string
  /** "production" for players; a tester channel ("staging") for test installs. */
  channel: string
  platform: string
  rootKeys: PublicKey[]
  /** The keys.json version current when this shell was built. */
  keysVersion: number
}

/** What a check that could not confirm says, by trusted-updates' reason. */
const UNCONFIRMED = "Couldn't confirm this app is up to date"

export class BundleStore {
  private config: Config = { active: 'base' }
  private configPath: string
  private servingPath: string
  private servingVersion: string
  state: BundleState
  private shellInstaller?: string
  /** The newer shell the last check accepted. */
  private shellOffer?: Artifact

  constructor(private o: StoreOptions) {
    this.configPath = path.join(o.dir, 'config.json')
    this.servingPath = o.baseDir
    this.servingVersion = o.baseVersion
    this.state = {
      shellVersion: o.shellVersion,
      serving: o.baseVersion,
      base: o.baseVersion,
      checking: false,
    }
  }

  get activeDir() {
    return this.servingPath
  }

  /**
   * At start: pick the bundle to serve. A bundle that was started before
   * and never reported good is rolled back; one older than the base, not
   * whole, or needing a newer shell is passed over for the base.
   */
  async start(): Promise<void> {
    await fs.mkdir(this.o.dir, { recursive: true })
    // Downloads cut short are swept away.
    for (const e of await fs.readdir(this.o.dir))
      if (e.includes('.downloading'))
        await fs.rm(path.join(this.o.dir, e), { recursive: true, force: true })
    try {
      this.config = { active: 'base', ...JSON.parse(await fs.readFile(this.configPath, 'utf8')) }
    } catch {
      this.config = { active: 'base' }
    }
    if (this.config.unproven && this.config.unproven === this.config.active) {
      this.config.starts = (this.config.starts ?? 0) + 1
      if (this.config.starts > 1) {
        // It was started and never said it worked: back to the one before.
        this.config.bad = [...new Set([...(this.config.bad ?? []), this.config.active])]
        this.config.active = this.config.previous ?? 'base'
        delete this.config.unproven
        delete this.config.starts
      }
      await this.save()
    }
    this.pickServing()
  }

  private pickServing() {
    const v = this.config.active
    const dir = path.join(this.o.dir, v)
    const usable =
      v !== 'base' &&
      compareVersions(v, this.o.baseVersion) > 0 &&
      bundleIsWhole(dir) &&
      this.minShellOk(dir)
    this.servingPath = usable ? dir : this.o.baseDir
    this.servingVersion = usable ? v : this.o.baseVersion
    this.state.serving = this.servingVersion
  }

  private minShellOk(dir: string): boolean {
    try {
      const info = JSON.parse(readFileSync(path.join(dir, '.bundle-info.json'), 'utf8'))
      return compareVersions(info.minShellVersion, this.o.shellVersion) <= 0
    } catch {
      return false
    }
  }

  private saving: Promise<void> = Promise.resolve()
  /** One write at a time: two at once can leave the file half of each. */
  private save(): Promise<void> {
    const text = JSON.stringify(this.config, null, 1)
    this.saving = this.saving.catch(() => undefined).then(() => fs.writeFile(this.configPath, text))
    return this.saving
  }

  /** The page started and works: the bundle it runs is good, and old bundles go. */
  async good(): Promise<void> {
    if (this.config.unproven === this.servingVersion) {
      delete this.config.unproven
      delete this.config.starts
      await this.save()
    }
    const keep = new Set([
      this.config.active,
      this.config.previous,
      this.servingVersion,
      this.state.ready,
    ])
    // Tidying: a file still held (the installer, just after an update) waits
    // for another start.
    for (const e of await fs.readdir(this.o.dir).catch(() => [] as string[]))
      if (e !== 'config.json' && !keep.has(e) && !e.includes('.downloading'))
        await fs
          .rm(path.join(this.o.dir, e), { recursive: true, force: true })
          .catch(() => undefined)
  }

  private async get(url: string): Promise<Uint8Array> {
    const r = await this.o.fetch(url)
    if (!r.ok) throw new Error(`${url}: ${r.status}`)
    return new Uint8Array(await r.arrayBuffer())
  }

  /**
   * Asks trusted-updates what is new. A newer bundle this shell can run is
   * downloaded, checked and installed, ready for the next start; one this
   * shell runs that was withdrawn is moved off; a newer shell is reported (and
   * downloaded and checked in the background).
   */
  async check(): Promise<BundleState> {
    const t = this.o.trusted
    if (!t || this.state.checking) return this.state
    this.state.checking = true
    this.state.error = undefined
    try {
      const base = t.base.replace(/\/+$/, '')
      const fetchDocument = async (name: string) => {
        try {
          return new TextDecoder().decode(await this.get(`${base}/${t.product}/${name}`))
        } catch {
          return undefined
        }
      }
      const bundleVersion = this.state.ready ?? this.servingVersion
      const r = await check(
        {
          rootKeys: t.rootKeys,
          product: t.product,
          channel: t.channel,
          platform: t.platform,
          kinds: ['bundle', 'shell'],
          now: new Date(),
          state: this.config.trust ?? { keys_version: t.keysVersion },
          installed: {
            bundle: { version: bundleVersion, sha256: this.config.sha256?.[bundleVersion] },
            shell: { version: this.o.shellVersion },
          },
        },
        fetchDocument,
      )
      if (r.result === 'rejected') {
        // Said, not hidden; the app keeps running what it has.
        this.state.unconfirmed = r.reason
        this.state.error = `${UNCONFIRMED} (${r.reason}).`
        return this.state
      }
      this.state.unconfirmed = undefined
      this.config.trust = r.state
      await this.save()
      const b = r.decisions.bundle!
      let shellNeeded = false
      if ((b.action === 'update' || b.action === 'move') && b.artifact && !(this.config.bad ?? []).includes(b.artifact.version)) {
        const fits = await this.install(b.artifact, b.action === 'move')
        shellNeeded = !fits
      } else if (b.action === 'revoked') {
        this.state.error = 'The site this app runs was withdrawn, and no other is offered yet.'
      }
      const sh = r.decisions.shell!
      if ((sh.action === 'update' || sh.action === 'move') && sh.artifact) {
        const had = this.state.shell
        const same = had?.version === sh.artifact.version
        this.shellOffer = sh.artifact
        this.state.shell = {
          version: sh.artifact.version,
          needed: shellNeeded || sh.action === 'move',
          downloaded: same ? had.downloaded : false,
          fetching: same ? had.fetching : false,
        }
        // Fetched in the background, so "Install it and restart" starts at once.
        if (!this.state.shell.downloaded && !this.state.shell.fetching) this.fetchInBackground(sh.artifact)
      }
      this.state.lastCheck = new Date().toISOString()
    } catch (e) {
      this.state.error = (e as Error).message
    } finally {
      this.state.checking = false
    }
    return this.state
  }

  /**
   * Downloads a bundle as its statement names it, checks it, and installs it:
   * it becomes active at the next start. A move (the one served was withdrawn)
   * takes it whatever its version. False when it needs a newer shell (not
   * installed then).
   */
  async install(artifact: Artifact, move = false): Promise<boolean> {
    const data = await this.get(artifact.url)
    const ok = checkFile(data, artifact)
    if (ok !== 'ok') throw new Error(`the downloaded site is not the one announced (${ok})`)
    const payload = JSON.parse(new TextDecoder().decode(data)) as BundlePayload
    if (!payload?.version || !Array.isArray(payload.files)) throw new Error('not a site bundle')
    if (payload.version !== artifact.version) throw new Error('the bundle is not the version announced')
    if (compareVersions(payload.minShellVersion, this.o.shellVersion) > 0) return false
    if (!move && compareVersions(payload.version, this.servingVersion) <= 0) throw new Error('not newer')
    const tmp = path.join(this.o.dir, `${payload.version}.downloading-${randomUUID()}`)
    try {
      const manifest: { path: string; size: number }[] = []
      for (const f of unpack(payload)) {
        const p = path.join(tmp, ...f.path.split('/'))
        await fs.mkdir(path.dirname(p), { recursive: true })
        await fs.writeFile(p, f.data)
        manifest.push({ path: f.path, size: f.data.length })
      }
      await fs.writeFile(path.join(tmp, '.bundle-manifest.json'), JSON.stringify(manifest))
      await fs.writeFile(
        path.join(tmp, '.bundle-info.json'),
        JSON.stringify({
          version: payload.version,
          minShellVersion: payload.minShellVersion,
          releaseDate: payload.releaseDate,
        }),
      )
      if (!bundleIsWhole(tmp)) throw new Error('the bundle did not unpack whole')
      const final = path.join(this.o.dir, payload.version)
      await fs.rm(final, { recursive: true, force: true })
      await fs.rename(tmp, final)
    } catch (e) {
      await fs.rm(tmp, { recursive: true, force: true })
      throw e
    }
    if (move) this.config.bad = [...new Set([...(this.config.bad ?? []), this.servingVersion])]
    if (this.config.active !== payload.version) this.config.previous = move ? undefined : this.config.active
    this.config.active = payload.version
    this.config.unproven = payload.version
    this.config.starts = 0
    this.config.sha256 = { ...this.config.sha256, [payload.version]: artifact.sha256 }
    await this.save()
    this.state.ready = payload.version
    return true
  }

  /** Serves the ready bundle now (the page reloads into it). */
  activate(): boolean {
    if (!this.state.ready) return false
    this.pickServing()
    if (this.servingVersion !== this.state.ready) return false
    // A start of it: if it never reports good, the next start rolls it back.
    this.config.starts = 1
    void this.save()
    this.state.ready = undefined
    return true
  }

  private async downloadShell(s: Artifact) {
    const data = await this.get(s.url)
    const ok = checkFile(data, s)
    if (ok !== 'ok') throw new Error(`the new app download is not the one announced (${ok})`)
    const file = path.join(this.o.dir, `shell-${s.version}.exe`)
    await fs.writeFile(file, data)
    this.shellInstaller = file
    if (this.state.shell) this.state.shell.downloaded = true
  }

  /** Downloads and checks a newer shell without holding up the check; says when done. */
  private fetchInBackground(s: Artifact) {
    if (this.state.shell) this.state.shell.fetching = true
    this.downloadShell(s)
      .catch((e) => (this.state.error = (e as Error).message))
      .finally(() => {
        if (this.state.shell) this.state.shell.fetching = false
        this.o.onChange?.()
      })
  }

  /** The checked installer of a newer shell, if one was downloaded. */
  get installer(): string | undefined {
    return this.shellInstaller
  }

  /** Downloads and checks the newer shell when the player asks for it (after a check offered it). */
  async fetchShell(): Promise<string | undefined> {
    if (this.shellInstaller) return this.shellInstaller
    if (!this.shellOffer) await this.check()
    if (!this.shellOffer) return undefined
    await this.downloadShell(this.shellOffer)
    return this.shellInstaller
  }
}
