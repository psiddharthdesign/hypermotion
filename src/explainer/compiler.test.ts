// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import {
  compileBriefToStoryboard,
  validateStoryboard,
  type ExplainerBrief,
} from './index'

function featureBrief(): ExplainerBrief {
  return {
    id: 'smart-form',
    title: 'Turn every submission into a clear next step',
    targetDurationSeconds: 12,
    direction: {
      summary: 'Cinematic but product-led, with restrained 3D depth.',
      tone: 'cinematic',
      pacing: 'fast',
      use3dLayers: true,
      cameraStyle: 'dynamic',
    },
    script:
      'Start with one clear promise. Reveal the dashboard as separate layers. Submit the form and show the success state. Close on the product mark.',
    brand: {
      name: 'Acme',
      tagline: 'Work moves forward',
      logoSourceRefId: 'acme-logo',
      primaryColor: '#5b5bf7',
    },
    sourceRefs: [
      {
        id: 'dashboard-screen',
        kind: 'screen',
        label: 'Dashboard',
        route: '/dashboard',
      },
      {
        id: 'form-component',
        kind: 'component',
        label: 'Create form',
        component: 'CreateForm',
      },
      {
        id: 'acme-logo',
        kind: 'logo',
        label: 'Acme logo',
        uri: '/assets/acme.svg',
      },
      {
        id: 'soundtrack',
        kind: 'audio',
        uri: '/audio/feature.wav',
      },
    ],
    audioAnalysis: {
      sourceRefId: 'soundtrack',
      durationSeconds: 12,
      bpm: 120,
      firstBeatTime: 0,
      beats: Array.from({ length: 25 }, (_, index) => index * 0.5),
      downbeats: [0, 2, 4, 6, 8, 10, 12],
      energyPeaks: [3.5, 7.5, 10],
      confidence: 0.94,
    },
  }
}

describe('compileBriefToStoryboard', () => {
  it('produces deterministic, contiguous scenes and always finishes on the logo', () => {
    const first = compileBriefToStoryboard(featureBrief())
    const second = compileBriefToStoryboard(featureBrief())

    expect(first).toEqual(second)
    expect(first.durationSeconds).toBe(12)
    expect(first.scenes.map((scene) => scene.kind)).toEqual([
      'text',
      'design',
      'text',
      'demo',
      'logo',
    ])
    expect(first.scenes[0]?.startTime).toBe(0)
    expect(first.scenes.at(-1)?.endTime).toBe(12)
    expect(first.scenes.at(-1)?.kind).toBe('logo')
    for (let index = 1; index < first.scenes.length; index += 1) {
      expect(first.scenes[index]?.startTime).toBe(
        first.scenes[index - 1]?.endTime,
      )
    }
    expect(first.transitions).toHaveLength(first.scenes.length - 1)
    expect(first.qc.filter((issue) => issue.severity === 'error')).toEqual([])
    expect(validateStoryboard(first).ok).toBe(true)
  })

  it('snaps scene cues and camera cuts to beats and programs camera switches', () => {
    const storyboard = compileBriefToStoryboard(featureBrief())
    const beats = new Set(storyboard.beatPlan.beatTimes)

    expect(storyboard.beatPlan.source).toBe('detected')
    expect(
      storyboard.scenes.slice(1).every((scene) => beats.has(scene.startTime)),
    ).toBe(true)
    expect(storyboard.beatPlan.cameraCuts.length).toBeGreaterThan(
      storyboard.scenes.length,
    )
    expect(
      storyboard.beatPlan.cameraCuts.every(
        (cut) => cut.beatSnapped && beats.has(cut.time),
      ),
    ).toBe(true)

    const design = storyboard.scenes.find((scene) => scene.kind === 'design')
    const demo = storyboard.scenes.find((scene) => scene.kind === 'demo')
    expect(design?.cameraCutIds).toHaveLength(2)
    expect(demo?.cameraCutIds).toHaveLength(2)
    expect(new Set(design?.cameraDirections.map((item) => item.cameraId)).size)
      .toBe(2)
    expect(new Set(demo?.cameraDirections.map((item) => item.cameraId)).size)
      .toBe(2)
  })

  it('creates actionable component, demo-state, and 3D layer directions', () => {
    const storyboard = compileBriefToStoryboard(featureBrief())
    const design = storyboard.scenes.find((scene) => scene.kind === 'design')
    const demo = storyboard.scenes.find((scene) => scene.kind === 'demo')

    expect(design?.kind).toBe('design')
    if (design?.kind !== 'design') throw new Error('missing design scene')
    expect(design.components.map((component) => component.sourceRefId)).toEqual([
      'dashboard-screen',
      'form-component',
    ])
    expect(design.components[0]?.variantStates).toContain('focused')
    expect(design.layerDirections).toHaveLength(3)
    expect(new Set(design.layerDirections.map((layer) => layer.depth)).size)
      .toBeGreaterThan(1)

    expect(demo?.kind).toBe('demo')
    if (demo?.kind !== 'demo') throw new Error('missing demo scene')
    expect(demo.steps.map((step) => step.action)).toEqual([
      'focus',
      'submit',
      'success',
    ])
    expect(demo.steps.every((step) => demo.cueIds.includes(step.cueId))).toBe(
      true,
    )
    expect(demo.layerDirections.map((layer) => layer.role)).toEqual([
      'surface',
      'control',
      'success',
    ])
  })

  it('uses a 12-second default and constrains ordinary briefs to 10–15 seconds', () => {
    expect(compileBriefToStoryboard({ title: 'Default' }).durationSeconds).toBe(
      12,
    )
    expect(
      compileBriefToStoryboard({
        title: 'Too short',
        targetDurationSeconds: 3,
      }).durationSeconds,
    ).toBe(10)
    expect(
      compileBriefToStoryboard({
        title: 'Too long',
        targetDurationSeconds: 30,
      }).durationSeconds,
    ).toBe(15)
    expect(
      compileBriefToStoryboard({
        title: 'Audio-led',
        audioAnalysis: { durationSeconds: 13, bpm: 100 },
      }).durationSeconds,
    ).toBe(13)
  })

  it('honors a structured scene order while preserving an opening and final logo', () => {
    const storyboard = compileBriefToStoryboard({
      title: 'Structured',
      direction: {
        summary: 'Lead with the feature.',
        sceneOrder: ['design', 'demo'],
      },
      script: {
        hook: 'A faster workflow.',
        beats: [
          {
            text: 'Show the surface.',
            sceneType: 'design',
            sourceRefIds: ['screen'],
          },
          {
            text: 'Click and confirm.',
            sceneType: 'demo',
            sourceRefIds: ['screen'],
          },
        ],
      },
      brand: { name: 'Hyper' },
      sourceRefs: [{ id: 'screen', kind: 'screen' }],
      audioAnalysis: { bpm: 120, firstBeatTime: 0 },
    })

    expect(storyboard.scenes.map((scene) => scene.kind)).toEqual([
      'text',
      'design',
      'demo',
      'logo',
    ])
    expect(storyboard.beatPlan.source).toBe('tempo')
  })
})
