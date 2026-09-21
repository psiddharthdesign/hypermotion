// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import type { Layout } from '@/scene/types'
import { solveLayout, yogaReady } from '@/layout/engine'
import { importImageFile } from './importImage'

const centeredLayout: Layout = {
  mode: 'flex', direction: 'row', justify: 'center', align: 'center',
  gap: 0, padding: { top: 0, right: 0, bottom: 0, left: 0 },
  wrap: false, columns: 1, rowGap: 0, columnGap: 0,
}

beforeEach(() => {
  vi.stubGlobal('FileReader', class {
    result = 'data:image/png;base64,aW1hZ2U='
    onload: (() => void) | null = null
    readAsDataURL() { queueMicrotask(() => this.onload?.()) }
  })
  vi.stubGlobal('Image', class {
    naturalWidth = 1600
    naturalHeight = 900
    onload: (() => void) | null = null
    set src(_value: string) { queueMicrotask(() => this.onload?.()) }
  })
})
afterEach(() => vi.unstubAllGlobals())

function scene(mode: Layout['mode'] = 'flex') {
  const api = createSceneAPI()
  api.setMeta({ canvas: { width: 3200, height: 2400 } })
  const root = api.createNode('frame', null, {
    size: { width: 3200, height: 2400 },
    layout: { ...centeredLayout, mode },
  })
  return { api, root }
}
const imageFile = () => new File(['image'], 'screenshot.png', { type: 'image/png' })

describe('image import placement', () => {
  it('centers a flow image exactly once in an already-centered stack', async () => {
    const { api, root } = scene()
    const id = await importImageFile(imageFile(), api, root)
    const node = api.getNode(id)!
    const layout = solveLayout(await yogaReady, api, root, { width: 3200, height: 2400 })
    expect(node.position).toBe('flow')
    expect(layout[id].x + node.transform.x + layout[id].width / 2).toBe(1600)
    expect(layout[id].y + node.transform.y + layout[id].height / 2).toBe(1200)
  })

  it('leaves grid placement to the parent without an additional transform', async () => {
    const { api, root } = scene('grid')
    const id = await importImageFile(imageFile(), api, root)
    expect(api.getNode(id)).toMatchObject({ position: 'flow', transform: { x: 0, y: 0 } })
  })

  it('honors an explicit drop in a stack without adding the stack slot', async () => {
    const { api, root } = scene()
    const id = await importImageFile(imageFile(), api, root, { dropPos: { x: 1100, y: 950 } })
    const node = api.getNode(id)!
    const layout = solveLayout(await yogaReady, api, root, { width: 3200, height: 2400 })
    expect(node.position).toBe('absolute')
    expect(layout[id].x + node.transform.x + layout[id].width / 2).toBe(1100)
    expect(layout[id].y + node.transform.y + layout[id].height / 2).toBe(950)
  })

  it('keeps free-canvas imports centered with absolute positioning', async () => {
    const { api, root } = scene('none')
    const id = await importImageFile(imageFile(), api, root)
    expect(api.getNode(id)).toMatchObject({ position: 'absolute', transform: { x: 800, y: 750 } })
  })
})
