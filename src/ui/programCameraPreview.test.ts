// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import type {
  CompositionScene,
  ProgramCameraDescriptor,
} from '@/sequence'
import {
  createProgramCameraPreviewSnapshot,
  resolveProgramCameraPreviewId,
} from '@/ui/programCameraPreview'

const scene: CompositionScene = {
  id: 'scene',
  name: 'Scene',
  rootNodeId: 'root',
  duration: 4,
  cameraIds: ['camera-1', 'camera-2'],
  defaultCameraId: 'camera-1',
  cameraCuts: {
    detail: {
      id: 'detail',
      cameraId: 'camera-2',
      time: 1,
    },
  },
}

const cameras: ProgramCameraDescriptor[] = [
  { id: 'camera-1', enabled: true },
  { id: 'camera-2', enabled: true },
]

function resolveAt(
  localTime: number,
  overrides: Partial<Parameters<typeof resolveProgramCameraPreviewId>[0]> = {},
) {
  return resolveProgramCameraPreviewId({
    scene,
    cameras,
    fallbackCameraId: 'camera-1',
    frameRate: 30,
    previewScope: 'scene',
    editorView: { mode: 'program' },
    localTime,
    ...overrides,
  })
}

describe('program camera preview policy', () => {
  it('follows authored cuts in Scene Program view at the exact cut frame', () => {
    expect(resolveAt(1 - 1 / 30)).toBe('camera-1')
    expect(resolveAt(1)).toBe('camera-2')
    expect(resolveAt(2)).toBe('camera-2')
  })

  it('keeps a valid Scene editor camera locked across program cuts', () => {
    expect(
      resolveAt(2, {
        editorView: { mode: 'camera', cameraId: 'camera-1' },
      }),
    ).toBe('camera-1')
  })

  it('ignores Scene editor locks in Master preview', () => {
    expect(
      resolveAt(2, {
        previewScope: 'sequence',
        editorView: { mode: 'camera', cameraId: 'camera-1' },
      }),
    ).toBe('camera-2')
  })

  it.each([
    {
      name: 'unowned',
      editorView: { mode: 'camera', cameraId: 'other-scene-camera' } as const,
      cameraState: cameras,
    },
    {
      name: 'missing',
      editorView: { mode: 'camera', cameraId: 'camera-1' } as const,
      cameraState: cameras.filter((camera) => camera.id !== 'camera-1'),
    },
    {
      name: 'disabled',
      editorView: { mode: 'camera', cameraId: 'camera-1' } as const,
      cameraState: cameras.map((camera) =>
        camera.id === 'camera-1'
          ? { ...camera, enabled: false }
          : camera
      ),
    },
  ])('falls back to Program for an $name Scene lock', ({
    editorView,
    cameraState,
  }) => {
    expect(
      resolveAt(2, {
        cameras: cameraState,
        editorView,
      }),
    ).toBe('camera-2')
  })
})

describe('program camera preview snapshot', () => {
  it('tracks before-cut, exact-cut, and loop-back time with stable ids', () => {
    let localTime = 0.2
    const getSnapshot = createProgramCameraPreviewSnapshot({
      scene,
      cameras,
      fallbackCameraId: 'camera-1',
      frameRate: 30,
      previewScope: 'scene',
      editorView: { mode: 'program' },
      readLocalTime: () => localTime,
    })

    const beforeCut = getSnapshot()
    expect(beforeCut).toBe('camera-1')

    localTime = 0.8
    expect(getSnapshot()).toBe(beforeCut)

    localTime = 1
    const afterCut = getSnapshot()
    expect(afterCut).toBe('camera-2')

    localTime = 3.5
    expect(getSnapshot()).toBe(afterCut)

    localTime = 0.1
    expect(getSnapshot()).toBe(beforeCut)
  })
})
