// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { videoNormalizationArgs, avconvertNormalizationArgs } from './videoNormalization'

describe('video compatibility quality', () => {
  it('does not resize or override the source frame rate', () => {
    const args = videoNormalizationArgs('input.mov', 'output.webm')
    expect(args).not.toContain('-vf')
    expect(args).not.toContain('-s')
    expect(args).not.toContain('-r')
    expect(args.join(' ')).not.toMatch(/scale=|fps=/)
    expect(args[args.indexOf('-c:v') + 1]).toBe('libvpx-vp9')
    expect(args[args.indexOf('-b:v') + 1]).toBe('0')
  })

  it('does not use a resolution-limited macOS fallback preset', () => {
    const args = avconvertNormalizationArgs('input.mov', 'output.mp4')
    expect(args[args.indexOf('--preset') + 1]).toBe('PresetHighestQuality')
  })
})
