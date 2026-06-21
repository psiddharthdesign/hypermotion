// SPDX-License-Identifier: Apache-2.0

import type { SceneAPI } from '@/scene/doc'
import type { SceneNode } from '@/scene'

interface FrameSegment {
  firstFrame: number
  lastFrame: number
}

export interface PcmAudioTrack {
  sampleRate: number
  numberOfChannels: number
  samples: Float32Array[]
}

interface MediaAudioNode {
  id: string
  src: string
  duration: number
  volume: number
  muted: boolean
  startTime: number
  trimStart: number
  trimEnd: number
  loop: boolean
}

export async function mixSceneAudioTrack(opts: {
  api: SceneAPI
  segments: FrameSegment[]
  fps: number
  sampleRate?: number
  numberOfChannels?: number
}): Promise<PcmAudioTrack | null> {
  if (typeof window === 'undefined' || typeof AudioContext === 'undefined') {
    return null
  }

  const mediaNodes = collectAudibleMediaNodes(opts.api)
  if (mediaNodes.length === 0) return null

  const sampleRate = opts.sampleRate ?? 48_000
  const numberOfChannels = opts.numberOfChannels ?? 2
  const totalFrames = opts.segments.reduce(
    (acc, seg) => acc + (seg.lastFrame - seg.firstFrame + 1),
    0,
  )
  const totalSamples = Math.max(1, Math.ceil((totalFrames / opts.fps) * sampleRate))
  const output = Array.from(
    { length: numberOfChannels },
    () => new Float32Array(totalSamples),
  )

  const ctx = new AudioContext({ sampleRate })
  try {
    for (const node of mediaNodes) {
      const buffer = await decodeMediaAudio(ctx, node.src)
      if (!buffer) continue
      mixNodeIntoOutput({
        node,
        buffer,
        output,
        segments: opts.segments,
        fps: opts.fps,
        sampleRate,
      })
    }
  } finally {
    void ctx.close()
  }

  if (!hasSignal(output)) return null
  return { sampleRate, numberOfChannels, samples: output }
}

function collectAudibleMediaNodes(api: SceneAPI): MediaAudioNode[] {
  const nodes: MediaAudioNode[] = []
  for (const id of api.getAllNodeIds()) {
    const node = api.getNode(id)
    if (!node || (node.kind !== 'audio' && node.kind !== 'video')) continue
    const media = node as Extract<SceneNode, { kind: 'audio' | 'video' }>
    const muted = media.kind === 'video' ? media.muted : media.muted
    if (!media.src || muted || (media.volume ?? 1) <= 0) continue
    nodes.push({
      id: media.id,
      src: media.src,
      duration: media.duration || 0,
      volume: media.volume ?? 1,
      muted,
      startTime: media.startTime ?? 0,
      trimStart: media.trimStart ?? 0,
      trimEnd: media.trimEnd || media.duration || 0,
      loop: media.loop ?? false,
    })
  }
  return nodes
}

async function decodeMediaAudio(
  ctx: AudioContext,
  src: string,
): Promise<AudioBuffer | null> {
  try {
    const response = await fetch(src)
    const bytes = await response.arrayBuffer()
    return await ctx.decodeAudioData(bytes.slice(0))
  } catch {
    return null
  }
}

function mixNodeIntoOutput(opts: {
  node: MediaAudioNode
  buffer: AudioBuffer
  output: Float32Array[]
  segments: FrameSegment[]
  fps: number
  sampleRate: number
}) {
  const { node, buffer, output, segments, fps, sampleRate } = opts
  const clipStart = Math.max(0, Math.min(buffer.duration, node.trimStart))
  const clipEnd = Math.max(clipStart, Math.min(buffer.duration, node.trimEnd || node.duration || buffer.duration))
  const clipLen = clipEnd - clipStart
  if (clipLen <= 0) return

  let outFrameOffset = 0
  for (const seg of segments) {
    const segFrames = seg.lastFrame - seg.firstFrame + 1
    const segStart = seg.firstFrame / fps
    for (let frame = 0; frame < segFrames; frame++) {
      const sceneT = segStart + frame / fps
      const local = sceneTimeToMediaLocal(sceneT, node, clipStart, clipLen)
      if (local === null) continue
      const outSampleStart = Math.round(((outFrameOffset + frame) / fps) * sampleRate)
      const outSampleEnd = Math.round(((outFrameOffset + frame + 1) / fps) * sampleRate)
      mixSampleSpan({
        buffer,
        output,
        volume: node.volume,
        mediaStartSec: local,
        outSampleStart,
        outSampleEnd,
        sampleRate,
      })
    }
    outFrameOffset += segFrames
  }
}

function sceneTimeToMediaLocal(
  sceneT: number,
  node: MediaAudioNode,
  clipStart: number,
  clipLen: number,
): number | null {
  const rel = sceneT - node.startTime
  if (rel < 0) return null
  if (node.loop) return clipStart + (rel % clipLen)
  if (rel >= clipLen) return null
  return clipStart + rel
}

function mixSampleSpan(opts: {
  buffer: AudioBuffer
  output: Float32Array[]
  volume: number
  mediaStartSec: number
  outSampleStart: number
  outSampleEnd: number
  sampleRate: number
}) {
  const { buffer, output, volume, mediaStartSec, outSampleStart, outSampleEnd, sampleRate } = opts
  const sourceRate = buffer.sampleRate
  const sourceChannels = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
    buffer.getChannelData(i),
  )
  for (let out = outSampleStart; out < outSampleEnd && out < output[0].length; out++) {
    const elapsed = (out - outSampleStart) / sampleRate
    const sourceIndex = Math.floor((mediaStartSec + elapsed) * sourceRate)
    if (sourceIndex < 0 || sourceIndex >= buffer.length) break
    for (let ch = 0; ch < output.length; ch++) {
      const source = sourceChannels[Math.min(ch, sourceChannels.length - 1)]
      output[ch][out] = clampAudio(output[ch][out] + source[sourceIndex] * volume)
    }
  }
}

function hasSignal(samples: Float32Array[]): boolean {
  for (const channel of samples) {
    for (let i = 0; i < channel.length; i += 128) {
      if (Math.abs(channel[i]) > 0.00001) return true
    }
  }
  return false
}

function clampAudio(n: number): number {
  if (n < -1) return -1
  if (n > 1) return 1
  return n
}
