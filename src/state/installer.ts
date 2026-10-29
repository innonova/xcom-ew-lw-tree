// The desktop app's installer as the website offers it: on the GitHub release
// the site was built with (VITE_LWTREE_INSTALLER): a release's site
// (.github/workflows/release.yml, tags v*) links its own, staging's
// (deploy/deploy.sh) the newest staging installer. On the website only.

import { reactive } from 'vue'
import { desktop } from './desktop'

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
  if (asked || desktop || !RELEASED) return
  asked = true
  const name = RELEASED.slice(RELEASED.lastIndexOf('/') + 1)
  installer.name = name
  installer.version = NAME.exec(name)?.[1] ?? null
  installer.url = RELEASED
  installer.release = RELEASED.replace(/\/releases\/download\/([^/]+)\/[^/]+$/, '/releases/tag/$1')
}
