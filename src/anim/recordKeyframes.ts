// SPDX-License-Identifier: Apache-2.0

import type { NodeId, PropertyId } from '@/scene'
import type { SceneAPI } from '@/scene/doc'
import { addKeyframe, findTrack } from './tracks'

/**
 * Auto-keyframe (record mode) helper.
 *
 * When the user flips the transport's record button on, any committed
 * edit to an animatable property should stamp a keyframe at the current
 * playhead — mirrors After Effects's stopwatch. The Inspector and the
 * canvas drag hook both need this behavior, so the policy lives here
 * rather than being duplicated across call sites.
 *
 * These helpers are *pure*: they take an `api`, a `nodeId`, a patch, and
 * a `playhead`. Callers are responsible for gating on
 * `useUI.getState().recording` — that keeps `anim/` free of React/UI
 * dependencies and keeps the engine layer independent of the store.
 *
 * Only properties that are in the PropertyId registry get recorded. A
 * patch to a group field that isn't animatable (e.g. `appearance.stroke`)
 * is silently dropped, which matches the Inspector's existing "no
 * stopwatch" story for those fields.
 */

/** Map from `transform` patch keys to their PropertyId. */
const TRANSFORM_PROP_IDS: Partial<Record<string, PropertyId>> = {
  x: 'transform.x',
  y: 'transform.y',
  z: 'transform.z',
  rotation: 'transform.rotation',
  // 3D rotation axes — exposed on cameras today, in the data model
  // for every node. Without these entries Inspector edits to Rotate X
  // / Rotate Y silently failed to stamp keyframes (record mode) or
  // update live tracks (REPLACE-semantics field edits), so the user's
  // typed value got immediately overridden by the track on the next
  // engine tick — the "rotations not working instantly" bug.
  rotationX: 'transform.rotationX',
  rotationY: 'transform.rotationY',
  scaleX: 'transform.scaleX',
  scaleY: 'transform.scaleY',
  anchorX: 'transform.anchorX',
  anchorY: 'transform.anchorY',
  anchorZ: 'transform.anchorZ',
}

/** Map from `appearance` patch keys to their PropertyId. */
const APPEARANCE_PROP_IDS: Partial<Record<string, PropertyId>> = {
  opacity: 'appearance.opacity',
  cornerRadius: 'appearance.cornerRadius',
  fill: 'appearance.fill',
}

/** Map from `size` patch keys to their PropertyId. */
const SIZE_PROP_IDS: Partial<Record<string, PropertyId>> = {
  width: 'size.width',
  height: 'size.height',
}

const CAMERA_PROP_IDS: Partial<Record<string, PropertyId>> = {
  focusDistance: 'camera.focusDistance',
  focusX: 'camera.focusX',
  focusY: 'camera.focusY',
  focusWorldX: 'camera.focusWorldX',
  focusWorldY: 'camera.focusWorldY',
  focusWorldZ: 'camera.focusWorldZ',
  pointOfInterestX: 'camera.pointOfInterestX',
  pointOfInterestY: 'camera.pointOfInterestY',
  pointOfInterestZ: 'camera.pointOfInterestZ',
  focalLength: 'camera.focalLength',
  fieldOfView: 'camera.fieldOfView',
  nearClip: 'camera.nearClip',
  farClip: 'camera.farClip',
  aperture: 'camera.aperture',
  blurLevel: 'camera.blurLevel',
  blurQuality: 'camera.blurQuality',
}

type PatchGroup = 'transform' | 'appearance' | 'size' | 'camera'

/**
 * Stamp keyframes for every animatable key in `patch`. The value is the
 * *post-patch* value — callers pass the committed scene value, not the
 * old one, so the stamp reflects what the user just saw.
 *
 * Values are coerced to plain JSON: numbers, strings, and Fill objects
 * are all valid KeyframeValues. Anything else is dropped.
 */
export function recordKeyframesForPatch(
  api: SceneAPI,
  nodeId: NodeId,
  playhead: number,
  group: PatchGroup,
  patch: Record<string, unknown>,
): void {
  const map =
    group === 'transform'
      ? TRANSFORM_PROP_IDS
      : group === 'appearance'
        ? APPEARANCE_PROP_IDS
        : group === 'size'
          ? SIZE_PROP_IDS
          : CAMERA_PROP_IDS
  for (const key of Object.keys(patch)) {
    const pid = map[key]
    if (!pid) continue
    const v = patch[key]
    if (v === undefined || v === null) continue
    // KeyframeValue accepts number | string | Fill | Size literal. We
    // trust the caller that the scene has just accepted this value, so
    // a reasonable-looking primitive or object is safe to stamp.
    if (
      typeof v !== 'number' &&
      typeof v !== 'string' &&
      typeof v !== 'object'
    ) {
      continue
    }
    addKeyframe(api, nodeId, pid, playhead, v as never)
  }
}

/**
 * "Live track" companion to recordKeyframesForPatch.
 *
 * Under REPLACE semantics (engine.ts), an active track on a property
 * fully overrides the static scene value whenever the playhead is on
 * any keyframe span — and a one-keyframe track holds that value at
 * every time. So if the user types into an Inspector field but a
 * track already exists, the static-value update they see in state
 * gets immediately stomped by the track on the next render.
 *
 * Fix: any time a patch lands on a property that *already has a
 * track*, also stamp/replace a keyframe at the current playhead with
 * the new value. `addKeyframe` already overwrites in place when one
 * exists at this time, so the call is idempotent.
 *
 * Crucially, this DOES NOT create new tracks — that's still the
 * record-mode (stopwatch) job. We only follow tracks the user
 * already authored. So a field edit on a non-animated property
 * behaves exactly as before.
 */
export function stampToActiveTracksForPatch(
  api: SceneAPI,
  nodeId: NodeId,
  playhead: number,
  group: PatchGroup,
  patch: Record<string, unknown>,
): void {
  const map =
    group === 'transform'
      ? TRANSFORM_PROP_IDS
      : group === 'appearance'
        ? APPEARANCE_PROP_IDS
        : group === 'size'
          ? SIZE_PROP_IDS
          : CAMERA_PROP_IDS
  for (const key of Object.keys(patch)) {
    const pid = map[key]
    if (!pid) continue
    // Only follow existing tracks — never create new ones here.
    if (!findTrack(api, nodeId, pid)) continue
    const v = patch[key]
    if (v === undefined || v === null) continue
    if (
      typeof v !== 'number' &&
      typeof v !== 'string' &&
      typeof v !== 'object'
    ) {
      continue
    }
    addKeyframe(api, nodeId, pid, playhead, v as never)
  }
}
