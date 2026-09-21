import { realpathSync } from 'node:fs'
import { defineConfig, searchForWorkspaceRoot } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import electron from 'vite-plugin-electron'

const projectRoot = fileURLToPath(new URL('.', import.meta.url))
const dependencyRoot = realpathSync(new URL('./node_modules', import.meta.url))

/**
 * Vite config — same renderer setup as the web build, with Electron
 * integration grafted on. The renderer (src/) is byte-identical to the
 * hyper-motion web app; only `base: './'` and the electron plugin are
 * different here.
 *
 * Why `base: './'` — Electron's production load uses file:// URLs and
 * an absolute base ('/') would resolve to the root of the user's disk.
 * Relative paths keep asset lookups happy whether served from the dev
 * server or loaded off the bundle.
 *
 * Why `build.lib` plus an explicit output array for Electron entries — the
 * plugin derives an ESM library format from this package's `type: module`.
 * Vite concatenates that default with `formats: ['cjs']` during config merge,
 * so both formats can race to write the same `.cjs` file in watch mode. A
 * single explicit Rollup output bypasses format expansion and guarantees that
 * Electron only ever sees a complete CommonJS entry.
 */
export default defineConfig({
  base: './',
  server: {
    fs: {
      // Codex worktrees may share dependencies through a node_modules
      // symlink. Keep Vite's normal workspace boundary and explicitly allow
      // only that symlink's resolved dependency directory so local font
      // assets (including Bricolage Grotesque) remain available in dev.
      allow: [searchForWorkspaceRoot(projectRoot), dependencyRoot],
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            // Lib mode is the only way to get a real CJS bundle out of
            // Vite. Filename is fixed so package.json's `main` field
            // can point at it.
            lib: {
              entry: 'electron/main.ts',
            },
            // `electron` is not bundled — it's resolved at runtime by
            // the Electron host. Same for built-in node modules like
            // `path`, `fs`, etc.
            rollupOptions: {
              external: ['electron'],
              output: [
                {
                  format: 'cjs',
                  entryFileNames: 'main.cjs',
                  chunkFileNames: '[name]-[hash].cjs',
                },
              ],
            },
            emptyOutDir: false,
          },
        },
      },
      {
        entry: 'electron/preload.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            lib: {
              entry: 'electron/preload.ts',
            },
            rollupOptions: {
              external: ['electron'],
              output: [
                {
                  format: 'cjs',
                  entryFileNames: 'preload.cjs',
                  chunkFileNames: '[name]-[hash].cjs',
                },
              ],
            },
            emptyOutDir: false,
          },
        },
      },
    ]),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
