// SPDX-License-Identifier: Apache-2.0

import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveExportDestinationPath } from './exportDestination'

describe('native export destination', () => {
  it('joins a safe video filename to the selected folder', () => {
    expect(
      resolveExportDestinationPath('/Users/example/My Movies', 'Demo.webm'),
    ).toBe(path.resolve('/Users/example/My Movies/Demo.webm'))
  })

  it('rejects traversal and unsupported extensions', () => {
    expect(() =>
      resolveExportDestinationPath('/Users/example/Movies', '../Demo.mp4'),
    ).toThrow('valid filename')
    expect(() =>
      resolveExportDestinationPath('/Users/example/Movies', 'Demo.mov'),
    ).toThrow('MP4, WebM, or GIF')
  })
})
