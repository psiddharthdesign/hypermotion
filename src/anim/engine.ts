// SPDX-License-Identifier: Apache-2.0

import type { NodeId, PropertyId, Track } from '@/scene'
import type { SceneAPI } from '@/scene/doc'
import { PROPERTIES } from '@/scene/props'
import { lerpOklchStrings } from './color'
import { evaluator, type EasingEvaluator } from './easing'

/**
 * Animation engine — the only thing in the codebase allowed to drive
 * the rAF tick. Reads tracks off the scene, evaluates each track at
 * the current playhead, writes a consolidated per-node AnimatedValue
 * snapshot, and notifies subscribers.
 *
 * What the engine does:
 *   - Keep a monotonic playhead in seconds.
 *   - On each tick, for each track, find the active keyframe pair and
 *     interpolate with the easing from the left keyframe (or track
 *     default).
 *   - Write the result into a `Record<NodeId, AnimatedValue>` snapshot.
 *   - Call subscribers so React components re-render.
 *
 * What the engine does NOT do:
 *   - Mutate the scene tree per frame.
 *   - Trigger Yoga resolves per frame. Layout-property keyframes
 *     (gap, padding, direction) will go through a FLIP pass added in
 *     a follow-up; for MVP only the transform/opacity properties are
 *     live, which never require a relayout.
 *
 * Lifecycle: `getAnimEngine()` returns a module-scope singleton that
 * binds to the scene when `attach()` is called. The rAF loop starts
 * on `play()` and stops on `pause()`.
 */

/**
 * REPLACE semantics: every field is optional. A defined value means the
 * engine has computed an override for this property at the current
 * playhead — composition should USE this instead of the static. Absence
 * means "no active track" and the renderer falls through to the static
 * value on the node.
 *
 * This is a deliberate shift from the old delta/factor model. With
 * delta, stamping a keyframe from the user's current pose produced a
 * doubled effect (static + delta where delta IS the new value). REPLACE
 * makes keyframe values absolute — what you see in the Inspector is
 * what the timeline stores — which is what every other motion tool
 * designers come from (AE, Jitter, Rive) does.
 *
 * The trade-off: presets can't be "pure deltas from wherever the node
 * currently is." `applyPreset` now reads the node's static transform at
 * apply time and writes absolute keyframes that include it, so
 * "slide-in-left on a node at x=500" still lands correctly at x=500
 * after animating in from x=580.
 */
export interface AnimatedValue {
  x?: number
  y?: number
  /** Z depth on the camera's optical axis. 0 = focal plane. */
  z?: number
  rotation?: number
  /** Pitch (X-axis rotation), degrees. */
  rotationX?: number
  /** Yaw (Y-axis rotation), degrees. */
  rotationY?: number
  scaleX?: number
  scaleY?: number
  anchorX?: number
  anchorY?: number
  anchorZ?: number
  opacity?: number
  /** Override for `node.appearance.cornerRadius`. */
  cornerRadius?: number
  /** Override for the node's `appearance.fill` solid color. */
  fill?: string
  /** 0→1 progress for text-specific animation effects. */
  textProgress?: number
  focusDistance?: number
  focusX?: number
  focusY?: number
  focusWorldX?: number
  focusWorldY?: number
  focusWorldZ?: number
  focusRadius?: number
  focusFalloff?: number
  pointOfInterestX?: number
  pointOfInterestY?: number
  pointOfInterestZ?: number
  focalLength?: number
  fieldOfView?: number
  nearClip?: number
  farClip?: number
  aperture?: number
  iso?: number
  blurLevel?: number
  blurQuality?: number
}

/** Empty snapshot value — no tracks means no overrides. */
const EMPTY_VALUE: AnimatedValue = {}

export interface AnimEngine {
  attach(api: SceneAPI): void
  play(): void
  pause(): void
  isPlaying(): boolean
  seek(t: number): void
  getPlayhead(): number
  /**
   * Restrict the play loop to a [start, end] range. While set, tick
   * wraps within the range instead of within `[0, meta.duration]`.
   * Pass `null` to clear the restriction.
   *
   * Used by section isolation — when the editor focuses a section,
   * Space / play stays inside that section and loops there until the
   * user exits isolation.
   */
  setLoopRange(range: { start: number; end: number } | null): void
  setPlaybackRange(
    range: { start: number; end: number; mode?: 'loop' | 'stop' } | null,
  ): void
  /** Subscribe via the `useSyncExternalStore` convention. */
  subscribe: (cb: () => void) => () => void
  getSnapshot: () => Record<NodeId, AnimatedValue>
}

// Module-scope singleton. Multiple components call `getAnimEngine`; the
// engine is a lightweight coordinator, not something we want per-mount.
let SINGLETON: AnimEngine | null = null

export function getAnimEngine(): AnimEngine {
  if (!SINGLETON) SINGLETON = createAnimEngine()
  return SINGLETON
}

function createAnimEngine(): AnimEngine {
  let api: SceneAPI | null = null
  let playhead = 0
  let playing = false
  let rafHandle = 0
  let lastTick = 0
  // Restrict play looping to a sub-range of the comp. Null = full
  // duration (the default). Set by useAnim to mirror UI-side
  // isolation. tick() wraps modulo this range when set.
  let playbackRange: { start: number; end: number; mode: 'loop' | 'stop' } | null = null
  // Snapshot is a fresh object each update (React sees identity change).
  let snapshot: Record<NodeId, AnimatedValue> = {}
  const listeners = new Set<() => void>()
  const notify = () => {
    for (const l of listeners) l()
  }

  // Evaluator cache: keyed by track id. Invalidated on scene version
  // bump (the whole cache clears — simpler than diffing).
  const evaluatorCache = new Map<string, EasingEvaluator>()
  let cachedVersion = -1

  const tick = (now: number) => {
    if (!playing || !api) return
    const dt = lastTick === 0 ? 0 : (now - lastTick) / 1000
    lastTick = now
    const meta = api.getMeta()
    const next = playhead + dt
    if (playbackRange) {
      // Restrict playback within [start, end]. In loop mode, wrap
      // modulo the span. In stop mode, park exactly at end and pause.
      const span = Math.max(0.0001, playbackRange.end - playbackRange.start)
      let p = next
      if (p < playbackRange.start) p = playbackRange.start
      else if (p > playbackRange.end) {
        if (playbackRange.mode === 'stop') {
          p = playbackRange.end
          playing = false
          if (rafHandle) cancelAnimationFrame(rafHandle)
          rafHandle = 0
        } else {
          const over = (p - playbackRange.start) % span
          p = playbackRange.start + over
        }
      }
      playhead = p
    } else {
      playhead = next > meta.duration ? next % meta.duration : next
    }
    recompute()
    rafHandle = requestAnimationFrame(tick)
  }

  const recompute = () => {
    if (!api) {
      snapshot = {}
      notify()
      return
    }
    // Invalidate evaluator cache on any scene change. Easing definitions
    // live inside track/keyframe objects, so the set of evaluators
    // changes when tracks do. Fine to clear wholesale — rebuild is cheap.
    const v = api.getVersion()
    if (v !== cachedVersion) {
      evaluatorCache.clear()
      cachedVersion = v
    }
    const out: Record<NodeId, AnimatedValue> = {}
    for (const id of api.getAllNodeIds()) {
      const tracks = api.getTracksForNode(id)
      if (tracks.length === 0) continue
      const value: AnimatedValue = { ...EMPTY_VALUE }
      for (const track of tracks) {
        applyTrack(track, playhead, value, evaluatorCache)
      }
      out[id] = value
    }
    snapshot = out
    notify()
  }

  return {
    attach(a) {
      api = a
      // On any scene mutation (including track edits), refresh the
      // snapshot so the render layer stays coherent with the data.
      a.subscribe(() => {
        if (!playing) recompute()
      })
      recompute()
    },
    play() {
      if (playing || !api) return
      // If the playhead is sitting outside the active playback range
      // when the user hits Play, snap it to the start of the range
      // so playback begins at the right place rather than near the
      // boundary the user already left.
      if (playbackRange) {
        if (playhead < playbackRange.start || playhead >= playbackRange.end) {
          playhead = playbackRange.start
        }
      }
      playing = true
      lastTick = 0
      rafHandle = requestAnimationFrame(tick)
    },
    pause() {
      if (!playing) return
      playing = false
      if (rafHandle) cancelAnimationFrame(rafHandle)
      rafHandle = 0
    },
    isPlaying: () => playing,
    seek(t) {
      playhead = Math.max(0, t)
      recompute()
    },
    setLoopRange(range) {
      playbackRange = range ? { ...range, mode: 'loop' } : null
    },
    setPlaybackRange(range) {
      playbackRange = range
        ? { start: range.start, end: range.end, mode: range.mode ?? 'loop' }
        : null
    },
    getPlayhead: () => playhead,
    subscribe: (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    getSnapshot: () => snapshot,
  }
}

/**
 * Apply one track's contribution to a node's animated value.
 *
 * Tracks whose keyframes bracket the current time interpolate; tracks
 * whose playhead is before the first or past the last keyframe hold
 * the end value. Empty tracks no-op.
 */
function applyTrack(
  track: Track,
  t: number,
  into: AnimatedValue,
  cache: Map<string, EasingEvaluator>,
): void {
  const kfs = track.keyframes
  if (kfs.length === 0) return
  // Boundary cases — single keyframe, or t outside range.
  let a = kfs[0]!
  let b = kfs[kfs.length - 1]!
  if (t <= a.time || kfs.length === 1) {
    writeProperty(track.propertyId, a.value, into)
    return
  }
  if (t >= b.time) {
    writeProperty(track.propertyId, b.value, into)
    return
  }
  for (let i = 0; i < kfs.length - 1; i++) {
    const k0 = kfs[i]!
    const k1 = kfs[i + 1]!
    if (t >= k0.time && t <= k1.time) {
      a = k0
      b = k1
      break
    }
  }
  const span = b.time - a.time
  const rawU = span <= 0 ? 0 : (t - a.time) / span
  const cacheKey = track.id + ':' + a.id
  let easer = cache.get(cacheKey)
  if (!easer) {
    easer = evaluator(a.easingOut ?? track.defaultEasing)
    cache.set(cacheKey, easer)
  }
  const u = easer(rawU)

  const av = a.value
  const bv = b.value
  if (typeof av === 'number' && typeof bv === 'number') {
    const val = av + (bv - av) * u
    writeProperty(track.propertyId, val, into)
  } else if (typeof av === 'string' && typeof bv === 'string') {
    // Colour-interpolated properties get OKLCH perceptual tween. We
    // check via the registry rather than sniffing by property name so
    // any future `color`-interpolation property picks this up for
    // free. If the OKLCH parse fails on either endpoint (e.g. a hex
    // that snuck in from an import), fall through to step so the
    // animation still advances — a hard stop at u<1 / end at u=1.
    const descriptor = PROPERTIES[track.propertyId]
    if (descriptor?.interpolation === 'color') {
      const tween = lerpOklchStrings(av, bv, u)
      writeProperty(track.propertyId, tween ?? (u < 1 ? av : bv), into)
    } else {
      // String / variant values on non-color tracks step.
      writeProperty(track.propertyId, u < 1 ? av : bv, into)
    }
  } else {
    // Mixed or unsupported value shapes — step.
    writeProperty(track.propertyId, u < 1 ? av : bv, into)
  }
}

/**
 * Write one resolved track value into the per-node AnimatedValue.
 *
 * Only the transform + appearance.opacity properties are live in MVP.
 * Layout-property tracks are accepted (see PropertyId in scene/types)
 * but the engine skips them until the FLIP pass arrives. Rather than
 * throw for those values, silently no-op — a stray layout track from
 * a saved doc shouldn't crash the renderer.
 */
function writeProperty(
  id: PropertyId,
  value: unknown,
  into: AnimatedValue,
): void {
  // Fill is string-typed; handle first so the numeric short-circuit
  // doesn't drop it.
  if (id === 'appearance.fill') {
    if (typeof value === 'string') into.fill = value
    return
  }
  if (typeof value !== 'number') return
  // REPLACE semantics — a track's keyframe value is the absolute value
  // the rendered property should take on at that instant. Composition
  // happens at the render layer: `animated.x ?? static.x`.
  switch (id) {
    case 'transform.x':
      into.x = value
      break
    case 'transform.y':
      into.y = value
      break
    case 'transform.z':
      into.z = value
      break
    case 'transform.rotation':
      into.rotation = value
      break
    case 'transform.rotationX':
      into.rotationX = value
      break
    case 'transform.rotationY':
      into.rotationY = value
      break
    case 'transform.scaleX':
      into.scaleX = value
      break
    case 'transform.scaleY':
      into.scaleY = value
      break
    case 'transform.anchorX':
      into.anchorX = value
      break
    case 'transform.anchorY':
      into.anchorY = value
      break
    case 'transform.anchorZ':
      into.anchorZ = value
      break
    case 'appearance.opacity':
      into.opacity = value
      break
    case 'appearance.cornerRadius':
      into.cornerRadius = value
      break
    case 'text.progress':
      into.textProgress = value
      break
    case 'camera.focusDistance':
      into.focusDistance = value
      break
    case 'camera.focusX':
      into.focusX = value
      break
    case 'camera.focusY':
      into.focusY = value
      break
    case 'camera.focusWorldX':
      into.focusWorldX = value
      break
    case 'camera.focusWorldY':
      into.focusWorldY = value
      break
    case 'camera.focusWorldZ':
      into.focusWorldZ = value
      break
    case 'camera.focusRadius':
      into.focusRadius = value
      break
    case 'camera.focusFalloff':
      into.focusFalloff = value
      break
    case 'camera.pointOfInterestX':
      into.pointOfInterestX = value
      break
    case 'camera.pointOfInterestY':
      into.pointOfInterestY = value
      break
    case 'camera.pointOfInterestZ':
      into.pointOfInterestZ = value
      break
    case 'camera.focalLength':
      into.focalLength = value
      break
    case 'camera.fieldOfView':
      into.fieldOfView = value
      break
    case 'camera.nearClip':
      into.nearClip = value
      break
    case 'camera.farClip':
      into.farClip = value
      break
    case 'camera.aperture':
      into.aperture = value
      break
    case 'camera.iso':
      into.iso = value
      break
    case 'camera.blurLevel':
      into.blurLevel = value
      break
    case 'camera.blurQuality':
      into.blurQuality = value
      break
    // Other PropertyIds ignored for MVP (layout + variant go through FLIP).
    default:
      break
  }
}
