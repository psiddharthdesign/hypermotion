// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { keyframeValuesForPatch } from '@/anim/recordKeyframes'
import { createSceneAPI } from '@/scene/doc'
import { readScene, sceneToBytes } from '@/scene/file'
import { PROPERTIES } from '@/scene/props'
import {
  defaultLayerMotionPath,
  evaluateLayerMotionPath,
  evaluateLayerMotionPathSample,
  normalizeLayerMotionPath,
  type LayerMotionPath,
} from './layerMotionPath'

describe('layer motion path', () => {
  it('provides a pixel-space constant-speed default rooted at the layer origin', () => {
    const path = defaultLayerMotionPath()

    expect(path).toMatchObject({
      version: 1,
      progress: 0,
      autoOrient: false,
      rotationOffset: 0,
      parameterization: 'arc-length',
    })
    expect(path.points[0]).toMatchObject({ t: 0, x: 0, y: 0, z: 0 })
    expect(path.points.at(-1)).toMatchObject({ t: 1, x: 240, y: 0, z: 0 })
  })

  it('normalizes time and ids while translating the complete curve to the origin', () => {
    const path = normalizeLayerMotionPath({
      version: 1,
      progress: 4,
      autoOrient: true,
      rotationOffset: Number.NaN,
      parameterization: 'unknown',
      points: [
        { id: 'same', t: 1, x: 110, y: 20, z: 3 },
        { id: 'same', t: 0, x: 10, y: 20, z: 3 },
      ],
    })!

    expect(path).toMatchObject({
      progress: 1,
      autoOrient: true,
      rotationOffset: 0,
      parameterization: 'arc-length',
    })
    expect(path.points[0]).toMatchObject({
      id: 'same',
      t: 0,
      x: 0,
      y: 0,
      z: 0,
      inX: 0,
      inY: 0,
      inZ: 0,
    })
    expect(path.points[0]?.outX).toBeCloseTo(100 / 3)
    expect(path.points[1]).toMatchObject({
      id: 'same-1',
      t: 1,
      x: 100,
      y: 0,
      z: 0,
      outX: 100,
      outY: 0,
      outZ: 0,
    })
    expect(path.points[1]?.inX).toBeCloseTo((100 * 2) / 3)
  })

  it('evaluates cubic position and a normalized tangent in screen coordinates', () => {
    const path = normalizeLayerMotionPath({
      version: 1,
      parameterization: 'parametric',
      points: [
        {
          id: 'start',
          t: 0,
          x: 0,
          y: 0,
          z: 0,
          outX: 0,
          outY: 100,
          outZ: 0,
        },
        {
          id: 'end',
          t: 1,
          x: 100,
          y: 0,
          z: 0,
          inX: 100,
          inY: 100,
          inZ: 0,
        },
      ],
    })!

    const sample = evaluateLayerMotionPathSample(path, 0.5)
    expect(sample.position.x).toBeCloseTo(50)
    expect(sample.position.y).toBeCloseTo(75)
    expect(sample.position.z).toBe(0)
    expect(sample.tangent.x).toBeCloseTo(1)
    expect(sample.tangent.y).toBeCloseTo(0)
    expect(sample.tangent.z).toBeCloseTo(0)
  })

  it('optionally remaps progress to approximately uniform arc length', () => {
    const parametric = normalizeLayerMotionPath({
      version: 1,
      parameterization: 'parametric',
      points: [
        { id: 'start', t: 0, x: 0, y: 0 },
        { id: 'middle', t: 0.5, x: 10, y: 0 },
        { id: 'end', t: 1, x: 110, y: 0 },
      ],
    })!
    const constantSpeed = {
      ...parametric,
      parameterization: 'arc-length' as const,
    }

    expect(evaluateLayerMotionPath(parametric, 0.5).x).toBeCloseTo(10)
    expect(evaluateLayerMotionPath(constantSpeed, 0.5).x).toBeCloseTo(55, 1)
  })

  it('keeps tangent orientation stable when endpoint handles collapse', () => {
    const path = normalizeLayerMotionPath({
      version: 1,
      parameterization: 'parametric',
      points: [
        {
          id: 'start',
          t: 0,
          x: 0,
          y: 0,
          outX: 0,
          outY: 0,
        },
        {
          id: 'end',
          t: 1,
          x: 100,
          y: 0,
          inX: 100,
          inY: 0,
        },
      ],
    })!

    expect(evaluateLayerMotionPathSample(path, 0).tangent).toEqual({
      x: 1,
      y: 0,
      z: 0,
    })
    expect(evaluateLayerMotionPathSample(path, 1).tangent).toEqual({
      x: 1,
      y: 0,
      z: 0,
    })
  })

  it('returns a safe origin and heading for missing paths', () => {
    expect(evaluateLayerMotionPathSample(null, 0.5)).toEqual({
      position: { x: 0, y: 0, z: 0 },
      tangent: { x: 1, y: 0, z: 0 },
    })
  })

  it('normalizes layer paths at scene create, update, and file-read boundaries', () => {
    const api = createSceneAPI()
    const id = api.createNode('rect', null, {
      motionPath: {
        version: 1,
        progress: 2,
        autoOrient: true,
        rotationOffset: 12,
        parameterization: 'parametric',
        points: [
          { id: 'start', t: 0, x: 20, y: 30 },
          { id: 'end', t: 1, x: 120, y: 80 },
        ],
      } as unknown as LayerMotionPath,
    })

    expect(api.getNode(id)?.motionPath).toMatchObject({
      progress: 1,
      points: [
        { x: 0, y: 0, z: 0 },
        { x: 100, y: 50, z: 0 },
      ],
    })

    api.setNodeProperty(id, 'motionPath', {
      version: 1,
      progress: -1,
      autoOrient: false,
      rotationOffset: 0,
      parameterization: 'arc-length',
      points: [
        { id: 'start', t: 0, x: 0, y: 0 },
        { id: 'end', t: 1, x: 40, y: 0 },
      ],
    } as unknown as LayerMotionPath)
    expect(api.getNode(id)?.motionPath?.progress).toBe(0)

    const reopened = readScene(sceneToBytes(api.doc)).api.getNode(id)
    expect(reopened?.motionPath).toEqual(api.getNode(id)?.motionPath)
  })

  it('registers and records progress without keyframing path geometry', () => {
    expect(
      keyframeValuesForPatch('motionPath', {
        progress: 0.4,
        autoOrient: true,
        rotationOffset: 15,
        parameterization: 'arc-length',
        points: [],
      }),
    ).toEqual([{ propertyId: 'motionPath.progress', value: 0.4 }])
    expect(PROPERTIES['motionPath.progress']).toMatchObject({
      group: 'transform',
      interpolation: 'numeric',
      layoutAffecting: false,
      defaultValue: 0,
    })
  })
})
