// Plugin build script. Two outputs:
//   dist/code.js — the sandboxed plugin code (IIFE; no DOM, no fetch).
//   dist/ui.html — the iframe UI (full DOM; clipboard access lives here).
//
// Run `npm run build` for one-shot, `npm run watch` for dev.

import esbuild from 'esbuild'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const watch = process.argv.includes('--watch')

async function buildCode() {
  const ctx = await esbuild.context({
    entryPoints: [path.join(__dirname, 'src/code.ts')],
    bundle: true,
    target: 'es2017',
    format: 'iife',
    outfile: path.join(__dirname, 'dist/code.js'),
    sourcemap: 'inline',
    logLevel: 'info',
  })
  if (watch) {
    await ctx.watch()
  } else {
    await ctx.rebuild()
    await ctx.dispose()
  }
}

async function buildUi() {
  // Build the UI script first, then inline it into the HTML so the
  // single dist/ui.html file is self-contained (Figma serves it from
  // a sandbox iframe; no relative URL resolution).
  const result = await esbuild.build({
    entryPoints: [path.join(__dirname, 'src/ui.ts')],
    bundle: true,
    target: 'es2017',
    format: 'iife',
    write: false,
    sourcemap: 'inline',
    logLevel: 'info',
  })
  const js = result.outputFiles[0].text
  const shell = await readFile(path.join(__dirname, 'src/ui.html'), 'utf8')
  const html = shell.replace(
    '<!-- INLINE_SCRIPT -->',
    `<script>${js}</script>`,
  )
  await mkdir(path.join(__dirname, 'dist'), { recursive: true })
  await writeFile(path.join(__dirname, 'dist/ui.html'), html)
  console.log('built dist/ui.html')
}

await buildCode()
await buildUi()

if (watch) {
  // Re-run UI build whenever its source changes.
  esbuild
    .context({
      entryPoints: [path.join(__dirname, 'src/ui.ts')],
      bundle: true,
      target: 'es2017',
      format: 'iife',
      outfile: path.join(__dirname, 'dist/_ui.js'),
      sourcemap: 'inline',
      logLevel: 'info',
      plugins: [
        {
          name: 'inline-into-html',
          setup(b) {
            b.onEnd(() => {
              buildUi().catch((err) => console.error(err))
            })
          },
        },
      ],
    })
    .then((c) => c.watch())
}
