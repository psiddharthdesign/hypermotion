// SPDX-License-Identifier: Apache-2.0

export type ScaleAxis = 'x' | 'y'

export interface ScalePair {
  scaleX: number
  scaleY: number
}

export interface ScalePairCommitters {
  onCommitX: (next: number) => void
  onCommitY: (next: number) => void
  /**
   * Prefer this callback when the owner can write both axes in one
   * transaction. The individual callbacks remain the backwards-compatible
   * fallback for existing call sites.
   */
  onCommitPair?: (next: ScalePair) => void
}

export interface ScalePairPreviewers {
  onPreviewX?: (next: number) => void
  onPreviewY?: (next: number) => void
  /**
   * Preferred when the owner can publish both transient axes in one update.
   * The complete pair is emitted for linked and unlinked gestures alike so a
   * single preview store can own the whole Scale interaction.
   */
  onPreviewPair?: (next: ScalePair) => void
}

const ZERO_EPSILON = 1e-8

/**
 * Resolve one Scale field edit against the values captured when that edit
 * began. Linked edits use the original X:Y ratio for their entire lifetime,
 * rather than recomputing from rounded intermediate values on every keypress.
 *
 * A zero driving axis has no defined ratio. In that case we use a finite 1:1
 * fallback (preserving the follower's sign) so moving away from zero never
 * produces Infinity or NaN.
 */
export function resolveScaleAxisEdit(
  baseline: ScalePair,
  axis: ScaleAxis,
  next: number,
  linked: boolean,
): ScalePair {
  if (!linked) {
    return axis === 'x'
      ? { ...baseline, scaleX: next }
      : { ...baseline, scaleY: next }
  }

  const driver = axis === 'x' ? baseline.scaleX : baseline.scaleY
  const follower = axis === 'x' ? baseline.scaleY : baseline.scaleX
  const ratio =
    Math.abs(driver) > ZERO_EPSILON
      ? follower / driver
      : follower < 0
        ? -1
        : 1
  const proportionalFollower = next * ratio
  const safeFollower = Number.isFinite(proportionalFollower)
    ? proportionalFollower
    : follower

  return axis === 'x'
    ? { scaleX: next, scaleY: safeFollower }
    : { scaleX: safeFollower, scaleY: next }
}

/**
 * Resolve and dispatch a Scale edit. When a pair callback is available a
 * linked change is emitted exactly once, allowing the caller to create one
 * undoable transaction and one paired keyframe update.
 */
export function commitScaleAxisEdit({
  baseline,
  current,
  axis,
  next,
  linked,
  onCommitX,
  onCommitY,
  onCommitPair,
}: {
  baseline: ScalePair
  current: ScalePair
  axis: ScaleAxis
  next: number
  linked: boolean
} & ScalePairCommitters): ScalePair {
  const nextPair = resolveScaleAxisEdit(baseline, axis, next, linked)
  const changedX = nextPair.scaleX !== current.scaleX
  const changedY = nextPair.scaleY !== current.scaleY

  if (!changedX && !changedY) return nextPair

  if (linked && onCommitPair) {
    onCommitPair(nextPair)
    return nextPair
  }

  if (changedX) onCommitX(nextPair.scaleX)
  if (changedY) onCommitY(nextPair.scaleY)
  return nextPair
}

/**
 * Resolve and publish a transient Scale gesture without creating a durable
 * edit. A pair preview is preferred when available; otherwise the changed
 * axes are delivered independently. Callers keep the returned pair as the
 * comparison point for the next hardware packet while retaining the original
 * gesture baseline for ratio resolution.
 */
export function previewScaleAxisEdit({
  baseline,
  current,
  axis,
  next,
  linked,
  onPreviewX,
  onPreviewY,
  onPreviewPair,
}: {
  baseline: ScalePair
  current: ScalePair
  axis: ScaleAxis
  next: number
  linked: boolean
} & ScalePairPreviewers): ScalePair {
  const nextPair = resolveScaleAxisEdit(baseline, axis, next, linked)
  const changedX = nextPair.scaleX !== current.scaleX
  const changedY = nextPair.scaleY !== current.scaleY

  if (!changedX && !changedY) return nextPair

  if (onPreviewPair) {
    onPreviewPair(nextPair)
    return nextPair
  }

  if (changedX) onPreviewX?.(nextPair.scaleX)
  if (changedY) onPreviewY?.(nextPair.scaleY)
  return nextPair
}
