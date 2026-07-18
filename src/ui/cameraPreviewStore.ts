// SPDX-License-Identifier: Apache-2.0

import type { AnimatedValue } from '@/anim'
import type { CameraNode, NodeId } from '@/scene'

export interface CameraPreviewSnapshot {
  cameraId: NodeId
  value: AnimatedValue
}

export interface CameraPreviewStore {
  getSnapshot: () => CameraPreviewSnapshot | undefined
  subscribe: (listener: () => void) => () => void
  set: (cameraId: NodeId, value: AnimatedValue) => void
  /** Publish the final packet now, then release it after one durable-data paint. */
  finish: (cameraId: NodeId) => void
  clear: (cameraId?: NodeId) => void
}

/**
 * Transient camera transforms shared by canvas gestures and Inspector scrubs.
 *
 * These values deliberately live outside the Yjs scene document. Pointer
 * packets can arrive faster than the display refresh rate; publishing at most
 * once per animation frame lets the small WebGL viewport leaf follow them
 * without making every scene subscriber, Yoga, and the texture pipeline work.
 * The authoring gesture commits the final transform to Yjs on pointer-up.
 */
export function createCameraPreviewStore(): CameraPreviewStore {
  let snapshot: CameraPreviewSnapshot | undefined
  let pending: CameraPreviewSnapshot | undefined
  let frame: number | null = null
  let finishFrame: number | null = null
  const listeners = new Set<() => void>()

  const publish = (value: CameraPreviewSnapshot | undefined) => {
    if (snapshot === value) return
    snapshot = value
    for (const listener of listeners) listener()
  }

  const publishPending = () => {
    const next = pending
    pending = undefined
    if (next) publish(next)
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set: (cameraId, value) => {
      // A new gesture owns the preview again. Do not let a deferred clear from
      // the preceding commit erase its first live frame.
      if (finishFrame !== null) cancelAnimationFrame(finishFrame)
      finishFrame = null
      pending = { cameraId, value }
      if (frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        publishPending()
      })
    },
    finish: (cameraId) => {
      if (
        snapshot?.cameraId !== cameraId &&
        pending?.cameraId !== cameraId
      ) {
        return
      }
      // The durable scene write happens immediately before finish(). Flush the
      // latest queued gesture packet so it remains the visible source of truth
      // while React reconciles that write, then release it after one paint.
      if (frame !== null) cancelAnimationFrame(frame)
      frame = null
      publishPending()
      if (finishFrame !== null) cancelAnimationFrame(finishFrame)
      finishFrame = requestAnimationFrame(() => {
        finishFrame = null
        if (snapshot?.cameraId === cameraId) publish(undefined)
      })
    },
    clear: (cameraId) => {
      if (
        cameraId !== undefined &&
        snapshot?.cameraId !== cameraId &&
        pending?.cameraId !== cameraId
      ) {
        return
      }
      if (frame !== null) cancelAnimationFrame(frame)
      if (finishFrame !== null) cancelAnimationFrame(finishFrame)
      frame = null
      finishFrame = null
      pending = undefined
      publish(undefined)
    },
  }
}

export const cameraPreviewStore = createCameraPreviewStore()

/** A live gesture must win over an authored track until it is committed. */
export function mergeCameraAnimationPreview(
  engineValue: AnimatedValue | undefined,
  previewValue: AnimatedValue | undefined,
): AnimatedValue | undefined {
  if (!previewValue) return engineValue
  return { ...engineValue, ...previewValue }
}

export function cameraTransformPreview(
  transform: CameraNode['transform'],
): AnimatedValue {
  return {
    x: transform.x,
    y: transform.y,
    z: transform.z,
    rotation: transform.rotation,
    rotationX: transform.rotationX,
    rotationY: transform.rotationY,
    scaleX: transform.scaleX,
    scaleY: transform.scaleY,
  }
}
