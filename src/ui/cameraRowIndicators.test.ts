// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import type { CompositionScene } from '@/sequence'
import {
  planCameraRowProgramSwitch,
  resolveCameraRowIndicators,
} from '@/ui/cameraRowIndicators'
import { resolveProgramCameraPreviewId } from '@/ui/programCameraPreview'

const cameras = [
  { id: 'camera-1', enabled: true },
  { id: 'camera-2', enabled: true },
]

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
      time: 1,
      cameraId: 'camera-2',
    },
  },
}

describe('camera row indicators', () => {
  it('shows only the playhead-resolved Program camera as checked', () => {
    const programCameraId = resolveProgramCameraPreviewId({
      scene,
      localTime: 2,
      frameRate: 30,
      cameras,
      fallbackCameraId: 'camera-1',
      previewScope: 'scene',
      editorView: { mode: 'program' },
    })

    expect(
      resolveCameraRowIndicators(
        'camera-1',
        scene.defaultCameraId,
        programCameraId,
      ),
    ).toEqual({
      isDefault: true,
      isProgramNow: false,
    })
    expect(
      resolveCameraRowIndicators(
        'camera-2',
        scene.defaultCameraId,
        programCameraId,
      ),
    ).toEqual({
      isDefault: false,
      isProgramNow: true,
    })
  })

  it('authors Default → Camera 2 → Default → Camera 2 with row clicks', () => {
    const repeatedScene: CompositionScene = {
      ...scene,
      cameraCuts: {
        first: { id: 'first', time: 1, cameraId: 'camera-2' },
        repeated: {
          id: 'repeated',
          time: 2,
          cameraId: 'camera-2',
        },
        last: { id: 'last', time: 3, cameraId: 'camera-2' },
      },
    }

    const plan = planCameraRowProgramSwitch({
      scene: repeatedScene,
      playhead: 2,
      frameRate: 30,
      cameras,
      targetCameraId: 'camera-1',
      fallbackCameraId: 'camera-1',
      createId: () => 'new-cut',
    })

    expect(plan).toEqual({
      setDefaultCameraId: null,
      cut: {
        id: 'repeated',
        time: 2,
        cameraId: 'camera-1',
      },
      removeCutIds: [],
      changed: true,
    })
  })

  it('uses the scene default at frame zero and removes redundant cuts', () => {
    const zeroCutScene: CompositionScene = {
      ...scene,
      cameraCuts: {
        start: { id: 'start', time: 0, cameraId: 'camera-2' },
        repeated: {
          id: 'repeated',
          time: 1,
          cameraId: 'camera-2',
        },
      },
    }

    const plan = planCameraRowProgramSwitch({
      scene: zeroCutScene,
      playhead: 0,
      frameRate: 30,
      cameras,
      targetCameraId: 'camera-2',
      fallbackCameraId: 'camera-1',
      createId: () => 'unused',
    })

    expect(plan).toEqual({
      setDefaultCameraId: 'camera-2',
      cut: null,
      removeCutIds: ['start', 'repeated'],
      changed: true,
    })
  })

  it('does not create a cut when the chosen camera is already on Program', () => {
    const plan = planCameraRowProgramSwitch({
      scene,
      playhead: 2,
      frameRate: 30,
      cameras,
      targetCameraId: 'camera-2',
      fallbackCameraId: 'camera-1',
      createId: () => 'must-not-be-used',
    })

    expect(plan).toEqual({
      setDefaultCameraId: null,
      cut: null,
      removeCutIds: [],
      changed: false,
    })
  })

  it('removes a cut when switching that frame back to the entering camera', () => {
    const plan = planCameraRowProgramSwitch({
      scene,
      playhead: 1,
      frameRate: 30,
      cameras,
      targetCameraId: 'camera-1',
      fallbackCameraId: 'camera-1',
      createId: () => 'must-not-be-used',
    })

    expect(plan).toEqual({
      setDefaultCameraId: null,
      cut: null,
      removeCutIds: ['detail'],
      changed: true,
    })
  })

  it('ignores disabled or unowned camera targets', () => {
    expect(
      planCameraRowProgramSwitch({
        scene,
        playhead: 2,
        frameRate: 30,
        cameras: [
          cameras[0]!,
          { id: 'camera-2', enabled: false },
        ],
        targetCameraId: 'camera-2',
        fallbackCameraId: 'camera-1',
        createId: () => 'unused',
      }),
    ).toBeNull()
  })
})
