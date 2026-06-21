// SPDX-License-Identifier: Apache-2.0

import { useEffect } from 'react'
import { useSceneAPI } from '@/scene'
import { getAnimEngine } from '@/anim'
import { useUI } from '@/state/ui'

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
  const playing = useUI((s) => s.playing)
  const playhead = useUI((s) => s.playhead)
  const setPlayhead = useUI((s) => s.setPlayhead)
  const setPlaying = useUI((s) => s.setPlaying)
  const isolatedRange = useUI((s) => s.isolatedRange)
  const workAreaRange = useUI((s) => s.workAreaRange)
  const workAreaPlaybackMode = useUI((s) => s.workAreaPlaybackMode)

  // Attach engine to scene once.
  useEffect(() => {
    getAnimEngine().attach(api)
  }, [api])

  // Mirror isolation/work-area playback into the engine. Isolation
  // keeps its historical behavior and always loops. Otherwise the
  // shared work area can either loop or stop at its end.
  useEffect(() => {
    if (isolatedRange) {
      getAnimEngine().setPlaybackRange({
        start: isolatedRange.start,
        end: isolatedRange.end,
        mode: 'loop',
      })
      return
    }
    getAnimEngine().setPlaybackRange(
      workAreaRange
        ? {
            start: workAreaRange.start,
            end: workAreaRange.end,
            mode: workAreaPlaybackMode,
          }
        : null,
    )
  }, [isolatedRange, workAreaPlaybackMode, workAreaRange])

  // UI → engine: sync playhead when NOT playing (during scrub / fields).
  useEffect(() => {
    if (!playing) getAnimEngine().seek(playhead)
  }, [playhead, playing])

  // Play / pause control.
  useEffect(() => {
    const engine = getAnimEngine()
    if (playing) engine.play()
    else engine.pause()
    return () => engine.pause()
  }, [playing])

  // Engine → UI: while playing, push the engine's playhead into the
  // store at ~15Hz so the UI stays in step without re-rendering every
  // animation frame. Runs on its own interval, not rAF, because the
  // engine's rAF loop is what we're sampling.
  useEffect(() => {
    if (!playing) return
    const engine = getAnimEngine()
    const h = window.setInterval(() => {
      setPlayhead(engine.getPlayhead())
      if (!engine.isPlaying()) setPlaying(false)
    }, 66)
    return () => window.clearInterval(h)
  }, [playing, setPlayhead, setPlaying])
}
