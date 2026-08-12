// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import type { VectorNode } from '@/scene'
import { shouldRenderPreservedVectorSource } from './vectorSource'

function node(): VectorNode {
  return {
    id: 'source-vector',
    kind: 'vector',
    name: 'Source vector',
    parent: null,
    children: [],
    transform: {
      x: 0,
      y: 0,
      z: 0,
      rotation: 0,
      rotationX: 0,
      rotationY: 0,
      scaleX: 1,
      scaleY: 1,
    },
    appearance: {
      opacity: 1,
      fill: null,
      stroke: null,
      cornerRadius: 0,
      effects: [],
    },
    visible: true,
    locked: false,
    position: 'absolute',
    zIndex: 0,
    isMask: false,
    size: { width: 100, height: 100 },
    viewBox: { x: 0, y: 0, width: 100, height: 100 },
    vector: { version: 1, items: [] },
    trimStart: 0,
    trimEnd: 1,
    trimOffset: 0,
    importFidelity: 'preserved',
    source: {
      provider: 'svg',
      originalSvg: '<svg xmlns="http://www.w3.org/2000/svg"/>',
    },
  }
}

describe('preserved vector source selection', () => {
  it('uses preserved source only for full-span preserved artwork', () => {
    const fixture = node()
    expect(
      shouldRenderPreservedVectorSource(fixture, {
        start: 0,
        end: 1,
        offset: 0.4,
      }),
    ).toBe(true)
    expect(
      shouldRenderPreservedVectorSource(fixture, {
        start: 0,
        end: 0.75,
        offset: 0,
      }),
    ).toBe(false)
    expect(
      shouldRenderPreservedVectorSource(
        { ...fixture, importFidelity: 'editable' },
        { start: 0, end: 1, offset: 0 },
      ),
    ).toBe(false)
  })
})
