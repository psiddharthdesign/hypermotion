// SPDX-License-Identifier: Apache-2.0

/** Display-rate Master time, separate from the sampled React/UI transport. */
export function createMasterPlaybackClock() {
  let time = 0
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => time,
    publish(next: number) {
      if (!Number.isFinite(next) || next === time) return
      time = Math.max(0, next)
      for (const listener of listeners) listener()
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

export const masterPlaybackClock = createMasterPlaybackClock()

/** Match Scene's realtime budget without slowing the display-rate marker. */
export function createMasterFrameGate(frameRate: number) {
  const interval = 1000 / Math.max(1, Math.min(60, Number.isFinite(frameRate) ? frameRate : 60))
  let previous: number | null = null
  let elapsed = 0
  return (now: number) => {
    if (previous === null) { previous = now; return true }
    elapsed += Math.max(0, now - previous)
    previous = now
    if (elapsed + 0.25 < interval) return false
    elapsed = Math.max(0, elapsed - interval) % interval
    return true
  }
}
