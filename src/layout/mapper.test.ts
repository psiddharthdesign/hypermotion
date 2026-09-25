// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest'
import type { Node as YogaNode, Yoga } from 'yoga-layout/load'
import type { Layout, Node, SizeAxis } from '@/scene'
import {
  applyChildLayoutForParent,
  applyNodeStyle,
  applySize,
  toYogaAlign,
  toYogaFlexDirection,
  toYogaJustify,
} from './mapper'

// The mapper reaches the scene barrel through textMeasure, and the
// barrel opens IndexedDB-backed persistence at import time. Node has no
// IndexedDB, so stub the singletons the barrel re-exports.
vi.mock('@/scene/internals', () => ({
  sceneDoc: null,
  apiReady: Promise.resolve(null),
  SceneContext: { Provider: null, Consumer: null },
}))

/**
 * Yoga enum stand-in. Values are unique strings so an assertion that
 * reads back a recorded call fails loudly when the mapper picks the
 * wrong constant, instead of silently matching another 0/1 enum.
 */
const yoga = {
  FLEX_DIRECTION_ROW: 'flex-direction-row',
  FLEX_DIRECTION_COLUMN: 'flex-direction-column',
  JUSTIFY_FLEX_START: 'justify-start',
  JUSTIFY_CENTER: 'justify-center',
  JUSTIFY_FLEX_END: 'justify-end',
  JUSTIFY_SPACE_BETWEEN: 'justify-space-between',
  JUSTIFY_SPACE_AROUND: 'justify-space-around',
  ALIGN_FLEX_START: 'align-start',
  ALIGN_CENTER: 'align-center',
  ALIGN_FLEX_END: 'align-end',
  ALIGN_STRETCH: 'align-stretch',
  ALIGN_BASELINE: 'align-baseline',
  EDGE_TOP: 'edge-top',
  EDGE_RIGHT: 'edge-right',
  EDGE_BOTTOM: 'edge-bottom',
  EDGE_LEFT: 'edge-left',
  GUTTER_ALL: 'gutter-all',
  GUTTER_ROW: 'gutter-row',
  GUTTER_COLUMN: 'gutter-column',
  WRAP_WRAP: 'wrap',
  WRAP_NO_WRAP: 'no-wrap',
  POSITION_TYPE_ABSOLUTE: 'position-absolute',
  MEASURE_MODE_UNDEFINED: 0,
  MEASURE_MODE_EXACTLY: 1,
  MEASURE_MODE_AT_MOST: 2,
} as unknown as Yoga

type Call = [method: string, ...args: unknown[]]

interface RecordingNode {
  node: YogaNode
  calls: Call[]
  argsFor(method: string): unknown[][]
}

const RECORDED_METHODS = [
  'setWidth',
  'setWidthAuto',
  'setHeight',
  'setHeightAuto',
  'setPadding',
  'setFlexDirection',
  'setJustifyContent',
  'setAlignItems',
  'setAlignContent',
  'setAlignSelf',
  'setGap',
  'setFlexWrap',
  'setFlexGrow',
  'setFlexShrink',
  'setFlexBasis',
  'setPosition',
  'setPositionType',
  'setMeasureFunc',
] as const

function recordingNode(): RecordingNode {
  const calls: Call[] = []
  const node: Record<string, unknown> = {}
  for (const method of RECORDED_METHODS) {
    node[method] = (...args: unknown[]) => {
      calls.push([method, ...args])
    }
  }
  return {
    node: node as unknown as YogaNode,
    calls,
    argsFor: (method) =>
      calls.filter((c) => c[0] === method).map((c) => c.slice(1)),
  }
}

function layout(overrides: Partial<Layout> = {}): Layout {
  return {
    mode: 'flex',
    direction: 'row',
    justify: 'start',
    align: 'start',
    gap: 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    wrap: false,
    columns: 2,
    rowGap: 0,
    columnGap: 0,
    ...overrides,
  }
}

function frameNode(size: { width: SizeAxis; height: SizeAxis }, l: Layout): Node {
  return { kind: 'frame', size, layout: l } as unknown as Node
}

describe('scene enum → yoga enum mapping', () => {
  it('maps flex direction', () => {
    expect(toYogaFlexDirection(yoga, 'row')).toBe(yoga.FLEX_DIRECTION_ROW)
    expect(toYogaFlexDirection(yoga, 'column')).toBe(yoga.FLEX_DIRECTION_COLUMN)
  })

  it('maps every justify value', () => {
    expect(toYogaJustify(yoga, 'start')).toBe(yoga.JUSTIFY_FLEX_START)
    expect(toYogaJustify(yoga, 'center')).toBe(yoga.JUSTIFY_CENTER)
    expect(toYogaJustify(yoga, 'end')).toBe(yoga.JUSTIFY_FLEX_END)
    expect(toYogaJustify(yoga, 'space-between')).toBe(yoga.JUSTIFY_SPACE_BETWEEN)
    expect(toYogaJustify(yoga, 'space-around')).toBe(yoga.JUSTIFY_SPACE_AROUND)
  })

  it('maps every align value', () => {
    expect(toYogaAlign(yoga, 'start')).toBe(yoga.ALIGN_FLEX_START)
    expect(toYogaAlign(yoga, 'center')).toBe(yoga.ALIGN_CENTER)
    expect(toYogaAlign(yoga, 'end')).toBe(yoga.ALIGN_FLEX_END)
    expect(toYogaAlign(yoga, 'stretch')).toBe(yoga.ALIGN_STRETCH)
    expect(toYogaAlign(yoga, 'baseline')).toBe(yoga.ALIGN_BASELINE)
  })
})

describe('size axis application', () => {
  it('maps hug to auto, fill to 100%, and numbers to pixels', () => {
    const rec = recordingNode()
    applySize(rec.node, 'width', 'hug')
    applySize(rec.node, 'width', 'fill')
    applySize(rec.node, 'width', 240)
    applySize(rec.node, 'height', 'hug')
    applySize(rec.node, 'height', 'fill')
    applySize(rec.node, 'height', 120)
    expect(rec.calls).toEqual([
      ['setWidthAuto'],
      ['setWidth', '100%'],
      ['setWidth', 240],
      ['setHeightAuto'],
      ['setHeight', '100%'],
      ['setHeight', 120],
    ])
  })
})

describe('container style application', () => {
  it('honors padding in every layout mode', () => {
    for (const mode of ['none', 'flex', 'grid'] as const) {
      const rec = recordingNode()
      applyNodeStyle(
        yoga,
        rec.node,
        frameNode(
          { width: 100, height: 100 },
          layout({ mode, padding: { top: 1, right: 2, bottom: 3, left: 4 } }),
        ),
      )
      expect(rec.argsFor('setPadding')).toEqual([
        [yoga.EDGE_TOP, 1],
        [yoga.EDGE_RIGHT, 2],
        [yoga.EDGE_BOTTOM, 3],
        [yoga.EDGE_LEFT, 4],
      ])
    }
  })

  it('applies flex direction, justify, align, gap, and wrap', () => {
    const rec = recordingNode()
    applyNodeStyle(
      yoga,
      rec.node,
      frameNode(
        { width: 'fill', height: 'hug' },
        layout({
          mode: 'flex',
          direction: 'column',
          justify: 'space-between',
          align: 'center',
          gap: 16,
          wrap: true,
        }),
      ),
    )
    expect(rec.argsFor('setWidth')).toEqual([['100%']])
    expect(rec.argsFor('setHeightAuto')).toEqual([[]])
    expect(rec.argsFor('setFlexDirection')).toEqual([[yoga.FLEX_DIRECTION_COLUMN]])
    expect(rec.argsFor('setJustifyContent')).toEqual([[yoga.JUSTIFY_SPACE_BETWEEN]])
    expect(rec.argsFor('setAlignItems')).toEqual([[yoga.ALIGN_CENTER]])
    expect(rec.argsFor('setGap')).toEqual([[yoga.GUTTER_ALL, 16]])
    expect(rec.argsFor('setFlexWrap')).toEqual([[yoga.WRAP_WRAP]])
  })

  it('models grid as a wrapping row with independent gutters', () => {
    const rec = recordingNode()
    applyNodeStyle(
      yoga,
      rec.node,
      frameNode(
        { width: 600, height: 400 },
        layout({ mode: 'grid', align: 'center', rowGap: 8, columnGap: 12 }),
      ),
    )
    expect(rec.argsFor('setFlexDirection')).toEqual([[yoga.FLEX_DIRECTION_ROW]])
    expect(rec.argsFor('setAlignItems')).toEqual([[yoga.ALIGN_CENTER]])
    expect(rec.argsFor('setAlignContent')).toEqual([[yoga.ALIGN_STRETCH]])
    expect(rec.argsFor('setFlexWrap')).toEqual([[yoga.WRAP_WRAP]])
    expect(rec.argsFor('setGap')).toEqual([
      [yoga.GUTTER_ROW, 8],
      [yoga.GUTTER_COLUMN, 12],
    ])
  })

  it('neutralizes flex rules for mode none', () => {
    const rec = recordingNode()
    applyNodeStyle(
      yoga,
      rec.node,
      frameNode(
        { width: 600, height: 400 },
        layout({ mode: 'none', direction: 'column', justify: 'center', align: 'center', gap: 24, wrap: true }),
      ),
    )
    expect(rec.argsFor('setFlexDirection')).toEqual([[yoga.FLEX_DIRECTION_ROW]])
    expect(rec.argsFor('setJustifyContent')).toEqual([[yoga.JUSTIFY_FLEX_START]])
    expect(rec.argsFor('setAlignItems')).toEqual([[yoga.ALIGN_FLEX_START]])
    expect(rec.argsFor('setGap')).toEqual([[yoga.GUTTER_ALL, 0]])
    expect(rec.argsFor('setFlexWrap')).toEqual([[yoga.WRAP_NO_WRAP]])
  })

  it('installs a measure function for text and vector leaves only', () => {
    const text = recordingNode()
    applyNodeStyle(yoga, text.node, {
      kind: 'text',
      text: 'Hello',
      fontFamily: 'Inter',
      fontSize: 16,
      fontWeight: 400,
      lineHeight: 1.4,
      letterSpacing: 0,
    } as unknown as Node)
    expect(text.argsFor('setMeasureFunc')).toHaveLength(1)

    const vector = recordingNode()
    applyNodeStyle(yoga, vector.node, {
      kind: 'vector',
      size: { width: 'hug', height: 'hug' },
      viewBox: { x: 0, y: 0, width: 24, height: 24 },
    } as unknown as Node)
    expect(vector.argsFor('setMeasureFunc')).toHaveLength(1)

    const rect = recordingNode()
    applyNodeStyle(yoga, rect.node, {
      kind: 'rect',
      size: { width: 10, height: 10 },
    } as unknown as Node)
    expect(rect.argsFor('setMeasureFunc')).toEqual([])
  })
})

describe('child rules driven by the parent layout mode', () => {
  it('pins children of a mode-none parent absolutely at the origin', () => {
    const rec = recordingNode()
    applyChildLayoutForParent(
      yoga,
      rec.node,
      layout({ mode: 'none' }),
      { width: 100, height: 100 },
      0,
      600,
    )
    expect(rec.argsFor('setPositionType')).toEqual([[yoga.POSITION_TYPE_ABSOLUTE]])
    expect(rec.argsFor('setPosition')).toEqual([
      [yoga.EDGE_LEFT, 0],
      [yoga.EDGE_TOP, 0],
    ])
  })

  it('spans fill axes of an absolutely positioned child with opposing edges', () => {
    const rec = recordingNode()
    applyChildLayoutForParent(
      yoga,
      rec.node,
      layout({ mode: 'none' }),
      { width: 'fill', height: 'fill' },
      0,
      600,
    )
    expect(rec.argsFor('setPosition')).toEqual([
      [yoga.EDGE_LEFT, 0],
      [yoga.EDGE_RIGHT, 0],
      [yoga.EDGE_TOP, 0],
      [yoga.EDGE_BOTTOM, 0],
    ])
    expect(rec.argsFor('setWidthAuto')).toEqual([[]])
    expect(rec.argsFor('setHeightAuto')).toEqual([[]])
  })

  it('treats an absolutely positioned child of a flex parent like a free child', () => {
    const rec = recordingNode()
    applyChildLayoutForParent(
      yoga,
      rec.node,
      layout({ mode: 'flex' }),
      { width: 'fill', height: 100 },
      0,
      600,
      'absolute',
    )
    expect(rec.argsFor('setPositionType')).toEqual([[yoga.POSITION_TYPE_ABSOLUTE]])
    expect(rec.argsFor('setFlexGrow')).toEqual([])
  })

  it('sizes grid children to the pixel cell width when the parent width is known', () => {
    const rec = recordingNode()
    applyChildLayoutForParent(
      yoga,
      rec.node,
      layout({ mode: 'grid', columns: 3, columnGap: 10 }),
      { width: 'fill', height: 'hug' },
      0,
      320,
    )
    // (320 - 2 gaps * 10) / 3 columns
    expect(rec.argsFor('setWidth')).toEqual([[100]])
    expect(rec.argsFor('setHeightAuto')).toEqual([[]])
  })

  it('falls back to a percentage cell width for hug / fill grid parents', () => {
    const rec = recordingNode()
    applyChildLayoutForParent(
      yoga,
      rec.node,
      layout({ mode: 'grid', columns: 4, columnGap: 10 }),
      { width: 'fill', height: 40 },
      0,
      null,
    )
    expect(rec.argsFor('setWidth')).toEqual([['25%']])
    expect(rec.argsFor('setHeight')).toEqual([[40]])
  })

  it('clamps the grid column count to at least one and keeps cells positive', () => {
    const rec = recordingNode()
    applyChildLayoutForParent(
      yoga,
      rec.node,
      layout({ mode: 'grid', columns: 0, columnGap: 0 }),
      { width: 'fill', height: 'hug' },
      0,
      500,
    )
    expect(rec.argsFor('setWidth')).toEqual([[500]])

    const tight = recordingNode()
    applyChildLayoutForParent(
      yoga,
      tight.node,
      layout({ mode: 'grid', columns: 2, columnGap: 400 }),
      { width: 'fill', height: 'hug' },
      0,
      100,
    )
    expect(tight.argsFor('setWidth')).toEqual([[1]])
  })

  it('stretches fill-height grid children across their row', () => {
    const rec = recordingNode()
    applyChildLayoutForParent(
      yoga,
      rec.node,
      layout({ mode: 'grid', columns: 2, columnGap: 0 }),
      { width: 'fill', height: 'fill' },
      0,
      200,
    )
    expect(rec.argsFor('setAlignSelf')).toEqual([[yoga.ALIGN_STRETCH]])
    expect(rec.argsFor('setHeightAuto')).toEqual([[]])
    expect(rec.argsFor('setHeight')).toEqual([])
  })

  it('turns main-axis fill into flex-grow with a zero basis', () => {
    const row = recordingNode()
    applyChildLayoutForParent(
      yoga,
      row.node,
      layout({ mode: 'flex', direction: 'row' }),
      { width: 'fill', height: 100 },
      0,
      600,
    )
    expect(row.argsFor('setFlexGrow')).toEqual([[1]])
    expect(row.argsFor('setFlexShrink')).toEqual([[1]])
    expect(row.argsFor('setFlexBasis')).toEqual([[0]])
    expect(row.argsFor('setAlignSelf')).toEqual([])

    const column = recordingNode()
    applyChildLayoutForParent(
      yoga,
      column.node,
      layout({ mode: 'flex', direction: 'column' }),
      { width: 100, height: 'fill' },
      0,
      600,
    )
    expect(column.argsFor('setFlexGrow')).toEqual([[1]])
    expect(column.argsFor('setFlexBasis')).toEqual([[0]])
  })

  it('turns cross-axis fill into align-self stretch on the auto axis', () => {
    const row = recordingNode()
    applyChildLayoutForParent(
      yoga,
      row.node,
      layout({ mode: 'flex', direction: 'row' }),
      { width: 120, height: 'fill' },
      0,
      600,
    )
    expect(row.argsFor('setAlignSelf')).toEqual([[yoga.ALIGN_STRETCH]])
    expect(row.argsFor('setHeightAuto')).toEqual([[]])
    expect(row.argsFor('setFlexGrow')).toEqual([])

    const column = recordingNode()
    applyChildLayoutForParent(
      yoga,
      column.node,
      layout({ mode: 'flex', direction: 'column' }),
      { width: 'fill', height: 120 },
      0,
      600,
    )
    expect(column.argsFor('setAlignSelf')).toEqual([[yoga.ALIGN_STRETCH]])
    expect(column.argsFor('setWidthAuto')).toEqual([[]])
  })

  it('leaves hug / fixed children of a flex parent untouched', () => {
    const rec = recordingNode()
    applyChildLayoutForParent(
      yoga,
      rec.node,
      layout({ mode: 'flex', direction: 'row' }),
      { width: 'hug', height: 40 },
      0,
      600,
    )
    expect(rec.calls).toEqual([])
  })

  it('ignores flow children with no declared size', () => {
    const rec = recordingNode()
    applyChildLayoutForParent(yoga, rec.node, layout({ mode: 'grid' }), null, 0, 600)
    applyChildLayoutForParent(yoga, rec.node, layout({ mode: 'flex' }), null, 0, 600)
    expect(rec.calls).toEqual([])
  })
})
