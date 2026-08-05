// SPDX-License-Identifier: Apache-2.0

import type { CSSProperties } from 'react'
import { fillToCss, imageBackgroundStyle } from '@/scene'
import type { CameraNode, Fill, NodeId } from '@/scene'
import type { SceneAPI } from '@/scene/doc'
import type { Rect, SolvedLayout } from '@/layout'
import type { AnimatedValue } from '@/ui/hooks/useAnimatedValues'
import { resolveCameraDomProjection } from '@/render/cameraDomProjection'
import {
  buildWorldPlanes,
  effectiveApertureStrength,
  projectWorldPoint,
  resolveCamera3D,
} from '@/render3d/scene3d'

/** Values accumulated from every ancestor in the flattened DOM scene. */
export interface InheritedAnim {
  x: number
  y: number
  z: number
  rotation: number
  rotationX: number
  rotationY: number
  scaleX: number
  scaleY: number
  opacity: number
}

export const IDENTITY_INHERITED: InheritedAnim = {
  x: 0,
  y: 0,
  z: 0,
  rotation: 0,
  rotationX: 0,
  rotationY: 0,
  scaleX: 1,
  scaleY: 1,
  opacity: 1,
}

export interface CameraDepthOfField {
  enabled: boolean
  mode: CameraNode['focusMode']
  focusX: number
  focusY: number
  focusWorldX: number
  focusWorldY: number
  focusWorldZ: number
  focusRadius: number
  focusFalloff: number
  focusDistance: number
  aperture: number
  blurPx: number
  featherPx: number
  focalLength: number
  cameraZ: number
  cameraScale: number
  iso: number
  blurQuality: number
  blurAxisDeg: number
}

export interface Vec3 {
  x: number
  y: number
  z: number
}

interface Matrix2D {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

const IDENTITY_MATRIX_2D: Matrix2D = {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  e: 0,
  f: 0,
}

function multiplyMatrix2D(left: Matrix2D, right: Matrix2D): Matrix2D {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  }
}

function transformPoint2D(
  matrix: Matrix2D,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: matrix.a * x + matrix.c * y + matrix.e,
    y: matrix.b * x + matrix.d * y + matrix.f,
  }
}

function nodeMatrix2D(
  rect: Rect,
  tx: number,
  ty: number,
  rotation: number,
  scaleX: number,
  scaleY: number,
  anchorX: number,
  anchorY: number,
): Matrix2D {
  const originX = rect.x + rect.width * anchorX
  const originY = rect.y + rect.height * anchorY
  const radians = (rotation * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return multiplyMatrix2D(
    { ...IDENTITY_MATRIX_2D, e: tx, f: ty },
    multiplyMatrix2D(
      { ...IDENTITY_MATRIX_2D, e: originX, f: originY },
      multiplyMatrix2D(
        { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 },
        multiplyMatrix2D(
          { a: scaleX, b: 0, c: 0, d: scaleY, e: 0, f: 0 },
          { ...IDENTITY_MATRIX_2D, e: -originX, f: -originY },
        ),
      ),
    ),
  )
}

export function fillBackgroundStyle(
  fill: Fill | null | undefined,
): CSSProperties {
  if (!fill) return {}
  if (fill.kind === 'solid') return { backgroundColor: fill.color }
  if (fill.kind === 'image') return imageBackgroundStyle(fill) ?? {}
  return { backgroundImage: fillToCss(fill) }
}

export function composeInheritedAnim(
  api: SceneAPI,
  rootId: NodeId | null,
  animated: Record<NodeId, AnimatedValue>,
  solved?: SolvedLayout | null,
): Record<NodeId, InheritedAnim> {
  const out: Record<NodeId, InheritedAnim> = {}
  if (!rootId) return out

  interface InheritanceContext extends InheritedAnim {
    matrix: Matrix2D
  }
  const identityContext: InheritanceContext = {
    ...IDENTITY_INHERITED,
    matrix: IDENTITY_MATRIX_2D,
  }

  const inheritForNode = (
    id: NodeId,
    context: InheritanceContext,
  ): InheritedAnim => {
    const rect = solved?.[id]
    if (!rect) {
      return {
        x: context.x,
        y: context.y,
        z: context.z,
        rotation: context.rotation,
        rotationX: context.rotationX,
        rotationY: context.rotationY,
        scaleX: context.scaleX,
        scaleY: context.scaleY,
        opacity: context.opacity,
      }
    }
    const topLeft = transformPoint2D(context.matrix, rect.x, rect.y)
    return {
      x: topLeft.x - rect.x,
      y: topLeft.y - rect.y,
      z: context.z,
      rotation: context.rotation,
      rotationX: context.rotationX,
      rotationY: context.rotationY,
      scaleX: context.scaleX,
      scaleY: context.scaleY,
      opacity: context.opacity,
    }
  }

  const visit = (id: NodeId, context: InheritanceContext): void => {
    out[id] = inheritForNode(id, context)
    const node = api.getNode(id)
    if (!node) return
    const isRoot = id === rootId
    const value = animated[id]
    const x = value?.x ?? node.transform.x
    const y = value?.y ?? node.transform.y
    const z = value?.z ?? node.transform.z
    const rotation = value?.rotation ?? node.transform.rotation
    const rotationX = value?.rotationX ?? node.transform.rotationX
    const rotationY = value?.rotationY ?? node.transform.rotationY
    const scaleX = value?.scaleX ?? node.transform.scaleX
    const scaleY = value?.scaleY ?? node.transform.scaleY
    const opacity = value?.opacity ?? node.appearance.opacity
    const anchorX = value?.anchorX ?? node.transform.anchorX ?? 0.5
    const anchorY = value?.anchorY ?? node.transform.anchorY ?? 0.5
    const rect = solved?.[id]
    const ownMatrix =
      rect && !isRoot
        ? nodeMatrix2D(
            rect,
            x,
            y,
            rotation,
            scaleX,
            scaleY,
            anchorX,
            anchorY,
          )
        : rect && isRoot
          ? nodeMatrix2D(rect, 0, 0, rotation, 1, 1, 0.5, 0.5)
          : null
    const matrix = ownMatrix
      ? multiplyMatrix2D(context.matrix, ownMatrix)
      : context.matrix
    const next: InheritanceContext = isRoot
      ? {
          ...context,
          matrix,
          z: context.z + z,
          rotation: context.rotation + rotation,
          rotationX: context.rotationX + rotationX,
          rotationY: context.rotationY + rotationY,
        }
      : {
          x: context.x + x,
          y: context.y + y,
          z: context.z + z,
          rotation: context.rotation + rotation,
          rotationX: context.rotationX + rotationX,
          rotationY: context.rotationY + rotationY,
          scaleX: context.scaleX * scaleX,
          scaleY: context.scaleY * scaleY,
          opacity: context.opacity * opacity,
          matrix,
        }
    for (const child of api.getChildren(id)) visit(child.id, next)
  }

  visit(rootId, identityContext)
  return out
}

export function computeCameraDepthOfField(
  camera: CameraNode | null,
  cameraAnim: AnimatedValue | undefined,
  cameraScale: number,
  canvasWidth: number,
  canvasHeight: number,
  focusWorldOverride?: Vec3 | null,
): CameraDepthOfField | null {
  if (!camera || !camera.depthOfField) return null
  const focusDistance = cameraAnim?.focusDistance ?? camera.focusDistance ?? 0
  const aperture = Math.max(0, cameraAnim?.aperture ?? camera.aperture ?? 0)
  const fStop = Math.max(0.1, cameraAnim?.fStop ?? camera.fStop ?? 2.8)
  const focusZ = cameraAnim?.focusWorldZ ?? camera.focusWorldZ ?? focusDistance
  const maxBlur = Math.max(
    0,
    Math.min(128, cameraAnim?.blurLevel ?? camera.blurLevel ?? 1),
  )
  const focalLength = resolveCameraDomProjection(camera, cameraAnim, {
    width: canvasWidth,
    height: canvasHeight,
  }).focalLength
  const cameraZ = cameraAnim?.z ?? camera.transform.z
  const rotationX = cameraAnim?.rotationX ?? camera.transform.rotationX
  const rotationY = cameraAnim?.rotationY ?? camera.transform.rotationY
  const safeCameraScale = Math.max(0.05, cameraScale)
  const focalFactor = Math.max(0.35, Math.min(6, focalLength / 1000))
  const dollyFactor = Math.max(
    0.5,
    Math.min(5, 1 + Math.max(0, cameraZ) / focalLength),
  )
  const focusDepthFactor = Math.max(
    0.75,
    Math.min(5, 1 + Math.abs(focusZ - cameraZ) / Math.max(120, focalLength * 0.55)),
  )
  const opticalStrength =
    effectiveApertureStrength(aperture, fStop) *
    focusDepthFactor *
    Math.sqrt(focalFactor) *
    dollyFactor
  const blurFraction = 1 - Math.exp(-Math.max(0, opticalStrength) * 0.287682)
  const blurPx = Math.min(maxBlur, maxBlur * blurFraction)
  const focusRadius = Math.max(
    4,
    cameraAnim?.focusRadius ?? camera.focusRadius ?? 160,
  )
  const focusFalloff = Math.max(
    1,
    cameraAnim?.focusFalloff ?? camera.focusFalloff ?? 180,
  )
  const mode = camera.focusMode ?? 'screen'
  const focusScreen = {
    x:
      cameraAnim?.focusX ??
      cameraAnim?.focusWorldX ??
      camera.focusX ??
      camera.focusWorldX ??
      canvasWidth / 2,
    y:
      cameraAnim?.focusY ??
      cameraAnim?.focusWorldY ??
      camera.focusY ??
      camera.focusWorldY ??
      canvasHeight / 2,
  }
  const focusWorld = focusWorldOverride ?? {
    x:
      cameraAnim?.focusWorldX ??
      cameraAnim?.focusX ??
      camera.focusWorldX ??
      camera.focusX ??
      focusScreen.x,
    y:
      cameraAnim?.focusWorldY ??
      cameraAnim?.focusY ??
      camera.focusWorldY ??
      camera.focusY ??
      focusScreen.y,
    z: focusZ,
  }
  const projected =
    mode === 'screen'
      ? focusScreen
      : projectWorldPoint(
          focusWorld,
          resolveCamera3D(camera, cameraAnim, {
            width: canvasWidth,
            height: canvasHeight,
          }),
          { width: canvasWidth, height: canvasHeight },
        )
  return {
    enabled: true,
    mode,
    focusX: projected.x,
    focusY: projected.y,
    focusWorldX: focusWorld.x,
    focusWorldY: focusWorld.y,
    focusWorldZ: focusWorld.z,
    focusRadius,
    focusFalloff,
    focusDistance: mode === 'screen' ? focusDistance : focusWorld.z,
    aperture,
    blurPx,
    featherPx: focusFalloff,
    focalLength,
    cameraZ,
    cameraScale: safeCameraScale,
    iso: Math.max(0, camera.iso ?? 100),
    blurQuality: Math.max(
      24,
      Math.min(48, cameraAnim?.blurQuality ?? camera.blurQuality ?? 24),
    ),
    blurAxisDeg:
      Math.abs(rotationX) + Math.abs(rotationY) < 0.001
        ? 90
        : 90 + (Math.atan2(rotationX, rotationY || 0.0001) * 180) / Math.PI,
  }
}

export function resolveCameraFocusTargetPoint(
  api: SceneAPI,
  camera: CameraNode | null,
  solved: SolvedLayout,
  animated: Record<NodeId, AnimatedValue>,
  inherited: Record<NodeId, InheritedAnim>,
  viewport?: { width: number; height: number },
): Vec3 | null {
  if (!camera || (camera.focusMode ?? 'plane') !== 'target') return null
  const targetId = camera.focusTargetNodeId
  if (!targetId) return null
  const target = api.getNode(targetId)
  const rect = solved[targetId]
  if (!target || !rect) return null
  if (viewport) {
    const resolvedCamera = resolveCamera3D(camera, animated[camera.id], viewport)
    const targetPlane = buildWorldPlanes(api, solved, animated, resolvedCamera)
      .find((plane) => plane.nodeId === targetId)
    if (targetPlane) return targetPlane.center
  }
  const inherit = inherited[targetId] ?? IDENTITY_INHERITED
  const value = animated[targetId]
  return {
    x:
      rect.x +
      rect.width / 2 +
      inherit.x +
      (value?.x ?? target.transform.x),
    y:
      rect.y +
      rect.height / 2 +
      inherit.y +
      (value?.y ?? target.transform.y),
    z: inherit.z + (value?.z ?? target.transform.z),
  }
}
