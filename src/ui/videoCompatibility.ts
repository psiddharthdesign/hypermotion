// SPDX-License-Identifier: Apache-2.0

/** Decode a real frame and seek before deciding that a source needs conversion. */
export function canDecodeVideoFile(file: File): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    const url = URL.createObjectURL(file)
    let finished = false
    let seeking = false
    const finish = (supported: boolean, error?: Error) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      video.onloadeddata = null
      video.onseeked = null
      video.onerror = null
      video.pause()
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(url)
      if (error) reject(error)
      else resolve(supported)
    }
    const hasFrame = () =>
      video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0
    const timer = setTimeout(() => finish(false, new Error('Video checking took too long. Please try importing again.')), 30000)
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.onloadeddata = () => {
      if (!hasFrame()) return
      if (seeking) return
      const target = Math.min(0.12, video.duration / 2)
      if (!Number.isFinite(target) || target <= 0) {
        finish(true)
        return
      }
      seeking = true
      try {
        video.currentTime = target
      } catch {
        finish(false)
      }
    }
    video.onseeked = () => finish(hasFrame())
    video.onerror = () => finish(false)
    video.src = url
    video.load()
  })
}
