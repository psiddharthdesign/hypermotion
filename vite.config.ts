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
 * Why `build.lib` for the electron entries — without it, Vite runs in
 * app mode and silently ignores `output.format: 'cjs'`, emitting an ESM
 * bundle into a `.cjs` filename. Electron then fails with
 * "Cannot use import statement outside a module" because the file says
 * .cjs (so Node treats it as CJS) but the body is ES module syntax.
 * `lib` mode forces Rollup to honor `formats: ['cjs']`, which rewrites
 * the `import { app } from 'electron'` to `require('electron')`.
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
              formats: ['cjs'],
              fileName: () => 'main.cjs',
            },
            // `electron` is not bundled — it's resolved at runtime by
            // the Electron host. Same for built-in node modules like
            // `path`, `fs`, etc.
            rollupOptions: {
              external: ['electron'],
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
              formats: ['cjs'],
              fileName: () => 'preload.cjs',
            },
            rollupOptions: {
              external: ['electron'],
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
