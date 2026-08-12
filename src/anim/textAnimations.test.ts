// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import {
  findStaggerSetMemberTrack,
  registerStaggerSetKeyframes,
  resolveStaggerTrackBundle,
} from './staggerSets'
import {
  TEXT_ANIMATION_PRESETS,
  applyTextAnimation,
  deriveTextAnimationTiming,
  normalizeTextAnimation,
  stampTextAnimationKeyframes,
  type TextAnimationConfig,
  textAnimationDefaults,
  typewriterTextAtProgress,
  updateTextAnimationTrackMetadata,
} from './textAnimations'
import { textStaggerCurveForPreset } from './textStaggerCurve'
import { defaultTextMotionPath } from './textMotionPath'

describe('text animation track reconciliation', () => {
  it('reveals whole-layer typewriter text progressively in either mode', () => {
    expect(typewriterTextAtProgress('Depth', 'in', 0.4)).toBe('De')
    expect(typewriterTextAtProgress('Depth', 'out', 0.4)).toBe('Dep')
  })

  it('normalizes optional XYZ motion while legacy configs stay in 2D mode', () => {
    expect(normalizeTextAnimation({ id: 'slide-up' })?.motionVector).toBeNull()
    expect(
      normalizeTextAnimation({
        id: 'slide-up',
        motionVector: { x: Number.POSITIVE_INFINITY, y: -12, z: 2.5 },
      })?.motionVector,
    ).toEqual({ x: 0, y: -10, z: 2.5 })
  })

  it('clamps malformed segment delay while preserving smoothing profiles', () => {
    expect(
      normalizeTextAnimation({ id: 'slide-down', delay: -1 })?.delay,
    ).toBe(0)
    expect(
      normalizeTextAnimation({ id: 'slide-down', smoothing: 'smooth' })
        ?.smoothing,
    ).toBe('smooth')
  })

  it('normalizes versioned stagger splines and drops malformed ones safely', () => {
    const curve = textStaggerCurveForPreset('smooth')
    expect(
      normalizeTextAnimation({ id: 'slide-down', staggerCurve: curve })
        ?.staggerCurve,
    ).toEqual(curve)
    expect(
      normalizeTextAnimation({
        id: 'slide-down',
        staggerCurve: { ...curve, version: 2 },
      })?.staggerCurve,
    ).toBeNull()
    expect(normalizeTextAnimation({ id: 'slide-down' })?.staggerCurve).toBeNull()
  })

  it('normalizes editable spatial paths without changing legacy presets', () => {
    const path = defaultTextMotionPath()
    expect(normalizeTextAnimation({ id: 'fade' })?.motionPath).toBeNull()
    expect(
      normalizeTextAnimation({ id: 'curve-drop', motionPath: path })
        ?.motionPath,
    ).toEqual(path)
    expect(
      normalizeTextAnimation({
        id: 'curve-drop',
        motionPath: { ...path, version: 2 },
      })?.motionPath,
    ).toBeNull()
  })

  it('defines Number Flow as a constrained whole-layer numeric preset', () => {
    expect(
      TEXT_ANIMATION_PRESETS.find((preset) => preset.id === 'number-flow'),
    ).toMatchObject({
      label: 'Number Flow',
      category: 'Numbers',
    })
    expect(textAnimationDefaults('number-flow')).toMatchObject({
      id: 'number-flow',
      applyTo: 'layer',
      delay: 0,
      duration: 0.8,
      numberFrom: 0,
      travelDistance: 0,
      motionVector: null,
      motionPath: null,
      blurRadius: 8,
      numberFlowTrend: 'auto',
      numberFlowContinuous: true,
      numberFlowIncrement: null,
      numberFlowSpinDistance: 1,
      numberFlowFadeAmount: 1,
      numberFlowMaskHeight: 0.25,
      numberFlowMaskWidth: 0.5,
      numberFlowTransformTimingRatio: 1,
      numberFlowSpinTimingRatio: 1,
      numberFlowOpacityTimingRatio: 0.5,
    })
  })

  it('normalizes Number Flow values and enforces its layer-only constraints', () => {
    const path = defaultTextMotionPath()
    expect(
      normalizeTextAnimation({
        id: 'number-flow',
        applyTo: 'letters',
        delay: 0.2,
        numberFrom: -42.5,
        travelDistance: 2,
        motionVector: { x: 1, y: 2, z: 3 },
        motionPath: path,
        blurRadius: 16,
        numberFlowTrend: 'down',
        numberFlowContinuous: false,
        numberFlowIncrement: 1_000_000_000_000_001,
        numberFlowSpinDistance: 5,
        numberFlowFadeAmount: -1,
        numberFlowMaskHeight: 4,
        numberFlowMaskWidth: 4,
        numberFlowTransformTimingRatio: 0,
        numberFlowSpinTimingRatio: 3,
        numberFlowOpacityTimingRatio: 0.25,
      }),
    ).toMatchObject({
      id: 'number-flow',
      applyTo: 'layer',
      delay: 0,
      numberFrom: -42.5,
      travelDistance: 0,
      motionVector: null,
      motionPath: null,
      blurRadius: 16,
      numberFlowTrend: 'down',
      numberFlowContinuous: false,
      numberFlowIncrement: 1_000_000_000_000_000,
      numberFlowSpinDistance: 2,
      numberFlowFadeAmount: 0,
      numberFlowMaskHeight: 1,
      numberFlowMaskWidth: 2,
      numberFlowTransformTimingRatio: 0.05,
      numberFlowSpinTimingRatio: 1,
      numberFlowOpacityTimingRatio: 0.25,
    })
    expect(
      normalizeTextAnimation({
        id: 'number-flow',
        numberFrom: Number.POSITIVE_INFINITY,
      })?.numberFrom,
    ).toBe(0)
    expect(
      normalizeTextAnimation({
        id: 'number-flow',
        numberFlowIncrement: 0,
      })?.numberFlowIncrement,
    ).toBeNull()
  })

  it('installs Curve Drop motion and preserves a customized path across presets', () => {
    const api = createSceneAPI()
    const nodeId = api.createNode('text', null, { text: 'Curve' })
    const fade = applyTextAnimation(api, nodeId, 'fade', 0)
    expect(fade.motionPath).toBeNull()

    const dropped = applyTextAnimation(api, nodeId, 'curve-drop', 0, fade)
    expect(dropped.motionPath).toEqual(defaultTextMotionPath())

    const custom = {
      ...dropped.motionPath!,
      points: dropped.motionPath!.points.map((point, index) =>
        index === dropped.motionPath!.points.length - 1
          ? {
              ...point,
              x: 2,
              y: -6,
              z: 1,
              outX: 2,
              outY: -6,
              outZ: 1,
            }
          : point,
      ),
    }
    const next = applyTextAnimation(
      api,
      nodeId,
      'fade',
      0,
      { ...dropped, motionPath: custom },
    )
    expect(next.motionPath).toEqual(custom)
  })

  it('keeps an attached motion path available through every text effect', () => {
    const api = createSceneAPI()
    const nodeId = api.createNode('text', null, { text: 'Any effect' })
    const path = defaultTextMotionPath()
    let current: TextAnimationConfig = {
      ...applyTextAnimation(api, nodeId, 'fade', 0),
      motionPath: path,
    }

    for (const preset of TEXT_ANIMATION_PRESETS.filter(
      ({ id }) => id !== 'number-flow',
    )) {
      current = applyTextAnimation(
        api,
        nodeId,
        preset.id,
        0,
        current,
        { trackId: api.getTracksForNode(nodeId)[0]?.id },
      )
      expect(current.id).toBe(preset.id)
      expect(current.motionPath).toEqual(path)
      expect(api.getTracksForNode(nodeId)).toHaveLength(1)
      expect(api.getTracksForNode(nodeId)[0]?.textAnimation?.motionPath).toEqual(
        path,
      )
    }
  })

  it('applies Number Flow without replacing its track keys or inherited motion', () => {
    const api = createSceneAPI()
    const nodeId = api.createNode('text', null, { text: '$1,234.50' })
    const initial = applyTextAnimation(api, nodeId, 'curve-drop', 1)
    const track = api.getTracksForNode(nodeId)[0]!
    const keyframeIds = track.keyframes.map((keyframe) => keyframe.id)

    const next = applyTextAnimation(
      api,
      nodeId,
      'number-flow',
      1,
      {
        ...initial,
        applyTo: 'letters',
        delay: 0.2,
        numberFrom: 25,
        numberFlowIncrement: 10,
        motionVector: { x: 1, y: 2, z: 3 },
      },
      { trackId: track.id },
    )

    expect(next).toMatchObject({
      id: 'number-flow',
      applyTo: 'layer',
      delay: 0,
      numberFrom: 25,
      numberFlowIncrement: 10,
      travelDistance: 0,
      motionVector: null,
      motionPath: null,
      blurRadius: 8,
    })
    expect(api.getTrack(track.id)?.keyframes.map(({ id }) => id)).toEqual(
      keyframeIds,
    )
    expect(api.getTrack(track.id)?.keyframes.map(({ time }) => time)).toEqual([
      1,
      1.8,
    ])
  })

  it('leaves existing animation data untouched when Number Flow text is invalid', () => {
    const api = createSceneAPI()
    const nodeId = api.createNode('text', null, { text: 'Revenue' })
    const initial = applyTextAnimation(api, nodeId, 'fade', 1)
    const track = structuredClone(api.getTracksForNode(nodeId)[0]!)
    const nodeBefore = api.getNode(nodeId)
    const nodeAnimation = structuredClone(
      nodeBefore?.kind === 'text' ? nodeBefore.textAnimation : null,
    )

    const returned = applyTextAnimation(
      api,
      nodeId,
      'number-flow',
      1,
      initial,
      { trackId: track.id },
    )

    expect(returned).toEqual(initial)
    expect(api.getTrack(track.id)).toEqual(track)
    const nodeAfter = api.getNode(nodeId)
    expect(nodeAfter?.kind === 'text' ? nodeAfter.textAnimation : null).toEqual(
      nodeAnimation,
    )
  })

  it('preserves XYZ motion when the text animation preset changes', () => {
    const api = createSceneAPI()
    const nodeId = api.createNode('text', null, { text: 'Depth' })
    const initial = applyTextAnimation(api, nodeId, 'slide-up', 0)
    const track = api.getTracksForNode(nodeId)[0]!
    const motionVector = { x: 0.25, y: 0.5, z: -1.5 }
    const staggerCurve = textStaggerCurveForPreset('soft')
    const motionPath = defaultTextMotionPath()

    const next = applyTextAnimation(
      api,
      nodeId,
      'blur-slide',
      0,
      { ...initial, motionVector, staggerCurve, motionPath },
      { trackId: track.id },
    )

    expect(next.motionVector).toEqual(motionVector)
    expect(api.getTrack(track.id)?.textAnimation?.motionVector).toEqual(
      motionVector,
    )
    expect(next.staggerCurve).toEqual(staggerCurve)
    expect(api.getTrack(track.id)?.textAnimation?.staggerCurve).toEqual(
      staggerCurve,
    )
    expect(next.motionPath).toEqual(motionPath)
    expect(api.getTrack(track.id)?.textAnimation?.motionPath).toEqual(
      motionPath,
    )
  })

  it('preserves endpoint identities when text options change timing', () => {
    const api = createSceneAPI()
    const nodeId = api.createNode('text', null, { text: 'One two three' })
    const initial = applyTextAnimation(api, nodeId, 'fade', 1)
    const track = api
      .getTracksForNode(nodeId)
      .find((candidate) => candidate.propertyId === 'text.progress')
    if (!track) throw new Error('Expected text progress track')
    const keyframeIds = track.keyframes.map((keyframe) => keyframe.id)

    const next = { ...initial, applyTo: 'words' as const, duration: 1.25 }
    stampTextAnimationKeyframes(api, nodeId, next, 'One two three', {
      trackId: track.id,
    })

    const updated = api.getTrack(track.id)
    expect(api.getTracksForNode(nodeId)).toHaveLength(1)
    expect(updated?.keyframes.map((keyframe) => keyframe.id)).toEqual(
      keyframeIds,
    )
    expect(updated?.keyframes.map((keyframe) => keyframe.time)).toEqual([
      1,
      2.49,
    ])
    expect(updated?.textAnimation).toEqual(next)
  })

  it('preserves per-segment duration when words change to letters', () => {
    const api = createSceneAPI()
    const text = 'One two three'
    const nodeId = api.createNode('text', null, { text })
    const words = {
      ...applyTextAnimation(api, nodeId, 'fade', 1),
      applyTo: 'words' as const,
      duration: 0.6,
    }
    const track = api.getTracksForNode(nodeId)[0]!
    stampTextAnimationKeyframes(api, nodeId, words, text, {
      trackId: track.id,
    })

    const timedWords = deriveTextAnimationTiming(
      words,
      api.getTrack(track.id),
      text,
    )!
    const letters = { ...timedWords, applyTo: 'letters' as const }
    stampTextAnimationKeyframes(api, nodeId, letters, text, {
      trackId: track.id,
    })

    const updated = api.getTrack(track.id)!
    expect(timedWords.duration).toBeCloseTo(0.6)
    expect(updated.keyframes.map((keyframe) => keyframe.id)).toEqual(
      track.keyframes.map((keyframe) => keyframe.id),
    )
    expect(updated.keyframes.map((keyframe) => keyframe.time)).toEqual([
      1,
      2.8,
    ])
  })

  it('rescales authored intermediate progress keys without replacing them', () => {
    const api = createSceneAPI()
    const nodeId = api.createNode('text', null, { text: 'Hello' })
    const config = applyTextAnimation(api, nodeId, 'fade', 0)
    const track = api
      .getTracksForNode(nodeId)
      .find((candidate) => candidate.propertyId === 'text.progress')
    if (!track) throw new Error('Expected text progress track')
    api.setTrack({
      ...track,
      keyframes: [
        track.keyframes[0]!,
        { id: 'middle', time: 0.49, value: 0.4 },
        track.keyframes[1]!,
      ],
    })

    stampTextAnimationKeyframes(
      api,
      nodeId,
      { ...config, duration: 1 },
      'Hello',
      { trackId: track.id },
    )

    expect(api.getTrack(track.id)?.keyframes).toEqual([
      expect.objectContaining({ id: track.keyframes[0]!.id, time: 0 }),
      expect.objectContaining({ id: 'middle', time: 0.74, value: 0.4 }),
      expect.objectContaining({ id: track.keyframes[1]!.id, time: 1.48 }),
    ])
  })

  it('keeps a live S bundle through option and preset changes', () => {
    const api = createSceneAPI()
    const root = api.createNode('frame', null)
    const first = api.createNode('text', root, { text: 'First heading' })
    const second = api.createNode('text', root, {
      text: 'A much longer second heading',
    })
    const firstConfig = applyTextAnimation(api, first, 'fade', 1)
    const secondConfig = applyTextAnimation(api, second, 'fade', 1.2)
    const firstTrack = api.getTracksForNode(first)[0]!
    const secondTrack = api.getTracksForNode(second)[0]!
    registerStaggerSetKeyframes(
      api,
      {
        setId: 'text-set',
        layerIds: [first, second],
        delay: 0.2,
        order: 'forward',
      },
      [firstTrack, secondTrack].map((track) => ({
        nodeId: track.nodeId,
        propertyId: 'text.progress' as const,
        keyframeIds: track.keyframes.map((keyframe) => keyframe.id),
      })),
    )
    const membershipBefore = structuredClone(
      api.getUiState().staggerSets['text-set']!.members,
    )
    const keyframeIdsBefore = [firstTrack, secondTrack].map((track) =>
      track.keyframes.map((keyframe) => keyframe.id),
    )

    stampTextAnimationKeyframes(
      api,
      first,
      {
        ...firstConfig,
        applyTo: 'words',
        delay: 0.05,
        smoothing: 'smooth',
      },
      'First heading',
      { trackId: firstTrack.id },
    )
    stampTextAnimationKeyframes(
      api,
      second,
      {
        ...secondConfig,
        applyTo: 'words',
        delay: 0.05,
        smoothing: 'smooth',
      },
      'A much longer second heading',
      { trackId: secondTrack.id },
    )
    applyTextAnimation(
      api,
      first,
      'blur-slide',
      1,
      api.getTrack(firstTrack.id)?.textAnimation,
      { trackId: firstTrack.id },
    )
    applyTextAnimation(
      api,
      second,
      'blur-slide',
      1.2,
      api.getTrack(secondTrack.id)?.textAnimation,
      { trackId: secondTrack.id },
    )

    expect(api.getTracksForNode(first)).toHaveLength(1)
    expect(api.getTracksForNode(second)).toHaveLength(1)
    expect(api.getUiState().staggerSets['text-set']?.members).toEqual(
      membershipBefore,
    )
    expect(resolveStaggerTrackBundle(api, 'text-set', firstTrack.id)?.trackIdsByNode).toEqual({
      [first]: firstTrack.id,
      [second]: secondTrack.id,
    })
    for (const [index, track] of [
      api.getTrack(firstTrack.id),
      api.getTrack(secondTrack.id),
    ].entries()) {
      expect(track?.keyframes).toHaveLength(2)
      expect(track?.keyframes.map((keyframe) => keyframe.id)).toEqual(
        keyframeIdsBefore[index],
      )
      expect(track?.textAnimation?.id).toBe('blur-slide')
      expect(track?.textAnimation?.delay).toBe(0.05)
    }
    expect(
      api.getTrack(firstTrack.id)?.keyframes.map((keyframe) => keyframe.time),
    ).toEqual([1, 1.85])
    expect(
      api.getTrack(secondTrack.id)?.keyframes.map((keyframe) => keyframe.time),
    ).toEqual([1.2, 2.2])
  })

  it('changes only stagger-curve metadata without retiming or replacing S keyframes', () => {
    const api = createSceneAPI()
    const root = api.createNode('frame', null)
    const first = api.createNode('text', root, { text: 'First' })
    const second = api.createNode('text', root, { text: 'Second' })
    applyTextAnimation(api, first, 'slide-down', 1)
    applyTextAnimation(api, second, 'slide-down', 1.2)
    const tracks = [
      api.getTracksForNode(first)[0]!,
      api.getTracksForNode(second)[0]!,
    ]
    registerStaggerSetKeyframes(
      api,
      {
        setId: 'curve-set',
        layerIds: [first, second],
        delay: 0.2,
        order: 'forward',
      },
      tracks.map((track) => ({
        nodeId: track.nodeId,
        propertyId: 'text.progress' as const,
        keyframeIds: track.keyframes.map((keyframe) => keyframe.id),
      })),
    )
    const keysBefore = tracks.map((track) => structuredClone(track.keyframes))
    const membersBefore = structuredClone(
      api.getUiState().staggerSets['curve-set']!.members,
    )

    for (const track of tracks) {
      const config = {
        ...track.textAnimation!,
        staggerCurve: textStaggerCurveForPreset('smooth'),
      }
      expect(
        updateTextAnimationTrackMetadata(
          api,
          track.nodeId,
          config,
          track.id,
        ),
      ).toBe(true)
    }

    expect(api.getTrack(tracks[0]!.id)?.keyframes).toEqual(keysBefore[0])
    expect(api.getTrack(tracks[1]!.id)?.keyframes).toEqual(keysBefore[1])
    expect(api.getTrack(tracks[0]!.id)?.textAnimation?.staggerCurve).not.toBeNull()
    expect(api.getTrack(tracks[1]!.id)?.textAnimation?.staggerCurve).not.toBeNull()
    expect(api.getUiState().staggerSets['curve-set']?.members).toEqual(
      membersBefore,
    )
  })

  it('edits only the matching stacked S bundle before its follower starts', () => {
    const api = createSceneAPI()
    const root = api.createNode('frame', null)
    const first = api.createNode('text', root, { text: 'One two' })
    const second = api.createNode('text', root, {
      text: 'Four much longer words',
    })
    applyTextAnimation(api, first, 'fade', 1)
    applyTextAnimation(api, second, 'fade', 1.2)
    applyTextAnimation(api, first, 'blur', 5)
    applyTextAnimation(api, second, 'blur', 5.2)
    const firstTracks = api.getTracksForNode(first)
    const secondTracks = api.getTracksForNode(second)
    const firstIn = firstTracks.find(
      (track) => track.textAnimation?.startTime === 1,
    )!
    const secondIn = secondTracks.find(
      (track) => track.textAnimation?.startTime === 1.2,
    )!
    const firstLater = firstTracks.find(
      (track) => track.textAnimation?.startTime === 5,
    )!
    const secondLater = secondTracks.find(
      (track) => track.textAnimation?.startTime === 5.2,
    )!
    const options = {
      setId: 'text-set',
      layerIds: [first, second],
      delay: 0.2,
      order: 'forward' as const,
    }
    const registerTracks = (tracks: typeof firstTracks) =>
      registerStaggerSetKeyframes(
        api,
        options,
        tracks.map((track) => ({
          nodeId: track.nodeId,
          propertyId: 'text.progress' as const,
          keyframeIds: track.keyframes.map((keyframe) => keyframe.id),
        })),
      )
    registerTracks([firstIn, secondIn])
    registerTracks([firstLater, secondLater])
    const membershipBefore = structuredClone(
      api.getUiState().staggerSets['text-set']!.members,
    )
    const laterBefore = [
      structuredClone(firstLater),
      structuredClone(secondLater),
    ]

    const source = findStaggerSetMemberTrack(
      api,
      'text-set',
      first,
      'text.progress',
      1,
    )!
    const bundle = resolveStaggerTrackBundle(api, 'text-set', source.id)!
    expect(bundle.trackIdsByNode).toEqual({
      [first]: firstIn.id,
      [second]: secondIn.id,
    })

    const updatedTracks = [first, second].map((nodeId) => {
      const track = api.getTrack(bundle.trackIdsByNode[nodeId]!)!
      const node = api.getNode(nodeId)
      if (node?.kind !== 'text') throw new Error('Expected text node')
      const timed = deriveTextAnimationTiming(
        track.textAnimation!,
        track,
        node.text,
      )!
      const words = { ...timed, applyTo: 'words' as const }
      stampTextAnimationKeyframes(api, nodeId, words, node.text, {
        trackId: track.id,
      })
      applyTextAnimation(api, nodeId, 'blur-slide', track.keyframes[0]!.time, words, {
        trackId: track.id,
      })
      return api.getTrack(track.id)!
    })
    registerTracks(updatedTracks)

    expect(api.getTracksForNode(first)).toHaveLength(2)
    expect(api.getTracksForNode(second)).toHaveLength(2)
    expect(api.getTrack(firstLater.id)).toEqual(laterBefore[0])
    expect(api.getTrack(secondLater.id)).toEqual(laterBefore[1])
    expect(api.getUiState().staggerSets['text-set']?.members).toEqual(
      membershipBefore,
    )
    expect(
      api.getTrack(firstIn.id)?.keyframes.map((keyframe) => keyframe.time),
    ).toEqual([1, 1.92])
    expect(
      api.getTrack(secondIn.id)?.keyframes.map((keyframe) => keyframe.time),
    ).toEqual([1.2, 2.36])
  })
})
