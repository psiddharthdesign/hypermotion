// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { HeadlessRenderRequest } from '../electron/driver.js'
import {
  inferRenderFormatFromPath,
  isRenderFormat,
  isRenderQuality,
  RENDER_FORMATS,
  RENDER_QUALITIES,
} from '../renderOptions.js'
import { withProcessExitThrow } from '../testUtils/processExit.js'
import { captureStderr, captureStdout } from '../testUtils/stdout.js'
import { renderCommand } from './render.js'

test('render option guards accept supported values only', () => {
  for (const format of RENDER_FORMATS) {
    assert.equal(isRenderFormat(format), true)
  }
  assert.equal(isRenderFormat('mov'), false)
  for (const quality of RENDER_QUALITIES) {
    assert.equal(isRenderQuality(quality), true)
  }
  assert.equal(isRenderQuality('1080p'), false)
})

test('render format inference handles case and unknown extensions', () => {
  assert.equal(inferRenderFormatFromPath('/tmp/preview.WEBM'), 'webm')
  assert.equal(inferRenderFormatFromPath('/tmp/preview.mov'), 'mp4')
})

test('render command forwards saved scene paths to the driver', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-ok-'))
  const scenePath = path.join(dir, 'scene with spaces.hype')
  const outputPath = path.join(dir, 'exports', 'out.webm')
  const appPath = path.join(dir, 'hyper-motion')
  const calls: HeadlessRenderRequest[] = []
  fs.writeFileSync(scenePath, 'fake scene')
  try {
    const stdout = await captureStdout(async () => {
      await renderCommand({
        locateApp: async () => appPath,
        driveRender: async (req) => {
          calls.push(req)
        },
      }).parseAsync(
        ['--scene', scenePath, '-o', outputPath, '--quality', '720p', '--fps', '60'],
        { from: 'user' },
      )
    })

    assert.deepEqual(calls, [
      {
        appPath,
        outputPath,
        format: 'webm',
        quality: '720p',
        fps: 60,
        scenePath,
      },
    ])
    assert.match(stdout, new RegExp(`^\\[render\\] scene:   ${scenePath}$`, 'm'))
    assert.equal(fs.existsSync(path.dirname(outputPath)), true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('render command infers formats case-insensitively from output extensions', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-format-'))
  const outputPath = path.join(dir, 'out.GIF')
  const appPath = path.join(dir, 'hyper-motion')
  const calls: HeadlessRenderRequest[] = []
  try {
    await renderCommand({
      locateApp: async () => appPath,
      driveRender: async (req) => {
        calls.push(req)
      },
    }).parseAsync(['-o', outputPath], { from: 'user' })

    assert.equal(calls[0]?.format, 'gif')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('render command defaults to mp4 when output extension is unsupported', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-format-default-'))
  const outputPath = path.join(dir, 'out.mov')
  const appPath = path.join(dir, 'hyper-motion')
  const calls: HeadlessRenderRequest[] = []
  try {
    await renderCommand({
      locateApp: async () => appPath,
      driveRender: async (req) => {
        calls.push(req)
      },
    }).parseAsync(['-o', outputPath], { from: 'user' })

    assert.equal(calls[0]?.format, 'mp4')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('render command accepts explicit formats case-insensitively', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-explicit-format-'))
  const outputPath = path.join(dir, 'out.mp4')
  const appPath = path.join(dir, 'hyper-motion')
  const calls: HeadlessRenderRequest[] = []
  try {
    await renderCommand({
      locateApp: async () => appPath,
      driveRender: async (req) => {
        calls.push(req)
      },
    }).parseAsync(['-o', outputPath, '--format', 'WEBM'], { from: 'user' })

    assert.equal(calls[0]?.format, 'webm')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('render command accepts explicit quality presets case-insensitively', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-explicit-quality-'))
  const outputPath = path.join(dir, 'out.mp4')
  const appPath = path.join(dir, 'hyper-motion')
  const calls: HeadlessRenderRequest[] = []
  try {
    await renderCommand({
      locateApp: async () => appPath,
      driveRender: async (req) => {
        calls.push(req)
      },
    }).parseAsync(['-o', outputPath, '--quality', '4K'], { from: 'user' })

    assert.equal(calls[0]?.quality, '4k')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('render command trims padded format, quality, and fps values', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-trimmed-options-'))
  const outputPath = path.join(dir, 'out.mp4')
  const appPath = path.join(dir, 'hyper-motion')
  const calls: HeadlessRenderRequest[] = []
  try {
    await renderCommand({
      locateApp: async () => appPath,
      driveRender: async (req) => {
        calls.push(req)
      },
    }).parseAsync(
      ['-o', outputPath, '--format', ' webm ', '--quality', ' 4K ', '--fps', ' 60 '],
      { from: 'user' },
    )

    assert.equal(calls[0]?.format, 'webm')
    assert.equal(calls[0]?.quality, '4k')
    assert.equal(calls[0]?.fps, 60)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('render command trims padded scene paths', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-trimmed-scene-'))
  const scenePath = path.join(dir, 'scene.hype')
  const outputPath = path.join(dir, 'out.mp4')
  const appPath = path.join(dir, 'hyper-motion')
  const calls: HeadlessRenderRequest[] = []
  fs.writeFileSync(scenePath, 'fake scene')
  try {
    await renderCommand({
      locateApp: async () => appPath,
      driveRender: async (req) => {
        calls.push(req)
      },
    }).parseAsync(['-o', outputPath, '--scene', ` ${scenePath} `], { from: 'user' })

    assert.equal(calls[0]?.scenePath, scenePath)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('render command trims padded output paths', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-trimmed-output-'))
  const outputPath = path.join(dir, 'out.mp4')
  const appPath = path.join(dir, 'hyper-motion')
  const calls: HeadlessRenderRequest[] = []
  try {
    await renderCommand({
      locateApp: async () => appPath,
      driveRender: async (req) => {
        calls.push(req)
      },
    }).parseAsync(['-o', ` ${outputPath} `], { from: 'user' })

    assert.equal(calls[0]?.outputPath, outputPath)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('render command rejects empty output paths before launching the app', async () => {
  const stderr = await captureStderr(() => {
    return withProcessExitThrow(async () => {
      await assert.rejects(
        renderCommand({
          locateApp: async () => {
            throw new Error('should not locate app')
          },
        }).parseAsync(['-o', '   '], { from: 'user' }),
        { exitCode: 1 },
      )
    })
  })

  assert.equal(stderr, '[render] output path is required\n')
})

test('render command reports invalid fps before launching the app', async () => {
  const stderr = await captureStderr(() => {
    return withProcessExitThrow(async () => {
      await assert.rejects(
        renderCommand({
          locateApp: async () => {
            throw new Error('should not locate app')
          },
          driveRender: async () => {
            throw new Error('should not render')
          },
        }).parseAsync(['-o', 'out.mp4', '--fps', '0'], {
          from: 'user',
        }),
        { exitCode: 1 },
      )
    })
  })

  assert.match(stderr, /^\[render\] invalid fps: 0$/m)
})

test('render command reports non-numeric fps before launching the app', async () => {
  const stderr = await captureStderr(() => {
    return withProcessExitThrow(async () => {
      await assert.rejects(
        renderCommand().parseAsync(['-o', 'out.mp4', '--fps', 'fast'], {
          from: 'user',
        }),
        { exitCode: 1 },
      )
    })
  })

  assert.match(stderr, /^\[render\] invalid fps: fast$/m)
})

test('render command reports trimmed invalid fps values', async () => {
  const stderr = await captureStderr(() => {
    return withProcessExitThrow(async () => {
      await assert.rejects(
        renderCommand().parseAsync(['-o', 'out.mp4', '--fps', ' 30.5 '], {
          from: 'user',
        }),
        { exitCode: 1 },
      )
    })
  })

  assert.match(stderr, /^\[render\] invalid fps: 30\.5$/m)
})

test('render command rejects fps values above the MCP limit before launching the app', async () => {
  const stderr = await captureStderr(() => {
    return withProcessExitThrow(async () => {
      await assert.rejects(
        renderCommand().parseAsync(['-o', 'out.mp4', '--fps', '121'], {
          from: 'user',
        }),
        { exitCode: 1 },
      )
    })
  })

  assert.match(stderr, /^\[render\] invalid fps: 121$/m)
})

test('render command rejects fractional fps before launching the app', async () => {
  const stderr = await captureStderr(() => {
    return withProcessExitThrow(async () => {
      await assert.rejects(
        renderCommand().parseAsync(['-o', 'out.mp4', '--fps', '30.5'], {
          from: 'user',
        }),
        { exitCode: 1 },
      )
    })
  })

  assert.match(stderr, /^\[render\] invalid fps: 30\.5$/m)
})

test('render command reports unsupported formats before launching the app', async () => {
  const stderr = await captureStderr(() => {
    return withProcessExitThrow(async () => {
      await assert.rejects(
        renderCommand().parseAsync(['-o', 'out.mp4', '--format', 'mov'], {
          from: 'user',
        }),
        { exitCode: 1 },
      )
    })
  })

  assert.match(stderr, /^\[render\] unsupported format: mov \(use mp4 \/ webm \/ gif\)$/m)
})

test('render command reports empty explicit formats clearly', async () => {
  const stderr = await captureStderr(() => {
    return withProcessExitThrow(async () => {
      await assert.rejects(
        renderCommand().parseAsync(['-o', 'out.mp4', '--format', '   '], {
          from: 'user',
        }),
        { exitCode: 1 },
      )
    })
  })

  assert.match(stderr, /^\[render\] unsupported format: <empty> \(use mp4 \/ webm \/ gif\)$/m)
})

test('render command reports unsupported quality before launching the app', async () => {
  const stderr = await captureStderr(() => {
    return withProcessExitThrow(async () => {
      await assert.rejects(
        renderCommand().parseAsync(['-o', 'out.mp4', '--quality', 'draft'], {
          from: 'user',
        }),
        { exitCode: 1 },
      )
    })
  })

  assert.match(stderr, /^\[render\] unsupported quality: draft \(use comp \/ 720p \/ 2k \/ 4k\)$/m)
})

test('render command reports empty explicit quality presets clearly', async () => {
  const stderr = await captureStderr(() => {
    return withProcessExitThrow(async () => {
      await assert.rejects(
        renderCommand().parseAsync(['-o', 'out.mp4', '--quality', '   '], {
          from: 'user',
        }),
        { exitCode: 1 },
      )
    })
  })

  assert.match(stderr, /^\[render\] unsupported quality: <empty> \(use comp \/ 720p \/ 2k \/ 4k\)$/m)
})

test('render command reports missing scene files before launching the app', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-'))
  const scenePath = path.join(dir, 'missing.hype')
  const outPath = path.join(dir, 'out.mp4')
  try {
    const stderr = await captureStderr(() => {
      return withProcessExitThrow(async () => {
        await assert.rejects(
          renderCommand().parseAsync(['--scene', scenePath, '-o', outPath], {
            from: 'user',
          }),
          { exitCode: 2 },
        )
      })
    })

    assert.match(stderr, /^\[render\] scene file not found: .*missing\.hype$/m)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('render command reports scene directories before launching the app', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-scene-dir-'))
  const scenePath = path.join(dir, 'scene.hype')
  const outPath = path.join(dir, 'out.mp4')
  fs.mkdirSync(scenePath)
  try {
    const stderr = await captureStderr(() => {
      return withProcessExitThrow(async () => {
        await assert.rejects(
          renderCommand().parseAsync(['--scene', scenePath, '-o', outPath], {
            from: 'user',
          }),
          { exitCode: 2 },
        )
      })
    })

    assert.match(stderr, /^\[render\] scene path is not a file: .*scene\.hype$/m)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('render command reports output parent files before launching the app', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-out-parent-'))
  const parentPath = path.join(dir, 'exports')
  const outPath = path.join(parentPath, 'out.mp4')
  fs.writeFileSync(parentPath, 'not a directory')
  try {
    const stderr = await captureStderr(() => {
      return withProcessExitThrow(async () => {
        await assert.rejects(
          renderCommand().parseAsync(['-o', outPath], {
            from: 'user',
          }),
          { exitCode: 2 },
        )
      })
    })

    assert.match(stderr, /^\[render\] output directory is not a directory: .*exports$/m)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('render command reports output directory creation failures before launching the app', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-out-mkdir-'))
  const outPath = path.join(dir, 'exports', 'out.mp4')
  try {
    const stderr = await captureStderr(() => {
      return withProcessExitThrow(async () => {
        await assert.rejects(
          renderCommand({
            locateApp: async () => path.join(dir, 'hyper-motion'),
            driveRender: async () => {
              throw new Error('should not render')
            },
            mkdirSync: ((targetPath: fs.PathLike) => {
              if (targetPath === path.dirname(outPath)) throw new Error('mkdir failed')
              return fs.mkdirSync(targetPath, { recursive: true })
            }) as typeof fs.mkdirSync,
          }).parseAsync(['-o', outPath], {
            from: 'user',
          }),
          { exitCode: 2 },
        )
      })
    })

    assert.equal(
      stderr,
      `[render] failed to create output directory ${path.dirname(outPath)}: mkdir failed\n`,
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('render command reports output directory stat failures before launching the app', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-out-stat-'))
  const outPath = path.join(dir, 'out.mp4')
  try {
    const stderr = await captureStderr(() => {
      return withProcessExitThrow(async () => {
        await assert.rejects(
          renderCommand({
            locateApp: async () => path.join(dir, 'hyper-motion'),
            driveRender: async () => {
              throw new Error('should not render')
            },
            statSync: ((targetPath: fs.PathLike) => {
              if (targetPath === dir) throw new Error('stat failed')
              return fs.statSync(targetPath)
            }) as typeof fs.statSync,
          }).parseAsync(['-o', outPath], {
            from: 'user',
          }),
          { exitCode: 2 },
        )
      })
    })

    assert.equal(stderr, `[render] failed to read output directory ${dir}: stat failed\n`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('render command reports scene stat failures before launching the app', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-stat-'))
  const scenePath = path.join(dir, 'scene.hype')
  const outPath = path.join(dir, 'out.mp4')
  fs.writeFileSync(scenePath, '')
  try {
    const stderr = await captureStderr(() => {
      return withProcessExitThrow(async () => {
        await assert.rejects(
          renderCommand({
            locateApp: async () => path.join(dir, 'hyper-motion'),
            driveRender: async () => {
              throw new Error('should not render')
            },
            statSync: ((targetPath: fs.PathLike) => {
              if (targetPath === scenePath) throw new Error('stat failed')
              return fs.statSync(targetPath)
            }) as typeof fs.statSync,
          }).parseAsync(['--scene', scenePath, '-o', outPath], {
            from: 'user',
          }),
          { exitCode: 2 },
        )
      })
    })

    assert.equal(stderr, `[render] failed to read ${scenePath}: stat failed\n`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
