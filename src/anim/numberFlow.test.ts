// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  formatNumberFlowValue,
  normalizeNumberFlowIncrementForTargets,
  numberFlowTextAtProgress,
  numberFlowVisualFrameAtProgress,
  parseNumberFlowText,
} from './numberFlow'

describe('parseNumberFlowText', () => {
  it('parses currency while preserving grouping and decimal precision', () => {
    expect(parseNumberFlowText('$1,234.50')).toEqual({
      value: 1234.5,
      prefix: '$',
      suffix: '',
      decimals: 2,
      useGrouping: true,
    })
  })

  it('preserves percent suffixes', () => {
    expect(parseNumberFlowText('87.5%')).toEqual({
      value: 87.5,
      prefix: '',
      suffix: '%',
      decimals: 1,
      useGrouping: false,
    })
  })

  it('preserves labels on both sides of the number', () => {
    expect(parseNumberFlowText('Revenue: $12,000.00 USD')).toEqual({
      value: 12000,
      prefix: 'Revenue: $',
      suffix: ' USD',
      decimals: 2,
      useGrouping: true,
    })
  })

  it('parses negative values as part of the numeric token', () => {
    expect(parseNumberFlowText('Balance: $-42.00')).toEqual({
      value: -42,
      prefix: 'Balance: $',
      suffix: '',
      decimals: 2,
      useGrouping: false,
    })
  })

  it.each([
    '',
    'No number here',
    'From 10 to 20',
    'Version 2.1 (build 7)',
    'Malformed 12,34',
    'Malformed 1.2.3',
  ])('rejects absent, multiple, or malformed numbers in %j', (text) => {
    expect(parseNumberFlowText(text)).toBeNull()
  })
})

describe('normalizeNumberFlowIncrementForTargets', () => {
  it('snaps typed increments to the visible precision', () => {
    expect(
      normalizeNumberFlowIncrementForTargets(0.25, [
        parseNumberFlowText('10.0'),
      ]),
    ).toBe(0.3)
  })

  it('uses the coarsest precision across a multi-layer selection', () => {
    expect(
      normalizeNumberFlowIncrementForTargets(0.25, [
        parseNumberFlowText('10.0'),
        parseNumberFlowText('10.00'),
      ]),
    ).toBe(0.3)
  })

  it('preserves Auto and representable decimal increments', () => {
    expect(
      normalizeNumberFlowIncrementForTargets(null, [
        parseNumberFlowText('10.00'),
      ]),
    ).toBeNull()
    expect(
      normalizeNumberFlowIncrementForTargets(0.25, [
        parseNumberFlowText('10.00'),
      ]),
    ).toBe(0.25)
  })
})

describe('formatNumberFlowValue', () => {
  it('uses deterministic grouping, decimals, and surrounding copy', () => {
    const format = parseNumberFlowText('Total: $1,234.50 USD')!
    expect(formatNumberFlowValue(98765.2, format)).toBe(
      'Total: $98,765.20 USD',
    )
  })

  it('does not introduce grouping when the authored number had none', () => {
    const format = parseNumberFlowText('1234 units')!
    expect(formatNumberFlowValue(5678, format)).toBe('5678 units')
  })

  it('never displays negative zero after rounding', () => {
    const format = parseNumberFlowText('$10.00')!
    expect(formatNumberFlowValue(-0, format)).toBe('$0.00')
    expect(formatNumberFlowValue(-0.004, format)).toBe('$0.00')
  })
})

describe('numberFlowTextAtProgress', () => {
  it('counts into the parsed target and preserves its exact endpoint', () => {
    const text = 'Revenue $1,200.00'
    expect(numberFlowTextAtProgress(text, 0, 'in', 0)).toBe('Revenue $0.00')
    expect(numberFlowTextAtProgress(text, 0, 'in', 0.5)).toBe(
      'Revenue $600.00',
    )
    expect(numberFlowTextAtProgress(text, 0, 'in', 1)).toBe(text)
  })

  it('counts out from the target to the authored from value', () => {
    const text = '75.0% complete'
    expect(numberFlowTextAtProgress(text, 25, 'out', 0)).toBe(text)
    expect(numberFlowTextAtProgress(text, 25, 'out', 0.5)).toBe(
      '50.0% complete',
    )
    expect(numberFlowTextAtProgress(text, 25, 'out', 1)).toBe(
      '25.0% complete',
    )
  })

  it('clamps progress before interpolating', () => {
    expect(numberFlowTextAtProgress('100', 0, 'in', -4)).toBe('0')
    expect(numberFlowTextAtProgress('100', 0, 'in', 8)).toBe('100')
    expect(numberFlowTextAtProgress('100', 0, 'out', -4)).toBe('100')
    expect(numberFlowTextAtProgress('100', 0, 'out', 8)).toBe('0')
  })

  it('leaves text without one unambiguous number unchanged', () => {
    expect(numberFlowTextAtProgress('From 10 to 20', 0, 'in', 0.5)).toBe(
      'From 10 to 20',
    )
  })

  it('avoids negative zero while crossing zero', () => {
    expect(numberFlowTextAtProgress('1.00', -1, 'in', 0.499)).toBe('0.00')
  })

  it('can switch directly without passing through intermediate values', () => {
    expect(numberFlowTextAtProgress('100', 0, 'in', 0.49, false)).toBe('0')
    expect(numberFlowTextAtProgress('100', 0, 'in', 0.5, false)).toBe('100')
  })
})

describe('numberFlowVisualFrameAtProgress', () => {
  it('resolves sharp authored endpoints', () => {
    const start = numberFlowVisualFrameAtProgress('$120.00', 0, 'in', 0)
    const end = numberFlowVisualFrameAtProgress('$120.00', 0, 'in', 1)
    expect(start).toMatchObject({
      outgoingText: '$0.00',
      outgoingOpacity: 1,
      incomingOpacity: 0,
      blurRadius: 0,
    })
    expect(end).toMatchObject({
      outgoingText: '$120.00',
      settledText: '$120.00',
      blurRadius: 0,
    })
  })

  it('rolls direct changes in the requested direction', () => {
    const up = numberFlowVisualFrameAtProgress('9', 0, 'in', 0.5, {
      continuous: false,
      trend: 'up',
      spinDistance: 1,
    })
    const down = numberFlowVisualFrameAtProgress('9', 0, 'in', 0.5, {
      continuous: false,
      trend: 'down',
      spinDistance: 1,
    })
    expect(up.outgoingOffsetEm).toBeLessThan(0)
    expect(up.incomingOffsetEm).toBeGreaterThan(0)
    expect(down.outgoingOffsetEm).toBeGreaterThan(0)
    expect(down.incomingOffsetEm).toBeLessThan(0)
  })

  it('uses the shortest displayed roll for the individual trend mode', () => {
    const frame = numberFlowVisualFrameAtProgress('19', 11, 'in', 0.5, {
      continuous: false,
      trend: 'individual',
      spinDistance: 1,
    })
    expect(frame.outgoingOffsetEm).toBeGreaterThan(0)
    expect(frame.incomingOffsetEm).toBeLessThan(0)
  })

  it('passes through adjacent formatted values in continuous mode', () => {
    const frame = numberFlowVisualFrameAtProgress('10.0%', 0, 'in', 0.255, {
      continuous: true,
      transformTimingRatio: 1,
    })
    expect(frame.outgoingText).toBe('2.5%')
    expect(frame.incomingText).toBe('2.6%')
    expect(frame.phase).toBeCloseTo(0.5)
  })

  it('counts by a custom increment instead of visiting every value', () => {
    const frame = numberFlowVisualFrameAtProgress('100', 0, 'in', 0.255, {
      continuous: true,
      increment: 10,
    })
    expect(frame.outgoingText).toBe('20')
    expect(frame.incomingText).toBe('30')
    expect(frame.phase).toBeCloseTo(0.55)
  })

  it('uses authored decimal units for custom increments', () => {
    const frame = numberFlowVisualFrameAtProgress('10.0', 0, 'in', 0.275, {
      continuous: true,
      increment: 0.5,
    })
    expect(frame.outgoingText).toBe('2.5')
    expect(frame.incomingText).toBe('3.0')
    expect(frame.phase).toBeCloseTo(0.5)
  })

  it('counts down by the same increment for exit animations', () => {
    const frame = numberFlowVisualFrameAtProgress('100', 0, 'out', 0.255, {
      continuous: true,
      increment: 10,
    })
    expect(frame.outgoingText).toBe('80')
    expect(frame.incomingText).toBe('70')
    expect(frame.phase).toBeCloseTo(0.55)
  })

  it('shortens the final interval and still lands on the exact target', () => {
    const finalInterval = numberFlowVisualFrameAtProgress(
      '25',
      0,
      'in',
      0.9,
      { continuous: true, increment: 10 },
    )
    expect(finalInterval.outgoingText).toBe('20')
    expect(finalInterval.incomingText).toBe('25')
    expect(finalInterval.phase).toBeCloseTo(0.7)

    const endpoint = numberFlowVisualFrameAtProgress(
      '25',
      0,
      'in',
      1.2,
      { continuous: true, increment: 10 },
      1,
    )
    expect(endpoint.outgoingText).toBe('25')
    expect(endpoint.settledText).toBe('25')
  })

  it('continues custom increments from the target during easing overshoot', () => {
    const frame = numberFlowVisualFrameAtProgress(
      '25',
      0,
      'in',
      1.2,
      { continuous: true, increment: 10 },
      0.8,
    )
    expect(frame.outgoingText).toBe('25')
    expect(frame.incomingText).toBe('35')
    expect(frame.phase).toBeCloseTo(0.6)
  })

  it('applies independent timing, fade, mask, travel, and blur controls', () => {
    const frame = numberFlowVisualFrameAtProgress('100', 0, 'in', 0.25, {
      continuous: false,
      transformTimingRatio: 0.5,
      spinTimingRatio: 0.5,
      opacityTimingRatio: 0.5,
      fadeAmount: 0.5,
      spinDistance: 1.5,
      maskHeight: 0.4,
      maskWidth: 0.6,
      blurRadius: 12,
    })
    expect(frame.phase).toBe(1)
    expect(frame.outgoingOffsetEm).toBe(-1.5)
    expect(frame.outgoingOpacity).toBe(0.5)
    expect(frame.incomingOpacity).toBe(1)
    expect(frame.maskHeightEm).toBe(0.4)
    expect(frame.maskWidthEm).toBe(0.6)
    expect(frame.blurRadius).toBeCloseTo(0)
  })

  it('clamps unsafe visual values', () => {
    const frame = numberFlowVisualFrameAtProgress('10', 0, 'in', 0.25, {
      continuous: false,
      spinDistance: 50,
      fadeAmount: -1,
      maskHeight: 5,
      maskWidth: 5,
      blurRadius: 200,
    })
    expect(Math.abs(frame.outgoingOffsetEm)).toBeLessThanOrEqual(2)
    expect(frame.outgoingOpacity).toBe(1)
    expect(frame.maskHeightEm).toBe(1)
    expect(frame.maskWidthEm).toBe(2)
    expect(frame.blurRadius).toBeLessThanOrEqual(32)
  })

  it('uses raw timeline position for endpoints while preserving easing overshoot', () => {
    const overshoot = numberFlowVisualFrameAtProgress(
      '100',
      0,
      'in',
      1.2,
      { continuous: true },
      0.25,
    )
    expect(overshoot.settledText).toBe('120')
    expect(overshoot.settledText).not.toBe('100')

    const endpoint = numberFlowVisualFrameAtProgress(
      '100',
      0,
      'in',
      1.2,
      { continuous: true },
      1,
    )
    expect(endpoint.settledText).toBe('100')
    expect(endpoint.outgoingText).toBe('100')
  })
})

describe('per-digit Number Flow frames', () => {
  it('keeps semantic token columns stable when grouping changes', () => {
    const start = numberFlowVisualFrameAtProgress(
      '$1,000.50 USD',
      999.5,
      'in',
      0,
      { continuous: false, digitMode: 'staggered' },
    )
    const middle = numberFlowVisualFrameAtProgress(
      '$1,000.50 USD',
      999.5,
      'in',
      0.5,
      { continuous: false, digitMode: 'staggered' },
    )
    const end = numberFlowVisualFrameAtProgress(
      '$1,000.50 USD',
      999.5,
      'in',
      1,
      { continuous: false, digitMode: 'staggered' },
    )

    const keys = middle.tokens.map((token) => token.key)
    expect(start.tokens.map((token) => token.key)).toEqual(keys)
    expect(end.tokens.map((token) => token.key)).toEqual(keys)
    expect(keys).toEqual([
      'prefix:0',
      'digit:integer:3',
      'separator:group:2',
      'digit:integer:2',
      'digit:integer:1',
      'digit:integer:0',
      'separator:decimal',
      'digit:fraction:0',
      'digit:fraction:1',
      'suffix:0',
      'suffix:1',
      'suffix:2',
      'suffix:3',
    ])

    const leadingDigit = middle.tokens.find(
      (token) => token.key === 'digit:integer:3',
    )!
    const group = middle.tokens.find(
      (token) => token.key === 'separator:group:2',
    )!
    expect(leadingDigit).toMatchObject({
      kind: 'digit',
      outgoingChar: '',
      incomingChar: '1',
    })
    expect(group).toMatchObject({
      kind: 'separator',
      outgoingChar: '',
      incomingChar: ',',
    })
    expect(
      middle.tokens
        .filter((token) => token.kind === 'prefix' || token.kind === 'suffix')
        .every((token) => !token.active && token.phase === 0),
    ).toBe(true)
  })

  it('stagger-rolls digits from left to right in forward order', () => {
    const frame = numberFlowVisualFrameAtProgress('123', 0, 'in', 0.3, {
      continuous: false,
      digitMode: 'staggered',
      digitOrder: 'forward',
      digitStagger: 0.6,
      spinTimingRatio: 1,
    })
    const digits = frame.tokens.filter((token) => token.kind === 'digit')
    expect(digits.map((token) => token.key)).toEqual([
      'digit:integer:2',
      'digit:integer:1',
      'digit:integer:0',
    ])
    expect(digits[0]!.phase).toBeCloseTo(0.75)
    expect(digits[1]!.phase).toBe(0)
    expect(digits[2]!.phase).toBe(0)
  })

  it('reverses only the timing order without changing display order', () => {
    const frame = numberFlowVisualFrameAtProgress('123', 0, 'in', 0.3, {
      continuous: false,
      digitMode: 'staggered',
      digitOrder: 'backward',
      digitStagger: 0.6,
      spinTimingRatio: 1,
    })
    const digits = frame.tokens.filter((token) => token.kind === 'digit')
    expect(digits.map((token) => token.key)).toEqual([
      'digit:integer:2',
      'digit:integer:1',
      'digit:integer:0',
    ])
    expect(digits[0]!.phase).toBe(0)
    expect(digits[1]!.phase).toBe(0)
    expect(digits[2]!.phase).toBeCloseTo(0.75)
  })

  it('keeps all digit phases together when stagger is disabled', () => {
    const frame = numberFlowVisualFrameAtProgress('123', 0, 'in', 0.3, {
      continuous: false,
      digitMode: 'together',
      digitStagger: 0.9,
      spinTimingRatio: 1,
    })
    const activeDigits = frame.tokens.filter(
      (token) => token.kind === 'digit' && token.active,
    )
    expect(activeDigits.map((token) => token.phase)).toEqual([0.3, 0.3, 0.3])
  })

  it('resolves shortest-roll direction independently for each digit', () => {
    const frame = numberFlowVisualFrameAtProgress('28', 11, 'in', 0.5, {
      continuous: false,
      digitMode: 'together',
      trend: 'individual',
      spinDistance: 1,
    })
    const tens = frame.tokens.find(
      (token) => token.key === 'digit:integer:1',
    )!
    const ones = frame.tokens.find(
      (token) => token.key === 'digit:integer:0',
    )!
    expect(tens.outgoingOffsetEm).toBeLessThan(0)
    expect(tens.incomingOffsetEm).toBeGreaterThan(0)
    expect(ones.outgoingOffsetEm).toBeGreaterThan(0)
    expect(ones.incomingOffsetEm).toBeLessThan(0)
  })

  it('retains count-by stepping while exposing changed digit columns', () => {
    const frame = numberFlowVisualFrameAtProgress('25', 0, 'in', 0.9, {
      continuous: true,
      increment: 10,
      digitMode: 'together',
      spinTimingRatio: 1,
    })
    expect(frame).toMatchObject({
      outgoingText: '20',
      incomingText: '25',
    })
    expect(frame.phase).toBeCloseTo(0.7)
    const tens = frame.tokens.find(
      (token) => token.key === 'digit:integer:1',
    )!
    const ones = frame.tokens.find(
      (token) => token.key === 'digit:integer:0',
    )!
    expect(tens).toMatchObject({
      outgoingChar: '2',
      incomingChar: '2',
      active: false,
    })
    expect(ones).toMatchObject({
      outgoingChar: '0',
      incomingChar: '5',
      active: true,
    })
    expect(ones.phase).toBeCloseTo(0.7)
  })

  it('uses raw timeline endpoints to settle every digit deterministically', () => {
    const atStart = numberFlowVisualFrameAtProgress(
      '321',
      0,
      'in',
      0.8,
      { digitMode: 'staggered', digitStagger: 0.8 },
      0,
    )
    const atEnd = numberFlowVisualFrameAtProgress(
      '321',
      0,
      'in',
      0.2,
      { digitMode: 'staggered', digitStagger: 0.8 },
      1,
    )
    expect(atStart.settledText).toBe('0')
    expect(atEnd.settledText).toBe('321')
    expect(atStart.tokens.every((token) => !token.active)).toBe(true)
    expect(atEnd.tokens.every((token) => !token.active)).toBe(true)
    expect(
      atEnd.tokens
        .filter((token) => token.kind === 'digit')
        .map((token) => token.outgoingChar)
        .join(''),
    ).toBe('321')
  })

  it('returns byte-for-byte identical token frames for the same seek', () => {
    const resolve = () =>
      numberFlowVisualFrameAtProgress('Revenue $12,345.67', 0, 'in', 0.437, {
        continuous: true,
        increment: 100,
        digitMode: 'staggered',
        digitOrder: 'backward',
        digitStagger: 0.45,
        trend: 'individual',
      })
    expect(resolve()).toEqual(resolve())
  })

  it('keeps endpoint token topology when easing overshoots a digit boundary', () => {
    const inRange = numberFlowVisualFrameAtProgress(
      '99',
      0,
      'in',
      0.5,
      { digitMode: 'staggered', continuous: true },
      0.5,
    )
    const overshoot = numberFlowVisualFrameAtProgress(
      '99',
      0,
      'in',
      1.2,
      { digitMode: 'staggered', continuous: true },
      0.5,
    )

    expect(overshoot.settledText).toBe('119')
    expect(overshoot.tokens.map((token) => token.key)).toEqual(
      inRange.tokens.map((token) => token.key),
    )
    expect(
      overshoot.tokens.filter((token) => token.kind === 'digit'),
    ).toHaveLength(2)
  })
})
