// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  compileBriefToStoryboard,
  validateStoryboard,
  type ExplainerStoryboard,
  type StoryboardQcCode,
} from './index'

function validStoryboard(): ExplainerStoryboard {
  return compileBriefToStoryboard({
    id: 'validated',
    title: 'Validated feature',
    script:
      'Open with the promise. Show the design. Click the control and reveal the result.',
    brand: {
      name: 'Hyper',
      tagline: 'Motion with structure',
      logoSourceRefId: 'logo',
    },
    sourceRefs: [
      { id: 'screen', kind: 'screen' },
      { id: 'logo', kind: 'logo' },
    ],
    audioAnalysis: {
      bpm: 120,
      firstBeatTime: 0,
      beats: Array.from({ length: 25 }, (_, index) => index * 0.5),
      downbeats: [0, 2, 4, 6, 8, 10, 12],
    },
  })
}

function issueCodes(storyboard: ExplainerStoryboard): StoryboardQcCode[] {
  return validateStoryboard(storyboard).issues.map((issue) => issue.code)
}

describe('validateStoryboard', () => {
  it('accepts a compiled storyboard with complete sources and beat evidence', () => {
    const result = validateStoryboard(validStoryboard())

    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('reports duration, continuity, and missing final-logo failures', () => {
    const storyboard = structuredClone(validStoryboard())
    storyboard.durationSeconds = 8
    const removedLogo = storyboard.scenes.pop()
    expect(removedLogo?.kind).toBe('logo')
    const second = storyboard.scenes[1]
    if (!second) throw new Error('missing second scene')
    second.startTime += 0.25

    const codes = issueCodes(storyboard)

    expect(codes).toContain('invalid-duration')
    expect(codes).toContain('scene-gap')
    expect(codes).toContain('missing-final-logo')
  })

  it('rejects camera cuts without a matching cue/direction program', () => {
    const storyboard = structuredClone(validStoryboard())
    const cut = storyboard.beatPlan.cameraCuts[0]
    if (!cut) throw new Error('missing camera cut')
    cut.cameraId = 'camera-does-not-exist'
    cut.time = storyboard.durationSeconds + 1

    const result = validateStoryboard(storyboard)

    expect(result.ok).toBe(false)
    expect(result.errors.map((issue) => issue.code)).toContain(
      'invalid-camera-cut',
    )
  })

  it('rejects a false beat-snap claim', () => {
    const storyboard = structuredClone(validStoryboard())
    const cue = storyboard.beatPlan.cues.find((item) => item.beatSnapped)
    if (!cue) throw new Error('missing beat-snapped cue')
    cue.time += 0.125

    const result = validateStoryboard(storyboard)

    expect(result.errors.map((issue) => issue.code)).toContain(
      'beat-snap-mismatch',
    )
  })

  it('detects duplicate ids across planning collections', () => {
    const storyboard = structuredClone(validStoryboard())
    const transition = storyboard.transitions[0]
    const scene = storyboard.scenes[0]
    if (!transition || !scene) throw new Error('missing plan entries')
    transition.id = scene.id

    expect(issueCodes(storyboard)).toContain('duplicate-id')
  })

  it('keeps sparse briefs executable while surfacing fallback warnings', () => {
    const storyboard = compileBriefToStoryboard({
      title: 'Sparse feature',
      script: 'A useful promise.',
    })
    const result = validateStoryboard(storyboard)
    const warningCodes = result.warnings.map((issue) => issue.code)

    expect(result.ok).toBe(true)
    expect(warningCodes).toContain('audio-analysis-unavailable')
    expect(warningCodes).toContain('missing-design-source')
    expect(warningCodes).toContain('missing-logo-source')
    expect(storyboard.scenes.at(-1)?.kind).toBe('logo')
  })
})
