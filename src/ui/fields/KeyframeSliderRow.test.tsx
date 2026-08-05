// SPDX-License-Identifier: Apache-2.0

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { KeyframeSliderRow } from './KeyframeSliderRow'
import {
  createSliderFrameQueue,
  hasBoundedSliderDomain,
  resolveSliderDomain,
  sliderFillPercent,
  sliderValueFromPointer,
} from './keyframeSlider'

describe('KeyframeSliderRow', () => {
  it('clamps its visual fill without changing the authored value', () => {
    expect(sliderFillPercent(-10, 0, 100)).toBe(0)
    expect(sliderFillPercent(25, 0, 100)).toBe(25)
    expect(sliderFillPercent(150, 0, 100)).toBe(100)
  })

  it('keeps slider, value, and keyframe in one stable order', () => {
    const html = renderToStaticMarkup(
      <KeyframeSliderRow
        label="Field of View"
        value={35}
        onCommit={() => undefined}
        min={1}
        max={175}
        suffix="°"
        keyframe={<button>Keyframe</button>}
      />,
    )

    expect(html).toContain('grid-cols-[minmax(0,1fr)_56px_28px]')
    expect(html).toContain('data-keyframe-slider-surface="1"')
    expect(html).toContain('data-keyframe-slider-ruler="1"')
    expect(html).toContain('data-visible="false"')
    expect(html).toContain('data-keyframe-slider-indicator="1"')
    expect(html).toContain('step="any"')
    expect(html.indexOf('Field of View slider')).toBeLessThan(
      html.indexOf('aria-label="Field of View"'),
    )
    expect(html.indexOf('aria-label="Field of View"')).toBeLessThan(
      html.indexOf('Keyframe'),
    )
  })

  it('uses the compact two-column slider grammar for a bounded static property', () => {
    const html = renderToStaticMarkup(
      <KeyframeSliderRow
        label="Frame rate"
        value={60}
        onCommit={() => undefined}
        min={1}
        max={240}
        suffix="FPS"
      />,
    )

    expect(html).toContain('grid-cols-[minmax(0,1fr)_63px]')
    expect(html).not.toContain('Keyframe')
    expect(html).toContain('Frame rate slider')
    expect(html).toContain('aria-label="Frame rate"')
  })

  it('uses the ordinary property input when either hard bound is missing', () => {
    const unbounded = renderToStaticMarkup(
      <KeyframeSliderRow
        label="Position X"
        value={500}
        onCommit={() => undefined}
        adaptiveSpan={1000}
        keyframe={<button>Keyframe</button>}
      />,
    )
    const oneSided = renderToStaticMarkup(
      <KeyframeSliderRow
        label="Width"
        value={960}
        onCommit={() => undefined}
        min={1}
        adaptiveSpan={1000}
        suffix="px"
      />,
    )

    expect(hasBoundedSliderDomain(undefined, undefined)).toBe(false)
    expect(hasBoundedSliderDomain(0, undefined)).toBe(false)
    expect(unbounded).toContain('data-inspector-row="1"')
    expect(unbounded).toContain('aria-label="Position X"')
    expect(unbounded).toContain('data-inspector-keyframe="1"')
    expect(unbounded).not.toContain('data-keyframe-slider-surface="1"')
    expect(oneSided).toContain('aria-label="Width"')
    expect(oneSided).not.toContain('Width slider')
  })

  it('supports a display-only range without capping the numeric value', () => {
    const html = renderToStaticMarkup(
      <KeyframeSliderRow
        label="Padding T"
        value={320}
        onCommit={() => undefined}
        min={0}
        sliderMin={0}
        sliderMax={256}
        suffix="px"
        keyframe={<button>Keyframe</button>}
      />,
    )

    expect(html).toContain('Padding T slider')
    expect(html).toMatch(
      /type="range"[^>]*min="0"[^>]*max="256"[^>]*value="256"/,
    )
    expect(html).toMatch(
      /type="text"[^>]*aria-label="Padding T"[^>]*value="320"/,
    )
    expect(html).toContain('Keyframe')
  })

  it('uses a zero-centered soft range for spatial transforms', () => {
    const html = renderToStaticMarkup(
      <KeyframeSliderRow
        label="Position X"
        value={1250}
        onCommit={() => undefined}
        sliderMin={-1000}
        sliderMax={1000}
        suffix="px"
        keyframe={<button>Keyframe</button>}
      />,
    )

    expect(html).toContain('Position X slider')
    expect(html).toMatch(
      /type="range"[^>]*min="-1000"[^>]*max="1000"[^>]*value="1000"/,
    )
    expect(html).toMatch(
      /type="text"[^>]*aria-label="Position X"[^>]*value="1250"/,
    )
  })

  it('keeps explicit property bounds fixed even with a legacy adaptive hint', () => {
    expect(hasBoundedSliderDomain(0, 100)).toBe(true)
    expect(
      resolveSliderDomain({
        value: 75,
        min: 0,
        max: 100,
        step: 1,
        adaptiveSpan: 20,
      }),
    ).toEqual({ min: 0, max: 100 })
    expect(sliderFillPercent(75, 0, 100)).toBe(75)
  })

  it('maps the complete label surface without snapping to the input step', () => {
    const geometry = {
      left: 100,
      width: 200,
      min: -100,
      max: 100,
    }

    expect(sliderValueFromPointer({ ...geometry, clientX: 100 })).toBe(-100)
    expect(sliderValueFromPointer({ ...geometry, clientX: 203 })).toBe(3)
    expect(sliderValueFromPointer({ ...geometry, clientX: 300 })).toBe(100)
  })

  it('clamps at both ends while retaining intermediate decimal positions', () => {
    const geometry = {
      left: 40,
      width: 100,
      min: 0,
      max: 1,
    }

    expect(sliderValueFromPointer({ ...geometry, clientX: -20 })).toBe(0)
    expect(sliderValueFromPointer({ ...geometry, clientX: 73 })).toBe(0.33)
    expect(sliderValueFromPointer({ ...geometry, clientX: 200 })).toBe(1)
  })

  it('stabilizes pointer precision without creating hard points', () => {
    expect(
      sliderValueFromPointer({
        clientX: 1,
        left: 0,
        width: 3,
        min: 0,
        max: 1,
      }),
    ).toBe(0.333333)
  })

  it('coalesces raw pointer packets to one latest display-frame value', () => {
    const callbacks = new Map<number, FrameRequestCallback>()
    let nextFrameId = 1
    const published: number[] = []
    const queue = createSliderFrameQueue(
      (value) => published.push(value),
      (callback) => {
        const frameId = nextFrameId
        nextFrameId += 1
        callbacks.set(frameId, callback)
        return frameId
      },
      (frameId) => {
        callbacks.delete(frameId)
      },
    )

    for (let packet = 1; packet <= 250; packet += 1) {
      queue.queue(packet / 10)
    }

    expect(published).toEqual([])
    expect(callbacks.size).toBe(1)
    const [frameId, callback] = callbacks.entries().next().value!
    callbacks.delete(frameId)
    callback(16)
    expect(published).toEqual([25])
  })

  it('flushes the latest packet on release and cancels stale frames', () => {
    const callbacks = new Map<number, FrameRequestCallback>()
    let nextFrameId = 1
    const published: number[] = []
    const queue = createSliderFrameQueue(
      (value) => published.push(value),
      (callback) => {
        const frameId = nextFrameId
        nextFrameId += 1
        callbacks.set(frameId, callback)
        return frameId
      },
      (frameId) => {
        callbacks.delete(frameId)
      },
    )

    queue.queue(10.125)
    queue.queue(10.875)

    expect(queue.flush()).toBe(10.875)
    expect(callbacks.size).toBe(0)
    expect(published).toEqual([10.875])

    queue.queue(22.5)
    queue.cancel()
    expect(queue.flush()).toBeNull()
    expect(callbacks.size).toBe(0)
    expect(published).toEqual([10.875])
  })
})
