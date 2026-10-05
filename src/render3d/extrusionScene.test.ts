// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import type { RectNode } from '@/scene/types'
import { extrusionShapeLimitation } from '@/scene/extrusion'
import { supportsExtrusion } from '@/ui/extrusionAuthoring'
import { resolveNodeExtrusion } from './extrusionScene'

function rectangle() {
  const api = createSceneAPI()
  const id = api.createNode('rect', null, { extrusion: { depth: 50, sideColor: '#2563eb' } })
  return { api, id, node: api.getNode(id) as RectNode }
}

describe('extrusion shape compatibility', () => {
  it('supports circular uniform corners while retaining the authored radius', () => {
    const { api, node } = rectangle()
    node.appearance.cornerRadius = 24
    expect(extrusionShapeLimitation(node)).toBeUndefined()
    expect(resolveNodeExtrusion(node)?.depth).toBe(50)
    expect(node.appearance.cornerRadius).toBe(24)
    api.doc.destroy()
  })
  it('rejects independent corners consistently without deleting the saved body', () => {
    const { api, node } = rectangle()
    node.appearance.cornerRadii = { tl: 0, tr: 12, br: 30, bl: 8 }
    expect(extrusionShapeLimitation(node)).toBe('independent-corners')
    expect(supportsExtrusion(node)).toBe(false)
    expect(resolveNodeExtrusion(node)).toBeUndefined()
    expect(node.extrusion).toEqual({ depth: 50, sideColor: '#2563eb' })
    // Full radius supersedes independent corners in the front-face painter.
    expect(supportsExtrusion(node, { fullRadius: 1 })).toBe(true)
    expect(resolveNodeExtrusion(node, { fullRadius: 1 })?.depth).toBe(50)
    expect(resolveNodeExtrusion(node, { fullRadius: 0 })).toBeUndefined()
    api.doc.destroy()
  })
  it('suppresses smoothing including legacy inferred and animated enabled states', () => {
    const { api, node } = rectangle()
    node.appearance.cornerRadius = 20
    node.appearance.cornerSmoothing = 0.5
    expect(extrusionShapeLimitation(node)).toBe('corner-smoothing')
    expect(resolveNodeExtrusion(node)).toBeUndefined()
    expect(supportsExtrusion(node)).toBe(false)
    node.appearance.cornerSmoothingEnabled = false
    expect(resolveNodeExtrusion(node)?.depth).toBe(50)
    expect(resolveNodeExtrusion(node, { cornerSmoothingEnabled: 1 })).toBeUndefined()
    expect(resolveNodeExtrusion(node, { cornerSmoothingEnabled: 1, cornerSmoothing: 0 })?.depth).toBe(50)
    expect(resolveNodeExtrusion(node, { cornerSmoothingEnabled: 0, cornerSmoothing: 1 })?.depth).toBe(50)
    expect(node.extrusion?.depth).toBe(50)
    api.doc.destroy()
  })
  it('does not let Full radius hide an active squircle mismatch', () => {
    const { api, node } = rectangle()
    node.appearance.fullRadius = true
    node.appearance.cornerRadii = { tl: 1, tr: 2, br: 3, bl: 4 }
    node.appearance.cornerSmoothing = 1
    expect(extrusionShapeLimitation(node)).toBe('corner-smoothing')
    expect(resolveNodeExtrusion(node)).toBeUndefined()
    expect(resolveNodeExtrusion(node, { cornerSmoothingEnabled: 0 })?.depth).toBe(50)
    api.doc.destroy()
  })
  it('uses identical exact full-ellipse boundaries for authoring and rendering', () => {
    const api = createSceneAPI()
    const id = api.createNode('ellipse', null, { extrusion: { depth: 50, sideColor: '#2563eb' } })
    const node = api.getNode(id)!
    if (node.kind !== 'ellipse') throw new Error('Expected ellipse')
    for (const animated of [{ arcSweep: 0.9999999 }, { arcInnerRadius: 0.0000001 }]) {
      expect(supportsExtrusion(node, animated)).toBe(false)
      expect(resolveNodeExtrusion(node, animated)).toBeUndefined()
    }
    expect(resolveNodeExtrusion(node, { arcSweep: 1, arcInnerRadius: 0 })?.depth).toBe(50)
    api.doc.destroy()
  })
})
