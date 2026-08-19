// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest'
import {
  chooseExportDirectory,
  resolveExportFileName,
  sanitizeExportTitle,
  writeExportBlob,
} from './destination'

describe('export destination', () => {
  it('keeps Format responsible for the file extension', () => {
    expect(resolveExportFileName('Launch film.mp4', 'webm')).toBe(
      'Launch film.webm',
    )
    expect(resolveExportFileName('Launch film', 'gif')).toBe('Launch film.gif')
  })

  it('sanitizes an editable title and retains a usable fallback', () => {
    expect(sanitizeExportTitle('  Report: Q3 / Final  ')).toBe(
      'Report Q3 Final',
    )
    expect(sanitizeExportTitle('  ...  ')).toBe('export')
  })

  it('keeps the current folder when the Finder picker is cancelled', async () => {
    const bridge = { invoke: vi.fn().mockResolvedValue(null) }
    await expect(
      chooseExportDirectory(
        bridge,
        '/Users/example/Movies',
        'Demo',
        'mp4',
      ),
    ).resolves.toBeNull()
    expect(bridge.invoke).toHaveBeenCalledWith('export:choose-directory', {
      defaultPath: '/Users/example/Movies',
      suggestedName: 'Demo.mp4',
    })
  })

  it('returns the folder and any title updated in the Finder sheet', async () => {
    const bridge = {
      invoke: vi.fn().mockResolvedValue({
        directory: '/Users/example/Desktop',
        fileName: 'Final cut.mp4',
      }),
    }
    await expect(
      chooseExportDirectory(
        bridge,
        '/Users/example/Movies',
        'Demo',
        'mp4',
      ),
    ).resolves.toEqual({
      directory: '/Users/example/Desktop',
      title: 'Final cut',
    })
  })

  it('writes the finished bytes to the selected folder', async () => {
    const bridge = {
      invoke: vi.fn().mockResolvedValue({
        ok: true,
        path: '/Users/example/Movies/Demo.mp4',
      }),
    }
    const blob = new Blob([new Uint8Array([3, 1, 4])], {
      type: 'video/mp4',
    })

    await expect(
      writeExportBlob(
        bridge,
        '/Users/example/Movies',
        'Demo.mp4',
        blob,
      ),
    ).resolves.toBe('/Users/example/Movies/Demo.mp4')

    const [, payload] = bridge.invoke.mock.calls[0]
    expect(payload).toMatchObject({
      directory: '/Users/example/Movies',
      fileName: 'Demo.mp4',
    })
    expect(Array.from((payload as { bytes: Uint8Array }).bytes)).toEqual([
      3, 1, 4,
    ])
  })
})
