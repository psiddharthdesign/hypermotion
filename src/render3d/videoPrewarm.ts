// SPDX-License-Identifier: Apache-2.0
import type { Node, SceneAPI } from '@/scene'
import { videoVisibleAtTime } from '@/scene/mediaClip'
import type { SequenceTimeMap } from '@/sequence'

type VideoNode = Extract<Node, { kind: 'video' }>
export type VideoWarmup = { id: string; src: string; time: number }

/** Only the next occurrence: never decode an entire project in the background. */
export function upcomingVideoWarmups(
  api: Pick<SceneAPI, 'getNode'>,
  map: SequenceTimeMap,
  time: number,
): VideoWarmup[] {
  const next = map.items.find((item) => item.masterStart > time)
  if (!next) return []
  const result: VideoWarmup[] = []
  const queue = [next.scene.rootNodeId]
  const visited = new Set<string>()
  while (queue.length && result.length < 4) {
    const id = queue.pop()!
    if (visited.has(id)) continue
    visited.add(id)
    const node = api.getNode(id)
    if (!node || !node.visible) continue
    if (node.kind === 'video' && node.src && node.startTime <= next.sourceStart && videoVisibleAtTime(node, next.sourceStart)) {
      const rate = Math.max(0.05, Math.min(16, node.playbackRate ?? 1))
      const end = node.trimEnd || node.duration
      const elapsed = Math.max(0, next.sourceStart - node.startTime) * rate
      const length = Math.max(0, end - node.trimStart)
      const offset = node.loop && length > 0 ? elapsed % length : Math.min(elapsed, length)
      result.push({ id, src: node.src, time: node.trimStart + offset })
    }
    if ('children' in node) queue.push(...node.children.slice().reverse())
  }
  return result
}

export function createPlaybackVideo(src: string): HTMLVideoElement {
  const video = document.createElement('video')
  video.muted = true
  video.volume = 0
  video.loop = false
  video.playsInline = true
  video.preload = 'auto'
  video.crossOrigin = 'anonymous'
  const notify = () => window.dispatchEvent(new Event('hypermotion-video-ready'))
  video.addEventListener('loadeddata', notify)
  video.addEventListener('seeked', notify)
  video.src = src
  video.load()
  return video
}

/** Pending decoders are owned here; take() transfers ownership to the viewport. */
export function createVideoPrewarmPool(create = createPlaybackVideo) {
  type Entry = VideoWarmup & { video: HTMLVideoElement | null; ready: () => void }
  const entries = new Map<string, Entry>()
  let previousTargets: readonly VideoWarmup[] = []
  const release = (entry: Entry) => {
    if (!entry.video) return
    entry.video.removeEventListener('loadedmetadata', entry.ready)
    entry.video.pause()
    entry.video.removeAttribute('src')
    entry.video.load()
  }
  return {
    prepare(targets: readonly VideoWarmup[]) {
      const bounded = targets.slice(0, 4)
      if (bounded.length === previousTargets.length && bounded.every((target, index) => {
        const previous = previousTargets[index]
        return previous.id === target.id && previous.src === target.src && previous.time === target.time
      })) return
      for (const [id, entry] of entries) {
        if (bounded.some((target) => target.id === id && target.src === entry.src && target.time === entry.time)) continue
        // At the boundary the clock publishes before React commits the new
        // viewport. Retain the incoming batch for that commit to take it.
        if (previousTargets.some((target) => target.id === id)) continue
        release(entry)
        entries.delete(id)
      }
      for (const target of bounded) {
        const existing = entries.get(target.id)
        if (existing?.src === target.src && existing.time === target.time) continue
        if (existing) release(existing)
        const video = create(target.src)
        const ready = () => {
          if (target.time <= 0) return
          try { video.currentTime = target.time } catch { /* Metadata may still be unavailable. */ }
        }
        video.addEventListener('loadedmetadata', ready, { once: true })
        if (video.readyState >= 1) {
          video.removeEventListener('loadedmetadata', ready)
          ready()
        }
        entries.set(target.id, { ...target, video, ready })
      }
      previousTargets = bounded
    },
    take(node: Pick<VideoNode, 'id' | 'src'>): HTMLVideoElement | null {
      const entry = entries.get(node.id)
      if (!entry || entry.src !== node.src) return null
      const video = entry.video
      entry.video = null
      // Keep a consumed marker until the plan changes. React rerenders must
      // not start a second decoder after the renderer has taken this one.
      return video
    },
    clear() {
      entries.forEach(release)
      entries.clear()
      previousTargets = []
    },
  }
}

export const masterVideoPrewarm = createVideoPrewarmPool()
