// What the shell trusts for its updates (features/release-signing.md):
// innonova's trusted-updates root keys, which sign each product's keys.json
// (https://trusted-updates.innonova.ch/root.json; one key per holder, kept
// offline), and the keys.json version current when this shell was built.
// Nothing here is secret; changing it means a new shell.

import type { TrustedUpdates } from './bundles'

export const ROOT_KEYS = [
  { id: 'root.aek.1', ed25519: '0iT4HZpVagAXhRN2iKfiCWch13Laot7sDQP9DVG3LZY=' },
  { id: 'root.djm.1', ed25519: 'Kiu0F2gusaq3J9YMZjfmsvJ9dPmWE/Xa+hT8NH6mqvI=' },
]
/** lwtree's keys.json version when this shell was built (it refuses any older). */
export const KEYS_VERSION = 2

/** Where updates come from, unless the build says otherwise (update.json in the app, main.ts). */
export const DEFAULT_UPDATE: Pick<TrustedUpdates, 'base' | 'product' | 'channel'> = {
  base: 'https://trusted-updates.innonova.ch',
  product: 'lwtree',
  channel: 'staging',
}
