// SPDX-License-Identifier: Apache-2.0

const correctionTimes = new WeakMap<HTMLMediaElement, number>()
const CORRECTION_INTERVAL_MS = 1000

/** Sync previews without continually interrupting asynchronous media decoding. */
export function syncMediaPlayback(
  media: HTMLMediaElement,
  localTime: number,
  playing: boolean,
  now = performance.now(),
): void {
  if (!playing && !media.paused) media.pause()

  // Setting src/preload (or the owner's initial load) already starts loading.
  // Calling load on every timeline tick aborts and restarts that same request.
  if (media.readyState < 1) return

  if (!playing) {
    // Scrubbing and frame-by-frame export must be able to replace a pending
    // seek with the latest requested frame, without the playback throttle.
    seek(media, localTime, 0.0001)
    correctionTimes.delete(media)
    return
  }

  if (media.seeking) {
    // Keep a grace period after a slow seek so decoding can actually advance
    // before correcting drift again. Otherwise each correction chases the
    // playhead and the video stays on its last decoded frame indefinitely.
    correctionTimes.set(media, now)
  } else if (media.paused) {
    seek(media, localTime, 0.0001)
    correctionTimes.set(media, now)
  } else if (
    media.readyState >= 2 &&
    Math.abs(media.currentTime - localTime) > 0.35 &&
    now - (correctionTimes.get(media) ?? -Infinity) >= CORRECTION_INTERVAL_MS
  ) {
    seek(media, localTime, 0.2)
    correctionTimes.set(media, now)
  }

  if (media.paused) {
    void media.play().catch(() => {
      // A later interaction/timeline tick can retry blocked playback.
    })
  }
}

function seek(media: HTMLMediaElement, localTime: number, tolerance: number) {
  if (!Number.isFinite(localTime)) return
  const duration = Number.isFinite(media.duration) && media.duration > 0
    ? media.duration
    : Infinity
  const next = Math.max(0, Math.min(duration, localTime))
  if (Math.abs(media.currentTime - next) <= tolerance) return
  try {
    media.currentTime = next
  } catch {
    // Some decoders reject early seeks; the next ready event/tick retries.
  }
}
