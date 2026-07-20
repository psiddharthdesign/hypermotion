// SPDX-License-Identifier: Apache-2.0

import type {
  BlendMode,
  VectorDocument,
  VectorGeometry,
  VectorItem,
  VectorMatrix,
  VectorPaint,
  VectorStroke,
} from '@/scene/types'

export const IDENTITY_VECTOR_MATRIX: VectorMatrix = [1, 0, 0, 1, 0, 0]

export function emptyVectorGeometry(): VectorGeometry {
  return { points: {}, segments: {}, contours: [] }
}
export function emptyVectorDocument(): VectorDocument {
  return { version: 1, items: [] }
}

export function solidVectorPaint(
  color = '#000000',
  id = 'fill-1',
): VectorPaint {
  return {
    id,
    kind: 'solid',
    color,
    visible: true,
    opacity: 1,
    blendMode: 'normal',
  }
}

export function defaultVectorStroke(
  paint: VectorPaint = solidVectorPaint('#000000', 'stroke-paint-1'),
  id = 'stroke-1',
): VectorStroke {
  return {
    id,
    paint,
    width: 1,
    align: 'center',
    cap: 'butt',
    join: 'miter',
    miterLimit: 4,
    dash: [],
    dashOffset: 0,
    opacity: 1,
    visible: true,
  }
}

export interface CreateVectorItemOptions {
  id?: string
  name?: string
  geometry?: VectorGeometry
  fills?: VectorPaint[]
  strokes?: VectorStroke[]
  transform?: VectorMatrix
  opacity?: number
  blendMode?: BlendMode
  visible?: boolean
}

export function createVectorItem(options: CreateVectorItemOptions = {}): VectorItem {
  return {
    id: options.id ?? 'item-1',
    ...(options.name ? { name: options.name } : {}),
    geometry: options.geometry ?? emptyVectorGeometry(),
    fills: options.fills ?? [],
    strokes: options.strokes ?? [],
    transform: options.transform ?? [...IDENTITY_VECTOR_MATRIX],
    opacity: options.opacity ?? 1,
    blendMode: options.blendMode ?? 'normal',
    visible: options.visible ?? true,
  }
}
