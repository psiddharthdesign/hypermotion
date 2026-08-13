// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import type { Appearance, NodeId } from '@/scene/types'
import {
  resolveDirectGpuExportEligibility,
  type DirectGpuExportEligibilityInput,
} from './directGpuExportEligibility'

const opaqueAppearance: Appearance = {
  opacity: 1,
  fill: { kind: 'solid', color: '#ffffff' },
  stroke: null,
  cornerRadius: 0,
  cornerRadii: { tl: 0, tr: 0, br: 0, bl: 0 },
  cornerSmoothing: 0.6,
  blendMode: 'normal',
  effects: [],
}

type TreeNode = ReturnType<DirectGpuExportEligibilityInput['getNode']>

function frame(
  appearance: Appearance = opaqueAppearance,
  children: NodeId[] = [],
): NonNullable<DirectGpuExportEligibilityInput['activeRoot']> {
  return {
    id: 'root',
    kind: 'frame',
    children,
    visible: true,
    appearance,
  }
}

function node(
  id: NodeId,
  kind: 'rect' | 'video' | 'shader',
  children: NodeId[] = [],
): NonNullable<TreeNode> {
  return { id, kind, children }
}

function input(
  patch: Partial<DirectGpuExportEligibilityInput> = {},
): DirectGpuExportEligibilityInput {
  const nodes = new Map<NodeId, NonNullable<TreeNode>>()
  return {
    format: 'mp4',
    sequenceLayerCount: 1,
    receipt: {
      backend: 'webgl',
      surface: { width: 1920, height: 1080 },
    },
    target: { width: 1920, height: 1080 },
    activeCamera: { kind: 'camera', background: null },
    activeRoot: frame(),
    getNode: (id) => nodes.get(id) ?? null,
    ...patch,
  }
}

function reason(patch: Partial<DirectGpuExportEligibilityInput>): string {
  return resolveDirectGpuExportEligibility(input(patch)).reason
}

function appearance(patch: Partial<Appearance>): Appearance {
  return { ...opaqueAppearance, ...patch }
}

describe('resolveDirectGpuExportEligibility', () => {
  it('accepts an opaque, single-layer MP4 frame on an exact WebGL surface', () => {
    expect(resolveDirectGpuExportEligibility(input())).toEqual({
      eligible: true,
      reason: 'eligible',
    })
  })

  it.each([
    ['format-not-mp4', { format: 'gif' }],
    ['sequence-layer-count', { sequenceLayerCount: 0 }],
    ['sequence-layer-count', { sequenceLayerCount: 2 }],
    ['missing-receipt', { receipt: null }],
    [
      'receipt-not-webgl',
      { receipt: { backend: 'dom', surface: { width: 1920, height: 1080 } } },
    ],
    ['missing-surface', { receipt: { backend: 'webgl', surface: null } }],
    [
      'surface-size-mismatch',
      { receipt: { backend: 'webgl', surface: { width: 3840, height: 2160 } } },
    ],
    ['missing-active-camera', { activeCamera: null }],
    [
      'camera-background',
      {
        activeCamera: {
          kind: 'camera' as const,
          background: { kind: 'solid' as const, color: '#000000' },
        },
      },
    ],
    ['missing-active-root', { activeRoot: null }],
  ] satisfies ReadonlyArray<
    readonly [string, Partial<DirectGpuExportEligibilityInput>]
  >)('rejects %s', (expected, patch) => {
    expect(reason(patch)).toBe(expected)
  })

  it('requires a visible frame root', () => {
    expect(
      reason({ activeRoot: { ...frame(), kind: 'rect' } }),
    ).toBe('active-root-not-frame')
    expect(reason({ activeRoot: { ...frame(), visible: false } })).toBe(
      'root-not-visible',
    )
  })

  it('requires an authored or animated fully opaque solid root fill', () => {
    expect(
      reason({ activeRoot: frame(appearance({ fill: null })) }),
    ).toBe('root-fill-not-solid')
    expect(
      reason({
        activeRoot: frame(
          appearance({
            fill: {
              kind: 'linear',
              angle: 0,
              stops: [
                { at: 0, color: '#000000' },
                { at: 1, color: '#ffffff' },
              ],
            },
          }),
        ),
      }),
    ).toBe('root-fill-not-solid')
    expect(
      reason({
        activeRoot: frame(
          appearance({ fill: { kind: 'solid', color: '#ffffff80' } }),
        ),
      }),
    ).toBe('root-fill-not-opaque')

    // The resolved animation value overrides the authored fill for this frame.
    expect(reason({ animatedSceneFillCss: 'linear-gradient(red, blue)' })).toBe(
      'root-fill-not-solid',
    )
    expect(reason({ animatedSceneFillCss: 'rgb(10 20 30 / 40%)' })).toBe(
      'root-fill-not-opaque',
    )
    expect(
      resolveDirectGpuExportEligibility(
        input({ animatedSceneFillCss: 'oklch(0.62 0.21 250 / 100%)' }),
      ),
    ).toEqual({ eligible: true, reason: 'eligible' })
  })

  it('rejects animated root compositing boundaries', () => {
    expect(reason({ rootHasVisualAnimation: true })).toBe(
      'root-visual-animation',
    )
  })

  it.each([
    ['root-opacity', appearance({ opacity: 0.999 })],
    ['root-corner-radius', appearance({ cornerRadius: 1 })],
    [
      'root-corner-radii',
      appearance({ cornerRadii: { tl: 0, tr: 0, br: 2, bl: 0 } }),
    ],
    [
      'root-stroke',
      appearance({
        stroke: {
          color: '#000000',
          width: 0,
          align: 'inside',
          style: 'solid',
          dashLength: 0,
          dashGap: 0,
        },
      }),
    ],
    [
      'root-effects',
      appearance({ effects: [{ kind: 'blur', amount: 0, visible: false }] }),
    ],
    ['root-blend-mode', appearance({ blendMode: 'multiply' })],
  ] satisfies ReadonlyArray<readonly [string, Appearance]>)(
    'rejects %s on the root appearance',
    (expected, rootAppearance) => {
      expect(reason({ activeRoot: frame(rootAppearance) })).toBe(expected)
    },
  )

  it.each([
    ['subtree-video', 'video'],
    ['subtree-shader', 'shader'],
  ] as const)(
    'rejects %s anywhere in the active-root subtree',
    (expected, kind) => {
      const nested = node('nested', 'rect', ['unsupported'])
      const unsupported = node('unsupported', kind)
      const nodes = new Map([
        [nested.id, nested],
        [unsupported.id, unsupported],
      ])
      expect(
        reason({
          activeRoot: frame(opaqueAppearance, ['nested']),
          getNode: (id) => nodes.get(id) ?? null,
        }),
      ).toBe(expected)
    },
  )

  it('rejects malformed child references instead of assuming a safe subtree', () => {
    expect(
      reason({
        activeRoot: frame(opaqueAppearance, ['missing']),
        getNode: () => null,
      }),
    ).toBe('subtree-node-missing')
  })
})
