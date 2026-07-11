// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { driveHeadlessRender } from './driver.js'
import { withEnvVar } from '../testUtils/env.js'

test('driveHeadlessRender passes saved scene paths and clears stale files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-driver-'))
  const appPath = path.join(dir, 'fake-app.mjs')
  const outputPath = path.join(dir, 'out.mp4')
  const scenePath = path.join(dir, 'scene with spaces.hype')

  fs.writeFileSync(outputPath, 'stale output')
  fs.writeFileSync(`${outputPath}.done`, 'stale sentinel')
  fs.writeFileSync(`${outputPath}.error`, 'stale error')
  fs.writeFileSync(scenePath, 'fake scene')
  fs.writeFileSync(
    appPath,
    [
      '#!/usr/bin/env node',
      "const fs = await import('node:fs');",
      "const outArg = process.argv.find((arg) => arg.startsWith('--out='));",
      "const sceneArg = process.argv.find((arg) => arg.startsWith('--scene='));",
      "const formatArg = process.argv.find((arg) => arg === '--format=mp4');",
      "const qualityArg = process.argv.find((arg) => arg === '--quality=comp');",
      "const fpsArg = process.argv.find((arg) => arg === '--fps=30');",
      "const out = outArg?.slice('--out='.length);",
      "const scene = sceneArg?.slice('--scene='.length);",
      "if (!out || !scene || !formatArg || !qualityArg || !fpsArg) process.exit(2);",
      "fs.writeFileSync(out, scene);",
      "fs.writeFileSync(`${out}.done`, JSON.stringify({ ts: Date.now(), bytes: scene.length }));",
    ].join('\n'),
  )
  fs.chmodSync(appPath, 0o755)

  try {
    await driveHeadlessRender({
      appPath,
      outputPath,
      format: 'mp4',
      quality: 'comp',
      fps: 30,
      scenePath,
    })

    assert.equal(fs.readFileSync(outputPath, 'utf-8'), scenePath)
    assert.equal(fs.existsSync(`${outputPath}.done`), false)
    assert.equal(fs.existsSync(`${outputPath}.error`), false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('driveHeadlessRender surfaces plain-text error sentinels', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-driver-'))
  const appPath = path.join(dir, 'fake-app.mjs')
  const outputPath = path.join(dir, 'out.mp4')

  fs.writeFileSync(
    appPath,
    [
      '#!/usr/bin/env node',
      "const outArg = process.argv.find((arg) => arg.startsWith('--out='));",
      "const out = outArg?.slice('--out='.length);",
      "if (!out) process.exit(2);",
      "const fs = await import('node:fs');",
      "fs.writeFileSync(`${out}.error`, 'encoder failed before JSON');",
    ].join('\n'),
  )
  fs.chmodSync(appPath, 0o755)

  try {
    await assert.rejects(
      driveHeadlessRender({
        appPath,
        outputPath,
        format: 'mp4',
        quality: 'comp',
        fps: 30,
      }),
      /encoder failed before JSON/,
    )
    assert.equal(fs.existsSync(`${outputPath}.error`), false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('driveHeadlessRender removes stale files before spawn failures', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-driver-'))
  const appPath = path.join(dir, 'not-executable-app')
  const outputPath = path.join(dir, 'out.mp4')

  fs.writeFileSync(appPath, 'not executable')
  fs.writeFileSync(outputPath, 'stale output')
  fs.writeFileSync(`${outputPath}.done`, 'stale sentinel')
  fs.writeFileSync(`${outputPath}.error`, 'stale failure')

  try {
    await assert.rejects(
      driveHeadlessRender({
        appPath,
        outputPath,
        format: 'mp4',
        quality: 'comp',
        fps: 30,
      }),
      /Failed to spawn desktop app:/,
    )
    assert.equal(fs.existsSync(outputPath), false)
    assert.equal(fs.existsSync(`${outputPath}.done`), false)
    assert.equal(fs.existsSync(`${outputPath}.error`), false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('driveHeadlessRender falls back for blank plain-text error sentinels', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-driver-'))
  const appPath = path.join(dir, 'fake-app.mjs')
  const outputPath = path.join(dir, 'out.mp4')

  fs.writeFileSync(
    appPath,
    [
      '#!/usr/bin/env node',
      "const outArg = process.argv.find((arg) => arg.startsWith('--out='));",
      "const out = outArg?.slice('--out='.length);",
      "if (!out) process.exit(2);",
      "await import('node:fs').then((fs) => fs.writeFileSync(`${out}.error`, '   \\n\\t  '))",
    ].join('\n'),
  )
  fs.chmodSync(appPath, 0o755)

  try {
    await assert.rejects(
      driveHeadlessRender({
        appPath,
        outputPath,
        format: 'mp4',
        quality: 'comp',
        fps: 30,
      }),
      /Render failed \(no details available\)/,
    )
    assert.equal(fs.existsSync(`${outputPath}.error`), false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('driveHeadlessRender clears stale error sentinels after successful renders', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-driver-'))
  const appPath = path.join(dir, 'fake-app.mjs')
  const outputPath = path.join(dir, 'out.mp4')

  fs.writeFileSync(`${outputPath}.error`, 'stale failure')
  fs.writeFileSync(
    appPath,
    [
      '#!/usr/bin/env node',
      "const fs = await import('node:fs');",
      "const outArg = process.argv.find((arg) => arg.startsWith('--out='));",
      "const out = outArg?.slice('--out='.length);",
      "if (!out) process.exit(2);",
      "fs.writeFileSync(out, 'fresh output');",
      "fs.writeFileSync(`${out}.done`, JSON.stringify({ ts: Date.now(), bytes: 12 }));",
    ].join('\n'),
  )
  fs.chmodSync(appPath, 0o755)

  try {
    await driveHeadlessRender({
      appPath,
      outputPath,
      format: 'mp4',
      quality: 'comp',
      fps: 30,
    })

    assert.equal(fs.readFileSync(outputPath, 'utf-8'), 'fresh output')
    assert.equal(fs.existsSync(`${outputPath}.done`), false)
    assert.equal(fs.existsSync(`${outputPath}.error`), false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('driveHeadlessRender waits for complete success sentinels', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-driver-'))
  const appPath = path.join(dir, 'fake-app.mjs')
  const outputPath = path.join(dir, 'out.mp4')

  fs.writeFileSync(
    appPath,
    [
      '#!/usr/bin/env node',
      "const fs = await import('node:fs');",
      "const outArg = process.argv.find((arg) => arg.startsWith('--out='));",
      "const out = outArg?.slice('--out='.length);",
      "if (!out) process.exit(2);",
      "fs.writeFileSync(`${out}.done`, '');",
      "setTimeout(() => {",
      "  fs.writeFileSync(out, 'fresh output');",
      "  fs.writeFileSync(`${out}.done`, JSON.stringify({ ts: Date.now(), bytes: 12 }));",
      '}, 100);',
    ].join('\n'),
  )
  fs.chmodSync(appPath, 0o755)

  try {
    await driveHeadlessRender({
      appPath,
      outputPath,
      format: 'mp4',
      quality: 'comp',
      fps: 30,
    })

    assert.equal(fs.readFileSync(outputPath, 'utf-8'), 'fresh output')
    assert.equal(fs.existsSync(`${outputPath}.done`), false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('driveHeadlessRender waits for success sentinels with timestamps', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-driver-'))
  const appPath = path.join(dir, 'fake-app.mjs')
  const outputPath = path.join(dir, 'out.mp4')

  fs.writeFileSync(
    appPath,
    [
      '#!/usr/bin/env node',
      "const fs = await import('node:fs');",
      "const outArg = process.argv.find((arg) => arg.startsWith('--out='));",
      "const out = outArg?.slice('--out='.length);",
      "if (!out) process.exit(2);",
      "fs.writeFileSync(`${out}.done`, JSON.stringify({ bytes: 12 }));",
      "setTimeout(() => {",
      "  fs.writeFileSync(out, 'fresh output');",
      "  fs.writeFileSync(`${out}.done`, JSON.stringify({ ts: Date.now(), bytes: 12 }));",
      '}, 100);',
    ].join('\n'),
  )
  fs.chmodSync(appPath, 0o755)

  try {
    await driveHeadlessRender({
      appPath,
      outputPath,
      format: 'mp4',
      quality: 'comp',
      fps: 30,
    })

    assert.equal(fs.readFileSync(outputPath, 'utf-8'), 'fresh output')
    assert.equal(fs.existsSync(`${outputPath}.done`), false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('driveHeadlessRender ignores malformed success sentinels', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-driver-'))
  const appPath = path.join(dir, 'fake-app.mjs')
  const outputPath = path.join(dir, 'out.mp4')

  fs.writeFileSync(
    appPath,
    [
      '#!/usr/bin/env node',
      "const fs = await import('node:fs');",
      "const outArg = process.argv.find((arg) => arg.startsWith('--out='));",
      "const out = outArg?.slice('--out='.length);",
      "if (!out) process.exit(2);",
      "fs.writeFileSync(`${out}.done`, JSON.stringify({ ts: Date.now(), bytes: -1 }));",
      "setTimeout(() => {",
      "  fs.writeFileSync(out, 'fresh output');",
      "  fs.writeFileSync(`${out}.done`, JSON.stringify({ ts: Date.now(), bytes: 12 }));",
      '}, 100);',
    ].join('\n'),
  )
  fs.chmodSync(appPath, 0o755)

  try {
    await driveHeadlessRender({
      appPath,
      outputPath,
      format: 'mp4',
      quality: 'comp',
      fps: 30,
    })

    assert.equal(fs.readFileSync(outputPath, 'utf-8'), 'fresh output')
    assert.equal(fs.existsSync(`${outputPath}.done`), false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('driveHeadlessRender ignores success sentinels with fractional metadata', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-driver-'))
  const appPath = path.join(dir, 'fake-app.mjs')
  const outputPath = path.join(dir, 'out.mp4')

  fs.writeFileSync(
    appPath,
    [
      '#!/usr/bin/env node',
      "const fs = await import('node:fs');",
      "const outArg = process.argv.find((arg) => arg.startsWith('--out='));",
      "const out = outArg?.slice('--out='.length);",
      "if (!out) process.exit(2);",
      "fs.writeFileSync(`${out}.done`, JSON.stringify({ ts: Date.now() + 0.5, bytes: 12.5 }));",
      "setTimeout(() => {",
      "  fs.writeFileSync(out, 'fresh output');",
      "  fs.writeFileSync(`${out}.done`, JSON.stringify({ ts: Date.now(), bytes: 12 }));",
      '}, 100);',
    ].join('\n'),
  )
  fs.chmodSync(appPath, 0o755)

  try {
    await driveHeadlessRender({
      appPath,
      outputPath,
      format: 'mp4',
      quality: 'comp',
      fps: 30,
    })

    assert.equal(fs.readFileSync(outputPath, 'utf-8'), 'fresh output')
    assert.equal(fs.existsSync(`${outputPath}.done`), false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('driveHeadlessRender enables Electron logging when verbose mode is set', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-driver-'))
  const appPath = path.join(dir, 'fake-app.mjs')
  const outputPath = path.join(dir, 'out.mp4')

  fs.writeFileSync(
    appPath,
    [
      '#!/usr/bin/env node',
      "const fs = await import('node:fs');",
      "const outArg = process.argv.find((arg) => arg.startsWith('--out='));",
      "const out = outArg?.slice('--out='.length);",
      "if (!out) process.exit(2);",
      "fs.writeFileSync(out, process.env.ELECTRON_ENABLE_LOGGING ?? '');",
      "fs.writeFileSync(`${out}.done`, JSON.stringify({ ts: Date.now(), bytes: 1 }));",
    ].join('\n'),
  )
  fs.chmodSync(appPath, 0o755)

  try {
    await withEnvVar('HYPERMOTION_VERBOSE', '1', async () => {
      await driveHeadlessRender({
        appPath,
        outputPath,
        format: 'mp4',
        quality: 'comp',
        fps: 30,
      })
    })

    assert.equal(fs.readFileSync(outputPath, 'utf-8'), '1')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('driveHeadlessRender disables Electron logging by default', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-driver-'))
  const appPath = path.join(dir, 'fake-app.mjs')
  const outputPath = path.join(dir, 'out.mp4')

  fs.writeFileSync(
    appPath,
    [
      '#!/usr/bin/env node',
      "const fs = await import('node:fs');",
      "const outArg = process.argv.find((arg) => arg.startsWith('--out='));",
      "const out = outArg?.slice('--out='.length);",
      "if (!out) process.exit(2);",
      "fs.writeFileSync(out, process.env.ELECTRON_ENABLE_LOGGING ?? 'missing');",
      "fs.writeFileSync(`${out}.done`, JSON.stringify({ ts: Date.now(), bytes: 0 }));",
    ].join('\n'),
  )
  fs.chmodSync(appPath, 0o755)

  try {
    await withEnvVar('HYPERMOTION_VERBOSE', undefined, async () => {
      await driveHeadlessRender({
        appPath,
        outputPath,
        format: 'mp4',
        quality: 'comp',
        fps: 30,
      })
    })

    assert.equal(fs.readFileSync(outputPath, 'utf-8'), '')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('driveHeadlessRender only enables Electron logging for verbose value 1', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-driver-'))
  const appPath = path.join(dir, 'fake-app.mjs')
  const outputPath = path.join(dir, 'out.mp4')

  fs.writeFileSync(
    appPath,
    [
      '#!/usr/bin/env node',
      "const fs = await import('node:fs');",
      "const outArg = process.argv.find((arg) => arg.startsWith('--out='));",
      "const out = outArg?.slice('--out='.length);",
      "if (!out) process.exit(2);",
      "fs.writeFileSync(out, process.env.ELECTRON_ENABLE_LOGGING ?? 'missing');",
      "fs.writeFileSync(`${out}.done`, JSON.stringify({ ts: Date.now(), bytes: 0 }));",
    ].join('\n'),
  )
  fs.chmodSync(appPath, 0o755)

  try {
    await withEnvVar('HYPERMOTION_VERBOSE', '0', async () => {
      await driveHeadlessRender({
        appPath,
        outputPath,
        format: 'mp4',
        quality: 'comp',
        fps: 30,
      })
    })

    assert.equal(fs.readFileSync(outputPath, 'utf-8'), '')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('driveHeadlessRender surfaces JSON error sentinel messages', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-driver-'))
  const appPath = path.join(dir, 'fake-app.mjs')
  const outputPath = path.join(dir, 'out.mp4')

  fs.writeFileSync(outputPath, 'stale output')
  fs.writeFileSync(
    appPath,
    [
      '#!/usr/bin/env node',
      "const fs = await import('node:fs');",
      "const outArg = process.argv.find((arg) => arg.startsWith('--out='));",
      "const out = outArg?.slice('--out='.length);",
      "if (!out) process.exit(2);",
      "fs.writeFileSync(`${out}.error`, JSON.stringify({ message: 'encoder reported JSON failure' }));",
    ].join('\n'),
  )
  fs.chmodSync(appPath, 0o755)

  try {
    await assert.rejects(
      driveHeadlessRender({
        appPath,
        outputPath,
        format: 'mp4',
        quality: 'comp',
        fps: 30,
      }),
      /encoder reported JSON failure/,
    )
    assert.equal(fs.existsSync(outputPath), false)
    assert.equal(fs.existsSync(`${outputPath}.error`), false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('driveHeadlessRender trims JSON error sentinel messages', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-driver-'))
  const appPath = path.join(dir, 'fake-app.mjs')
  const outputPath = path.join(dir, 'out.mp4')

  fs.writeFileSync(
    appPath,
    [
      '#!/usr/bin/env node',
      "const fs = await import('node:fs');",
      "const outArg = process.argv.find((arg) => arg.startsWith('--out='));",
      "const out = outArg?.slice('--out='.length);",
      "if (!out) process.exit(2);",
      "fs.writeFileSync(`${out}.error`, JSON.stringify({ message: '  encoder reported JSON failure  ' }));",
    ].join('\n'),
  )
  fs.chmodSync(appPath, 0o755)

  try {
    await assert.rejects(
      driveHeadlessRender({
        appPath,
        outputPath,
        format: 'mp4',
        quality: 'comp',
        fps: 30,
      }),
      /^Error: encoder reported JSON failure$/,
    )
    assert.equal(fs.existsSync(`${outputPath}.error`), false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('driveHeadlessRender falls back when JSON error sentinels omit messages', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-driver-'))
  const appPath = path.join(dir, 'fake-app.mjs')
  const outputPath = path.join(dir, 'out.mp4')

  fs.writeFileSync(
    appPath,
    [
      '#!/usr/bin/env node',
      "const fs = await import('node:fs');",
      "const outArg = process.argv.find((arg) => arg.startsWith('--out='));",
      "const out = outArg?.slice('--out='.length);",
      "if (!out) process.exit(2);",
      "fs.writeFileSync(`${out}.error`, JSON.stringify({ code: 'ENCODER_FAILED' }));",
    ].join('\n'),
  )
  fs.chmodSync(appPath, 0o755)

  try {
    await assert.rejects(
      driveHeadlessRender({
        appPath,
        outputPath,
        format: 'mp4',
        quality: 'comp',
        fps: 30,
      }),
      /Render failed \(no details available\)/,
    )
    assert.equal(fs.existsSync(`${outputPath}.error`), false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('driveHeadlessRender waits for complete JSON error sentinels', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-driver-'))
  const appPath = path.join(dir, 'fake-app.mjs')
  const outputPath = path.join(dir, 'out.mp4')

  fs.writeFileSync(
    appPath,
    [
      '#!/usr/bin/env node',
      "const fs = await import('node:fs');",
      "const outArg = process.argv.find((arg) => arg.startsWith('--out='));",
      "const out = outArg?.slice('--out='.length);",
      "if (!out) process.exit(2);",
      "fs.writeFileSync(`${out}.error`, '{');",
      "setTimeout(() => {",
      "  fs.writeFileSync(`${out}.error`, JSON.stringify({ message: 'encoder finished error details' }));",
      '}, 100);',
    ].join('\n'),
  )
  fs.chmodSync(appPath, 0o755)

  try {
    await assert.rejects(
      driveHeadlessRender({
        appPath,
        outputPath,
        format: 'mp4',
        quality: 'comp',
        fps: 30,
      }),
      /encoder finished error details/,
    )
    assert.equal(fs.existsSync(`${outputPath}.error`), false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('driveHeadlessRender falls back when JSON error sentinel messages are blank', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-driver-'))
  const appPath = path.join(dir, 'fake-app.mjs')
  const outputPath = path.join(dir, 'out.mp4')

  fs.writeFileSync(
    appPath,
    [
      '#!/usr/bin/env node',
      "const fs = await import('node:fs');",
      "const outArg = process.argv.find((arg) => arg.startsWith('--out='));",
      "const out = outArg?.slice('--out='.length);",
      "if (!out) process.exit(2);",
      "fs.writeFileSync(`${out}.error`, JSON.stringify({ message: '      ' }));",
    ].join('\n'),
  )
  fs.chmodSync(appPath, 0o755)

  try {
    await assert.rejects(
      driveHeadlessRender({
        appPath,
        outputPath,
        format: 'mp4',
        quality: 'comp',
        fps: 30,
      }),
      /Render failed \(no details available\)/,
    )
    assert.equal(fs.existsSync(`${outputPath}.error`), false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('driveHeadlessRender falls back when JSON error sentinel messages are not strings', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-driver-'))
  const appPath = path.join(dir, 'fake-app.mjs')
  const outputPath = path.join(dir, 'out.mp4')

  fs.writeFileSync(
    appPath,
    [
      '#!/usr/bin/env node',
      "const fs = await import('node:fs');",
      "const outArg = process.argv.find((arg) => arg.startsWith('--out='));",
      "const out = outArg?.slice('--out='.length);",
      "if (!out) process.exit(2);",
      "fs.writeFileSync(`${out}.error`, JSON.stringify({ message: 42 }));",
    ].join('\n'),
  )
  fs.chmodSync(appPath, 0o755)

  try {
    await assert.rejects(
      driveHeadlessRender({
        appPath,
        outputPath,
        format: 'mp4',
        quality: 'comp',
        fps: 30,
      }),
      /Render failed \(no details available\)/,
    )
    assert.equal(fs.existsSync(`${outputPath}.error`), false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
