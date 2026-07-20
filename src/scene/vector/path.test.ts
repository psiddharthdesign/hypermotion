// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { parseSvgPathData, vectorGeometryToPathData } from './path'

describe('native vector path data', () => {
  it('normalizes relative, quadratic, smooth, and arc commands to lines/cubics', () => {
    const geometry = parseSvgPathData(
      'M 10 10 h 20 v 10 q 10 20 20 0 t 20 0 a 10 10 0 0 1 10 10 z',
      { idPrefix: 'fixture', fillRule: 'evenodd' },
    )

    expect(geometry.contours).toHaveLength(1)
    expect(geometry.contours[0]?.closed).toBe(true)
    expect(geometry.contours[0]?.fillRule).toBe('evenodd')
    expect(Object.values(geometry.segments).some((segment) => segment.kind === 'cubic')).toBe(true)
    expect(Object.values(geometry.segments).at(-1)?.isClosing).toBe(true)
    expect(Object.keys(geometry.points).every((id) => id.startsWith('fixture-point-'))).toBe(true)
  })

  it('serializes canonical geometry without duplicating the implicit close edge', () => {
    const first = parseSvgPathData('M0 0 L100 0 C100 0 100 100 0 100 Z')
    const path = vectorGeometryToPathData(first)
    const second = parseSvgPathData(path)

    expect(path).toBe('M 0 0 L 100 0 C 100 0 100 100 0 100 Z')
    expect(second.contours).toHaveLength(1)
    expect(second.contours[0]?.closed).toBe(true)
    expect(Object.keys(second.segments)).toHaveLength(Object.keys(first.segments).length)
  })

  it('rejects malformed and non-finite coordinates', () => {
    expect(() => parseSvgPathData('M 0 0 L nope')).toThrow()
    expect(() => parseSvgPathData('M 0 0 L 1e999 2')).toThrow()
  })
})
