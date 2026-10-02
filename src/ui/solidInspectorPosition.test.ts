// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import type { AnimatedValue } from '@/anim'
import { useUI } from '@/state/ui'
import { createSolidInspectorPositionConstraint, isSolidPositionPatch } from './solidInspectorPosition'

function fixture() {
  const api = createSceneAPI()
  const root = api.createNode('frame', null, { size: { width: 960, height: 540 } })
  const body = api.createNode('rect', root, { size: { width: 100, height: 60 }, extrusion: { depth: 40, sideColor: '#2563eb' } })
  const obstacle = api.createNode('rect', root, { size: { width: 100, height: 60 }, extrusion: { depth: 40, sideColor: '#2563eb' }, preventOverlap: true })
  api.setNodeProperty(obstacle, 'transform', { ...api.getNode(obstacle)!.transform, x: 180 })
  const layout = { [root]: { x: 0, y: 0, width: 960, height: 540 }, [body]: { x: 0, y: 0, width: 100, height: 60 }, [obstacle]: { x: 0, y: 0, width: 100, height: 60 } }
  return { api, body, obstacle, layout, root }
}

describe('Inspector solid translation constraints', () => {
  it('limits typed XYZ to contact with a protected asset', () => {
    const f = fixture()
    const x = createSolidInspectorPositionConstraint(f.api, f.body, {}, f.layout)!
    expect(x.commit({ x: 140 }).x).toBeCloseTo(80, 4)
    expect(x.preview({ x: 140 }).x).toBeCloseTo(80, 4)
    f.api.setNodeProperty(f.obstacle, 'transform', { ...f.api.getNode(f.obstacle)!.transform, x: 0, z: 100 })
    const z = createSolidInspectorPositionConstraint(f.api, f.body, {}, f.layout)!
    expect(z.commit({ z: 100 }).z).toBeCloseTo(60, 4)
    f.api.doc.destroy()
  })

  it('keeps typed fractional precision even when grid snapping is enabled', () => {
    const f = fixture()
    useUI.getState().setSolidGridSnapEnabled(true)
    useUI.getState().setSolidGridSize(32)
    try {
      const session = createSolidInspectorPositionConstraint(f.api, f.body, {}, f.layout)!
      expect(session.preview({ x: 17.25 })).toEqual({ x: 17.25 })
      expect(session.commit({ x: 17.25 })).toEqual({ x: 17.25 })
    } finally {
      useUI.getState().setSolidGridSnapEnabled(false)
      f.api.doc.destroy()
    }
  })

  it('freezes the unpreviewed animated pose for every scrub packet and the final commit', () => {
    const f = fixture()
    const snapshot: Record<string, AnimatedValue> = { [f.body]: { x: 20, y: 0, z: 0 } }
    const session = createSolidInspectorPositionConstraint(f.api, f.body, snapshot, f.layout)!
    expect(session.preview({ x: 60 })).toEqual({ x: 60 })
    expect(session.preview({ x: 140 }).x).toBeCloseTo(80, 4)
    expect(session.preview({ x: 70 })).toEqual({ x: 70 })
    expect(session.commit({ x: 140 }).x).toBeCloseTo(80, 4)
    expect(f.api.getNode(f.body)?.transform.x).toBe(0)
    expect(f.api.getTracksForNode(f.body)).toEqual([])
    f.api.doc.destroy()
  })

  it('subtracts the animated path offset only when authoring, so commit matches the constrained preview', () => {
    const f = fixture()
    f.api.setNodeProperty(f.body, 'motionPath', {
      version: 1, progress: 0, autoOrient: false, rotationOffset: 0, parameterization: 'parametric',
      points: [
        { id: 'a', t: 0, x: 0, y: 0, z: 0, inX: 0, inY: 0, inZ: 0, outX: 60, outY: 0, outZ: 0 },
        { id: 'b', t: 1, x: 200, y: 0, z: 0, inX: 140, inY: 0, inZ: 0, outX: 200, outY: 0, outZ: 0 },
      ],
    })
    f.api.setNodeProperty(f.obstacle, 'transform', { ...f.api.getNode(f.obstacle)!.transform, x: 260 })
    const session = createSolidInspectorPositionConstraint(f.api, f.body, { [f.body]: { x: 100, y: 0, z: 0, motionPathProgress: 0.5 } }, f.layout)!
    expect(session.preview({ x: 200 }).x).toBeCloseTo(160, 4)
    expect(session.commit({ x: 200 }).x).toBeCloseTo(60, 4)
    f.api.doc.destroy()
  })

  it('leaves cameras and ordinary 2D layers outside the numeric placement path', () => {
    const f = fixture()
    const flat = f.api.createNode('rect', f.root, { size: { width: 100, height: 100 } })
    expect(createSolidInspectorPositionConstraint(f.api, flat, {}, f.layout)).toBeNull()
    expect(createSolidInspectorPositionConstraint(f.api, f.api.getActiveCamera()!.id, {}, f.layout)).toBeNull()
    expect(isSolidPositionPatch({ x: 10, y: 20 })).toBe(true)
    expect(isSolidPositionPatch({ x: 10, anchorX: 0 })).toBe(false)
    expect(isSolidPositionPatch({ rotationX: 45 })).toBe(false)
    expect(isSolidPositionPatch({ opacity: 0.5 })).toBe(false)
    expect(isSolidPositionPatch({ x: NaN })).toBe(false)
    f.api.doc.destroy()
  })
})
