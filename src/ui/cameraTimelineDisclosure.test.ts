// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  resolveCameraTimelineDisclosures,
  shouldShowHostedCameraTimelineRelationship,
  toggleCameraTimelineDisclosure,
} from '@/ui/cameraTimelineDisclosure'

describe('camera timeline disclosure', () => {
  it('keeps every camera visible while marking only the active camera', () => {
    expect(
      resolveCameraTimelineDisclosures({
        cameraIds: ['default', 'camera-2', 'camera-3'],
        activeCameraId: 'camera-2',
        collapsedCameraIds: new Set(),
      }),
    ).toEqual([
      { cameraId: 'default', active: false, collapsed: false },
      { cameraId: 'camera-2', active: true, collapsed: false },
      { cameraId: 'camera-3', active: false, collapsed: false },
    ])
  })

  it('keeps collapse independent from Program changes', () => {
    const collapsed = new Set(['camera-2'])

    expect(
      resolveCameraTimelineDisclosures({
        cameraIds: ['default', 'camera-2'],
        activeCameraId: 'default',
        collapsedCameraIds: collapsed,
      }),
    ).toEqual([
      { cameraId: 'default', active: true, collapsed: false },
      { cameraId: 'camera-2', active: false, collapsed: true },
    ])

    expect(
      resolveCameraTimelineDisclosures({
        cameraIds: ['default', 'camera-2'],
        activeCameraId: 'camera-2',
        collapsedCameraIds: collapsed,
      }),
    ).toEqual([
      { cameraId: 'default', active: false, collapsed: false },
      { cameraId: 'camera-2', active: true, collapsed: true },
    ])
  })

  it('toggles one camera without changing another and removes stale ids', () => {
    const live = ['default', 'camera-2']

    expect([
      ...toggleCameraTimelineDisclosure(
        live,
        new Set(['deleted-camera', 'camera-2']),
        'default',
      ),
    ]).toEqual(['camera-2', 'default'])

    expect([
      ...toggleCameraTimelineDisclosure(
        live,
        new Set(['deleted-camera', 'camera-2']),
        'camera-2',
      ),
    ]).toEqual([])
  })

  it('does not invent state for a camera that is no longer owned', () => {
    expect([
      ...toggleCameraTimelineDisclosure(
        ['default'],
        new Set(['deleted-camera']),
        'deleted-camera',
      ),
    ]).toEqual([])
  })

  it('keeps cross-layer groups visible when their host camera is collapsed', () => {
    expect(
      shouldShowHostedCameraTimelineRelationship({
        collapsed: true,
        cameraId: 'default',
        memberNodeIds: ['default', 'title'],
      }),
    ).toBe(true)
    expect(
      shouldShowHostedCameraTimelineRelationship({
        collapsed: true,
        cameraId: 'default',
        memberNodeIds: ['default', 'default'],
      }),
    ).toBe(false)
    expect(
      shouldShowHostedCameraTimelineRelationship({
        collapsed: false,
        cameraId: 'default',
        memberNodeIds: ['default'],
      }),
    ).toBe(true)
  })
})
