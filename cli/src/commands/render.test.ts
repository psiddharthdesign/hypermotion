// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { HeadlessRenderRequest } from '../electron/driver.js'
import { DEFAULT_RENDER_FPS } from '../renderOptions.js'
import { withProcessExitThrow } from '../testUtils/processExit.js'
import { captureStderr, captureStdout } from '../testUtils/stdout.js'
import { renderCommand } from './render.js'

test('render command description mentions saved scene support', () => {
  assert.match(renderCommand().description(), /saved \.hype scene/)
  assert.match(renderCommand().description(), /current desktop scene/)
})

test('render command quality help describes comp output size', () => {
  const qualityOption = renderCommand().options.find((option) => option.long === '--quality')

  assert.equal(qualityOption?.description, 'Quality: comp (match scene canvas) | 720p | 2k | 4k')
})

test('render command scene help describes saved scene input', () => {
  const sceneOption = renderCommand().options.find((option) => option.long === '--scene')

  assert.match(sceneOption?.description ?? '', /\.hype scene file/)
})

test('render command defaults to 60 fps', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-fps-default-'))
  const outputPath = path.join(dir, 'out.mp4')
  const calls: Array<Readonly<HeadlessRenderRequest>> = []

  try {
    await renderCommand({
      locateApp: async () => path.join(dir, 'hyper-motion'),
      driveRender: async (req) => {
        calls.push(req)
      },
    }).parseAsync(['-o', outputPath], { from: 'user' })

    assert.equal(DEFAULT_RENDER_FPS, 60)
    assert.equal(calls[0]?.fps, DEFAULT_RENDER_FPS)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('render command forwards saved scene paths to the driver', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-ok-'))
  const scenePath = path.join(dir, 'scene with spaces.hype')
  const outputPath = path.join(dir, 'exports', 'out.webm')
  const appPath = path.join(dir, 'hyper-motion')
  const calls: Array<Readonly<HeadlessRenderRequest>> = []
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

test('render command accepts equals-form saved scene paths', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-scene-equals-'))
  const scenePath = path.join(dir, 'scene with spaces.hype')
  const outputPath = path.join(dir, 'out.mp4')
  const appPath = path.join(dir, 'hyper-motion')
  const calls: Array<Readonly<HeadlessRenderRequest>> = []
  fs.writeFileSync(scenePath, 'fake scene')
  try {
    await renderCommand({
      locateApp: async () => appPath,
      driveRender: async (req) => {
        calls.push(req)
      },
    }).parseAsync([`--scene=${scenePath}`, '-o', outputPath], { from: 'user' })

    assert.equal(calls[0]?.scenePath, scenePath)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('render command infers formats case-insensitively from output extensions', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-format-'))
  const outputPath = path.join(dir, 'out.GIF')
  const appPath = path.join(dir, 'hyper-motion')
  const calls: Array<Readonly<HeadlessRenderRequest>> = []
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

test('render command infers formats from extension-only output filenames', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-extension-only-'))
  const appPath = path.join(dir, 'hyper-motion')
  const calls: Array<Readonly<HeadlessRenderRequest>> = []
  try {
    await renderCommand({
      locateApp: async () => appPath,
      driveRender: async (req) => {
        calls.push(req)
      },
    }).parseAsync(['-o', path.join(dir, '.WEBM')], { from: 'user' })

    assert.equal(calls[0]?.format, 'webm')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('render command ignores URL-style suffixes when inferring output formats', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-format-suffix-'))
  const outputPath = path.join(dir, 'out.webm?download=1#preview')
  const appPath = path.join(dir, 'hyper-motion')
  const calls: Array<Readonly<HeadlessRenderRequest>> = []
  try {
    await renderCommand({
      locateApp: async () => appPath,
      driveRender: async (req) => {
        calls.push(req)
      },
    }).parseAsync(['-o', outputPath], { from: 'user' })

    assert.equal(calls[0]?.format, 'webm')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('render command defaults to mp4 when output extension is unsupported', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-format-default-'))
  const outputPath = path.join(dir, 'out.mov')
  const appPath = path.join(dir, 'hyper-motion')
  const calls: Array<Readonly<HeadlessRenderRequest>> = []
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
  const calls: Array<Readonly<HeadlessRenderRequest>> = []
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
  const calls: Array<Readonly<HeadlessRenderRequest>> = []
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
  const calls: Array<Readonly<HeadlessRenderRequest>> = []
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
  const calls: Array<Readonly<HeadlessRenderRequest>> = []
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

test('render command rejects empty explicit scene paths before launching the app', async () => {
  const stderr = await captureStderr(() => {
    return withProcessExitThrow(async () => {
      await assert.rejects(
        renderCommand({
          locateApp: async () => {
            throw new Error('should not locate app')
          },
        }).parseAsync(['-o', 'out.mp4', '--scene', '   '], { from: 'user' }),
        { exitCode: 2 },
      )
    })
  })

  assert.equal(stderr, '[render] scene path is required\n')
})

test('render command trims padded output paths', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-trimmed-output-'))
  const outputPath = path.join(dir, 'out.mp4')
  const appPath = path.join(dir, 'hyper-motion')
  const calls: Array<Readonly<HeadlessRenderRequest>> = []
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

test('render command rejects fps values above the render limit before launching the app', async () => {
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

test('render command rejects JavaScript numeric fps notation before launching the app', async () => {
  for (const fpsInput of ['1e2', '0x10']) {
    const stderr = await captureStderr(() => {
      return withProcessExitThrow(async () => {
        await assert.rejects(
          renderCommand({
            locateApp: async () => {
              throw new Error('should not locate app')
            },
          }).parseAsync(['-o', 'out.mp4', '--fps', fpsInput], {
            from: 'user',
          }),
          { exitCode: 1 },
        )
      })
    })

    assert.match(stderr, new RegExp(`^\\[render\\] invalid fps: ${fpsInput}$`, 'm'))
  }
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

test('render command rejects unsupported formats before creating output directories', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-format-first-'))
  const outputDir = path.join(dir, 'exports')
  const outputPath = path.join(outputDir, 'out.mov')
  try {
    const stderr = await captureStderr(() => {
      return withProcessExitThrow(async () => {
        await assert.rejects(
          renderCommand({
            locateApp: async () => {
              throw new Error('should not locate app')
            },
            mkdirSync: () => {
              throw new Error('should not create output directory')
            },
          }).parseAsync(['-o', outputPath, '--format', 'mov'], {
            from: 'user',
          }),
          { exitCode: 1 },
        )
      })
    })

    assert.match(stderr, /^\[render\] unsupported format: mov \(use mp4 \/ webm \/ gif\)$/m)
    assert.equal(fs.existsSync(outputDir), false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
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

test('render command rejects unsupported quality before creating output directories', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-quality-first-'))
  const outputDir = path.join(dir, 'exports')
  const outputPath = path.join(outputDir, 'out.mp4')
  try {
    const stderr = await captureStderr(() => {
      return withProcessExitThrow(async () => {
        await assert.rejects(
          renderCommand({
            locateApp: async () => {
              throw new Error('should not locate app')
            },
            mkdirSync: () => {
              throw new Error('should not create output directory')
            },
          }).parseAsync(['-o', outputPath, '--quality', 'draft'], {
            from: 'user',
          }),
          { exitCode: 1 },
        )
      })
    })

    assert.match(stderr, /^\[render\] unsupported quality: draft \(use comp \/ 720p \/ 2k \/ 4k\)$/m)
    assert.equal(fs.existsSync(outputDir), false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
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

test('render command reports scene stat races before launching the app', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-scene-race-'))
  const scenePath = path.join(dir, 'scene.hype')
  const outPath = path.join(dir, 'out.mp4')
  fs.writeFileSync(scenePath, '')
  try {
    const stderr = await captureStderr(() => {
      return withProcessExitThrow(async () => {
        await assert.rejects(
          renderCommand({
            locateApp: async () => {
              throw new Error('should not locate app')
            },
            statSync: (targetPath: fs.PathLike) => {
              if (targetPath === scenePath) {
                fs.rmSync(scenePath)
                throw new Error('ENOENT: no such file or directory')
              }
              return fs.statSync(targetPath)
            },
          }).parseAsync(['--scene', scenePath, '-o', outPath], {
            from: 'user',
          }),
          { exitCode: 2 },
        )
      })
    })

    assert.equal(
      stderr,
      `[render] failed to read ${scenePath}: ENOENT: no such file or directory\n`,
    )
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

test('render command reports directory output paths before launching the app', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-out-dir-'))
  const outPath = path.join(dir, 'out.mp4')
  fs.mkdirSync(outPath)
  try {
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
          }).parseAsync(['-o', outPath], {
            from: 'user',
          }),
          { exitCode: 2 },
        )
      })
    })

    assert.match(stderr, /^\[render\] output path is a directory: .*out\.mp4$/m)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('render command reports output path stat failures before launching the app', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-out-file-stat-'))
  const outPath = path.join(dir, 'out.mp4')
  fs.writeFileSync(outPath, '')
  try {
    const stderr = await captureStderr(() => {
      return withProcessExitThrow(async () => {
        await assert.rejects(
          renderCommand({
            locateApp: async () => path.join(dir, 'hyper-motion'),
            driveRender: async () => {
              throw new Error('should not render')
            },
            statSync: (targetPath: fs.PathLike) => {
              if (targetPath === outPath) throw new Error('stat failed')
              return fs.statSync(targetPath)
            },
          }).parseAsync(['-o', outPath], {
            from: 'user',
          }),
          { exitCode: 2 },
        )
      })
    })

    assert.equal(stderr, `[render] failed to inspect output path ${outPath}: stat failed\n`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('render command reports output directory creation failures before launching the app', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-out-mkdir-'))
  const outPath = path.join(dir, 'exports', 'out.mp4')
  const mkdirSync: typeof fs.mkdirSync = (targetPath, options) => {
    if (targetPath === path.dirname(outPath)) throw new Error('mkdir failed')
    return fs.mkdirSync(targetPath, options)
  }
  try {
    const stderr = await captureStderr(() => {
      return withProcessExitThrow(async () => {
        await assert.rejects(
          renderCommand({
            locateApp: async () => path.join(dir, 'hyper-motion'),
            driveRender: async () => {
              throw new Error('should not render')
            },
            mkdirSync,
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
            statSync: (targetPath: fs.PathLike) => {
              if (targetPath === dir) throw new Error('stat failed')
              return fs.statSync(targetPath)
            },
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
            statSync: (targetPath: fs.PathLike) => {
              if (targetPath === scenePath) throw new Error('stat failed')
              return fs.statSync(targetPath)
            },
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

test('render command reports the releases page when the desktop app is missing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-missing-app-'))
  const outPath = path.join(dir, 'out.mp4')
  try {
    const stderr = await captureStderr(() => {
      return withProcessExitThrow(async () => {
        await assert.rejects(
          renderCommand({
            locateApp: async () => null,
            driveRender: async () => {
              throw new Error('should not render')
            },
          }).parseAsync(['-o', outPath], {
            from: 'user',
          }),
          { exitCode: 1 },
        )
      })
    })

    assert.match(stderr, /^\[render\] hyper-motion desktop app not found\.$/m)
    assert.match(
      stderr,
      /https:\/\/github\.com\/psiddharthdesign\/hypermotion\/releases/,
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('render command reports driver failures', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-render-driver-fail-'))
  const outPath = path.join(dir, 'out.mp4')
  try {
    const stderr = await captureStderr(() => {
      return withProcessExitThrow(async () => {
        await assert.rejects(
          renderCommand({
            locateApp: async () => path.join(dir, 'hyper-motion'),
            driveRender: async () => {
              throw new Error('renderer crashed')
            },
          }).parseAsync(['-o', outPath], {
            from: 'user',
          }),
          { exitCode: 1 },
        )
      })
    })

    assert.equal(stderr, '[render] failed: renderer crashed\n')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
