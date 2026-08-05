// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { formatTimeSeconds, parseTimeExpression } from './timeExpression'

describe('parseTimeExpression', () => {
  it('treats bare integers and decimals as seconds', () => {
    expect(parseTimeExpression('10')).toBe(10)
    expect(parseTimeExpression('1.25')).toBe(1.25)
    expect(parseTimeExpression('.5')).toBe(0.5)
    expect(parseTimeExpression('10.')).toBe(10)
    expect(parseTimeExpression('+2.5')).toBe(2.5)
  })

  it('accepts seconds aliases', () => {
    expect(parseTimeExpression('10s')).toBe(10)
    expect(parseTimeExpression('10 sec')).toBe(10)
    expect(parseTimeExpression('10 secs')).toBe(10)
    expect(parseTimeExpression('10 second')).toBe(10)
    expect(parseTimeExpression('10 seconds')).toBe(10)
  })

  it('converts milliseconds aliases to seconds', () => {
    expect(parseTimeExpression('250ms')).toBe(0.25)
    expect(parseTimeExpression('500 msec')).toBe(0.5)
    expect(parseTimeExpression('1 millisecond')).toBe(0.001)
    expect(parseTimeExpression('10 milliseconds')).toBe(0.01)
  })

  it('converts minutes aliases to seconds', () => {
    expect(parseTimeExpression('2m')).toBe(120)
    expect(parseTimeExpression('1.5 min')).toBe(90)
    expect(parseTimeExpression('2 mins')).toBe(120)
    expect(parseTimeExpression('2 minute')).toBe(120)
    expect(parseTimeExpression('2 minutes')).toBe(120)
  })

  it('converts hours aliases to seconds', () => {
    expect(parseTimeExpression('1h')).toBe(3600)
    expect(parseTimeExpression('1.5 hr')).toBe(5400)
    expect(parseTimeExpression('2 hrs')).toBe(7200)
    expect(parseTimeExpression('1 hour')).toBe(3600)
    expect(parseTimeExpression('2 hours')).toBe(7200)
  })

  it('is whitespace and case tolerant', () => {
    expect(parseTimeExpression('  1.5   M  ')).toBe(90)
    expect(parseTimeExpression('\t2 HOURS\n')).toBe(7200)
    expect(parseTimeExpression(' 10 SeCoNdS ')).toBe(10)
  })

  it('allows zero but rejects negative and non-finite values', () => {
    expect(parseTimeExpression('0')).toBe(0)
    expect(parseTimeExpression('0h')).toBe(0)
    expect(parseTimeExpression('-1')).toBeNull()
    expect(parseTimeExpression('-0.5m')).toBeNull()
    expect(parseTimeExpression('Infinity')).toBeNull()
    expect(parseTimeExpression('NaN')).toBeNull()
    expect(parseTimeExpression(`${'9'.repeat(400)}h`)).toBeNull()
  })

  it.each([
    '',
    ' ',
    '.',
    '+',
    '1..2s',
    '1.2.3',
    '1e3',
    '2sm',
    '1h 30m',
    'ten seconds',
    '2 minutes extra',
  ])('rejects malformed input %j', (input) => {
    expect(parseTimeExpression(input)).toBeNull()
  })
})

describe('formatTimeSeconds', () => {
  it('formats canonical seconds without fixed decimal padding', () => {
    expect(formatTimeSeconds(10)).toBe('10')
    expect(formatTimeSeconds(1.25)).toBe('1.25')
    expect(formatTimeSeconds(1.23456789)).toBe('1.23456789')
    expect(formatTimeSeconds(-0)).toBe('0')
  })

  it('expands exponential notation to a parseable decimal', () => {
    expect(formatTimeSeconds(1e-7)).toBe('0.0000001')
    expect(formatTimeSeconds(1.25e21)).toBe('1250000000000000000000')

    const seconds = 1e-7
    expect(parseTimeExpression(formatTimeSeconds(seconds))).toBe(seconds)
  })

  it('returns an empty draft for invalid values', () => {
    expect(formatTimeSeconds(-1)).toBe('')
    expect(formatTimeSeconds(Number.NaN)).toBe('')
    expect(formatTimeSeconds(Number.POSITIVE_INFINITY)).toBe('')
  })
})
