// SPDX-License-Identifier: Apache-2.0
import type { AudioNode, VideoNode } from './types'

export function mediaClipRange(node: AudioNode | VideoNode) {
  const rate = Math.max(0.05, Math.min(16, node.playbackRate || 1))
  const sourceDuration = Math.max(0, node.duration || 0)
  const trimStart = Math.max(0, Math.min(sourceDuration, node.trimStart || 0))
  const trimEnd = Math.max(trimStart, Math.min(sourceDuration, node.trimEnd ?? sourceDuration))
  const duration = (trimEnd - trimStart) / rate
  const start = Number.isFinite(node.startTime) ? node.startTime : 0
  return { rate, trimStart, trimEnd, duration, start, end: start + duration }
}

export function videoVisibleAtTime(node: VideoNode, time: number): boolean {
  if (!node.clipToRange) return true
  const range = mediaClipRange(node)
  return time >= range.start && (node.loop || time < range.end)
}
