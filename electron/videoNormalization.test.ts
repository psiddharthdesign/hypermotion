// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { videoNormalizationArgs } from './videoNormalization'

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

  it('uses lossless video without forcing a lower color format', () => {
    const args = videoNormalizationArgs('input.mov', 'output.webm')
    expect(args[args.indexOf('-lossless') + 1]).toBe('1')
    expect(args).not.toContain('-pix_fmt')
    expect(args).not.toContain('-crf')
  })
})
