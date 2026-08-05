// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest'
import {
  createInternalWorkspaceClipboardMarker,
  hasInternalWorkspaceClipboard,
  isFigmaClipboardText,
  routeWorkspacePaste,
} from './workspacePasteRouting'

const figmaText = JSON.stringify({
  format: 'hyper-motion/figma',
  version: 2,
  nodes: [],
  assets: {},
})

function actions(externalText: string | Promise<never> = '') {
  return {
    readExternalText: vi.fn(() =>
      externalText instanceof Promise
        ? externalText
        : Promise.resolve(externalText),
    ),
    importExternalFiles: vi.fn(async () => false),
    pasteFigma: vi.fn(),
    pasteTextAnimations: vi.fn(() => false),
    pasteKeyframes: vi.fn(() => false),
    pasteLayers: vi.fn(() => false),
    onExternalError: vi.fn(),
  }
}

describe('workspace paste routing', () => {
  it.each([
    ['text animations', 'pasteTextAnimations'],
    ['keyframes', 'pasteKeyframes'],
    ['layers', 'pasteLayers'],
  ] as const)('gives Figma priority over stale %s', async (_label, stalePaste) => {
    const handlers = actions(figmaText)
    handlers[stalePaste].mockReturnValue(true)

    await expect(routeWorkspacePaste(handlers)).resolves.toBe('figma')
    expect(handlers.pasteFigma).toHaveBeenCalledWith(figmaText)
    expect(handlers[stalePaste]).not.toHaveBeenCalled()
  })

  it('keeps the internal text-animation, keyframe, layer fallback order', async () => {
    const handlers = actions('ordinary clipboard text')
    handlers.pasteKeyframes.mockReturnValue(true)
    handlers.pasteLayers.mockReturnValue(true)

    await expect(routeWorkspacePaste(handlers)).resolves.toBe('keyframes')
    expect(handlers.pasteTextAnimations).toHaveBeenCalledOnce()
    expect(handlers.pasteKeyframes).toHaveBeenCalledOnce()
    expect(handlers.pasteLayers).not.toHaveBeenCalled()
  })

  it('falls back to the internal clipboard when the external read fails', async () => {
    const handlers = actions(Promise.reject(new Error('clipboard unavailable')))
    handlers.pasteLayers.mockReturnValue(true)

    await expect(routeWorkspacePaste(handlers)).resolves.toBe('layers')
    expect(handlers.onExternalError).toHaveBeenCalledWith(
      'text',
      expect.any(Error),
    )
  })

  it('imports external files before falling back to internal content', async () => {
    const handlers = actions('')
    handlers.importExternalFiles.mockResolvedValue(true)
    handlers.pasteTextAnimations.mockReturnValue(true)

    await expect(routeWorkspacePaste(handlers)).resolves.toBe('files')
    expect(handlers.pasteTextAnimations).not.toHaveBeenCalled()
  })

  it('reports whether keydown needs to intercept an internal paste', () => {
    expect(
      hasInternalWorkspaceClipboard({
        textAnimations: false,
        keyframes: false,
        layers: false,
      }),
    ).toBe(false)
    expect(
      hasInternalWorkspaceClipboard({
        textAnimations: false,
        keyframes: true,
        layers: false,
      }),
    ).toBe(true)
  })

  it('recognizes a Figma payload for the synchronous Electron preflight', () => {
    expect(isFigmaClipboardText(figmaText)).toBe(true)
    expect(isFigmaClipboardText('ordinary clipboard text')).toBe(false)
  })

  it('marks an internal keyframe copy as the newest clipboard owner', async () => {
    const marker = createInternalWorkspaceClipboardMarker('keyframes')
    expect(JSON.parse(marker)).toEqual({
      format: 'hyper-motion/internal',
      version: 1,
      kind: 'keyframes',
    })
    expect(isFigmaClipboardText(marker)).toBe(false)

    const handlers = actions(marker)
    handlers.pasteKeyframes.mockReturnValue(true)
    await expect(routeWorkspacePaste(handlers)).resolves.toBe('keyframes')
    expect(handlers.pasteFigma).not.toHaveBeenCalled()
  })
})
