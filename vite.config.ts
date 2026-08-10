import { defineConfig, type Plugin } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import electron from 'vite-plugin-electron'

/**
 * Content-Security-Policy for the packaged renderer.
 *
 * The renderer imports untrusted content (scene files, SVG, media,
 * Google Fonts CSS), so the shipped build pins what it may execute and
 * where it may talk to: our own bundle plus the two font hosts and the
 * pinned ffmpeg-core CDN that `src/export/transcodeMp4.ts` fetches.
 * `blob:` covers the ffmpeg worker and WebCodecs output URLs;
 * `wasm-unsafe-eval` covers the ffmpeg / yoga WASM modules.
 *
 * Injected at build time only — the Vite dev server needs inline
 * scripts and a websocket for HMR.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self' file:",
  "script-src 'self' file: blob: 'wasm-unsafe-eval'",
  "style-src 'self' file: 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' file: data: https://fonts.gstatic.com",
  "img-src 'self' file: data: blob:",
  "media-src 'self' file: data: blob:",
  "connect-src 'self' file: data: blob: https://fonts.googleapis.com https://fonts.gstatic.com https://unpkg.com",
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

function contentSecurityPolicy(): Plugin {
  return {
    name: 'hyper-motion-csp',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: {
          'http-equiv': 'Content-Security-Policy',
          content: CONTENT_SECURITY_POLICY,
        },
        injectTo: 'head-prepend',
      },
    ],
  }
}

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
  plugins: [
    react(),
    tailwindcss(),
    contentSecurityPolicy(),
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
