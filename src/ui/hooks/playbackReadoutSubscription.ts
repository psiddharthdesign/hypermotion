// SPDX-License-Identifier: Apache-2.0

type PlaybackSource = {
  subscribe: (listener: () => void) => () => void
  isPlaying: () => boolean
}

/** Keep inspector reads live without rebuilding a large form every video frame. */
export function subscribePlaybackReadout(
  source: PlaybackSource,
  listener: () => void,
  frameRate = 30,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastNotify = -Infinity
  const notify = () => {
    timer = undefined
    lastNotify = performance.now()
    listener()
  }
  const unsubscribe = source.subscribe(() => {
    if (!source.isPlaying()) {
      clearTimeout(timer)
      notify()
      return
    }
    const remaining = 1000 / frameRate - (performance.now() - lastNotify)
    if (remaining <= 0) {
      clearTimeout(timer)
      notify()
    } else if (timer === undefined) {
      timer = setTimeout(notify, remaining)
    }
  })
  return () => {
    clearTimeout(timer)
    unsubscribe()
  }
}
