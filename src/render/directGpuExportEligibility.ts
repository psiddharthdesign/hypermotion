// SPDX-License-Identifier: Apache-2.0

import type { Appearance, CameraNode, Node, NodeId } from '@/scene/types'

export type DirectGpuExportIneligibilityReason =
  | 'format-not-mp4'
  | 'sequence-layer-count'
  | 'missing-receipt'
  | 'receipt-not-webgl'
  | 'missing-surface'
  | 'surface-size-mismatch'
  | 'missing-active-camera'
  | 'camera-background'
  | 'missing-active-root'
  | 'active-root-not-frame'
  | 'root-not-visible'
  | 'root-opacity'
  | 'root-fill-not-solid'
  | 'root-fill-not-opaque'
  | 'root-corner-radius'
  | 'root-corner-radii'
  | 'root-stroke'
  | 'root-effects'
  | 'root-blend-mode'
  | 'root-visual-animation'
  | 'subtree-node-missing'
  | 'subtree-video'
  | 'subtree-shader'

export type DirectGpuExportEligibility =
  | { readonly eligible: true; readonly reason: 'eligible' }
  | {
      readonly eligible: false
      readonly reason: DirectGpuExportIneligibilityReason
    }

export interface DirectGpuSurface {
  /** Intrinsic drawing-buffer width, not its CSS width. */
  readonly width: number
  /** Intrinsic drawing-buffer height, not its CSS height. */
  readonly height: number
}

export interface DirectGpuFrameReceipt {
  readonly backend: string
  readonly surface: DirectGpuSurface | null
}

type DirectGpuRoot = Pick<
  Node,
  'id' | 'kind' | 'children' | 'visible' | 'appearance'
>
type DirectGpuSubtreeNode = Pick<Node, 'id' | 'kind' | 'children'>
type DirectGpuCamera = Pick<CameraNode, 'kind' | 'background'>

export interface DirectGpuExportEligibilityInput {
  readonly format: string
  readonly sequenceLayerCount: number
  readonly receipt: DirectGpuFrameReceipt | null
  readonly target: { readonly width: number; readonly height: number }
  readonly activeCamera: DirectGpuCamera | null
  readonly activeRoot: DirectGpuRoot | null
  /** Root-boundary animation is page compositing, not part of the 3D canvas. */
  readonly rootHasVisualAnimation?: boolean
  /** Resolve descendants of activeRoot. The root itself need not be included. */
  readonly getNode: (id: NodeId) => DirectGpuSubtreeNode | null
  /**
   * Current animated scene fill, when animation has resolved one. Undefined
   * means use the authored root fill; null means the current frame has no fill.
   */
  readonly animatedSceneFillCss?: string | null
}

const ELIGIBLE: DirectGpuExportEligibility = Object.freeze({
  eligible: true,
  reason: 'eligible',
})

function ineligible(
  reason: DirectGpuExportIneligibilityReason,
): DirectGpuExportEligibility {
  return { eligible: false, reason }
}

/**
 * Decide whether a rendered frame can bypass Electron capture and feed its
 * WebGL surface directly to the MP4 encoder without changing visible output.
 *
 * This deliberately rejects uncertain cases. The existing capture renderer is
 * the fidelity fallback, so a false negative costs performance while a false
 * positive can corrupt an export.
 */
export function resolveDirectGpuExportEligibility(
  input: DirectGpuExportEligibilityInput,
): DirectGpuExportEligibility {
  if (input.format !== 'mp4') return ineligible('format-not-mp4')
  if (input.sequenceLayerCount !== 1) {
    return ineligible('sequence-layer-count')
  }

  const receipt = input.receipt
  if (!receipt) return ineligible('missing-receipt')
  if (receipt.backend !== 'webgl') return ineligible('receipt-not-webgl')
  const surface = receipt.surface
  if (!surface) return ineligible('missing-surface')
  if (
    surface.width !== input.target.width ||
    surface.height !== input.target.height
  ) {
    return ineligible('surface-size-mismatch')
  }

  const camera = input.activeCamera
  if (!camera || camera.kind !== 'camera') {
    return ineligible('missing-active-camera')
  }
  if (camera.background !== null) return ineligible('camera-background')

  const root = input.activeRoot
  if (!root) return ineligible('missing-active-root')
  if (root.kind !== 'frame') return ineligible('active-root-not-frame')
  if (!root.visible) return ineligible('root-not-visible')

  const appearance = root.appearance
  if (appearance.opacity !== 1) return ineligible('root-opacity')

  const currentFill = classifyCurrentRootFill(
    appearance,
    input.animatedSceneFillCss,
  )
  if (currentFill === 'not-solid') return ineligible('root-fill-not-solid')
  if (currentFill === 'not-opaque') return ineligible('root-fill-not-opaque')

  if (appearance.cornerRadius !== 0) {
    return ineligible('root-corner-radius')
  }
  if (
    appearance.cornerRadii &&
    Object.values(appearance.cornerRadii).some((radius) => radius !== 0)
  ) {
    return ineligible('root-corner-radii')
  }
  if (appearance.stroke !== null) return ineligible('root-stroke')
  if (appearance.effects.length > 0) return ineligible('root-effects')
  if ((appearance.blendMode ?? 'normal') !== 'normal') {
    return ineligible('root-blend-mode')
  }
  if (input.rootHasVisualAnimation) {
    return ineligible('root-visual-animation')
  }

  const pending = [...root.children]
  const visited = new Set<NodeId>([root.id])
  while (pending.length > 0) {
    const nodeId = pending.pop()!
    if (visited.has(nodeId)) continue
    visited.add(nodeId)

    const node = input.getNode(nodeId)
    if (!node) return ineligible('subtree-node-missing')
    if (node.kind === 'video') return ineligible('subtree-video')
    if (node.kind === 'shader') return ineligible('subtree-shader')
    pending.push(...node.children)
  }

  return ELIGIBLE
}

type RootFillClassification = 'opaque-solid' | 'not-solid' | 'not-opaque'

const OPAQUE_NAMED_COLORS = new Set([
  'aqua',
  'black',
  'blue',
  'fuchsia',
  'gray',
  'green',
  'lime',
  'maroon',
  'navy',
  'olive',
  'orange',
  'purple',
  'red',
  'silver',
  'teal',
  'white',
  'yellow',
])

function classifyCurrentRootFill(
  appearance: Appearance,
  animatedSceneFillCss: string | null | undefined,
): RootFillClassification {
  if (animatedSceneFillCss !== undefined) {
    return classifyCssColor(animatedSceneFillCss)
  }
  if (appearance.fill?.kind !== 'solid') return 'not-solid'
  return classifyCssColor(appearance.fill.color)
}

/**
 * Conservative opacity check for the color forms authored by Hyper Motion.
 * Dynamic CSS and paint functions are rejected because their final alpha
 * cannot be proven without browser style resolution.
 */
function classifyCssColor(css: string | null): RootFillClassification {
  if (css === null) return 'not-solid'
  const value = css.trim().toLowerCase()
  if (!value) return 'not-solid'
  if (
    value.includes('gradient(') ||
    value.startsWith('url(') ||
    value.includes('var(') ||
    value.includes('env(') ||
    value.includes('color-mix(')
  ) {
    return 'not-solid'
  }
  if (value === 'transparent') return 'not-opaque'
  if (
    value === 'currentcolor' ||
    value === 'inherit' ||
    value === 'initial' ||
    value === 'unset' ||
    value === 'revert' ||
    value === 'revert-layer'
  ) {
    return 'not-solid'
  }

  const hex = value.match(/^#([0-9a-f]+)$/)?.[1]
  if (hex) {
    if (hex.length === 3 || hex.length === 6) return 'opaque-solid'
    if (hex.length === 4) {
      return hex[3] === 'f' ? 'opaque-solid' : 'not-opaque'
    }
    if (hex.length === 8) {
      return hex.slice(6) === 'ff' ? 'opaque-solid' : 'not-opaque'
    }
    return 'not-solid'
  }

  // App-authored colors normally use hex/oklch. Keep the unambiguous named
  // legacy colors without assuming that every alphabetic string is valid CSS.
  if (OPAQUE_NAMED_COLORS.has(value)) return 'opaque-solid'

  const functionMatch = value.match(
    /^(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\((.*)\)$/s,
  )
  if (!functionMatch) return 'not-solid'
  const body = functionMatch[2].trim()
  if (!body || /\b(?:var|env|calc|none)\s*\(/.test(body)) return 'not-solid'

  const slash = body.lastIndexOf('/')
  if (slash >= 0) {
    const alpha = parseCssAlpha(body.slice(slash + 1))
    if (alpha === null) return 'not-solid'
    return alpha >= 1 ? 'opaque-solid' : 'not-opaque'
  }

  if (functionMatch[1] === 'rgba' || functionMatch[1] === 'hsla') {
    const parts = body.split(',')
    if (parts.length === 4) {
      const alpha = parseCssAlpha(parts[3])
      if (alpha === null) return 'not-solid'
      return alpha >= 1 ? 'opaque-solid' : 'not-opaque'
    }
  }

  return 'opaque-solid'
}

function parseCssAlpha(token: string): number | null {
  const value = token.trim()
  const percentage = value.match(/^([+-]?(?:\d+\.?\d*|\.\d+))%$/)
  if (percentage) {
    const numeric = Number(percentage[1])
    return Number.isFinite(numeric) ? numeric / 100 : null
  }
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(value)) return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}
