// SPDX-License-Identifier: Apache-2.0
import { afterEach, expect, it, vi } from 'vitest'
import { prepareVideoSource } from './importMedia'
import { canDecodeVideoFile } from './videoCompatibility'
vi.mock('./videoCompatibility', () => ({ canDecodeVideoFile: vi.fn() }))
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks() })
it('uses a managed reference for a 1 GiB source without reading its bytes', async () => {
  const file = new File([], 'large.mp4', { type: 'video/mp4' })
  Object.defineProperty(file, 'size', { value: 1024 ** 3 })
  const read = vi.spyOn(file, 'arrayBuffer').mockRejectedValue(new Error('must not read'))
  const importFile = vi.fn().mockResolvedValue('hm-media://asset/test.mp4')
  const normalizeFile = vi.fn()
  vi.stubGlobal('window', { hypermotion: { media: { importFile, normalizeFile } } })
  vi.mocked(canDecodeVideoFile).mockResolvedValue(true)
  expect(await prepareVideoSource(file)).toEqual({ src: 'hm-media://asset/test.mp4', normalized: false })
  expect(importFile).toHaveBeenCalledWith(file)
  expect(read).not.toHaveBeenCalled()
  expect(normalizeFile).not.toHaveBeenCalled()
})
it('keeps original video bytes and skips automatic conversion or decode probes', async () => {
  const normalizeFile = vi.fn()
  vi.stubGlobal('window', { hypermotion: { media: { importFile: vi.fn().mockResolvedValue('hm-media://asset/original.mov'), normalizeFile } } })
  expect(await prepareVideoSource(new File([], 'clip.mov'))).toEqual({ src: 'hm-media://asset/original.mov', normalized: false })
  expect(normalizeFile).not.toHaveBeenCalled()
  expect(canDecodeVideoFile).not.toHaveBeenCalled()
})
