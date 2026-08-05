// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  cameraCutChangesProgram,
  cameraProgramSegments,
  cameraCutsAtPlayhead,
  commitCameraCutUpsert,
  planCameraCutDrag,
  planCameraCutUpsert,
  planRedundantCameraCutCleanup,
  suggestCameraCutTarget,
} from '@/ui/CameraCutBar.helpers'
import type { CompositionScene } from '@/sequence'

describe('camera cut authoring helpers', () => {
  it('suggests the next enabled camera for a new cut', () => {
    expect(
      suggestCameraCutTarget({
        cameras: [
          { id: 'camera-a', enabled: true },
          { id: 'camera-disabled', enabled: false },
          { id: 'camera-b', enabled: true },
        ],
        currentCameraId: 'camera-a',
      }),
    ).toBe('camera-b')
    expect(
      suggestCameraCutTarget({
        cameras: [
          { id: 'camera-a', enabled: true },
          { id: 'camera-b', enabled: true },
        ],
        currentCameraId: 'camera-b',
      }),
    ).toBe('camera-a')
  })

  it('preserves explicit and existing targets before suggesting another camera', () => {
    const input = {
      cameras: [
        { id: 'camera-a', enabled: true },
        { id: 'camera-b', enabled: true },
        { id: 'camera-c', enabled: true },
      ],
      currentCameraId: 'camera-a',
      existingCutCameraId: 'camera-b',
    }

    expect(suggestCameraCutTarget(input)).toBe('camera-b')
    expect(
      suggestCameraCutTarget({
        ...input,
        preferredCameraId: 'camera-c',
      }),
    ).toBe('camera-c')
  })

  it('detects same-camera no-op cuts against Program before the frame', () => {
    const scene: CompositionScene = {
      id: 'scene',
      name: 'Scene',
      rootNodeId: 'root',
      duration: 4,
      cameraIds: ['camera-a', 'camera-b'],
      defaultCameraId: 'camera-a',
      cameraCuts: {
        existing: { id: 'existing', time: 1, cameraId: 'camera-b' },
      },
    }
    const input = {
      scene,
      playhead: 1,
      frameRate: 30,
      cameras: [
        { id: 'camera-a', enabled: true },
        { id: 'camera-b', enabled: true },
      ],
      fallbackCameraId: 'camera-a',
    }

    expect(
      cameraCutChangesProgram({
        ...input,
        targetCameraId: 'camera-b',
      }),
    ).toBe(true)
    expect(
      cameraCutChangesProgram({
        ...input,
        targetCameraId: 'camera-a',
      }),
    ).toBe(false)
  })

  it('adds a new cut on the nearest scene frame', () => {
    const plan = planCameraCutUpsert({
      cuts: {},
      playhead: 0.508,
      duration: 5,
      frameRate: 30,
      cameraId: 'camera-b',
      createId: () => 'cut-new',
    })

    expect(plan).toEqual({
      cut: {
        id: 'cut-new',
        time: 0.5,
        cameraId: 'camera-b',
      },
      removeCutIds: [],
      replaced: false,
    })
  })

  it('replaces the deterministic winner and removes same-frame duplicates', () => {
    const cuts = {
      alpha: { id: 'alpha', time: 1.001, cameraId: 'camera-a' },
      omega: { id: 'omega', time: 1.009, cameraId: 'camera-b' },
      later: { id: 'later', time: 2, cameraId: 'camera-a' },
    }
    const plan = planCameraCutUpsert({
      cuts,
      playhead: 1,
      duration: 5,
      frameRate: 30,
      cameraId: 'camera-c',
      createId: () => 'unused',
    })

    expect(plan).toEqual({
      cut: {
        id: 'omega',
        time: 1,
        cameraId: 'camera-c',
      },
      removeCutIds: ['alpha'],
      replaced: true,
    })
    expect(cameraCutsAtPlayhead(cuts, 1, 5, 30).map((cut) => cut.id)).toEqual([
      'alpha',
      'omega',
    ])
  })

  it('clamps a cut to the scene duration', () => {
    const plan = planCameraCutUpsert({
      cuts: [],
      playhead: 12,
      duration: 4,
      frameRate: 60,
      cameraId: 'camera-a',
      createId: () => 'cut-end',
    })

    expect(plan.cut.time).toBe(4)
  })

  it('reveals Program output only after the camera cut is persisted', () => {
    const events: string[] = []
    const plan = {
      cut: { id: 'winner', time: 1, cameraId: 'camera-b' },
      removeCutIds: ['duplicate'],
      replaced: true,
    }

    commitCameraCutUpsert(plan, {
      removeCut: (cutId) => events.push(`remove:${cutId}`),
      upsertCut: (cut) => events.push(`upsert:${cut.id}:${cut.cameraId}`),
      revealProgramOutput: () => events.push('view:program'),
    })

    expect(events).toEqual([
      'remove:duplicate',
      'upsert:winner:camera-b',
      'view:program',
    ])
  })

  it('frame-snaps a dragged cut and keeps its identity', () => {
    const plan = planCameraCutDrag({
      cuts: {
        draggable: {
          id: 'draggable',
          time: 1,
          cameraId: 'camera-b',
        },
      },
      cutId: 'draggable',
      time: 1.518,
      duration: 4,
      frameRate: 30,
    })

    expect(plan).toEqual({
      cut: {
        id: 'draggable',
        time: 1.5333333333333334,
        cameraId: 'camera-b',
      },
      removeCutIds: [],
      previewCuts: [
        {
          id: 'draggable',
          time: 1.5333333333333334,
          cameraId: 'camera-b',
        },
      ],
      changed: true,
    })
  })

  it('clamps dragged cuts to the first and last usable scene frames', () => {
    const cuts = {
      draggable: {
        id: 'draggable',
        time: 1,
        cameraId: 'camera-b',
      },
      legacyEnd: {
        id: 'legacyEnd',
        time: 4,
        cameraId: 'camera-a',
      },
    }

    expect(
      planCameraCutDrag({
        cuts,
        cutId: 'draggable',
        time: -20,
        duration: 4,
        frameRate: 30,
      })?.cut.time,
    ).toBe(0)
    expect(
      planCameraCutDrag({
        cuts,
        cutId: 'draggable',
        time: 20,
        duration: 4,
        frameRate: 30,
      })?.cut.time,
    ).toBe(119 / 30)
    expect(
      planCameraCutDrag({
        cuts,
        cutId: 'draggable',
        time: 1,
        duration: 4,
        frameRate: 30,
      })?.previewCuts.find((cut) => cut.id === 'legacyEnd')?.time,
    ).toBe(4)
  })

  it('lets the dragged cut win destination-frame conflicts deterministically', () => {
    const plan = planCameraCutDrag({
      cuts: {
        earlier: { id: 'earlier', time: 0.5, cameraId: 'camera-a' },
        draggable: {
          id: 'draggable',
          time: 1,
          cameraId: 'camera-b',
        },
        collisionZ: {
          id: 'collisionZ',
          time: 2.009,
          cameraId: 'camera-a',
        },
        collisionA: {
          id: 'collisionA',
          time: 2.001,
          cameraId: 'camera-c',
        },
        later: { id: 'later', time: 3, cameraId: 'camera-a' },
      },
      cutId: 'draggable',
      time: 2,
      duration: 4,
      frameRate: 30,
    })

    expect(plan?.removeCutIds).toEqual(['collisionA', 'collisionZ'])
    expect(plan?.previewCuts.map((cut) => [cut.id, cut.time])).toEqual([
      ['earlier', 0.5],
      ['draggable', 2],
      ['later', 3],
    ])
    expect(
      plan?.previewCuts.filter((cut) => cut.time === 2),
    ).toHaveLength(1)
  })

  it('does not create a drag plan for a stale cut id', () => {
    expect(
      planCameraCutDrag({
        cuts: {
          existing: {
            id: 'existing',
            time: 1,
            cameraId: 'camera-a',
          },
        },
        cutId: 'missing',
        time: 2,
        duration: 4,
        frameRate: 30,
      }),
    ).toBeNull()
  })

  it('builds program-camera spans in the keyframe timeline timebase', () => {
    const scene: CompositionScene = {
      id: 'scene',
      name: 'Scene',
      rootNodeId: 'root',
      duration: 4,
      cameraIds: ['camera-a', 'camera-b'],
      defaultCameraId: 'camera-a',
      cameraCuts: {
        first: { id: 'first', time: 1, cameraId: 'camera-b' },
        second: { id: 'second', time: 3, cameraId: 'camera-a' },
      },
    }

    expect(
      cameraProgramSegments({
        scene,
        frameRate: 30,
        cameras: [
          { id: 'camera-a', enabled: true },
          { id: 'camera-b', enabled: true },
        ],
      }),
    ).toEqual([
      {
        id: 'camera-program:default:0',
        cameraId: 'camera-a',
        start: 0,
        end: 1,
        sourceCutId: null,
      },
      {
        id: 'camera-program:first:1',
        cameraId: 'camera-b',
        start: 1,
        end: 3,
        sourceCutId: 'first',
      },
      {
        id: 'camera-program:second:3',
        cameraId: 'camera-a',
        start: 3,
        end: 4,
        sourceCutId: 'second',
      },
    ])
  })

  it('coalesces consecutive same-camera cuts into one readable span', () => {
    const scene: CompositionScene = {
      id: 'scene',
      name: 'Scene',
      rootNodeId: 'root',
      duration: 4,
      cameraIds: ['camera-a', 'camera-b'],
      defaultCameraId: 'camera-a',
      cameraCuts: {
        first: { id: 'first', time: 1, cameraId: 'camera-b' },
        redundant: {
          id: 'redundant',
          time: 2,
          cameraId: 'camera-b',
        },
        alsoRedundant: {
          id: 'alsoRedundant',
          time: 3,
          cameraId: 'camera-b',
        },
      },
    }

    expect(
      cameraProgramSegments({
        scene,
        frameRate: 30,
        cameras: [
          { id: 'camera-a', enabled: true },
          { id: 'camera-b', enabled: true },
        ],
      }),
    ).toEqual([
      {
        id: 'camera-program:default:0',
        cameraId: 'camera-a',
        start: 0,
        end: 1,
        sourceCutId: null,
      },
      {
        id: 'camera-program:first:1',
        cameraId: 'camera-b',
        start: 1,
        end: 4,
        sourceCutId: 'first',
      },
    ])
  })

  it('plans removal of same-camera no-ops and same-frame losers', () => {
    const scene: CompositionScene = {
      id: 'scene',
      name: 'Scene',
      rootNodeId: 'root',
      duration: 4,
      cameraIds: ['camera-a', 'camera-b'],
      defaultCameraId: 'camera-a',
      cameraCuts: {
        defaultNoOp: {
          id: 'defaultNoOp',
          time: 0.5,
          cameraId: 'camera-a',
        },
        switchToB: {
          id: 'switchToB',
          time: 1,
          cameraId: 'camera-b',
        },
        repeatedB: {
          id: 'repeatedB',
          time: 2,
          cameraId: 'camera-b',
        },
        sameFrameLoser: {
          id: 'sameFrameLoser',
          time: 3.001,
          cameraId: 'camera-b',
        },
        sameFrameWinner: {
          id: 'sameFrameWinner',
          time: 3.009,
          cameraId: 'camera-a',
        },
      },
    }

    expect(
      planRedundantCameraCutCleanup({
        scene,
        frameRate: 30,
        cameras: [
          { id: 'camera-a', enabled: true },
          { id: 'camera-b', enabled: true },
        ],
      }),
    ).toEqual({
      removeCutIds: [
        'defaultNoOp',
        'repeatedB',
        'sameFrameLoser',
      ],
      changed: true,
    })
  })

  it('turns an existing two-camera switch back into a removable cut', () => {
    const cameras = [
      { id: 'camera-a', enabled: true },
      { id: 'camera-b', enabled: true },
    ]
    const scene: CompositionScene = {
      id: 'scene',
      name: 'Scene',
      rootNodeId: 'root',
      duration: 4,
      cameraIds: ['camera-a', 'camera-b'],
      defaultCameraId: 'camera-a',
      cameraCuts: {
        switchToB: {
          id: 'switchToB',
          time: 1,
          cameraId: 'camera-b',
        },
      },
    }
    const targetCameraId = suggestCameraCutTarget({
      cameras,
      currentCameraId: 'camera-b',
    })
    const togglePlan = planCameraCutUpsert({
      cuts: scene.cameraCuts,
      playhead: 1,
      duration: scene.duration,
      frameRate: 30,
      cameraId: targetCameraId!,
      createId: () => 'unused',
    })
    const toggledScene = {
      ...scene,
      cameraCuts: {
        [togglePlan.cut.id]: togglePlan.cut,
      },
    }

    expect(targetCameraId).toBe('camera-a')
    expect(togglePlan).toEqual({
      cut: {
        id: 'switchToB',
        time: 1,
        cameraId: 'camera-a',
      },
      removeCutIds: [],
      replaced: true,
    })
    expect(
      planRedundantCameraCutCleanup({
        scene: toggledScene,
        frameRate: 30,
        cameras,
      }),
    ).toEqual({
      removeCutIds: ['switchToB'],
      changed: true,
    })
  })

  it('retains stale winning cuts as recoverable authoring intent', () => {
    const scene: CompositionScene = {
      id: 'scene',
      name: 'Scene',
      rootNodeId: 'root',
      duration: 4,
      cameraIds: ['camera-a', 'camera-b'],
      defaultCameraId: 'camera-a',
      cameraCuts: {
        disabled: {
          id: 'disabled',
          time: 1,
          cameraId: 'camera-b',
        },
      },
    }

    expect(
      planRedundantCameraCutCleanup({
        scene,
        frameRate: 30,
        cameras: [
          { id: 'camera-a', enabled: true },
          { id: 'camera-b', enabled: false },
        ],
      }),
    ).toEqual({
      removeCutIds: [],
      changed: false,
    })
  })

  it('uses render fallback rules instead of painting disabled cut targets', () => {
    const scene: CompositionScene = {
      id: 'scene',
      name: 'Scene',
      rootNodeId: 'root',
      duration: 4,
      cameraIds: ['camera-a', 'camera-b'],
      defaultCameraId: 'camera-a',
      cameraCuts: {
        disabled: { id: 'disabled', time: 1, cameraId: 'camera-b' },
      },
    }

    expect(
      cameraProgramSegments({
        scene,
        frameRate: 30,
        cameras: [
          { id: 'camera-a', enabled: true },
          { id: 'camera-b', enabled: false },
        ],
      }),
    ).toEqual([
      {
        id: 'camera-program:default:0',
        cameraId: 'camera-a',
        start: 0,
        end: 4,
        sourceCutId: null,
      },
    ])
  })
})
