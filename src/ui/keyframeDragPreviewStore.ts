// SPDX-License-Identifier: Apache-2.0

import type { SceneAPI } from '@/scene/doc'
import { getAnimEngine } from '@/anim'
import { deriveTextAnimationTiming } from '@/anim/textAnimations'
import type { Track } from '@/scene'
import { resolveStaggerKeyframeBundle } from '@/anim/staggerSets'

export interface KeyframeDragMember {
  trackId: string
  kfId: string
  startTime: number
}

export interface KeyframeDragTarget {
  trackId: string
  kfId: string
  time: number
}

export interface KeyframeDragPreviewStore {
  /** Queue the latest drag position. Pointer packets are coalesced to one paint. */
  preview: (members: readonly KeyframeDragMember[], delta: number) => void
  /** Queue non-uniform target times, used by proportional group scaling. */
  previewTimes: (targets: readonly KeyframeDragTarget[]) => void
  /** Publish a queued packet immediately (used just before the durable commit). */
  flush: () => void
  /** Keep the final preview for one paint, then release it to durable scene data. */
  finish: () => void
  /** Drop a cancelled gesture immediately. */
  cancel: () => void
  getTime: (trackId: string, kfId: string, fallback: number) => number
  getRevision: () => number
  subscribe: (
    trackId: string,
    kfId: string,
    listener: () => void,
  ) => () => void
  subscribeAll: (listener: () => void) => () => void
}

type PendingPreview =
  | {
      kind: 'delta'
      members: readonly KeyframeDragMember[]
      delta: number
    }
  | {
      kind: 'times'
      targets: readonly KeyframeDragTarget[]
    }

const dragKey = (trackId: string, kfId: string) => `${trackId}:${kfId}`

/**
 * Display-rate transient keyframe positions.
 *
 * Timeline drags can deliver hundreds of pointer packets per second. Writing
 * every packet into Yjs invalidates the whole editor tree, restarts animation
 * snapshots, and creates a visibly uneven pointer-to-diamond path. This store
 * deliberately keeps those packets outside the scene document. Only the tiny
 * diamonds and segment bars that subscribe to the moved keys repaint, at most
 * once per requestAnimationFrame.
 */
export function createKeyframeDragPreviewStore(): KeyframeDragPreviewStore {
  let visible = new Map<string, number>()
  let pending: PendingPreview | null = null
  let frame: number | null = null
  let finishFrame: number | null = null
  let revision = 0
  const listeners = new Map<string, Set<() => void>>()
  const allListeners = new Set<() => void>()

  const notify = (keys: Set<string>) => {
    if (keys.size === 0) return
    revision++
    const called = new Set<() => void>()
    for (const listener of allListeners) {
      called.add(listener)
      listener()
    }
    for (const key of keys) {
      for (const listener of listeners.get(key) ?? []) {
        if (called.has(listener)) continue
        called.add(listener)
        listener()
      }
    }
  }

  const clearVisible = () => {
    if (visible.size === 0) return
    const changed = new Set(visible.keys())
    visible = new Map()
    notify(changed)
  }

  const publishPending = () => {
    if (!pending) return
    const next = new Map<string, number>()
    if (pending.kind === 'delta') {
      for (const member of pending.members) {
        next.set(
          dragKey(member.trackId, member.kfId),
          Math.max(0, member.startTime + pending.delta),
        )
      }
    } else {
      for (const target of pending.targets) {
        next.set(
          dragKey(target.trackId, target.kfId),
          Math.max(0, target.time),
        )
      }
    }
    pending = null

    const changed = new Set<string>()
    for (const [key, time] of next) {
      if (visible.get(key) !== time) changed.add(key)
    }
    for (const key of visible.keys()) {
      if (!next.has(key)) changed.add(key)
    }
    visible = next
    notify(changed)
  }

  return {
    preview: (members, delta) => {
      pending = { kind: 'delta', members, delta }
      if (finishFrame !== null) {
        cancelAnimationFrame(finishFrame)
        finishFrame = null
      }
      if (frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        publishPending()
      })
    },
    previewTimes: (targets) => {
      pending = { kind: 'times', targets }
      if (finishFrame !== null) {
        cancelAnimationFrame(finishFrame)
        finishFrame = null
      }
      if (frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        publishPending()
      })
    },
    flush: () => {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = null
      publishPending()
    },
    finish: () => {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = null
      publishPending()
      if (finishFrame !== null) cancelAnimationFrame(finishFrame)
      // The document subscription gets the committed track data first. Holding
      // this final visual value until the next paint avoids a one-frame jump
      // back to the stale prop while React reconciles that scene update.
      finishFrame = requestAnimationFrame(() => {
        finishFrame = null
        clearVisible()
      })
    },
    cancel: () => {
      if (frame !== null) cancelAnimationFrame(frame)
      if (finishFrame !== null) cancelAnimationFrame(finishFrame)
      frame = null
      finishFrame = null
      pending = null
      clearVisible()
    },
    getTime: (trackId, kfId, fallback) =>
      visible.get(dragKey(trackId, kfId)) ?? fallback,
    getRevision: () => revision,
    subscribe: (trackId, kfId, listener) => {
      const key = dragKey(trackId, kfId)
      let bucket = listeners.get(key)
      if (!bucket) {
        bucket = new Set()
        listeners.set(key, bucket)
      }
      bucket.add(listener)
      return () => {
        bucket!.delete(listener)
        if (bucket!.size === 0) listeners.delete(key)
      }
    },
    subscribeAll: (listener) => {
      allListeners.add(listener)
      return () => allListeners.delete(listener)
    },
  }
}

export const keyframeDragPreviewStore = createKeyframeDragPreviewStore()

/**
 * Persist one uniform keyframe drag as one Yjs transaction.
 *
 * A track is read and written once even when several of its keyframes move.
 * Sorting is stable (original array index is the tie-breaker), so ids, values,
 * easing metadata, and same-time ordering survive a batch retime intact.
 */
export function commitKeyframeDrag(
  api: SceneAPI,
  members: readonly KeyframeDragMember[],
  delta: number,
): void {
  commitKeyframeTimes(
    api,
    members.map((member) => ({
      trackId: member.trackId,
      kfId: member.kfId,
      time: Math.max(0, member.startTime + delta),
    })),
  )
}

/** Persist arbitrary keyframe target times as one Yjs transaction. */
export function commitKeyframeTimes(
  api: SceneAPI,
  targets: readonly KeyframeDragTarget[],
): void {
  const byTrack = new Map<string, Map<string, number>>()
  for (const target of targets) {
    let times = byTrack.get(target.trackId)
    if (!times) {
      times = new Map()
      byTrack.set(target.trackId, times)
    }
    times.set(target.kfId, Math.max(0, target.time))
  }
  if (byTrack.size === 0) return

  api.doc.transact(() => {
    for (const [trackId, movedTimes] of byTrack) {
      const track = api.getTrack(trackId)
      if (!track) continue
      let changed = false
      const next = track.keyframes.map((keyframe, index) => {
        const time = movedTimes.get(keyframe.id)
        if (time === undefined || time === keyframe.time) {
          return { keyframe, index }
        }
        changed = true
        return { keyframe: { ...keyframe, time }, index }
      })
      if (!changed) continue
      next.sort(
        (a, b) => a.keyframe.time - b.keyframe.time || a.index - b.index,
      )
      const keyframes = next.map((entry) => entry.keyframe)
      const node = api.getNode(track.nodeId)
      const nextTrack = { ...track, keyframes }
      const textAnimation =
        track.propertyId === 'text.progress' && track.textAnimation
          ? node?.kind === 'text'
            ? deriveTextAnimationTiming(
                track.textAnimation,
                nextTrack,
                node.text,
              ) ?? track.textAnimation
            : {
                ...track.textAnimation,
                startTime:
                  keyframes[0]?.time ?? track.textAnimation.startTime,
              }
          : track.textAnimation
      api.setTrack({
        ...track,
        keyframes,
        ...(textAnimation ? { textAnimation } : {}),
      })
      if (track.propertyId === 'text.progress' && textAnimation) {
        const textTracks = api
          .getTracksForNode(track.nodeId)
          .filter((candidate) => candidate.propertyId === 'text.progress')
        if (node?.kind === 'text' && textTracks.length === 1) {
          api.setNodeProperty(track.nodeId, 'textAnimation', textAnimation)
        }
      }
    }
  })
}

export interface KeyframeDragSession {
  preview: (delta: number) => void
  previewTimes: (targets: readonly KeyframeDragTarget[]) => void
  commit: () => void
  cancel: () => void
}

function previewTracksForDrag(
  api: SceneAPI,
  baseTracks: ReadonlyMap<string, Track>,
  targets: readonly KeyframeDragTarget[],
): ReadonlyMap<string, Track> {
  const movedTimes = new Map<string, Map<string, number>>()
  for (const target of targets) {
    let trackTimes = movedTimes.get(target.trackId)
    if (!trackTimes) {
      trackTimes = new Map()
      movedTimes.set(target.trackId, trackTimes)
    }
    trackTimes.set(target.kfId, Math.max(0, target.time))
  }

  const previews = new Map<string, Track>()
  for (const [trackId, times] of movedTimes) {
    const track = baseTracks.get(trackId)
    if (!track) continue
    const keyframes = track.keyframes
      .map((keyframe, index) => ({
        keyframe:
          times.has(keyframe.id)
            ? { ...keyframe, time: times.get(keyframe.id)! }
            : keyframe,
        index,
      }))
      .sort(
        (a, b) => a.keyframe.time - b.keyframe.time || a.index - b.index,
      )
      .map((entry) => entry.keyframe)
    const nextTrack = { ...track, keyframes }
    const node = api.getNode(track.nodeId)
    const textAnimation =
      track.propertyId === 'text.progress' &&
      track.textAnimation &&
      node?.kind === 'text'
        ? deriveTextAnimationTiming(
            track.textAnimation,
            nextTrack,
            node.text,
          )
        : track.textAnimation
    previews.set(trackId, {
      ...nextTrack,
      ...(textAnimation ? { textAnimation } : {}),
    })
  }
  return previews
}

/** Reusable gesture lifecycle shared by diamonds and segment bars. */
export function createKeyframeDragSession(
  api: SceneAPI,
  members: readonly KeyframeDragMember[],
  store: KeyframeDragPreviewStore = keyframeDragPreviewStore,
): KeyframeDragSession {
  // A stagger relationship is one editable animation bundle. Starting a drag
  // from any member — source or follower, in or out of Edit Stagger mode —
  // therefore previews and commits the exact corresponding keys together.
  const expandedByKey = new Map<string, KeyframeDragMember>()
  for (const member of members) {
    const bundle = resolveStaggerKeyframeBundle(api, member.trackId, member.kfId)
    if (bundle) {
      for (const linked of bundle.members) {
        expandedByKey.set(dragKey(linked.trackId, linked.keyframeId), {
          trackId: linked.trackId,
          kfId: linked.keyframeId,
          startTime: linked.time,
        })
      }
      continue
    }
    expandedByKey.set(dragKey(member.trackId, member.kfId), member)
  }
  const dragMembers = [...expandedByKey.values()]
  let lastTargets: readonly KeyframeDragTarget[] | null = null
  let moved = false
  let ended = false
  const baseTracks = new Map<string, Track>()
  for (const member of dragMembers) {
    if (baseTracks.has(member.trackId)) continue
    const track = api.getTrack(member.trackId)
    if (track) baseTracks.set(member.trackId, track)
  }
  const unsubscribePreview = store.subscribeAll(() => {
    if (!lastTargets || ended) return
    getAnimEngine().setTrackPreview(
      previewTracksForDrag(api, baseTracks, lastTargets),
    )
  })
  return {
    preview: (delta) => {
      if (ended) return
      moved = true
      lastTargets = dragMembers.map((member) => ({
        trackId: member.trackId,
        kfId: member.kfId,
        time: Math.max(0, member.startTime + delta),
      }))
      store.preview(dragMembers, delta)
    },
    previewTimes: (targets) => {
      if (ended) return
      moved = true
      lastTargets = targets
      store.previewTimes(targets)
    },
    commit: () => {
      if (ended) return
      if (lastTargets) {
        // Publish the newest pointer packet before persistence so the canvas
        // and timeline land on exactly the value that will be committed.
        store.flush()
        commitKeyframeTimes(api, lastTargets)
      }
      ended = true
      unsubscribePreview()
      if (moved) getAnimEngine().setTrackPreview(null)
      if (moved) store.finish()
      else store.cancel()
    },
    cancel: () => {
      if (ended) return
      ended = true
      unsubscribePreview()
      if (moved) getAnimEngine().setTrackPreview(null)
      store.cancel()
    },
  }
}
