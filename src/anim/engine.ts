// SPDX-License-Identifier: Apache-2.0

import type {
  BlendMode,
  FlexDirection,
  NodeId,
  PropertyId,
  Track,
  TrackId,
  Transform,
  VariantSelection,
} from '@/scene'
import type { SceneAPI } from '@/scene/doc'
import {
  effectIdFromBlurPropertyId,
  propertyDescriptor,
} from '@/scene/props'
import { findCursorComponent } from '@/scene/builtins/cursorComponent'
import { CURSOR_STATES } from '@/scene/builtins/cursorAssets'
import { lerpOklchStrings } from './color'
import { evaluator, type EasingEvaluator } from './easing'
import {
  evaluateLayerMotionPathSample,
  type LayerMotionPath,
} from './layerMotionPath'
import type { TextAnimationConfig } from './textAnimations'

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
 *   - Own layout. Width/height, gap, padding, and direction snapshots are
 *     consumed by the layout hook, with a rect-only fast path for
 *     free-positioned size-only leaves.
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
  /** Discrete override for `node.appearance.blendMode`. */
  blendMode?: BlendMode
  /** Per-effect blur overrides keyed by the effect row's stable id. */
  effectBlur?: Record<string, number>
  /** Editable ellipse geometry overrides. */
  arcStart?: number
  arcSweep?: number
  arcInnerRadius?: number
  /** Numeric layout-size overrides evaluated from size.width/size.height. */
  width?: number
  height?: number
  /** Layout-container overrides consumed by the shared Yoga solve. */
  layoutDirection?: FlexDirection
  layoutGap?: number
  layoutPaddingTop?: number
  layoutPaddingRight?: number
  layoutPaddingBottom?: number
  layoutPaddingLeft?: number
  /** 0→1 progress for text-specific animation effects. */
  textProgress?: number
  /**
   * Uneased 0→1 position between the active text track's authored keys.
   * Renderers use this to distinguish easing overshoot from the real end of
   * the keyframe span.
   */
  textTimelineProgress?: number
  /** Text effect config attached to the active text.progress track. */
  textAnimation?: TextAnimationConfig
  /** 0→1 progress for a generic layer motion path. */
  motionPathProgress?: number
  /** Discrete component selection evaluated from a semantic variant track. */
  variant?: VariantSelection
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
  fStop?: number
  bladeCount?: number
  bladeRotation?: number
  bokehRatio?: number
  iso?: number
  blurLevel?: number
  blurQuality?: number
  chromaticAberrationAmount?: number
  chromaticAberrationAngle?: number
  bloomStrength?: number
  bloomRadius?: number
  bloomThreshold?: number
  vhsIntensity?: number
  vhsNoise?: number
  vhsScanlines?: number
  vhsColorBleed?: number
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
  /**
   * Temporarily replace authored tracks without mutating the scene document.
   * Timeline keyframe drags use this for live canvas feedback, then persist one
   * batched document transaction when the pointer is released.
   */
  setTrackPreview(tracks: ReadonlyMap<TrackId, Track> | null): void
  /** Subscribe via the `useSyncExternalStore` convention. */
  subscribe: (cb: () => void) => () => void
  getSnapshot: () => Record<NodeId, AnimatedValue>
}

interface CompiledTextTrackGroup {
  nodeId: NodeId
  tracks: Track[]
}

interface CompiledLayerMotionPath {
  nodeId: NodeId
  path: LayerMotionPath
  transform: Pick<Transform, 'x' | 'y' | 'z' | 'rotation'>
}

interface CompiledCursorVariantBinding {
  instanceId: NodeId
  stateNodeIds: Map<string, NodeId>
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
  let snapshotElapsedMs = 0
  // Restrict play looping to a sub-range of the comp. Null = full
  // duration (the default). Set by useAnim to mirror UI-side
  // isolation. tick() wraps modulo this range when set.
  let playbackRange: { start: number; end: number; mode: 'loop' | 'stop' } | null = null
  // Snapshot is a fresh object each update (React sees identity change).
  let snapshot: Record<NodeId, AnimatedValue> = {}
  const listeners = new Set<() => void>()
  let unsubscribeScene: (() => void) | null = null
  const notify = () => {
    for (const l of listeners) l()
  }

  // Evaluator cache: keyed by track id. Invalidated on scene version
  // bump (the whole cache clears — simpler than diffing).
  const evaluatorCache = new Map<string, EasingEvaluator>()
  let cachedVersion = -1
  let compiledTracks: Track[] = []
  let compiledTextTrackGroups: CompiledTextTrackGroup[] = []
  let compiledLayerMotionPaths: CompiledLayerMotionPath[] = []
  let compiledCursorVariantBindings: CompiledCursorVariantBinding[] = []
  let trackPreview: ReadonlyMap<TrackId, Track> | null = null

  const tick = (now: number) => {
    // The callback represented by this handle is running now, so there is no
    // pending frame to cancel until we explicitly schedule the next one.
    rafHandle = 0
    if (!playing || !api) return
    const dtMs = Math.max(0, now - lastTick)
    const dt = dtMs / 1000
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
        } else {
          const over = (p - playbackRange.start) % span
          p = playbackRange.start + over
        }
      }
      playhead = p
    } else {
      playhead = next > meta.duration ? next % meta.duration : next
    }
    // The playhead follows the display clock exactly, but rebuilding React +
    // WebGL more often than the composition can contain a distinct frame only
    // duplicates work. On a 120 Hz monitor that previously rendered a 60 fps
    // scene twice per frame and made complex text/DOF previews miss deadlines.
    // Coalesce snapshot notifications to the authored frame rate (capped at
    // the editor's 60 fps realtime budget); timeline markers continue reading
    // the exact playhead from getPlayhead() on every display rAF.
    snapshotElapsedMs += dtMs
    const previewFrameRate = Math.max(
      1,
      Math.min(60, Number.isFinite(meta.frameRate) ? meta.frameRate : 60),
    )
    const snapshotIntervalMs = 1000 / previewFrameRate
    if (!playing || snapshotElapsedMs + 0.25 >= snapshotIntervalMs) {
      snapshotElapsedMs %= snapshotIntervalMs
      recompute()
    }
    if (playing) rafHandle = requestAnimationFrame(tick)
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
      // Track topology and keyframes only change with the scene version.
      // Compile once here instead of scanning every scene node and sorting
      // every keyframe array on every animation frame.
      const nextTracks: Track[] = []
      const textTracksByNode = new Map<NodeId, Track[]>()
      const cursorComponentId = findCursorComponent(api)
      for (const authoredTrack of api.getAllTracks()) {
        // Preserve the previous engine semantics: tracks targeting deleted
        // nodes are inert and must not reappear in the animated snapshot.
        const targetNode = api.getNode(authoredTrack.nodeId)
        if (!targetNode) continue
        // Built-in cursors use ordinary X/Y/Z keyframes. Legacy cursor path
        // tracks are intentionally inert now that the cursor rail editor has
        // been removed.
        if (
          authoredTrack.propertyId === 'motionPath.progress' &&
          targetNode.kind === 'instance' &&
          targetNode.componentId === cursorComponentId
        ) {
          continue
        }
        const track = compileTrack(authoredTrack)
        if (track.propertyId !== 'text.progress') {
          nextTracks.push(track)
          continue
        }
        let nodeTracks = textTracksByNode.get(track.nodeId)
        if (!nodeTracks) {
          nodeTracks = []
          textTracksByNode.set(track.nodeId, nodeTracks)
        }
        nodeTracks.push(track)
      }
      compiledTracks = nextTracks
      compiledTextTrackGroups = []
      for (const [nodeId, tracks] of textTracksByNode) {
        compiledTextTrackGroups.push({ nodeId, tracks })
      }
      compiledLayerMotionPaths = []
      for (const nodeId of api.getAllNodeIds()) {
        const node = api.getNode(nodeId)
        if (
          !node?.motionPath ||
          (node.kind === 'instance' &&
            node.componentId === cursorComponentId)
        ) {
          continue
        }
        compiledLayerMotionPaths.push({
          nodeId,
          path: node.motionPath,
          transform: {
            x: node.transform.x,
            y: node.transform.y,
            z: node.transform.z,
            rotation: node.transform.rotation,
          },
        })
      }
      compiledCursorVariantBindings = compileCursorVariantBindings(
        api,
        nextTracks,
        cursorComponentId,
      )
    }
    const out: Record<NodeId, AnimatedValue> = {}
    for (const authoredTrack of compiledTracks) {
      const track = trackPreview?.get(authoredTrack.id) ?? authoredTrack
      const value = out[track.nodeId] ?? { ...EMPTY_VALUE }
      applyTrack(track, playhead, value, evaluatorCache)
      out[track.nodeId] = value
    }
    for (const group of compiledTextTrackGroups) {
      const track = selectTextProgressTrack(
        group.tracks,
        trackPreview,
        playhead,
      )
      if (!track) continue
      const value = out[group.nodeId] ?? { ...EMPTY_VALUE }
      applyTextProgressTrack(track, playhead, value, evaluatorCache)
      out[group.nodeId] = value
    }
    for (const binding of compiledLayerMotionPaths) {
      const value = out[binding.nodeId] ?? { ...EMPTY_VALUE }
      resolveLayerMotionPath(binding, value)
      out[binding.nodeId] = value
    }
    applyCursorVariantBindings(out, compiledCursorVariantBindings)
    snapshot = out
    notify()
  }

  return {
    attach(a) {
      // Fast Refresh and provider remounts can reattach the singleton. Keep
      // exactly one scene listener; leaked subscriptions multiply every
      // mutation/recompute and show up as large playback-start stalls in dev.
      unsubscribeScene?.()
      api = a
      cachedVersion = -1
      compiledTracks = []
      compiledTextTrackGroups = []
      compiledLayerMotionPaths = []
      compiledCursorVariantBindings = []
      trackPreview = null
      // On any scene mutation (including track edits), refresh the
      // snapshot so the render layer stays coherent with the data.
      unsubscribeScene = a.subscribe(() => {
        // A drag preview deliberately owns the visible track timing. Ignore
        // the final document commit until the preview is cleared; that turns
        // commit + clear into one coherent canvas refresh instead of two.
        if (!playing && !trackPreview) recompute()
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
      // rAF timestamps and performance.now() share the same monotonic clock.
      // Starting here preserves the real time before the first callback
      // instead of repeating the starting pose for one display frame.
      lastTick = performance.now()
      snapshotElapsedMs = 0
      rafHandle = requestAnimationFrame(tick)
    },
    pause() {
      if (!playing) return
      playing = false
      if (rafHandle) cancelAnimationFrame(rafHandle)
      rafHandle = 0
      // The display-rate playhead can sit between two authored-frame snapshot
      // publications. Flush that exact time before going idle so the paused
      // canvas, inspector, and timeline never disagree by one frame.
      snapshotElapsedMs = 0
      recompute()
    },
    isPlaying: () => playing,
    seek(t) {
      playhead = Math.max(0, t)
      snapshotElapsedMs = 0
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
    setTrackPreview(tracks) {
      trackPreview =
        tracks && tracks.size > 0
          ? new Map(
              [...tracks].map(([trackId, track]) => [
                trackId,
                compileTrack(track),
              ] as const),
            )
          : null
      recompute()
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
 * Pick the one semantic text clip that owns a node at `t`.
 *
 * Text effects are authored as separate `text.progress` tracks so an In,
 * Return, and Out can coexist on the same layer. Applying every track makes
 * document iteration order decide the result because semantic text tracks
 * hold their endpoint outside their authored range. Ownership instead moves
 * forward chronologically: the latest clip that has started wins, and before
 * the first clip starts the earliest upcoming clip supplies its initial pose.
 * Once a later clip starts it keeps ownership after ending, so a completed Out
 * cannot snap back to an older, overlapping In.
 *
 * Groups are compiled only when the scene version changes. This selector does
 * one allocation-free linear pass per animated text node and reads drag
 * previews in place, avoiding per-frame filtering or sorting.
 */
function selectTextProgressTrack(
  authoredTracks: readonly Track[],
  trackPreview: ReadonlyMap<TrackId, Track> | null,
  t: number,
): Track | null {
  let started: Track | null = null
  let startedAt = Number.NEGATIVE_INFINITY
  let upcoming: Track | null = null
  let upcomingAt = Number.POSITIVE_INFINITY

  for (const authoredTrack of authoredTracks) {
    const track = trackPreview?.get(authoredTrack.id) ?? authoredTrack
    if (track.keyframes.length < 2) continue
    const start = track.keyframes[0]!.time
    if (start <= t) {
      if (
        start > startedAt ||
        (start === startedAt && (!started || track.id > started.id))
      ) {
        started = track
        startedAt = start
      }
      continue
    }
    if (
      start < upcomingAt ||
      (start === upcomingAt && (!upcoming || track.id > upcoming.id))
    ) {
      upcoming = track
      upcomingAt = start
    }
  }

  return started ?? upcoming
}

function compileTrack(track: Track): Track {
  let sorted = true
  for (let index = 1; index < track.keyframes.length; index++) {
    if (track.keyframes[index - 1]!.time > track.keyframes[index]!.time) {
      sorted = false
      break
    }
  }
  return sorted
    ? track
    : {
        ...track,
        keyframes: [...track.keyframes].sort((a, b) => a.time - b.time),
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
  if (track.propertyId === 'text.progress') {
    applyTextProgressTrack(track, t, into, cache)
    return
  }
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
  const descriptor = propertyDescriptor(track.propertyId)
  if (descriptor?.interpolation === 'discrete') {
    // State-like properties change exactly on the destination keyframe.
    // Their value must not jump early if a user applies an overshooting
    // easing curve to the segment.
    writeProperty(track.propertyId, rawU < 1 ? a.value : b.value, into)
    return
  }
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
    // free. Imported hexadecimal endpoints are normalized into OKLCH by the
    // interpolator. Truly unsupported formats still fall through to step so
    // the animation advances — a hard stop at u<1 / end at u=1.
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

function applyTextProgressTrack(
  track: Track,
  t: number,
  into: AnimatedValue,
  cache: Map<string, EasingEvaluator>,
): void {
  const kfs = track.keyframes
  if (kfs.length < 2) return
  const first = kfs[0]!
  const last = kfs[kfs.length - 1]!
  const textAnimation = track.textAnimation ?? undefined
  const mode = textAnimation?.mode
  if (t < first.time) {
    if ((mode === 'in' || mode === 'out') && typeof first.value === 'number') {
      into.textProgress = first.value
      into.textTimelineProgress = first.value
      into.textAnimation = textAnimation
    }
    return
  }
  if (t > last.time) {
    if ((mode === 'in' || mode === 'out') && typeof last.value === 'number') {
      into.textProgress = last.value
      into.textTimelineProgress = last.value
      into.textAnimation = textAnimation
    }
    return
  }

  let a = first
  let b = last
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
  if (typeof av !== 'number' || typeof bv !== 'number') return
  into.textProgress = av + (bv - av) * u
  into.textTimelineProgress = av + (bv - av) * rawU
  if (track.textAnimation) into.textAnimation = track.textAnimation
}

/**
 * Write one resolved track value into the per-node AnimatedValue.
 *
 * Post-layout numeric and color properties are applied directly here.
 * Cursor variant selections are retained as semantic values and expanded
 * into their materialized state children after the ordinary tracks resolve.
 * Layout-affecting values are retained as read-only overrides for useLayout's
 * shared Yoga pass; the authored scene document is never changed per frame.
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
  if (id === 'appearance.blendMode') {
    if (isBlendMode(value)) into.blendMode = value
    return
  }
  if (id === 'variant') {
    const selection = variantSelection(value)
    if (selection) into.variant = selection
    return
  }
  if (id === 'layout.direction') {
    if (value === 'row' || value === 'column') into.layoutDirection = value
    return
  }
  if (typeof value !== 'number') return
  const effectId = effectIdFromBlurPropertyId(id)
  if (effectId) {
    ;(into.effectBlur ??= {})[effectId] = value
    return
  }
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
    case 'shape.arcStart':
      into.arcStart = value
      break
    case 'shape.arcSweep':
      into.arcSweep = value
      break
    case 'shape.arcInnerRadius':
      into.arcInnerRadius = value
      break
    case 'size.width':
      into.width = Math.max(0, value)
      break
    case 'size.height':
      into.height = Math.max(0, value)
      break
    case 'layout.gap':
      into.layoutGap = Math.max(0, value)
      break
    case 'layout.padding.top':
      into.layoutPaddingTop = Math.max(0, value)
      break
    case 'layout.padding.right':
      into.layoutPaddingRight = Math.max(0, value)
      break
    case 'layout.padding.bottom':
      into.layoutPaddingBottom = Math.max(0, value)
      break
    case 'layout.padding.left':
      into.layoutPaddingLeft = Math.max(0, value)
      break
    case 'text.progress':
      into.textProgress = value
      break
    case 'motionPath.progress':
      into.motionPathProgress = value
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
    case 'camera.fStop':
      into.fStop = value
      break
    case 'camera.bladeCount':
      into.bladeCount = value
      break
    case 'camera.bladeRotation':
      into.bladeRotation = value
      break
    case 'camera.bokehRatio':
      into.bokehRatio = value
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
    case 'camera.chromaticAberrationAmount':
      into.chromaticAberrationAmount = value
      break
    case 'camera.chromaticAberrationAngle':
      into.chromaticAberrationAngle = value
      break
    case 'camera.bloomStrength':
      into.bloomStrength = value
      break
    case 'camera.bloomRadius':
      into.bloomRadius = value
      break
    case 'camera.bloomThreshold':
      into.bloomThreshold = value
      break
    case 'camera.vhsIntensity':
      into.vhsIntensity = value
      break
    case 'camera.vhsNoise':
      into.vhsNoise = value
      break
    case 'camera.vhsScanlines':
      into.vhsScanlines = value
      break
    case 'camera.vhsColorBleed':
      into.vhsColorBleed = value
      break
    // Other PropertyIds are not represented by AnimatedValue yet.
    default:
      break
  }
}

function variantSelection(value: unknown): VariantSelection | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const entries = Object.entries(value)
  if (
    entries.length === 0 ||
    entries.some(([, axisValue]) => typeof axisValue !== 'string')
  ) {
    return null
  }
  return value as VariantSelection
}

function compileCursorVariantBindings(
  api: SceneAPI,
  tracks: readonly Track[],
  cursorComponentId: NodeId | null,
): CompiledCursorVariantBinding[] {
  if (!cursorComponentId) return []
  const instanceIds = new Set(
    tracks
      .filter((track) => track.propertyId === 'variant')
      .map((track) => track.nodeId),
  )
  const bindings: CompiledCursorVariantBinding[] = []
  for (const instanceId of instanceIds) {
    const instance = api.getNode(instanceId)
    if (
      !instance ||
      instance.kind !== 'instance' ||
      instance.componentId !== cursorComponentId
    ) {
      continue
    }
    const stateNodeIds = new Map<string, NodeId>()
    const queue = api.getChildren(instanceId).map((child) => child.id)
    while (queue.length > 0) {
      const nodeId = queue.shift()
      if (!nodeId) continue
      const node = api.getNode(nodeId)
      if (!node) continue
      const state =
        node.kind === 'vector' ? node.source?.metadata?.state : undefined
      if (
        typeof state === 'string' &&
        (CURSOR_STATES as readonly string[]).includes(state)
      ) {
        stateNodeIds.set(state, node.id)
      }
      queue.push(...api.getChildren(node.id).map((child) => child.id))
    }
    if (stateNodeIds.size === CURSOR_STATES.length) {
      bindings.push({ instanceId, stateNodeIds })
    }
  }
  return bindings
}

/**
 * Cursor states are ordinary materialized vector children. A semantic State
 * track therefore resolves into one opacity override per child. This pass is
 * intentionally last: once a cursor owns a State track, that track is the
 * authoritative visibility channel even if an older scene still contains the
 * legacy generated child-opacity tracks.
 */
function applyCursorVariantBindings(
  values: Record<NodeId, AnimatedValue>,
  bindings: readonly CompiledCursorVariantBinding[],
): void {
  for (const binding of bindings) {
    const state = values[binding.instanceId]?.variant?.State
    if (typeof state !== 'string' || !binding.stateNodeIds.has(state)) continue
    for (const [candidate, nodeId] of binding.stateNodeIds) {
      const value = values[nodeId] ?? { ...EMPTY_VALUE }
      value.opacity = candidate === state ? 1 : 0
      values[nodeId] = value
    }
  }
}

/**
 * Compose a generic spatial rail after ordinary property tracks.
 *
 * Transform tracks retain their authored REPLACE semantics and become the
 * path's base pose. The sampled rail is then added as a local pixel offset.
 * Auto-orient similarly layers the path heading and saved rotation offset on
 * top of an explicit rotation track (or the node's static rotation).
 */
function resolveLayerMotionPath(
  binding: CompiledLayerMotionPath,
  into: AnimatedValue,
): void {
  const progress = clamp01(
    into.motionPathProgress ?? binding.path.progress,
  )
  const sample = evaluateLayerMotionPathSample(binding.path, progress)
  into.motionPathProgress = progress
  into.x = (into.x ?? binding.transform.x) + sample.position.x
  into.y = (into.y ?? binding.transform.y) + sample.position.y
  into.z = (into.z ?? binding.transform.z) + sample.position.z

  if (
    binding.path.autoOrient &&
    Math.hypot(sample.tangent.x, sample.tangent.y) > 1e-8
  ) {
    const pathRotation =
      (Math.atan2(sample.tangent.y, sample.tangent.x) * 180) / Math.PI
    into.rotation =
      (into.rotation ?? binding.transform.rotation) +
      pathRotation +
      binding.path.rotationOffset
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
}

function isBlendMode(value: unknown): value is BlendMode {
  switch (value) {
    case 'normal':
    case 'multiply':
    case 'screen':
    case 'overlay':
    case 'darken':
    case 'lighten':
    case 'color-dodge':
    case 'color-burn':
    case 'hard-light':
    case 'soft-light':
    case 'difference':
    case 'exclusion':
    case 'hue':
    case 'saturation':
    case 'color':
    case 'luminosity':
      return true
    default:
      return false
  }
}
