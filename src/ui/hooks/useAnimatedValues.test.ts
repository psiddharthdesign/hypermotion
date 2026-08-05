// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { getAnimEngine } from '@/anim/engine'
import { textAnimationDefaults } from '@/anim/textAnimations'
import { createSceneAPI } from '@/scene/doc'
import {
  createAnimatedSnapshotSelector,
  createTransformPreviewSnapshotSelector,
  hasNodeDrivenTextAnimation,
  mergeTransformPreviews,
} from './useAnimatedValues'

describe('animated snapshot selection', () => {
  it('does not invalidate scene consumers for camera-only animation', () => {
    const selectScene = createAnimatedSnapshotSelector(['scene-node'])
    const first = selectScene({ camera: { x: 10 } })
    const second = selectScene({ camera: { x: 20 } })

    expect(second).toBe(first)
    expect(second).toEqual({})
  })

  it('publishes requested node changes and structurally shares held values', () => {
    const selectScene = createAnimatedSnapshotSelector(['scene-node'])
    const first = selectScene({ 'scene-node': { opacity: 0.5 } })
    const held = selectScene({ 'scene-node': { opacity: 0.5 } })
    const changed = selectScene({ 'scene-node': { opacity: 0.75 } })

    expect(held).toBe(first)
    expect(changed).not.toBe(first)
    expect(changed['scene-node']?.opacity).toBe(0.75)
  })

  it('keeps transform previews scoped and lets them override authored tracks', () => {
    const selectPreview = createTransformPreviewSnapshotSelector(['layer'])
    const unrelated = selectPreview({ other: { x: 10, y: 20 } })
    const selected = selectPreview({ layer: { x: 30, y: 40 } })

    expect(unrelated).toEqual({})
    expect(selected).toEqual({ layer: { x: 30, y: 40 } })
    expect(
      mergeTransformPreviews(
        { layer: { x: 4, y: 8, opacity: 0.5 } },
        selected,
      ),
    ).toEqual({ layer: { x: 30, y: 40, opacity: 0.5 } })
  })

  it('publishes non-positional visual previews without scene writes', () => {
    const selectPreview = createTransformPreviewSnapshotSelector(['layer'])
    const opacity = selectPreview({ layer: { opacity: 0.42 } })
    const held = selectPreview({ layer: { opacity: 0.42 } })
    const corner = selectPreview({ layer: { cornerRadius: 18 } })

    expect(opacity).toEqual({ layer: { opacity: 0.42 } })
    expect(held).toBe(opacity)
    expect(corner).toEqual({ layer: { cornerRadius: 18 } })
    expect(corner).not.toBe(opacity)
  })

  it('deep-merges one scrubbed effect without erasing other blur tracks', () => {
    expect(
      mergeTransformPreviews(
        {
          layer: {
            effectBlur: { 'effect-1': 8, 'effect-2': 16 },
          },
        },
        {
          layer: {
            effectBlur: { 'effect-1': 24 },
          },
        },
      ),
    ).toEqual({
      layer: {
        effectBlur: { 'effect-1': 24, 'effect-2': 16 },
      },
    })
  })

  it('exposes every intermediate engine opacity snapshot to a scene leaf', () => {
    const api = createSceneAPI()
    const nodeId = api.createNode('frame', null)
    api.setTrack({
      id: 'opacity-track',
      nodeId,
      propertyId: 'appearance.opacity',
      defaultEasing: 'linear',
      keyframes: [
        { id: 'start', time: 0, value: 0 },
        { id: 'end', time: 1, value: 1 },
      ],
    })
    const engine = getAnimEngine()
    const selectNode = createAnimatedSnapshotSelector([nodeId])
    engine.attach(api)

    engine.seek(0.25)
    const first = selectNode(engine.getSnapshot())
    engine.seek(0.5)
    const middle = selectNode(engine.getSnapshot())
    engine.seek(0.75)
    const last = selectNode(engine.getSnapshot())

    expect(first[nodeId]?.opacity).toBeCloseTo(0.25)
    expect(middle[nodeId]?.opacity).toBeCloseTo(0.5)
    expect(last[nodeId]?.opacity).toBeCloseTo(0.75)
    expect(middle).not.toBe(first)
    expect(last).not.toBe(middle)
  })

  it('publishes every intermediate camera focus position to overlay leaves', () => {
    const selectCamera = createAnimatedSnapshotSelector(['camera'])
    const start = selectCamera({ camera: { focusX: 100, focusY: 80 } })
    const middle = selectCamera({ camera: { focusX: 300, focusY: 180 } })
    const end = selectCamera({ camera: { focusX: 500, focusY: 280 } })

    expect(middle).not.toBe(start)
    expect(end).not.toBe(middle)
    expect(middle.camera).toMatchObject({ focusX: 300, focusY: 180 })
  })

  it('requests a playback clock for node-authored text animation only', () => {
    const api = createSceneAPI()
    const textId = api.createNode('text', null, { text: 'Legacy motion' })
    api.setNodeProperty(
      textId,
      'textAnimation',
      textAnimationDefaults('slide-up'),
    )

    expect(hasNodeDrivenTextAnimation(api, [textId])).toBe(true)

    api.setTrack({
      id: 'text-progress',
      nodeId: textId,
      propertyId: 'text.progress',
      defaultEasing: 'linear',
      keyframes: [
        { id: 'start', time: 0, value: 0 },
        { id: 'end', time: 1, value: 1 },
      ],
      textAnimation: textAnimationDefaults('slide-up'),
    })

    expect(hasNodeDrivenTextAnimation(api, [textId])).toBe(false)
  })

  it('does not subscribe ordinary scene text to the playback clock', () => {
    const api = createSceneAPI()
    const textId = api.createNode('text', null, { text: 'Static text' })

    expect(hasNodeDrivenTextAnimation(api, [textId])).toBe(false)
  })
})
