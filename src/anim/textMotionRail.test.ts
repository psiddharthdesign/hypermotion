// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import type { TextMotionPath } from './textMotionPath'
import {
  createTextMotionRailWorkspace,
  refreshTextMotionRailWorkspace,
  resolveTextMotionRailOffsets,
  type TextMotionRailSegment,
} from './textMotionRail'

const straightDrop: TextMotionPath = {
  version: 1,
  points: [
    {
      id: 'settled',
      t: 0,
      x: 0,
      y: 0,
      z: 0,
      inX: 0,
      inY: 0,
      inZ: 0,
      outX: 0,
      outY: -10 / 3,
      outZ: 0,
    },
    {
      id: 'hidden',
      t: 1,
      x: 0,
      y: -10,
      z: 0,
      inX: 0,
      inY: -20 / 3,
      inZ: 0,
      outX: 0,
      outY: -10,
      outZ: 0,
    },
  ],
}

function segment(
  index: number,
  sequence: number,
  x: number,
  y = 0,
): TextMotionRailSegment {
  return { index, sequence, baseline: { x, y, z: 0 } }
}

function absolutePosition(
  offsets: Float64Array,
  entry: TextMotionRailSegment,
) {
  const offset = entry.index * 3
  return {
    x: entry.baseline.x + offsets[offset]!,
    y: entry.baseline.y + offsets[offset + 1]!,
    z: entry.baseline.z + offsets[offset + 2]!,
  }
}

describe('shared text motion rail', () => {
  it('lands on the authored baseline bit-exactly', () => {
    const segments = [
      segment(0, 0, 0),
      segment(1, 1, 11),
      segment(2, 2, 29),
      segment(3, 3, 47),
    ]
    expect(
      Array.from(
        resolveTextMotionRailOffsets(
          straightDrop,
          1,
          0,
          'in',
          segments,
        ),
      ),
    ).toEqual(new Array(12).fill(0))
  })

  it('queues a forward entrance on one rail with natural spacing', () => {
    const segments = [
      segment(0, 0, 0),
      segment(1, 1, 10),
      segment(2, 2, 20),
    ]
    const offsets = resolveTextMotionRailOffsets(
      straightDrop,
      1,
      1,
      'in',
      segments,
    )
    const positions = segments.map((entry) => absolutePosition(offsets, entry))

    // Sequence zero leads at Hidden. The rest of the strip continues along
    // the same tangent rather than piling up at the endpoint.
    expect(positions[0]).toEqual({ x: 20, y: -10, z: 0 })
    expect(positions[1]).toEqual({ x: 20, y: -20, z: 0 })
    expect(positions[2]).toEqual({ x: 20, y: -30, z: 0 })
    expect(Math.hypot(
      positions[1]!.x - positions[0]!.x,
      positions[1]!.y - positions[0]!.y,
    )).toBeCloseTo(10)
    expect(Math.hypot(
      positions[2]!.x - positions[1]!.x,
      positions[2]!.y - positions[1]!.y,
    )).toBeCloseTo(10)
  })

  it('flows continuously from the shared curve onto the real baseline', () => {
    const segments = [
      segment(0, 0, 0),
      segment(1, 1, 10),
      segment(2, 2, 20),
    ]
    // Path length 10 + baseline span 20 = 30. At amount 2/3 the
    // sequence-zero glyph is at the junction and its followers occupy the
    // curve and Hidden endpoint at ten-unit intervals.
    const offsets = resolveTextMotionRailOffsets(
      straightDrop,
      1,
      2 / 3,
      'in',
      segments,
    )
    const positions = segments.map((entry) => absolutePosition(offsets, entry))
    expect(positions[0]).toEqual({ x: 20, y: 0, z: 0 })
    expect(positions[1]!.x).toBeCloseTo(20)
    expect(positions[1]!.y).toBeCloseTo(-10)
    expect(positions[2]!.x).toBeCloseTo(20)
    expect(positions[2]!.y).toBeCloseTo(-20)
  })

  it('reverses the baseline junction for an exit so sequence zero leaves first', () => {
    const segments = [
      segment(0, 0, 0),
      segment(1, 1, 10),
      segment(2, 2, 20),
    ]
    const offsets = resolveTextMotionRailOffsets(
      straightDrop,
      1,
      1 / 6,
      'out',
      segments,
    )
    const positions = segments.map((entry) => absolutePosition(offsets, entry))

    expect(positions[0]!.x).toBeCloseTo(0)
    expect(positions[0]!.y).toBeCloseTo(-5)
    expect(positions[1]).toEqual({ x: 5, y: 0, z: 0 })
    expect(positions[2]).toEqual({ x: 15, y: 0, z: 0 })
  })

  it('keeps irregular and 3D segment gaps while sampling a curved rail', () => {
    const curved: TextMotionPath = {
      version: 1,
      points: [
        {
          ...straightDrop.points[0]!,
          outX: 8,
          outY: -1,
          outZ: 2,
        },
        {
          ...straightDrop.points[1]!,
          x: 5,
          y: -7,
          z: 4,
          inX: 9,
          inY: -6,
          inZ: 4,
          outX: 5,
          outY: -7,
          outZ: 4,
        },
      ],
    }
    const segments = [
      { index: 0, sequence: 0, baseline: { x: 0, y: 0, z: 0 } },
      { index: 1, sequence: 1, baseline: { x: 9, y: 2, z: 1 } },
      { index: 2, sequence: 2, baseline: { x: 25, y: 4, z: 3 } },
    ]
    const offsets = resolveTextMotionRailOffsets(
      curved,
      1,
      1,
      'in',
      segments,
    )
    const positions = segments.map((entry) => absolutePosition(offsets, entry))
    const firstGap = Math.hypot(
      positions[1]!.x - positions[0]!.x,
      positions[1]!.y - positions[0]!.y,
      positions[1]!.z - positions[0]!.z,
    )
    const secondGap = Math.hypot(
      positions[2]!.x - positions[1]!.x,
      positions[2]!.y - positions[1]!.y,
      positions[2]!.z - positions[1]!.z,
    )
    expect(firstGap).toBeCloseTo(Math.hypot(9, 2, 1), 3)
    expect(secondGap).toBeCloseTo(Math.hypot(16, 2, 2), 3)
  })

  it('reuses one prepared workspace and output across playback frames', () => {
    const segments = Array.from({ length: 100 }, (_, index) =>
      segment(index, index, index * 9),
    )
    const workspace = createTextMotionRailWorkspace(segments, 'in')
    const distances = workspace.baselineDistances
    const sample = workspace.sample
    const output = new Float64Array(segments.length * 3)

    for (let frame = 0; frame < 120; frame++) {
      expect(
        resolveTextMotionRailOffsets(
          straightDrop,
          1,
          frame / 119,
          'in',
          segments,
          output,
          workspace,
        ),
      ).toBe(output)
    }
    expect(workspace.baselineDistances).toBe(distances)
    expect(workspace.sample).toBe(sample)
  })

  it('refreshes cached baseline distances after a renderer basis change', () => {
    const segments = [segment(0, 0, 0), segment(1, 1, 10), segment(2, 2, 20)]
    const workspace = createTextMotionRailWorkspace(segments, 'in')
    segments[1]!.baseline.x = 14
    segments[2]!.baseline.x = 31
    refreshTextMotionRailWorkspace(workspace)

    const prepared = resolveTextMotionRailOffsets(
      straightDrop,
      1,
      0.55,
      'in',
      segments,
      new Float64Array(segments.length * 3),
      workspace,
    )
    const fresh = resolveTextMotionRailOffsets(
      straightDrop,
      1,
      0.55,
      'in',
      segments,
    )
    expect(Array.from(prepared)).toEqual(Array.from(fresh))
  })
})
