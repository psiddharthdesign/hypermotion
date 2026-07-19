// SPDX-License-Identifier: Apache-2.0

import type {
  EasingKind,
  Keyframe,
  KeyframeValue,
  NodeId,
  PropertyId,
  Track,
  TrackId,
} from '@/scene'
import type {
  SceneAPI,
  StaggerPropertySet,
  UiStateSlab,
} from '@/scene/doc'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import {
  keyframeValuesForPatch,
  type PatchGroup,
} from './recordKeyframes'
import {
  addKeyframe,
  ensureTrack,
  findKeyframeAt,
  findTrack,
  removeKeyframe,
} from './tracks'
import type { TextAnimationConfig } from './textAnimations'

export interface StaggerPropertyTarget {
  nodeId: NodeId
  currentValue: KeyframeValue
}

export interface StaggerAuthoringOptions {
  setId: string
  layerIds: readonly NodeId[]
  delay: number
  order?: StaggerPropertySet['order']
}

export interface StaggerPropertySummary {
  targetCount: number
  trackCount: number
  memberAtPlayheadCount: number
  state: 'none' | 'track' | 'partial' | 'at'
}

export interface StaggerSetMutationResult {
  action: 'added' | 'removed'
  trackIds: TrackId[]
  set: StaggerPropertySet | null
}

export interface StaggerSetCloneOptions {
  /** Fresh relationship id. Generated when omitted. */
  setId?: string
  /** Global start of the copy. Defaults to the source set's global end. */
  insertionTime?: number
  /** Timeline label. Defaults to "<source> Copy" or "<source> Return". */
  name?: string
}

export interface StaggerSetCloneResult {
  setId: string
  set: StaggerPropertySet
  startTime: number
  endTime: number
  trackIds: TrackId[]
}

interface AdoptedStaggerPropertyTrack {
  trackIds: TrackId[]
  maxTime: number
}

interface OwnedStaggerTrackSnapshot {
  track: Track
  keyframes: Keyframe[]
  keyframeIds: ReadonlySet<string>
}

interface StaggerSetSnapshot {
  tracks: OwnedStaggerTrackSnapshot[]
  startTime: number
  endTime: number
}

export interface StaggerSetMemberInput {
  nodeId: NodeId
  propertyId: PropertyId
  keyframeIds: readonly string[]
}

export interface ResolvedStaggerKeyframeMember {
  nodeId: NodeId
  propertyId: PropertyId
  trackId: TrackId
  keyframeId: string
  time: number
}

export interface ResolvedStaggerKeyframeBundle {
  setId: string
  propertyId: PropertyId
  edited: ResolvedStaggerKeyframeMember
  members: ResolvedStaggerKeyframeMember[]
}

export interface ResolvedStaggerTrackBundle {
  setId: string
  propertyId: PropertyId
  sourceTrackId: TrackId
  trackIdsByNode: Partial<Record<NodeId, TrackId>>
}

export interface StaggerKeyframePatch {
  time?: number
  value?: KeyframeValue
  easingOut?: EasingKind | null
  presetOrigin?: Keyframe['presetOrigin'] | null
}

export type StaggerPatchMode = 'record' | 'active-track'

/** Layer delay relative to the base authoring playhead. */
export function staggerLayerOffset(
  layerIds: readonly NodeId[],
  nodeId: NodeId,
  delay: number,
  order: StaggerPropertySet['order'] = 'forward',
): number {
  const index = layerIds.indexOf(nodeId)
  if (index < 0) return 0
  const staggerIndex = order === 'reverse' ? layerIds.length - 1 - index : index
  return staggerIndex * normalizeDelay(delay)
}

/**
 * Resolve the member that acts as the editable source for a stagger.
 *
 * Persisted layer ids can outlive a detached/deleted track. Prefer the first
 * live, member-backed layer in playback order so every entry point (Timeline,
 * keyboard shortcut, and Inspector) reveals controls that actually belong to
 * the relationship.
 */
export function resolveStaggerSetSourceNodeId(
  api: SceneAPI,
  set: StaggerPropertySet | null | undefined,
): NodeId | null {
  if (!set) return null
  const orderedLayerIds =
    set.order === 'reverse' ? [...set.layerIds].reverse() : set.layerIds

  for (const nodeId of orderedLayerIds) {
    if (!api.getNode(nodeId)) continue
    const properties = set.members[nodeId]
    if (!properties) continue
    const tracks = api.getTracksForNode(nodeId)
    const hasLiveOwnedKeyframe = Object.entries(properties).some(
      ([propertyId, keyframeIds]) => {
        if (!keyframeIds?.length) return false
        const ownedIds = new Set(keyframeIds)
        return tracks.some(
          (track) =>
            track.propertyId === propertyId &&
            track.keyframes.some((keyframe) => ownedIds.has(keyframe.id)),
        )
      },
    )
    if (hasLiveOwnedKeyframe) return nodeId
  }

  return null
}

/** Find the real track owned by one layer in a persistent stagger set. */
export function findStaggerSetMemberTrack(
  api: SceneAPI,
  setId: string,
  nodeId: NodeId,
  propertyId: PropertyId,
  preferredTime?: number,
): Track | null {
  const set = api.getUiState().staggerSets[setId]
  const owned = set?.members[nodeId]?.[propertyId]
  if (!owned?.length) return null
  const ownedIds = new Set(owned)
  const candidates = api
    .getTracksForNode(nodeId)
    .filter(
      (track) =>
        track.propertyId === propertyId &&
        track.keyframes.some((keyframe) => ownedIds.has(keyframe.id)),
    )
  if (candidates.length === 0) return null
  if (preferredTime === undefined || !Number.isFinite(preferredTime)) {
    return candidates[0] ?? null
  }
  const preferred = candidates.find((track) => {
      if (track.keyframes.length === 0) return false
      const times = track.keyframes.map((keyframe) => keyframe.time)
      const start = Math.min(...times)
      const end = Math.max(...times)
      return preferredTime >= start - 0.01 && preferredTime <= end + 0.01
    })
  // The playhead is a disambiguation hint, not a requirement. A set with one
  // owned text track must remain editable before/after its active range;
  // otherwise the Inspector can offer Add and accidentally stack duplicates.
  return preferred ?? (candidates.length === 1 ? candidates[0]! : null)
}

/**
 * Resolve the same logical property track across every layer in a set.
 * Stagger membership is appended in lockstep; matching the source track's
 * member ordinals avoids accidentally editing another text in/out animation.
 */
export function resolveStaggerTrackBundle(
  api: SceneAPI,
  setId: string,
  sourceTrackId: TrackId,
): ResolvedStaggerTrackBundle | null {
  const set = api.getUiState().staggerSets[setId]
  const sourceTrack = api.getTrack(sourceTrackId)
  if (!set || !sourceTrack) return null
  const sourceMembers = set.members[sourceTrack.nodeId]?.[sourceTrack.propertyId]
  if (!sourceMembers?.length) return null
  const sourceKeyframeIds = new Set(
    sourceTrack.keyframes.map((keyframe) => keyframe.id),
  )
  const ordinals = sourceMembers.flatMap((id, index) =>
    sourceKeyframeIds.has(id) ? [index] : [],
  )
  if (ordinals.length === 0) return null
  const participatingMemberLists = set.layerIds.flatMap((nodeId) => {
    const ids = set.members[nodeId]?.[sourceTrack.propertyId]
    return ids?.length ? [ids] : []
  })
  const intactOrdinalBundle = participatingMemberLists.every(
    (ids) => ids.length === sourceMembers.length,
  )
  const sourceBaseTime =
    trackStartTime(sourceTrack) -
    staggerLayerOffset(
      set.layerIds,
      sourceTrack.nodeId,
      set.delay,
      set.order,
    )

  const trackIdsByNode: Partial<Record<NodeId, TrackId>> = {}
  for (const nodeId of set.layerIds) {
    const memberIds = set.members[nodeId]?.[sourceTrack.propertyId]
    if (!memberIds?.length) continue
    const candidates = api
      .getTracksForNode(nodeId)
      .filter((candidate) => candidate.propertyId === sourceTrack.propertyId)
    let track: Track | undefined
    if (intactOrdinalBundle) {
      const expectedIds = new Set(
        ordinals.flatMap((ordinal) => {
          const id = memberIds[ordinal]
          return id ? [id] : []
        }),
      )
      track = candidates
        .map((candidate) => ({
          candidate,
          matchCount: candidate.keyframes.filter((keyframe) =>
            expectedIds.has(keyframe.id),
          ).length,
        }))
        .sort((a, b) => b.matchCount - a.matchCount)
        .find((entry) => entry.matchCount > 0)?.candidate
    } else {
      const ownedIds = new Set(memberIds)
      const expectedStart =
        sourceBaseTime +
        staggerLayerOffset(
          set.layerIds,
          nodeId,
          set.delay,
          set.order,
        )
      const ranked = candidates
        .filter((candidate) =>
          candidate.keyframes.some((keyframe) => ownedIds.has(keyframe.id)),
        )
        .map((candidate) => ({
          candidate,
          distance: Math.abs(trackStartTime(candidate) - expectedStart),
        }))
        .sort((a, b) => a.distance - b.distance)
      if (
        ranked[0] &&
        (!ranked[1] || Math.abs(ranked[1].distance - ranked[0].distance) > 1e-6)
      ) {
        track = ranked[0].candidate
      }
    }
    if (track) trackIdsByNode[nodeId] = track.id
  }
  if (trackIdsByNode[sourceTrack.nodeId] !== sourceTrack.id) return null
  return {
    setId,
    propertyId: sourceTrack.propertyId,
    sourceTrackId,
    trackIdsByNode,
  }
}

export function inspectStaggerSetProperty(
  api: SceneAPI,
  targets: readonly StaggerPropertyTarget[],
  propertyId: PropertyId,
  baseTime: number,
  options: StaggerAuthoringOptions,
): StaggerPropertySummary {
  const set = api.getUiState().staggerSets[options.setId]
  const layerIds = set?.layerIds.length
    ? set.layerIds
    : dedupeIds(options.layerIds)
  const delay = set?.delay ?? normalizeDelay(options.delay)
  const order = set?.order ?? options.order ?? 'forward'
  const valuesByNode = new Map(targets.map((target) => [target.nodeId, target]))
  let trackCount = 0
  let memberAtPlayheadCount = 0
  let targetCount = 0

  for (const nodeId of layerIds) {
    if (!valuesByNode.has(nodeId)) continue
    targetCount++
    const track = findTrack(api, nodeId, propertyId)
    if (track?.keyframes.length) trackCount++
    const expectedTime =
      baseTime + staggerLayerOffset(layerIds, nodeId, delay, order)
    const keyframe = findKeyframeAt(api, nodeId, propertyId, expectedTime)
    const memberIds = set?.members[nodeId]?.[propertyId] ?? []
    if (keyframe && memberIds.includes(keyframe.id)) memberAtPlayheadCount++
  }

  const state =
    targetCount > 0 && memberAtPlayheadCount === targetCount
      ? 'at'
      : memberAtPlayheadCount > 0
        ? 'partial'
        : trackCount > 0
          ? 'track'
          : 'none'
  return { targetCount, trackCount, memberAtPlayheadCount, state }
}

/**
 * Add/remove one property keyframe across the active stagger set.
 * Every layer receives the same base-time keyframe plus its set offset.
 */
export function toggleStaggerSetPropertyKeyframes(
  api: SceneAPI,
  targets: readonly StaggerPropertyTarget[],
  propertyId: PropertyId,
  baseTime: number,
  options: StaggerAuthoringOptions,
): StaggerSetMutationResult {
  const targetMap = new Map(
    dedupeTargets(targets).map((target) => [target.nodeId, target]),
  )
  const existing = api.getUiState().staggerSets[options.setId]
  const layerIds = existing?.layerIds.length
    ? existing.layerIds.filter((nodeId) => targetMap.has(nodeId))
    : dedupeIds(options.layerIds).filter((nodeId) => targetMap.has(nodeId))
  if (layerIds.length === 0) {
    return { action: 'added', trackIds: [], set: existing ?? null }
  }
  const set = existing
    ? cloneSet(existing)
    : createStaggerSet(options, layerIds)
  const summary = inspectStaggerSetProperty(
    api,
    targets,
    propertyId,
    baseTime,
    { ...options, layerIds },
  )
  const action = summary.state === 'at' ? 'removed' : 'added'
  const trackIds: TrackId[] = []
  let maxTime = api.getMeta().duration

  api.doc.transact(() => {
    for (const nodeId of layerIds) {
      const target = targetMap.get(nodeId)
      if (!target) continue
      const time = normalizeTime(
        baseTime +
          staggerLayerOffset(layerIds, nodeId, set.delay, set.order),
      )
      if (action === 'added') {
        const existingKeyframe = findKeyframeAt(
          api,
          nodeId,
          propertyId,
          time,
        )
        const keyframe = addKeyframe(
          api,
          nodeId,
          propertyId,
          time,
          target.currentValue,
          existingKeyframe?.easingOut,
        )
        addMember(set, nodeId, propertyId, keyframe.id)
        const track = findTrack(api, nodeId, propertyId)
        if (track) trackIds.push(track.id)
        maxTime = Math.max(maxTime, time)
        continue
      }

      const track = findTrack(api, nodeId, propertyId)
      const keyframe = findKeyframeAt(api, nodeId, propertyId, time)
      if (!track || !keyframe) continue
      if (!(set.members[nodeId]?.[propertyId] ?? []).includes(keyframe.id)) {
        continue
      }
      removeKeyframe(api, track.id, keyframe.id)
      removeMember(set, nodeId, propertyId, keyframe.id)
      const remainingTrack = findTrack(api, nodeId, propertyId)
      if (remainingTrack) trackIds.push(remainingTrack.id)
    }

    const nextSet = hasMembers(set) ? set : null
    writeStaggerSet(api, options.setId, nextSet)
    if (maxTime > api.getMeta().duration) api.setMeta({ duration: maxTime })
  }, UNDOABLE_GESTURE_ORIGIN)

  return {
    action,
    trackIds: [...new Set(trackIds)],
    set: hasMembers(set) ? set : null,
  }
}

/**
 * Adopt a property track created by the old single-layer Inspector path.
 *
 * Adoption is deliberately limited to properties with zero membership in the
 * stagger. Once even one bundle belongs to the set, missing keys may have been
 * intentionally detached and must never be reconstructed implicitly.
 */
function adoptStaggerSetPropertyTrackFromMember(
  api: SceneAPI,
  setId: string,
  memberNodeId: NodeId,
  propertyId: PropertyId,
): StaggerSetMutationResult | null {
  const existing = api.getUiState().staggerSets[setId]
  if (
    !existing ||
    !existing.layerIds.includes(memberNodeId) ||
    staggerSetHasPropertyMembers(existing, propertyId)
  ) {
    return null
  }

  const set = cloneSet(existing)
  const outcome: { adoption: AdoptedStaggerPropertyTrack | null } = {
    adoption: null,
  }
  api.doc.transact(() => {
    outcome.adoption = adoptStaggerPropertyTrackIntoSet(
      api,
      set,
      memberNodeId,
      propertyId,
    )
    if (!outcome.adoption) return
    writeStaggerSet(api, setId, set)
    if (outcome.adoption.maxTime > api.getMeta().duration) {
      api.setMeta({ duration: outcome.adoption.maxTime })
    }
  }, UNDOABLE_GESTURE_ORIGIN)

  if (!outcome.adoption) return null
  return {
    action: 'added',
    trackIds: outcome.adoption.trackIds,
    set,
  }
}

/**
 * Author one property while an existing stagger set is in source-layer edit
 * mode. The visible member is the canonical animation template: its exact
 * value is stamped onto every member at that member's configured offset.
 *
 * `memberTime` is the visible keyframe time on the member being edited. In the
 * normal source-layer flow its offset is zero. Subtracting the member offset
 * also keeps the operation correct if a follower is selected directly.
 */
export function toggleStaggerSetPropertyFromMember(
  api: SceneAPI,
  setId: string,
  memberNodeId: NodeId,
  propertyId: PropertyId,
  memberTime: number,
  currentValue: KeyframeValue,
): StaggerSetMutationResult | null {
  const set = api.getUiState().staggerSets[setId]
  if (!set || !set.layerIds.includes(memberNodeId)) return null

  const baseTime = normalizeTime(
    memberTime -
      staggerLayerOffset(
        set.layerIds,
        memberNodeId,
        set.delay,
        set.order,
      ),
  )
  const existingSourceKeyframe = findKeyframeAt(
    api,
    memberNodeId,
    propertyId,
    memberTime,
  )
  const targets = set.layerIds.map((nodeId) => ({
    nodeId,
    currentValue,
  }))
  let result: StaggerSetMutationResult | null = null
  api.doc.transact(() => {
    const adopted = adoptStaggerSetPropertyTrackFromMember(
      api,
      setId,
      memberNodeId,
      propertyId,
    )
    // A click on an existing, formerly source-only key means "bring this
    // property into the stagger", not "adopt it and immediately delete it".
    if (adopted && existingSourceKeyframe) {
      result = adopted
      return
    }
    result = toggleStaggerSetPropertyKeyframes(
      api,
      targets,
      propertyId,
      baseTime,
      {
        setId: set.id,
        layerIds: set.layerIds,
        delay: set.delay,
        order: set.order,
      },
    )
  }, UNDOABLE_GESTURE_ORIGIN)
  return result
}

/** Inspect the relationship-wide state for a source-layer property diamond. */
export function inspectStaggerSetPropertyFromMember(
  api: SceneAPI,
  setId: string,
  memberNodeId: NodeId,
  propertyId: PropertyId,
  memberTime: number,
): StaggerPropertySummary | null {
  const set = api.getUiState().staggerSets[setId]
  if (!set || !set.layerIds.includes(memberNodeId)) return null

  const baseTime = normalizeTime(
    memberTime -
      staggerLayerOffset(
        set.layerIds,
        memberNodeId,
        set.delay,
        set.order,
      ),
  )
  const targets = set.layerIds.map((nodeId) => ({
    nodeId,
    // Inspection only needs membership in the target map; the value is never
    // read. A valid KeyframeValue keeps this helper aligned with the authoring
    // target shape without reaching into each node's static property model.
    currentValue: 0,
  }))
  return inspectStaggerSetProperty(api, targets, propertyId, baseTime, {
    setId: set.id,
    layerIds: set.layerIds,
    delay: set.delay,
    order: set.order,
  })
}

/**
 * Stamp a committed multi-layer property edit into an existing stagger set.
 * Used after the initial diamonds so later keyframes retain each layer offset.
 */
export function stampStaggerSetPatch(
  api: SceneAPI,
  baseTime: number,
  group: PatchGroup,
  patch: Record<string, unknown>,
  mode: StaggerPatchMode,
  options: StaggerAuthoringOptions,
): TrackId[] {
  const values = keyframeValuesForPatch(group, patch)
  if (values.length === 0) return []
  const existing = api.getUiState().staggerSets[options.setId]
  const layerIds = existing?.layerIds.length
    ? existing.layerIds
    : dedupeIds(options.layerIds)
  if (layerIds.length < 2) return []
  const set = existing
    ? cloneSet(existing)
    : createStaggerSet(options, layerIds)
  const trackIds: TrackId[] = []
  let changed = false
  let maxTime = api.getMeta().duration

  api.doc.transact(() => {
    const propagateToAll = new Set<PropertyId>()
    for (const { propertyId } of values) {
      if (mode === 'record' || staggerSetHasPropertyMembers(set, propertyId)) {
        propagateToAll.add(propertyId)
      }
    }

    for (const nodeId of layerIds) {
      const time = normalizeTime(
        baseTime +
          staggerLayerOffset(layerIds, nodeId, set.delay, set.order),
      )
      for (const { propertyId, value } of values) {
        if (
          mode === 'active-track' &&
          !propagateToAll.has(propertyId)
        ) {
          continue
        }
        const existingKeyframe = findKeyframeAt(
          api,
          nodeId,
          propertyId,
          time,
        )
        const keyframe = addKeyframe(
          api,
          nodeId,
          propertyId,
          time,
          value,
          existingKeyframe?.easingOut,
        )
        addMember(set, nodeId, propertyId, keyframe.id)
        const track = findTrack(api, nodeId, propertyId)
        if (track) trackIds.push(track.id)
        changed = true
        maxTime = Math.max(maxTime, time)
      }
    }
    if (!changed) return
    writeStaggerSet(api, options.setId, set)
    if (maxTime > api.getMeta().duration) api.setMeta({ duration: maxTime })
  }, UNDOABLE_GESTURE_ORIGIN)

  return [...new Set(trackIds)]
}

/** Retime only member keyframes when the active set delay/order changes. */
export function retimeStaggerSet(
  api: SceneAPI,
  setId: string,
  delay: number,
  order?: StaggerPropertySet['order'],
): boolean {
  const existing = api.getUiState().staggerSets[setId]
  if (!existing) return false
  return configureStaggerSet(api, setId, {
    layerIds: existing.layerIds,
    delay,
    order: order ?? existing.order,
  })
}

/**
 * Apply the settings modal in one relationship-aware retime. Removing layers
 * leaves their real keyframes untouched; remaining layers close the gap and
 * preserve the configured per-layer delay/order.
 */
export function configureStaggerSet(
  api: SceneAPI,
  setId: string,
  config: {
    layerIds: readonly NodeId[]
    delay: number
    order: StaggerPropertySet['order']
  },
): boolean {
  const existing = api.getUiState().staggerSets[setId]
  if (!existing) return false
  const existingLayerIds = new Set(existing.layerIds)
  const nextLayerIds = dedupeIds(config.layerIds).filter((nodeId) =>
    existingLayerIds.has(nodeId),
  )
  const nextDelay = normalizeDelay(config.delay)
  const nextOrder = config.order
  if (nextLayerIds.length < 2) {
    api.doc.transact(
      () => writeStaggerSet(api, setId, null),
      UNDOABLE_GESTURE_ORIGIN,
    )
    return true
  }
  if (
    nextDelay === existing.delay &&
    nextOrder === existing.order &&
    nextLayerIds.length === existing.layerIds.length &&
    nextLayerIds.every((nodeId, index) => nodeId === existing.layerIds[index])
  ) {
    return false
  }
  const set = cloneSet(existing)
  let maxTime = api.getMeta().duration

  api.doc.transact(() => {
    for (const nodeId of existing.layerIds) {
      if (!nextLayerIds.includes(nodeId)) {
        delete set.members[nodeId]
        continue
      }
      const oldOffset = staggerLayerOffset(
        existing.layerIds,
        nodeId,
        existing.delay,
        existing.order,
      )
      const nextOffset = staggerLayerOffset(
        nextLayerIds,
        nodeId,
        nextDelay,
        nextOrder,
      )
      const delta = nextOffset - oldOffset
      if (Math.abs(delta) < 1e-9) continue
      for (const [propertyId, memberIds] of Object.entries(
        set.members[nodeId] ?? {},
      ) as Array<[PropertyId, string[]]>) {
        const members = new Set(memberIds)
        for (const track of tracksContainingMemberIds(
          api,
          nodeId,
          propertyId,
          members,
        )) {
          const keyframes = track.keyframes
            .map((keyframe) => {
              if (!members.has(keyframe.id)) return keyframe
              const time = normalizeTime(keyframe.time + delta)
              maxTime = Math.max(maxTime, time)
              return { ...keyframe, time }
            })
            .sort((a, b) => a.time - b.time)
          const textAnimation =
            propertyId === 'text.progress' && track.textAnimation
              ? {
                  ...track.textAnimation,
                  startTime: normalizeTime(
                    track.textAnimation.startTime + delta,
                  ),
                }
              : track.textAnimation
          api.setTrack({ ...track, keyframes, textAnimation })
          if (propertyId === 'text.progress' && textAnimation) {
            const node = api.getNode(nodeId)
            const textTracks = api
              .getTracksForNode(nodeId)
              .filter(
                (candidate) => candidate.propertyId === 'text.progress',
              )
            if (node?.kind === 'text' && textTracks.length === 1) {
              api.setNodeProperty(nodeId, 'textAnimation', textAnimation)
            }
          }
        }
      }
    }
    set.layerIds = [...nextLayerIds]
    set.delay = nextDelay
    set.order = nextOrder
    writeStaggerSet(api, setId, set)
    if (maxTime > api.getMeta().duration) api.setMeta({ duration: maxTime })
  }, UNDOABLE_GESTURE_ORIGIN)
  return true
}

/**
 * Copy a complete stagger relationship to a new global start time.
 *
 * Ordinary properties keep sharing their existing node/property track. Text
 * animations receive a fresh track because each text track owns one semantic
 * effect configuration. Every copied key gets a fresh id, so editing or
 * dissolving either relationship can never mutate the other one's membership.
 */
export function duplicateStaggerSet(
  api: SceneAPI,
  sourceSetId: string,
  options: StaggerSetCloneOptions = {},
): StaggerSetCloneResult | null {
  return cloneStaggerSet(api, sourceSetId, options, 'copy')
}

/**
 * Create an independent return animation immediately after a stagger (or at
 * an explicit insertion time). The entire relationship is reflected around
 * its global time range, rather than reversing each layer in isolation. This
 * preserves the traveling wave: the layer that settled last starts returning
 * first, and every property finishes at its exact pre-stagger value.
 */
export function createStaggerSetReturn(
  api: SceneAPI,
  sourceSetId: string,
  options: StaggerSetCloneOptions = {},
): StaggerSetCloneResult | null {
  return cloneStaggerSet(api, sourceSetId, options, 'return')
}

/**
 * Reverse one stagger in place while retaining its keyframe identities.
 * Unowned keyframes on the same tracks are left byte-for-byte untouched.
 */
export function reverseStaggerSetInPlace(
  api: SceneAPI,
  setId: string,
): boolean {
  const sourceSet = api.getUiState().staggerSets[setId]
  if (!sourceSet) return false
  const snapshot = snapshotStaggerSet(api, sourceSet)
  if (!snapshot) return false

  const nextSet = cloneSet(sourceSet)
  nextSet.order = oppositeStaggerOrder(sourceSet.order)
  let maxTime = api.getMeta().duration

  api.doc.transact(() => {
    for (const ownedTrack of snapshot.tracks) {
      const { track } = ownedTrack
      const reversed = reverseOwnedKeyframes(
        ownedTrack,
        snapshot.startTime,
        snapshot.endTime,
      )
      const byId = new Map(reversed.map((keyframe) => [keyframe.id, keyframe]))
      const keyframes = track.keyframes
        .map((keyframe) => byId.get(keyframe.id) ?? keyframe)
        .map((keyframe, index) => ({ keyframe, index }))
        .sort(
          (a, b) =>
            a.keyframe.time - b.keyframe.time || a.index - b.index,
        )
        .map((entry) => entry.keyframe)
      const ownedStart = minimumOwnedTime(keyframes, ownedTrack.keyframeIds)
      const textAnimation = mirroredTextAnimation(
        track.textAnimation,
        ownedStart,
      )
      api.setTrack({
        ...track,
        keyframes,
        ...(track.propertyId === 'text.progress'
          ? {
              defaultEasing: mirrorEasing(track.defaultEasing),
              textAnimation,
            }
          : {}),
      })
      for (const keyframe of reversed) maxTime = Math.max(maxTime, keyframe.time)
      if (track.propertyId === 'text.progress' && textAnimation) {
        syncUnambiguousTextAnimation(api, track.nodeId, track.id, textAnimation)
      }
    }
    writeStaggerSet(api, setId, nextSet)
    if (maxTime > api.getMeta().duration) api.setMeta({ duration: maxTime })
  }, UNDOABLE_GESTURE_ORIGIN)
  return true
}

/**
 * Resolve the corresponding keyframe on every layer in a stagger bundle.
 *
 * Membership is persistent, while bundle identity is derived from the set's
 * configured per-layer offset. This lets any member act as the edit source —
 * not only the first layer — and deliberately skips plucked/missing members.
 */
export function resolveStaggerKeyframeBundle(
  api: SceneAPI,
  trackId: TrackId,
  keyframeId: string,
): ResolvedStaggerKeyframeBundle | null {
  const editedTrack = api.getTrack(trackId)
  const editedKeyframe = editedTrack?.keyframes.find(
    (keyframe) => keyframe.id === keyframeId,
  )
  if (!editedTrack || !editedKeyframe) return null

  for (const [setId, set] of Object.entries(api.getUiState().staggerSets)) {
    const owned = set.members[editedTrack.nodeId]?.[editedTrack.propertyId]
    if (!owned?.includes(keyframeId)) continue
    const memberIndex = owned.indexOf(keyframeId)
    const intactOrdinalBundle = set.layerIds.every((nodeId) => {
      const ids = set.members[nodeId]?.[editedTrack.propertyId]
      return !ids || ids.length === owned.length
    })

    const editedOffset = staggerLayerOffset(
      set.layerIds,
      editedTrack.nodeId,
      set.delay,
      set.order,
    )
    const baseTime = editedKeyframe.time - editedOffset
    const members: ResolvedStaggerKeyframeMember[] = []

    for (const nodeId of set.layerIds) {
      const memberIds = set.members[nodeId]?.[editedTrack.propertyId]
      if (!memberIds?.length) continue
      // Membership ids are appended in lockstep when a bundle is authored.
      // Prefer that persistent ordinal when every participating layer remains
      // intact, so even a legacy member that drifted in time can be repaired by
      // the next edit. Once anything is plucked, timing inference below avoids
      // shifting onto the neighboring bundle.
      if (intactOrdinalBundle) {
        const ordinalId = memberIds[memberIndex]
        const track = ordinalId
          ? trackContainingKeyframeId(
              api,
              nodeId,
              editedTrack.propertyId,
              ordinalId,
            )
          : null
        const ordinalKeyframe = ordinalId
          ? track?.keyframes.find((keyframe) => keyframe.id === ordinalId)
          : undefined
        if (track && ordinalKeyframe) {
          members.push({
            nodeId,
            propertyId: editedTrack.propertyId,
            trackId: track.id,
            keyframeId: ordinalKeyframe.id,
            time: ordinalKeyframe.time,
          })
          continue
        }
      }
      const expectedTime =
        baseTime +
        staggerLayerOffset(
          set.layerIds,
          nodeId,
          set.delay,
          set.order,
        )
      const candidates = tracksContainingMemberIds(
        api,
        nodeId,
        editedTrack.propertyId,
        new Set(memberIds),
      ).flatMap((track) =>
        track.keyframes
          .filter((keyframe) => memberIds.includes(keyframe.id))
          .map((keyframe) => ({ track, keyframe })),
      )
      let closest = candidates[0]
      let distance = closest
        ? Math.abs(closest.keyframe.time - expectedTime)
        : Infinity
      for (const candidate of candidates.slice(1)) {
        const nextDistance = Math.abs(candidate.keyframe.time - expectedTime)
        if (nextDistance < distance) {
          closest = candidate
          distance = nextDistance
        }
      }
      // Never borrow a keyframe from an adjacent bundle on the same property.
      if (!closest || distance > 0.025) continue
      members.push({
        nodeId,
        propertyId: editedTrack.propertyId,
        trackId: closest.track.id,
        keyframeId: closest.keyframe.id,
        time: closest.keyframe.time,
      })
    }

    const edited = members.find(
      (member) =>
        member.trackId === trackId && member.keyframeId === keyframeId,
    )
    if (!edited) return null
    return {
      setId,
      propertyId: editedTrack.propertyId,
      edited,
      members,
    }
  }
  return null
}

/**
 * Apply one keyframe edit to its entire stagger bundle in one transaction.
 * Values and easing metadata are copied exactly; time edits preserve the set's
 * delay by applying the edited member's delta to every corresponding key.
 */
export function patchStaggerKeyframeBundle(
  api: SceneAPI,
  trackId: TrackId,
  keyframeId: string,
  patch: StaggerKeyframePatch,
): ResolvedStaggerKeyframeBundle | null {
  const bundle = resolveStaggerKeyframeBundle(api, trackId, keyframeId)
  if (!bundle) return null
  const hasTime = typeof patch.time === 'number' && Number.isFinite(patch.time)
  const timeDelta = hasTime ? normalizeTime(patch.time!) - bundle.edited.time : 0
  const byTrack = new Map<TrackId, Set<string>>()
  for (const member of bundle.members) {
    const ids = byTrack.get(member.trackId) ?? new Set<string>()
    ids.add(member.keyframeId)
    byTrack.set(member.trackId, ids)
  }

  api.doc.transact(() => {
    for (const [memberTrackId, memberIds] of byTrack) {
      const track = api.getTrack(memberTrackId)
      if (!track) continue
      let changed = false
      const keyframes = track.keyframes
        .map((keyframe, index) => {
          if (!memberIds.has(keyframe.id)) return { keyframe, index }
          const next: Keyframe = { ...keyframe }
          if (hasTime) next.time = normalizeTime(keyframe.time + timeDelta)
          if ('value' in patch && patch.value !== undefined) {
            next.value = patch.value
          }
          if ('easingOut' in patch) {
            if (patch.easingOut == null) delete next.easingOut
            else next.easingOut = patch.easingOut
          }
          if ('presetOrigin' in patch) {
            if (patch.presetOrigin == null) delete next.presetOrigin
            else next.presetOrigin = patch.presetOrigin
          }
          changed = true
          return { keyframe: next, index }
        })
        .sort(
          (a, b) => a.keyframe.time - b.keyframe.time || a.index - b.index,
        )
        .map((entry) => entry.keyframe)
      if (!changed) continue
      const textAnimation =
        track.propertyId === 'text.progress' && track.textAnimation && hasTime
          ? {
              ...track.textAnimation,
              startTime: keyframes[0]?.time ?? track.textAnimation.startTime,
            }
          : track.textAnimation
      api.setTrack({ ...track, keyframes, textAnimation })
      if (track.propertyId === 'text.progress' && textAnimation && hasTime) {
        const node = api.getNode(track.nodeId)
        const textTracks = api
          .getTracksForNode(track.nodeId)
          .filter((candidate) => candidate.propertyId === 'text.progress')
        if (node?.kind === 'text' && textTracks.length === 1) {
          api.setNodeProperty(track.nodeId, 'textAnimation', textAnimation)
        }
      }
    }
  })
  return bundle
}

export function staggerSetPropertyIds(
  set: StaggerPropertySet | null | undefined,
): PropertyId[] {
  if (!set) return []
  const ids = new Set<PropertyId>()
  for (const layer of Object.values(set.members)) {
    for (const propertyId of Object.keys(layer) as PropertyId[]) {
      if ((layer[propertyId]?.length ?? 0) > 0) ids.add(propertyId)
    }
  }
  return [...ids]
}

/** Rename a persistent stagger relationship without touching its keyframes. */
export function renameStaggerSet(
  api: SceneAPI,
  setId: string,
  name: string,
): boolean {
  const existing = api.getUiState().staggerSets[setId]
  if (!existing) return false
  const next = cloneSet(existing)
  const normalized = name.trim()
  if (normalized) next.name = normalized
  else delete next.name
  api.doc.transact(
    () => writeStaggerSet(api, setId, next),
    UNDOABLE_GESTURE_ORIGIN,
  )
  return true
}

/** Update relationship metadata after the timeline has already retimed keys. */
export function setStaggerSetDelayMetadata(
  api: SceneAPI,
  setId: string,
  delay: number,
): boolean {
  const existing = api.getUiState().staggerSets[setId]
  if (!existing) return false
  const nextDelay = normalizeDelay(delay)
  if (nextDelay === existing.delay) return false
  const next = cloneSet(existing)
  next.delay = nextDelay
  api.doc.transact(
    () => writeStaggerSet(api, setId, next),
    UNDOABLE_GESTURE_ORIGIN,
  )
  return true
}

/**
 * Dissolve only the stagger relationship. Authored tracks/keyframes remain
 * exactly where they are and return to ordinary independent timeline keys.
 */
export function removeStaggerSet(api: SceneAPI, setId: string): boolean {
  if (!api.getUiState().staggerSets[setId]) return false
  api.doc.transact(
    () => writeStaggerSet(api, setId, null),
    UNDOABLE_GESTURE_ORIGIN,
  )
  return true
}

/**
 * Detach selected real keyframes from a stagger relationship. The keyframes
 * themselves are deliberately untouched; only the persistent membership is
 * removed. Empty layers are pruned and a one-layer remainder dissolves since
 * it no longer represents a stagger.
 */
export function detachStaggerSetKeyframes(
  api: SceneAPI,
  setId: string,
  members: readonly StaggerSetMemberInput[],
): boolean {
  const existing = api.getUiState().staggerSets[setId]
  if (!existing || members.length === 0) return false
  const set = cloneSet(existing)
  let changed = false
  for (const member of members) {
    const ids = set.members[member.nodeId]?.[member.propertyId]
    if (!ids?.length) continue
    const detached = new Set(member.keyframeIds)
    const next = ids.filter((id) => !detached.has(id))
    if (next.length === ids.length) continue
    changed = true
    if (next.length > 0) {
      set.members[member.nodeId]![member.propertyId] = next
    } else {
      delete set.members[member.nodeId]![member.propertyId]
    }
  }
  if (!changed) return false
  api.doc.transact(
    () => writeStaggerSet(api, setId, normalizedSetOrNull(set)),
    UNDOABLE_GESTURE_ORIGIN,
  )
  return true
}

/** Delete a linked source/follower bundle while keeping set metadata clean. */
export function deleteStaggerSetKeyframes(
  api: SceneAPI,
  setId: string,
  members: readonly StaggerSetMemberInput[],
): boolean {
  const existing = api.getUiState().staggerSets[setId]
  if (!existing || members.length === 0) return false
  const set = cloneSet(existing)
  let changed = false
  api.doc.transact(() => {
    for (const member of members) {
      const ownedIds = set.members[member.nodeId]?.[member.propertyId]
      if (!ownedIds?.length) continue
      const deleting = new Set(member.keyframeIds)
      for (const keyframeId of ownedIds) {
        if (!deleting.has(keyframeId)) continue
        const track = trackContainingKeyframeId(
          api,
          member.nodeId,
          member.propertyId,
          keyframeId,
        )
        if (track?.keyframes.some((keyframe) => keyframe.id === keyframeId)) {
          removeKeyframe(api, track.id, keyframeId)
        }
        removeMember(set, member.nodeId, member.propertyId, keyframeId)
        changed = true
      }
    }
    if (changed) writeStaggerSet(api, setId, normalizedSetOrNull(set))
  }, UNDOABLE_GESTURE_ORIGIN)
  return changed
}

/** Delete every keyframe owned by one stagger relationship. */
export function deleteStaggerSet(
  api: SceneAPI,
  setId: string,
): boolean {
  const set = api.getUiState().staggerSets[setId]
  if (!set) return false
  const members: StaggerSetMemberInput[] = []
  for (const nodeId of set.layerIds) {
    for (const [propertyId, keyframeIds] of Object.entries(
      set.members[nodeId] ?? {},
    ) as Array<[PropertyId, string[]]>) {
      if (!keyframeIds.length) continue
      members.push({ nodeId, propertyId, keyframeIds: [...keyframeIds] })
    }
  }
  if (members.length === 0) return removeStaggerSet(api, setId)
  return deleteStaggerSetKeyframes(api, setId, members)
}

/** Detach complete layers from a stagger while preserving their animation. */
export function detachStaggerSetLayers(
  api: SceneAPI,
  setId: string,
  nodeIds: readonly NodeId[],
): boolean {
  const existing = api.getUiState().staggerSets[setId]
  if (!existing || nodeIds.length === 0) return false
  const detached = new Set(nodeIds)
  if (!existing.layerIds.some((nodeId) => detached.has(nodeId))) return false
  return configureStaggerSet(api, setId, {
    layerIds: existing.layerIds.filter((nodeId) => !detached.has(nodeId)),
    delay: existing.delay,
    order: existing.order,
  })
}

/** Adopt keyframes produced by a preset into the active layer bundles. */
export function registerStaggerSetKeyframes(
  api: SceneAPI,
  options: StaggerAuthoringOptions,
  members: readonly StaggerSetMemberInput[],
): StaggerPropertySet | null {
  if (members.length === 0) return null
  const existing = api.getUiState().staggerSets[options.setId]
  const layerIds = existing?.layerIds.length
    ? existing.layerIds
    : dedupeIds(options.layerIds)
  if (layerIds.length < 2) return null
  const layerSet = new Set(layerIds)
  const set = existing
    ? cloneSet(existing)
    : createStaggerSet(options, layerIds)

  api.doc.transact(() => {
    for (const member of members) {
      if (!layerSet.has(member.nodeId)) continue
      const liveIds = new Set(
        api
          .getTracksForNode(member.nodeId)
          .filter((track) => track.propertyId === member.propertyId)
          .flatMap((track) =>
            track.keyframes.map((keyframe) => keyframe.id),
          ),
      )
      if (liveIds.size === 0) continue
      const existingIds = set.members[member.nodeId]?.[member.propertyId]
      if (existingIds) {
        set.members[member.nodeId]![member.propertyId] =
          existingIds.filter((id) => liveIds.has(id))
      }
      for (const keyframeId of member.keyframeIds) {
        if (liveIds.has(keyframeId)) {
          addMember(set, member.nodeId, member.propertyId, keyframeId)
        }
      }
    }
    if (hasMembers(set)) writeStaggerSet(api, options.setId, set)
  }, UNDOABLE_GESTURE_ORIGIN)
  return hasMembers(set) ? set : null
}

function createStaggerSet(
  options: StaggerAuthoringOptions,
  layerIds: readonly NodeId[],
): StaggerPropertySet {
  return {
    id: options.setId,
    layerIds: [...layerIds],
    delay: normalizeDelay(options.delay),
    order: options.order ?? 'forward',
    members: {},
  }
}

function cloneSet(set: StaggerPropertySet): StaggerPropertySet {
  const members: StaggerPropertySet['members'] = {}
  for (const [nodeId, properties] of Object.entries(set.members)) {
    members[nodeId] = {}
    for (const [propertyId, ids] of Object.entries(properties)) {
      members[nodeId]![propertyId as PropertyId] = [...(ids ?? [])]
    }
  }
  return { ...set, layerIds: [...set.layerIds], members }
}

function addMember(
  set: StaggerPropertySet,
  nodeId: NodeId,
  propertyId: PropertyId,
  keyframeId: string,
) {
  const properties = (set.members[nodeId] ??= {})
  const ids = (properties[propertyId] ??= [])
  if (!ids.includes(keyframeId)) ids.push(keyframeId)
}

function removeMember(
  set: StaggerPropertySet,
  nodeId: NodeId,
  propertyId: PropertyId,
  keyframeId: string,
) {
  const properties = set.members[nodeId]
  if (!properties) return
  const ids = (properties[propertyId] ?? []).filter((id) => id !== keyframeId)
  if (ids.length > 0) properties[propertyId] = ids
  else delete properties[propertyId]
  if (Object.keys(properties).length === 0) delete set.members[nodeId]
}

function hasMembers(set: StaggerPropertySet): boolean {
  return Object.values(set.members).some((properties) =>
    Object.values(properties).some((ids) => (ids?.length ?? 0) > 0),
  )
}

function normalizedSetOrNull(
  set: StaggerPropertySet,
): StaggerPropertySet | null {
  for (const [nodeId, properties] of Object.entries(set.members)) {
    for (const [propertyId, ids] of Object.entries(properties)) {
      if ((ids?.length ?? 0) === 0) {
        delete properties[propertyId as PropertyId]
      }
    }
    if (Object.keys(properties).length === 0) delete set.members[nodeId]
  }
  set.layerIds = set.layerIds.filter((nodeId) => !!set.members[nodeId])
  return set.layerIds.length >= 2 && hasMembers(set) ? set : null
}

function writeStaggerSet(
  api: SceneAPI,
  setId: string,
  set: StaggerPropertySet | null,
) {
  const ui = api.getUiState()
  const staggerSets = { ...ui.staggerSets }
  if (set) staggerSets[setId] = set
  else delete staggerSets[setId]
  // Early stagger builds mirrored every layer bundle into the generic
  // keyframe-group UI. That made one stagger appear as many unrelated blue
  // group bars and hid the actual keys. Stagger sets now own their timeline
  // representation, so clean those legacy synthetic groups on any set edit.
  const kfGroups: UiStateSlab['kfGroups'] = {}
  const kfGroupCollapsed: UiStateSlab['kfGroupCollapsed'] = {}
  for (const [groupId, keys] of Object.entries(ui.kfGroups)) {
    if (groupId.startsWith('stagger-set:')) continue
    kfGroups[groupId] = [...keys]
    if (ui.kfGroupCollapsed[groupId]) kfGroupCollapsed[groupId] = true
  }
  api.setUiState({ staggerSets, kfGroups, kfGroupCollapsed })
}

function dedupeTargets(
  targets: readonly StaggerPropertyTarget[],
): StaggerPropertyTarget[] {
  const byNode = new Map<NodeId, StaggerPropertyTarget>()
  for (const target of targets) byNode.set(target.nodeId, target)
  return [...byNode.values()]
}

function dedupeIds(ids: readonly NodeId[]): NodeId[] {
  return [...new Set(ids)]
}

function staggerSetHasPropertyMembers(
  set: StaggerPropertySet,
  propertyId: PropertyId,
): boolean {
  return Object.values(set.members).some(
    (properties) => (properties[propertyId]?.length ?? 0) > 0,
  )
}

/**
 * Clone one canonical member's complete property track into a stagger set.
 * The source keyframes themselves are never rewritten, so custom curves and
 * other metadata survive adoption byte-for-byte.
 */
function adoptStaggerPropertyTrackIntoSet(
  api: SceneAPI,
  set: StaggerPropertySet,
  sourceNodeId: NodeId,
  propertyId: PropertyId,
): AdoptedStaggerPropertyTrack | null {
  if (
    !set.layerIds.includes(sourceNodeId) ||
    staggerSetHasPropertyMembers(set, propertyId)
  ) {
    return null
  }
  const sourceTrack = findTrack(api, sourceNodeId, propertyId)
  if (!sourceTrack?.keyframes.length) return null

  const sourceOffset = staggerLayerOffset(
    set.layerIds,
    sourceNodeId,
    set.delay,
    set.order,
  )
  const trackIds: TrackId[] = [sourceTrack.id]
  let maxTime = api.getMeta().duration

  for (const sourceKeyframe of sourceTrack.keyframes) {
    addMember(set, sourceNodeId, propertyId, sourceKeyframe.id)
    maxTime = Math.max(maxTime, sourceKeyframe.time)
  }

  for (const nodeId of set.layerIds) {
    if (nodeId === sourceNodeId || !api.getNode(nodeId)) continue
    const targetOffset = staggerLayerOffset(
      set.layerIds,
      nodeId,
      set.delay,
      set.order,
    )
    const targetTrack = ensureTrack(
      api,
      nodeId,
      propertyId,
      sourceTrack.defaultEasing,
    )
    // A key without easingOut falls back to its track default, so matching the
    // source default is necessary for exact curve replication.
    api.setTrack({
      ...targetTrack,
      defaultEasing: sourceTrack.defaultEasing,
    })
    for (const sourceKeyframe of sourceTrack.keyframes) {
      const baseTime = sourceKeyframe.time - sourceOffset
      const time = normalizeTime(baseTime + targetOffset)
      const keyframe = addKeyframe(
        api,
        nodeId,
        propertyId,
        time,
        sourceKeyframe.value,
        sourceKeyframe.easingOut,
        sourceKeyframe.presetOrigin,
      )
      addMember(set, nodeId, propertyId, keyframe.id)
      maxTime = Math.max(maxTime, time)
    }
    const liveTrack = findTrack(api, nodeId, propertyId)
    if (liveTrack) trackIds.push(liveTrack.id)
  }

  return { trackIds: [...new Set(trackIds)], maxTime }
}

type StaggerCloneKind = 'copy' | 'return'

function cloneStaggerSet(
  api: SceneAPI,
  sourceSetId: string,
  options: StaggerSetCloneOptions,
  kind: StaggerCloneKind,
): StaggerSetCloneResult | null {
  const sourceSet = api.getUiState().staggerSets[sourceSetId]
  if (!sourceSet) return null
  const snapshot = snapshotStaggerSet(api, sourceSet)
  if (!snapshot) return null

  const usedSetIds = new Set(Object.keys(api.getUiState().staggerSets))
  const requestedSetId = options.setId?.trim()
  if (requestedSetId && usedSetIds.has(requestedSetId)) return null
  const setId = requestedSetId || freshId('stagger', usedSetIds)
  const sourceLabel = sourceSet.name?.trim() || 'Stagger'
  const defaultName = `${sourceLabel} ${kind === 'return' ? 'Return' : 'Copy'}`
  const requestedName = options.name?.trim()
  const frameDuration = 1 / Math.max(1, api.getMeta().frameRate)
  const defaultInsertion = snapshot.endTime + frameDuration
  const insertionTime = normalizeTime(
    options.insertionTime !== undefined &&
      Number.isFinite(options.insertionTime)
      ? options.insertionTime
      : defaultInsertion,
  )
  const span = snapshot.endTime - snapshot.startTime
  const endTime = normalizeTime(insertionTime + span)

  const keyframeIds = new Set(
    api.getAllTracks().flatMap((track) =>
      track.keyframes.map((keyframe) => keyframe.id),
    ),
  )
  const trackIds = new Set(api.getAllTracks().map((track) => track.id))
  const copiedKeyframeIds = new Map<string, string>()
  for (const ownedTrack of snapshot.tracks) {
    for (const keyframe of ownedTrack.keyframes) {
      if (!copiedKeyframeIds.has(keyframe.id)) {
        copiedKeyframeIds.set(keyframe.id, freshId('keyframe', keyframeIds))
      }
    }
  }

  const set: StaggerPropertySet = {
    id: setId,
    name: requestedName || defaultName,
    layerIds: [...sourceSet.layerIds],
    delay: sourceSet.delay,
    order:
      kind === 'return'
        ? oppositeStaggerOrder(sourceSet.order)
        : sourceSet.order,
    members: {},
  }
  for (const [nodeId, properties] of Object.entries(sourceSet.members)) {
    for (const [propertyId, sourceIds] of Object.entries(properties) as Array<
      [PropertyId, string[]]
    >) {
      for (const sourceId of sourceIds) {
        const copiedId = copiedKeyframeIds.get(sourceId)
        if (copiedId) addMember(set, nodeId, propertyId, copiedId)
      }
    }
  }

  const affectedTrackIds: TrackId[] = []
  api.doc.transact(() => {
    for (const ownedTrack of snapshot.tracks) {
      const copies =
        kind === 'return'
          ? cloneReversedOwnedKeyframes(
              ownedTrack,
              snapshot.endTime,
              insertionTime,
              copiedKeyframeIds,
            )
          : ownedTrack.keyframes.map((keyframe) => ({
              ...keyframe,
              id: copiedKeyframeIds.get(keyframe.id)!,
              time: normalizeTime(
                insertionTime + keyframe.time - snapshot.startTime,
              ),
            }))

      if (ownedTrack.track.propertyId === 'text.progress') {
        const newTrackId = freshId('text-track', trackIds)
        const copiedStart = Math.min(...copies.map((keyframe) => keyframe.time))
        const textAnimation =
          kind === 'return'
            ? mirroredTextAnimation(
                ownedTrack.track.textAnimation,
                copiedStart,
              )
            : shiftedTextAnimation(
                ownedTrack.track.textAnimation,
                copiedStart,
              )
        api.setTrack({
          ...ownedTrack.track,
          id: newTrackId,
          keyframes: copies,
          ...(kind === 'return'
            ? { defaultEasing: mirrorEasing(ownedTrack.track.defaultEasing) }
            : {}),
          textAnimation,
        })
        affectedTrackIds.push(newTrackId)
        continue
      }

      const currentTrack = api.getTrack(ownedTrack.track.id)
      if (!currentTrack) continue
      const keyframes = [...currentTrack.keyframes, ...copies]
        .map((keyframe, index) => ({ keyframe, index }))
        .sort(
          (a, b) =>
            a.keyframe.time - b.keyframe.time || a.index - b.index,
        )
        .map((entry) => entry.keyframe)
      api.setTrack({ ...currentTrack, keyframes })
      affectedTrackIds.push(currentTrack.id)
    }
    writeStaggerSet(api, setId, set)
    if (endTime > api.getMeta().duration) api.setMeta({ duration: endTime })
  }, UNDOABLE_GESTURE_ORIGIN)

  return {
    setId,
    set,
    startTime: insertionTime,
    endTime,
    trackIds: [...new Set(affectedTrackIds)],
  }
}

function snapshotStaggerSet(
  api: SceneAPI,
  set: StaggerPropertySet,
): StaggerSetSnapshot | null {
  const byTrack = new Map<
    TrackId,
    { track: Track; ids: Set<string>; keyframes: Keyframe[] }
  >()
  for (const nodeId of set.layerIds) {
    for (const [propertyId, memberIds] of Object.entries(
      set.members[nodeId] ?? {},
    ) as Array<[PropertyId, string[]]>) {
      for (const keyframeId of memberIds) {
        const track = trackContainingKeyframeId(
          api,
          nodeId,
          propertyId,
          keyframeId,
        )
        const keyframe = track?.keyframes.find(
          (candidate) => candidate.id === keyframeId,
        )
        if (!track || !keyframe) continue
        const entry = byTrack.get(track.id) ?? {
          track,
          ids: new Set<string>(),
          keyframes: [],
        }
        if (!entry.ids.has(keyframe.id)) {
          entry.ids.add(keyframe.id)
          entry.keyframes.push({ ...keyframe })
        }
        byTrack.set(track.id, entry)
      }
    }
  }
  const tracks: OwnedStaggerTrackSnapshot[] = [...byTrack.values()].map(
    (entry) => ({
      track: entry.track,
      keyframeIds: entry.ids,
      keyframes: entry.keyframes
        .map((keyframe, index) => ({ keyframe, index }))
        .sort(
          (a, b) =>
            a.keyframe.time - b.keyframe.time || a.index - b.index,
        )
        .map((item) => item.keyframe),
    }),
  )
  const keyframes = tracks.flatMap((track) => track.keyframes)
  if (keyframes.length === 0) return null
  return {
    tracks,
    startTime: Math.min(...keyframes.map((keyframe) => keyframe.time)),
    endTime: Math.max(...keyframes.map((keyframe) => keyframe.time)),
  }
}

function cloneReversedOwnedKeyframes(
  ownedTrack: OwnedStaggerTrackSnapshot,
  sourceGlobalEnd: number,
  targetGlobalStart: number,
  copiedIds: ReadonlyMap<string, string>,
): Keyframe[] {
  const source = ownedTrack.keyframes
  return [...source].reverse().map((keyframe, targetIndex) => {
    const sourceIndex = source.length - 1 - targetIndex
    const sourceSegmentStart = source[sourceIndex - 1]
    return withOutgoingEasing(
      {
        ...keyframe,
        id: copiedIds.get(keyframe.id)!,
        time: normalizeTime(
          targetGlobalStart + sourceGlobalEnd - keyframe.time,
        ),
      },
      sourceSegmentStart,
      ownedTrack.track.defaultEasing,
    )
  })
}

function reverseOwnedKeyframes(
  ownedTrack: OwnedStaggerTrackSnapshot,
  globalStart: number,
  globalEnd: number,
): Keyframe[] {
  const source = ownedTrack.keyframes
  return [...source].reverse().map((keyframe, targetIndex) => {
    const sourceIndex = source.length - 1 - targetIndex
    const sourceSegmentStart = source[sourceIndex - 1]
    return withOutgoingEasing(
      {
        ...keyframe,
        time: normalizeTime(globalStart + globalEnd - keyframe.time),
      },
      sourceSegmentStart,
      ownedTrack.track.defaultEasing,
    )
  })
}

function withOutgoingEasing(
  keyframe: Keyframe,
  sourceSegmentStart: Keyframe | undefined,
  sourceDefault: EasingKind,
): Keyframe {
  const next = { ...keyframe }
  if (sourceSegmentStart) {
    next.easingOut = mirrorEasing(
      sourceSegmentStart.easingOut ?? sourceDefault,
    )
  } else {
    delete next.easingOut
  }
  return next
}

/**
 * Mirror an easing function as `1 - easing(1 - t)`.
 *
 * A damped spring's exact time reverse cannot be represented by the current
 * `{ spring }` schema (it would need a driven/anti-damped curve), so spring
 * parameters are retained as the least-surprising editable fallback.
 */
function mirrorEasing(easing: EasingKind): EasingKind {
  if (easing === 'ease-in') return 'ease-out'
  if (easing === 'ease-out') return 'ease-in'
  if (easing === 'linear' || easing === 'ease-in-out') return easing
  if ('bezier' in easing) {
    const [x1, y1, x2, y2] = easing.bezier
    return { bezier: [1 - x2, 1 - y2, 1 - x1, 1 - y1] }
  }
  return {
    spring: {
      stiffness: easing.spring.stiffness,
      damping: easing.spring.damping,
      mass: easing.spring.mass,
    },
  }
}

function shiftedTextAnimation(
  config: TextAnimationConfig | null | undefined,
  startTime: number,
): TextAnimationConfig | null | undefined {
  return config ? { ...config, startTime } : config
}

function mirroredTextAnimation(
  config: TextAnimationConfig | null | undefined,
  startTime: number,
): TextAnimationConfig | null | undefined {
  // Keep mode, per-segment order, custom stagger curve, and path unchanged.
  // Descending text.progress values make the renderer evaluate the exact same
  // geometry in reverse, including arbitrary user-drawn envelope curves.
  return shiftedTextAnimation(config, startTime)
}

function minimumOwnedTime(
  keyframes: readonly Keyframe[],
  ownedIds: ReadonlySet<string>,
): number {
  const times = keyframes.flatMap((keyframe) =>
    ownedIds.has(keyframe.id) ? [keyframe.time] : [],
  )
  return times.length > 0 ? Math.min(...times) : 0
}

function syncUnambiguousTextAnimation(
  api: SceneAPI,
  nodeId: NodeId,
  trackId: TrackId,
  config: TextAnimationConfig,
) {
  const textTracks = api
    .getTracksForNode(nodeId)
    .filter((track) => track.propertyId === 'text.progress')
  if (
    textTracks.length === 1 &&
    textTracks[0]?.id === trackId &&
    api.getNode(nodeId)?.kind === 'text'
  ) {
    api.setNodeProperty(nodeId, 'textAnimation', config)
  }
}

function oppositeStaggerOrder(
  order: StaggerPropertySet['order'],
): StaggerPropertySet['order'] {
  return order === 'forward' ? 'reverse' : 'forward'
}

function freshId(prefix: string, used: Set<string>): string {
  let id = ''
  do {
    id = `${prefix}-${
      Math.random().toString(36).slice(2, 10) +
      Math.random().toString(36).slice(2, 10)
    }`
  } while (used.has(id))
  used.add(id)
  return id
}

function normalizeDelay(delay: number): number {
  return Math.max(0, Number.isFinite(delay) ? delay : 0)
}

function normalizeTime(time: number): number {
  return Math.max(0, Number(time.toFixed(9)))
}

function trackStartTime(track: Track): number {
  return track.keyframes.length > 0
    ? Math.min(...track.keyframes.map((keyframe) => keyframe.time))
    : Infinity
}

function tracksContainingMemberIds(
  api: SceneAPI,
  nodeId: NodeId,
  propertyId: PropertyId,
  memberIds: ReadonlySet<string>,
): Track[] {
  return api
    .getTracksForNode(nodeId)
    .filter(
      (track) =>
        track.propertyId === propertyId &&
        track.keyframes.some((keyframe) => memberIds.has(keyframe.id)),
    )
}

function trackContainingKeyframeId(
  api: SceneAPI,
  nodeId: NodeId,
  propertyId: PropertyId,
  keyframeId: string,
): Track | null {
  return (
    api
      .getTracksForNode(nodeId)
      .find(
        (track) =>
          track.propertyId === propertyId &&
          track.keyframes.some((keyframe) => keyframe.id === keyframeId),
      ) ?? null
  )
}
