// SPDX-License-Identifier: Apache-2.0

/** One owned callback at a time, including the initial draw and cleanup. */
export function startVideoFrameLoop(
  video: HTMLVideoElement,
  draw: () => void,
  playing: boolean,
): () => void {
  let handle: number | null = null
  let stopped = false
  let lastTime = Number.NaN
  const decodedFrames = typeof video.requestVideoFrameCallback === 'function'
  const schedule = () => {
    if (stopped || !playing || video.paused || video.ended || handle !== null) return
    handle = decodedFrames
      ? video.requestVideoFrameCallback(update)
      : requestAnimationFrame(update)
  }
  const update = () => {
    handle = null
    if (stopped) return
    if (decodedFrames || video.currentTime !== lastTime) {
      draw()
      lastTime = video.currentTime
    }
    schedule()
  }
  // play() can finish asynchronously after this effect mounts.
  video.addEventListener('playing', schedule)
  update()
  return () => {
    stopped = true
    video.removeEventListener('playing', schedule)
    if (handle === null) return
    if (decodedFrames) video.cancelVideoFrameCallback(handle)
    else cancelAnimationFrame(handle)
  }
}
