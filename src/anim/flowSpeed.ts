// SPDX-License-Identifier: Apache-2.0
import type { Track } from '@/scene/types'
import { evaluator } from './easing'

interface IntegralSegment { start: number; end: number; area: number; sample: (u: number) => number }
interface SpeedIntegral { firstTime: number; lastTime: number; firstValue: number; lastValue: number; segments: IntegralSegment[] }
const cache = new WeakMap<Track, SpeedIntegral>()
const speed = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.max(-2000, Math.min(2000, value)) : 0

function integrate(sample: (u: number) => number, end: number): number {
  // Composite Simpson integration is deterministic and accommodates cubic and spring easing.
  const intervals = 96, step = end / intervals
  let sum = sample(0) + sample(end)
  for (let index = 1; index < intervals; index++) sum += sample(index * step) * (index % 2 ? 4 : 2)
  return sum * step / 3
}

function prepare(track: Track): SpeedIntegral {
  const previous = cache.get(track)
  if (previous) return previous
  const keys = [...track.keyframes].sort((a, b) => a.time - b.time)
  const segments: IntegralSegment[] = []
  for (let index = 1; index < keys.length; index++) {
    const a = keys[index - 1]!, b = keys[index]!, duration = b.time - a.time
    if (duration <= 0) continue
    const ease = evaluator(a.easingOut ?? track.defaultEasing)
    const av = typeof a.value === 'number' ? a.value : 0, bv = typeof b.value === 'number' ? b.value : av
    const sample = (u: number) => speed(av + (bv - av) * ease(u))
    segments.push({ start: a.time, end: b.time, area: duration * integrate(sample, 1), sample })
  }
  const result = { firstTime: keys[0]?.time ?? 0, lastTime: keys.at(-1)?.time ?? 0, firstValue: speed(keys[0]?.value), lastValue: speed(keys.at(-1)?.value), segments }
  cache.set(track, result)
  return result
}

/** Integrate velocity from scene time zero; seeking never depends on playback history. */
export function integratedFlowDistance(track: Track, time: number): number {
  if (!Number.isFinite(time) || !track.keyframes.length) return 0
  const data = prepare(track)
  const primitive = (at: number) => {
    if (at <= data.firstTime) return (at - data.firstTime) * data.firstValue
    let area = 0
    for (const segment of data.segments) {
      if (at >= segment.end) area += segment.area
      else if (at > segment.start) { area += (segment.end - segment.start) * integrate(segment.sample, (at - segment.start) / (segment.end - segment.start)); break }
      else break
    }
    if (at > data.lastTime) area += (at - data.lastTime) * data.lastValue
    return area
  }
  return primitive(time) - primitive(0)
}
