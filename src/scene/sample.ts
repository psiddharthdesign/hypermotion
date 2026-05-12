// SPDX-License-Identifier: Apache-2.0

import type { SceneAPI } from '@/scene/doc'

/**
 * Seed a brand-new scene with a small auto-layout frame containing two
 * rects. Just enough to prove the round-trip is working end-to-end:
 * Y.Doc → API → Layers panel → IndexedDB.
 *
 * Layout intent: row direction, 16px gap, 24px padding, both children
 * are accent-colored rects. A follow-up keyframe on `layout.gap` will
 * eventually drive them apart, which is the canonical demo of
 * "animating a layout property rather than a coordinate".
 */
export function createSampleScene(api: SceneAPI): void {
  const root = api.createNode('frame', null, {
    name: 'Scene',
    size: { width: 640, height: 360 },
    layout: {
      mode: 'flex',
      direction: 'row',
      justify: 'center',
      align: 'center',
      gap: 16,
      padding: { top: 24, right: 24, bottom: 24, left: 24 },
      wrap: false,
      columns: 3,
      rowGap: 16,
      columnGap: 16,
    },
    appearance: {
      opacity: 1,
      fill: { kind: 'solid', color: 'oklch(0.20 0.006 280)' },
      stroke: null,
      cornerRadius: 12,
      effects: [],
    },
    clipsContent: true,
  })

  api.createNode('rect', root, {
    name: 'Card A',
    size: { width: 160, height: 200 },
    appearance: {
      opacity: 1,
      fill: { kind: 'solid', color: 'oklch(0.62 0.21 250)' },
      stroke: null,
      cornerRadius: 8,
      effects: [],
    },
  })

  api.createNode('rect', root, {
    name: 'Card B',
    size: { width: 160, height: 200 },
    appearance: {
      opacity: 1,
      fill: { kind: 'solid', color: 'oklch(0.55 0.18 280)' },
      stroke: null,
      cornerRadius: 8,
      effects: [],
    },
  })
}