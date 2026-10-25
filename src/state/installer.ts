// The desktop app's installer as the website offers it. A release's site
// (.github/workflows/release.yml, tags v*) is built knowing it: the installer on
// that GitHub release (VITE_LWTREE_INSTALLER). Staging's (deploy/deploy.sh) has
// the newest one in app/, its name in app/LATEST and its checksum in
// app/SHA256SUMS. Asked for once, on the website only.

import { reactive } from 'vue'
import { desktop } from './desktop'

export const APP_DIR = `${import.meta.env.BASE_URL}app/`

const RELEASED: string | undefined = import.meta.env.VITE_LWTREE_INSTALLER || undefined

export const installer = reactive({
  /** "LongWarTechTree-Setup-0.3.6.exe", or null where there is none to offer. */
  name: null as string | null,
  /** "0.3.6" */
  version: null as string | null,
  /** Where to download it. */
  url: null as string | null,
  /** The GitHub release it is on: where it came from can be checked (gh attestation verify). */
  release: null as string | null,
})

const NAME = /^LongWarTechTree-Setup-([\w.-]+)\.exe$/

let asked = false
export function findInstaller(): void {
  if (asked || desktop) return
  asked = true
  if (RELEASED) {
    const name = RELEASED.slice(RELEASED.lastIndexOf('/') + 1)
    installer.name = name
    installer.version = NAME.exec(name)?.[1] ?? null
    installer.url = RELEASED
    installer.release = RELEASED.replace(/\/releases\/download\/([^/]+)\/[^/]+$/, '/releases/tag/$1')
    return
  }
  fetch(`${APP_DIR}LATEST`)
    .then(async (r) => {
      const name = r.ok ? (await r.text()).trim() : ''
      const ok = NAME.exec(name)
      installer.name = ok ? name : null
      installer.version = ok ? ok[1]! : null
      installer.url = ok ? `${APP_DIR}${name}` : null
    })
    .catch(() => (installer.name = null))
}
