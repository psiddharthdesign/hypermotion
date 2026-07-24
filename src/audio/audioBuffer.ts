// SPDX-License-Identifier: Apache-2.0

/**
 * Shared browser audio decoding cache.
 *
 * Waveform rendering and beat analysis often need the same source at the same
 * time. Keeping decoding here prevents each surface from allocating its own
 * AudioContext and decoding a large data URL twice.
 */

const audioBufferCache = new Map<string, AudioBuffer>()
const audioBufferPromiseCache = new Map<string, Promise<AudioBuffer>>()

export function getCachedAudioBuffer(src: string): AudioBuffer | null {
  return audioBufferCache.get(src) ?? null
}

export function loadAudioBuffer(src: string): Promise<AudioBuffer> {
  const cached = audioBufferCache.get(src)
  if (cached) return Promise.resolve(cached)

  const pending = audioBufferPromiseCache.get(src)
  if (pending) return pending

  if (!src) return Promise.reject(new Error('Audio source is empty'))
  if (typeof AudioContext === 'undefined') {
    return Promise.reject(new Error('Web Audio is unavailable'))
  }

  const promise = (async () => {
    const response = await fetch(src)
    if (!response.ok) {
      throw new Error(`Unable to load audio (${response.status})`)
    }
    const bytes = await response.arrayBuffer()
    const context = new AudioContext()
    try {
      const decoded = await context.decodeAudioData(bytes.slice(0))
      audioBufferCache.set(src, decoded)
      return decoded
    } finally {
      void context.close()
      audioBufferPromiseCache.delete(src)
    }
  })()

  audioBufferPromiseCache.set(src, promise)
  return promise
}
