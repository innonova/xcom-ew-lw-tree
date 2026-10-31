import { fileURLToPath, URL } from 'node:url'

import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

/**
 * upkit's compiler (@innonova/upkit), loaded by the Tools page when a mod is a
 * .upkmod (features/upkit-source-mods.md), imports node:fs and node:path for reading
 * packages from folders, which it never does in the browser: those imports,
 * from upkit's files only, go to stand-ins (src/shims). Not in the tests,
 * which run in Node.
 */
function upkitInTheBrowser(): Plugin {
  const shims: Record<string, string> = {
    'node:fs': fileURLToPath(new URL('./src/shims/node-fs.ts', import.meta.url)),
    'node:path': fileURLToPath(new URL('./src/shims/node-path.ts', import.meta.url)),
  }
  return {
    name: 'upkit-in-the-browser',
    enforce: 'pre',
    resolveId(id, importer) {
      if (process.env.VITEST || !importer || !shims[id]) return null
      return /\/upkit\/lib\//.test(importer.replace(/\\/g, '/')) ? shims[id] : null
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    upkitInTheBrowser(),
    vue(),
    vueDevTools(),
  ],
  // Served file by file, so the stand-ins above apply to upkit's own imports.
  optimizeDeps: { exclude: ['@innonova/upkit'] },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
