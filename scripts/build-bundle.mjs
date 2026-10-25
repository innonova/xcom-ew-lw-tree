// The built site as the desktop app's update bundle (features/release-signing.md):
// desktop/release/bundle-<version>.json, the plain payload (desktop/src/bundle-format.ts),
// no signature of ours. The release workflow attests it and publishes it on a
// GitHub release; trusted-updates signs a statement over its hash, and the app
// checks the download against that (desktop/src/trusted.ts).
//
//   node scripts/build-bundle.mjs
//
// Needs the site built (npm run build) and the desktop code compiled
// (cd desktop && npm run build). Prints the file's name.
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { bundleMeta, root } from './bundle-meta.mjs'

const require = createRequire(import.meta.url)
const { packBundle } = require(path.join(root, 'desktop', 'dist', 'bundle-format.js'))

const meta = bundleMeta()
// The staging extras deploy.sh adds to dist/ are not the site.
const payload = await packBundle(path.join(root, 'dist'), meta, ['app', 'bundle'])
const out = path.join(root, 'desktop', 'release')
mkdirSync(out, { recursive: true })
const name = `bundle-${meta.version}.json`
writeFileSync(path.join(out, name), JSON.stringify(payload))
console.log(name)
