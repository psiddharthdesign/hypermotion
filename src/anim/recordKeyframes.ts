// SPDX-License-Identifier: Apache-2.0

import type { KeyframeValue, NodeId, PropertyId } from '@/scene'
import type { SceneAPI } from '@/scene/doc'
import { effectBlurPropertyId } from '@/scene/props'
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
  blendMode: 'appearance.blendMode',
}

const SHAPE_PROP_IDS: Partial<Record<string, PropertyId>> = {
  startAngle: 'shape.arcStart',
  sweep: 'shape.arcSweep',
  innerRadius: 'shape.arcInnerRadius',
}

/** Map from `size` patch keys to their PropertyId. */
const SIZE_PROP_IDS: Partial<Record<string, PropertyId>> = {
  width: 'size.width',
  height: 'size.height',
}

const MOTION_PATH_PROP_IDS: Partial<Record<string, PropertyId>> = {
  progress: 'motionPath.progress',
}

const LAYOUT_PROP_IDS: Partial<Record<string, PropertyId>> = {
  gap: 'layout.gap',
  direction: 'layout.direction',
}

const LAYOUT_PADDING_PROP_IDS = {
  top: 'layout.padding.top',
  right: 'layout.padding.right',
  bottom: 'layout.padding.bottom',
  left: 'layout.padding.left',
} as const satisfies Record<string, PropertyId>

const CAMERA_PROP_IDS: Partial<Record<string, PropertyId>> = {
  focusDistance: 'camera.focusDistance',
  focusX: 'camera.focusX',
  focusY: 'camera.focusY',
  focusWorldX: 'camera.focusWorldX',
  focusWorldY: 'camera.focusWorldY',
  focusWorldZ: 'camera.focusWorldZ',
  focusRadius: 'camera.focusRadius',
  focusFalloff: 'camera.focusFalloff',
  pointOfInterestX: 'camera.pointOfInterestX',
  pointOfInterestY: 'camera.pointOfInterestY',
  pointOfInterestZ: 'camera.pointOfInterestZ',
  focalLength: 'camera.focalLength',
  fieldOfView: 'camera.fieldOfView',
  nearClip: 'camera.nearClip',
  farClip: 'camera.farClip',
  aperture: 'camera.aperture',
  fStop: 'camera.fStop',
  bladeCount: 'camera.bladeCount',
  bladeRotation: 'camera.bladeRotation',
  bokehRatio: 'camera.bokehRatio',
  iso: 'camera.iso',
  blurLevel: 'camera.blurLevel',
  blurQuality: 'camera.blurQuality',
  chromaticAberrationAmount: 'camera.chromaticAberrationAmount',
  chromaticAberrationAngle: 'camera.chromaticAberrationAngle',
  bloomStrength: 'camera.bloomStrength',
  bloomRadius: 'camera.bloomRadius',
  bloomThreshold: 'camera.bloomThreshold',
  vhsIntensity: 'camera.vhsIntensity',
  vhsNoise: 'camera.vhsNoise',
  vhsScanlines: 'camera.vhsScanlines',
  vhsColorBleed: 'camera.vhsColorBleed',
}

export type PatchGroup =
  | 'transform'
  | 'appearance'
  | 'shape'
  | 'size'
  | 'camera'
  | 'motionPath'
  | 'layout'

export interface PatchKeyframeValue {
  propertyId: PropertyId
  value: KeyframeValue
}

/** Convert a scene-group patch into the keyframeable property/value pairs. */
export function keyframeValuesForPatch(
  group: PatchGroup,
  patch: Record<string, unknown>,
): PatchKeyframeValue[] {
  const map = propertyMapForGroup(group)
  const values: PatchKeyframeValue[] = []
  for (const key of Object.keys(patch)) {
    if (group === 'appearance' && key === 'effectBlur') {
      const effectBlur = patch[key]
      if (
        effectBlur &&
        typeof effectBlur === 'object' &&
        'effectId' in effectBlur &&
        'value' in effectBlur &&
        typeof effectBlur.effectId === 'string' &&
        typeof effectBlur.value === 'number' &&
        Number.isFinite(effectBlur.value)
      ) {
        values.push({
          propertyId: effectBlurPropertyId(effectBlur.effectId),
          value: effectBlur.value,
        })
      }
      continue
    }
    if (group === 'layout' && key === 'padding') {
      const padding = patch[key]
      if (padding && typeof padding === 'object') {
        for (const [side, propertyId] of Object.entries(
          LAYOUT_PADDING_PROP_IDS,
        )) {
          const value = (padding as Record<string, unknown>)[side]
          if (typeof value === 'number' && Number.isFinite(value)) {
            values.push({ propertyId, value })
          }
        }
      }
      continue
    }
    const propertyId = map[key]
    if (!propertyId) continue
    const value = keyframeValueForPatch(propertyId, patch[key])
    if (value === undefined || value === null) continue
    if (
      typeof value !== 'number' &&
      typeof value !== 'string' &&
      typeof value !== 'object'
    ) {
      continue
    }
    values.push({ propertyId, value })
  }
  return values
}

/**
 * Fill edits arrive from the Inspector as a complete Fill object, while the
 * animation track stores the solid color string that the engine interpolates.
 * Gradient and image fills remain editable but do not create a color track.
 */
function keyframeValueForPatch(
  propertyId: PropertyId,
  value: unknown,
): KeyframeValue | null | undefined {
  if (propertyId !== 'appearance.fill') {
    return value as KeyframeValue | null | undefined
  }
  if (
    value &&
    typeof value === 'object' &&
    'kind' in value &&
    value.kind === 'solid' &&
    'color' in value &&
    typeof value.color === 'string'
  ) {
    return value.color
  }
  return typeof value === 'string' ? value : null
}

/**
 * Stamp keyframes for every animatable key in `patch`. The value is the
 * *post-patch* value — callers pass the committed scene value, not the
 * old one, so the stamp reflects what the user just saw.
 *
 * Values are coerced to the property's timeline representation. Fill edits
 * store their solid color string; unsupported values are dropped.
 */
export function recordKeyframesForPatch(
  api: SceneAPI,
  nodeId: NodeId,
  playhead: number,
  group: PatchGroup,
  patch: Record<string, unknown>,
): void {
  for (const { propertyId, value } of keyframeValuesForPatch(group, patch)) {
    addKeyframe(api, nodeId, propertyId, playhead, value)
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
  for (const { propertyId, value } of keyframeValuesForPatch(group, patch)) {
    // Only follow existing tracks — never create new ones here.
    if (!findTrack(api, nodeId, propertyId)) continue
    addKeyframe(api, nodeId, propertyId, playhead, value)
  }
}

function propertyMapForGroup(
  group: PatchGroup,
): Partial<Record<string, PropertyId>> {
  return group === 'transform'
    ? TRANSFORM_PROP_IDS
    : group === 'appearance'
      ? APPEARANCE_PROP_IDS
      : group === 'shape'
        ? SHAPE_PROP_IDS
      : group === 'size'
        ? SIZE_PROP_IDS
      : group === 'motionPath'
        ? MOTION_PATH_PROP_IDS
        : group === 'layout'
          ? LAYOUT_PROP_IDS
          : CAMERA_PROP_IDS
}
