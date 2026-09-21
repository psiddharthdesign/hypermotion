// SPDX-License-Identifier: Apache-2.0
import * as THREE from 'three'

type VideoResource = {
  texture: THREE.CanvasTexture | THREE.VideoTexture
  textureKind: 'canvas' | 'video'
  video?: HTMLVideoElement
  videoSource?: string
}

export function createVideoTexture(video: HTMLVideoElement): THREE.VideoTexture {
  const texture = new THREE.VideoTexture(video)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.flipY = false
  texture.generateMipmaps = false
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  return texture
}

/** Property animation must never reset decoding or force a redundant upload. */
export function ensureVideoTexture(
  record: VideoResource,
  src: string,
  createVideo: () => HTMLVideoElement,
): boolean {
  // Do not read HTMLVideoElement.src here. Native URL serialization copies
  // multi-megabyte embedded videos on every animated property frame.
  if (record.textureKind === 'video' && record.video && record.videoSource === src) return false
  record.texture.dispose()
  if (record.video) {
    record.video.pause()
    record.video.removeAttribute('src')
    record.video.load()
  }
  const video = createVideo()
  record.texture = createVideoTexture(video)
  record.textureKind = 'video'
  record.video = video
  record.videoSource = src
  return true
}
