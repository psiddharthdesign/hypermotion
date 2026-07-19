// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import type { Plane3D } from './scene3d'
import {
  TEXT_SEGMENT_BUFFER_CHANGE,
  cameraSpaceTextMotionOffset,
  createTextSegmentBuffers,
  textSegmentWorldUnitsPerScreenPixel,
  writeTextSegmentBuffers,
  type TextSegmentAtlasEntry,
  type TextSegmentGeometryState,
} from './textSegmentBatch'

const plane = {
  rect: { x: 0, y: 0, width: 200, height: 100 },
  center: { x: 100, y: 50, z: 0 },
  right: { x: 1, y: 0, z: 0 },
  down: { x: 0, y: 1, z: 0 },
  normal: { x: 0, y: 0, z: 1 },
  scaleX: 1,
  scaleY: 1,
} as Plane3D

function entry(x: number, order: number): TextSegmentAtlasEntry {
  return {
    x,
    y: 20,
    width: 20,
    height: 40,
    padding: 0,
    pivotX: x + 10,
    pivotY: 40,
    animate: true,
    order,
    trackingIndex: order,
    lineCharacterCount: 2,
    trackingAlignment: 0,
    visualLineIndex: 0,
    uv: { minX: order * 0.5, minY: 0, maxX: (order + 1) * 0.5, maxY: 1 },
  }
}

function state(z: number, opacity = 1): TextSegmentGeometryState {
  return {
    offset: { x: 0, y: 0, z },
    opacity,
    effectBlur: 0,
    dofBlur: Math.abs(z),
    scale: 1,
    skew: 0,
    rotationX: 0,
    cropTop: 0,
    cropBottom: 0,
  }
}

describe('text segment batch geometry', () => {
  it('maps positive authored Z toward the viewer', () => {
    expect(
      cameraSpaceTextMotionOffset(
        { x: 10, y: 20, z: 30 },
        {
          right: { x: 1, y: 0, z: 0 },
          down: { x: 0, y: 1, z: 0 },
          forward: { x: 0, y: 0, z: 1 },
        },
      ),
    ).toEqual({ x: 10, y: 20, z: -30 })
  })

  it('uses one indexed quad batch for 100 glyphs', () => {
    const buffers = createTextSegmentBuffers(100)
    expect(buffers.positions).toHaveLength(400 * 3)
    expect(buffers.uvs).toHaveLength(400 * 2)
    expect(buffers.indices).toHaveLength(600)
  })

  it('reserves more local blur space for far and down-scaled text', () => {
    expect(
      textSegmentWorldUnitsPerScreenPixel({
        plane: {
          ...plane,
          center: { x: 100, y: 50, z: 2000 },
          scaleX: 0.5,
          scaleY: 0.5,
        },
        cameraDepth: (point) => point.z,
        focalLength: 1000,
      }),
    ).toBe(4)
  })

  it('includes the farthest tilted corner and away motion in blur space', () => {
    expect(
      textSegmentWorldUnitsPerScreenPixel({
        plane: {
          ...plane,
          center: { x: 100, y: 50, z: 1000 },
          down: { x: 0, y: 0, z: 1 },
        },
        cameraDepth: (point) => point.z,
        focalLength: 1000,
        extraAwayDepth: 150,
      }),
    ).toBeCloseTo(1.2)
  })

  it('writes world-space XYZ, alpha, blur, and UV cell bounds', () => {
    const buffers = createTextSegmentBuffers(1)
    writeTextSegmentBuffers({
      buffers,
      entries: [entry(10, 0)],
      states: [state(-80, 0.4)],
      plane,
      cameraPosition: { x: 0, y: 0, z: 0 },
      cameraForward: { x: 0, y: 0, z: 1 },
    })

    expect(Array.from(buffers.positions.slice(0, 3))).toEqual([10, 20, -80])
    expect(Array.from(buffers.opacity)).toEqual([
      expect.closeTo(0.4),
      expect.closeTo(0.4),
      expect.closeTo(0.4),
      expect.closeTo(0.4),
    ])
    expect(Array.from(buffers.dofBlur)).toEqual([80, 80, 80, 80])
    expect(Array.from(buffers.uvBounds.slice(0, 4))).toEqual([0, 0, 0.5, 1])
  })

  it('sorts transparent quad indices from far to near', () => {
    const buffers = createTextSegmentBuffers(2)
    const firstChanges = writeTextSegmentBuffers({
      buffers,
      entries: [entry(10, 0), entry(40, 1)],
      states: [state(10), state(100)],
      plane,
      cameraPosition: { x: 0, y: 0, z: 0 },
      cameraForward: { x: 0, y: 0, z: 1 },
    })

    expect(firstChanges & TEXT_SEGMENT_BUFFER_CHANGE.indices).not.toBe(0)
    expect(Array.from(buffers.indices.slice(0, 6))).toEqual([4, 6, 5, 6, 7, 5])
    expect(Array.from(buffers.indices.slice(6))).toEqual([0, 2, 1, 2, 3, 1])

    const unchanged = writeTextSegmentBuffers({
      buffers,
      entries: [entry(10, 0), entry(40, 1)],
      states: [state(10), state(100)],
      plane,
      cameraPosition: { x: 0, y: 0, z: 0 },
      cameraForward: { x: 0, y: 0, z: 1 },
    })
    expect(unchanged).toBe(0)

    const crossedAgain = writeTextSegmentBuffers({
      buffers,
      entries: [entry(10, 0), entry(40, 1)],
      states: [state(100), state(10)],
      plane,
      cameraPosition: { x: 0, y: 0, z: 0 },
      cameraForward: { x: 0, y: 0, z: 1 },
    })
    expect(crossedAgain & TEXT_SEGMENT_BUFFER_CHANGE.indices).not.toBe(0)
    expect(Array.from(buffers.indices.slice(0, 6))).toEqual([0, 2, 1, 2, 3, 1])
  })

  it('crops geometry and UVs together for mask effects', () => {
    const buffers = createTextSegmentBuffers(1)
    writeTextSegmentBuffers({
      buffers,
      entries: [entry(10, 0)],
      states: [{ ...state(0), cropTop: 0.25 }],
      plane,
      cameraPosition: { x: 0, y: 0, z: 0 },
      cameraForward: { x: 0, y: 0, z: 1 },
    })

    expect(buffers.positions[1]).toBe(30)
    expect(buffers.uvs[1]).toBe(0.25)
    expect(buffers.positions[7]).toBe(60)
    expect(buffers.uvs[5]).toBe(1)
  })

  it('keeps mask timing independent from transparent blur padding', () => {
    const buffers = createTextSegmentBuffers(1)
    writeTextSegmentBuffers({
      buffers,
      entries: [{ ...entry(10, 0), padding: 20 }],
      states: [{ ...state(0), cropTop: 0.25 }],
      plane,
      cameraPosition: { x: 0, y: 0, z: 0 },
      cameraForward: { x: 0, y: 0, z: 1 },
    })

    expect(buffers.positions[1]).toBe(30)
    expect(buffers.uvs[1]).toBeCloseTo(0.375)
    expect(buffers.positions[7]).toBe(80)
    expect(buffers.uvs[5]).toBe(1)
    expect(Array.from(buffers.uvBounds.slice(0, 4))).toEqual([
      0,
      expect.closeTo(0.375),
      0.5,
      1,
    ])
  })

  it('collapses a fully masked segment and excludes hidden UVs from blur', () => {
    const buffers = createTextSegmentBuffers(1)
    writeTextSegmentBuffers({
      buffers,
      entries: [{ ...entry(10, 0), padding: 20 }],
      states: [{ ...state(0), cropTop: 1 }],
      plane,
      cameraPosition: { x: 0, y: 0, z: 0 },
      cameraForward: { x: 0, y: 0, z: 1 },
    })

    expect(buffers.positions[1]).toBe(60)
    expect(buffers.positions[7]).toBe(60)
    expect(buffers.uvBounds[1]).toBe(buffers.uvBounds[3])
  })

  it('matches CSS rotateX direction with down-positive text coordinates', () => {
    const buffers = createTextSegmentBuffers(1)
    writeTextSegmentBuffers({
      buffers,
      entries: [entry(10, 0)],
      states: [{ ...state(0), rotationX: -Math.PI / 4 }],
      plane,
      cameraPosition: { x: 0, y: 0, z: 0 },
      cameraForward: { x: 0, y: 0, z: 1 },
    })

    expect(buffers.positions[2]).toBeLessThan(0)
    expect(buffers.positions[8]).toBeGreaterThan(0)
  })

  it('does not report false changes from Float32 rounding', () => {
    const buffers = createTextSegmentBuffers(1)
    const entries = [
      {
        ...entry(10.123, 0),
        uv: { minX: 0.1, minY: 0.2, maxX: 0.7, maxY: 0.9 },
      },
    ]
    const states = [
      {
        ...state(0.789, 0.4),
        offset: { x: 0.123, y: 0.456, z: 0.789 },
        effectBlur: 2.3,
        dofBlur: 1.7,
        scale: 0.913,
        skew: 0.137,
      },
    ]
    const input = {
      buffers,
      entries,
      states,
      plane,
      cameraPosition: { x: 0.1, y: 0.2, z: 0.3 },
      cameraForward: { x: 0, y: 0, z: 1 },
    }

    expect(writeTextSegmentBuffers(input)).not.toBe(0)
    expect(writeTextSegmentBuffers(input)).toBe(0)
  })

  it('skips static texture-coordinate work between ordinary stagger frames', () => {
    const buffers = createTextSegmentBuffers(1)
    const entries = [entry(10, 0)]
    const states = [state(0)]
    writeTextSegmentBuffers({
      buffers,
      entries,
      states,
      plane,
      cameraPosition: { x: 0, y: 0, z: 0 },
      cameraForward: { x: 0, y: 0, z: 1 },
    })
    const originalUvs = buffers.uvs.slice()
    const originalBounds = buffers.uvBounds.slice()

    states[0] = { ...states[0]!, cropTop: 0.5, offset: { x: 5, y: 0, z: 0 } }
    const changes = writeTextSegmentBuffers({
      buffers,
      entries,
      states,
      plane,
      cameraPosition: { x: 0, y: 0, z: 0 },
      cameraForward: { x: 0, y: 0, z: 1 },
      updateTextureCoordinates: false,
    })

    expect(changes & TEXT_SEGMENT_BUFFER_CHANGE.positions).not.toBe(0)
    expect(changes & TEXT_SEGMENT_BUFFER_CHANGE.uvs).toBe(0)
    expect(changes & TEXT_SEGMENT_BUFFER_CHANGE.uvBounds).toBe(0)
    expect(buffers.uvs).toEqual(originalUvs)
    expect(buffers.uvBounds).toEqual(originalBounds)
  })
})
