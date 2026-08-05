// SPDX-License-Identifier: Apache-2.0

import type { SceneAPI } from '@/scene/doc'
import type { SceneNode } from '@/scene'
import {
  resolveMasterTime,
  type ResolvedSequenceItem,
  type SequenceTimeMap,
} from '@/sequence'
import {
  isMasterAudioNode,
  resolveMasterAudioGain,
} from '@/audio/masterAudio'

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
  playbackRate: number
  muted: boolean
  startTime: number
  trimStart: number
  trimEnd: number
  loop: boolean
  /** Null denotes project-level audio that follows master time directly. */
  ownerSceneId: string | null
}

export async function mixSceneAudioTrack(opts: {
  api: SceneAPI
  segments: FrameSegment[]
  fps: number
  /** Explicit export clock. Legacy callers infer sequence from timeMap. */
  scope?: 'scene' | 'sequence'
  /** Present when frames are sampled from the master sequence. */
  sequenceTimeMap?: SequenceTimeMap
  /**
   * Occurrence whose Master soundtrack window is borrowed by a Scene export.
   * Invalid or absent ids fall back deterministically to the active scene's
   * first occurrence.
   */
  selectedSequenceItemId?: string
  /** Active composition identity used to validate occurrence selection. */
  activeSceneId?: string
  /** Active composition root for a scene-only export. */
  activeRootNodeId?: string
  sampleRate?: number
  numberOfChannels?: number
}): Promise<PcmAudioTrack | null> {
  if (typeof window === 'undefined' || typeof AudioContext === 'undefined') {
    return null
  }

  const scope =
    opts.scope ?? (opts.sequenceTimeMap ? 'sequence' : 'scene')
  const sceneOccurrence =
    scope === 'scene' && opts.sequenceTimeMap
      ? resolveSceneExportOccurrence(
          opts.sequenceTimeMap,
          opts.selectedSequenceItemId,
          opts.activeSceneId ??
            sceneIdForRoot(opts.sequenceTimeMap, opts.activeRootNodeId),
        )
      : null
  const mediaNodes = collectAudibleMediaNodes(
    opts.api,
    scope,
    opts.sequenceTimeMap,
    opts.activeRootNodeId,
    sceneOccurrence,
  )
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
        sequenceTimeMap: opts.sequenceTimeMap,
        scope,
        sceneSequenceItemId: sceneOccurrence?.item.id,
      })
    }
  } finally {
    void ctx.close()
  }

  if (!hasSignal(output)) return null
  return { sampleRate, numberOfChannels, samples: output }
}

function collectAudibleMediaNodes(
  api: SceneAPI,
  scope: 'scene' | 'sequence',
  sequenceTimeMap: SequenceTimeMap | undefined,
  activeRootNodeId: string | undefined,
  sceneOccurrence: ResolvedSequenceItem | null,
): MediaAudioNode[] {
  const nodes: MediaAudioNode[] = []
  const activeTree =
    scope === 'scene' ? collectSubtreeIds(api, activeRootNodeId) : null
  const ownerByNodeId = scope === 'sequence' && sequenceTimeMap
    ? indexSequenceNodeOwners(api, sequenceTimeMap)
    : null
  for (const id of api.getAllNodeIds()) {
    const node = api.getNode(id)
    if (!node || (node.kind !== 'audio' && node.kind !== 'video')) continue
    const media = node as Extract<SceneNode, { kind: 'audio' | 'video' }>
    const muted = media.kind === 'video' ? media.muted : media.muted
    if (!media.src || muted || (media.volume ?? 1) <= 0) continue
    // Parentless audio is the project soundtrack and follows master time.
    // Visual video nodes (and the uncommon parented audio node) belong to the
    // composition root that contains them.
    const projectLevelAudio = isMasterAudioNode(media)
    // A Scene export can borrow Master audio only when it resolves to one
    // concrete occurrence. Without that context, omitting the bed is safer
    // than silently borrowing the wrong repeated use of a composition.
    if (
      projectLevelAudio &&
      (!sequenceTimeMap || (scope === 'scene' && !sceneOccurrence))
    ) {
      continue
    }
    const ownerSceneId = projectLevelAudio
      ? null
      : ownerByNodeId?.get(media.id) ??
        (activeTree?.has(media.id)
          ? sceneOccurrence?.scene.id ?? '__active-scene__'
          : null)
    if (!projectLevelAudio) {
      if (scope === 'sequence' && ownerSceneId === null) continue
      if (scope === 'scene' && !activeTree?.has(media.id)) continue
    }
    nodes.push({
      id: media.id,
      src: media.src,
      duration: media.duration || 0,
      volume: media.volume ?? 1,
      playbackRate: media.playbackRate ?? 1,
      muted,
      startTime: media.startTime ?? 0,
      trimStart: media.trimStart ?? 0,
      trimEnd: media.trimEnd || media.duration || 0,
      loop: media.loop ?? false,
      ownerSceneId,
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
  sequenceTimeMap?: SequenceTimeMap
  scope: 'scene' | 'sequence'
  sceneSequenceItemId?: string
}) {
  const {
    node,
    buffer,
    output,
    segments,
    fps,
    sampleRate,
    sequenceTimeMap,
    scope,
    sceneSequenceItemId,
  } = opts
  const clipStart = Math.max(0, Math.min(buffer.duration, node.trimStart))
  const clipEnd = Math.max(clipStart, Math.min(buffer.duration, node.trimEnd || node.duration || buffer.duration))
  const clipLen = clipEnd - clipStart
  if (clipLen <= 0) return

  let outFrameOffset = 0
  for (const seg of segments) {
    const segFrames = seg.lastFrame - seg.firstFrame + 1
    const segStart = seg.firstFrame / fps
    for (let frame = 0; frame < segFrames; frame++) {
      const masterTime = segStart + frame / fps
      const outSampleStart = Math.round(((outFrameOffset + frame) / fps) * sampleRate)
      const outSampleEnd = Math.round(((outFrameOffset + frame + 1) / fps) * sampleRate)
      const timelineSamples = resolveMediaTimelineSamples({
        masterTime,
        ownerSceneId: node.ownerSceneId,
        sequenceTimeMap,
        scope,
        sceneSequenceItemId,
      })
      for (const timelineSample of timelineSamples) {
        if (timelineSample.weight <= 0) continue
        const local = sceneTimeToMediaLocal(
          timelineSample.time,
          node,
          clipStart,
          clipLen,
        )
        if (local === null) continue
        mixSampleSpan({
          buffer,
          output,
          volume: node.volume * timelineSample.weight,
          playbackRate: node.playbackRate,
          mediaStartSec: local,
          outSampleStart,
          outSampleEnd,
          sampleRate,
        })
      }
    }
    outFrameOffset += segFrames
  }
}

export interface MediaTimelineSample {
  /** Project-master or composition-local time used by media clip timing. */
  time: number
  /** Linear transition contribution. */
  weight: number
}

/**
 * Resolve the timeline samples contributing one media node at an export time.
 *
 * During a sequence export, project-level audio follows Master time and
 * scene-owned media follows each matching occurrence's local time and
 * transition weight. During a Scene export, project-level audio borrows the
 * selected occurrence's Master window while scene-owned media stays on the
 * composition-local clock.
 */
export function resolveMediaTimelineSamples(input: {
  masterTime: number
  ownerSceneId: string | null
  sequenceTimeMap?: SequenceTimeMap
  scope?: 'scene' | 'sequence'
  sceneSequenceItemId?: string
}): MediaTimelineSample[] {
  const masterTime = Number.isFinite(input.masterTime)
    ? input.masterTime
    : 0
  const scope =
    input.scope ?? (input.sequenceTimeMap ? 'sequence' : 'scene')
  if (input.ownerSceneId === null) {
    if (!input.sequenceTimeMap) return []
    if (scope === 'scene') {
      const occurrence = input.sceneSequenceItemId
        ? input.sequenceTimeMap.items.find(
            (candidate) =>
              candidate.item.id === input.sceneSequenceItemId,
          ) ?? null
        : null
      if (
        !occurrence ||
        occurrence.item.masterAudioMuted === true ||
        masterTime < occurrence.sourceStart ||
        masterTime >= occurrence.sourceEnd
      ) {
        return []
      }
      return [{
        time:
          occurrence.masterStart +
          masterTime -
          occurrence.sourceStart,
        weight: 1,
      }]
    }
    return [{
      time: masterTime,
      weight: resolveMasterAudioGain(input.sequenceTimeMap, masterTime),
    }]
  }
  if (scope === 'scene' || !input.sequenceTimeMap) {
    return [{ time: masterTime, weight: 1 }]
  }
  return resolveMasterTime(input.sequenceTimeMap, masterTime, {
    clamp: true,
    quantize: 'none',
  }).layers
    .filter((layer) => layer.item.scene.id === input.ownerSceneId)
    .map((layer) => ({
      time: layer.localTime,
      weight: layer.weight,
    }))
}

/**
 * Resolve which occurrence a Scene export borrows from the Master timeline.
 *
 * Repeated compositions make scene id alone ambiguous, so a valid explicit
 * occurrence always wins. If it is missing or stale, the first occurrence of
 * the active composition is selected; only when no active composition can be
 * matched do we fall back to the first resolved sequence item.
 */
export function resolveSceneExportOccurrence(
  timeMap: SequenceTimeMap,
  selectedSequenceItemId?: string,
  activeSceneId?: string | null,
): ResolvedSequenceItem | null {
  if (selectedSequenceItemId) {
    const selected = timeMap.items.find(
      (candidate) => candidate.item.id === selectedSequenceItemId,
    )
    if (
      selected &&
      (!activeSceneId || selected.scene.id === activeSceneId)
    ) {
      return selected
    }
  }
  if (activeSceneId) {
    const activeOccurrence = timeMap.items.find(
      (candidate) => candidate.scene.id === activeSceneId,
    )
    return activeOccurrence ?? null
  }
  return timeMap.items[0] ?? null
}

function sceneIdForRoot(
  timeMap: SequenceTimeMap,
  rootNodeId: string | undefined,
): string | null {
  if (!rootNodeId) return null
  return (
    timeMap.items.find(
      (candidate) => candidate.scene.rootNodeId === rootNodeId,
    )?.scene.id ?? null
  )
}

function collectSubtreeIds(
  api: SceneAPI,
  rootId: string | undefined,
): Set<string> {
  const ids = new Set<string>()
  if (!rootId) return ids
  const visit = (id: string): void => {
    if (ids.has(id)) return
    ids.add(id)
    for (const child of api.getChildren(id)) visit(child.id)
  }
  visit(rootId)
  return ids
}

function indexSequenceNodeOwners(
  api: SceneAPI,
  timeMap: SequenceTimeMap,
): Map<string, string> {
  const owners = new Map<string, string>()
  const seenScenes = new Set<string>()
  for (const item of timeMap.items) {
    if (seenScenes.has(item.scene.id)) continue
    seenScenes.add(item.scene.id)
    for (const nodeId of collectSubtreeIds(api, item.scene.rootNodeId)) {
      if (!owners.has(nodeId)) owners.set(nodeId, item.scene.id)
    }
  }
  return owners
}

function sceneTimeToMediaLocal(
  sceneT: number,
  node: MediaAudioNode,
  clipStart: number,
  clipLen: number,
): number | null {
  const rel = sceneT - node.startTime
  if (rel < 0) return null
  const sourceRel = rel * Math.max(0.05, node.playbackRate || 1)
  if (node.loop) return clipStart + (sourceRel % clipLen)
  if (sourceRel >= clipLen) return null
  return clipStart + sourceRel
}

function mixSampleSpan(opts: {
  buffer: AudioBuffer
  output: Float32Array[]
  volume: number
  playbackRate: number
  mediaStartSec: number
  outSampleStart: number
  outSampleEnd: number
  sampleRate: number
}) {
  const { buffer, output, volume, playbackRate, mediaStartSec, outSampleStart, outSampleEnd, sampleRate } = opts
  const sourceRate = buffer.sampleRate
  const sourceChannels = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
    buffer.getChannelData(i),
  )
  for (let out = outSampleStart; out < outSampleEnd && out < output[0].length; out++) {
    const elapsed = (out - outSampleStart) / sampleRate
    const sourceIndex = Math.floor((mediaStartSec + elapsed * Math.max(0.05, playbackRate || 1)) * sourceRate)
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
