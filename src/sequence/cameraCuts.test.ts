// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  normalizeCameraCuts,
  orderedCameraCuts,
  resolveCameraCut,
  resolveProgramCamera,
} from './cameraCuts'
import type {
  CameraCutMap,
  CompositionScene,
  ProgramCameraDescriptor,
} from './types'

function scene(
  cameraCuts: CameraCutMap = {},
  overrides: Partial<CompositionScene> = {},
): CompositionScene {
  return {
    id: 'demo',
    name: 'Demo',
    rootNodeId: 'demo-root',
    duration: 5,
    cameraIds: ['wide', 'detail', 'macro'],
    defaultCameraId: 'wide',
    cameraCuts,
    ...overrides,
  }
}

const cameras: ProgramCameraDescriptor[] = [
  { id: 'wide', enabled: true },
  { id: 'detail', enabled: true },
  { id: 'macro', enabled: true },
]

describe('camera-cut ordering and normalization', () => {
  it('sorts records by time then id and ignores malformed runtime values', () => {
    const cuts = {
      z: { id: 'z', time: 1, cameraId: 'macro' },
      invalid: { id: '', time: 0, cameraId: 'wide' },
      early: { id: 'early', time: 0.5, cameraId: 'wide' },
      a: { id: 'a', time: 1, cameraId: 'detail' },
    }

    expect(orderedCameraCuts(cuts).map((cut) => cut.id)).toEqual([
      'early',
      'a',
      'z',
    ])
  })

  it('clamps and frame-quantizes without mutating persisted cuts', () => {
    const cuts: CameraCutMap = {
      before: { id: 'before', time: -2, cameraId: 'wide' },
      middle: { id: 'middle', time: 1.04, cameraId: 'detail' },
      after: { id: 'after', time: 99, cameraId: 'macro' },
    }
    const normalized = normalizeCameraCuts(cuts, {
      duration: 5,
      frameRate: 10,
    })

    expect(normalized.map((cut) => [cut.id, cut.time])).toEqual([
      ['before', 0],
      ['middle', 1],
      ['after', 5],
    ])
    expect(cuts.before?.time).toBe(-2)
    expect(cuts.after?.time).toBe(99)
  })

  it('uses the greatest id as the deterministic same-time winner', () => {
    const cuts: CameraCutMap = {
      z: { id: 'z', time: 1, cameraId: 'macro' },
      a: { id: 'a', time: 1, cameraId: 'detail' },
    }

    expect(resolveCameraCut(cuts, 0.999)).toBeNull()
    expect(resolveCameraCut(cuts, 1)?.id).toBe('z')
  })
})
describe('resolveProgramCamera', () => {
  it('uses the default before the first cut and switches at the exact cut', () => {
    const composition = scene({
      detail: { id: 'detail-cut', time: 2, cameraId: 'detail' },
    })

    expect(resolveProgramCamera({
      scene: composition,
      localTime: 1.999,
      cameras,
    })).toMatchObject({
      cameraId: 'wide',
      source: 'default',
      requestedCut: null,
    })
    expect(resolveProgramCamera({
      scene: composition,
      localTime: 2,
      cameras,
    })).toMatchObject({
      cameraId: 'detail',
      source: 'cut',
      requestedCut: { id: 'detail-cut' },
      resolvedCut: { id: 'detail-cut' },
      requestedCutFailure: null,
    })
  })

  it('falls back to the previous valid cut when the latest target is stale', () => {
    const composition = scene({
      first: { id: 'first', time: 1, cameraId: 'detail' },
      stale: { id: 'stale', time: 2, cameraId: 'deleted-camera' },
    })

    expect(resolveProgramCamera({
      scene: composition,
      localTime: 3,
      cameras,
    })).toMatchObject({
      cameraId: 'detail',
      source: 'earlier-cut',
      requestedCut: { id: 'stale' },
      resolvedCut: { id: 'first' },
      requestedCutFailure: 'not-owned',
    })
  })

  it('skips disabled cut cameras while preserving failure diagnostics', () => {
    const composition = scene({
      first: { id: 'first', time: 1, cameraId: 'detail' },
      disabled: { id: 'disabled', time: 2, cameraId: 'macro' },
    })

    expect(resolveProgramCamera({
      scene: composition,
      localTime: 3,
      cameras: cameras.map((camera) =>
        camera.id === 'macro' ? { ...camera, enabled: false } : camera
      ),
    })).toMatchObject({
      cameraId: 'detail',
      source: 'earlier-cut',
      requestedCutFailure: 'disabled',
    })
  })

  it('falls through default, adapter fallback, and owned camera order', () => {
    const disabledDefault = scene({}, { defaultCameraId: 'wide' })
    const cameraState = cameras.map((camera) =>
      camera.id === 'wide' ? { ...camera, enabled: false } : camera
    )

    expect(resolveProgramCamera({
      scene: disabledDefault,
      localTime: 0,
      cameras: cameraState,
      fallbackCameraId: 'macro',
    })).toMatchObject({
      cameraId: 'macro',
      source: 'fallback',
    })

    expect(resolveProgramCamera({
      scene: disabledDefault,
      localTime: 0,
      cameras: cameraState,
    })).toMatchObject({
      cameraId: 'detail',
      source: 'first-enabled',
    })
  })

  it('returns identity-camera intent when no owned camera is available', () => {
    const result = resolveProgramCamera({
      scene: scene(),
      localTime: 0,
      cameras: cameras.map((camera) => ({ ...camera, enabled: false })),
    })

    expect(result).toEqual({
      cameraId: null,
      source: 'none',
      requestedCut: null,
      resolvedCut: null,
      requestedCutFailure: null,
    })
  })

  it('clamps future cuts to the scene end and honors frame quantization', () => {
    const composition = scene({
      future: { id: 'future', time: 99, cameraId: 'macro' },
      detail: { id: 'detail', time: 1.04, cameraId: 'detail' },
    })

    expect(resolveProgramCamera({
      scene: composition,
      localTime: 1.01,
      cameras,
      frameRate: 10,
    })).toMatchObject({
      cameraId: 'detail',
      source: 'cut',
      requestedCut: { id: 'detail', time: 1 },
    })
    expect(resolveProgramCamera({
      scene: composition,
      localTime: 4.99,
      cameras,
      frameRate: 10,
    })).toMatchObject({
      cameraId: 'macro',
      requestedCut: { id: 'future', time: 5 },
    })
  })
})
