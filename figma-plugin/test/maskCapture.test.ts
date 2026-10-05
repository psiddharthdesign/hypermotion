// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })
describe('Figma mask capture', () => {
  it('retains mask flags and exact luminance SVG in the emitted payload', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="20" height="20" fill="white"/></svg>'
    const exportAsync = vi.fn(async () => svg)
    const mask = { id: 'mask', name: 'Mask', type: 'RECTANGLE', isMask: true, maskType: 'LUMINANCE',
      visible: true, locked: false, x: 0, y: 0, width: 20, height: 20, opacity: 1,
      fills: [], strokes: [], exportAsync }
    const postMessage = vi.fn()
    vi.stubGlobal('__html__', '')
    vi.stubGlobal('figma', { showUI: vi.fn(), on: vi.fn(), currentPage: { selection: [mask] }, ui: { postMessage } })
    await import('../src/code')
    await vi.waitFor(() => expect(postMessage.mock.calls.some(([message]) => message.kind === 'payload')).toBe(true))
    const payload = JSON.parse(postMessage.mock.calls.find(([message]) => message.kind === 'payload')![0].json)
    expect(payload.nodes[0]).toMatchObject({ isMask: true, maskType: 'LUMINANCE', maskSvg: svg })
    expect(exportAsync).toHaveBeenCalledTimes(1)
  })
})
