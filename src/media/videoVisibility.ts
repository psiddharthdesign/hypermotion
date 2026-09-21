// SPDX-License-Identifier: Apache-2.0
import type { VideoNode } from '@/scene/types'

/** Split clips opt out of the normal first/last-frame hold outside their range. */
export function isVideoVisibleAtTime(
  node: Pick<VideoNode, 'clipToRange' | 'startTime' | 'trimStart' | 'trimEnd' | 'duration' | 'playbackRate'>,
  playhead: number,
): boolean {
  if (!node.clipToRange) return true
  const rate = Math.max(0.05, Math.min(16, Number.isFinite(node.playbackRate) ? node.playbackRate : 1))
  const length = Math.max(0, (node.trimEnd || node.duration) - node.trimStart) / rate
  return playhead >= node.startTime && playhead < node.startTime + length
}
