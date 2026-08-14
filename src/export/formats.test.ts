// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  EXPORT_FORMATS,
  EXPORT_QUALITIES,
  buildExportFilename,
  getExportFormat,
  getExportQuality,
  resolveDimensions,
  resolveFrameRange,
  resolveFrameSegments,
  type ExportFormatId,
  type ExportQualityId,
} from './formats'

describe('export catalogue lookup', () => {
  it('returns the catalogue entry for every published id', () => {
    for (const format of EXPORT_FORMATS) {
      expect(getExportFormat(format.id)).toBe(format)
    }
    for (const quality of EXPORT_QUALITIES) {
      expect(getExportQuality(quality.id)).toBe(quality)
    }
  })

  it('throws on ids that are not in the catalogue', () => {
    expect(() => getExportFormat('mov' as ExportFormatId)).toThrow(
      /Unknown export format: mov/,
    )
    expect(() => getExportQuality('8k' as ExportQualityId)).toThrow(
      /Unknown export quality: 8k/,
    )
  })
})

describe('quality dimension resolution', () => {
  it('matches the comp size verbatim, rounded to even pixels', () => {
    const comp = getExportQuality('comp')
    expect(resolveDimensions(comp, { width: 1080, height: 1080 })).toEqual({
      width: 1080,
      height: 1080,
    })
    expect(resolveDimensions(comp, { width: 401.2, height: 300.6 })).toEqual({
      width: 402,
      height: 302,
    })
  })

  it('fits named presets inside their bounding box, preserving aspect', () => {
    const uhd = getExportQuality('4k')
    expect(resolveDimensions(uhd, { width: 1920, height: 1080 })).toEqual({
      width: 3840,
      height: 2160,
    })
    expect(resolveDimensions(uhd, { width: 1600, height: 1200 })).toEqual({
      width: 2880,
      height: 2160,
    })
    expect(resolveDimensions(uhd, { width: 1080, height: 1920 })).toEqual({
      width: 1216,
      height: 2160,
    })
  })

  it('scales small comps up to the preset box', () => {
    expect(
      resolveDimensions(getExportQuality('720p'), { width: 320, height: 180 }),
    ).toEqual({ width: 1280, height: 720 })
    expect(
      resolveDimensions(getExportQuality('2k'), { width: 1280, height: 720 }),
    ).toEqual({ width: 2560, height: 1440 })
  })

  it('collapses degenerate canvases to a minimal even frame', () => {
    expect(
      resolveDimensions(getExportQuality('720p'), { width: 0, height: 720 }),
    ).toEqual({ width: 2, height: 2 })
    expect(
      resolveDimensions(getExportQuality('720p'), { width: 1280, height: -10 }),
    ).toEqual({ width: 2, height: 2 })
  })

  it('clamps mp4 output into the H.264 4K ceiling', () => {
    const comp = getExportQuality('comp')
    expect(
      resolveDimensions(comp, { width: 5120, height: 2880 }, 'mp4'),
    ).toEqual({ width: 3840, height: 2160 })
    expect(
      resolveDimensions(comp, { width: 3840, height: 2880 }, 'mp4'),
    ).toEqual({ width: 2880, height: 2160 })
  })

  it('leaves oversized webm and gif comps untouched', () => {
    const comp = getExportQuality('comp')
    expect(
      resolveDimensions(comp, { width: 5120, height: 2880 }, 'webm'),
    ).toEqual({ width: 5120, height: 2880 })
    expect(
      resolveDimensions(comp, { width: 5120, height: 2880 }, 'gif'),
    ).toEqual({ width: 5120, height: 2880 })
  })
})

describe('frame range resolution', () => {
  it('walks the whole comp for a full range', () => {
    expect(resolveFrameRange({ kind: 'full' }, 2, 30)).toEqual({
      firstFrame: 0,
      lastFrame: 59,
    })
  })

  it('converts a time range into an inclusive frame pair', () => {
    expect(
      resolveFrameRange({ kind: 'time', startSec: 0.5, endSec: 1.5 }, 2, 30),
    ).toEqual({ firstFrame: 15, lastFrame: 44 })
  })

  it('clamps frame ranges to the comp and keeps at least one frame', () => {
    expect(
      resolveFrameRange({ kind: 'frames', startFrame: -10, endFrame: 500 }, 2, 30),
    ).toEqual({ firstFrame: 0, lastFrame: 59 })
    expect(
      resolveFrameRange({ kind: 'frames', startFrame: 40, endFrame: 10 }, 2, 30),
    ).toEqual({ firstFrame: 40, lastFrame: 40 })
  })

  it('returns the bounding pair for segment ranges', () => {
    expect(
      resolveFrameRange(
        {
          kind: 'segments',
          segments: [
            { startSec: 0, endSec: 0.5 },
            { startSec: 1, endSec: 1.5 },
          ],
        },
        2,
        30,
      ),
    ).toEqual({ firstFrame: 0, lastFrame: 44 })
  })

  it('never produces a negative range for a zero-length comp', () => {
    expect(resolveFrameRange({ kind: 'full' }, 0, 30)).toEqual({
      firstFrame: 0,
      lastFrame: 0,
    })
  })
})

describe('frame segment resolution', () => {
  it('returns a single pair for continuous ranges', () => {
    expect(resolveFrameSegments({ kind: 'full' }, 1, 24)).toEqual([
      { firstFrame: 0, lastFrame: 23 },
    ])
    expect(
      resolveFrameSegments({ kind: 'time', startSec: 0, endSec: 0.5 }, 1, 24),
    ).toEqual([{ firstFrame: 0, lastFrame: 11 }])
    expect(
      resolveFrameSegments({ kind: 'frames', startFrame: 4, endFrame: 8 }, 1, 24),
    ).toEqual([{ firstFrame: 4, lastFrame: 8 }])
  })

  it('keeps segments in input order', () => {
    expect(
      resolveFrameSegments(
        {
          kind: 'segments',
          segments: [
            { startSec: 0, endSec: 0.25 },
            { startSec: 0.75, endSec: 1 },
          ],
        },
        1,
        24,
      ),
    ).toEqual([
      { firstFrame: 0, lastFrame: 5 },
      { firstFrame: 18, lastFrame: 23 },
    ])
  })

  it('collapses a zero-length segment to a single frame', () => {
    expect(
      resolveFrameSegments(
        { kind: 'segments', segments: [{ startSec: 0.5, endSec: 0.5 }] },
        1,
        24,
      ),
    ).toEqual([{ firstFrame: 12, lastFrame: 12 }])
  })

  it('clamps segments past the comp end onto the last frame', () => {
    expect(
      resolveFrameSegments(
        { kind: 'segments', segments: [{ startSec: 2, endSec: 3 }] },
        1,
        24,
      ),
    ).toEqual([{ firstFrame: 23, lastFrame: 23 }])
  })

  it('falls back to one frame when no segments are given', () => {
    expect(resolveFrameSegments({ kind: 'segments', segments: [] }, 1, 24)).toEqual(
      [{ firstFrame: 0, lastFrame: 0 }],
    )
  })
})

describe('suggested export filename', () => {
  const mp4 = getExportFormat('mp4')

  it('uses the bare scene name for a whole-comp export', () => {
    expect(buildExportFilename('Landing hero', mp4)).toBe('Landing hero.mp4')
    expect(
      buildExportFilename('Landing hero', mp4, {
        firstFrame: 0,
        lastFrame: 59,
        lastSceneFrame: 59,
      }),
    ).toBe('Landing hero.mp4')
  })

  it('appends the frame span for an untagged subrange', () => {
    expect(
      buildExportFilename('Landing hero', mp4, {
        firstFrame: 12,
        lastFrame: 40,
        lastSceneFrame: 59,
      }),
    ).toBe('Landing hero_12-40.mp4')
  })

  it('prefers a sanitized chapter tag over the frame span', () => {
    expect(
      buildExportFilename('Landing hero', mp4, {
        firstFrame: 12,
        lastFrame: 40,
        lastSceneFrame: 59,
        chapterTag: 'intro/hold!',
      }),
    ).toBe('Landing hero_introhold.mp4')
  })

  it('falls back to the frame span when a tag sanitizes to nothing', () => {
    expect(
      buildExportFilename('Landing hero', mp4, {
        firstFrame: 12,
        lastFrame: 40,
        lastSceneFrame: 59,
        chapterTag: '///',
      }),
    ).toBe('Landing hero_12-40.mp4')
  })

  it('strips filename-hostile characters and falls back to "export"', () => {
    expect(buildExportFilename('  Hero/v2:final  ', mp4)).toBe('Herov2final.mp4')
    expect(buildExportFilename('***', mp4)).toBe('export.mp4')
  })

  it('uses the format extension', () => {
    expect(buildExportFilename('Hero', getExportFormat('webm'))).toBe('Hero.webm')
    expect(buildExportFilename('Hero', getExportFormat('gif'))).toBe('Hero.gif')
  })
})
