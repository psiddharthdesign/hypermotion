// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest'
import {
  commitScaleAxisEdit,
  previewScaleAxisEdit,
  resolveScaleAxisEdit,
  type ScalePair,
} from './scalePairEdit'

describe('linked Scale axis edits', () => {
  it('preserves the edit-start X:Y ratio when X changes', () => {
    const baseline = { scaleX: 2, scaleY: 0.5 }

    expect(resolveScaleAxisEdit(baseline, 'x', 3, true)).toEqual({
      scaleX: 3,
      scaleY: 0.75,
    })

    // A later update in the same edit still resolves from the original pair,
    // not from a rounded intermediate result.
    expect(resolveScaleAxisEdit(baseline, 'x', 4, true)).toEqual({
      scaleX: 4,
      scaleY: 1,
    })
  })

  it('preserves the edit-start X:Y ratio when Y changes', () => {
    const baseline = { scaleX: 1.5, scaleY: 0.5 }

    expect(resolveScaleAxisEdit(baseline, 'y', 1, true)).toEqual({
      scaleX: 3,
      scaleY: 1,
    })
  })

  it('keeps unlinked edits independent', () => {
    const baseline = { scaleX: 1.5, scaleY: 0.5 }

    expect(resolveScaleAxisEdit(baseline, 'x', 2, false)).toEqual({
      scaleX: 2,
      scaleY: 0.5,
    })
    expect(resolveScaleAxisEdit(baseline, 'y', 0.25, false)).toEqual({
      scaleX: 1.5,
      scaleY: 0.25,
    })
  })

  it('uses a finite 1:1 fallback when the edited axis starts at zero', () => {
    const fromPositiveFollower = resolveScaleAxisEdit(
      { scaleX: 0, scaleY: 2 },
      'x',
      0.5,
      true,
    )
    const fromNegativeFollower = resolveScaleAxisEdit(
      { scaleX: -2, scaleY: 0 },
      'y',
      0.5,
      true,
    )

    expect(fromPositiveFollower).toEqual({ scaleX: 0.5, scaleY: 0.5 })
    expect(fromNegativeFollower).toEqual({ scaleX: -0.5, scaleY: 0.5 })
    expect(Object.values(fromPositiveFollower).every(Number.isFinite)).toBe(
      true,
    )
    expect(Object.values(fromNegativeFollower).every(Number.isFinite)).toBe(
      true,
    )
  })

  it('uses one pair callback for a linked commit when provided', () => {
    const onCommitX = vi.fn()
    const onCommitY = vi.fn()
    const onCommitPair = vi.fn()

    const result = commitScaleAxisEdit({
      baseline: { scaleX: 2, scaleY: 1 },
      current: { scaleX: 2, scaleY: 1 },
      axis: 'x',
      next: 4,
      linked: true,
      onCommitX,
      onCommitY,
      onCommitPair,
    })

    expect(result).toEqual({ scaleX: 4, scaleY: 2 })
    expect(onCommitPair).toHaveBeenCalledOnce()
    expect(onCommitPair).toHaveBeenCalledWith({ scaleX: 4, scaleY: 2 })
    expect(onCommitX).not.toHaveBeenCalled()
    expect(onCommitY).not.toHaveBeenCalled()
  })

  it('falls back to the individual callbacks for existing call sites', () => {
    const onCommitX = vi.fn()
    const onCommitY = vi.fn()
    const baseline: ScalePair = { scaleX: 1, scaleY: 2 }

    commitScaleAxisEdit({
      baseline,
      current: baseline,
      axis: 'y',
      next: 4,
      linked: true,
      onCommitX,
      onCommitY,
    })

    expect(onCommitX).toHaveBeenCalledOnce()
    expect(onCommitX).toHaveBeenCalledWith(2)
    expect(onCommitY).toHaveBeenCalledOnce()
    expect(onCommitY).toHaveBeenCalledWith(4)
  })

  it('publishes linked scrub previews atomically when a pair writer exists', () => {
    const onPreviewX = vi.fn()
    const onPreviewY = vi.fn()
    const onPreviewPair = vi.fn()

    const result = previewScaleAxisEdit({
      baseline: { scaleX: 2, scaleY: 1 },
      current: { scaleX: 2, scaleY: 1 },
      axis: 'x',
      next: 3,
      linked: true,
      onPreviewX,
      onPreviewY,
      onPreviewPair,
    })

    expect(result).toEqual({ scaleX: 3, scaleY: 1.5 })
    expect(onPreviewPair).toHaveBeenCalledOnce()
    expect(onPreviewPair).toHaveBeenCalledWith({ scaleX: 3, scaleY: 1.5 })
    expect(onPreviewX).not.toHaveBeenCalled()
    expect(onPreviewY).not.toHaveBeenCalled()
  })

  it('publishes only changed axes when a pair preview writer is absent', () => {
    const onPreviewX = vi.fn()
    const onPreviewY = vi.fn()

    const unlinked = previewScaleAxisEdit({
      baseline: { scaleX: 1, scaleY: 2 },
      current: { scaleX: 1, scaleY: 2 },
      axis: 'x',
      next: 1.25,
      linked: false,
      onPreviewX,
      onPreviewY,
    })

    expect(unlinked).toEqual({ scaleX: 1.25, scaleY: 2 })
    expect(onPreviewX).toHaveBeenCalledOnce()
    expect(onPreviewX).toHaveBeenCalledWith(1.25)
    expect(onPreviewY).not.toHaveBeenCalled()
  })
})
