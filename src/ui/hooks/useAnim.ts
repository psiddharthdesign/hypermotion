// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useSceneAPI, useSceneVersion } from '@/scene'
import { getAnimEngine } from '@/anim'
import { useUI } from '@/state/ui'
import { useProjectAPI } from '@/project'
import {
  resolveMasterTime,
  type ResolvedSequenceLayer,
} from '@/sequence'
import { selectedOccurrencePlaybackRange } from './scenePlaybackRange'

/**
 * Marry the anim engine to the scene + UI store.
 *
 * One of these should be mounted once (at the App shell root). The hook:
 *   - Attaches the engine to the scene on first mount so it can read
 *     tracks. Safe to re-call — attach replaces the reference.
 *   - Keeps the engine's playhead in sync with `ui.playhead` when the
 *     user scrubs the timeline (a one-way push from UI → engine).
 *   - When `ui.playing` flips on, starts the engine's rAF loop. When
 *     it flips off, pauses. The engine's own playhead advances during
 *     playback; we mirror it back into the UI store ~15 times a second
 *     so the ruler and transport text stay live.
 *
 * The playhead ownership story: UI store is the authority when the
 * user is interacting (scrub, type-in-field, transport button). Engine
 * is the authority during playback. The two directions don't conflict
 * because playback is boolean and scrub is edge-triggered.
 */
export function useAnim() {
  const api = useSceneAPI()
  const sceneVersion = useSceneVersion()
  const project = useProjectAPI()
  const playing = useUI((s) => s.playing)
  const playhead = useUI((s) => s.playhead)
  const setPlayhead = useUI((s) => s.setPlayhead)
  const setPlaying = useUI((s) => s.setPlaying)
  const previewScope = useUI((s) => s.previewScope)
  const activeCompositionId = useUI((s) => s.activeCompositionId)
  const selectedSequenceItemId = useUI((s) => s.selectedSequenceItemId)
  const setProgramSequencePosition = useUI(
    (s) => s.setProgramSequencePosition,
  )
  const isolatedRange = useUI((s) => s.isolatedRange)
  const workAreaRange = useUI((s) => s.workAreaRange)
  const workAreaPlaybackMode = useUI((s) => s.workAreaPlaybackMode)
  const wasPlayingRef = useRef(false)
  const previousUiPlayheadRef = useRef(playhead)
  const sequenceMap = useMemo(
    () => project.getSequenceTimeMap(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project, sceneVersion],
  )
  const playbackCompositionId =
    activeCompositionId ?? project.getActiveSceneId()
  const playbackSequenceItemId =
    selectedSequenceItemId ??
    sequenceMap.items.find(
      (item) => item.scene.id === playbackCompositionId,
    )?.item.id ??
    null
  const occurrencePlaybackRange = useMemo(
    () =>
      selectedOccurrencePlaybackRange(
        sequenceMap,
        playbackSequenceItemId,
        playbackCompositionId,
      ),
    [playbackCompositionId, playbackSequenceItemId, sequenceMap],
  )

  const applySequenceTime = useCallback(
    (masterTime: number): ResolvedSequenceLayer | null => {
      const resolution = resolveMasterTime(sequenceMap, masterTime, {
        clamp: true,
        quantize: 'none',
      })
      // A crossfade needs two independently evaluated render surfaces. Until
      // that compositor is mounted, keep preview deterministic by showing the
      // side with the greater contribution (incoming wins the exact midpoint).
      const layer =
        resolution.layers.length <= 1
          ? resolution.layers[0] ?? null
          : resolution.layers.reduce((winner, candidate) =>
              candidate.weight >= winner.weight ? candidate : winner,
            )
      if (!layer) {
        setProgramSequencePosition(null, null)
        return null
      }
      if (project.getActiveSceneId() !== layer.item.scene.id) {
        project.activateScene(layer.item.scene.id)
      }
      const program = useUI.getState()
      if (
        program.programSequenceItemId !== layer.item.item.id ||
        program.programCompositionId !== layer.item.scene.id
      ) {
        setProgramSequencePosition(layer.item.item.id, layer.item.scene.id)
      }
      getAnimEngine().seek(layer.localTime)
      return layer
    },
    [project, sequenceMap, setProgramSequencePosition],
  )
  // Activating a different composition updates the Y.Doc's compatibility
  // projection, which bumps sceneVersion and rebuilds `sequenceMap`. Keep the
  // running master clock attached to a ref so those expected scene switches
  // do not tear down/restart the rAF loop from the sampled UI playhead.
  const applySequenceTimeRef = useRef(applySequenceTime)
  useEffect(() => {
    applySequenceTimeRef.current = applySequenceTime
  }, [applySequenceTime])

  // Attach engine to scene once.
  useEffect(() => {
    getAnimEngine().attach(api)
  }, [api])

  // Mirror the selected occurrence into Scene transport. Isolation keeps its
  // historical behavior and takes precedence. Otherwise the occurrence's
  // resolved source window (already intersected with its authored work area)
  // uses the user's work-area loop/stop mode. The raw work area remains the
  // compatibility fallback while legacy selection state hydrates.
  useEffect(() => {
    if (previewScope === 'sequence') {
      getAnimEngine().setPlaybackRange(null)
      return
    }
    if (isolatedRange) {
      getAnimEngine().setPlaybackRange({
        start: isolatedRange.start,
        end: isolatedRange.end,
        mode: 'loop',
      })
      return
    }
    const sceneRange = occurrencePlaybackRange ?? workAreaRange
    getAnimEngine().setPlaybackRange(
      sceneRange
        ? {
            start: sceneRange.start,
            end: sceneRange.end,
            mode: workAreaPlaybackMode,
          }
        : null,
    )
  }, [
    isolatedRange,
    occurrencePlaybackRange,
    previewScope,
    workAreaPlaybackMode,
    workAreaRange,
  ])

  // Returning from Master preview restores the scene the user was editing.
  // Program playback is allowed to activate several compositions, but that
  // must not silently change the edit selection.
  useEffect(() => {
    if (previewScope !== 'scene') return
    setProgramSequencePosition(null, null)
    if (
      activeCompositionId &&
      project.getActiveSceneId() !== activeCompositionId
    ) {
      project.activateScene(activeCompositionId)
    }
  }, [
    activeCompositionId,
    previewScope,
    project,
    setProgramSequencePosition,
  ])

  // UI → engine: sync playhead when NOT playing (during scrub / fields).
  useEffect(() => {
    const previousUiPlayhead = previousUiPlayheadRef.current
    previousUiPlayheadRef.current = playhead
    if (previewScope === 'sequence') {
      if (playing) {
        wasPlayingRef.current = true
        return
      }
      wasPlayingRef.current = false
      applySequenceTime(playhead)
      return
    }
    if (playing) {
      wasPlayingRef.current = true
      return
    }
    const engine = getAnimEngine()
    if (wasPlayingRef.current) {
      wasPlayingRef.current = false
      // A transport action may pause and explicitly seek in the same React
      // batch (go-to-start/end, preview scrub). Preserve that target. For a
      // pure pause, keep the exact rAF-owned time instead of snapping back to
      // the UI mirror, which is intentionally sampled only every 66 ms.
      const explicitSeek = Math.abs(playhead - previousUiPlayhead) > 0.0001
      if (explicitSeek) {
        engine.seek(playhead)
        return
      }
      const exactPlayhead = engine.getPlayhead()
      if (Math.abs(exactPlayhead - playhead) > 0.0001) {
        setPlayhead(exactPlayhead)
      }
      return
    }
    engine.seek(playhead)
  }, [
    applySequenceTime,
    playhead,
    playing,
    previewScope,
    setPlayhead,
  ])

  // Play / pause control.
  useEffect(() => {
    const engine = getAnimEngine()
    if (previewScope === 'sequence') {
      engine.pause()
      return
    }
    if (playing) engine.play()
    else engine.pause()
    return () => engine.pause()
  }, [playing, previewScope])

  // Master-sequence transport. The animation engine remains the evaluator,
  // but the project clock owns time and seeks the active composition in local
  // coordinates. That keeps scene-local keyframes reusable when the same
  // composition appears more than once in the sequence.
  useEffect(() => {
    if (!playing || previewScope !== 'sequence') return
    const startMaster = useUI.getState().playhead
    const startedAt = performance.now()
    let animationFrame = 0
    let lastUiUpdate = 0

    const tick = (now: number) => {
      const elapsed = Math.max(0, (now - startedAt) / 1000)
      const masterTime = Math.min(sequenceMap.duration, startMaster + elapsed)
      applySequenceTimeRef.current(masterTime)
      if (
        now - lastUiUpdate >= 50 ||
        masterTime >= sequenceMap.duration
      ) {
        lastUiUpdate = now
        setPlayhead(masterTime)
      }
      if (masterTime >= sequenceMap.duration) {
        setPlaying(false)
        return
      }
      animationFrame = window.requestAnimationFrame(tick)
    }

    animationFrame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(animationFrame)
  }, [
    playing,
    previewScope,
    sequenceMap.duration,
    setPlayhead,
    setPlaying,
  ])

  // Engine → UI: while playing, push the engine's playhead into the
  // store at ~15Hz so the UI stays in step without re-rendering every
  // animation frame. Runs on its own interval, not rAF, because the
  // engine's rAF loop is what we're sampling.
  useEffect(() => {
    if (!playing || previewScope === 'sequence') return
    const engine = getAnimEngine()
    const h = window.setInterval(() => {
      setPlayhead(engine.getPlayhead())
      if (!engine.isPlaying()) setPlaying(false)
    }, 66)
    return () => window.clearInterval(h)
  }, [playing, previewScope, setPlayhead, setPlaying])
}
