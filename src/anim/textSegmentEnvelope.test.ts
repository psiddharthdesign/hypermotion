// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  textSegmentEnvelopeProgress,
  textSegmentLinearProgress,
  textSegmentStartOffset,
} from './textSegmentEnvelope'
import {
  normalizeTextStaggerCurve,
  textStaggerCurveForPreset,
} from './textStaggerCurve'

function curve(smoothing: 'none' | 'soft' | 'smooth') {
  return Array.from({ length: 5 }, (_, index) =>
    textSegmentEnvelopeProgress(0.2, 0.4, 0.1, index, 5, smoothing),
  )
}

function quadraticProfile() {
  return normalizeTextStaggerCurve({
    version: 1,
    points: [
      {
        id: 'start',
        x: 0,
        y: 0,
        inX: 0,
        inY: 0,
        outX: 1 / 3,
        outY: 0,
      },
      {
        id: 'end',
        x: 1,
        y: 1,
        inX: 2 / 3,
        inY: 1 / 3,
        outX: 1,
        outY: 1,
      },
    ],
  })!
}

function longStripProfile() {
  return normalizeTextStaggerCurve({
    version: 1,
    points: [
      {
        id: 'start',
        x: 0,
        y: 0,
        outX: 1 / 6,
        outY: 1 / 15,
      },
      {
        id: 'middle',
        x: 0.5,
        y: 0.2,
        inX: 1 / 3,
        inY: 2 / 15,
        outX: 2 / 3,
        outY: 7 / 15,
      },
      {
        id: 'end',
        x: 1,
        y: 1,
        inX: 5 / 6,
        inY: 11 / 15,
      },
    ],
  })!
}

describe('text segment progression envelope', () => {
  it('preserves the original linear stagger when smoothing is off', () => {
    expect(curve('none')).toEqual([0.5, 0.25, 0, 0, 0])
    expect(textSegmentLinearProgress(0.2, 0.4, 0.1, 1, 5)).toBe(0.25)
  })

  it('forms a soft progressive curve across neighbouring segments', () => {
    expect(curve('soft')).toEqual([0.4375, 0.25, 0.0625, 0, 0])
  })

  it('widens the progressive curve in smooth mode', () => {
    expect(curve('smooth')).toEqual([
      0.40625,
      0.25,
      0.09375,
      0.015625,
      0,
    ])
  })

  it('keeps every segment on the exact animation endpoints', () => {
    for (const smoothing of ['none', 'soft', 'smooth'] as const) {
      expect(
        Array.from({ length: 5 }, (_, index) =>
          textSegmentEnvelopeProgress(0, 0.4, 0.1, index, 5, smoothing),
        ),
      ).toEqual([0, 0, 0, 0, 0])
      expect(
        Array.from({ length: 5 }, (_, index) =>
          textSegmentEnvelopeProgress(0.8, 0.4, 0.1, index, 5, smoothing),
        ),
      ).toEqual([1, 1, 1, 1, 1])
    }
  })

  it('is a no-op without a stagger and handles malformed inputs', () => {
    expect(textSegmentEnvelopeProgress(0.2, 0.4, 0, 4, 5, 'smooth')).toBe(
      0.5,
    )
    expect(
      textSegmentEnvelopeProgress(Number.NaN, 0, -1, 99, 0, 'smooth'),
    ).toBe(0)
  })

  it('mirrors cleanly when the caller reverses segment order', () => {
    const forward = curve('smooth')
    const backward = Array.from({ length: 5 }, (_, physicalIndex) =>
      textSegmentEnvelopeProgress(
        0.2,
        0.4,
        0.1,
        4 - physicalIndex,
        5,
        'smooth',
      ),
    )
    expect(backward).toEqual([...forward].reverse())
  })

  it('keeps linear start offsets while the manual profile shapes each glyph', () => {
    const squared = quadraticProfile()
    Array.from({ length: 5 }, (_, index) =>
      textSegmentStartOffset(0.1, index, 5),
    ).forEach((offset, index) =>
      expect(offset).toBeCloseTo(index * 0.1, 10),
    )
    const samples = Array.from({ length: 5 }, (_, index) =>
      textSegmentEnvelopeProgress(
        0.2,
        1,
        0.1,
        index,
        5,
        'none',
        squared,
      ),
    )
    ;[0.04, 0.01, 0, 0, 0].forEach((value, index) =>
      expect(samples[index]).toBeCloseTo(value, 10),
    )
  })

  it('moves one unchanged paper-strip profile forward per delay', () => {
    const profile = longStripProfile()
    const atOneSecond = Array.from({ length: 8 }, (_, index) =>
      textSegmentEnvelopeProgress(1, 1, 0.1, index, 8, 'none', profile),
    )
    const oneDelayLater = Array.from({ length: 8 }, (_, index) =>
      textSegmentEnvelopeProgress(1.1, 1, 0.1, index, 8, 'none', profile),
    )
    const expected = [1, 0.84, 0.68, 0.52, 0.36, 0.2, 0.16, 0.12]
    const expectedLater = [1, 1, 0.84, 0.68, 0.52, 0.36, 0.2, 0.16]
    atOneSecond.forEach((value, index) =>
      expect(value).toBeCloseTo(expected[index]!, 10),
    )
    oneDelayLater.forEach((value, index) =>
      expect(value).toBeCloseTo(expectedLater[index]!, 10),
    )
    for (let index = 1; index < oneDelayLater.length; index++) {
      expect(oneDelayLater[index]).toBeCloseTo(atOneSecond[index - 1]!, 8)
    }
    const offsets = atOneSecond.map((progress) => -400 * (1 - progress))
    const expectedOffsets = [
      0,
      -64,
      -128,
      -192,
      -256,
      -320,
      -336,
      -352,
    ]
    offsets.forEach((value, index) =>
      expect(value).toBeCloseTo(expectedOffsets[index]!, 8),
    )
  })

  it('optionally softens the custom profile after sampling it', () => {
    const profile = longStripProfile()
    const outputs = (['none', 'soft', 'smooth'] as const).map((smoothing) =>
      Array.from({ length: 8 }, (_, index) =>
        textSegmentEnvelopeProgress(
          1,
          1,
          0.1,
          index,
          8,
          smoothing,
          profile,
        ),
      ),
    )
    expect(outputs[1]).not.toEqual(outputs[0])
    expect(outputs[2]).not.toEqual(outputs[0])
    for (const output of outputs) {
      expect(output).toEqual([...output].sort((a, b) => b - a))
      output.forEach((value) => {
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(1)
      })
    }
  })

  it('keeps an identity custom profile identical to legacy progression', () => {
    const identity = textStaggerCurveForPreset('none')
    for (const smoothing of ['none', 'soft', 'smooth'] as const) {
      for (const elapsed of [0, 0.2, 0.55, 1.4]) {
        for (let index = 0; index < 6; index++) {
          expect(
            textSegmentEnvelopeProgress(
              elapsed,
              0.8,
              0.12,
              index,
              6,
              smoothing,
              identity,
            ),
          ).toBeCloseTo(
            textSegmentEnvelopeProgress(
              elapsed,
              0.8,
              0.12,
              index,
              6,
              smoothing,
            ),
            8,
          )
        }
      }
    }
  })

  it('mirrors the traveling profile when order is reversed', () => {
    const profile = longStripProfile()
    const forward = Array.from({ length: 8 }, (_, index) =>
      textSegmentEnvelopeProgress(1, 1, 0.1, index, 8, 'none', profile),
    )
    const backward = Array.from({ length: 8 }, (_, physicalIndex) =>
      textSegmentEnvelopeProgress(
        1,
        1,
        0.1,
        7 - physicalIndex,
        8,
        'none',
        profile,
      ),
    )
    expect(backward).toEqual([...forward].reverse())
  })

  it('stays monotonic across segment order and over time', () => {
    for (const smoothing of ['none', 'soft', 'smooth'] as const) {
      const earlier = Array.from({ length: 5 }, (_, index) =>
        textSegmentEnvelopeProgress(0.2, 0.4, 0.1, index, 5, smoothing),
      )
      const later = Array.from({ length: 5 }, (_, index) =>
        textSegmentEnvelopeProgress(0.3, 0.4, 0.1, index, 5, smoothing),
      )
      expect(earlier).toEqual([...earlier].sort((a, b) => b - a))
      later.forEach((value, index) => expect(value).toBeGreaterThanOrEqual(earlier[index]!))
    }
  })
})
