// SPDX-License-Identifier: Apache-2.0

import type {
  EffectBlurPropertyId,
  EffectBeamRangePropertyId,
  PropertyId,
} from '@/scene/types'

/**
 * Property descriptor registry.
 *
 * Single source of truth for every animatable property: its kind,
 * whether it forces a relayout when changed, how to interpolate, and
 * its default value. The animation engine, inspector, and export
 * pipeline all read from this table instead of embedding their own
 * knowledge of what's keyframable.
 *
 * Adding a property:
 *   1. Extend PropertyId in src/scene/types.ts
 *   2. Add the descriptor below
 *   3. Anim engine will pick it up automatically
 */

export type PropertyGroup = 'transform' | 'deformation' | 'camera' | 'appearance' | 'shape' | 'text' | 'layout' | 'size' | 'semantic' | 'vector' | 'bend'
export type Interpolation = 'numeric' | 'discrete' | 'color' | 'angle' | 'path' | 'paint' | 'stroke'

export interface PropertyDescriptor {
  id: PropertyId
  group: PropertyGroup
  /** Short human label for the inspector and timeline track row. */
  label: string
  /**
   * True if changing this property requires rerunning the Yoga layout
   * pass. FLIP interpolates between the solved states when true.
   */
  layoutAffecting: boolean
  interpolation: Interpolation
  /** JSON-serializable default used when a node is created without the property. */
  defaultValue: unknown
}

type StaticPropertyId = Exclude<PropertyId, EffectBlurPropertyId | EffectBeamRangePropertyId>

export const PROPERTIES: Record<StaticPropertyId, PropertyDescriptor> = {
  // transform group — applied after layout, no relayout needed
  'transform.x': {
    id: 'transform.x', group: 'transform', label: 'X',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0,
  },
  'transform.y': {
    id: 'transform.y', group: 'transform', label: 'Y',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0,
  },
  'transform.z': {
    id: 'transform.z', group: 'transform', label: 'Z',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0,
  },
  'transform.rotation': {
    id: 'transform.rotation', group: 'transform', label: 'Rotation',
    layoutAffecting: false, interpolation: 'angle', defaultValue: 0,
  },
  'transform.rotationX': {
    id: 'transform.rotationX', group: 'transform', label: 'Rotate X',
    layoutAffecting: false, interpolation: 'angle', defaultValue: 0,
  },
  'transform.rotationY': {
    id: 'transform.rotationY', group: 'transform', label: 'Rotate Y',
    layoutAffecting: false, interpolation: 'angle', defaultValue: 0,
  },
  'transform.scaleX': {
    id: 'transform.scaleX', group: 'transform', label: 'Scale X',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 1,
  },
  'transform.scaleY': {
    id: 'transform.scaleY', group: 'transform', label: 'Scale Y',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 1,
  },
  'transform.anchorX': {
    id: 'transform.anchorX', group: 'transform', label: 'Anchor X',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0.5,
  },
  'transform.anchorY': {
    id: 'transform.anchorY', group: 'transform', label: 'Anchor Y',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0.5,
  },
  'transform.anchorZ': {
    id: 'transform.anchorZ', group: 'transform', label: 'Anchor Z',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0,
  },
  'motionPath.progress': {
    id: 'motionPath.progress', group: 'transform', label: 'Path Progress',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0,
  },

  // bend deformation — vertex-only GPU work, no Yoga relayout
  'deformation.bend.waveAmplitude': {
    id: 'deformation.bend.waveAmplitude', group: 'deformation', label: 'Wave amplitude',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 40,
  },
  'deformation.bend.waveFrequency': {
    id: 'deformation.bend.waveFrequency', group: 'deformation', label: 'Wave frequency',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 2,
  },
  'deformation.bend.wavePhase': {
    id: 'deformation.bend.wavePhase', group: 'deformation', label: 'Wave phase',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0,
  },
  'deformation.bend.waveStart': {
    id: 'deformation.bend.waveStart', group: 'deformation', label: 'Wave start',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0,
  },
  'deformation.bend.waveEnd': {
    id: 'deformation.bend.waveEnd', group: 'deformation', label: 'Wave end',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 1,
  },
  'deformation.bend.waveFalloff': {
    id: 'deformation.bend.waveFalloff', group: 'deformation', label: 'Wave falloff',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0.1,
  },
  'deformation.bend.angle': {
    id: 'deformation.bend.angle', group: 'deformation', label: 'Bend Angle',
    layoutAffecting: false, interpolation: 'angle', defaultValue: 0,
  },
  'deformation.bend.factor': {
    id: 'deformation.bend.factor', group: 'deformation', label: 'Bend Factor',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 1,
  },
  'deformation.bend.captureDirectionX': {
    id: 'deformation.bend.captureDirectionX', group: 'deformation', label: 'Capture Direction X',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 1,
  },
  'deformation.bend.captureDirectionY': {
    id: 'deformation.bend.captureDirectionY', group: 'deformation', label: 'Capture Direction Y',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0,
  },
  'deformation.bend.captureDirectionZ': {
    id: 'deformation.bend.captureDirectionZ', group: 'deformation', label: 'Capture Direction Z',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0,
  },
  'deformation.bend.captureRotation': {
    id: 'deformation.bend.captureRotation', group: 'deformation', label: 'Capture Rotation',
    layoutAffecting: false, interpolation: 'angle', defaultValue: 0,
  },
  'deformation.bend.upDirectionX': {
    id: 'deformation.bend.upDirectionX', group: 'deformation', label: 'Up Direction X',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0,
  },
  'deformation.bend.upDirectionY': {
    id: 'deformation.bend.upDirectionY', group: 'deformation', label: 'Up Direction Y',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 1,
  },
  'deformation.bend.upDirectionZ': {
    id: 'deformation.bend.upDirectionZ', group: 'deformation', label: 'Up Direction Z',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0,
  },
  'deformation.bend.upRotation': {
    id: 'deformation.bend.upRotation', group: 'deformation', label: 'Up Rotation',
    layoutAffecting: false, interpolation: 'angle', defaultValue: 0,
  },
  'deformation.bend.bendRotation': {
    id: 'deformation.bend.bendRotation', group: 'deformation', label: 'Bend Rotation',
    layoutAffecting: false, interpolation: 'angle', defaultValue: 0,
  },
  'deformation.bend.captureOriginX': {
    id: 'deformation.bend.captureOriginX', group: 'deformation', label: 'Capture Origin X',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0,
  },
  'deformation.bend.captureOriginY': {
    id: 'deformation.bend.captureOriginY', group: 'deformation', label: 'Capture Origin Y',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0,
  },
  'deformation.bend.captureOriginZ': {
    id: 'deformation.bend.captureOriginZ', group: 'deformation', label: 'Capture Origin Z',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0,
  },
  'deformation.bend.captureLength': {
    id: 'deformation.bend.captureLength', group: 'deformation', label: 'Capture Length',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0,
  },
  'deformation.bend.lightAzimuth': {
    id: 'deformation.bend.lightAzimuth', group: 'deformation', label: 'Light Azimuth',
    layoutAffecting: false, interpolation: 'angle', defaultValue: 135,
  },
  'deformation.bend.lightElevation': {
    id: 'deformation.bend.lightElevation', group: 'deformation', label: 'Light Elevation',
    layoutAffecting: false, interpolation: 'angle', defaultValue: 55,
  },
  'deformation.bend.ambient': {
    id: 'deformation.bend.ambient', group: 'deformation', label: 'Ambient Light',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0.82,
  },
  'deformation.bend.diffuse': {
    id: 'deformation.bend.diffuse', group: 'deformation', label: 'Directional Light',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0.28,
  },
  'deformation.bend.specular': {
    id: 'deformation.bend.specular', group: 'deformation', label: 'Highlight',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0.12,
  },
  'deformation.bend.roughness': {
    id: 'deformation.bend.roughness', group: 'deformation', label: 'Roughness',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0.62,
  },

  // camera lens group — post-layout, no relayout needed
  'camera.focusDistance': {
    id: 'camera.focusDistance', group: 'camera', label: 'Focus Distance',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0,
  },
  'camera.focusX': {
    id: 'camera.focusX', group: 'camera', label: 'Focus X',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0,
  },
  'camera.focusY': {
    id: 'camera.focusY', group: 'camera', label: 'Focus Y',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0,
  },
  'camera.focusWorldX': {
    id: 'camera.focusWorldX', group: 'camera', label: 'Focus X',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0,
  },
  'camera.focusWorldY': {
    id: 'camera.focusWorldY', group: 'camera', label: 'Focus Y',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0,
  },
  'camera.focusWorldZ': {
    id: 'camera.focusWorldZ', group: 'camera', label: 'Focus Z',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0,
  },
  'camera.focusRadius': {
    id: 'camera.focusRadius', group: 'camera', label: 'Focus Radius',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 160,
  },
  'camera.focusFalloff': {
    id: 'camera.focusFalloff', group: 'camera', label: 'Focus Falloff',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 180,
  },
  'camera.pointOfInterestX': {
    id: 'camera.pointOfInterestX', group: 'camera', label: 'POI X',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0,
  },
  'camera.pointOfInterestY': {
    id: 'camera.pointOfInterestY', group: 'camera', label: 'POI Y',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0,
  },
  'camera.pointOfInterestZ': {
    id: 'camera.pointOfInterestZ', group: 'camera', label: 'POI Z',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0,
  },
  'camera.focalLength': {
    id: 'camera.focalLength', group: 'camera', label: 'Focal Length',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 1000,
  },
  'camera.fieldOfView': {
    id: 'camera.fieldOfView', group: 'camera', label: 'Field of View',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 35,
  },
  'camera.nearClip': {
    id: 'camera.nearClip', group: 'camera', label: 'Near Clip',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 1,
  },
  'camera.farClip': {
    id: 'camera.farClip', group: 'camera', label: 'Far Clip',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 100000,
  },
  'camera.aperture': {
    id: 'camera.aperture', group: 'camera', label: 'Aperture',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0,
  },
  'camera.fStop': {
    id: 'camera.fStop', group: 'camera', label: 'F-Stop',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 2.8,
  },
  'camera.bladeCount': {
    id: 'camera.bladeCount', group: 'camera', label: 'Blade Count',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 7,
  },
  'camera.bladeRotation': {
    id: 'camera.bladeRotation', group: 'camera', label: 'Blade Rotation',
    layoutAffecting: false, interpolation: 'angle', defaultValue: 0,
  },
  'camera.bokehRatio': {
    id: 'camera.bokehRatio', group: 'camera', label: 'Bokeh Ratio',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 1,
  },
  'camera.iso': {
    id: 'camera.iso', group: 'camera', label: 'ISO',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 100,
  },
  'camera.blurLevel': {
    id: 'camera.blurLevel', group: 'camera', label: 'Blur Level',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 1,
  },
  'camera.blurQuality': {
    id: 'camera.blurQuality', group: 'camera', label: 'Export Samples',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 24,
  },
  'camera.chromaticAberrationAmount': {
    id: 'camera.chromaticAberrationAmount', group: 'camera', label: 'Chromatic Amount',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 4,
  },
  'camera.chromaticAberrationAngle': {
    id: 'camera.chromaticAberrationAngle', group: 'camera', label: 'Chromatic Angle',
    layoutAffecting: false, interpolation: 'angle', defaultValue: 0,
  },
  'camera.bloomStrength': {
    id: 'camera.bloomStrength', group: 'camera', label: 'Bloom Strength',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0.8,
  },
  'camera.bloomRadius': {
    id: 'camera.bloomRadius', group: 'camera', label: 'Bloom Radius',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0.35,
  },
  'camera.bloomThreshold': {
    id: 'camera.bloomThreshold', group: 'camera', label: 'Bloom Threshold',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0.75,
  },
  'camera.vhsIntensity': {
    id: 'camera.vhsIntensity', group: 'camera', label: 'VHS Intensity',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0.65,
  },
  'camera.vhsNoise': {
    id: 'camera.vhsNoise', group: 'camera', label: 'VHS Noise',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0.35,
  },
  'camera.vhsScanlines': {
    id: 'camera.vhsScanlines', group: 'camera', label: 'VHS Scanlines',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0.5,
  },
  'camera.vhsColorBleed': {
    id: 'camera.vhsColorBleed', group: 'camera', label: 'VHS Color Bleed',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 3,
  },

  // appearance group — also post-layout
  'appearance.opacity': {
    id: 'appearance.opacity', group: 'appearance', label: 'Opacity',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 1,
  },
  'appearance.cornerSmoothing': {
    id: 'appearance.cornerSmoothing', group: 'appearance', label: 'Corner Smoothing',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0,
  },
  'appearance.cornerSmoothingEnabled': {
    id: 'appearance.cornerSmoothingEnabled', group: 'appearance', label: 'Squircle',
    layoutAffecting: false, interpolation: 'discrete', defaultValue: 0,
  },
  'appearance.fullRadius': {
    id: 'appearance.fullRadius', group: 'appearance', label: 'Full Radius',
    layoutAffecting: false, interpolation: 'discrete', defaultValue: 0,
  },
  'appearance.cornerRadius': {
    id: 'appearance.cornerRadius', group: 'appearance', label: 'Corner Radius',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0,
  },
  // Keyframe value is an OKLCH color string (the same shape
  // `DEFAULT_APPEARANCE.fill` already uses for solid fills). Interpolated
  // perceptually in OKLCH space — see src/anim/color.ts. Gradient and
  // radial fills fall through to step semantics since there's no sensible
  // scalar tween between two gradient stop lists; keyframes on those
  // shapes snap at u=1.
  'appearance.fill': {
    id: 'appearance.fill', group: 'appearance', label: 'Fill',
    layoutAffecting: false, interpolation: 'color', defaultValue: 'oklch(0.8 0.05 250)',
  },
  'vector.fill': {
    id: 'vector.fill', group: 'vector', label: 'Vector Fill',
    layoutAffecting: false, interpolation: 'paint',
    defaultValue: {
      id: 'fill-1', kind: 'solid', color: '#000000',
      visible: true, opacity: 1, blendMode: 'normal',
    },
  },
  'vector.stroke': {
    id: 'vector.stroke', group: 'vector', label: 'Vector Stroke',
    layoutAffecting: false, interpolation: 'stroke',
    defaultValue: {
      id: 'stroke-1',
      paint: {
        id: 'stroke-paint-1', kind: 'solid', color: '#000000',
        visible: true, opacity: 1, blendMode: 'normal',
      },
      width: 1, align: 'center', cap: 'butt', join: 'miter',
      miterLimit: 4, dash: [], dashOffset: 0, opacity: 1, visible: true,
    },
  },
  'vector.geometry': {
    id: 'vector.geometry', group: 'vector', label: 'Shape',
    layoutAffecting: false, interpolation: 'path', defaultValue: { version: 1, items: [] },
  },
  'bend.tl': {
    id: 'bend.tl', group: 'bend', label: 'Bend TL',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0,
  },
  'bend.tr': {
    id: 'bend.tr', group: 'bend', label: 'Bend TR',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0,
  },
  'bend.br': {
    id: 'bend.br', group: 'bend', label: 'Bend BR',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0,
  },
  'bend.bl': {
    id: 'bend.bl', group: 'bend', label: 'Bend BL',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0,
  },
  'bend.top': {
    id: 'bend.top', group: 'bend', label: 'Bend Top',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0,
  },
  'bend.right': {
    id: 'bend.right', group: 'bend', label: 'Bend Right',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0,
  },
  'bend.bottom': {
    id: 'bend.bottom', group: 'bend', label: 'Bend Bottom',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0,
  },
  'bend.left': {
    id: 'bend.left', group: 'bend', label: 'Bend Left',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0,
  },
  'appearance.blendMode': {
    id: 'appearance.blendMode', group: 'appearance', label: 'Blend Mode',
    layoutAffecting: false, interpolation: 'discrete', defaultValue: 'normal',
  },

  // native ellipse geometry — post-layout and texture-only
  'shape.arcStart': {
    id: 'shape.arcStart', group: 'shape', label: 'Arc Start',
    layoutAffecting: false, interpolation: 'angle', defaultValue: -90,
  },
  'shape.arcSweep': {
    id: 'shape.arcSweep', group: 'shape', label: 'Arc Sweep',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 1,
  },
  'shape.arcInnerRadius': {
    id: 'shape.arcInnerRadius', group: 'shape', label: 'Inner Radius',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0,
  },

  // text effect group — post-layout; controls text-specific reveal progress
  'textShimmer.range': {
    id: 'textShimmer.range', group: 'text', label: 'Shimmer',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0,
  },
  'textShimmer.duration': {
    id: 'textShimmer.duration', group: 'text', label: 'Shimmer duration',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 2,
  },
  'textShimmer.shimmerWidth': {
    id: 'textShimmer.shimmerWidth', group: 'text', label: 'Shimmer length',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0.25,
  },
  'text.progress': {
    id: 'text.progress', group: 'text', label: 'Text Animation',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 0,
  },

  // layout group — triggers relayout + FLIP
  'layout.gap': {
    id: 'layout.gap', group: 'layout', label: 'Gap',
    layoutAffecting: true, interpolation: 'numeric', defaultValue: 0,
  },
  'layout.padding.top': {
    id: 'layout.padding.top', group: 'layout', label: 'Padding Top',
    layoutAffecting: true, interpolation: 'numeric', defaultValue: 0,
  },
  'layout.padding.right': {
    id: 'layout.padding.right', group: 'layout', label: 'Padding Right',
    layoutAffecting: true, interpolation: 'numeric', defaultValue: 0,
  },
  'layout.padding.bottom': {
    id: 'layout.padding.bottom', group: 'layout', label: 'Padding Bottom',
    layoutAffecting: true, interpolation: 'numeric', defaultValue: 0,
  },
  'layout.padding.left': {
    id: 'layout.padding.left', group: 'layout', label: 'Padding Left',
    layoutAffecting: true, interpolation: 'numeric', defaultValue: 0,
  },
  'layout.direction': {
    id: 'layout.direction', group: 'layout', label: 'Direction',
    layoutAffecting: true, interpolation: 'discrete', defaultValue: 'row',
  },

  // size — triggers relayout when value is numeric; hug/fill are discrete
  'size.width': {
    id: 'size.width', group: 'size', label: 'Width',
    layoutAffecting: true, interpolation: 'numeric', defaultValue: 100,
  },
  'size.height': {
    id: 'size.height', group: 'size', label: 'Height',
    layoutAffecting: true, interpolation: 'numeric', defaultValue: 100,
  },

  // semantic — variant switch cascades through children
  variant: {
    id: 'variant', group: 'semantic', label: 'Variant',
    layoutAffecting: true, interpolation: 'discrete', defaultValue: {},
  },
}

const EFFECT_BLUR_PREFIX = 'appearance.effects.'
const EFFECT_BLUR_SUFFIX = '.blur'
const EFFECT_ID_PATTERN = /^[A-Za-z0-9_-]+$/
const effectBlurDescriptors = new Map<string, PropertyDescriptor>()

export function effectBlurPropertyId(
  effectId: string,
): EffectBlurPropertyId {
  const normalized = effectId.trim()
  if (!EFFECT_ID_PATTERN.test(normalized)) {
    throw new Error(`Invalid effect id: ${effectId}`)
  }
  return `${EFFECT_BLUR_PREFIX}${normalized}${EFFECT_BLUR_SUFFIX}`
}

export function effectIdFromBlurPropertyId(
  propertyId: PropertyId | string,
): string | null {
  if (
    !propertyId.startsWith(EFFECT_BLUR_PREFIX) ||
    !propertyId.endsWith(EFFECT_BLUR_SUFFIX)
  ) {
    return null
  }
  const effectId = propertyId.slice(
    EFFECT_BLUR_PREFIX.length,
    -EFFECT_BLUR_SUFFIX.length,
  )
  return EFFECT_ID_PATTERN.test(effectId) ? effectId : null
}

export function effectBeamRangePropertyId(effectId: string): EffectBeamRangePropertyId {
  if (!EFFECT_ID_PATTERN.test(effectId)) throw new Error(`Invalid effect id: ${effectId}`)
  return `appearance.effects.${effectId}.beamRange`
}

export function effectIdFromBeamRangePropertyId(propertyId: string): string | null {
  return /^appearance\.effects\.([A-Za-z0-9_-]+)\.beamRange$/.exec(propertyId)?.[1] ?? null
}

/** Resolve static and stable per-effect properties through one registry API. */
export function propertyDescriptor(
  propertyId: PropertyId,
): PropertyDescriptor | undefined {
  if (effectIdFromBeamRangePropertyId(propertyId)) return {
    id: propertyId, group: 'appearance', label: 'Beam', layoutAffecting: false, interpolation: 'numeric', defaultValue: 0,
  }
  const staticDescriptor = PROPERTIES[propertyId as StaticPropertyId]
  if (staticDescriptor) return staticDescriptor
  const effectId = effectIdFromBlurPropertyId(propertyId)
  if (!effectId) return undefined
  const cached = effectBlurDescriptors.get(effectId)
  if (cached) return cached
  const descriptor: PropertyDescriptor = {
    id: propertyId,
    group: 'appearance',
    label: 'Blur',
    layoutAffecting: false,
    interpolation: 'numeric',
    defaultValue: 0,
  }
  effectBlurDescriptors.set(effectId, descriptor)
  return descriptor
}

/** Returns all property descriptors whose group is layoutAffecting === true. */
export const LAYOUT_AFFECTING_PROPERTIES: PropertyId[] = Object.values(PROPERTIES)
  .filter((p) => p.layoutAffecting)
  .map((p) => p.id)
