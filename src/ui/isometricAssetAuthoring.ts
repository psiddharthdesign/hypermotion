// SPDX-License-Identifier: Apache-2.0

import type { Appearance, Layout, NodeId, Transform } from '@/scene/types'
import type { SceneAPI } from '@/scene/doc'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'

export type IsometricAssetKind = 'block' | 'platform' | 'server'

export const ISOMETRIC_ASSETS: ReadonlyArray<{ id: IsometricAssetKind; name: string; description: string }> = [
  { id: 'block', name: 'Block', description: 'An editable solid block.' },
  { id: 'platform', name: 'Platform', description: 'A circular base with editable depth.' },
  { id: 'server', name: 'Server stack', description: 'Four editable server modules with front details.' },
]

const PALETTE = { top: '#DCEEFF', side: '#3787EF', ink: '#164A80', blue: '#0969D9', slot: '#123553', light: '#6AC4FF' }

function transform(patch: Partial<Transform> = {}): Transform {
  return { x: 0, y: 0, z: 0, rotation: 0, rotationX: 0, rotationY: 0, scaleX: 1, scaleY: 1, renderMode: 'plane', ...patch }
}

function appearance(color: string | null, outlined = false): Appearance {
  return {
    opacity: 1,
    fill: color ? { kind: 'solid', color } : null,
    stroke: outlined ? { color: PALETTE.ink, width: 1.5, align: 'inside', style: 'solid', dashLength: 0, dashGap: 0 } : null,
    cornerRadius: 0,
    cornerSmoothing: 0,
    blendMode: 'normal',
    effects: [],
  }
}

function layout(mode: 'none' | 'flex', gap = 0): Layout {
  return { mode, direction: 'column', justify: 'start', align: 'start', gap, padding: { top: 0, right: 0, bottom: 0, left: 0 }, wrap: false, columns: 1, rowGap: 0, columnGap: 0 }
}

/**
 * All parts remain ordinary layers: fills, size, extrusion, transforms, and
 * keyframes can be edited independently. Insertion never changes the camera,
 * replaces the composition, or flattens a template into an image.
 */
export function createIsometricAsset(
  api: SceneAPI,
  kind: IsometricAssetKind,
  options: { parentId?: NodeId; center?: { x: number; y: number } } = {},
): NodeId {
  const definition = ISOMETRIC_ASSETS.find((asset) => asset.id === kind)
  if (!definition) throw new Error('Choose a supported isometric asset.')
  const parentId = options.parentId ?? api.getRoot()
  const parent = api.getNode(parentId)
  if (!parent || (parent.kind !== 'frame' && parent.kind !== 'component') || parent.locked) {
    throw new Error('Choose an unlocked frame for the asset.')
  }
  const width = 160
  const height = kind === 'server' ? 200 : 160
  const canvas = api.getMeta().canvas
  const center = options.center ?? {
    x: (typeof parent.size.width === 'number' ? parent.size.width : canvas.width) / 2,
    y: (typeof parent.size.height === 'number' ? parent.size.height : canvas.height) / 2,
  }
  if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) throw new Error('Asset position must be finite.')

  let rootId = ''
  api.doc.transact(() => {
    rootId = api.createNode('frame', parentId, {
      name: definition.name,
      size: { width, height },
      layout: layout(kind === 'server' ? 'flex' : 'none', 8),
      appearance: appearance(null),
      clipsContent: false,
      position: 'absolute',
      // A server's auto-layout column stands upright: local +Y becomes
      // world -Z (height), while its extrusion becomes the ground footprint.
      transform: transform({
        x: center.x - width / 2,
        y: center.y - height / 2 - (kind === 'server' ? 48 : 0),
        z: kind === 'server' ? -height / 2 : 0,
        rotationX: kind === 'server' ? -90 : 0,
        renderMode: 'group3d',
      }),
    })
    if (kind === 'block' || kind === 'platform') {
      api.createNode(kind === 'platform' ? 'ellipse' : 'rect', rootId, {
        name: kind === 'platform' ? 'Platform body' : 'Block body',
        size: { width, height },
        appearance: appearance(PALETTE.top, true),
        transform: transform({ z: kind === 'platform' ? -24 : -96 }),
        extrusion: { depth: kind === 'platform' ? 24 : 96, sideColor: kind === 'platform' ? PALETTE.blue : PALETTE.side },
      })
      return
    }

    for (let index = 0; index < 4; index += 1) {
      const moduleId = api.createNode('frame', rootId, {
        name: `Server module ${index + 1}`,
        size: { width: 'fill', height: 44 },
        layout: layout('none'),
        appearance: appearance(null),
        clipsContent: false,
        transform: transform({ renderMode: 'group3d' }),
      })
      api.createNode('rect', moduleId, {
        name: 'Housing', size: { width, height: 44 },
        appearance: appearance(PALETTE.top, true), transform: transform(),
        extrusion: { depth: 96, sideColor: PALETTE.side },
      })
      api.createNode('rect', moduleId, {
        name: 'Drive bay', size: { width: 112, height: 20 },
        appearance: appearance(PALETTE.slot), transform: transform({ x: 12, y: 12, z: -0.5 }),
        extrusion: { depth: 0, sideColor: PALETTE.slot },
      })
      api.createNode('ellipse', moduleId, {
        name: 'Status light', size: { width: 8, height: 8 },
        appearance: appearance(PALETTE.light), transform: transform({ x: 136, y: 18, z: -0.5 }),
        extrusion: { depth: 0, sideColor: PALETTE.light },
      })
    }
  }, UNDOABLE_GESTURE_ORIGIN)
  return rootId
}
