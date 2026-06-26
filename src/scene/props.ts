// SPDX-License-Identifier: Apache-2.0

import type { PropertyId } from '@/scene/types'

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

export type PropertyGroup = 'transform' | 'camera' | 'appearance' | 'layout' | 'size' | 'semantic'
export type Interpolation = 'numeric' | 'discrete' | 'color' | 'angle'

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

export const PROPERTIES: Record<PropertyId, PropertyDescriptor> = {
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
  'camera.iso': {
    id: 'camera.iso', group: 'camera', label: 'ISO',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 100,
  },
  'camera.blurLevel': {
    id: 'camera.blurLevel', group: 'camera', label: 'Blur Level',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 1,
  },
  'camera.blurQuality': {
    id: 'camera.blurQuality', group: 'camera', label: 'Blur Quality',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 8,
  },

  // appearance group — also post-layout
  'appearance.opacity': {
    id: 'appearance.opacity', group: 'appearance', label: 'Opacity',
    layoutAffecting: false, interpolation: 'numeric', defaultValue: 1,
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

/** Returns all property descriptors whose group is layoutAffecting === true. */
export const LAYOUT_AFFECTING_PROPERTIES: PropertyId[] = Object.values(PROPERTIES)
  .filter((p) => p.layoutAffecting)
  .map((p) => p.id)
