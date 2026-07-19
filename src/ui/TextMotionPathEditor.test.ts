// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  defaultTextMotionPath,
  evaluateTextMotionPath,
  splitTextMotionPathAt,
} from '@/anim/textMotionPath'
import {
  editTextMotionPathPart,
  largestTextMotionPathSegmentMidpoint,
  nearestTextMotionPathAmount,
  textMotionPathPartPosition,
} from './textMotionPathEditorMath'

describe('text motion path editor math', () => {
  it('moves an interior spatial anchor with all of its handles', () => {
    const path = splitTextMotionPathAt(defaultTextMotionPath(), 0.5, 'middle')
    const before = path.points[1]!
    const target = { x: 1.25, y: -1.75, z: 0.6 }
    const moved = editTextMotionPathPart(path, 'middle', 'anchor', target)
    const point = moved.points[1]!

    expect(point).toMatchObject(target)
    expect(point.inX - before.inX).toBeCloseTo(target.x - before.x, 8)
    expect(point.inY - before.inY).toBeCloseTo(target.y - before.y, 8)
    expect(point.inZ - before.inZ).toBeCloseTo(target.z - before.z, 8)
    expect(point.outX - before.outX).toBeCloseTo(target.x - before.x, 8)
    expect(point.outY - before.outY).toBeCloseTo(target.y - before.y, 8)
    expect(point.outZ - before.outZ).toBeCloseTo(target.z - before.z, 8)
    expect(moved.points[0]).toMatchObject({ t: 0, x: 0, y: 0, z: 0 })
  })

  it('keeps the settled anchor fixed while the hidden start remains movable', () => {
    const path = defaultTextMotionPath()
    const settled = path.points[0]!
    const hidden = path.points.at(-1)!

    expect(
      editTextMotionPathPart(path, settled.id, 'anchor', {
        x: 4,
        y: 4,
        z: 4,
      }),
    ).toEqual(path)

    const moved = editTextMotionPathPart(path, hidden.id, 'anchor', {
      x: 2,
      y: -6,
      z: 1.5,
    })
    expect(moved.points.at(-1)).toMatchObject({
      t: 1,
      x: 2,
      y: -6,
      z: 1.5,
    })
    expect(moved.points[0]).toMatchObject({ x: 0, y: 0, z: 0 })
  })

  it('edits one Bezier handle independently in unrestricted XY space', () => {
    const path = splitTextMotionPathAt(defaultTextMotionPath(), 0.5, 'middle')
    const point = path.points[1]!
    const next = editTextMotionPathPart(path, point.id, 'out', {
      x: 3.5,
      y: 2.25,
      z: -1,
    })

    expect(textMotionPathPartPosition(next.points[1]!, 'out')).toEqual({
      x: 3.5,
      y: 2.25,
      z: -1,
    })
    expect(textMotionPathPartPosition(next.points[1]!, 'anchor')).toEqual(
      textMotionPathPartPosition(point, 'anchor'),
    )
  })

  it('finds the nearest spatial point without assuming monotonic X or Y', () => {
    const path = defaultTextMotionPath()
    const targetAmount = 0.63
    const target = evaluateTextMotionPath(targetAmount, path)
    const nearest = nearestTextMotionPathAmount(path, target, 96)

    expect(nearest).toBeCloseTo(targetAmount, 3)
  })

  it('adds a toolbar point in the widest remaining time interval', () => {
    const path = splitTextMotionPathAt(defaultTextMotionPath(), 0.5, 'middle')
    expect(largestTextMotionPathSegmentMidpoint(path)).toBeCloseTo(0.25)
  })
})
