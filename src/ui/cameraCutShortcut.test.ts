// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest'
import type {
  CompositionScene,
  ProgramCameraDescriptor,
} from '@/sequence'
import { planCameraCutShortcut } from '@/ui/cameraCutShortcut'

const cameras: ProgramCameraDescriptor[] = [
  { id: 'camera-1', enabled: true },
  { id: 'camera-2', enabled: true },
  { id: 'camera-3', enabled: true },
]

function makeScene(
  overrides: Partial<CompositionScene> = {},
): CompositionScene {
  return {
    id: 'scene',
    name: 'Scene',
    rootNodeId: 'root',
    duration: 5,
    cameraIds: cameras.map((camera) => camera.id),
    defaultCameraId: 'camera-1',
    cameraCuts: {},
    ...overrides,
  }
}

function plan(
  overrides: Partial<Parameters<typeof planCameraCutShortcut>[0]> = {},
) {
  return planCameraCutShortcut({
    timelineScope: 'scene',
    scene: makeScene(),
    playhead: 0.5,
    frameRate: 30,
    cameras,
    fallbackCameraId: 'camera-1',
    createId: () => 'cut-new',
    ...overrides,
  })
}

describe('camera cut keyboard shortcut planning', () => {
  it('advances in ownership order without depending on layer selection', () => {
    expect(plan()).toEqual({
      cut: {
        id: 'cut-new',
        time: 0.5,
        cameraId: 'camera-2',
      },
      removeCutIds: [],
      replaced: false,
    })
  })

  it('cycles from the camera currently on Program', () => {
    expect(plan()?.cut.cameraId).toBe('camera-2')
    const scene = makeScene({
      cameraCuts: {
        second: {
          id: 'second',
          time: 0.25,
          cameraId: 'camera-2',
        },
      },
    })
    expect(
      plan({
        scene,
      })?.cut.cameraId,
    ).toBe('camera-3')
  })

  it('cycles after current Program camera and wraps ownership order', () => {
    const scene = makeScene({
      cameraCuts: {
        second: {
          id: 'second',
          time: 1,
          cameraId: 'camera-2',
        },
        third: {
          id: 'third',
          time: 2,
          cameraId: 'camera-3',
        },
      },
    })

    expect(
      plan({ scene, playhead: 1.5 })?.cut.cameraId,
    ).toBe('camera-3')
    expect(
      plan({ scene, playhead: 2.5 })?.cut.cameraId,
    ).toBe('camera-1')
  })

  it('skips disabled cameras when cycling', () => {
    expect(
      plan({
        cameras: cameras.map((camera) =>
          camera.id === 'camera-3'
            ? { ...camera, enabled: false }
            : camera
        ),
      })?.cut.cameraId,
    ).toBe('camera-2')
  })

  it('replaces the deterministic same-frame winner and removes duplicates', () => {
    const createId = vi.fn(() => 'unused')
    const scene = makeScene({
      cameraCuts: {
        alpha: {
          id: 'alpha',
          time: 0.991,
          cameraId: 'camera-1',
        },
        omega: {
          id: 'omega',
          time: 1.009,
          cameraId: 'camera-2',
        },
      },
    })

    expect(
      plan({
        scene,
        playhead: 1,
        createId,
      }),
    ).toEqual({
      cut: {
        id: 'omega',
        time: 1,
        cameraId: 'camera-3',
      },
      removeCutIds: ['alpha'],
      replaced: true,
    })
    expect(createId).not.toHaveBeenCalled()
  })

  it('alternates a two-camera program Default → Cam 2 → Default → Cam 2', () => {
    const twoCameras: ProgramCameraDescriptor[] = [
      { id: 'default', enabled: true },
      { id: 'cam-2', enabled: true },
    ]
    let scene = makeScene({
      cameraIds: twoCameras.map((camera) => camera.id),
      defaultCameraId: 'default',
      cameraCuts: {},
    })
    const targets: string[] = ['default']

    for (const [index, playhead] of [1, 2, 3].entries()) {
      const next = plan({
        scene,
        playhead,
        cameras: twoCameras,
        fallbackCameraId: 'default',
        createId: () => `cut-${index + 1}`,
      })
      expect(next).not.toBeNull()
      targets.push(next!.cut.cameraId)
      scene = {
        ...scene,
        cameraCuts: {
          ...scene.cameraCuts,
          [next!.cut.id]: next!.cut,
        },
      }
    }

    expect(targets).toEqual(['default', 'cam-2', 'default', 'cam-2'])
  })

  it.each([
    {
      name: 'Master timeline',
      overrides: { timelineScope: 'sequence' as const },
    },
    {
      name: 'missing scene',
      overrides: { scene: null },
    },
    {
      name: 'one owned camera',
      overrides: {
        scene: makeScene({
          cameraIds: ['camera-1'],
          defaultCameraId: 'camera-1',
        }),
      },
    },
    {
      name: 'one enabled camera',
      overrides: {
        cameras: cameras.map((camera) =>
          camera.id === 'camera-1'
            ? camera
            : { ...camera, enabled: false }
        ),
      },
    },
  ])('does nothing for $name', ({ overrides }) => {
    expect(plan(overrides)).toBeNull()
  })
})
