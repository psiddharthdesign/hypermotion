// SPDX-License-Identifier: Apache-2.0

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { Music2, Wand2 } from 'lucide-react'
import { useUI } from '@/state/ui'
import { useSceneAPI, useSceneVersion } from '@/scene'
import { getAnimEngine, removeKeyframe, removeTrack } from '@/anim'
import {
  configureStaggerSet,
  createStaggerSetReturn,
  deleteStaggerSet,
  deleteStaggerSetKeyframes,
  detachStaggerSetKeyframes,
  detachStaggerSetLayers,
  duplicateStaggerSet,
  removeStaggerSet,
  renameStaggerSet,
  resolveStaggerKeyframeBundle,
  resolveStaggerSetSourceNodeId,
  reverseStaggerSetInPlace,
  setStaggerSetDelayMetadata,
  type StaggerSetMemberInput,
} from '@/anim/staggerSets'
import type { SceneNode, Section, Track } from '@/scene'
import type { SceneAPI } from '@/scene/doc'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import {
  groupKeyframes as groupKeyframesHelper,
  ungroupKeyframeGroups as ungroupKeyframeGroupsHelper,
  ungroupKeyframes as ungroupKeyframesHelper,
  toggleKfGroupCollapsed as toggleKfGroupCollapsedHelper,
  groupTracks as groupTracksHelper,
  ungroupTracks as ungroupTracksHelper,
  removeTracksFromGroups as removeTracksFromGroupsHelper,
  addTracksToGroup as addTracksToGroupHelper,
  insertTracksIntoGroup as insertTracksIntoGroupHelper,
  toggleTrackGroupCollapsed as toggleTrackGroupCollapsedHelper,
  renameTrackGroup as renameTrackGroupHelper,
  deleteAnimationTracks as deleteAnimationTracksHelper,
} from '@/state/groupActions'
import { importAudioFile } from '@/ui/importMedia'
import {
  createKeyframeDragSession,
  keyframeDragPreviewStore,
  type KeyframeDragMember,
} from '@/ui/keyframeDragPreviewStore'
import {
  groupEdgeHitWidth,
  SEGMENT_DRAG_HIT_HEIGHT,
} from '@/ui/timelineDragHitArea'
import {
  createSectionDragSession,
  sectionDragPreviewStore,
} from '@/ui/sectionDragPreviewStore'
import { activateStaggerSetForEditing } from '@/ui/staggerEditing'
import {
  createNoteMarkersForBars,
  divisionForBar,
  type AudioBeatGrid,
  type NoteDivision,
  type NoteMarker,
} from '@/audio/beatSync'
import {
  getCachedAudioBuffer,
  loadAudioBuffer,
} from '@/audio/audioBuffer'
import {
  beatSyncSelectionKey,
  planKeyframeBeatSync,
} from '@/audio/beatSyncPlan'

/**
 * Keyframe multi-select keys are the compound `trackId:kfId` string.
 * Plain ids would collide across tracks — two different tracks can
 * independently hand out the same `kfId` prefix from their id generator
 * — so the owning track has to be part of the identity. Kept as a
 * one-line helper because it's used from half a dozen call sites.
 */
const kfKey = (trackId: string, kfId: string) => `${trackId}:${kfId}`
const TRACK_IDS_DRAG_TYPE = 'application/x-hypermotion-track-ids'

function staggerMemberInputs(
  members: ResolvedStaggerTimelineSet['members'],
): StaggerSetMemberInput[] {
  const grouped = new Map<string, StaggerSetMemberInput>()
  for (const member of members) {
    const key = `${member.nodeId}\u0000${member.propertyId}`
    let input = grouped.get(key)
    if (!input) {
      input = {
        nodeId: member.nodeId,
        propertyId: member.propertyId,
        keyframeIds: [],
      }
      grouped.set(key, input)
    }
    ;(input.keyframeIds as string[]).push(member.kfId)
  }
  return [...grouped.values()]
}

function setDraggedTrackIds(e: React.DragEvent, trackIds: string[]): void {
  const ids = [...new Set(trackIds)].filter(Boolean)
  if (ids.length === 0) return
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData(TRACK_IDS_DRAG_TYPE, JSON.stringify(ids))
  e.dataTransfer.setData('text/plain', ids.join(','))
}

function getDraggedTrackIds(e: React.DragEvent): string[] {
  const raw = e.dataTransfer.getData(TRACK_IDS_DRAG_TYPE)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string')
      : []
  } catch {
    return []
  }
}

function dragTrackIdsFor(trackId: string): string[] {
  const selected = useUI.getState().selectedTrackIds
  return selected.includes(trackId) && selected.length > 0
    ? selected
    : [trackId]
}

/**
 * Timeline.
 *
 * MVP surface:
 *   - Ruler along the top with scene-duration-aware tick marks.
 *   - Scrubbing: click anywhere in the ruler or a track row to jump the
 *     playhead there. Dragging along the ruler continues to scrub.
 *   - Track list on the left, keyframe rows on the right. Each keyframe
 *     is a diamond you can drag horizontally to retime (drops on mouse
 *     up). Alt/Option-click deletes a keyframe.
 *   - Playhead line drawn across all rows.
 *
 * Intentionally plain DOM, not a canvas layer — still well under 16ms
 * for a few dozen tracks, and way easier to iterate on. Canvas layer
 * arrives in Step 6.5 once we have enough keyframes on screen to care.
 *
 * Scroll: the ruler + rows share a horizontal scroll because they need
 * to stay aligned. The Track column on the left is sticky so track
 * labels don't disappear when you scroll right.
 */

const TRACK_HEADER_WIDTH = 180
// Live horizontal zoom in pixels-per-second. Mirrors the value held
// in useUI's `timelinePxPerSecond`. We mirror it into a module-level
// mutable so all the timeline's helper components, callbacks, and
// drag handlers can read the current zoom without each one having
// to subscribe to the store. The Timeline component syncs this on
// every render — child components re-render in lockstep with the
// store, so closures see fresh values.
let PX_PER_SECOND = 80
let BEAT_SNAP_TIMES: number[] = []
function setBeatSnapTimes(times: number[]): void {
  BEAT_SNAP_TIMES = times
}
let smoothSeekAnimationId: number | null = null
const ROW_HEIGHT = 24
type TimelineMode = 'animated' | 'sound'
type MediaTimelineNode = Extract<SceneNode, { kind: 'audio' | 'video' }>

type ResolvedStaggerTimelineSet = {
  id: string
  label: string
  hostNodeId: string
  sourceNodeId: string
  layerIds: string[]
  delay: number
  order: 'forward' | 'reverse'
  propertyIds: string[]
  memberKeys: string[]
  members: Array<{
    trackId: string
    kfId: string
    time: number
    nodeId: string
    propertyId: Track['propertyId']
  }>
  start: number
  end: number
}

type StaggerDetachAction = {
  shortLabel: string
  menuLabel: string
  title: string
  run: () => void
}

function useKeyframePreviewTime(
  trackId: string,
  kfId: string,
  fallback: number,
): number {
  const subscribe = useCallback(
    (listener: () => void) =>
      keyframeDragPreviewStore.subscribe(trackId, kfId, listener),
    [kfId, trackId],
  )
  const getSnapshot = useCallback(
    () => keyframeDragPreviewStore.getTime(trackId, kfId, fallback),
    [fallback, kfId, trackId],
  )
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function useKeyframePreviewRevision(
  trackId: string,
  keyframes: Track['keyframes'],
): number {
  const keys = useMemo(
    () => keyframes.map((keyframe) => [trackId, keyframe.id] as const),
    [keyframes, trackId],
  )
  return useKeyframeKeysPreviewRevision(keys)
}

function useKeyframeKeysPreviewRevision(
  keys: ReadonlyArray<readonly [trackId: string, kfId: string]>,
): number {
  const subscribe = useCallback(
    (listener: () => void) => {
      const unsubscribes = keys.map(([ownerId, keyframeId]) =>
        keyframeDragPreviewStore.subscribe(ownerId, keyframeId, listener),
      )
      return () => {
        for (const unsubscribe of unsubscribes) unsubscribe()
      }
    },
    [keys],
  )
  const getSnapshot = useCallback(
    () => keyframeDragPreviewStore.getRevision(),
    [],
  )
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function useSectionPreview(section: Section): Section {
  const subscribe = useCallback(
    (listener: () => void) =>
      sectionDragPreviewStore.subscribe(section.id, listener),
    [section.id],
  )
  const getSnapshot = useCallback(
    () => sectionDragPreviewStore.getSection(section.id, section),
    [section],
  )
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function Timeline() {
  // Version is read *and* used as a memo dep — without it, `tracksByNode`
  // stays cached across scene mutations, so keyframe drags only visually
  // settle on the next unrelated re-render (e.g. when you click outside).
  const version = useSceneVersion()
  const api = useSceneAPI()
  // Transport time is subscribed by tiny readout/marker leaves below. Keeping
  // it out of this large component prevents the whole timeline from rebuilding
  // every 66 ms during playback.
  const setPlayhead = useUI((s) => s.setPlayhead)
  const playing = useUI((s) => s.playing)
  const setPlaying = useUI((s) => s.setPlaying)
  const selection = useUI((s) => s.selection)
  const setSelection = useUI((s) => s.setSelection)
  const setInspectorMode = useUI((s) => s.setInspectorMode)
  const openContextMenu = useUI((s) => s.openContextMenu)
  const timelineHeight = useUI((s) => s.timelineHeight)
  const setTimelineHeight = useUI((s) => s.setTimelineHeight)
  // Live horizontal zoom level. Pinch / Cmd+scroll over the timeline
  // updates this; the rest of the timeline math (positions, segment
  // widths, hit-tests) reads from the module-level mirror so children
  // don't each have to subscribe.
  const pxPerSecond = useUI((s) => s.timelinePxPerSecond)
  const setTimelinePxPerSecond = useUI((s) => s.setTimelinePxPerSecond)
  const selectedTrackIds = useUI((s) => s.selectedTrackIds)
  const setSelectedTrackIds = useUI((s) => s.setSelectedTrackIds)
  const staggerDelay = useUI((s) => s.staggerDelay)
  const setStaggerDelay = useUI((s) => s.setStaggerDelay)
  const staggerOn = useUI((s) => s.staggerOn)
  const setStaggerOn = useUI((s) => s.setStaggerOn)
  const activeStaggerSetId = useUI((s) => s.activeStaggerSetId)
  const selectedStaggerSetId = useUI((s) => s.selectedStaggerSetId)
  const setSelectedStaggerSetId = useUI((s) => s.setSelectedStaggerSetId)
  const isolatedRange = useUI((s) => s.isolatedRange)
  const setIsolatedRange = useUI((s) => s.setIsolatedRange)
  const workAreaRange = useUI((s) => s.workAreaRange)
  const setWorkAreaRange = useUI((s) => s.setWorkAreaRange)
  const workAreaPlaybackMode = useUI((s) => s.workAreaPlaybackMode)
  const setWorkAreaPlaybackMode = useUI((s) => s.setWorkAreaPlaybackMode)
  const rulerLabels = useUI((s) => s.rulerLabels)
  const cycleRulerLabels = useUI((s) => s.cycleRulerLabels)
  // Group dictionaries now live in the Y.Doc — read them off the
  // version-keyed scene API so Cmd+Z reverts them like any other
  // doc edit. Memo deps include `version` (already pulled above)
  // so the dicts refresh whenever Yjs mutates.
  const uiSlab = useMemo(
    () => api.getUiState(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, version],
  )
  const trackGroupsDict = uiSlab.trackGroups
  // Early stagger builds wrote one synthetic generic keyframe group per
  // layer. Ignore those legacy records immediately so old scenes stop
  // rendering the oversized blue GROUP rows before their next edit cleans
  // the records from the document permanently.
  const kfGroupsDict = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(uiSlab.kfGroups).filter(
          ([groupId]) => !groupId.startsWith('stagger-set:'),
        ),
      ),
    [uiSlab.kfGroups],
  )
  const kfGroupCollapsedDict = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(uiSlab.kfGroupCollapsed).filter(
          ([groupId]) => !groupId.startsWith('stagger-set:'),
        ),
      ),
    [uiSlab.kfGroupCollapsed],
  )
  const groupTracksAction = useCallback(
    (ids: string[]) => groupTracksHelper(api, ids),
    [api],
  )
  const ungroupTracksAction = useCallback(
    (ids: string[]) => ungroupTracksHelper(api, ids),
    [api],
  )
  const toggleTrackGroupCollapsed = useCallback(
    (gid: string) => toggleTrackGroupCollapsedHelper(api, gid),
    [api],
  )
  const toggleGroupCollapsed = useCallback(
    (gid: string) => toggleKfGroupCollapsedHelper(api, gid),
    [api],
  )
  // Add a 1-second section starting at the playhead. Cycles a fixed
  // palette so adjacent pills are visually distinct without making the
  // user pick a color every time. Used by the in-lane "+ Section"
  // button below the transport.
  const addSectionAtPlayhead = useCallback(() => {
    const id = `sec_${Math.random().toString(36).slice(2, 9)}`
    const playhead = useUI.getState().playhead
    const docDuration = api.getMeta().duration
    const start = playhead
    const end = Math.min(docDuration, playhead + 1)
    const palette = [
      'oklch(0.78 0.13 230)', // sky
      'oklch(0.80 0.16 80)',  // amber
      'oklch(0.74 0.18 150)', // mint
      'oklch(0.74 0.18 350)', // pink
    ]
    const idx = api.getSections().length % palette.length
    api.setSection({
      id,
      name: `Chapter ${api.getSections().length + 1}`,
      color: palette[idx]!,
      start,
      end,
    })
  }, [api])
  // Sync mirror on every render. Children read PX_PER_SECOND directly;
  // since they re-render alongside us, their closures see the fresh
  // value. Hooks rules don't forbid this — it's an instantaneous
  // synchronous write into a module variable.
  PX_PER_SECOND = pxPerSecond
  const duration = api.getMeta().duration
  const frameRate = api.getMeta().frameRate
  const frameStep = 1 / Math.max(1, frameRate)
  const minWorkArea = Math.max(frameStep, 0.05)
  const normalizedWorkArea = workAreaRange
    ? normalizeTimelineWorkArea(workAreaRange, duration, minWorkArea)
    : null
  const cancelSmoothSeek = useCallback(() => {
    if (smoothSeekAnimationId === null) return
    window.cancelAnimationFrame(smoothSeekAnimationId)
    smoothSeekAnimationId = null
  }, [])
  const setPlayheadImmediate = useCallback(
    (time: number) => {
      cancelSmoothSeek()
      setPlayhead(time)
    },
    [cancelSmoothSeek, setPlayhead],
  )
  const smoothSeekPlayhead = useCallback(
    (target: number) => {
      cancelSmoothSeek()
      const from = useUI.getState().playhead
      const to = clamp(target, 0, api.getMeta().duration)
      if (Math.abs(to - from) < 0.001) {
        setPlayhead(to)
        return
      }
      const startedAt = performance.now()
      const durationMs = Math.min(260, Math.max(120, Math.abs(to - from) * 90))
      const step = (now: number) => {
        const t = clamp((now - startedAt) / durationMs, 0, 1)
        const eased = 1 - Math.pow(1 - t, 3)
        setPlayhead(from + (to - from) * eased)
        if (t < 1) {
          smoothSeekAnimationId = window.requestAnimationFrame(step)
        } else {
          smoothSeekAnimationId = null
          setPlayhead(to)
        }
      }
      smoothSeekAnimationId = window.requestAnimationFrame(step)
    },
    [api, cancelSmoothSeek, setPlayhead],
  )

  useEffect(() => cancelSmoothSeek, [cancelSmoothSeek])
  useEffect(() => {
    if (playing) cancelSmoothSeek()
  }, [cancelSmoothSeek, playing])

  // Pinch-zoom + Cmd/Ctrl-scroll over the timeline scales horizontally
  // (time-axis zoom). Browser pinch on macOS fires `wheel` with
  // ctrlKey synthesized to true; trackpad Cmd+scroll fires it directly.
  // Either way we preventDefault to keep the page from running its
  // native zoom, then scale `timelinePxPerSecond` by an exponential
  // factor so the gesture feels smooth.
  //
  // Anchor: the time *under the cursor* stays put. Compute the cursor's
  // time at current zoom, apply the new zoom, then set scrollLeft so
  // the cursor lands on the same time after the re-render. Done in a
  // microtask so React has applied the new content width.
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      const right = rightRef.current
      if (!right) return
      const rect = right.getBoundingClientRect()
      const cursorTime = Math.max(0, (e.clientX - rect.left) / PX_PER_SECOND)
      // Negative deltaY = pinch-out / scroll-up = zoom in.
      const factor = Math.exp(-e.deltaY * 0.005)
      const next = Math.max(5, Math.min(800, PX_PER_SECOND * factor))
      if (next === PX_PER_SECOND) return
      setTimelinePxPerSecond(next)
      // After React re-renders with the new pxPerSecond, the right
      // column's content width changes. Slot a microtask so we read
      // post-update layout, then place scrollLeft so the cursor's
      // time stays under the cursor's screen position.
      queueMicrotask(() => {
        const scroller = scrollerRef.current
        if (!scroller) return
        const scrollerRect = scroller.getBoundingClientRect()
        const cursorXInScroller = e.clientX - scrollerRect.left
        // Cursor should be at (cursorTime * next) inside right-column
        // content. That corresponds to scroller.scrollLeft + cursorX
        // − TRACK_HEADER_WIDTH (left column eats the first chunk).
        const target =
          cursorTime * next - (cursorXInScroller - TRACK_HEADER_WIDTH)
        scroller.scrollLeft = Math.max(0, target)
      })
    }
    // passive: false so preventDefault sticks. Without it, Chrome
    // ignores preventDefault for wheel events on scroll containers.
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [setTimelinePxPerSecond])
  const scrollerRef = useRef<HTMLDivElement>(null)
  const audioInputRef = useRef<HTMLInputElement>(null)
  // The right column wrapper — the element whose `getBoundingClientRect`
  // is the shared coordinate space for the ruler, the segment rows, and
  // the marquee rectangle. Using this instead of computing offsets off
  // the outer scroller keeps the math simple regardless of horizontal
  // or vertical scroll position.
  const rightRef = useRef<HTMLDivElement>(null)

  // Timeline-local keyframe multi-selection. Mirrored into the global
  // UI store via the effect below so the right-side Animate panel can
  // react when the selection narrows to a single track (it surfaces
  // the graph editor in that case). Set is kept here for fast hit
  // tests; the store sees a serializable array.
  const [selectedKfs, setSelectedKfs] = useState<Set<string>>(() => new Set())
  const [timelineMode, setTimelineMode] = useState<TimelineMode>('animated')
  const [beatSyncMessage, setBeatSyncMessage] = useState('')
  const [activeBeatAudioId, setActiveBeatAudioId] = useState<string | null>(null)
  const [selectedBarRange, setSelectedBarRange] = useState<{
    audioNodeId: string
    startBar: number
    endBar: number
  } | null>(null)
  const [staggerSettingsSetId, setStaggerSettingsSetId] = useState<
    string | null
  >(null)
  const [expandedStaggerSetIds, setExpandedStaggerSetIds] = useState<
    Set<string>
  >(() => new Set())
  const setSelectedKeyframes = useUI((s) => s.setSelectedKeyframes)
  useEffect(() => {
    setSelectedKeyframes(Array.from(selectedKfs))
  }, [selectedKfs, setSelectedKeyframes])

  // Marquee-select overlay. When present, `marquee` is the current
  // rectangle in scroller-local coordinates (scrollLeft-relative for x,
  // so the rect doesn't visually slip if the user scrolls during drag).
  // Drawn by a thin accent-tinted box that only appears while a drag
  // past the 3px threshold is in progress.
  const [marquee, setMarquee] = useState<
    { x0: number; y0: number; x1: number; y1: number } | null
  >(null)

  const toggleKf = useCallback((trackId: string, kfId: string) => {
    setSelectedKfs((prev) => {
      const next = new Set(prev)
      const k = kfKey(trackId, kfId)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }, [])
  const replaceKfs = useCallback((keys: string[]) => {
    setSelectedKfs(new Set(keys))
  }, [])
  const clearKfs = useCallback(() => {
    setSelectedKfs((prev) => (prev.size === 0 ? prev : new Set()))
  }, [])
  const toggleStaggerSetExpanded = useCallback((setId: string) => {
    setExpandedStaggerSetIds((previous) => {
      const next = new Set(previous)
      if (next.has(setId)) next.delete(setId)
      else next.add(setId)
      return next
    })
  }, [])
  const selectTrackGroup = useCallback(
    (trackIds: string[]) => {
      clearKfs()
      const ui = useUI.getState()
      ui.setSelectedTrackIds(trackIds)
      ui.setSelectedTrackId(null)
      ui.setSelectedStaggerSetId(null)
    },
    [clearKfs],
  )
  const deleteTrackGroup = useCallback(
    (trackIds: string[]) => {
      deleteAnimationTracksHelper(api, trackIds)
      const ui = useUI.getState()
      ui.setSelectedTrackIds([])
      ui.setSelectedTrackId(null)
      clearKfs()
    },
    [api, clearKfs],
  )

  const getTrackIdsForNodes = useCallback(
    (nodeIds: string[]) => {
      const out: string[] = []
      for (const nodeId of nodeIds) {
        for (const track of api.getTracksForNode(nodeId)) {
          out.push(track.id)
        }
      }
      return out
    },
    [api],
  )

  const selectedAnimatedLayerTrackIds = useCallback(
    () => getTrackIdsForNodes(useUI.getState().selection),
    [getTrackIdsForNodes],
  )

  const tracksInsideAnyGroup = useCallback(
    (trackIds: string[]) => {
      const ids = new Set(trackIds)
      for (const group of Object.values(trackGroupsDict)) {
        if (group.trackIds.some((trackId) => ids.has(trackId))) return true
      }
      return false
    },
    [trackGroupsDict],
  )
  const addDroppedTracksToGroup = useCallback(
    (groupId: string, trackIds: string[], index?: number) => {
      const group = api.getUiState().trackGroups[groupId]
      if (!group) return
      const memberSet = new Set(group.trackIds)
      const toAdd = [...new Set(trackIds)].filter(
        (trackId) =>
          (typeof index === 'number' || !memberSet.has(trackId)) &&
          api.getTrack(trackId),
      )
      if (toAdd.length === 0) return
      insertTracksIntoGroupHelper(api, groupId, toAdd, index)
      const next = api.getUiState().trackGroups[groupId]?.trackIds ?? [
        ...group.trackIds,
        ...toAdd,
      ]
      setSelectedTrackIds(next)
      clearKfs()
    },
    [api, clearKfs, setSelectedTrackIds],
  )

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      if (target.closest('[data-timeline-selection-surface]')) return
      clearKfs()
      useUI.getState().setSelectedTrackIds([])
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [clearKfs])

  // Delete handler for the keyframe-set selection. Lives here (not in
  // the global keyboard hook) because the selection itself is local
  // Timeline state. Takes priority over the global Delete-deletes-the-
  // selected-layer behavior whenever `selectedKfs` is non-empty.
  // Wraps every removal in one Yjs transaction so it's a single undo
  // step and the engine only re-snapshots once.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (selectedKfs.size === 0) return
      // Skip when focus is in a text input — typing Backspace shouldn't
      // wipe the timeline selection.
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return
      }
      e.preventDefault()
      e.stopPropagation()
      // If the selection is exactly one or more persisted keyframe groups,
      // remove their records in the same transaction as their keyframes.
      // Otherwise the rows disappear visually but leave orphaned group data
      // behind in the scene.
      const selectedGroupIds = Object.entries(api.getUiState().kfGroups)
        .filter(([, members]) => {
          if (members.length !== selectedKfs.size) return false
          return members.every((member) => selectedKfs.has(member))
        })
        .map(([groupId]) => groupId)
      // Translate `${trackId}:${kfId}` keys into per-track removals.
      const byTrack = new Map<string, string[]>()
      for (const key of selectedKfs) {
        const sep = key.indexOf(':')
        if (sep < 0) continue
        const trackId = key.slice(0, sep)
        const kfId = key.slice(sep + 1)
        const list = byTrack.get(trackId) ?? []
        list.push(kfId)
        byTrack.set(trackId, list)
      }
      api.doc.transact(() => {
        for (const [trackId, kfIds] of byTrack) {
          for (const kfId of kfIds) removeKeyframe(api, trackId, kfId)
        }
        if (selectedGroupIds.length > 0) {
          ungroupKeyframeGroupsHelper(api, selectedGroupIds)
        }
      })
      clearKfs()
    }
    // Capture phase so we beat the global Delete handler in
    // useKeyboardShortcuts (which would otherwise delete the whole
    // selected layer).
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [api, selectedKfs, clearKfs])

  // Cmd+G / Ctrl+G groups the live keyframe selection; Cmd+Shift+G
  // breaks any group that touches the selection. Browsers reserve
  // Cmd+G for "find next" inside text fields, so we only fire when
  // the user has at least 2 timeline keyframes picked AND they're
  // not currently editing an input. Once grouped, clicking any
  // member selects the whole group, so a complex animation can be
  // dragged or retimed as a unit without re-marqueeing.
  // Esc exits section isolation. Capture phase so it beats any
  // global Esc handler (the global one clears the canvas selection,
  // which the user may also want — but exiting isolation is the
  // clearer "back to overview" instinct).
  useEffect(() => {
    if (!isolatedRange) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Don't intercept while typing.
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return
      }
      e.preventDefault()
      e.stopPropagation()
      setIsolatedRange(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [isolatedRange, setIsolatedRange])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'g' || e.key === 'G')) {
        // Don't intercept while typing in a form field — leave Cmd+G
        // alone so the browser's native "find next" still works.
        const target = e.target as HTMLElement | null
        if (
          target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.isContentEditable)
        ) {
          return
        }
        // ALWAYS claim Cmd+G in the timeline — even when nothing is
        // selected. Otherwise the event bubbles to the global handler
        // and wraps the layer in a frame.
        e.preventDefault()
        e.stopPropagation()
        // Resolution order — three escalating tiers:
        //
        //   1. Explicit track selection (`selectedTrackIds`) wins.
        //      Jitter's primary gesture: marquee tracks, Cmd+G to
        //      compose. Treated literally.
        //   2. Implicit track selection inferred from the keyframe
        //      selection. If the user has picked even one keyframe
        //      from 2+ tracks, they CLEARLY mean "group these tracks"
        //      — partial selection per track is a tedious accident
        //      to require the user to fix. We expand to a track
        //      group covering every track that has any selected
        //      keyframe, so the entire track joins the group, not
        //      just the highlighted diamonds. (User explicitly
        //      requested this expansion.)
        //   3. Keyframe-only grouping. Only fires when every
        //      selected keyframe lives on the SAME track — a
        //      legitimate "bundle these specific kfs as a beat"
        //      use case that doesn't fit the track-group model.
        //
        // Both Y.Doc helpers are inside the UndoManager's transact
        // window, so each tier produces one undo step.
        const tids = useUI.getState().selectedTrackIds
        // Helper: when the user's track selection partially overlaps
        // an existing group, fold the rest of the selection INTO
        // that group instead of creating a brand-new sibling group.
        // That's the "push these tracks into the group" gesture —
        // it lets the user keep growing a group without having to
        // ungroup-and-regroup. If multiple existing groups are
        // touched, fall through to the regular create-new path
        // (groupTracks already moves tracks out of prior groups).
        const tryMergeIntoExisting = (ids: string[]): boolean => {
          const ui = api.getUiState()
          const idSet = new Set(ids)
          const touched = new Set<string>()
          for (const [gid, g] of Object.entries(ui.trackGroups)) {
            if (g.trackIds.some((t) => idSet.has(t))) touched.add(gid)
          }
          // Only one group touched? Add the new ones to it.
          if (touched.size === 1) {
            const gid = touched.values().next().value as string
            addTracksToGroupHelper(api, gid, ids)
            return true
          }
          return false
        }
        if (tids.length >= 2) {
          if (e.shiftKey) {
            ungroupTracksHelper(api, tids)
          } else if (!tryMergeIntoExisting(tids)) {
            groupTracksHelper(api, tids)
          }
          return
        }
        const selectedLayerTracks = selectedAnimatedLayerTrackIds()
        if (selectedLayerTracks.length > 0 && e.shiftKey) {
          removeTracksFromGroupsHelper(api, selectedLayerTracks)
          return
        }
        if (selectedLayerTracks.length >= 2) {
          if (!tryMergeIntoExisting(selectedLayerTracks)) {
            groupTracksHelper(api, selectedLayerTracks)
          }
          return
        }
        if (selectedKfs.size === 0) return
        const keys = Array.from(selectedKfs)
        // Ungroup should dissolve the actual selected keyframe groups,
        // even when that group spans multiple tracks. The grouping path
        // can still infer track intent from multi-track keyframe picks.
        if (e.shiftKey) {
          ungroupKeyframesHelper(api, keys)
          return
        }

        // Pull unique track ids from the selected kf keys
        // (`trackId:kfId` shape). One track → keyframe grouping.
        // Multiple tracks → infer the track-group intent and route
        // to the track helpers, picking up every keyframe on those
        // tracks for free since track groups bind the whole track.
        const tracksFromKfs = new Set<string>()
        for (const k of keys) {
          const colon = k.indexOf(':')
          if (colon > 0) tracksFromKfs.add(k.slice(0, colon))
        }
        if (tracksFromKfs.size >= 2) {
          const ids = Array.from(tracksFromKfs)
          if (!tryMergeIntoExisting(ids)) {
            groupTracksHelper(api, ids)
          }
          return
        }
        if (selectedKfs.size >= 2) {
          groupKeyframesHelper(api, keys)
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [api, selectedAnimatedLayerTrackIds, selectedKfs])

  // Group lookup map: keyframe key → group id. Rebuilt when the
  // groups dict changes. Used by KeyframeDiamond to (a) decide
  // whether a click should expand the selection to the whole group,
  // and (b) draw a small accent dot under grouped diamonds so users
  // can see which keyframes share a group at a glance.
  // (kfGroupsDict / kfGroupCollapsedDict / toggleGroupCollapsed are
  // declared above the Yjs-backed slab — they're sourced from
  // `api.getUiState()` rather than Zustand so undo covers them.)
  const kfGroupOf = useMemo(() => {
    const m = new Map<string, string>()
    for (const [gid, members] of Object.entries(kfGroupsDict)) {
      for (const k of members) m.set(k, gid)
    }
    return m
  }, [kfGroupsDict])
  const kfGroupKeys = useMemo(() => {
    // groupId → its members, materialized as a Set for fast lookup.
    const m = new Map<string, Set<string>>()
    for (const [gid, members] of Object.entries(kfGroupsDict)) {
      m.set(gid, new Set(members))
    }
    return m
  }, [kfGroupsDict])
  // Set of keyframe keys that should be hidden on the timeline because
  // they belong to a collapsed group. Looked up per diamond so each
  // diamond can decide whether to render. Built once per state change
  // so the per-diamond check is O(1).
  const hiddenByGroupCollapse = useMemo(() => {
    const hidden = new Set<string>()
    for (const [gid, isCollapsed] of Object.entries(kfGroupCollapsedDict)) {
      if (!isCollapsed) continue
      const members = kfGroupsDict[gid]
      if (!members) continue
      for (const k of members) hidden.add(k)
    }
    return hidden
  }, [kfGroupsDict, kfGroupCollapsedDict])

  // Clicking a keyframe / segment bar / track label should: (1) select
  // the owning node so the Animate tab targets it, (2) flip the
  // Inspector to Animate so the easing picker and preset tiles are
  // one click away. Extracted because all three surfaces need it.
  const focusTrackForEditing = (nodeId: string) => {
    setSelection([nodeId])
    setInspectorMode('animate')
  }
  // Multi-aware variant of focusTrackForEditing — used by the node
  // header row (which looks like a Layers row) so Shift/Cmd-click
  // behaves the way it does in Layers: Cmd toggles, Shift extends.
  // Falls back to `focusTrackForEditing` for plain clicks so the
  // Inspector still flips to Animate.
  const toggleInSelection = useUI.getState().toggleInSelection
  const extendSelectionTo = useUI.getState().extendSelectionTo
  const selectNodeFromTimeline = (
    nodeId: string,
    e: React.MouseEvent,
    orderedIds: string[],
  ) => {
    if (e.shiftKey) {
      // Range select across the visible track-node list. No filter
      // function — timeline rows are flat (no parent/child nesting),
      // so every id in the slice should stay in the selection.
      extendSelectionTo(nodeId, orderedIds)
      return
    }
    if (e.metaKey || e.ctrlKey) {
      toggleInSelection(nodeId, true)
      return
    }
    focusTrackForEditing(nodeId)
  }

  // Right-click menu builder. One function handles all four timeline
  // surfaces (node row, track label, segment bar, keyframe diamond)
  // because they share most items — the differing ones just toggle on
  // / off based on the target kind. Keeping this inline (rather than
  // pushing it into contextMenuActions.ts) because timeline deletions
  // all flow through the anim helpers, which that file doesn't import.
  type TimelineMenuTarget =
    | { kind: 'node'; nodeId: string; nodeName: string }
    | { kind: 'track'; track: Track }
    | { kind: 'keyframe'; track: Track; keyframeId: string; time: number }
  const openTimelineMenu = (
    e: React.MouseEvent,
    target: TimelineMenuTarget,
  ) => {
    e.preventDefault()
    e.stopPropagation()
    const nodeTrackIds =
      target.kind === 'node' ? getTrackIdsForNodes([target.nodeId]) : []
    const trackIsGrouped =
      target.kind === 'track' || target.kind === 'keyframe'
        ? tracksInsideAnyGroup([target.track.id])
        : false
    const nodeHasGroupedTracks =
      target.kind === 'node' ? tracksInsideAnyGroup(nodeTrackIds) : false
    const targetTrack = target.kind === 'node' ? null : target.track
    const activeStaggerTrack =
      targetTrack &&
      activeResolvedStaggerSet &&
      targetTrack.nodeId === activeResolvedStaggerSet.sourceNodeId &&
      activeStaggerMemberIdsByTrack.has(targetTrack.id)
        ? activeResolvedStaggerSet
        : null
    const activePropertyMembers = activeStaggerTrack
      ? activeStaggerTrack.members.filter(
          (member) => member.propertyId === targetTrack!.propertyId,
        )
      : []
    const activeKeyBundle =
      target.kind === 'keyframe' && activeStaggerTrack
        ? activeStaggerLinksBySourceKey.get(
            kfKey(target.track.id, target.keyframeId),
          ) ?? []
        : []
    const activeKeyBundleKeys = new Set(
      activeKeyBundle.map((linked) => kfKey(linked.trackId, linked.kfId)),
    )
    const items =
      target.kind === 'keyframe'
        ? [
            ...(activeKeyBundle.length > 0
              ? [
                  {
                    label: 'Detach keyframe from stagger (keep animation)',
                    onClick: () =>
                      detachStaggerSetKeyframes(
                        api,
                        activeStaggerTrack!.id,
                        staggerMemberInputs(
                          activeStaggerTrack!.members.filter((member) =>
                            activeKeyBundleKeys.has(
                              kfKey(member.trackId, member.kfId),
                            ),
                          ),
                        ),
                      ),
                  },
                  {
                    label: 'Delete keyframe from stagger',
                    danger: true,
                    onClick: () =>
                      deleteActiveStaggerMembers(activeKeyBundle),
                  },
                  { kind: 'separator' as const },
                ]
              : []),
            ...(trackIsGrouped
              ? [
                  {
                    label: 'Remove track from group',
                    onClick: () =>
                      removeTracksFromGroupsHelper(api, [target.track.id]),
                  },
                  { kind: 'separator' as const },
                ]
              : []),
            ...(!activeStaggerTrack
              ? [
                  {
                    label: `Delete keyframe @ ${target.time.toFixed(2)}s`,
                    danger: true,
                    onClick: () =>
                      removeKeyframe(api, target.track.id, target.keyframeId),
                  },
                ]
              : []),
            { kind: 'separator' as const },
            {
              label: `Delete track (${humanProperty(target.track.propertyId)})`,
              danger: true,
              onClick: () => removeTrack(api, target.track.id),
            },
          ]
        : target.kind === 'track'
          ? [
              ...(activeStaggerTrack
                ? [
                    {
                      label: `Detach ${humanProperty(target.track.propertyId)} from stagger (keep animation)`,
                      onClick: () =>
                        detachStaggerSetKeyframes(
                          api,
                          activeStaggerTrack.id,
                          staggerMemberInputs(activePropertyMembers),
                        ),
                    },
                    {
                      label: `Remove ${humanProperty(target.track.propertyId)} from stagger`,
                      danger: true,
                      onClick: () =>
                        deleteActiveStaggerMembers(
                          activePropertyMembers.map((member) => ({
                            trackId: member.trackId,
                            kfId: member.kfId,
                            startTime: member.time,
                          })),
                        ),
                    },
                    { kind: 'separator' as const },
                  ]
                : []),
              ...(trackIsGrouped
                ? [
                    {
                      label: 'Remove track from group',
                      onClick: () =>
                        removeTracksFromGroupsHelper(api, [target.track.id]),
                    },
                    { kind: 'separator' as const },
                  ]
                : []),
              ...(!activeStaggerTrack
                ? [
                    {
                      label: `Delete track (${humanProperty(target.track.propertyId)})`,
                      danger: true,
                      onClick: () => removeTrack(api, target.track.id),
                    },
                  ]
                : []),
            ]
          : [
              ...(nodeHasGroupedTracks
                ? [
                    {
                      label: `Remove "${target.nodeName}" from group`,
                      onClick: () =>
                        removeTracksFromGroupsHelper(api, nodeTrackIds),
                    },
                    { kind: 'separator' as const },
                  ]
                : []),
              {
                label: `Delete all animation on "${target.nodeName}"`,
                danger: true,
                onClick: () => {
                  const tracks = api.getTracksForNode(target.nodeId)
                  for (const t of tracks) removeTrack(api, t.id)
                },
              },
            ]
    openContextMenu({ x: e.clientX, y: e.clientY, items })
  }

  // Collect tracks to show. ONLY layers with at least one animated
  // track appear here — the timeline is a "where the animation lives"
  // view, not a layer index. Empty layers belong in the Layers panel
  // (and stay selectable from there). Showing every scene layer in
  // the timeline cluttered the panel with rows that had nothing to
  // animate and threw off the scroll relationship between track names
  // and keyframe rows.
  //
  // Ordering: depth-first walk from root, matches the layer-panel
  // mental model.
  const tracksByNode = useMemo(() => {
    const rootId = api.getRoot()
    const order: string[] = []
    // Camera lives outside the root tree (parent: null) but IS
    // animatable — we include it explicitly at the top of the order
    // so its tracks show up. Without this, animators set keyframes
    // on the camera (often unintentionally with record mode on) and
    // can't see them — the camera's playback overrides static values
    // invisibly.
    const cameraId = api.getActiveCameraId()
    if (cameraId) order.push(cameraId)
    const walk = (id: string) => {
      if (id !== rootId) order.push(id) // skip the artboard itself
      for (const child of api.getChildren(id)) walk(child.id)
    }
    walk(rootId)

    const out: Array<{
      nodeId: string
      nodeName: string
      nodeKind: string
      tracks: Track[]
    }> = []
    for (const id of order) {
      const node = api.getNode(id)
      if (!node) continue
      let tracks = api.getTracksForNode(id)
      // Cameras are uniform-scale only. Hide any `transform.scaleY`
      // track that may exist (legacy data, or a one-off from before
      // we collapsed the field) — the renderer ignores it. Keeping
      // it visible would suggest the user can keyframe Y separately,
      // which is the exact confusion the unified scale model fixed.
      if (node.kind === 'camera') {
        tracks = tracks.filter((t) => t.propertyId !== 'transform.scaleY')
      }
      if (tracks.length === 0) continue
      out.push({
        nodeId: id,
        nodeName: node.name,
        nodeKind: node.kind,
        tracks,
      })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, version])

  const mediaClips = useMemo(() => {
    const out: MediaTimelineNode[] = []
    for (const id of api.getAllNodeIds()) {
      const node = api.getNode(id)
      if (node && (node.kind === 'audio' || node.kind === 'video')) {
        out.push(node)
      }
    }
    return out.sort((a, b) => a.startTime - b.startTime)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, version])

  const selectedAudio = useMemo(
    () =>
      mediaClips.find(
        (clip): clip is Extract<SceneNode, { kind: 'audio' }> =>
          clip.kind === 'audio' && selection.includes(clip.id),
      ) ?? null,
    [mediaClips, selection],
  )
  useEffect(() => {
    if (!selectedAudio?.beatGrid) return
    const timeout = window.setTimeout(
      () => setActiveBeatAudioId(selectedAudio.id),
      0,
    )
    return () => window.clearTimeout(timeout)
  }, [selectedAudio])
  const beatAudio =
    mediaClips.find(
      (clip): clip is Extract<SceneNode, { kind: 'audio' }> =>
        clip.kind === 'audio' &&
        clip.id === activeBeatAudioId &&
        !!clip.beatGrid,
    ) ??
    selectedAudio ??
    mediaClips.find(
      (clip): clip is Extract<SceneNode, { kind: 'audio' }> =>
        clip.kind === 'audio' && !!clip.beatGrid,
    ) ??
    null
  const beatMarkers = useMemo(
    () => beatAudio ? sceneBeatMarkers(beatAudio, duration) : [],
    [beatAudio, duration],
  )
  const beatSyncTracks = useMemo(
    () => tracksByNode.flatMap((group) => group.tracks),
    [tracksByNode],
  )
  const beatSyncPlan = useMemo(() => {
    if (!beatAudio?.beatGrid) return null
    return planKeyframeBeatSync({
      grid: beatAudio.beatGrid,
      audio: beatAudio,
      tracks: beatSyncTracks,
      selectedKeyframeKeys: selectedKfs,
      selectedBars:
        selectedBarRange?.audioNodeId === beatAudio.id
          ? {
              startBar: selectedBarRange.startBar,
              endBar: selectedBarRange.endBar,
            }
          : null,
      isolatedRange,
      workAreaRange: normalizedWorkArea,
      coincidentTolerance: frameStep / 2,
    })
  }, [
    beatAudio,
    beatSyncTracks,
    frameStep,
    isolatedRange,
    normalizedWorkArea,
    selectedBarRange,
    selectedKfs,
  ])
  const beatSyncRange = useMemo(() => {
    if (!beatAudio?.beatGrid) return null
    if (selectedBarRange?.audioNodeId === beatAudio.id) {
      return {
        audioNodeId: beatAudio.id,
        startBar: selectedBarRange.startBar,
        endBar: selectedBarRange.endBar,
      }
    }
    return beatSyncPlan?.preview.barRange
      ? { audioNodeId: beatAudio.id, ...beatSyncPlan.preview.barRange }
      : null
  }, [beatAudio, beatSyncPlan, selectedBarRange])
  useEffect(() => {
    setBeatSnapTimes(beatMarkers.map((marker) => marker.time))
    return () => setBeatSnapTimes([])
  }, [beatMarkers])

  const updateBeatGrid = useCallback(
    (
      node: Extract<SceneNode, { kind: 'audio' }>,
      patch: Partial<AudioBeatGrid>,
    ) => {
      const current = node.beatGrid
      if (!current) return
      api.setNodeProperty(node.id, 'beatGrid', { ...current, ...patch })
    },
    [api],
  )

  const setBarDivision = useCallback(
    (
      node: Extract<SceneNode, { kind: 'audio' }>,
      division: NoteDivision,
    ) => {
      if (!node.beatGrid) return
      const range =
        beatSyncRange?.audioNodeId === node.id ? beatSyncRange : null
      if (!range) {
        setBeatSyncMessage('Select a bar range or keyframes first.')
        return
      }
      const nextRegion = {
        id: `bars_${Math.random().toString(36).slice(2, 9)}`,
        startBar: range.startBar,
        endBar: range.endBar,
        division,
      }
      updateBeatGrid(node, {
        subdivisions: [...node.beatGrid.subdivisions, nextRegion],
      })
      setBeatSyncMessage(
        `Bars ${range.startBar}–${range.endBar} set to 1/${division} notes`,
      )
    },
    [beatSyncRange, updateBeatGrid],
  )

  const syncSelectedKeyframes = useCallback(
    (node: Extract<SceneNode, { kind: 'audio' }>) => {
      if (!node.beatGrid || !beatSyncPlan?.ok) {
        const reason = beatSyncPlan?.reason
        setBeatSyncMessage(
          reason === 'insufficient-grid-slots'
            ? `${beatSyncPlan?.preview.eventCount ?? 0} keyframe events need more than ${beatSyncPlan?.preview.availableSlots ?? 0} beat slots. Choose 1/16 or a longer range.`
            : reason === 'range-outside-clip'
              ? 'That musical range is outside the trimmed audio clip.'
              : reason === 'no-valid-keyframes'
                ? 'The keyframe selection is stale. Select the keyframes again.'
                : 'Select keyframes, then choose a musical range.',
        )
        return
      }
      const nextTimes = new Map(
        beatSyncPlan.targets.map((target) => [
          beatSyncSelectionKey(target.trackId, target.keyframeId),
          target.targetTime,
        ]),
      )
      api.doc.transact(() => {
        for (const track of beatSyncTracks) {
          if (!track.keyframes.some((keyframe) => nextTimes.has(kfKey(track.id, keyframe.id)))) {
            continue
          }
          api.setTrack({
            ...track,
            keyframes: track.keyframes
              .map((keyframe) => ({
                ...keyframe,
                time: nextTimes.get(kfKey(track.id, keyframe.id)) ?? keyframe.time,
              }))
              .sort((a, b) => a.time - b.time),
          })
        }
      }, 'sync-keyframes-to-beat')
      const range = beatSyncPlan.preview.barRange
      setBeatSyncMessage(
        range
          ? `${beatSyncPlan.preview.validKeyframeCount} keyframes distributed across ${range.startBar === range.endBar ? `bar ${range.startBar}` : `bars ${range.startBar}–${range.endBar}`}`
          : `${beatSyncPlan.preview.validKeyframeCount} keyframes distributed to the beat grid`,
      )
    },
    [api, beatSyncPlan, beatSyncTracks],
  )

  const duplicateMediaClip = useCallback(
    (node: MediaTimelineNode) => {
      const parent = node.parent ?? api.getRoot()
      const id = api.createNode(node.kind, parent, {
        name: `${node.name} copy`,
        size: node.size,
        src: node.src,
        duration: node.duration,
        volume: node.volume,
        muted: node.muted,
        startTime: node.startTime + 0.25,
        trimStart: node.trimStart,
        trimEnd: node.trimEnd,
        loop: node.loop,
        ...(node.kind === 'video'
          ? { fit: node.fit }
          : {
              beatAnalysis: node.beatAnalysis,
              beatGrid: node.beatGrid,
            }),
      } as Partial<SceneNode>)
      setSelection([id])
      setInspectorMode('properties')
    },
    [api, setInspectorMode, setSelection],
  )

  const openMediaMenu = useCallback(
    (e: React.MouseEvent, node: MediaTimelineNode) => {
      e.preventDefault()
      e.stopPropagation()
      openContextMenu({
        x: e.clientX,
        y: e.clientY,
        items: [
          {
            label: node.muted ? 'Unmute clip' : 'Mute clip',
            onClick: () => api.setNodeProperty(node.id, 'muted', !node.muted),
          },
          {
            label: 'Duplicate clip',
            onClick: () => duplicateMediaClip(node),
          },
          { kind: 'separator' },
          {
            label: `Delete "${node.name}"`,
            danger: true,
            onClick: () => api.deleteNode(node.id),
          },
        ],
      })
    },
    [api, duplicateMediaClip, openContextMenu],
  )

  // Flat list of every visible track — threaded into KeyframeDiamond so a
  // batch drag can enumerate all selected keyframes without re-walking
  // the grouped structure. Rebuilds alongside tracksByNode.
  const flatTracks = useMemo(
    () => tracksByNode.flatMap((g) => g.tracks),
    [tracksByNode],
  )
  const resolvedStaggerSets = useMemo<ResolvedStaggerTimelineSet[]>(() => {
    const tracksByTarget = new Map<string, Track[]>()
    const nodeOrder = new Map<string, number>()
    tracksByNode.forEach((group, index) => nodeOrder.set(group.nodeId, index))
    for (const track of flatTracks) {
      const key = `${track.nodeId}\u0000${track.propertyId}`
      const matching = tracksByTarget.get(key) ?? []
      matching.push(track)
      tracksByTarget.set(key, matching)
    }

    const resolved: ResolvedStaggerTimelineSet[] = []
    let ordinal = 0
    for (const [setId, set] of Object.entries(uiSlab.staggerSets)) {
      ordinal++
      const members: ResolvedStaggerTimelineSet['members'] = []
      const propertyIds = new Set<string>()
      for (const nodeId of set.layerIds) {
        const properties = set.members[nodeId] ?? {}
        for (const [propertyId, keyframeIds] of Object.entries(properties)) {
          if (!keyframeIds?.length) continue
          const wanted = new Set(keyframeIds)
          const tracks =
            tracksByTarget.get(`${nodeId}\u0000${propertyId}`) ?? []
          for (const track of tracks) {
            for (const keyframe of track.keyframes) {
              if (!wanted.has(keyframe.id)) continue
              members.push({
                trackId: track.id,
                kfId: keyframe.id,
                time: keyframe.time,
                nodeId,
                propertyId: track.propertyId,
              })
              propertyIds.add(track.propertyId)
            }
          }
        }
      }
      if (members.length === 0) continue
      members.sort((a, b) => a.time - b.time)
      const liveLayerIds = set.layerIds.filter((nodeId) => !!api.getNode(nodeId))
      const fallbackHostNodeId = [...new Set(members.map((member) => member.nodeId))]
        .sort(
          (a, b) =>
            (nodeOrder.get(a) ?? Infinity) - (nodeOrder.get(b) ?? Infinity),
        )[0]
      const sourceNodeId =
        resolveStaggerSetSourceNodeId(api, set) ?? fallbackHostNodeId
      if (!sourceNodeId) continue
      resolved.push({
        id: setId,
        label: set.name?.trim() || `Stagger ${ordinal}`,
        hostNodeId: sourceNodeId,
        sourceNodeId,
        layerIds: liveLayerIds,
        delay: set.delay,
        order: set.order,
        propertyIds: [...propertyIds],
        memberKeys: members.map((member) =>
          kfKey(member.trackId, member.kfId),
        ),
        members,
        start: members[0]!.time,
        end: members[members.length - 1]!.time,
      })
    }
    return resolved
  }, [api, flatTracks, tracksByNode, uiSlab.staggerSets])
  const staggerSetsByHost = useMemo(() => {
    const byHost = new Map<string, ResolvedStaggerTimelineSet[]>()
    for (const set of resolvedStaggerSets) {
      const hosted = byHost.get(set.hostNodeId) ?? []
      hosted.push(set)
      byHost.set(set.hostNodeId, hosted)
    }
    return byHost
  }, [resolvedStaggerSets])
  const staggerSetOfKey = useMemo(() => {
    const lookup = new Map<string, string>()
    for (const set of resolvedStaggerSets) {
      for (const memberKey of set.memberKeys) lookup.set(memberKey, set.id)
    }
    return lookup
  }, [resolvedStaggerSets])
  const staggerSettingsSet = staggerSettingsSetId
    ? resolvedStaggerSets.find((set) => set.id === staggerSettingsSetId) ?? null
    : null
  const activeResolvedStaggerSet =
    staggerOn && activeStaggerSetId
      ? resolvedStaggerSets.find((set) => set.id === activeStaggerSetId) ?? null
      : null
  const collapsedStaggerTrackIds = useMemo(() => {
    const hidden = new Set<string>()
    for (const set of resolvedStaggerSets) {
      if (set.id === activeStaggerSetId && staggerOn) continue
      if (expandedStaggerSetIds.has(set.id)) continue
      for (const member of set.members) hidden.add(member.trackId)
    }
    return hidden
  }, [activeStaggerSetId, expandedStaggerSetIds, resolvedStaggerSets, staggerOn])
  const activeStaggerMemberIdsByTrack = useMemo(() => {
    const byTrack = new Map<string, Set<string>>()
    if (!activeResolvedStaggerSet) return byTrack
    for (const member of activeResolvedStaggerSet.members) {
      const ids = byTrack.get(member.trackId) ?? new Set<string>()
      ids.add(member.kfId)
      byTrack.set(member.trackId, ids)
    }
    return byTrack
  }, [activeResolvedStaggerSet])
  const activeStaggerLinksBySourceKey = useMemo(() => {
    const links = new Map<string, KeyframeDragMember[]>()
    const set = activeResolvedStaggerSet
    if (!set) return links
    const sourceMembers = set.members.filter(
      (member) => member.nodeId === set.sourceNodeId,
    )
    for (const source of sourceMembers) {
      const bundle = resolveStaggerKeyframeBundle(
        api,
        source.trackId,
        source.kfId,
      )
      if (!bundle || bundle.setId !== set.id) continue
      const linked = bundle.members.map((member) => ({
        trackId: member.trackId,
        kfId: member.keyframeId,
        startTime: member.time,
      }))
      if (linked.length > 0) {
        links.set(kfKey(source.trackId, source.kfId), linked)
      }
    }
    return links
  }, [activeResolvedStaggerSet, api])
  const timelineTrackForStaggerEdit = useCallback(
    (track: Track): Track | null => {
      const memberIds = activeStaggerMemberIdsByTrack.get(track.id)
      if (!activeResolvedStaggerSet || !memberIds) return track
      if (expandedStaggerSetIds.has(activeResolvedStaggerSet.id)) return track
      if (track.nodeId !== activeResolvedStaggerSet.sourceNodeId) return null
      return {
        ...track,
        keyframes: track.keyframes.filter((keyframe) =>
          memberIds.has(keyframe.id),
        ),
      }
    },
    [
      activeResolvedStaggerSet,
      activeStaggerMemberIdsByTrack,
      expandedStaggerSetIds,
    ],
  )
  const deleteActiveStaggerMembers = useCallback(
    (members: readonly KeyframeDragMember[]) => {
      const set = activeResolvedStaggerSet
      if (!set || members.length === 0) return
      const deleting = new Set(
        members.map((member) => kfKey(member.trackId, member.kfId)),
      )
      deleteStaggerSetKeyframes(
        api,
        set.id,
        staggerMemberInputs(
          set.members.filter((member) =>
            deleting.has(kfKey(member.trackId, member.kfId)),
          ),
        ),
      )
      if (!api.getUiState().staggerSets[set.id]) {
        setStaggerOn(false)
        setSelectedStaggerSetId(null)
      }
    },
    [
      activeResolvedStaggerSet,
      api,
      setSelectedStaggerSetId,
      setStaggerOn,
    ],
  )
  const selectedNodeSet = useMemo(() => new Set(selection), [selection])
  const trackNodeById = useMemo(() => {
    const m = new Map<string, string>()
    for (const track of flatTracks) m.set(track.id, track.nodeId)
    return m
  }, [flatTracks])
  const activeStaggerSet = activeStaggerSetId
    ? uiSlab.staggerSets[activeStaggerSetId]
    : undefined
  // A fresh S session has an id immediately, but no persisted stagger set
  // until the first property keyframe is authored. Render it as a draft row
  // so the armed state is never invisible during that gap.
  const draftStaggerActive = Boolean(
    staggerOn && activeStaggerSetId && !activeStaggerSet,
  )
  const draftStaggerLayerCount = useMemo(
    () =>
      selection.filter((nodeId) => {
        const node = api.getNode(nodeId)
        return Boolean(node && node.kind !== 'camera')
      }).length,
    [api, selection, version],
  )
  useEffect(() => {
    if (!staggerOn || !activeStaggerSet) return
    // The authored delay lives in the undoable scene document. Mirror it back
    // into the lightweight toolbar store whenever undo/redo or a remote edit
    // changes the document, without fighting the transient scrub preview.
    setStaggerDelay(activeStaggerSet.delay)
  }, [activeStaggerSet?.delay, activeStaggerSetId, setStaggerDelay, staggerOn])
  useEffect(() => {
    if (!selectedStaggerSetId) return
    const selectedSet = uiSlab.staggerSets[selectedStaggerSetId]
    if (!selectedSet) {
      setSelectedStaggerSetId(null)
      return
    }
    if (staggerOn) return
    // The group is its own timeline selection. Selecting a real canvas layer
    // later exits that group selection, but an empty layer selection is what
    // keeps the Inspector from exposing every stagger participant on click.
    if (selection.length > 0) setSelectedStaggerSetId(null)
  }, [
    selectedStaggerSetId,
    selection,
    setSelectedStaggerSetId,
    staggerOn,
    uiSlab.staggerSets,
  ])
  const selectTimelineStagger = useCallback(
    (set: ResolvedStaggerTimelineSet) => {
      if (staggerOn && activeStaggerSetId === set.id) {
        activateStaggerSetForEditing(api, set.id)
        return
      }
      if (staggerOn && activeStaggerSetId !== set.id) setStaggerOn(false)
      setSelectedStaggerSetId(set.id)
      setSelection([])
      setSelectedTrackIds([])
      clearKfs()
      setInspectorMode('animate')
    },
    [
      activeStaggerSetId,
      api,
      clearKfs,
      setInspectorMode,
      setSelectedStaggerSetId,
      setSelectedTrackIds,
      setSelection,
      setStaggerOn,
      staggerOn,
    ],
  )
  const activateTimelineStagger = useCallback(
    (set: ResolvedStaggerTimelineSet) => {
      activateStaggerSetForEditing(api, set.id)
    },
    [api],
  )
  const deleteTimelineStagger = useCallback(
    (set: ResolvedStaggerTimelineSet) => {
      deleteStaggerSet(api, set.id)
      if (activeStaggerSetId === set.id) setStaggerOn(false)
      if (selectedStaggerSetId === set.id) setSelectedStaggerSetId(null)
      setSelectedTrackIds([])
      clearKfs()
    },
    [
      activeStaggerSetId,
      api,
      clearKfs,
      selectedStaggerSetId,
      setSelectedStaggerSetId,
      setSelectedTrackIds,
      setStaggerOn,
    ],
  )
  const detachSelectionForStagger = useCallback(
    (set: ResolvedStaggerTimelineSet): StaggerDetachAction | null => {
      const finishDetach = () => {
        if (
          activeStaggerSetId === set.id &&
          !api.getUiState().staggerSets[set.id]
        ) {
          setStaggerOn(false)
        }
        if (
          selectedStaggerSetId === set.id &&
          !api.getUiState().staggerSets[set.id]
        ) {
          setSelectedStaggerSetId(null)
        }
      }
      const selectedMembers = set.members.filter((member) =>
        selectedKfs.has(kfKey(member.trackId, member.kfId)),
      )
      if (
        selectedMembers.length > 0 &&
        selectedMembers.length < set.members.length
      ) {
        return {
          shortLabel: `Detach ${selectedMembers.length}K`,
          menuLabel: `Detach ${selectedMembers.length} selected keyframe${selectedMembers.length === 1 ? '' : 's'} (keep animation)`,
          title:
            'Remove the selected keyframes from this stagger relationship without deleting them',
          run: () => {
            detachStaggerSetKeyframes(
              api,
              set.id,
              staggerMemberInputs(selectedMembers),
            )
            finishDetach()
          },
        }
      }

      const selectedTrackSet = new Set(selectedTrackIds)
      const selectedTrackMembers = set.members.filter((member) =>
        selectedTrackSet.has(member.trackId),
      )
      const selectedMemberTrackCount = new Set(
        selectedTrackMembers.map((member) => member.trackId),
      ).size
      if (
        selectedTrackMembers.length > 0 &&
        selectedTrackMembers.length < set.members.length
      ) {
        return {
          shortLabel: `Detach ${selectedMemberTrackCount}P`,
          menuLabel: `Detach ${selectedMemberTrackCount} selected propert${selectedMemberTrackCount === 1 ? 'y' : 'ies'} (keep animation)`,
          title:
            'Remove the selected property tracks from this stagger relationship without deleting their keys',
          run: () => {
            detachStaggerSetKeyframes(
              api,
              set.id,
              staggerMemberInputs(selectedTrackMembers),
            )
            finishDetach()
          },
        }
      }

      const selectedLayers = set.layerIds.filter((nodeId) =>
        selection.includes(nodeId),
      )
      if (
        selectedLayers.length > 0 &&
        selectedLayers.length < set.layerIds.length
      ) {
        return {
          shortLabel: `Detach ${selectedLayers.length}L`,
          menuLabel: `Detach ${selectedLayers.length} selected layer${selectedLayers.length === 1 ? '' : 's'} (keep animation)`,
          title:
            'Remove the selected layers from this stagger relationship without deleting their animation',
          run: () => {
            detachStaggerSetLayers(api, set.id, selectedLayers)
            finishDetach()
          },
        }
      }
      return null
    },
    [
      activeStaggerSetId,
      api,
      selectedKfs,
      selectedStaggerSetId,
      selectedTrackIds,
      selection,
      setSelectedStaggerSetId,
      setStaggerOn,
    ],
  )
  const openStaggerTimelineMenu = useCallback(
    (event: React.MouseEvent, set: ResolvedStaggerTimelineSet) => {
      event.preventDefault()
      event.stopPropagation()
      const detachAction = detachSelectionForStagger(set)
      const selectCreatedStagger = (setId: string) => {
        if (staggerOn) setStaggerOn(false)
        setSelectedStaggerSetId(setId)
        setSelection([])
        setSelectedTrackIds([])
        clearKfs()
        setInspectorMode('animate')
      }
      openContextMenu({
        x: event.clientX,
        y: event.clientY,
        items: [
          {
            label: 'Edit Stagger',
            onClick: () => activateTimelineStagger(set),
          },
          {
            label: 'Change Stagger Settings…',
            onClick: () => setStaggerSettingsSetId(set.id),
          },
          { kind: 'separator' },
          {
            label: 'Duplicate stagger',
            onClick: () => {
              const result = duplicateStaggerSet(api, set.id)
              if (result) selectCreatedStagger(result.setId)
            },
          },
          {
            label: 'Create return',
            onClick: () => {
              const result = createStaggerSetReturn(api, set.id)
              if (result) selectCreatedStagger(result.setId)
            },
          },
          {
            label: 'Reverse motion',
            onClick: () => reverseStaggerSetInPlace(api, set.id),
          },
          { kind: 'separator' },
          {
            label: 'Select member keyframes',
            onClick: () => replaceKfs(set.memberKeys),
          },
          ...(detachAction
            ? [
                { kind: 'separator' as const },
                {
                  label: detachAction.menuLabel,
                  onClick: detachAction.run,
                },
              ]
            : []),
          { kind: 'separator' },
          {
            label: 'Dissolve stagger (keep keyframes)',
            danger: true,
            onClick: () => {
              removeStaggerSet(api, set.id)
              if (activeStaggerSetId === set.id) setStaggerOn(false)
              if (selectedStaggerSetId === set.id) {
                setSelectedStaggerSetId(null)
              }
            },
          },
          {
            label: 'Delete stagger and keyframes',
            danger: true,
            onClick: () => deleteTimelineStagger(set),
          },
        ],
      })
    },
    [
      activeStaggerSetId,
      activateTimelineStagger,
      api,
      detachSelectionForStagger,
      deleteTimelineStagger,
      clearKfs,
      setInspectorMode,
      setSelectedTrackIds,
      setSelection,
      openContextMenu,
      replaceKfs,
      selectedStaggerSetId,
      setSelectedStaggerSetId,
      setStaggerSettingsSetId,
      setStaggerOn,
      staggerOn,
    ],
  )

  /**
   * Resolve every persistent track-group into a render shape.
   * Each entry knows:
   *   - groupId
   *   - kind: 'composed' (all member tracks share one node — labelled
   *     after that node) or 'sequence' (members span multiple nodes)
   *   - hostNodeId — which node's section the group anchors under;
   *     for composed it's the only node, for sequence it's the first
   *     node in tracksByNode order that contributes a member
   *   - label — for composed: the host node's name; for sequence:
   *     "Sequence"
   *   - memberTracks — Track[] in the group's stored order
   *   - collapsed
   *
   * Only groups whose members still resolve to live tracks render —
   * if the underlying tracks were deleted, the group becomes a stub
   * and is skipped. The store keeps the bookkeeping (we don't auto-
   * delete groups on track deletion) so users don't lose their
   * structure mid-session.
   */
  const allTrackGroups = useMemo(() => {
    type Resolved = {
      groupId: string
      kind: 'composed' | 'sequence'
      hostNodeId: string
      label: string
      memberTracks: Track[]
      collapsed: boolean
    }
    const out: Resolved[] = []
    const trackById = new Map<string, Track>()
    const nodeOrder = new Map<string, number>()
    for (let i = 0; i < tracksByNode.length; i++) {
      const ng = tracksByNode[i]!
      nodeOrder.set(ng.nodeId, i)
      for (const track of ng.tracks) trackById.set(track.id, track)
    }
    for (const [groupId, g] of Object.entries(trackGroupsDict)) {
      const memberTracks: Track[] = []
      const memberNodes = new Set<string>()
      for (const trackId of g.trackIds) {
        const track = trackById.get(trackId)
        if (!track) continue
        memberTracks.push(track)
        memberNodes.add(track.nodeId)
      }
      let hostNodeId: string | null = null
      let bestOrder = Infinity
      for (const nodeId of memberNodes) {
        const order = nodeOrder.get(nodeId) ?? Infinity
        if (order < bestOrder) {
          bestOrder = order
          hostNodeId = nodeId
        }
      }
      if (memberTracks.length < 2 || !hostNodeId) continue
      const isComposed = memberNodes.size === 1
      const hostNode =
        api.getNode(hostNodeId)?.name ?? memberTracks[0]?.nodeId ?? 'Group'
      const customName = typeof g.name === 'string' ? g.name.trim() : ''
      out.push({
        groupId,
        kind: isComposed ? 'composed' : 'sequence',
        hostNodeId,
        label: customName || (isComposed ? hostNode : 'Sequence'),
        memberTracks,
        collapsed: g.collapsed,
      })
    }
    return out
  }, [trackGroupsDict, tracksByNode, api])

  /** Per-node lookup for groups that anchor here. */
  const trackGroupsByHost = useMemo(() => {
    const m = new Map<string, typeof allTrackGroups>()
    for (const g of allTrackGroups) {
      const list = m.get(g.hostNodeId) ?? []
      list.push(g)
      m.set(g.hostNodeId, list)
    }
    return m
  }, [allTrackGroups])

  /** Track id → group id (if any). Used to know whether a track
   * should render inline (under its node) or under its group's row. */
  const trackToGroupId = useMemo(() => {
    const m = new Map<string, string>()
    for (const g of allTrackGroups) {
      for (const t of g.memberTracks) m.set(t.id, g.groupId)
    }
    return m
  }, [allTrackGroups])

  /** Set of track ids that are currently hidden because their
   * track-group is collapsed AND the group anchors on the current
   * row's node OR somewhere visible. Collapsed-group members render
   * NOT inline but only via the group's parent row. */
  const trackHiddenByCollapsedGroup = useMemo(() => {
    const hidden = new Set<string>()
    for (const g of allTrackGroups) {
      if (!g.collapsed) continue
      for (const t of g.memberTracks) hidden.add(t.id)
    }
    return hidden
  }, [allTrackGroups])

  // The "active group": the group ALL currently-selected keyframes
  // belong to. Surfaces a span bar with scale handles so the user
  // can proportionally retime the group. Returns null when:
  //   - selection is empty
  //   - selection straddles multiple groups (mixed)
  //   - any selected key isn't in a group at all
  // — i.e. only when the user has a clean single-group selection,
  // matching the way Figma surfaces multi-frame controls.
  /**
   * All persisted groups, materialized once per render. This replaces
   * the old "activeGroup" concept (which was selection-derived and
   * vanished the moment the user clicked anywhere else, taking the
   * group's collapsed state with it visually). Groups now read like
   * folders: created with Cmd+G, persist until ungrouped, render in
   * their host node section regardless of selection.
   *
   * Each entry knows:
   *   - groupId, member keys
   *   - hostNodeId — the FIRST node in tracksByNode order that has
   *     at least one of the group's keyframes; this is where the
   *     synthetic Group row anchors
   *   - start / end — earliest and latest member time, in seconds,
   *     for the GroupSpanBar
   *   - members — `{trackId, kfId, time}` triples for retiming
   */
  const allGroups = useMemo(() => {
    const list: Array<{
      groupId: string
      hostNodeId: string
      start: number
      end: number
      members: Array<{ trackId: string; kfId: string; time: number }>
    }> = []
    for (const [groupId, memberKeys] of Object.entries(kfGroupsDict)) {
      if (memberKeys.length < 2) continue
      const memberSet = new Set(memberKeys)
      let hostNodeId: string | null = null
      const members: Array<{ trackId: string; kfId: string; time: number }> = []
      for (const ng of tracksByNode) {
        for (const t of ng.tracks) {
          for (const kf of t.keyframes) {
            if (memberSet.has(kfKey(t.id, kf.id))) {
              if (hostNodeId === null) hostNodeId = ng.nodeId
              members.push({ trackId: t.id, kfId: kf.id, time: kf.time })
            }
          }
        }
      }
      if (members.length < 2 || !hostNodeId) continue
      let start = Infinity
      let end = -Infinity
      for (const m of members) {
        if (m.time < start) start = m.time
        if (m.time > end) end = m.time
      }
      list.push({ groupId, hostNodeId, start, end, members })
    }
    return list
  }, [kfGroupsDict, tracksByNode])

  /** Per-host-node lookup: groupsByHost[nodeId] → Group[]. Empty for
   * nodes that aren't anchoring any group's first member. */
  const groupsByHost = useMemo(() => {
    const m = new Map<string, typeof allGroups>()
    for (const g of allGroups) {
      const list = m.get(g.hostNodeId) ?? []
      list.push(g)
      m.set(g.hostNodeId, list)
    }
    return m
  }, [allGroups])

  /**
   * The "active" group for selection-driven affordances. Still useful
   * for highlighting the row + scoping Cmd+Shift+G ungroup, but
   * NOT used to gate visibility anymore — that's `allGroups`'s job.
   */
  const activeGroupId = useMemo(() => {
    if (selectedKfs.size === 0) return null
    let groupId: string | null = null
    for (const k of selectedKfs) {
      const gid = kfGroupOf.get(k)
      if (!gid) return null
      if (groupId === null) groupId = gid
      else if (gid !== groupId) return null
    }
    return groupId
  }, [selectedKfs, kfGroupOf])

  /**
   * Tracks whose ENTIRE keyframe list belongs to a collapsed group.
   * Hidden from the rendered timeline so the group accordion is the
   * only visible representation. Tracks with mixed (some grouped,
   * some not) keyframes stay visible — we only hide the grouped
   * diamonds via `hiddenByGroupCollapse` below.
   */
  const tracksFullyInCollapsedGroup = useMemo(() => {
    const fully = new Set<string>()
    for (const g of allGroups) {
      if (!kfGroupCollapsedDict[g.groupId]) continue
      const memberSet = new Set(
        g.members.map((m) => kfKey(m.trackId, m.kfId)),
      )
      const trackIds = new Set(g.members.map((m) => m.trackId))
      for (const tid of trackIds) {
        const t = flatTracks.find((tr) => tr.id === tid)
        if (!t || t.keyframes.length === 0) continue
        let allIn = true
        for (const kf of t.keyframes) {
          if (!memberSet.has(kfKey(t.id, kf.id))) {
            allIn = false
            break
          }
        }
        if (allIn) fully.add(t.id)
      }
    }
    return fully
  }, [allGroups, kfGroupCollapsedDict, flatTracks])

  // Sections — named, length-bearing pills above the ruler. Read
  // off the version-keyed scene API so any doc mutation refreshes
  // them. Replaces the earlier "markers between two points" model.
  const sections = useMemo(
    () => {
      // Sort by start time so neighbor lookups (used for the
      // "boundaries are linked" drag behavior) can index by position.
      // The API returns sections in insertion order; ordering by time
      // here is render-only — the underlying data stays insertion-
      // ordered so reorders don't churn the doc.
      const list = api.getSections()
      return [...list].sort((a, b) => a.start - b.start)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, version],
  )

  // Effective ruler range. When an isolation is active, the visible
  // window clamps to the section. The ruler / time-axis math is
  // unchanged — every keyframe still plots at `time * PX_PER_SECOND`
  // — but kfs outside the range are hidden, the playhead clamps,
  // and the out-of-range bands are dimmed via overlays. Keeps the
  // diff small while still giving the user a focused workspace.
  const viewStart = isolatedRange?.start ?? 0
  const viewEnd = isolatedRange?.end ?? duration

  const totalWidth = Math.max(
    PX_PER_SECOND * duration + 200,
    PX_PER_SECOND * 10,
  )

  const timeFromClientX = (clientX: number): number => {
    const el = rightRef.current
    if (!el) return 0
    // `getBoundingClientRect` already accounts for current scroll
    // position — when the user scrolls right, rect.left goes negative
    // and `clientX - rect.left` still gives the correct content-local
    // X. No scrollLeft math needed.
    const rect = el.getBoundingClientRect()
    const x = clientX - rect.left
    // When isolated, clamp scrub to the section so the playhead
    // can't roam outside the focused band.
    return clamp(x / PX_PER_SECOND, viewStart, viewEnd)
  }

  const timeFromWorkAreaClientX = (clientX: number): number => {
    const el = rightRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    return clamp((clientX - rect.left) / PX_PER_SECOND, 0, duration)
  }

  const toggleWorkArea = () => {
    if (normalizedWorkArea) {
      setWorkAreaRange(null)
      return
    }
    const currentPlayhead = useUI.getState().playhead
    const start = clamp(currentPlayhead, 0, Math.max(0, duration - minWorkArea))
    const end = Math.min(duration, start + Math.min(2, duration - start))
    setWorkAreaRange({ start, end: Math.max(start + minWorkArea, end) })
  }

  const beginWorkAreaDrag = (
    e: React.PointerEvent,
    mode: 'start' | 'end' | 'move',
  ) => {
    if (!normalizedWorkArea) return
    e.preventDefault()
    e.stopPropagation()
    setPlaying(false)
    const anchor = timeFromWorkAreaClientX(e.clientX)
    const base = normalizedWorkArea
    const span = base.end - base.start
    const dragPlayhead = useUI.getState().playhead
    const onMove = (ev: PointerEvent) => {
      const t = timeFromWorkAreaClientX(ev.clientX)
      if (mode === 'start') {
        const nextStart = clamp(t, 0, base.end - minWorkArea)
        setWorkAreaRange({ start: nextStart, end: base.end })
        setPlayheadImmediate(nextStart)
        return
      }
      if (mode === 'end') {
        const nextEnd = clamp(t, base.start + minWorkArea, duration)
        setWorkAreaRange({ start: base.start, end: nextEnd })
        setPlayheadImmediate(Math.min(dragPlayhead, nextEnd))
        return
      }
      const delta = t - anchor
      const nextStart = clamp(base.start + delta, 0, duration - span)
      setWorkAreaRange({ start: nextStart, end: nextStart + span })
      setPlayheadImmediate(
        clamp(dragPlayhead + delta, nextStart, nextStart + span),
      )
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  /**
   * Snap the scrub time to the nearest existing keyframe if within an
   * 8px tolerance. Hold Alt during the drag to bypass — Figma's
   * convention for "I want to land exactly where I clicked, not on a
   * snap target." Computed fresh on each drag rather than memoized at
   * component scope: keyframes change frequently and the list is short
   * enough that walking it per pointer-move is well under a frame.
   */
  const collectSnapTimes = (): number[] => {
    const set = new Set<number>()
    for (const id of api.getAllNodeIds()) {
      for (const t of api.getTracksForNode(id)) {
        for (const k of t.keyframes) set.add(k.time)
      }
    }
    for (const time of BEAT_SNAP_TIMES) set.add(time)
    return Array.from(set).sort((a, b) => a - b)
  }
  const snapTime = (time: number, bypass: boolean, snapTimes: number[]) => {
    if (bypass) return time
    const tolSec = 8 / PX_PER_SECOND
    let nearest = time
    let nearestDist = Infinity
    for (const k of snapTimes) {
      const d = Math.abs(k - time)
      if (d < nearestDist) {
        nearestDist = d
        nearest = k
      }
      if (k > time + tolSec) break
    }
    return nearestDist <= tolSec ? nearest : time
  }

  const onRulerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    setPlaying(false)
    // Commit any focused Inspector input BEFORE the playhead moves.
    // Otherwise the blur fires AFTER `setPlayhead` and the stamp lands
    // at the new playhead — observed as "a phantom keyframe appears
    // wherever I move the playhead after editing a value."
    const focused = document.activeElement as HTMLElement | null
    if (focused && typeof focused.blur === 'function') focused.blur()
    // Capture snap targets once at drag start — keyframes don't move
    // during a scrub, so walking the scene per pointer-move is wasted.
    const snapTimes = collectSnapTimes()
    smoothSeekPlayhead(snapTime(timeFromClientX(e.clientX), e.altKey, snapTimes))
    const onMove = (ev: PointerEvent) =>
      setPlayheadImmediate(
        snapTime(timeFromClientX(ev.clientX), ev.altKey, snapTimes),
      )
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  /**
   * Start a marquee (rubber-band) selection on empty timeline space.
   * Activated by Shift+drag — unmodified drag still scrubs on row click.
   * While the marquee is live we track pointer movement in scroller-
   * local coordinates and visually draw a rect. On release we enumerate
   * every rendered keyframe diamond (via the DOM) and compare its
   * bounding box to the rect, extending or replacing the selection
   * depending on whether Shift was still held.
   *
   * The DOM walk is a pragmatic tradeoff: the "clean" solution is a
   * spatial index keyed by track row × time, but we don't have more
   * than a few hundred diamonds at any realistic scene size and
   * querySelectorAll is cheap at that scale. Re-run it on pointerup
   * only, not on every move, so the per-frame cost is zero.
   */
  const onMarqueePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Marquee on plain drag. Shift extends; plain replaces (the
    // commit handler in onUp already does the right thing depending
    // on the modifier state at release time). Earlier this required
    // Shift to start, which most users never discovered — Figma /
    // Jitter / AE all marquee on plain drag and surface it as the
    // primary multi-select gesture, so we match that.
    //
    // Bail when the click landed on a child element that has its own
    // gesture (diamonds, segment bar, edge handles, ruler). Those
    // handlers stop propagation, so we won't see it — but we still
    // double-check the data-* attributes for safety.
    const target = e.target as HTMLElement
    if (target.closest('[data-timeline-ruler]')) return
    if (
      target.dataset.kfId ||
      target.dataset.segmentBar ||
      target.dataset.segmentEdge ||
      target.dataset.stateDiamond
    ) {
      return
    }
    // Only respond to primary button. Right-click should not marquee.
    if (e.button !== 0) return
    const right = rightRef.current
    if (!right) return
    // Use the right wrapper's bounding rect as the coordinate frame.
    // It already accounts for both horizontal and vertical scroll —
    // when the user scrolls, the rect's left/top shift negative and
    // `clientX - rect.left` still gives the correct content-local X.
    // No scrollLeft/scrollTop bookkeeping needed.
    const x0 = e.clientX - right.getBoundingClientRect().left
    const y0 = e.clientY - right.getBoundingClientRect().top
    const startClientX = e.clientX
    const startClientY = e.clientY
    // Don't start the marquee state until the pointer moves past a
    // small threshold. That way a single click-on-empty-row falls
    // through to the row's own pointerdown handler (scrubs the
    // playhead) without flashing a 0×0 marquee box. Once the user
    // actually starts dragging, we take over.
    const DRAG_THRESHOLD = 3
    let started = false

    const onMove = (ev: PointerEvent) => {
      if (!started) {
        const dx = ev.clientX - startClientX
        const dy = ev.clientY - startClientY
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
        started = true
        setMarquee({ x0, y0, x1: x0, y1: y0 })
      }
      const r = right.getBoundingClientRect()
      const x1 = ev.clientX - r.left
      const y1 = ev.clientY - r.top
      setMarquee({ x0, y0, x1, y1 })
    }
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (!started) {
        // No drag — let the row handler's click-to-scrub run. Nothing
        // to commit here.
        return
      }
      const r = right.getBoundingClientRect()
      const endX = ev.clientX - r.left
      const endY = ev.clientY - r.top
      const minX = Math.min(x0, endX)
      const maxX = Math.max(x0, endX)
      const minY = Math.min(y0, endY)
      const maxY = Math.max(y0, endY)

      // Walk every diamond once and gather both the keyframe keys
      // and the implicated track ids. The modifier keys at release
      // time decide which set we commit:
      //
      //   Plain marquee   → keyframe selection (the common case —
      //                      pick a few diamonds, drag them together,
      //                      delete them, group them).
      //   Cmd / Ctrl      → track selection (the property-grouping
      //                      flow — pick whole tracks for Composed /
      //                      Sequence grouping).
      //   Shift           → additive: merge with whatever's already
      //                      selected on the same axis.
      const hitKfKeys: string[] = []
      const hitTrackIds = new Set<string>()
      const kfNodes = right.querySelectorAll<HTMLElement>(
        '[data-kf-id][data-track-id]',
      )
      for (const n of kfNodes) {
        const dr = n.getBoundingClientRect()
        const cx = dr.left + dr.width / 2 - r.left
        const cy = dr.top + dr.height / 2 - r.top
        if (cx >= minX && cx <= maxX && cy >= minY && cy <= maxY) {
          const tId = n.dataset.trackId
          const kId = n.dataset.kfId
          if (tId && kId) {
            hitKfKeys.push(kfKey(tId, kId))
            hitTrackIds.add(tId)
          }
        }
      }

      const ui = useUI.getState()
      if (ev.metaKey || ev.ctrlKey) {
        // Track-selection mode — for property grouping. Drop the
        // keyframe selection so we don't carry two competing axes.
        const ids = Array.from(hitTrackIds)
        if (ev.shiftKey) {
          const merged = new Set(ui.selectedTrackIds)
          for (const id of ids) merged.add(id)
          ui.setSelectedTrackIds(Array.from(merged))
        } else {
          ui.setSelectedTrackIds(ids)
        }
        setSelectedKfs(new Set())
      } else {
        // Default: keyframe-selection mode. Drop the track selection
        // so the next Delete / Cmd+G operates on keyframes, not
        // layers.
        if (ev.shiftKey) {
          setSelectedKfs((prev) => {
            const next = new Set(prev)
            for (const k of hitKfKeys) next.add(k)
            return next
          })
        } else {
          setSelectedKfs(new Set(hitKfKeys))
        }
        ui.setSelectedTrackIds([])
      }
      setMarquee(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Drag the 4px top edge of the timeline to resize it. The handle is
  // just a sliver of the border strip; we track clientY directly so
  // this works regardless of where the timeline is mounted. Pointer
  // capture keeps the drag alive when the pointer leaves the thin
  // handle, which otherwise would drop the event.
  const onResizePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const startY = e.clientY
    const startH = timelineHeight
    const onMove = (ev: PointerEvent) => {
      // Dragging up ⇒ clientY goes down ⇒ timeline grows.
      setTimelineHeight(startH - (ev.clientY - startY))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <section
      className="relative flex shrink-0 flex-col border-t border-border bg-panel"
      style={{ height: timelineHeight }}
      data-export-hide="1"
      data-timeline-host="1"
    >
      {/* Resize handle — a thin invisible strip hugging the top border,
          cursor ns-resize. Sits on top of the border so the user can
          grab exactly the edge they see. Non-interactive children still
          receive clicks normally because the handle is 4px tall. */}
      <div
        onPointerDown={onResizePointerDown}
        className="absolute top-0 right-0 left-0 z-20 h-1 -translate-y-1/2 cursor-ns-resize hover:bg-accent/50"
        title="Drag to resize timeline"
      />
      {/* Transport bar — moved out of TopBar so play / scrub sit next to
          the timeline they control. Mirrors After Effects, Premiere, and
          Jitter. Width-locked to the track-label column on the left so
          the time readout aligns with the ruler that starts at 0s. */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-panel-raised px-3">
        {/* Transport buttons. */}
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => {
              setPlaying(false)
              // Honor chapter isolation — "Go to start" snaps to the
              // chapter's start, not 0. Same for the end button below.
              setPlayheadImmediate(isolatedRange ? isolatedRange.start : 0)
            }}
            title="Go to start"
            className="flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-panel hover:text-text"
          >
            <TransportIcon kind="start" />
          </button>
          <button
            onClick={() => setPlaying(!playing)}
            data-transport-toggle="1"
            title={playing ? 'Pause (Space)' : 'Play (Space)'}
            className="flex h-7 w-7 items-center justify-center rounded bg-accent-soft text-accent hover:brightness-110"
          >
            <TransportIcon kind={playing ? 'pause' : 'play'} />
          </button>
          <button
            onClick={() => {
              setPlaying(false)
              setPlayheadImmediate(isolatedRange ? isolatedRange.end : duration)
            }}
            title="Go to end"
            className="flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-panel hover:text-text"
          >
            <TransportIcon kind="end" />
          </button>
        </div>

        {/* Playhead readout sits adjacent to the transport — current
            time/frame is part of "where is playback right now," not a
            comp-level property. Duration is decoupled and pushed to
            the far right (After Effects pattern). */}
        <TimelinePlayheadReadout
          rulerLabels={rulerLabels}
          duration={duration}
          frameRate={frameRate}
          onCycle={cycleRulerLabels}
        />

        {/* Spacer — pushes everything below to the right end. */}
        <div className="flex-1" />

        {/* Isolation badge — surfaces only while a chapter is solo'd.
            Sits just before the duration cluster on the right side. */}
        {isolatedRange && (
          <div className="flex h-7 items-center gap-2 rounded bg-accent-soft px-2 text-[11px] text-accent">
            <span className="font-mono uppercase tracking-wider text-[10px]">
              Isolated
            </span>
            <span className="font-medium">
              {isolatedRange.label ?? 'Chapter'}
            </span>
            <button
              type="button"
              onClick={() => setIsolatedRange(null)}
              title="Exit isolation (Esc)"
              className="rounded border border-accent/40 px-1.5 hover:bg-accent/20"
            >
              Exit
            </button>
          </div>
        )}

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={toggleWorkArea}
            title={
              normalizedWorkArea
                ? 'Clear work area'
                : 'Create work area at playhead'
            }
            className={[
              'h-7 rounded border px-2 font-mono text-[10px] tracking-wider uppercase',
              normalizedWorkArea
                ? 'border-[oklch(0.84_0.18_85)] bg-[oklch(0.84_0.18_85)]/15 text-text'
                : 'border-border bg-panel text-text-muted hover:border-border-strong hover:text-text',
            ].join(' ')}
          >
            Work area
          </button>
          {normalizedWorkArea && (
            <button
              type="button"
              onClick={() =>
                setWorkAreaPlaybackMode(
                  workAreaPlaybackMode === 'loop' ? 'stop' : 'loop',
                )
              }
              title={
                workAreaPlaybackMode === 'loop'
                  ? 'Loop work area while playing'
                  : 'Stop playback at work area end'
              }
              className="h-7 rounded border border-border bg-panel px-2 font-mono text-[10px] tracking-wider text-text-muted uppercase hover:border-border-strong hover:text-text"
            >
              {workAreaPlaybackMode}
            </button>
          )}
        </div>

        {/* Duration cluster — far-right, After Effects pattern. The
            "Duration" label is back since the field is no longer
            adjacent to the playhead time and needs its own context. */}
        <div className="flex shrink-0 items-center gap-2">
          <span className="font-mono text-[10px] tracking-wider text-text-dim uppercase">
            Duration
          </span>
          <DurationControl
            duration={duration}
            onChange={(next) => api.setMeta({ duration: Math.max(0.1, next) })}
          />
        </div>
      </div>
      {beatAudio?.beatGrid && (
        <BeatSyncActionBar
          node={beatAudio}
          selectedBarRange={beatSyncRange}
          selectedKeyframeCount={beatSyncPlan?.preview.validKeyframeCount ?? 0}
          syncReady={!!beatSyncPlan?.ok}
          syncUnavailableReason={
            beatSyncPlan?.reason === 'insufficient-grid-slots'
              ? `${beatSyncPlan.preview.eventCount} events need more than ${beatSyncPlan.preview.availableSlots} beat slots`
              : beatSyncPlan?.reason === 'range-outside-clip'
                ? 'Selected bars are outside the trimmed clip'
                : beatSyncPlan?.reason === 'no-valid-keyframes'
                  ? 'Select the keyframes again'
                  : ''
          }
          message={beatSyncMessage}
          onSetDivision={(division) =>
            setBarDivision(beatAudio, division)
          }
          onOpenSettings={() => {
            setSelection([beatAudio.id])
            setInspectorMode('properties')
          }}
          onSync={() => syncSelectedKeyframes(beatAudio)}
        />
      )}
      {/* Single scroll container handles BOTH axes for the whole
          timeline. Left column sticks to the left during horizontal
          scroll; the ruler sticks to the top during vertical scroll;
          the corner (Tracks header) sits above both with the highest
          z-index. This is the standard "spreadsheet" layout — keeps
          left labels and right segments perfectly synced because
          they're the same scroll context. The earlier two-column
          version had right-column overflow:auto which CSS promoted
          to overflow-x:auto + overflow-y:auto, producing an inner
          scrollbar mid-content. */}
      <div
        ref={scrollerRef}
        className="relative min-h-0 flex-1 overflow-auto"
      >
        <div className="flex min-w-max">
        {/* Left: track labels — sticky-left so it stays pinned during
            horizontal scroll. Rides the outer scroller for vertical
            scroll automatically (no overflow of its own). */}
        <div
          className="sticky left-0 z-20 shrink-0 border-r border-border bg-panel"
          style={{ width: TRACK_HEADER_WIDTH }}
        >
          {/* sticky-top-AND-bumped-z so this corner stays above both
              the ruler (z-10) and the left labels (z-20) at the top-
              left intersection during scrolling.

              The right side of this strip carries a persistent
              playhead readout. The TRACKS-column wrapper above is
              sticky-left-0 and this header is sticky-top-0, so the
              readout sits in the top-left corner of the visible
              timeline regardless of which axis the user has scrolled.
              Combined with the floating pill in the ruler that
              follows the playhead horizontally, the user has two
              non-overlapping ways to read the current time + frame at
              any time. */}
          {/* Tracks header height mirrors whatever the right column has
              at top-0 so the two corners line up exactly:
                - sections present  → section-pills row sits at top-0
                  (always h-7), so we match h-7. The ruler is in a
                  separate spacer row below.
                - no sections       → the ruler itself is at top-0; we
                  match its height (h-10 in stacked-labels mode, h-7
                  otherwise) and bottom-align the readout so the
                  stacked time/frame lines up with the tick labels.
              `items-end` + `pb-1` puts both labels on the same baseline
              as the ruler ticks (which use `items-end`). */}
          {/* Top corner — empty strip mirroring the right column's
              sections-pill row height. Used to hold the "Animated
              layers" label, which moved down to the ruler-aligned band
              below (sits next to the timeline scale, where there's
              actual breathing room). */}
          <div
            className="sticky top-0 z-30 h-7 border-b border-border bg-panel-raised/80 backdrop-blur-sm"
          />
          {/* Ruler-aligned band on the left.
              Mirrors the right column's ruler height so layer rows on
              the left start at the same y as keyframe rows on the
              right. This is now where the "Animated layers" label
              lives — bottom-aligned so it sits on the same baseline as
              the ruler tick labels across the divider. */}
          <div
            className={[
              'sticky top-7 z-[29] flex items-end gap-1 border-b border-border bg-panel px-2 pb-1',
              rulerLabels === 'both' ? 'h-10' : 'h-7',
            ].join(' ')}
          >
            <TimelineTabButton
              active={timelineMode === 'animated'}
              onClick={() => setTimelineMode('animated')}
            >
              Animated layers
            </TimelineTabButton>
            <TimelineTabButton
              active={timelineMode === 'sound'}
              onClick={() => setTimelineMode('sound')}
            >
              Audio
            </TimelineTabButton>
          </div>
          <input
            ref={audioInputRef}
            type="file"
            accept="audio/*"
            multiple
            hidden
            onChange={(event) => {
              const files = event.currentTarget.files
              if (!files) return
              void Promise.all(
                Array.from(files).map((file) =>
                  importAudioFile(file, api, null),
                ),
              )
              event.currentTarget.value = ''
            }}
          />
          {/* The h-3 spacer that used to live here is gone — the
              Tracks header above now expands to h-10 in both-labels +
              no-sections mode, so the left column matches the right
              column's ruler height directly. */}
          {normalizedWorkArea && (
            <div className="h-5 border-b border-border/50 bg-panel" />
          )}
          {timelineMode === 'animated' && draftStaggerActive && (
            <StaggerDraftLeftRow
              layerCount={draftStaggerLayerCount}
              delay={staggerDelay}
              onCancel={() => setStaggerOn(false)}
            />
          )}
          {beatAudio?.beatGrid && (
            <div className="flex h-7 items-center border-b border-border bg-panel-raised/55 px-3">
              <span className="whitespace-nowrap font-mono text-[9px] font-semibold tracking-[0.08em] text-text-muted uppercase">
                Musical
              </span>
              <span className="ml-2 whitespace-nowrap font-mono text-[8px] tabular-nums text-accent">
                {beatAudio.beatGrid.bpm.toFixed(1)} BPM
              </span>
              <span className="ml-auto whitespace-nowrap text-[8px] text-text-dim">
                Shift range
              </span>
            </div>
          )}
          {timelineMode === 'sound' ? (
            mediaClips.length === 0 ? (
              <div className="space-y-3 px-4 py-5 text-[11px] leading-relaxed text-text-dim">
                <AudioImportButton onClick={() => audioInputRef.current?.click()} />
                <div>
                  No audio clips yet.<br />
                  Click Import or drag an audio file onto the canvas.
                </div>
              </div>
            ) : (
              <>
                {mediaClips.map((clip) => (
                  <MediaClipLabel
                    key={clip.id}
                    node={clip}
                    selected={selection.includes(clip.id)}
                    onSelect={() => {
                      setSelection([clip.id])
                      setInspectorMode('properties')
                      if (clip.kind === 'audio') {
                        setSelectedBarRange((current) =>
                          current?.audioNodeId === clip.id ? current : null,
                        )
                        setBeatSyncMessage('')
                      }
                    }}
                    onContextMenu={(e) => openMediaMenu(e, clip)}
                  />
                ))}
                <div className="border-t border-border/50 bg-panel px-3 py-2">
                  <AudioImportButton onClick={() => audioInputRef.current?.click()} />
                </div>
              </>
            )
          ) : tracksByNode.length === 0 ? (
            <div className="px-4 py-5 text-[11px] leading-relaxed text-text-dim">
              No keyframes yet.<br />
              Pick a preset in the Animate tab to add one.
            </div>
          ) : (
            <>
            {tracksByNode.map((group) => {
              const isSelected = selection.includes(group.nodeId)
              // Ordered list of node ids across the timeline for Shift-
              // range selection. Stable within this render; building it
              // per-group is cheap and avoids a separate memo.
              const orderedTimelineNodeIds = tracksByNode.map((g) => g.nodeId)
              // Tracks visible inline under this layer header — drops
              // tracks already hidden inside a collapsed keyframe-group
              // AND tracks that have been bundled into a track-group
              // (those render under their group row instead).
              const visibleTracks = group.tracks
                .filter((track) => !tracksFullyInCollapsedGroup.has(track.id))
                .filter((track) => !collapsedStaggerTrackIds.has(track.id))
                .map(timelineTrackForStaggerEdit)
                .filter((track): track is Track => !!track)
                .filter(
                  (track) =>
                    !trackToGroupId.has(track.id) ||
                    activeStaggerMemberIdsByTrack.has(track.id),
                )
              const hostedGroups = (groupsByHost.get(group.nodeId) ?? []).filter(
                (keyframeGroup) =>
                  !activeResolvedStaggerSet ||
                  !keyframeGroup.members.some(
                    (member) =>
                      staggerSetOfKey.get(kfKey(member.trackId, member.kfId)) ===
                      activeResolvedStaggerSet.id,
                  ),
              )
              // Composed / Sequence track-groups anchored on this layer.
              const hostedTrackGroups = (
                trackGroupsByHost.get(group.nodeId) ?? []
              ).filter(
                (trackGroup) =>
                  !activeResolvedStaggerSet ||
                  !trackGroup.memberTracks.some((track) =>
                    activeStaggerMemberIdsByTrack.has(track.id),
                  ),
              )
              const hostedStaggerSets =
                staggerSetsByHost.get(group.nodeId) ?? []
              // Skip a node entirely when there's nothing to show.
              if (
                visibleTracks.length === 0 &&
                hostedGroups.length === 0 &&
                hostedTrackGroups.length === 0 &&
                hostedStaggerSets.length === 0
              ) {
                return null
              }
              // Hide the layer header strip when only group rows remain
              // (the group's row carries the layer's name in its label).
              const showNodeHeader = visibleTracks.length > 0
              return (
                <div key={group.nodeId}>
                  {hostedStaggerSets.map((set) => (
                    <StaggerSetLeftRow
                      key={set.id}
                      set={set}
                      selected={selectedStaggerSetId === set.id}
                      active={staggerOn && activeStaggerSetId === set.id}
                      expanded={expandedStaggerSetIds.has(set.id)}
                      onSelect={() => selectTimelineStagger(set)}
                      onToggleExpanded={() =>
                        toggleStaggerSetExpanded(set.id)
                      }
                      onDelete={() => deleteTimelineStagger(set)}
                      onRename={(name) =>
                        renameStaggerSet(api, set.id, name)
                      }
                      onContextMenu={(event) =>
                        openStaggerTimelineMenu(event, set)
                      }
                    />
                  ))}
                  {showNodeHeader && (
                    <div
                      onClick={(e) =>
                        selectNodeFromTimeline(
                          group.nodeId,
                          e,
                          orderedTimelineNodeIds,
                        )
                      }
                      onContextMenu={(e) =>
                        openTimelineMenu(e, {
                          kind: 'node',
                          nodeId: group.nodeId,
                          nodeName: group.nodeName,
                        })
                      }
                      aria-selected={isSelected}
                      draggable
                      onDragStart={(e) => {
                        const ids = isSelected
                          ? selectedAnimatedLayerTrackIds()
                          : group.tracks.map((track) => track.id)
                        setDraggedTrackIds(e, ids)
                      }}
                      className={
                        'flex h-6 cursor-pointer items-center border-t border-border/50 px-3 ' +
                        (isSelected
                          ? 'bg-accent-soft/40 text-accent hover:bg-accent-soft/55'
                          : 'bg-panel-raised/40 text-text hover:bg-panel-raised/70')
                      }
                    >
                      {isSelected && (
                        <span
                          aria-hidden
                          className="absolute left-0 h-6 w-[2px] bg-accent"
                          style={{ marginLeft: -12 }}
                        />
                      )}
                      <span className="truncate text-[11px] font-medium">
                        {group.nodeName}
                      </span>
                    </div>
                  )}
                  {hostedGroups.map((g) => {
                    const isActive = activeGroupId === g.groupId
                    const layerRelated = g.members.some((m) =>
                      selectedNodeSet.has(trackNodeById.get(m.trackId) ?? ''),
                    )
                    const collapsed = !!kfGroupCollapsedDict[g.groupId]
                    const memberKeys = g.members.map((m) =>
                      kfKey(m.trackId, m.kfId),
                    )
                    return (
                      <div
                        key={g.groupId}
                        tabIndex={0}
                        role="button"
                        aria-selected={isActive}
                        data-timeline-selection-surface="1"
                        onPointerDown={(event) =>
                          event.currentTarget.focus()
                        }
                        onClick={(e) => {
                          // Single-click selects every member keyframe.
                          // Without this, the user has no way to "have"
                          // the group selected for Cmd+Shift+G ungroup
                          // once the group is collapsed (the diamonds
                          // are hidden). Re-selecting on click also
                          // makes the GraphEditor / EasingPicker react
                          // to the group's keyframes if they share a
                          // single track.
                          if (e.shiftKey || e.metaKey || e.ctrlKey) {
                            const allIn = memberKeys.every((key) =>
                              selectedKfs.has(key),
                            )
                            const next = new Set(selectedKfs)
                            if (allIn) {
                              for (const key of memberKeys) next.delete(key)
                            } else {
                              for (const key of memberKeys) next.add(key)
                            }
                            replaceKfs([...next])
                          } else {
                            replaceKfs(memberKeys)
                          }
                        }}
                        onDoubleClick={() => toggleGroupCollapsed(g.groupId)}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          openContextMenu({
                            x: e.clientX,
                            y: e.clientY,
                            items: [
                              {
                                label: collapsed
                                  ? 'Expand group'
                                  : 'Collapse group',
                                onClick: () => toggleGroupCollapsed(g.groupId),
                              },
                              {
                                label: 'Select all keyframes in group',
                                onClick: () => replaceKfs(memberKeys),
                              },
                              { kind: 'separator' as const },
                              {
                                label: 'Ungroup (⌘⇧G)',
                                danger: true,
                                onClick: () =>
                                  ungroupKeyframeGroupsHelper(api, [
                                    g.groupId,
                                  ]),
                              },
                            ],
                          })
                        }}
                        className={[
                          'flex h-6 cursor-pointer items-center gap-1.5 border-t border-border/50 px-3 pl-3 text-accent',
                          isActive
                            ? 'bg-accent-soft/60 hover:bg-accent-soft/80'
                            : layerRelated
                              ? 'bg-accent-soft/45 hover:bg-accent-soft/65'
                            : 'bg-accent-soft/30 hover:bg-accent-soft/50',
                        ].join(' ')}
                        title={
                          collapsed
                            ? 'Click to select members · double-click to expand · right-click for more'
                            : 'Click to select members · double-click to collapse · right-click for more'
                        }
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            // Stop the row's click handler — toggling the
                            // chevron shouldn't also re-select the group.
                            e.stopPropagation()
                            toggleGroupCollapsed(g.groupId)
                          }}
                          className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-accent hover:bg-accent/20"
                          title={collapsed ? 'Expand group' : 'Collapse group'}
                        >
                          <Chevron collapsed={collapsed} />
                        </button>
                        <GroupGlyph />
                        <span className="truncate text-[11px] font-medium">
                          {showNodeHeader
                            ? `Group · ${g.members.length} kfs`
                            : `${group.nodeName} · Group · ${g.members.length} kfs`}
                        </span>
                      </div>
                    )
                  })}
                  {/* Track-group rows. Composed (one layer) or
                      Sequence (across layers). Click toggles collapse;
                      double-click also toggles. Right-click for
                      ungroup. When expanded, the constituent tracks
                      render indented underneath. */}
                  {hostedTrackGroups.map((tg) => (
                    (() => {
                      const memberSet = new Set(
                        tg.memberTracks.map((t) => t.id),
                      )
                      const selectedLayerTracksToAdd =
                        selectedAnimatedLayerTrackIds().filter(
                          (trackId) => !memberSet.has(trackId),
                        )
                      return (
                        <TrackGroupLeftRow
                          key={tg.groupId}
                          group={tg}
                          nodeKind={group.nodeKind}
                          layerRelated={tg.memberTracks.some((t) =>
                            selectedNodeSet.has(t.nodeId),
                          )}
                          onToggle={() =>
                            toggleTrackGroupCollapsed(tg.groupId)
                          }
                          onSelectMembers={() =>
                            selectTrackGroup(
                              tg.memberTracks.map((t) => t.id),
                            )
                          }
                          onDelete={() =>
                            deleteTrackGroup(
                              tg.memberTracks.map((t) => t.id),
                            )
                          }
                          onUngroup={() =>
                            ungroupTracksAction(
                              tg.memberTracks.map((t) => t.id),
                            )
                          }
                      onRename={(name) =>
                        renameTrackGroupHelper(api, tg.groupId, name)
                      }
                          selectedLayerTracksToAdd={
                            selectedLayerTracksToAdd.length
                          }
                          onAddSelectedLayers={() =>
                            addTracksToGroupHelper(
                              api,
                              tg.groupId,
                              selectedLayerTracksToAdd,
                            )
                          }
                      onRemoveTracksFromGroup={(trackIds) =>
                        removeTracksFromGroupsHelper(api, trackIds)
                      }
                          onDropTracks={(trackIds) =>
                            addDroppedTracksToGroup(tg.groupId, trackIds)
                          }
                          onDropTracksAtIndex={(trackIds, index) =>
                            addDroppedTracksToGroup(
                              tg.groupId,
                              trackIds,
                              index,
                            )
                          }
                          openContextMenu={openContextMenu}
                        />
                      )
                    })()
                  ))}
                  {visibleTracks.map((t) => (
                    <TrackLabel
                      key={t.id}
                      track={t}
                      nodeKind={group.nodeKind}
                      nodeSelected={isSelected}
                      onFocus={() => focusTrackForEditing(group.nodeId)}
                      onContextMenu={(e) =>
                        openTimelineMenu(e, { kind: 'track', track: t })
                      }
                    />
                  ))}
                </div>
              )
            })}
            </>
          )}
        </div>

        {/* Right: ruler + track rows. No own scroll — the outer
            scroller owns both axes.
            `flex-1` + `minWidth: totalWidth` means: as wide as the
            timeline content (so horizontal scroll engages when
            duration × PX_PER_SECOND exceeds the viewport), and
            stretches to fill any remaining space (so the ruler bar
            and row separators reach the right edge of the panel
            instead of stopping at "5s 300f"). */}
        <div
          ref={rightRef}
          className="relative flex-1"
          style={{ minWidth: totalWidth }}
          onPointerDown={onMarqueePointerDown}
        >
            {/* Section pill strip — sits ABOVE the ruler, sticky so
                it always rides the top of the viewport. Each pill is
                a colored bar spanning [section.start, section.end];
                drag the body to move, drag the edges to resize,
                right-click for rename / delete / isolate / color.
                The "+ Section" button rides at the right end of this
                row (sticky-right inside the horizontally scrolling
                container) so it's visible regardless of zoom level
                AND lives in the same lane as the things it creates. */}
            <div
              className="sticky top-0 z-20 h-7 border-b border-border bg-panel"
            >
              {sections.map((sec, i) => (
                <SectionPill
                  key={sec.id}
                  section={sec}
                  prev={sections[i - 1]}
                  next={sections[i + 1]}
                  api={api}
                  duration={duration}
                  isolated={isolatedRange?.start === sec.start && isolatedRange?.end === sec.end}
                  setIsolatedRange={setIsolatedRange}
                  openContextMenu={openContextMenu}
                />
              ))}
              {/* The "+ Chapter" button trails the last chapter pill.
                  As chapters resize / move, the button slides with the
                  rightmost edge — feels like "the next item in the
                  list" rather than a detached UI control. When there
                  are zero chapters it sits at the start of the row
                  (left: 6px). The math: take the latest `end` time
                  across all chapters and convert to pixels. */}
              <button
                type="button"
                onClick={addSectionAtPlayhead}
                title="Add chapter starting at playhead"
                className="absolute top-1/2 z-10 flex h-5 -translate-y-1/2 items-center gap-1 rounded-full border border-dashed border-border-strong bg-panel-raised/90 px-2 text-[10px] text-text-muted backdrop-blur-sm hover:border-accent hover:text-accent"
                style={{
                  left:
                    (sections.length === 0
                      ? 0
                      : Math.max(...sections.map((s) => s.end))) *
                      PX_PER_SECOND +
                    6,
                }}
              >
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                  <path d="M8 3v10M3 8h10" />
                </svg>
                Chapter
              </button>
            </div>
            {/* Ruler.
                Always sticky so the playhead pill that lives inside
                stays in view as the user scrolls through long track
                lists. Pinned at top-7 (28px) when section pills sit
                above; top-0 otherwise. The ruler's bg-panel-raised
                gives it an opaque background that hides keyframe rows
                scrolling underneath without ghosting.

                `relative` is load-bearing: RulerTicks emits children
                with `position: absolute` + `bottom: 0`, and without a
                positioned ancestor here they fall through to the next
                `relative` (the right column wrapper) — which ends up
                positioning every tick at the bottom of the entire
                timeline. */}
            <div
              data-timeline-ruler="1"
              onPointerDown={onRulerPointerDown}
              className={[
                // Height adapts to the labels mode: stacked
                // (time + frame) gets h-10 so both rows fit; single-
                // label modes stay at h-7 so the ruler doesn't waste
                // vertical space. The matching spacer in the LEFT
                // column reads the same `rulerLabels` so the two
                // sides stay aligned.
                rulerLabels === 'both' ? 'h-10' : 'h-7',
                'relative z-10 flex cursor-ew-resize select-none items-end border-b border-border bg-panel-raised',
                // Section row always sits above the ruler at top-0,
                // so the ruler is pinned at top-7.
                'sticky top-7',
              ].join(' ')}
            >
              <RulerTicks
                duration={duration}
                frameRate={frameRate}
                labelsMode={rulerLabels}
              />
              {/* The floating playhead pill that used to live here was
                  removed — the transport already shows the playhead
                  time at the top-left, and the playhead line itself is
                  the visual marker on the ruler. Two readouts of the
                  same value was noise; one is enough. */}
            </div>

            {normalizedWorkArea && (
              <>
                <div
                  className="pointer-events-none absolute z-[7] bg-panel/60"
                  style={{
                    top: 28 + (rulerLabels === 'both' ? 40 : 28) + 20,
                    bottom: 0,
                    left: 0,
                    width: normalizedWorkArea.start * PX_PER_SECOND,
                  }}
                />
                <div
                  className="pointer-events-none absolute z-[7] bg-panel/60"
                  style={{
                    top: 28 + (rulerLabels === 'both' ? 40 : 28) + 20,
                    bottom: 0,
                    left: normalizedWorkArea.end * PX_PER_SECOND,
                    right: 0,
                  }}
                />
                <div
                  className="pointer-events-none absolute z-[12] h-2 rounded-full border border-[oklch(0.84_0.18_85)] bg-[oklch(0.84_0.18_85)] shadow-sm"
                  style={{
                    top: 28 + (rulerLabels === 'both' ? 40 : 28) + 6,
                    left: normalizedWorkArea.start * PX_PER_SECOND,
                    width:
                      (normalizedWorkArea.end - normalizedWorkArea.start) *
                      PX_PER_SECOND,
                  }}
                >
                  <div
                    className="pointer-events-auto absolute top-1/2 left-0 h-5 w-2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-full border border-[oklch(0.84_0.18_85)] bg-panel shadow-sm"
                    title="Drag work area start"
                    onPointerDown={(e) => beginWorkAreaDrag(e, 'start')}
                  />
                  <div
                    className="pointer-events-auto absolute top-1/2 right-0 h-5 w-2 translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-full border border-[oklch(0.84_0.18_85)] bg-panel shadow-sm"
                    title="Drag work area end"
                    onPointerDown={(e) => beginWorkAreaDrag(e, 'end')}
                  />
                  <div
                    className="pointer-events-auto absolute inset-y-[-6px] left-2 right-2 cursor-grab active:cursor-grabbing"
                    title="Drag work area"
                    onPointerDown={(e) => beginWorkAreaDrag(e, 'move')}
                  />
                </div>
              </>
            )}

            {normalizedWorkArea && (
              <div className="h-5 border-b border-border/50 bg-panel" />
            )}

            {timelineMode === 'animated' && draftStaggerActive && (
              <StaggerDraftRightRow
                layerCount={draftStaggerLayerCount}
                totalWidth={totalWidth}
              />
            )}
            {beatAudio?.beatGrid && (
              <AudioBeatGridLane
                node={beatAudio}
                duration={duration}
                totalWidth={totalWidth}
                selectedRange={
                  selectedBarRange?.audioNodeId === beatAudio.id
                    ? selectedBarRange
                    : null
                }
                onSelectRange={(startBar, endBar) =>
                  setSelectedBarRange({
                    audioNodeId: beatAudio.id,
                    startBar,
                    endBar,
                  })
                }
              />
            )}

            {/* Track rows */}
            {timelineMode === 'sound' ? (
              mediaClips.length === 0 ? (
                <div className="h-20" />
              ) : (
                <>
                  {mediaClips.map((clip) => (
                    <MediaClipRow
                      key={clip.id}
                      node={clip}
                      api={api}
                      duration={duration}
                      totalWidth={totalWidth}
                      selected={selection.includes(clip.id)}
                      onSelect={() => {
                        setSelection([clip.id])
                        setInspectorMode('properties')
                        if (clip.kind === 'audio') {
                          setSelectedBarRange((current) =>
                            current?.audioNodeId === clip.id ? current : null,
                          )
                          setBeatSyncMessage('')
                        }
                      }}
                      onScrub={(time) => {
                        setPlaying(false)
                        smoothSeekPlayhead(time)
                      }}
                      onContextMenu={(e) => openMediaMenu(e, clip)}
                    />
                  ))}
                </>
              )
            ) : tracksByNode.length === 0 ? (
              <div className="h-20" />
            ) : (
              <>
              {tracksByNode.map((group) => {
                const isSelected = selection.includes(group.nodeId)
                const visibleTracks = group.tracks
                  .filter(
                    (track) => !tracksFullyInCollapsedGroup.has(track.id),
                  )
                  .filter((track) => !collapsedStaggerTrackIds.has(track.id))
                  .map(timelineTrackForStaggerEdit)
                  .filter((track): track is Track => !!track)
                  .filter(
                    (track) =>
                      !trackToGroupId.has(track.id) ||
                      activeStaggerMemberIdsByTrack.has(track.id),
                  )
                const hostedGroups = (
                  groupsByHost.get(group.nodeId) ?? []
                ).filter(
                  (keyframeGroup) =>
                    !activeResolvedStaggerSet ||
                    !keyframeGroup.members.some(
                      (member) =>
                        staggerSetOfKey.get(
                          kfKey(member.trackId, member.kfId),
                        ) === activeResolvedStaggerSet.id,
                    ),
                )
                const hostedTrackGroups = (
                  trackGroupsByHost.get(group.nodeId) ?? []
                ).filter(
                  (trackGroup) =>
                    !activeResolvedStaggerSet ||
                    !trackGroup.memberTracks.some((track) =>
                      activeStaggerMemberIdsByTrack.has(track.id),
                    ),
                )
                const hostedStaggerSets =
                  staggerSetsByHost.get(group.nodeId) ?? []
                if (
                  visibleTracks.length === 0 &&
                  hostedGroups.length === 0 &&
                  hostedTrackGroups.length === 0 &&
                  hostedStaggerSets.length === 0
                ) {
                  return null
                }
                const showNodeHeader = visibleTracks.length > 0
                return (
                <div key={group.nodeId}>
                  {hostedStaggerSets.map((set) => (
                    <StaggerSetRightRow
                      key={set.id}
                      set={set}
                      duration={duration}
                      totalWidth={totalWidth}
                      api={api}
                      selected={selectedStaggerSetId === set.id}
                      active={staggerOn && activeStaggerSetId === set.id}
                      expanded={expandedStaggerSetIds.has(set.id)}
                      onSelect={() => selectTimelineStagger(set)}
                      onToggleExpanded={() =>
                        toggleStaggerSetExpanded(set.id)
                      }
                      onDelete={() => deleteTimelineStagger(set)}
                      onContextMenu={(event) =>
                        openStaggerTimelineMenu(event, set)
                      }
                    />
                  ))}
                  {showNodeHeader && (
                    <div
                      className={
                        'relative h-6 border-t border-border/50 ' +
                        (isSelected ? 'bg-accent-soft/40' : '')
                      }
                      style={{ width: totalWidth }}
                    />
                  )}
                  {hostedGroups.map((g) => {
                    const isActive = activeGroupId === g.groupId
                    const layerRelated = g.members.some((m) =>
                      selectedNodeSet.has(trackNodeById.get(m.trackId) ?? ''),
                    )
                    const memberKeys = g.members.map((m) =>
                      kfKey(m.trackId, m.kfId),
                    )
                    const collapsed = !!kfGroupCollapsedDict[g.groupId]
                    return (
                      <div
                        key={g.groupId}
                        tabIndex={0}
                        role="button"
                        aria-selected={isActive}
                        data-timeline-selection-surface="1"
                        onPointerDownCapture={(event) =>
                          event.currentTarget.focus()
                        }
                        onContextMenu={(e) => {
                          // Same right-click menu as the left column so
                          // the user can ungroup from either side. The
                          // GroupSpanBar's body still owns drag — we
                          // only intercept right-click.
                          e.preventDefault()
                          e.stopPropagation()
                          openContextMenu({
                            x: e.clientX,
                            y: e.clientY,
                            items: [
                              {
                                label: collapsed
                                  ? 'Expand group'
                                  : 'Collapse group',
                                onClick: () => toggleGroupCollapsed(g.groupId),
                              },
                              {
                                label: 'Select all keyframes in group',
                                onClick: () => replaceKfs(memberKeys),
                              },
                              { kind: 'separator' as const },
                              {
                                label: 'Ungroup (⌘⇧G)',
                                danger: true,
                                onClick: () =>
                                  ungroupKeyframeGroupsHelper(api, [
                                    g.groupId,
                                  ]),
                              },
                            ],
                          })
                        }}
                        className={[
                          'relative h-6 border-t border-border/50',
                          isActive
                            ? 'bg-accent-soft/50'
                            : layerRelated
                              ? 'bg-accent-soft/35'
                              : 'bg-accent-soft/20',
                        ].join(' ')}
                        style={{ width: totalWidth }}
                      >
                        <GroupSpanBar
                          group={g}
                          duration={duration}
                          api={api}
                          selectedKfs={selectedKfs}
                          layerRelated={layerRelated}
                          replaceKfs={replaceKfs}
                        />
                      </div>
                    )
                  })}
                  {/* Right-column track-group summary rows. The group's
                      bar spans every member's earliest-to-latest
                      keyframe range, painted as a single segment so
                      the user can read the bundled animation at a
                      glance. When the group is expanded the member
                      SegmentRows render right after, indented inside
                      the group. */}
                  {hostedTrackGroups.map((tg) => (
                    <div key={tg.groupId}>
                      <TrackGroupRightRow
                        group={tg}
                        totalWidth={totalWidth}
                        duration={duration}
                        api={api}
                        layerRelated={tg.memberTracks.some((t) =>
                          selectedNodeSet.has(t.nodeId),
                        )}
                        onSelectMembers={() =>
                          selectTrackGroup(
                            tg.memberTracks.map((t) => t.id),
                          )
                        }
                        onDelete={() =>
                          deleteTrackGroup(
                            tg.memberTracks.map((t) => t.id),
                          )
                        }
                        onDropTracks={(trackIds) =>
                          addDroppedTracksToGroup(tg.groupId, trackIds)
                        }
                        onContextMenu={(e, g) => {
                          e.preventDefault()
                          e.stopPropagation()
                          // Resolve the live "selected tracks" set
                          // from both explicit track-selection and
                          // any tracks reached via the keyframe
                          // selection — same routing the Cmd+G
                          // handler uses, so the menu and the
                          // shortcut agree on what counts as "the
                          // selected tracks".
                          const selectedTrackIds =
                            useUI.getState().selectedTrackIds
                          const inferred = new Set<string>(selectedTrackIds)
                          for (const k of selectedKfs) {
                            const colon = k.indexOf(':')
                            if (colon > 0) inferred.add(k.slice(0, colon))
                          }
                          // Anything already in this group is a
                          // no-op — filter to genuinely new tracks.
                          const groupTrackIds = g.memberTracks.map((t) => t.id)
                          const memberSet = new Set(groupTrackIds)
                          const toAdd = Array.from(inferred).filter(
                            (t) => !memberSet.has(t),
                          )
                          const selectedLayerTracksToAdd =
                            selectedAnimatedLayerTrackIds().filter(
                              (trackId) => !memberSet.has(trackId),
                            )
                          const items: import('@/state/ui').ContextMenuItem[] =
                            []
                          if (selectedLayerTracksToAdd.length > 0) {
                            items.push({
                              label:
                                selectedLayerTracksToAdd.length === 1
                                  ? 'Add selected animated layer to this group'
                                  : `Add ${selectedLayerTracksToAdd.length} selected animated layer tracks to this group`,
                              onClick: () =>
                                addTracksToGroupHelper(
                                  api,
                                  g.groupId,
                                  selectedLayerTracksToAdd,
                                ),
                            })
                            items.push({ kind: 'separator' })
                          }
                          if (toAdd.length > 0) {
                            items.push({
                              label:
                                toAdd.length === 1
                                  ? 'Add selected track to this group'
                                  : `Add ${toAdd.length} selected tracks to this group`,
                              onClick: () =>
                                addTracksToGroupHelper(api, g.groupId, toAdd),
                            })
                            items.push({ kind: 'separator' })
                          }
                          items.push({
                            label: g.collapsed
                              ? 'Expand group'
                              : 'Collapse group',
                            onClick: () =>
                              toggleTrackGroupCollapsed(g.groupId),
                          })
                          items.push({
                            label: 'Rename group',
                            onClick: () => {
                              const next = window.prompt(
                                'Rename group',
                                g.label,
                              )
                              if (next !== null) {
                                renameTrackGroupHelper(api, g.groupId, next)
                              }
                            },
                          })
                          items.push({
                            label: 'Ungroup',
                            onClick: () =>
                              ungroupTracksHelper(api, groupTrackIds),
                          })
                          items.push({ kind: 'separator' })
                          items.push({
                            label: 'Delete group and animation',
                            danger: true,
                            onClick: () => deleteTrackGroup(groupTrackIds),
                          })
                          openContextMenu({
                            x: e.clientX,
                            y: e.clientY,
                            items,
                          })
                        }}
                      />
                      {!tg.collapsed &&
                        tg.memberTracks.map((t, index) => (
                          <SegmentRow
                            key={t.id}
                            track={t}
                            duration={duration}
                            api={api}
                            nodeSelected={isSelected}
                            flatTracks={flatTracks}
                            selectedKfs={selectedKfs}
                            toggleKf={toggleKf}
                            replaceKfs={replaceKfs}
                            clearKfs={clearKfs}
                            kfGroupOf={kfGroupOf}
                            kfGroupKeys={kfGroupKeys}
                            staggerSetOfKey={staggerSetOfKey}
                            staggerEditLinksByKey={activeStaggerLinksBySourceKey}
                            onDeleteLinkedStaggerKeys={
                              deleteActiveStaggerMembers
                            }
                            hiddenByGroupCollapse={hiddenByGroupCollapse}
                            onScrub={(time) => {
                              setPlaying(false)
                              smoothSeekPlayhead(time)
                            }}
                            onFocus={() => focusTrackForEditing(group.nodeId)}
                            onDropTrackIds={(trackIds, placement) =>
                              addDroppedTracksToGroup(
                                tg.groupId,
                                trackIds,
                                index + (placement === 'after' ? 1 : 0),
                              )
                            }
                            onBarContextMenu={(e) =>
                              openTimelineMenu(e, { kind: 'track', track: t })
                            }
                            onKeyframeContextMenu={(e, kf) =>
                              openTimelineMenu(e, {
                                kind: 'keyframe',
                                track: t,
                                keyframeId: kf.id,
                                time: kf.time,
                              })
                            }
                          />
                        ))}
                    </div>
                  ))}
                  {visibleTracks.map((t) => (
                    <SegmentRow
                      key={t.id}
                      track={t}
                      duration={duration}
                      api={api}
                      nodeSelected={isSelected}
                      flatTracks={flatTracks}
                      selectedKfs={selectedKfs}
                      toggleKf={toggleKf}
                      replaceKfs={replaceKfs}
                      clearKfs={clearKfs}
                      kfGroupOf={kfGroupOf}
                      kfGroupKeys={kfGroupKeys}
                      staggerSetOfKey={staggerSetOfKey}
                      staggerEditLinksByKey={activeStaggerLinksBySourceKey}
                      onDeleteLinkedStaggerKeys={deleteActiveStaggerMembers}
                      hiddenByGroupCollapse={hiddenByGroupCollapse}
                      onScrub={(time) => {
                        setPlaying(false)
                        smoothSeekPlayhead(time)
                      }}
                      onFocus={() => focusTrackForEditing(group.nodeId)}
                      onBarContextMenu={(e) =>
                        openTimelineMenu(e, { kind: 'track', track: t })
                      }
                      onKeyframeContextMenu={(e, kf) =>
                        openTimelineMenu(e, {
                          kind: 'keyframe',
                          track: t,
                          keyframeId: kf.id,
                          time: kf.time,
                        })
                      }
                    />
                  ))}
                </div>
                )
              })}
              </>
            )}

            {/* Playhead line */}
            <TimelinePlayheadMarker pxPerSecond={pxPerSecond} />

            {/* Isolation dim overlays — when the user has isolated a
                section, paint translucent panels over the bands
                BEFORE the section and AFTER it. The interior stays
                clear. Sits above keyframe rows but below the
                playhead and marquee so the focused area still reads
                as primary. */}
            {isolatedRange && (
              <>
                {isolatedRange.start > 0 && (
                  <div
                    className="pointer-events-none absolute top-0 bottom-0 z-20 bg-app-bg/70"
                    style={{
                      left: 0,
                      width: isolatedRange.start * PX_PER_SECOND,
                    }}
                  />
                )}
                {isolatedRange.end < duration && (
                  <div
                    className="pointer-events-none absolute top-0 bottom-0 z-20 bg-app-bg/70"
                    style={{
                      left: isolatedRange.end * PX_PER_SECOND,
                      width:
                        (duration - isolatedRange.end) * PX_PER_SECOND,
                    }}
                  />
                )}
                {/* Accent borders at the section bounds so the user
                    sees exactly where the focused band starts and
                    ends. */}
                <div
                  className="pointer-events-none absolute top-0 bottom-0 z-20 w-px bg-accent"
                  style={{ left: isolatedRange.start * PX_PER_SECOND }}
                />
                <div
                  className="pointer-events-none absolute top-0 bottom-0 z-20 w-px bg-accent"
                  style={{ left: isolatedRange.end * PX_PER_SECOND }}
                />
              </>
            )}

            {/* Marquee rectangle — drawn while a shift-drag is in
                progress. scroller-local coordinates, same frame as
                tracksByNode rows, so rect corners line up exactly with
                the diamonds they're hit-testing against. */}
            {marquee ? (
              <div
                className="pointer-events-none absolute z-30 border border-playhead bg-playhead/10"
                style={{
                  left: Math.min(marquee.x0, marquee.x1),
                  top: Math.min(marquee.y0, marquee.y1),
                  width: Math.abs(marquee.x1 - marquee.x0),
                  height: Math.abs(marquee.y1 - marquee.y0),
                }}
              />
            ) : null}
        </div> {/* /right wrapper */}
        </div> {/* /flex min-w-max */}
      </div> {/* /outer scroller */}
      {staggerSettingsSet ? (
        <StaggerSettingsModal
          key={staggerSettingsSet.id}
          set={staggerSettingsSet}
          api={api}
          onClose={() => setStaggerSettingsSetId(null)}
          onApply={({ name, layerIds, delay, order }) => {
            api.doc.transact(() => {
              renameStaggerSet(api, staggerSettingsSet.id, name)
              configureStaggerSet(api, staggerSettingsSet.id, {
                layerIds,
                delay,
                order,
              })
            }, UNDOABLE_GESTURE_ORIGIN)
            const remaining = api.getUiState().staggerSets[staggerSettingsSet.id]
            if (activeStaggerSetId === staggerSettingsSet.id) {
              if (remaining) {
                activateStaggerSetForEditing(api, staggerSettingsSet.id)
              } else {
                setStaggerOn(false)
                setSelectedStaggerSetId(null)
              }
            } else if (selectedStaggerSetId === staggerSettingsSet.id) {
              if (remaining) {
                setSelectedStaggerSetId(staggerSettingsSet.id)
                // An inactive row remains a relationship-only selection.
                setSelection([])
              } else {
                setSelectedStaggerSetId(null)
              }
            }
            setStaggerSettingsSetId(null)
          }}
          onDissolve={() => {
            removeStaggerSet(api, staggerSettingsSet.id)
            if (activeStaggerSetId === staggerSettingsSet.id) {
              setStaggerOn(false)
            }
            if (selectedStaggerSetId === staggerSettingsSet.id) {
              setSelectedStaggerSetId(null)
            }
            setStaggerSettingsSetId(null)
          }}
        />
      ) : null}
    </section>
  )
}

function StaggerSettingsModal({
  set,
  api,
  onClose,
  onApply,
  onDissolve,
}: {
  set: ResolvedStaggerTimelineSet
  api: SceneAPI
  onClose: () => void
  onApply: (settings: {
    name: string
    layerIds: string[]
    delay: number
    order: 'forward' | 'reverse'
  }) => void
  onDissolve: () => void
}) {
  const [name, setName] = useState(set.label)
  const [delay, setDelay] = useState(set.delay)
  const [order, setOrder] = useState(set.order)
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(set.layerIds),
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const checkedIds = set.layerIds.filter((nodeId) => checked.has(nodeId))
  const sourceNodeId =
    order === 'forward'
      ? checkedIds[0]
      : checkedIds[checkedIds.length - 1]
  const willDissolve = checkedIds.length < 2

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-6 backdrop-blur-[2px]"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="stagger-settings-title"
        className="w-full max-w-[460px] overflow-hidden rounded-xl border border-border-strong bg-panel-raised text-text shadow-2xl"
      >
        <header className="border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-[4px] border border-stagger/65 bg-stagger-soft text-[10px] font-bold text-stagger">
              S
            </span>
            <h2
              id="stagger-settings-title"
              className="text-[12px] font-semibold tracking-wide uppercase"
            >
              Stagger settings
            </h2>
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-text-muted">
            Checked layers follow the source animation. Unchecking a layer
            removes only the stagger relationship; its existing keyframes stay
            in place.
          </p>
        </header>

        <div className="space-y-4 px-5 py-4">
          <label className="block">
            <span className="mb-1.5 block text-[9px] font-semibold tracking-wider text-text-dim uppercase">
              Name
            </span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="h-8 w-full rounded-md border border-border bg-panel px-2.5 text-[11px] outline-none focus:border-stagger"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-[9px] font-semibold tracking-wider text-text-dim uppercase">
                Layer delay
              </span>
              <div className="flex h-8 items-center rounded-md border border-border bg-panel focus-within:border-stagger">
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={delay}
                  onChange={(event) =>
                    setDelay(Math.max(0, Number(event.target.value) || 0))
                  }
                  className="min-w-0 flex-1 bg-transparent px-2.5 text-[11px] outline-none"
                />
                <span className="pr-2.5 text-[9px] text-text-dim">S</span>
              </div>
            </label>
            <div>
              <span className="mb-1.5 block text-[9px] font-semibold tracking-wider text-text-dim uppercase">
                Layer order
              </span>
              <div className="grid h-8 grid-cols-2 rounded-md border border-border bg-panel p-0.5">
                {(['forward', 'reverse'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setOrder(value)}
                    className={[
                      'rounded-[4px] text-[9px] font-medium tracking-wide uppercase',
                      order === value
                        ? 'bg-stagger-soft text-stagger'
                        : 'text-text-dim hover:text-text',
                    ].join(' ')}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[9px] font-semibold tracking-wider text-text-dim uppercase">
                Affected layers · {checkedIds.length}/{set.layerIds.length}
              </span>
              <div className="flex items-center gap-2 text-[9px]">
                <button
                  type="button"
                  onClick={() => setChecked(new Set(set.layerIds))}
                  className="text-text-muted hover:text-stagger"
                >
                  Check all
                </button>
                <span className="text-border-strong">·</span>
                <button
                  type="button"
                  onClick={() => setChecked(new Set())}
                  className="text-text-muted hover:text-stagger"
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="max-h-64 overflow-y-auto rounded-md border border-border bg-panel">
              {set.layerIds.map((nodeId, index) => {
                const node = api.getNode(nodeId)
                const enabled = checked.has(nodeId)
                return (
                  <label
                    key={nodeId}
                    className="flex h-9 cursor-pointer items-center gap-2.5 border-b border-border/60 px-3 last:border-b-0 hover:bg-panel-raised/70"
                  >
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={() =>
                        setChecked((current) => {
                          const next = new Set(current)
                          if (next.has(nodeId)) next.delete(nodeId)
                          else next.add(nodeId)
                          return next
                        })
                      }
                      className="h-3.5 w-3.5 accent-[var(--color-stagger)]"
                    />
                    <span
                      className={[
                        'min-w-0 flex-1 truncate text-[10px]',
                        enabled ? 'text-text' : 'text-text-dim line-through',
                      ].join(' ')}
                    >
                      {node?.name ?? `Layer ${index + 1}`}
                    </span>
                    {enabled && nodeId === sourceNodeId ? (
                      <span className="rounded bg-stagger-soft px-1.5 py-0.5 text-[8px] font-semibold tracking-wider text-stagger uppercase">
                        Source
                      </span>
                    ) : null}
                  </label>
                )
              })}
            </div>
            {willDissolve ? (
              <p className="mt-2 text-[9px] leading-relaxed text-stagger">
                A stagger needs at least two layers. Applying this selection
                will dissolve the relationship and keep every keyframe.
              </p>
            ) : null}
          </section>
        </div>

        <footer className="flex items-center gap-2 border-t border-border bg-panel px-5 py-3">
          <button
            type="button"
            onClick={onDissolve}
            className="mr-auto text-[9px] text-text-dim hover:text-red-400"
          >
            Dissolve stagger
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-md border border-border px-3 text-[10px] text-text-muted hover:border-border-strong hover:text-text"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() =>
              onApply({
                name: name.trim() || set.label,
                layerIds: checkedIds,
                delay,
                order,
              })
            }
            className="h-8 rounded-md border border-stagger/60 bg-stagger-soft px-3 text-[10px] font-semibold text-stagger hover:brightness-110"
          >
            {willDissolve ? 'Apply & dissolve' : 'Apply changes'}
          </button>
        </footer>
      </div>
    </div>
  )
}

function TimelinePlayheadReadout({
  rulerLabels,
  duration,
  frameRate,
  onCycle,
}: {
  rulerLabels: 'both' | 'time' | 'frames'
  duration: number
  frameRate: number
  onCycle: () => void
}) {
  const playing = useUI((state) => state.playing)
  const pausedPlayhead = useUI((state) =>
    state.playing ? null : state.playhead,
  )
  const timeRef = useRef<HTMLSpanElement | null>(null)
  const frameRef = useRef<HTMLSpanElement | null>(null)
  useEffect(() => {
    let frame = 0
    let previousTimeText = ''
    let previousFrameText = ''
    const update = () => {
      const playhead = playing
        ? getAnimEngine().getPlayhead()
        : (pausedPlayhead ?? 0)
      const timeText = `${Math.floor(playhead)}s`
      if (timeRef.current && timeText !== previousTimeText) {
        timeRef.current.textContent = timeText
        previousTimeText = timeText
      }
      const frameText = `${Math.min(
        Math.max(0, Math.round(duration * frameRate) - 1),
        Math.round(playhead * frameRate),
      )}f`
      if (frameRef.current && frameText !== previousFrameText) {
        frameRef.current.textContent = frameText
        previousFrameText = frameText
      }
      if (playing) frame = requestAnimationFrame(update)
    }
    update()
    return () => cancelAnimationFrame(frame)
  }, [duration, frameRate, pausedPlayhead, playing])
  return (
    <button
      type="button"
      onClick={onCycle}
      title={`Showing ${rulerLabels} · click to cycle Both / Time / Frames`}
      className="ml-1 flex shrink-0 flex-col items-end leading-tight hover:opacity-80"
    >
      {rulerLabels !== 'frames' && (
        <span
          ref={timeRef}
          className="font-mono text-[11px] text-text tabular-nums"
        />
      )}
      {rulerLabels !== 'time' && (
        <span
          ref={frameRef}
          className="font-mono text-[9px] text-text-dim tabular-nums"
        />
      )}
    </button>
  )
}

function TimelinePlayheadMarker({ pxPerSecond }: { pxPerSecond: number }) {
  const playing = useUI((state) => state.playing)
  const pausedPlayhead = useUI((state) =>
    state.playing ? null : state.playhead,
  )
  const lineRef = useRef<HTMLDivElement | null>(null)
  const labelRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    let frame = 0
    let previousLabelText = ''
    const update = () => {
      const playhead = playing
        ? getAnimEngine().getPlayhead()
        : (pausedPlayhead ?? 0)
      if (lineRef.current) {
        lineRef.current.style.transform = `translate3d(${playhead * pxPerSecond}px, 0, 0)`
      }
      const labelText = `${playhead.toFixed(1)} s`
      if (labelRef.current && labelText !== previousLabelText) {
        labelRef.current.textContent = labelText
        previousLabelText = labelText
      }
      if (playing) frame = requestAnimationFrame(update)
    }
    update()
    return () => cancelAnimationFrame(frame)
  }, [pausedPlayhead, playing, pxPerSecond])
  return (
    <div
      ref={lineRef}
      className="pointer-events-none absolute top-0 bottom-0 z-20 w-px bg-playhead"
      style={{ left: 0, willChange: 'transform' }}
    >
      <div
        ref={labelRef}
        className="absolute top-1 left-1/2 -translate-x-1/2 rounded-full bg-playhead px-2.5 py-1 font-mono text-[10px] leading-none whitespace-nowrap text-white"
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Ruler ticks
// ---------------------------------------------------------------------------

function RulerTicks({
  duration,
  frameRate,
  labelsMode,
}: {
  duration: number
  frameRate: number
  labelsMode: 'both' | 'time' | 'frames'
}) {
  // Convenience flags so the per-tick render below stays compact.
  const showTime = labelsMode !== 'frames'
  const showFrame = labelsMode !== 'time'
  // Frame-level ruler. We tick every frame when the zoom gives each
  // frame at least ~2px of width (otherwise the DOM blows up and the
  // ticks visually overlap into a smear). Below that threshold we
  // fall back to time-based ticks at sensible seconds intervals so
  // long comps still render fast at low zoom.
  //
  // Label density is driven by available pixel-space rather than a
  // fixed time interval — the helper below picks the smallest tick
  // multiple whose labels are at least ~60px apart, so the ruler
  // never stacks "0s 0f / 0.02s 1f / 0.03s 2f" labels on top of each
  // other when the user zooms in.
  const totalFrames = Math.max(1, Math.ceil(duration * frameRate))
  const framePx = PX_PER_SECOND / frameRate
  const useFrameTicks = framePx >= 2

  if (!useFrameTicks) {
    // Coarse fallback: seconds-based ticks. Same logic as the
    // pre-frame-by-frame ruler — preserves performance on long
    // exports zoomed out (e.g. 60s comp at 100% comp width fits in
    // the viewport, framePx ~0.5).
    const step = duration > 20 ? 2 : duration > 5 ? 0.5 : 0.25
    const labelEverySeconds = Math.max(step, Math.ceil(60 / PX_PER_SECOND))
    const ticks: number[] = []
    for (let t = 0; t <= duration + 0.0001; t += step) ticks.push(t)
    return (
      <>
        {ticks.map((t) => {
          const isLabel =
            Math.abs(t / labelEverySeconds - Math.round(t / labelEverySeconds)) <
            0.01
          const frame = Math.round(t * frameRate)
          return (
            <div
              key={t}
              className="absolute bottom-0"
              style={{ left: t * PX_PER_SECOND }}
            >
              <div
                className={
                  isLabel ? 'h-3 w-px bg-border-strong' : 'h-1.5 w-px bg-border'
                }
              />
              {isLabel && (showTime || showFrame) && (
                <div className="absolute left-1.5 bottom-3 flex flex-col gap-px font-mono tabular-nums leading-none whitespace-nowrap">
                  {/* Time row sits ABOVE the frame row when both
                      are visible — designers think in seconds, so
                      the higher-priority unit gets the higher
                      visual position. Each row is conditional so
                      the ruler reads cleanly in single-mode too. */}
                  {/* Seconds label only renders on whole-second
                      boundaries — sub-second tick positions still get
                      a frame label, but no decimal-seconds reading.
                      Per the user's "show only whole numbers for
                      seconds" rule. */}
                  {showTime && t % 1 === 0 && (
                    <span className="text-[10px] font-medium text-text">
                      {t.toFixed(0)}s
                    </span>
                  )}
                  {showFrame && (
                    <span className="text-[9px] text-text-muted">
                      {frame}f
                    </span>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </>
    )
  }

  // Frame-by-frame mode. Pick a label step that keeps labels readable.
  // Labels are typically ~50-70px wide so we aim for one every ~64px
  // worth of frames. Always at least 1 (so when zoomed in extremely
  // far we label every frame).
  const labelStepFrames = Math.max(1, Math.ceil(64 / framePx))
  // Major (taller) ticks at every full second so the user has a
  // visual rhythm beyond the per-frame minor ticks.
  return (
    <>
      {Array.from({ length: totalFrames + 1 }, (_, f) => {
        const t = f / frameRate
        const isSecond = f % frameRate === 0
        const isLabel = f % labelStepFrames === 0
        return (
          <div
            key={f}
            className="absolute bottom-0"
            style={{ left: t * PX_PER_SECOND }}
          >
            <div
              className={
                isSecond
                  ? 'h-3 w-px bg-border-strong'
                  : isLabel
                    ? 'h-2 w-px bg-border'
                    : 'h-1 w-px bg-border/60'
              }
            />
            {isLabel && (showTime || showFrame) && (
              <div className="absolute left-1.5 bottom-3 flex flex-col gap-px font-mono tabular-nums leading-none whitespace-nowrap">
                {/* Frame-by-frame ruler: only label whole seconds
                    on the time row. Frame labels still appear at
                    every label step so the user keeps sub-second
                    precision via the frame number. */}
                {showTime && f % frameRate === 0 && (
                  <span className="text-[10px] font-medium text-text">
                    {t.toFixed(0)}s
                  </span>
                )}
                {showFrame && (
                  <span className="text-[9px] text-text-muted">{f}f</span>
                )}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}

// ---------------------------------------------------------------------------
// Track label (left column)
// ---------------------------------------------------------------------------

function TrackLabel({
  track,
  nodeKind,
  nodeSelected = false,
  indent = false,
  layerName,
  onFocus,
  onContextMenu,
  onDropTrackIds,
}: {
  track: Track
  /** Used to disambiguate property labels (e.g. cameras read scaleX as "Scale"). */
  nodeKind?: string
  nodeSelected?: boolean
  /** Render indented (used for tracks living inside an expanded group). */
  indent?: boolean
  /**
   * When set, prefixes the property label with this name and a separator.
   * Used inside Sequence groups so each row shows which layer it
   * animates. Composed groups (single-layer) leave it undefined since
   * the group header already names the layer.
   */
  layerName?: string
  onFocus: () => void
  onContextMenu: (e: React.MouseEvent) => void
  onDropTrackIds?: (trackIds: string[], placement: 'before' | 'after') => void
}) {
  const api = useSceneAPI()
  const selectedTrackId = useUI((s) => s.selectedTrackId)
  const setSelectedTrackId = useUI((s) => s.setSelectedTrackId)
  const selectedTrackIds = useUI((s) => s.selectedTrackIds)
  const setSelectedTrackIds = useUI((s) => s.setSelectedTrackIds)
  const toggleTrackInSelection = useUI((s) => s.toggleTrackInSelection)
  const isFocused = selectedTrackId === track.id
  const inMulti = selectedTrackIds.includes(track.id)
  const isTextAnimationTrack = track.propertyId === 'text.progress'
  return (
    <div
      draggable
      onDragStart={(e) => setDraggedTrackIds(e, dragTrackIdsFor(track.id))}
      onDragOver={(e) => {
        if (!onDropTrackIds) return
        if (!e.dataTransfer.types.includes(TRACK_IDS_DRAG_TYPE)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      }}
      onDrop={(e) => {
        if (!onDropTrackIds) return
        const ids = getDraggedTrackIds(e)
        if (ids.length === 0) return
        e.preventDefault()
        e.stopPropagation()
        const rect = e.currentTarget.getBoundingClientRect()
        onDropTrackIds(
          ids,
          e.clientY > rect.top + rect.height / 2 ? 'after' : 'before',
        )
      }}
      onClick={(e) => {
        // Shift / Cmd / Ctrl click maintains a MULTI-track selection
        // for Cmd+G grouping. Plain click sets the single-track focus
        // (used by Delete) and replaces any multi-select.
        if (e.shiftKey || e.metaKey || e.ctrlKey) {
          toggleTrackInSelection(track.id)
          return
        }
        onFocus()
        setSelectedTrackId(track.id)
        setSelectedTrackIds([track.id])
      }}
      onContextMenu={onContextMenu}
      className={
        'group flex h-6 cursor-pointer items-center gap-2 border-t border-border/30 pr-2 ' +
        (indent ? 'pl-9 ' : 'pl-5 ') +
        (isFocused || inMulti
          ? 'bg-accent-soft/40 text-accent hover:bg-accent-soft/55'
          : nodeSelected
            ? 'bg-accent-soft/25 text-accent hover:bg-accent-soft/40'
            : 'text-text-muted hover:bg-panel-raised/40')
      }
    >
      <span className="truncate text-[11px] font-medium">
        {layerName ? (
          <>
            <span className="text-text-dim">{layerName}</span>
            <span className="mx-1 text-text-dim/60">·</span>
          </>
        ) : null}
        {isTextAnimationTrack ? (
          <span className="mr-1 rounded bg-accent/14 px-1 font-mono text-[9px] text-accent">
            Aa
          </span>
        ) : null}
        {humanProperty(track.propertyId, nodeKind)}
      </span>
      <span className="ml-auto font-mono text-[10px] tabular-nums opacity-70">
        {track.keyframes.length}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation()
          removeTrack(api, track.id)
          if (selectedTrackId === track.id) setSelectedTrackId(null)
        }}
        className="text-[10px] opacity-0 hover:text-text group-hover:opacity-100"
        title="Delete track"
      >
        ×
      </button>
    </div>
  )
}

function TimelineTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      data-timeline-selection-surface="1"
      onClick={onClick}
      className={[
        'h-5 shrink-0 whitespace-nowrap rounded px-1.5 text-[9px] font-semibold uppercase tracking-[0.04em]',
        active
          ? 'bg-accent-soft text-accent'
          : 'text-text-muted hover:bg-panel-raised hover:text-text',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function AudioImportButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-6 rounded border border-border bg-panel-raised px-2 text-[10px] font-semibold tracking-[0.06em] text-text-muted uppercase hover:border-border-strong hover:text-text"
      title="Import audio from Finder"
    >
      Import audio
    </button>
  )
}

function BeatSyncActionBar({
  node,
  selectedBarRange,
  selectedKeyframeCount,
  syncReady,
  syncUnavailableReason,
  message,
  onSetDivision,
  onOpenSettings,
  onSync,
}: {
  node: Extract<SceneNode, { kind: 'audio' }>
  selectedBarRange: {
    audioNodeId: string
    startBar: number
    endBar: number
  } | null
  selectedKeyframeCount: number
  syncReady: boolean
  syncUnavailableReason: string
  message: string
  onSetDivision: (division: NoteDivision) => void
  onOpenSettings: () => void
  onSync: () => void
}) {
  const grid = node.beatGrid
  if (!grid) return null
  const division = selectedBarRange
    ? divisionForBar(grid, selectedBarRange.startBar)
    : grid.beatUnit
  const rangeLabel = selectedBarRange
    ? selectedBarRange.startBar === selectedBarRange.endBar
      ? `Bar ${selectedBarRange.startBar}`
      : `Bars ${selectedBarRange.startBar}–${selectedBarRange.endBar}`
    : 'Choose bars'
  const canSync = syncReady && selectedKeyframeCount > 0 && !!selectedBarRange
  const helper =
    syncUnavailableReason ||
    (selectedKeyframeCount === 0
      ? 'Select keyframes to sync'
      : message ||
        (selectedBarRange
          ? `${selectedKeyframeCount} keyframes ready`
          : 'Choose a bar range'))

  return (
    <div
      data-timeline-selection-surface="1"
      className="flex h-9 shrink-0 items-center gap-3 border-b border-border bg-panel-raised/65 px-3"
    >
      <button
        type="button"
        onClick={onOpenSettings}
        className="flex min-w-0 shrink items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-panel-raised"
        title="Open audio beat settings"
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-accent-soft text-accent">
          <Music2 size={12} strokeWidth={1.9} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[10px] font-medium text-text">
            {node.name}
          </span>
          <span className="block font-mono text-[8px] text-text-dim">
            {grid.bpm.toFixed(1)} BPM
          </span>
        </span>
      </button>

      <div className="h-5 w-px shrink-0 bg-border" />

      <span className="shrink-0 text-[10px] font-medium text-text-muted">
        {rangeLabel}
      </span>
      <div className="flex shrink-0 overflow-hidden rounded border border-border">
        {([4, 8, 16] as const).map((value) => (
          <button
            key={value}
            type="button"
            disabled={!selectedBarRange}
            onClick={() => onSetDivision(value)}
            className={[
              'h-6 min-w-10 border-l border-border px-2 font-mono text-[9px] first:border-l-0',
              division === value
                ? 'bg-accent-soft font-semibold text-accent'
                : 'bg-panel text-text-muted hover:text-text',
              !selectedBarRange ? 'cursor-not-allowed opacity-45' : '',
            ].join(' ')}
            title={`Set selected bars to 1/${value} notes`}
          >
            1/{value}
          </button>
        ))}
      </div>

      <span className="min-w-0 flex-1 truncate text-[9px] text-text-dim">
        {helper}
      </span>

      <button
        type="button"
        onClick={onSync}
        disabled={!canSync}
        className="flex h-6 shrink-0 items-center gap-1.5 rounded bg-accent px-2.5 text-[9px] font-semibold text-white shadow-sm hover:brightness-110 disabled:cursor-not-allowed disabled:bg-panel disabled:text-text-dim disabled:shadow-none"
        title={
          canSync
            ? `Distribute ${selectedKeyframeCount} selected keyframes across ${rangeLabel.toLowerCase()}`
            : helper
        }
      >
        <Wand2 size={11} strokeWidth={2} />
        Distribute to beats
      </button>
    </div>
  )
}

function AudioBeatGridLane({
  node,
  duration,
  totalWidth,
  selectedRange,
  onSelectRange,
}: {
  node: Extract<SceneNode, { kind: 'audio' }>
  duration: number
  totalWidth: number
  selectedRange: { startBar: number; endBar: number } | null
  onSelectRange: (startBar: number, endBar: number) => void
}) {
  const markers = useMemo(() => sceneBeatMarkers(node, duration), [duration, node])
  const clipEnd = audioSourceTimeToSceneTime(
    node,
    Math.max(node.trimStart, node.trimEnd || node.duration),
  )
  const barStarts = markers.filter(
    (marker) => marker.isBarStart && marker.time < clipEnd - 0.001,
  )
  return (
    <div
      data-timeline-selection-surface="1"
      aria-label={`Musical ruler for ${node.name} at ${node.beatGrid?.bpm.toFixed(1)} BPM`}
      className="relative h-7 overflow-hidden border-b border-border bg-panel-raised/35"
      style={{ width: totalWidth }}
    >
      <div className="absolute inset-0">
        {barStarts.map((marker, index) => {
          const next = barStarts[index + 1]
          const end = next?.time ?? Math.min(duration, marker.time + 2)
          const selected =
            !!selectedRange &&
            marker.bar >= selectedRange.startBar &&
            marker.bar <= selectedRange.endBar
          return (
            <button
              key={`bar-${marker.bar}-${marker.time}`}
              type="button"
              className={[
                'absolute inset-y-0 px-1.5 pt-1 text-left font-mono text-[8px] font-semibold tabular-nums',
                selected
                  ? 'bg-accent-soft/70 text-accent'
                  : 'text-text-dim hover:bg-panel-raised/80 hover:text-text',
              ].join(' ')}
              style={{
                left: marker.time * PX_PER_SECOND,
                width: Math.max(10, (end - marker.time) * PX_PER_SECOND),
              }}
              onClick={(event) => {
                if (event.shiftKey && selectedRange) {
                  onSelectRange(
                    Math.min(selectedRange.startBar, marker.bar),
                    Math.max(selectedRange.endBar, marker.bar),
                  )
                } else {
                  onSelectRange(marker.bar, marker.bar)
                }
              }}
              title="Click to select a bar. Shift-click to extend the range."
            >
              B{marker.bar}
            </button>
          )
        })}
        <div className="pointer-events-none absolute inset-0">
          {markers.map((marker) => (
            <span
              key={`musical-tick-${marker.bar}-${marker.beat}-${marker.subdivision}-${marker.time}`}
              className={[
                'absolute bottom-0 w-px',
                marker.isBarStart
                  ? 'h-full bg-accent/70'
                  : marker.subdivision === 1
                    ? 'h-3 bg-accent/65'
                    : 'h-1.5 bg-accent/40',
              ].join(' ')}
              style={{ left: marker.time * PX_PER_SECOND }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function MediaClipLabel({
  node,
  selected,
  onSelect,
  onContextMenu,
}: {
  node: MediaTimelineNode
  selected: boolean
  onSelect: () => void
  onContextMenu: (e: React.MouseEvent) => void
}) {
  return (
    <div
      onClick={onSelect}
      onContextMenu={onContextMenu}
      aria-selected={selected}
      className={[
        'flex h-8 cursor-pointer items-center gap-2 border-t border-border/50 px-3',
        selected
          ? 'bg-accent-soft/40 text-accent hover:bg-accent-soft/55'
          : 'bg-panel-raised/40 text-text hover:bg-panel-raised/70',
      ].join(' ')}
    >
      <span className="w-4 shrink-0 text-center text-[12px] text-text-muted">
        {node.muted ? '×' : node.kind === 'audio' ? '♪' : '▶'}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-medium">{node.name}</div>
        <div className="truncate font-mono text-[9px] text-text-dim">
          {node.kind === 'audio' ? 'AUDIO' : 'VIDEO'} · {formatMediaDuration(node)}
        </div>
      </div>
    </div>
  )
}

function MediaClipRow({
  node,
  api,
  duration,
  totalWidth,
  selected,
  onSelect,
  onScrub,
  onContextMenu,
}: {
  node: MediaTimelineNode
  api: SceneAPI
  duration: number
  totalWidth: number
  selected: boolean
  onSelect: () => void
  onScrub: (time: number) => void
  onContextMenu: (e: React.MouseEvent) => void
}) {
  const rowRef = useRef<HTMLDivElement>(null)
  const trimStart = Math.max(0, node.trimStart || 0)
  const trimEnd = Math.max(trimStart, node.trimEnd || node.duration || 0)
  const sourceDuration = Math.max(0, node.duration || trimEnd)
  const clipLength = Math.max(0.01, trimEnd - trimStart)
  const start = Math.max(0, node.startTime || 0)
  const left = start * PX_PER_SECOND
  const width = Math.max(8, clipLength * PX_PER_SECOND)

  const timeFromPointer = (clientX: number) => {
    const rect = rowRef.current?.getBoundingClientRect()
    if (!rect) return 0
    return Math.max(0, Math.min(duration, (clientX - rect.left) / PX_PER_SECOND))
  }

  const beginDrag = (
    e: React.PointerEvent,
    mode: 'move' | 'trim-start' | 'trim-end',
  ) => {
    e.preventDefault()
    e.stopPropagation()
    onSelect()
    const startX = e.clientX
    const baseStart = start
    const baseTrimStart = trimStart
    const baseTrimEnd = trimEnd
    const maxStart = Math.max(0, duration - clipLength)

    const onMove = (ev: PointerEvent) => {
      const deltaSec = (ev.clientX - startX) / PX_PER_SECOND
      if (mode === 'move') {
        const nextStart = Math.max(0, Math.min(maxStart, baseStart + deltaSec))
        api.setNodeProperty(node.id, 'startTime', nextStart)
        return
      }
      if (mode === 'trim-start') {
        const nextTrimStart = Math.max(
          0,
          Math.min(baseTrimEnd - 0.01, baseTrimStart + deltaSec),
        )
        const nextStart = Math.max(0, baseStart + (nextTrimStart - baseTrimStart))
        api.setNodeProperty(node.id, 'trimStart', nextTrimStart)
        api.setNodeProperty(node.id, 'startTime', nextStart)
        return
      }
      const nextTrimEnd = Math.max(
        baseTrimStart + 0.01,
        Math.min(sourceDuration, baseTrimEnd + deltaSec),
      )
      api.setNodeProperty(node.id, 'trimEnd', nextTrimEnd)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div
      ref={rowRef}
      className={[
        'relative h-8 border-t border-border/50',
        selected ? 'bg-accent-soft/20' : '',
      ].join(' ')}
      style={{ width: totalWidth }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).dataset.mediaClipPart) return
        onScrub(timeFromPointer(e.clientX))
      }}
      onContextMenu={onContextMenu}
    >
      <div
        data-media-clip-part="body"
        className={[
          'absolute top-1 bottom-1 cursor-grab rounded-md border px-2 active:cursor-grabbing',
          node.muted
            ? 'border-border-strong bg-panel-raised text-text-muted'
            : 'border-accent/60 bg-accent-soft text-accent',
        ].join(' ')}
        style={{ left, width }}
        onPointerDown={(e) => beginDrag(e, 'move')}
        onContextMenu={onContextMenu}
        title="Drag to move. Drag edges to trim."
      >
        <div
          data-media-clip-part="trim-start"
          className="absolute top-0 bottom-0 left-0 w-2 cursor-ew-resize rounded-l-md hover:bg-accent/25"
          onPointerDown={(e) => beginDrag(e, 'trim-start')}
        />
        <div
          data-media-clip-part="trim-end"
          className="absolute top-0 right-0 bottom-0 w-2 cursor-ew-resize rounded-r-md hover:bg-accent/25"
          onPointerDown={(e) => beginDrag(e, 'trim-end')}
        />
        <div className="pointer-events-none relative h-full overflow-hidden rounded-md">
          <WaveformBars node={node} />
          {node.kind === 'audio' && node.beatAnalysis && (
            <WaveformTransientMarkers node={node} />
          )}
          <div className="absolute inset-0 flex items-center gap-1 px-2">
            <span className="shrink-0 text-[11px] drop-shadow-sm">
              {node.muted ? '×' : '♪'}
            </span>
            <span className="ml-auto max-w-[45%] truncate bg-accent-soft/80 pl-2 font-mono text-[10px] drop-shadow-sm">
              {node.name}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function WaveformBars({ node }: { node: MediaTimelineNode }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [buffer, setBuffer] = useState<AudioBuffer | null>(
    () => getCachedAudioBuffer(node.src),
  )
  const [barCount, setBarCount] = useState(64)

  useEffect(() => {
    let cancelled = false
    const cached = getCachedAudioBuffer(node.src)
    if (!node.src || cached) {
      setBuffer(cached)
      return
    }
    async function load() {
      try {
        const decoded = await loadAudioBuffer(node.src)
        if (!cancelled) setBuffer(decoded)
      } catch {
        if (!cancelled) setBuffer(null)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [node.src])

  useEffect(() => {
    const host = hostRef.current
    if (!host || typeof ResizeObserver === 'undefined') return
    const resize = () => {
      setBarCount(Math.max(12, Math.min(500, Math.floor(host.clientWidth / 3))))
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  const bars = useMemo(() => {
    if (!buffer) return Array.from({ length: barCount }, () => 0.12)
    const trimStart = Math.max(0, node.trimStart || 0)
    const trimEnd = Math.max(trimStart, node.trimEnd || node.duration || buffer.duration)
    return computeWaveformPeaks(buffer, barCount, trimStart, trimEnd)
  }, [barCount, buffer, node.duration, node.trimEnd, node.trimStart])

  return (
    <div
      ref={hostRef}
      className="absolute inset-x-7 inset-y-1 flex items-center gap-px opacity-90"
      aria-hidden="true"
    >
      {bars.map((p, i) => (
        <span
          key={i}
          className="min-w-px flex-1 rounded-full bg-current"
          style={{ height: `${Math.max(8, Math.round(p * 100))}%` }}
        />
      ))}
    </div>
  )
}

function WaveformTransientMarkers({
  node,
}: {
  node: Extract<SceneNode, { kind: 'audio' }>
}) {
  const trimStart = Math.max(0, node.trimStart || 0)
  const trimEnd = Math.max(trimStart, node.trimEnd || node.duration || 0)
  const clipLength = Math.max(0.001, trimEnd - trimStart)
  const transients = (node.beatAnalysis?.transients ?? []).filter(
    (transient) => transient.time >= trimStart && transient.time <= trimEnd,
  )
  const leftPercent = (sourceTime: number) =>
    `${((sourceTime - trimStart) / clipLength) * 100}%`

  return (
    <div className="absolute inset-x-7 inset-y-0" aria-hidden="true">
      {transients.map((transient, index) => (
        <span
          key={`onset-${index}`}
          className="absolute top-0 h-1.5 w-px bg-[oklch(0.88_0.18_75)]"
          style={{ left: leftPercent(transient.time) }}
        />
      ))}
    </div>
  )
}

function computeWaveformPeaks(
  buffer: AudioBuffer,
  count: number,
  startSeconds = 0,
  endSeconds = buffer.duration,
): number[] {
  const data = buffer.getChannelData(0)
  if (data.length === 0) return Array.from({ length: count }, () => 0.1)
  const startSample = Math.max(
    0,
    Math.min(data.length - 1, Math.floor(startSeconds * buffer.sampleRate)),
  )
  const endSample = Math.max(
    startSample + 1,
    Math.min(data.length, Math.floor(endSeconds * buffer.sampleRate)),
  )
  const block = Math.max(1, Math.floor((endSample - startSample) / count))
  const peaks: number[] = []
  let maxPeak = 0.0001
  for (let i = 0; i < count; i++) {
    let sum = 0
    const start = startSample + i * block
    const end = i === count - 1 ? endSample : Math.min(endSample, start + block)
    for (let j = start; j < end; j++) sum += Math.abs(data[j] ?? 0)
    const avg = sum / Math.max(1, end - start)
    peaks.push(avg)
    if (avg > maxPeak) maxPeak = avg
  }
  return peaks.map((p) => Math.max(0.12, Math.min(1, p / maxPeak)))
}

function formatMediaDuration(node: MediaTimelineNode): string {
  const trimStart = Math.max(0, node.trimStart || 0)
  const trimEnd = Math.max(trimStart, node.trimEnd || node.duration || 0)
  const seconds = Math.max(0, trimEnd - trimStart)
  return `${seconds.toFixed(seconds < 10 ? 2 : 1)}S`
}

function audioSourceTimeToSceneTime(
  node: Extract<SceneNode, { kind: 'audio' }>,
  sourceTime: number,
): number {
  const playbackRate = Math.max(0.01, node.playbackRate || 1)
  return node.startTime + (sourceTime - node.trimStart) / playbackRate
}

function sourceBeatMarkers(
  node: Extract<SceneNode, { kind: 'audio' }>,
): NoteMarker[] {
  const grid = node.beatGrid
  if (!grid) return []
  const secondsPerBar =
    (60 / Math.max(1, grid.bpm)) * Math.max(1, grid.beatsPerBar)
  const sourceEnd = Math.max(node.trimStart, node.trimEnd || node.duration)
  const barCount = Math.max(
    1,
    Math.ceil((sourceEnd - grid.firstBeatTime) / secondsPerBar),
  )
  return createNoteMarkersForBars(grid, 1, barCount).filter(
    (marker) =>
      marker.time >= node.trimStart - 0.001 &&
      marker.time <= sourceEnd + 0.001,
  )
}

function sceneBeatMarkers(
  node: Extract<SceneNode, { kind: 'audio' }>,
  duration: number,
): NoteMarker[] {
  return sourceBeatMarkers(node)
    .map((marker) => ({
      ...marker,
      time: audioSourceTimeToSceneTime(node, marker.time),
    }))
    .filter((marker) => marker.time >= 0 && marker.time <= duration)
}

/** Visible placeholder for the interval after S is pressed and before the
 * first property keyframe turns the session into a persistent stagger set. */
function StaggerDraftLeftRow({
  layerCount,
  delay,
  onCancel,
}: {
  layerCount: number
  delay: number
  onCancel: () => void
}) {
  const ready = layerCount > 1
  return (
    <div className="flex h-10 items-center border-t border-stagger/35 bg-stagger-soft/55 px-3 text-stagger ring-1 ring-inset ring-stagger/25">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-stagger shadow-[0_0_0_3px_var(--color-stagger-soft)]" />
          <span className="truncate text-[10px] font-semibold">
            New stagger
          </span>
          <span className="ml-auto shrink-0 font-mono text-[8px] text-text-dim">
            {layerCount}L · {Math.round(delay * 1000)}MS
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 pl-3.5">
          <span className="rounded-[3px] border border-stagger/70 bg-stagger px-1.5 py-px font-mono text-[8px] font-semibold tracking-wide text-panel uppercase">
            S · Armed
          </span>
          <span className="truncate text-[8px] text-text-dim">
            {ready ? 'Add property keyframes' : 'Select 2+ layers'}
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="ml-2 flex h-5 w-5 shrink-0 items-center justify-center rounded text-[13px] text-text-dim hover:bg-stagger-soft hover:text-stagger"
        title="Turn stagger off (S)"
        aria-label="Turn stagger off"
      >
        ×
      </button>
    </div>
  )
}

function StaggerDraftRightRow({
  layerCount,
  totalWidth,
}: {
  layerCount: number
  totalWidth: number
}) {
  const ready = layerCount > 1
  return (
    <div
      className="relative flex h-10 items-center border-t border-stagger/35 bg-stagger-soft/25 px-3"
      style={{ width: totalWidth }}
      aria-label="Stagger authoring is armed"
    >
      <div className="h-px w-16 border-t border-dashed border-stagger/65" />
      <span className="ml-2 font-mono text-[8px] tracking-wide text-stagger uppercase">
        {ready ? 'Waiting for keyframes' : 'Select at least 2 layers'}
      </span>
    </div>
  )
}

/** Compact persistent relationship row. It lives inside the timeline's
 * ordinary row stack, rather than floating above the editor like a tool mode. */
function StaggerSetLeftRow({
  set,
  selected,
  active,
  expanded,
  onSelect,
  onToggleExpanded,
  onDelete,
  onRename,
  onContextMenu,
}: {
  set: ResolvedStaggerTimelineSet
  selected: boolean
  active: boolean
  expanded: boolean
  onSelect: () => void
  onToggleExpanded: () => void
  onDelete: () => void
  onRename: (name: string) => void
  onContextMenu: (event: React.MouseEvent) => void
}) {
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(set.label)

  useEffect(() => {
    if (!renaming) setDraft(set.label)
  }, [renaming, set.label])

  const commitRename = () => {
    const next = draft.trim()
    if (next && next !== set.label) onRename(next)
    setRenaming(false)
  }

  return (
    <div
      tabIndex={0}
      role="button"
      aria-selected={selected}
      onPointerDown={(event) => event.currentTarget.focus()}
      onClick={() => {
        if (!renaming) onSelect()
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Delete' && event.key !== 'Backspace') return
        event.preventDefault()
        event.stopPropagation()
        onDelete()
      }}
      onDoubleClick={(event) => {
        if (renaming) return
        event.preventDefault()
        event.stopPropagation()
        onToggleExpanded()
      }}
      onContextMenu={onContextMenu}
      className={[
        'flex h-10 cursor-pointer items-center border-t border-stagger/25 px-3',
        active
          ? 'bg-stagger-soft text-stagger'
          : selected
            ? 'bg-stagger-soft/70 text-stagger'
            : 'bg-stagger-soft/35 text-text-muted hover:bg-stagger-soft/60 hover:text-stagger',
      ].join(' ')}
      title="Click to select group · double-click to show or hide member layers · press S to edit"
    >
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          onToggleExpanded()
        }}
        className="mr-1.5 flex h-4 w-4 shrink-0 items-center justify-center rounded text-stagger hover:bg-stagger/15"
        title={expanded ? 'Hide stagger layers' : 'Show stagger layers'}
        aria-label={expanded ? 'Collapse stagger group' : 'Expand stagger group'}
      >
        <Chevron collapsed={!expanded} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          {renaming ? (
            <input
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
              onBlur={commitRename}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitRename()
                if (event.key === 'Escape') {
                  setDraft(set.label)
                  setRenaming(false)
                }
              }}
              className="min-w-0 flex-1 rounded border border-stagger/50 bg-panel px-1 py-0.5 text-[10px] text-text outline-none"
            />
          ) : (
            <span className="min-w-0 flex-1 truncate text-[10px] font-semibold">
              {set.label}
            </span>
          )}
          <span className="shrink-0 font-mono text-[8px] text-text-dim">
            {set.layerIds.length}L · {set.propertyIds.length}P ·{' '}
            {Math.round(set.delay * 1000)}MS ·{' '}
            {set.order === 'forward' ? '1→N' : 'N→1'}
          </span>
        </div>
        <div className="mt-0.5 flex items-center">
          <span
            className={[
              'rounded-[3px] border px-1.5 py-px font-mono text-[8px] font-semibold tracking-wide uppercase',
              active
                ? 'border-stagger/70 bg-stagger text-panel'
                : selected
                  ? 'border-stagger/55 bg-stagger-soft text-stagger'
                  : 'border-stagger/30 bg-panel/50 text-text-dim',
            ].join(' ')}
          >
            {active ? 'Stagger · On' : selected ? 'Press S to edit' : 'Stagger'}
          </span>
        </div>
      </div>
    </div>
  )
}

/** One editable overview lane for an entire stagger relationship. The body
 * shifts every member together while preserving the authored offsets. */
function StaggerSetRightRow({
  set,
  duration,
  totalWidth,
  api,
  selected,
  active,
  expanded,
  onSelect,
  onToggleExpanded,
  onDelete,
  onContextMenu,
}: {
  set: ResolvedStaggerTimelineSet
  duration: number
  totalWidth: number
  api: SceneAPI
  selected: boolean
  active: boolean
  expanded: boolean
  onSelect: () => void
  onToggleExpanded: () => void
  onDelete: () => void
  onContextMenu: (event: React.MouseEvent) => void
}) {
  const previewKeys = useMemo(
    () =>
      set.members.map(
        (member) => [member.trackId, member.kfId] as const,
      ),
    [set.members],
  )
  useKeyframeKeysPreviewRevision(previewKeys)

  let previewStart = Infinity
  let previewEnd = -Infinity
  const markerTimes = new Map<string, number>()
  for (const member of set.members) {
    const previewTime = keyframeDragPreviewStore.getTime(
      member.trackId,
      member.kfId,
      member.time,
    )
    previewStart = Math.min(previewStart, previewTime)
    previewEnd = Math.max(previewEnd, previewTime)
    // Properties authored at the same layer/time collapse to one marker;
    // later property-keyframe bundles remain visible as another run of ticks.
    markerTimes.set(previewTime.toFixed(4), previewTime)
  }
  if (!Number.isFinite(previewStart)) previewStart = set.start
  if (!Number.isFinite(previewEnd)) previewEnd = set.end
  const left = previewStart * PX_PER_SECOND
  const width = Math.max(6, (previewEnd - previewStart) * PX_PER_SECOND)

  const onScalePointerDown =
    (side: 'left' | 'right') =>
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button === 2) return
      event.preventDefault()
      event.stopPropagation()
      onSelect()
      const startX = event.clientX
      const oldStart = set.start
      const oldEnd = set.end
      const oldSpan = oldEnd - oldStart
      if (oldSpan < 0.001) return
      const anchor = side === 'left' ? oldEnd : oldStart
      const drag = createKeyframeDragSession(
        api,
        set.members.map((member) => ({
          trackId: member.trackId,
          kfId: member.kfId,
          startTime: member.time,
        })),
      )
      let moved = false
      let lastRatio = 1
      ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)

      const onMove = (nextEvent: PointerEvent) => {
        const dx = nextEvent.clientX - startX
        if (Math.abs(dx) < 2 && !moved) return
        moved = true
        let nextStart = oldStart
        let nextEnd = oldEnd
        if (side === 'left') {
          nextStart = clamp(
            oldStart + dx / PX_PER_SECOND,
            0,
            oldEnd - 0.01,
          )
        } else {
          nextEnd = clamp(
            oldEnd + dx / PX_PER_SECOND,
            oldStart + 0.01,
            duration,
          )
        }
        lastRatio = (nextEnd - nextStart) / oldSpan
        drag.previewTimes(
          set.members.map((member) => ({
            trackId: member.trackId,
            kfId: member.kfId,
            time: clamp(
              anchor + (member.time - anchor) * lastRatio,
              0,
              duration,
            ),
          })),
        )
      }
      const cleanup = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onCancel)
      }
      const onUp = (nextEvent: PointerEvent) => {
        onMove(nextEvent)
        cleanup()
        if (!moved) {
          drag.cancel()
          return
        }
        const nextDelay = set.delay * lastRatio
        api.doc.transact(() => {
          drag.commit()
          setStaggerSetDelayMetadata(api, set.id, nextDelay)
        }, UNDOABLE_GESTURE_ORIGIN)
        if (active) useUI.getState().setStaggerDelay(nextDelay)
      }
      const onCancel = () => {
        cleanup()
        drag.cancel()
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onCancel)
    }

  const onBarPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button === 2) return
    event.preventDefault()
    event.stopPropagation()
    onSelect()
    const startX = event.clientX
    const earliest = set.start
    const latest = set.end
    const drag = createKeyframeDragSession(
      api,
      set.members.map((member) => ({
        trackId: member.trackId,
        kfId: member.kfId,
        startTime: member.time,
      })),
    )
    let moved = false
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)

    const onMove = (nextEvent: PointerEvent) => {
      const dx = nextEvent.clientX - startX
      if (Math.abs(dx) < 2 && !moved) return
      moved = true
      drag.preview(
        clamp(dx / PX_PER_SECOND, -earliest, duration - latest),
      )
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
    const onUp = (nextEvent: PointerEvent) => {
      onMove(nextEvent)
      cleanup()
      if (moved) drag.commit()
      else drag.cancel()
    }
    const onCancel = () => {
      cleanup()
      drag.cancel()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  return (
    <div
      tabIndex={0}
      role="button"
      aria-selected={selected}
      onPointerDownCapture={(event) => event.currentTarget.focus()}
      onKeyDown={(event) => {
        if (event.key !== 'Delete' && event.key !== 'Backspace') return
        event.preventDefault()
        event.stopPropagation()
        onDelete()
      }}
      onDoubleClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onToggleExpanded()
      }}
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).dataset.staggerBar) return
        onSelect()
      }}
      onContextMenu={onContextMenu}
      className={[
        'relative h-10 border-t border-stagger/25',
        active
          ? 'bg-stagger-soft'
          : selected
            ? 'bg-stagger-soft/70'
            : 'bg-stagger-soft/30',
      ].join(' ')}
      style={{ width: totalWidth }}
    >
      <div
        data-stagger-bar="1"
        data-timeline-selection-surface="1"
        onPointerDown={onBarPointerDown}
        className="absolute top-1/2 z-[2] h-3 -translate-y-1/2 cursor-grab touch-none rounded-[3px] border border-stagger-ring bg-stagger/75 shadow-sm active:cursor-grabbing"
        style={{ left, width, willChange: 'left, width' }}
        title={`${set.label} · ${set.layerIds.length} layers · ${set.propertyIds.length} properties · drag to shift · double-click to ${expanded ? 'collapse' : 'expand'}`}
      >
        {Array.from(markerTimes.entries()).map(([markerId, time]) => (
          <span
            key={markerId}
            aria-hidden
            className="pointer-events-none absolute top-1/2 h-2 w-px -translate-y-1/2 bg-panel/90"
            style={{ left: (time - previewStart) * PX_PER_SECOND }}
          />
        ))}
        <div
          data-stagger-handle="left"
          onPointerDown={onScalePointerDown('left')}
          className="absolute inset-y-[-4px] left-0 w-2 -translate-x-1/2 cursor-ew-resize"
          title="Drag to scale stagger from its start"
        >
          <span className="absolute top-1/2 left-1/2 h-4 w-1 -translate-x-1/2 -translate-y-1/2 rounded-[1px] border border-stagger-ring bg-panel" />
        </div>
        <div
          data-stagger-handle="right"
          onPointerDown={onScalePointerDown('right')}
          className="absolute inset-y-[-4px] right-0 w-2 translate-x-1/2 cursor-ew-resize"
          title="Drag to scale stagger from its end"
        >
          <span className="absolute top-1/2 left-1/2 h-4 w-1 -translate-x-1/2 -translate-y-1/2 rounded-[1px] border border-stagger-ring bg-panel" />
        </div>
      </div>
    </div>
  )
}

function SegmentPreviewBar({
  track,
  segmentClassName,
  beadClassName,
  onPointerDown,
  onContextMenu,
}: {
  track: Track
  segmentClassName: string
  beadClassName: string
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void
  onContextMenu: (e: React.MouseEvent<HTMLDivElement>) => void
}) {
  // This is the only row-level subscriber used by a drag. It updates the
  // connector endpoints without rebuilding SegmentRow or the full Timeline.
  useKeyframePreviewRevision(track.id, track.keyframes)
  if (track.keyframes.length === 0) return null

  let firstTime = Infinity
  let lastTime = -Infinity
  for (const keyframe of track.keyframes) {
    const previewTime = keyframeDragPreviewStore.getTime(
      track.id,
      keyframe.id,
      keyframe.time,
    )
    firstTime = Math.min(firstTime, previewTime)
    lastTime = Math.max(lastTime, previewTime)
  }
  const hasSpan = track.keyframes.length >= 2 && lastTime > firstTime

  return hasSpan ? (
    <div
      data-segment-bar="1"
      data-timeline-selection-surface="1"
      onPointerDown={onPointerDown}
      onContextMenu={onContextMenu}
      title={`${firstTime.toFixed(2)}s → ${lastTime.toFixed(2)}s — drag to shift, right-click for options`}
      className="group absolute top-1/2 z-[1] -translate-y-1/2 cursor-grab touch-none select-none active:cursor-grabbing"
      style={{
        left: firstTime * PX_PER_SECOND,
        width: (lastTime - firstTime) * PX_PER_SECOND,
        height: SEGMENT_DRAG_HIT_HEIGHT,
        willChange: 'left, width',
      }}
    >
      <div
        aria-hidden
        className={`${segmentClassName} pointer-events-none group-hover:brightness-110`}
      />
    </div>
  ) : (
    <div
      className={beadClassName}
      style={{ left: firstTime * PX_PER_SECOND, willChange: 'left' }}
    />
  )
}

// ---------------------------------------------------------------------------
// Segment row (right side, per track)
// ---------------------------------------------------------------------------

/**
 * Row showing a track's animation as a single pill-shaped segment bar
 * spanning from the first to the last keyframe, with keyframe diamonds
 * on top for retiming.
 *
 * Interactions:
 *   - Click the blank row → scrub the playhead to that time.
 *   - Drag the bar (body) → shift ALL keyframes by the same delta.
 *     Clamps so the earliest KF can't go below 0 and the latest can't
 *     exceed `duration`.
 *   - Drag a diamond → retime that single keyframe.
 *   - Alt-click a diamond → delete.
 *
 * A track with a single keyframe draws a short bead instead of a bar
 * (there's no span yet — it's just a held value).
 */
function SegmentRow({
  track,
  duration,
  api,
  nodeSelected = false,
  flatTracks,
  selectedKfs,
  toggleKf,
  replaceKfs,
  clearKfs,
  kfGroupOf,
  kfGroupKeys,
  staggerSetOfKey,
  staggerEditLinksByKey,
  onDeleteLinkedStaggerKeys,
  hiddenByGroupCollapse,
  onScrub,
  onFocus,
  onBarContextMenu,
  onKeyframeContextMenu,
  onDropTrackIds,
}: {
  track: Track
  duration: number
  api: SceneAPI
  nodeSelected?: boolean
  flatTracks: Track[]
  selectedKfs: Set<string>
  toggleKf: (trackId: string, kfId: string) => void
  /** Replace the global keyframe selection with `keys`. Used on
   * bar-pointerdown to mark every keyframe of the clicked track as
   * selected so a subsequent Delete deletes the property's keyframes
   * (not the owning layer). */
  replaceKfs: (keys: string[]) => void
  clearKfs: () => void
  /** Map from "${trackId}:${kfId}" → group id, for the diamonds. */
  kfGroupOf: Map<string, string>
  /** Map from group id → set of member keys. */
  kfGroupKeys: Map<string, Set<string>>
  /** Persistent stagger membership, styled independently from manual groups. */
  staggerSetOfKey: Map<string, string>
  /** Source key → the source/follower bundle moved together in edit mode. */
  staggerEditLinksByKey: Map<string, KeyframeDragMember[]>
  onDeleteLinkedStaggerKeys: (
    members: readonly KeyframeDragMember[],
  ) => void
  /** Keys hidden because they belong to a collapsed group. */
  hiddenByGroupCollapse: Set<string>
  onScrub: (time: number) => void
  onFocus: () => void
  onBarContextMenu: (e: React.MouseEvent) => void
  onKeyframeContextMenu: (
    e: React.MouseEvent,
    kf: Track['keyframes'][number],
  ) => void
  onDropTrackIds?: (trackIds: string[], placement: 'before' | 'after') => void
}) {
  const rowRef = useRef<HTMLDivElement>(null)

  const onRowPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Skip if the click lands on a keyframe diamond, the segment bar,
    // or one of the bar's edge handles — those have their own handlers.
    const t = e.target as HTMLElement
    if (t.dataset.kfId || t.dataset.segmentBar || t.dataset.segmentEdge) return
    // Shift-drag on empty row space is the marquee — defer to the wrapper
    // handler by bailing here. Events still bubble because we don't
    // stopPropagation.
    if (e.shiftKey) return
    // Plain click on empty row area clears any keyframe selection —
    // matches the "click empty canvas to deselect" instinct users bring
    // from the main canvas.
    clearKfs()
    const el = rowRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = e.clientX - rect.left
    onScrub(clamp(x / PX_PER_SECOND, 0, duration))
  }

  const kfs = track.keyframes
  const first = kfs[0]
  const last = kfs[kfs.length - 1]
  const segmentClassName = nodeSelected
    ? 'absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-accent ring-1 ring-accent/70 shadow-[0_0_0_2px_var(--color-accent-soft)]'
    : 'absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-segment-bar/70 ring-1 ring-segment-bar-ring/60 group-hover:bg-segment-bar-hover'
  const beadClassName = nodeSelected
    ? 'absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow-[0_0_0_2px_var(--color-accent-soft)]'
    : 'absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-segment-bar-hover'

  const onBarPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!first || !last) return
    // Right-clicks go through onContextMenu; skip the drag handler.
    if (e.button === 2) return
    e.stopPropagation()
    e.preventDefault()
    const linkedStaggerMembers = new Map<string, KeyframeDragMember>()
    for (const keyframe of kfs) {
      for (const member of
        staggerEditLinksByKey.get(kfKey(track.id, keyframe.id)) ?? []) {
        linkedStaggerMembers.set(kfKey(member.trackId, member.kfId), member)
      }
    }
    if (e.altKey) {
      // Alt-drag on the bar = delete whole track.
      if (linkedStaggerMembers.size > 0) {
        onDeleteLinkedStaggerKeys([...linkedStaggerMembers.values()])
      } else {
        removeTrack(api, track.id)
      }
      return
    }
    // Shift / Cmd / Ctrl-click on a segment bar = extend the selection
    // with every keyframe on this track. Without this, the existing
    // selection got clobbered by `replaceKfs` below. Toggle semantics:
    // if ALL of this track's kfs are already in the selection, remove
    // them; otherwise add them. No drag starts — modifier-clicks are
    // pure selection gestures.
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      onFocus()
      const trackKeys = kfs.map((k) => kfKey(track.id, k.id))
      const allIn = trackKeys.every((k) => selectedKfs.has(k))
      const next = new Set(selectedKfs)
      if (allIn) {
        for (const k of trackKeys) next.delete(k)
      } else {
        for (const k of trackKeys) next.add(k)
      }
      replaceKfs([...next])
      return
    }
    onFocus()

    // In stagger edit mode the visible source property is a proxy for the
    // same property on every follower. Moving its segment therefore shifts
    // all linked keys, while the timeline continues to show only the source.
    if (linkedStaggerMembers.size > 0) {
      replaceKfs(kfs.map((keyframe) => kfKey(track.id, keyframe.id)))
      const members = [...linkedStaggerMembers.values()]
      const earliest = Math.min(...members.map((member) => member.startTime))
      const latest = Math.max(...members.map((member) => member.startTime))
      const startX = e.clientX
      const drag = createKeyframeDragSession(api, members)
      const onMove = (event: PointerEvent) => {
        drag.preview(
          clamp(
            (event.clientX - startX) / PX_PER_SECOND,
            -earliest,
            duration - latest,
          ),
        )
      }
      const cleanup = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onCancel)
      }
      const onUp = (event: PointerEvent) => {
        onMove(event)
        cleanup()
        drag.commit()
      }
      const onCancel = () => {
        cleanup()
        drag.cancel()
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onCancel)
      return
    }

    // Two batch sources fold into the same drag, mirroring the
    // diamond handler:
    //   1. multi-track selection (selectedTrackIds.length > 1)
    //   2. multi-keyframe selection (selectedKfs.size > 1)
    // Either drives a batch drag; their union (every kf that is
    // either on a selected track OR explicitly in the kf set) moves
    // together. Without #2, a marquee/shift-built keyframe selection
    // would get clobbered the moment the user grabbed a segment bar
    // — which is exactly the bug users were hitting.
    //
    // We deliberately do NOT call replaceKfs in either batch branch —
    // that would clobber the multi-selection the user built up.
    // Single-track path below keeps the original "grab segment →
    // select all kfs on this track" behavior so plain drags still
    // feel like Jitter.
    const ui = useUI.getState()
    const trackBatchActive =
      ui.selectedTrackIds.length > 1 && ui.selectedTrackIds.includes(track.id)
    // kf-batch fires whenever there's a real multi-kf selection.
    // We don't require a kf on THIS track to be in the set — if the
    // user has selected kfs across other tracks and grabs a bar
    // here, the natural read is "drag the selection," not "create a
    // new single-track drag." That matches what users expect from
    // After Effects' selected-keyframes-move-together model.
    const kfBatchActive = selectedKfs.size > 1
    const isBatch = trackBatchActive || kfBatchActive

    const pointerId = e.pointerId
    const startX = e.clientX
    ;(e.currentTarget as HTMLElement).setPointerCapture(pointerId)

    if (isBatch) {
      // Snapshot start times of every keyframe in the union of the two
      // selection sources. The transient preview and final transaction both
      // derive from this immutable drag-start state.
      const trackSet = new Set(ui.selectedTrackIds)
      const seen = new Set<string>()
      const snap: Array<{ trackId: string; kfId: string; startTime: number }> =
        []
      for (const t of flatTracks) {
        for (const kf of t.keyframes) {
          const key = kfKey(t.id, kf.id)
          const inKfSelection = kfBatchActive && selectedKfs.has(key)
          const inTrackSelection = trackBatchActive && trackSet.has(t.id)
          if ((inKfSelection || inTrackSelection) && !seen.has(key)) {
            seen.add(key)
            snap.push({ trackId: t.id, kfId: kf.id, startTime: kf.time })
          }
        }
      }
      // If the union ended up empty (e.g. selectedKfs got stale),
      // fall through to the single-track path below — better than
      // a no-op drag.
      if (snap.length === 0) {
        replaceKfs(kfs.map((k) => kfKey(track.id, k.id)))
      } else {
        let earliestSel = Infinity
        let latestSel = -Infinity
        for (const s of snap) {
          if (s.startTime < earliestSel) earliestSel = s.startTime
          if (s.startTime > latestSel) latestSel = s.startTime
        }
        const minDelta = -earliestSel
        const maxDelta = duration - latestSel
        const excludeBatch = new Set(snap.map((s) => kfKey(s.trackId, s.kfId)))
        // Anchor snap on the FIRST keyframe of the bar's own track —
        // that's the segment edge the user actually grabbed, which
        // is what they expect to align cleanly to neighbors.
        const leaderStart = kfs[0]!.time
        const drag = createKeyframeDragSession(api, snap)
        const onMove = (ev: PointerEvent) => {
          const dx = (ev.clientX - startX) / PX_PER_SECOND
          const cd = clamp(dx, minDelta, maxDelta)
          const proposed = leaderStart + cd
          const snapped = snapTime(proposed, flatTracks, excludeBatch, ev.altKey)
          const finalDx = snapped - leaderStart
          drag.preview(finalDx)
        }
        const cleanup = () => {
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', onUp)
          window.removeEventListener('pointercancel', onCancel)
        }
        const onUp = (ev: PointerEvent) => {
          onMove(ev)
          cleanup()
          drag.commit()
        }
        const onCancel = () => {
          cleanup()
          drag.cancel()
        }
        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        window.addEventListener('pointercancel', onCancel)
        return
      }
    }

    // Single-track path (original behavior).
    //   - SELECT every keyframe on this track so a follow-up Delete
    //     removes the property's keyframes, not the layer. The user
    //     reads the bar as "the segment between two keyframes" and
    //     expects clicking it to grab them as a unit.
    replaceKfs(kfs.map((k) => kfKey(track.id, k.id)))
    const startTimes = kfs.map((k) => k.time)
    const earliest = startTimes[0]!
    const latest = startTimes[startTimes.length - 1]!

    // Snap exclusion = every kf on the dragged track. We base the
    // snap on the LEADING (earliest) kf's proposed new time so the
    // segment's start lines up with neighboring boundaries.
    const excludeOwn = new Set(kfs.map((k) => kfKey(track.id, k.id)))
    const members: KeyframeDragMember[] = kfs.map((keyframe, index) => ({
      trackId: track.id,
      kfId: keyframe.id,
      startTime: startTimes[index]!,
    }))
    const drag = createKeyframeDragSession(api, members)
    const onMove = (ev: PointerEvent) => {
      const dxSeconds = (ev.clientX - startX) / PX_PER_SECOND
      const minDelta = -earliest
      const maxDelta = duration - latest
      const delta = clamp(dxSeconds, minDelta, maxDelta)
      const proposedLead = earliest + delta
      const snappedLead = snapTime(proposedLead, flatTracks, excludeOwn, ev.altKey)
      const finalDelta = snappedLead - earliest
      drag.preview(finalDelta)
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
    const onUp = (ev: PointerEvent) => {
      onMove(ev)
      cleanup()
      drag.commit()
    }
    const onCancel = () => {
      cleanup()
      drag.cancel()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  return (
    <div
      ref={rowRef}
      onPointerDown={onRowPointerDown}
      onDragOver={(e) => {
        if (!onDropTrackIds) return
        if (!e.dataTransfer.types.includes(TRACK_IDS_DRAG_TYPE)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      }}
      onDrop={(e) => {
        if (!onDropTrackIds) return
        const ids = getDraggedTrackIds(e)
        if (ids.length === 0) return
        e.preventDefault()
        e.stopPropagation()
        const rect = e.currentTarget.getBoundingClientRect()
        onDropTrackIds(
          ids,
          e.clientY > rect.top + rect.height / 2 ? 'after' : 'before',
        )
      }}
      className={
        'relative h-6 border-t border-border/30 ' +
        (nodeSelected
          ? 'bg-accent-soft/40 hover:bg-accent-soft/60'
          : 'hover:bg-panel-raised/30')
      }
      style={{ height: ROW_HEIGHT }}
    >
      {/* Segment bar — spans first → last keyframe. Clickable body for
          move-all-keyframes drag. The bar is only a quiet connector;
          grouped "keyframe set" handles render on group rows instead. */}
      {first && last ? (
        <SegmentPreviewBar
          track={track}
          segmentClassName={segmentClassName}
          beadClassName={beadClassName}
          onPointerDown={onBarPointerDown}
          onContextMenu={onBarContextMenu}
        />
      ) : null}

      {/* Keyframe diamonds on top of the bar. Still individually
          draggable for non-linear keyframes. Visually these are dots,
          not the grouped keyframe-set component. */}
      {kfs.map((kf) => {
        // Skip rendering when this kf belongs to a collapsed group.
        // The group's span bar is the only visible representation in
        // that case, which keeps the timeline clean for animations
        // with many small keyframes.
        if (hiddenByGroupCollapse.has(kfKey(track.id, kf.id))) return null
        return (
          <KeyframeDiamond
            key={kf.id}
            trackId={track.id}
            kfId={kf.id}
            time={kf.time}
            duration={duration}
            api={api}
            flatTracks={flatTracks}
            selectedKfs={selectedKfs}
            toggleKf={toggleKf}
            replaceKfs={replaceKfs}
            kfGroupOf={kfGroupOf}
            kfGroupKeys={kfGroupKeys}
            staggerSetOfKey={staggerSetOfKey}
            linkedStaggerMembers={
              staggerEditLinksByKey.get(kfKey(track.id, kf.id))
            }
            onDelete={() => {
              const linked = staggerEditLinksByKey.get(
                kfKey(track.id, kf.id),
              )
              if (linked?.length) onDeleteLinkedStaggerKeys(linked)
              else removeKeyframe(api, track.id, kf.id)
            }}
            onFocus={onFocus}
            onContextMenu={(e) => onKeyframeContextMenu(e, kf)}
          />
        )
      })}
    </div>
  )
}

function KeyframeDiamond({
  trackId,
  kfId,
  time,
  duration,
  api,
  flatTracks,
  selectedKfs,
  toggleKf,
  replaceKfs,
  kfGroupOf,
  kfGroupKeys,
  staggerSetOfKey,
  linkedStaggerMembers,
  onDelete,
  onFocus,
  onContextMenu,
}: {
  trackId: string
  kfId: string
  time: number
  duration: number
  api: SceneAPI
  flatTracks: Track[]
  selectedKfs: Set<string>
  toggleKf: (trackId: string, kfId: string) => void
  replaceKfs: (keys: string[]) => void
  kfGroupOf: Map<string, string>
  kfGroupKeys: Map<string, Set<string>>
  staggerSetOfKey: Map<string, string>
  linkedStaggerMembers?: KeyframeDragMember[]
  onDelete: () => void
  onFocus: () => void
  onContextMenu: (e: React.MouseEvent) => void
}) {
  const myKey = kfKey(trackId, kfId)
  const isSelected = selectedKfs.has(myKey)
  const groupId = kfGroupOf.get(myKey)
  const groupMembers = groupId ? kfGroupKeys.get(groupId) : undefined
  const inGroup = !!groupMembers && groupMembers.size > 1
  const staggerSetId = staggerSetOfKey.get(myKey)
  const inStaggerSet = !!staggerSetId

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Right-clicks fall through to onContextMenu; don't start a drag.
    if (e.button === 2) return
    e.stopPropagation()
    // Shift / Cmd / Ctrl-click = toggle set membership, no drag. Matches
    // Figma's layer-panel instinct users bring over from the canvas.
    //
    // For grouped keyframes (Cmd+G groups), toggle the WHOLE group as a
    // unit — if any member is currently selected, remove them all; if
    // none are, add them all. Without this, shift-clicking group B
    // after grabbing group A only added one diamond instead of the
    // whole sequence the user was trying to extend.
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      if (inGroup && groupMembers) {
        const anyMemberSelected = [...groupMembers].some((k) =>
          selectedKfs.has(k),
        )
        const next = new Set(selectedKfs)
        if (anyMemberSelected) {
          for (const k of groupMembers) next.delete(k)
        } else {
          for (const k of groupMembers) next.add(k)
        }
        replaceKfs([...next])
      } else {
        toggleKf(trackId, kfId)
      }
      return
    }
    // Plain click on a grouped keyframe: replace selection with the
    // entire group. From there, the existing batch-drag path takes
    // over — drag any group member and they all move together. This
    // is the whole point of grouping.
    if (inGroup && !isSelected && groupMembers) {
      replaceKfs([...groupMembers])
      onFocus()
      return
    }
    if (e.altKey) {
      // Alt-click ALWAYS removes the single clicked keyframe — even if
      // it sits inside a live multi-selection. The earlier behavior
      // (deleting the whole selection on alt-click of a member) made it
      // impossible to peel one keyframe out of a marquee'd set without
      // re-marqueeing first. The Delete key still operates on the full
      // selection set; alt-click is the surgical remover.
      onDelete()
      return
    }
    onFocus()

    // The source key is the editable proxy for this stagger bundle. Its
    // followers stay hidden in edit mode, but move in the same drag session.
    if (linkedStaggerMembers && linkedStaggerMembers.length > 1) {
      replaceKfs([myKey])
      const startX = e.clientX
      const earliest = Math.min(
        ...linkedStaggerMembers.map((member) => member.startTime),
      )
      const latest = Math.max(
        ...linkedStaggerMembers.map((member) => member.startTime),
      )
      const exclude = new Set(
        linkedStaggerMembers.map((member) =>
          kfKey(member.trackId, member.kfId),
        ),
      )
      const drag = createKeyframeDragSession(api, linkedStaggerMembers)
      const onMove = (event: PointerEvent) => {
        const delta = clamp(
          (event.clientX - startX) / PX_PER_SECOND,
          -earliest,
          duration - latest,
        )
        const proposed = time + delta
        const snapped = snapTime(proposed, flatTracks, exclude, event.altKey)
        drag.preview(snapped - time)
      }
      const cleanup = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onCancel)
      }
      const onUp = (event: PointerEvent) => {
        onMove(event)
        cleanup()
        drag.commit()
      }
      const onCancel = () => {
        cleanup()
        drag.cancel()
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onCancel)
      return
    }

    // Two batch sources fold into the same drag: a multi-keyframe
    // selection (selectedKfs) and a multi-track selection
    // (selectedTrackIds). Either one drives a batch drag; if both
    // are active, the snap is the UNION — every keyframe that's
    // either in the kf-selection or sits on a selected track moves
    // together. This is what users intuitively expect from
    // "selected" → "drag any selected thing → all of them move."
    const ui = useUI.getState()
    const trackBatchActive =
      ui.selectedTrackIds.length > 1 && ui.selectedTrackIds.includes(trackId)
    const kfBatchActive = isSelected && selectedKfs.size > 1
    const isBatch = kfBatchActive || trackBatchActive
    const startX = e.clientX
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)

    if (isBatch) {
      // Snapshot starting times for every keyframe in the batch at drag-start.
      // Preview frames stay outside the scene document, then pointer-up uses
      // this same immutable state for its single durable transaction.
      const trackSet = new Set(ui.selectedTrackIds)
      const seen = new Set<string>()
      const snap: Array<{ trackId: string; kfId: string; startTime: number }> = []
      for (const t of flatTracks) {
        for (const kf of t.keyframes) {
          const key = kfKey(t.id, kf.id)
          const inKfSelection = kfBatchActive && selectedKfs.has(key)
          const inTrackSelection = trackBatchActive && trackSet.has(t.id)
          if ((inKfSelection || inTrackSelection) && !seen.has(key)) {
            seen.add(key)
            snap.push({ trackId: t.id, kfId: kf.id, startTime: kf.time })
          }
        }
      }
      // Clamp the overall delta against the earliest/latest selected kf
      // so neither endpoint escapes [0, duration]. Mirrors the segment-
      // bar shift drag above.
      let earliest = Infinity
      let latest = -Infinity
      for (const s of snap) {
        if (s.startTime < earliest) earliest = s.startTime
        if (s.startTime > latest) latest = s.startTime
      }
      const minDelta = -earliest
      const maxDelta = duration - latest

      // Excluded keys for snap = every selected kf. We snap based on
      // the LEADING dragged kf's proposed new time, then apply the
      // resulting delta uniformly so the batch keeps its spacing.
      const excludeBatch = new Set(snap.map((s) => kfKey(s.trackId, s.kfId)))
      const leaderStart = time
      const drag = createKeyframeDragSession(api, snap)
      const onMove = (ev: PointerEvent) => {
        const dx = (ev.clientX - startX) / PX_PER_SECOND
        const clampedDx = clamp(dx, minDelta, maxDelta)
        const proposed = leaderStart + clampedDx
        const snapped = snapTime(proposed, flatTracks, excludeBatch, ev.altKey)
        const finalDx = snapped - leaderStart
        drag.preview(finalDx)
      }
      const cleanup = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onCancel)
      }
      const onUp = (ev: PointerEvent) => {
        onMove(ev)
        cleanup()
        drag.commit()
      }
      const onCancel = () => {
        cleanup()
        drag.cancel()
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onCancel)
      return
    }

    // Single-kf drag/click. Always replace the selection with this
    // one keyframe, even if it was already selected as part of a
    // segment/bar selection. Endpoint handles must be individually
    // selectable; clicking one end should not leave the opposite end
    // selected.
    replaceKfs([myKey])
    const startTime = time
    const excludeSelf = new Set([myKey])
    const drag = createKeyframeDragSession(api, [
      { trackId, kfId, startTime },
    ])
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX
      const proposed = clamp(startTime + dx / PX_PER_SECOND, 0, duration)
      const next = snapTime(proposed, flatTracks, excludeSelf, ev.altKey)
      drag.preview(next - startTime)
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
    const onUp = (ev: PointerEvent) => {
      onMove(ev)
      cleanup()
      drag.commit()
    }
    const onCancel = () => {
      cleanup()
      drag.cancel()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  const previewTime = useKeyframePreviewTime(trackId, kfId, time)

  return (
    <>
      <div
        onPointerDown={onPointerDown}
        onContextMenu={onContextMenu}
        data-kf-id={kfId}
        data-track-id={trackId}
        data-timeline-selection-surface="1"
        title={
          inStaggerSet
            ? `${previewTime.toFixed(2)}s — member of a persistent stagger set. Select the amber stagger row to edit the full set.`
            : inGroup
            ? `${previewTime.toFixed(2)}s — grouped (${groupMembers!.size}). Click selects group, alt-click deletes one, Cmd+Shift+G ungroups.`
            : `${previewTime.toFixed(2)}s — shift-click to multi-select, alt-click to delete this one, Delete for selection, right-click for options`
        }
        // Selection feedback is load-bearing here: the user has reported
        // that the old subtle color shift felt like nothing was happening.
        // So selected dots are bigger, near-white with a thick accent
        // ring, and carry a small halo. That reads as "selected" at a
        // glance even with a dozen keyframes on the row.
        className={
          'absolute top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-full transition-[width,height,box-shadow] ' +
          (isSelected
            ? inStaggerSet
              ? 'z-[2] h-3 w-3 bg-white ring-2 ring-stagger shadow-[0_0_0_2px_var(--color-stagger-soft)]'
              : 'z-[2] h-3 w-3 bg-white ring-2 ring-accent shadow-[0_0_0_2px_var(--color-accent-soft)]'
            : inStaggerSet
              ? 'z-[1] h-2.5 w-2.5 bg-stagger ring-1 ring-stagger-ring hover:brightness-110'
              : inGroup
              ? // Grouped + not selected: keep the keyframe color but
                // swap the ring to accent so groups read at a glance.
                'z-[1] h-2.5 w-2.5 bg-keyframe ring-1 ring-accent hover:brightness-125'
              : 'z-[1] h-2.5 w-2.5 bg-keyframe ring-1 ring-keyframe-ring hover:brightness-125')
        }
        style={{
          left: time * PX_PER_SECOND,
          transform: `translate3d(${(previewTime - time) * PX_PER_SECOND}px, 0, 0)`,
          willChange: 'transform',
        }}
      />
      {/* Group indicator dot below the diamond. Tiny, accent-colored,
          purely decorative — but enough to spot which keyframes share
          a group on a dense row. Skipped for selected diamonds since
          their halo already dominates the visual. */}
      {inGroup && !isSelected && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute h-1 w-1 -translate-x-1/2 rounded-full bg-accent"
          style={{
            left: time * PX_PER_SECOND,
            bottom: 2,
            transform: `translate3d(${(previewTime - time) * PX_PER_SECOND}px, 0, 0)`,
            willChange: 'transform',
          }}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Group span bar (proportional retime control)
// ---------------------------------------------------------------------------

/**
 * Slim accent-colored bar sitting just under the ruler, spanning from
 * the group's earliest to latest keyframe time. Confirms the group
 * exists visibly and provides the proportional-retime gesture.
 *
 * Three drag zones on the bar:
 *   - left edge   → anchor on the right edge, scale all keyframes
 *                   so the group's start moves to the new pointer time.
 *   - right edge  → anchor on the left edge, scale all keyframes so
 *                   the group's end moves to the new pointer time.
 *   - bar body    → uniform shift; every member moves by the same
 *                   delta. Same math as the existing batch-drag.
 *
 * Pointer packets publish through the transient drag store at display rate;
 * pointer-up persists every member in one transaction. Pointer capture keeps
 * the gesture live when it leaves the slim bar, and pointer-cancel rolls the
 * preview back without touching the scene document.
 *
 * Edge cases:
 *   - Zero-width groups (all members at same time): we skip the
 *     scale path because there's no spread to scale; only body-shift
 *     is meaningful. Edge handles still render, but their drag is a
 *     no-op until the user uses the body to spread them.
 *   - Single member: activeGroup returns null, so the bar isn't
 *     rendered at all.
 */

// ---------------------------------------------------------------------------
// Track-group rows — Jitter's Composed / Sequence rows. The left
// column carries the label + chevron; the right column carries a
// summary segment bar that spans the union of every member track's
// keyframes. When the group is collapsed the member tracks render
// nowhere else, so this row IS the animation. When expanded the
// member rows render below.
// ---------------------------------------------------------------------------

type ResolvedTrackGroup = {
  groupId: string
  kind: 'composed' | 'sequence'
  hostNodeId: string
  label: string
  memberTracks: Track[]
  collapsed: boolean
}

function TrackGroupLeftRow({
  group,
  nodeKind,
  layerRelated = false,
  onToggle,
  onSelectMembers,
  onDelete,
  onUngroup,
  onRename,
  selectedLayerTracksToAdd,
  onAddSelectedLayers,
  onRemoveTracksFromGroup,
  onDropTracks,
  onDropTracksAtIndex,
  openContextMenu,
}: {
  group: ResolvedTrackGroup
  nodeKind?: string
  layerRelated?: boolean
  onToggle: () => void
  onSelectMembers: () => void
  onDelete: () => void
  onUngroup: () => void
  onRename: (name: string) => void
  selectedLayerTracksToAdd: number
  onAddSelectedLayers: () => void
  onRemoveTracksFromGroup: (trackIds: string[]) => void
  onDropTracks: (trackIds: string[]) => void
  onDropTracksAtIndex: (trackIds: string[], index: number) => void
  openContextMenu: (menu: import('@/state/ui').ContextMenuState) => void
}) {
  const collapsed = group.collapsed
  const api = useSceneAPI()
  const selectedTrackIds = useUI((state) => state.selectedTrackIds)
  const selected =
    group.memberTracks.length > 0 &&
    group.memberTracks.every((track) => selectedTrackIds.includes(track.id))
  const [editingName, setEditingName] = useState(false)
  const [draftName, setDraftName] = useState(group.label)
  useEffect(() => {
    if (!editingName) setDraftName(group.label)
  }, [editingName, group.label])
  const commitRename = () => {
    setEditingName(false)
    onRename(draftName)
  }
  return (
    <>
      <div
        tabIndex={0}
        role="button"
        aria-selected={selected}
        data-timeline-selection-surface="1"
        onPointerDown={(event) => event.currentTarget.focus()}
        onClick={onSelectMembers}
        onKeyDown={(event) => {
          if (event.key !== 'Delete' && event.key !== 'Backspace') return
          event.preventDefault()
          event.stopPropagation()
          onDelete()
        }}
        onDoubleClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setEditingName(true)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onSelectMembers()
          openContextMenu({
            x: e.clientX,
            y: e.clientY,
            items: [
              {
                label: collapsed ? 'Expand' : 'Collapse',
                onClick: onToggle,
              },
              {
                label: 'Select member tracks',
                onClick: onSelectMembers,
              },
              {
                label: 'Rename group',
                onClick: () => setEditingName(true),
              },
              ...(selectedLayerTracksToAdd > 0
                ? [
                    {
                      label:
                        selectedLayerTracksToAdd === 1
                          ? 'Add selected animated layer to group'
                          : `Add ${selectedLayerTracksToAdd} selected animated layer tracks to group`,
                      onClick: onAddSelectedLayers,
                    },
                  ]
                : []),
              { kind: 'separator' as const },
              { label: 'Ungroup (⌘⇧G)', onClick: onUngroup },
              {
                label: 'Delete group and animation',
                danger: true,
                onClick: onDelete,
              },
            ],
          })
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(TRACK_IDS_DRAG_TYPE)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
        }}
        onDrop={(e) => {
          const ids = getDraggedTrackIds(e)
          if (ids.length === 0) return
          e.preventDefault()
          e.stopPropagation()
          onDropTracks(ids)
        }}
        title={
          collapsed
            ? 'Click to select members · double-click to expand · right-click for more'
            : 'Click to select members · double-click to collapse · right-click for more'
        }
        className={[
          'flex h-6 cursor-pointer items-center gap-1.5 border-t border-border/50 px-3 pl-2 text-accent hover:bg-accent-soft/70',
          selected
            ? 'bg-accent-soft/80 ring-1 ring-inset ring-accent/45'
            : layerRelated
              ? 'bg-accent-soft/65'
              : 'bg-accent-soft/50',
        ].join(' ')}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onToggle()
          }}
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-accent hover:bg-accent/20"
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          <Chevron collapsed={collapsed} />
        </button>
        {group.kind === 'composed' ? (
          <BoltGlyph />
        ) : (
          <SequenceGlyph />
        )}
        {editingName ? (
          <input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') {
                setDraftName(group.label)
                setEditingName(false)
              }
            }}
            className="min-w-0 flex-1 rounded border border-accent/40 bg-panel px-1 text-[11px] font-medium text-text outline-none"
          />
        ) : (
          <span
            className="truncate text-[11px] font-medium"
            title="Double-click to rename"
          >
            {group.label}
            <span className="ml-1 text-text-dim">
              · {group.kind === 'composed' ? 'Composed' : 'Sequence'}
            </span>
          </span>
        )}
      </div>
      {/* Children render only when expanded — indented underneath
          so the bundling reads visually like a folder. */}
      {!collapsed &&
        group.memberTracks.map((t, index) => (
          <TrackLabel
            key={t.id}
            track={t}
            nodeKind={nodeKind}
            indent
            // Sequence groups span multiple layers, so each child row
            // needs the layer name to be useful — without it the user
            // sees "Opacity, Opacity, Opacity" and can't tell which
            // is which. Composed groups (single layer) skip the prefix
            // because the group header already shows the layer name.
            layerName={
              group.kind === 'sequence'
                ? (api.getNode(t.nodeId)?.name ?? undefined)
                : undefined
            }
            onFocus={() => {
              /* selection of the layer happens via the parent shell */
            }}
            onDropTrackIds={(trackIds, placement) =>
              onDropTracksAtIndex(
                trackIds,
                index + (placement === 'after' ? 1 : 0),
              )
            }
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              openContextMenu({
                x: e.clientX,
                y: e.clientY,
                items: [
                  {
                    label: 'Remove track from group',
                    onClick: () => onRemoveTracksFromGroup([t.id]),
                  },
                  { kind: 'separator' as const },
                  {
                    label: 'Ungroup (⌘⇧G)',
                    danger: true,
                    onClick: onUngroup,
                  },
                ],
              })
            }}
          />
        ))}
    </>
  )
}

/**
 * Right-column counterpart of TrackGroupLeftRow. Paints a single
 * segment bar spanning every member track's earliest-to-latest
 * keyframe and exposes drag affordances:
 *
 *   - Drag the body  → uniformly shifts every member keyframe by
 *                       the same delta (clamped so the earliest can't
 *                       go below 0 and the latest can't pass duration).
 *   - Drag left edge → scales every member keyframe time around the
 *                       right edge as anchor (extends or contracts
 *                       the group from the left).
 *   - Drag right edge → mirror; anchor is the left edge.
 *
 * Same math as `GroupSpanBar` for keyframe groups, but the member
 * source here is each track's keyframes flattened into a single
 * (trackId, kfId, time) list.
 *
 * When the group is expanded the caller still renders the underlying
 * SegmentRows below this bar so individual keyframes remain editable
 * — the group bar is an additional, group-level handle, not a
 * replacement for per-keyframe interaction.
 */
function TrackGroupRightRow({
  group,
  totalWidth,
  duration,
  api,
  layerRelated = false,
  onSelectMembers,
  onDelete,
  onDropTracks,
  onContextMenu,
}: {
  group: ResolvedTrackGroup
  totalWidth: number
  duration: number
  api: SceneAPI
  layerRelated?: boolean
  onSelectMembers: () => void
  onDelete: () => void
  onDropTracks: (trackIds: string[]) => void
  /** Right-click on the span bar — parent builds the menu so it can
   *  reach the live track selection and the openContextMenu handle. */
  onContextMenu?: (e: React.MouseEvent, group: ResolvedTrackGroup) => void
}) {
  const selectedTrackIds = useUI((s) => s.selectedTrackIds)
  const previewKeys = useMemo(
    () =>
      group.memberTracks.flatMap((track) =>
        track.keyframes.map(
          (keyframe) => [track.id, keyframe.id] as const,
        ),
      ),
    [group.memberTracks],
  )
  useKeyframeKeysPreviewRevision(previewKeys)
  // Compute the time span across all member keyframes.
  let start = Infinity
  let end = -Infinity
  for (const t of group.memberTracks) {
    for (const kf of t.keyframes) {
      const previewTime = keyframeDragPreviewStore.getTime(
        t.id,
        kf.id,
        kf.time,
      )
      if (previewTime < start) start = previewTime
      if (previewTime > end) end = previewTime
    }
  }
  const hasSpan = start !== Infinity && end !== -Infinity && end > start
  const left = hasSpan ? start * PX_PER_SECOND : 0
  const width = hasSpan ? (end - start) * PX_PER_SECOND : 0
  const edgeHitWidth = groupEdgeHitWidth(width)
  const allSelected =
    group.memberTracks.length > 0 &&
    group.memberTracks.every((track) => selectedTrackIds.includes(track.id))
  const highlighted = allSelected || layerRelated
  const fill = highlighted
    ? 'var(--color-group-bar-active)'
    : 'var(--color-group-bar)'

  // Flatten all member-track keyframes into a single list. Snapshot
  // taken at drag-start (inside the handlers) so concurrent scene
  // mutations don't race.
  const collectMembers = () => {
    const members: Array<{ trackId: string; kfId: string; time: number }> = []
    for (const t of group.memberTracks) {
      for (const kf of t.keyframes) {
        members.push({ trackId: t.id, kfId: kf.id, time: kf.time })
      }
    }
    return members
  }

  /**
   * Body drag — uniform shift of every member keyframe. Mirrors the
   * keyframe-group GroupSpanBar's body handler.
   */
  const onBodyPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).dataset.groupHandle) return
    onSelectMembers()
    if (!hasSpan) return
    e.stopPropagation()
    e.preventDefault()
    const startX = e.clientX
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const snap = collectMembers()
    const minDelta = -start
    const maxDelta = duration - end
    const drag = createKeyframeDragSession(
      api,
      snap.map((member) => ({
        trackId: member.trackId,
        kfId: member.kfId,
        startTime: member.time,
      })),
    )
    const previewAt = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / PX_PER_SECOND
      const cd = clamp(dx, minDelta, maxDelta)
      drag.preview(cd)
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', previewAt)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
    const onUp = (ev: PointerEvent) => {
      previewAt(ev)
      cleanup()
      drag.commit()
    }
    const onCancel = () => {
      cleanup()
      drag.cancel()
    }
    window.addEventListener('pointermove', previewAt)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  /**
   * Edge scale — proportional retime of every member keyframe.
   * `side` picks the dragged edge; the opposite edge is the anchor.
   * Pre-snapshot keeps each pointermove computing from a stable
   * reference rather than chasing scene mutations.
   */
  const onScalePointerDown =
    (side: 'left' | 'right') =>
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!hasSpan) return
      e.stopPropagation()
      e.preventDefault()
      onSelectMembers()
      const startX = e.clientX
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      const snap = collectMembers()
      const oldStart = start
      const oldEnd = end
      const oldSpan = oldEnd - oldStart
      const anchor = side === 'left' ? oldEnd : oldStart
      const drag = createKeyframeDragSession(
        api,
        snap.map((member) => ({
          trackId: member.trackId,
          kfId: member.kfId,
          startTime: member.time,
        })),
      )

      const previewAt = (ev: PointerEvent) => {
        const dx = (ev.clientX - startX) / PX_PER_SECOND
        let newStart = oldStart
        let newEnd = oldEnd
        if (side === 'left') {
          newStart = clamp(oldStart + dx, 0, oldEnd - 0.01)
        } else {
          newEnd = clamp(oldEnd + dx, oldStart + 0.01, duration)
        }
        const newSpan = newEnd - newStart
        if (oldSpan < 0.001) return
        const ratio = newSpan / oldSpan
        drag.previewTimes(
          snap.map((member) => ({
            trackId: member.trackId,
            kfId: member.kfId,
            time: clamp(
              anchor + (member.time - anchor) * ratio,
              0,
              duration,
            ),
          })),
        )
      }
      const cleanup = () => {
        window.removeEventListener('pointermove', previewAt)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onCancel)
      }
      const onUp = (ev: PointerEvent) => {
        previewAt(ev)
        cleanup()
        drag.commit()
      }
      const onCancel = () => {
        cleanup()
        drag.cancel()
      }
      window.addEventListener('pointermove', previewAt)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onCancel)
    }

  return (
    <>
      <div
        tabIndex={0}
        role="button"
        aria-selected={allSelected}
        data-timeline-selection-surface="1"
        onPointerDownCapture={(event) => event.currentTarget.focus()}
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest('[data-track-group-bar]')) {
            return
          }
          onSelectMembers()
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Delete' && event.key !== 'Backspace') return
          event.preventDefault()
          event.stopPropagation()
          onDelete()
        }}
        className={[
          'relative h-6 border-t border-border/50',
          layerRelated ? 'bg-accent-soft/45' : 'bg-accent-soft/30',
        ].join(' ')}
        style={{ width: totalWidth }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(TRACK_IDS_DRAG_TYPE)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
        }}
        onDrop={(e) => {
          const ids = getDraggedTrackIds(e)
          if (ids.length === 0) return
          e.preventDefault()
          e.stopPropagation()
          onDropTracks(ids)
        }}
        onContextMenu={(e) => {
          onSelectMembers()
          onContextMenu?.(e, group)
        }}
      >
        {hasSpan && (
          <div
            data-track-group-bar="1"
            data-timeline-selection-surface="1"
            onPointerDown={onBodyPointerDown}
            onContextMenu={(e) => onContextMenu?.(e, group)}
            title={`${start.toFixed(2)}s – ${end.toFixed(2)}s · drag body to shift, edges to scale, right-click for options`}
            className="group absolute top-1/2 h-4 -translate-y-1/2 cursor-grab rounded-[4px] ring-1 hover:brightness-110 active:cursor-grabbing"
            style={{
              left,
              width: Math.max(2, width),
              touchAction: 'none',
              background: fill,
              boxShadow: '0 0 0 0 color-mix(in oklab, var(--color-group-bar-ring) 60%, transparent)',
              '--tw-ring-color': 'var(--color-group-bar-ring)',
            } as React.CSSProperties}
          >
            {/* Edge scale handles. 8px wide, slightly extending past
                the bar so they're easy to grab. data-groupHandle on
                them so the body's pointerdown stops short. */}
            <div
              data-group-handle="left"
              onPointerDown={onScalePointerDown('left')}
              title="Drag to scale group from the left"
              className="absolute top-0 bottom-0 left-0 cursor-ew-resize rounded-l hover:bg-white/10"
              style={{ width: edgeHitWidth }}
            >
              <span className="absolute top-1/2 left-[5px] h-2.5 w-0.5 -translate-y-1/2 rounded-full bg-white mix-blend-overlay" />
            </div>
            <div
              data-group-handle="right"
              onPointerDown={onScalePointerDown('right')}
              title="Drag to scale group from the right"
              className="absolute top-0 right-0 bottom-0 cursor-ew-resize rounded-r hover:bg-white/10"
              style={{ width: edgeHitWidth }}
            >
              <span className="absolute top-1/2 right-1 h-2.5 w-0.5 -translate-y-1/2 rounded-full bg-white mix-blend-overlay" />
            </div>
          </div>
        )}
      </div>
      {/* Children — only when expanded. Caller renders the actual
          SegmentRows so they re-use existing drag / select wiring. */}
    </>
  )
}

function BoltGlyph() {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 12 12"
      aria-hidden="true"
      className="shrink-0 opacity-90"
    >
      <path
        d="M6.5 1 L 3 7 L 5.5 7 L 5 11 L 9 5 L 6.5 5 Z"
        fill="currentColor"
      />
    </svg>
  )
}

function SequenceGlyph() {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0 opacity-90"
    >
      <rect x="2" y="2" width="3" height="3" />
      <rect x="7" y="2" width="3" height="3" />
      <rect x="2" y="7" width="3" height="3" />
      <rect x="7" y="7" width="3" height="3" />
    </svg>
  )
}

// (legacy state-row helpers kept below — they're no longer mounted but
// the type StateEntry / function StatesRow remain exported until the
// rest of the timeline drops the import; safe to delete in a follow-up.)
type StateEntry = {
  time: number
  members: Array<{
    trackId: string
    kfId: string
    propertyId: string
  }>
}

function StatesRow({
  states,
  duration,
  api,
  flatTracks,
  selectedKfs,
  setSelectedKfs,
  replaceKfs,
  clearKfs,
  hiddenByGroupCollapse,
  onScrub,
  onFocus,
}: {
  nodeId: string
  states: StateEntry[]
  duration: number
  api: SceneAPI
  flatTracks: Track[]
  selectedKfs: Set<string>
  setSelectedKfs: React.Dispatch<React.SetStateAction<Set<string>>>
  replaceKfs: (keys: string[]) => void
  clearKfs: () => void
  hiddenByGroupCollapse: Set<string>
  onScrub: (time: number) => void
  onFocus: () => void
}) {
  const rowRef = useRef<HTMLDivElement>(null)

  // Click on empty row → scrub the playhead and clear keyframe
  // selection. Same instinct as SegmentRow's row-pointer-down.
  const onRowPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement
    if (t.dataset.stateDiamond) return
    if (e.shiftKey) return
    clearKfs()
    const el = rowRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = e.clientX - rect.left
    onScrub(clamp(x / PX_PER_SECOND, 0, duration))
  }

  // For the connecting bar: span from the earliest to the latest state.
  const first = states[0]
  const last = states[states.length - 1]
  const hasSpan = !!(first && last && last.time > first.time)

  return (
    <div
      ref={rowRef}
      onPointerDown={onRowPointerDown}
      className="absolute inset-0"
    >
      {/* Faint segment bar between first and last state — gives a
          visual sense of the animation's overall span without
          stamping a per-property bar everywhere. */}
      {first && last && hasSpan && (
        <div
          className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-segment-bar opacity-60"
          style={{
            left: first.time * PX_PER_SECOND,
            width: (last.time - first.time) * PX_PER_SECOND,
          }}
        />
      )}
      {states.map((s) => {
        const memberKeys = s.members.map((m) => kfKey(m.trackId, m.kfId))
        // Hide a state if every one of its underlying keyframes is
        // currently hidden because of a collapsed group. A state with
        // mixed visibility (some grouped, some not) still shows.
        const allHidden = memberKeys.every((k) =>
          hiddenByGroupCollapse.has(k),
        )
        if (allHidden) return null
        const isSelected = memberKeys.every((k) => selectedKfs.has(k))
        return (
          <StateDiamond
            key={`${s.time}-${memberKeys[0]}`}
            time={s.time}
            duration={duration}
            api={api}
            members={s.members}
            memberKeys={memberKeys}
            isSelected={isSelected}
            flatTracks={flatTracks}
            selectedKfs={selectedKfs}
            setSelectedKfs={setSelectedKfs}
            replaceKfs={replaceKfs}
            onFocus={onFocus}
          />
        )
      })}
    </div>
  )
}

/**
 * One state diamond. Looks like a regular keyframe diamond, but its
 * click / drag fans out across every underlying keyframe at the same
 * time on the same layer. Tooltip lists the property names so the
 * user can see what got bundled.
 *
 * Selection model mirrors KeyframeDiamond's:
 *   - shift / cmd / ctrl-click toggles the state's members in the
 *     live keyframe selection (so multiple states can be picked up)
 *   - plain click on an unselected state replaces selection with
 *     this state's members
 *   - plain click on an already-selected state preserves a wider
 *     multi-state selection so the drag can shift everything
 *
 * Drag model:
 *   - if multiple kfs are selected (multi-state batch), drag any one
 *     state and every selected keyframe shifts by the same time
 *     delta (preserves spacing). Mirrors KeyframeDiamond's batch
 *     path so the user's intuition transfers.
 *   - else single-state drag: every member moves to the same new
 *     time (the state stays one cohesive moment).
 */
function StateDiamond({
  time,
  duration,
  api,
  members,
  memberKeys,
  isSelected,
  flatTracks,
  selectedKfs,
  setSelectedKfs,
  replaceKfs,
  onFocus,
}: {
  time: number
  duration: number
  api: SceneAPI
  members: StateEntry['members']
  memberKeys: string[]
  isSelected: boolean
  flatTracks: Track[]
  selectedKfs: Set<string>
  setSelectedKfs: React.Dispatch<React.SetStateAction<Set<string>>>
  replaceKfs: (keys: string[]) => void
  onFocus: () => void
}) {
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button === 2) return
    e.stopPropagation()

    // Shift / cmd / ctrl click: toggle this state's members in the
    // live selection. Adds when none of the state's members are
    // currently picked, removes when all are. Partial overlap is
    // treated as "add the missing members" — the state becomes fully
    // selected after the click.
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      setSelectedKfs((prev) => {
        const next = new Set(prev)
        const allIn = memberKeys.every((k) => prev.has(k))
        if (allIn) {
          for (const k of memberKeys) next.delete(k)
        } else {
          for (const k of memberKeys) next.add(k)
        }
        return next
      })
      return
    }

    if (e.altKey) {
      // Alt-click = delete every keyframe in this state. Bypasses
      // selection — surgical, like alt-click on a regular keyframe.
      api.doc.transact(() => {
        for (const m of members) removeKeyframe(api, m.trackId, m.kfId)
      })
      return
    }

    onFocus()

    // Plain click on an UN-selected state replaces selection so the
    // graph editor / inspector flips to this state's underlying
    // tracks. Plain click on an ALREADY-selected state keeps the
    // current (possibly multi-state) selection so the drag can shift
    // everything together.
    const isAlreadySelected = memberKeys.every((k) => selectedKfs.has(k))
    if (!isAlreadySelected) {
      replaceKfs(memberKeys)
    }
    // Decide path AFTER possibly replacing selection. The post-replace
    // selection size is `memberKeys.length` if we just replaced;
    // otherwise it's whatever it was. Multi-state batch drag activates
    // when more keyframes are selected than this state contains.
    const effectiveSize = isAlreadySelected ? selectedKfs.size : memberKeys.length
    const isBatch = effectiveSize > memberKeys.length

    const startX = e.clientX
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)

    if (isBatch) {
      // Snapshot every selected kf's start time. Any kf in selectedKfs
      // (which may span multiple states across multiple layers) gets
      // shifted by the same delta. Same pattern as KeyframeDiamond.
      const snap: Array<{
        trackId: string
        kfId: string
        startTime: number
      }> = []
      for (const t of flatTracks) {
        for (const kf of t.keyframes) {
          if (selectedKfs.has(kfKey(t.id, kf.id))) {
            snap.push({ trackId: t.id, kfId: kf.id, startTime: kf.time })
          }
        }
      }
      let earliest = Infinity
      let latest = -Infinity
      for (const s of snap) {
        if (s.startTime < earliest) earliest = s.startTime
        if (s.startTime > latest) latest = s.startTime
      }
      const minDelta = -earliest
      const maxDelta = duration - latest
      const excludeBatch = new Set(snap.map((s) => kfKey(s.trackId, s.kfId)))
      const leaderStart = time
      const drag = createKeyframeDragSession(api, snap)

      const previewAt = (ev: PointerEvent) => {
        const dxSeconds = (ev.clientX - startX) / PX_PER_SECOND
        const delta = clamp(dxSeconds, minDelta, maxDelta)
        const proposedLead = leaderStart + delta
        const snappedLead = snapTime(
          proposedLead,
          flatTracks,
          excludeBatch,
          ev.altKey,
        )
        const finalDelta = snappedLead - leaderStart
        drag.preview(finalDelta)
      }
      const cleanup = () => {
        window.removeEventListener('pointermove', previewAt)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onCancel)
      }
      const onUp = (ev: PointerEvent) => {
        previewAt(ev)
        cleanup()
        drag.commit()
      }
      const onCancel = () => {
        cleanup()
        drag.cancel()
      }
      window.addEventListener('pointermove', previewAt)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onCancel)
      return
    }

    // Single-state drag — every member ends up at the same new time
    // so the state stays one coherent moment.
    const minDelta = -time
    const maxDelta = duration - time
    const excludeOwn = new Set(memberKeys)
    const drag = createKeyframeDragSession(
      api,
      members.map((member) => ({
        trackId: member.trackId,
        kfId: member.kfId,
        startTime: time,
      })),
    )

    const previewAt = (ev: PointerEvent) => {
      const dxSeconds = (ev.clientX - startX) / PX_PER_SECOND
      const delta = clamp(dxSeconds, minDelta, maxDelta)
      const proposed = clamp(time + delta, 0, duration)
      const nextTime = snapTime(proposed, flatTracks, excludeOwn, ev.altKey)
      drag.preview(nextTime - time)
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', previewAt)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
    const onUp = (ev: PointerEvent) => {
      previewAt(ev)
      cleanup()
      drag.commit()
    }
    const onCancel = () => {
      cleanup()
      drag.cancel()
    }
    window.addEventListener('pointermove', previewAt)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  const previewMember = members[0]
  const previewTime = useKeyframePreviewTime(
    previewMember?.trackId ?? '',
    previewMember?.kfId ?? '',
    time,
  )
  const propertyNames = members
    .map((m) => humanProperty(m.propertyId))
    .join(', ')
  const propertyCount = members.length

  return (
    <div
      data-state-diamond="1"
      data-state-keys={memberKeys.join('|')}
      onPointerDown={onPointerDown}
      title={`${previewTime.toFixed(2)}s · ${propertyCount} ${
        propertyCount === 1 ? 'property' : 'properties'
      }: ${propertyNames}`}
      className={
        'absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rotate-45 cursor-ew-resize ' +
        (isSelected
          ? 'h-3.5 w-3.5 bg-white ring-2 ring-accent shadow-[0_0_0_3px_var(--color-accent-soft)] z-[1]'
          : 'h-3 w-3 bg-keyframe ring-1 ring-keyframe-ring hover:brightness-125')
      }
      style={{
        left: time * PX_PER_SECOND,
        transform: `translate3d(${(previewTime - time) * PX_PER_SECOND}px, 0, 0)`,
        willChange: 'transform',
      }}
    >
      {/* Tiny count badge so the user can tell "this is 1 property" vs
          "this is 4 properties" at a glance. Only when multi-property. */}
      {propertyCount > 1 && (
        <span
          aria-hidden
          className="pointer-events-none absolute font-mono text-[7px] text-text-muted -rotate-45"
          style={{ top: -10, left: -2 }}
        >
          {propertyCount}
        </span>
      )}
    </div>
  )
}

function GroupSpanBar({
  group,
  duration,
  api,
  selectedKfs,
  layerRelated = false,
  replaceKfs,
}: {
  group: {
    groupId: string
    start: number
    end: number
    members: Array<{ trackId: string; kfId: string; time: number }>
  }
  duration: number
  api: SceneAPI
  selectedKfs: Set<string>
  layerRelated?: boolean
  replaceKfs: (keys: string[]) => void
}) {
  const previewKeys = useMemo(
    () =>
      group.members.map(
        (member) => [member.trackId, member.kfId] as const,
      ),
    [group.members],
  )
  useKeyframeKeysPreviewRevision(previewKeys)
  let previewStart = Infinity
  let previewEnd = -Infinity
  for (const member of group.members) {
    const previewTime = keyframeDragPreviewStore.getTime(
      member.trackId,
      member.kfId,
      member.time,
    )
    previewStart = Math.min(previewStart, previewTime)
    previewEnd = Math.max(previewEnd, previewTime)
  }
  if (previewStart === Infinity) previewStart = group.start
  if (previewEnd === -Infinity) previewEnd = group.end
  const span = previewEnd - previewStart
  const left = previewStart * PX_PER_SECOND
  const width = Math.max(2, span * PX_PER_SECOND)
  const edgeHitWidth = groupEdgeHitWidth(width)
  const memberKeys = group.members.map((m) => kfKey(m.trackId, m.kfId))
  const allSelected = memberKeys.every((key) => selectedKfs.has(key))
  const leftSelected = group.members.some(
    (m) =>
      Math.abs(m.time - group.start) < 0.001 &&
      selectedKfs.has(kfKey(m.trackId, m.kfId)),
  )
  const rightSelected = group.members.some(
    (m) =>
      Math.abs(m.time - group.end) < 0.001 &&
      selectedKfs.has(kfKey(m.trackId, m.kfId)),
  )
  const highlighted = allSelected || layerRelated
  const fill = highlighted
    ? 'var(--color-group-bar-active)'
    : leftSelected
      ? 'linear-gradient(to right, var(--color-group-bar-active), var(--color-group-bar))'
      : rightSelected
        ? 'linear-gradient(to right, var(--color-group-bar), var(--color-group-bar-active))'
        : 'var(--color-group-bar)'

  /**
   * Scale handler factory. `side` picks the dragged edge, the
   * opposite edge is the anchor. Pre-snapshots member times at
   * drag-start so each pointermove computes from a stable reference.
   */
  const onScalePointerDown =
    (side: 'left' | 'right') =>
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation()
      e.preventDefault()
      const startX = e.clientX
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      const snap = group.members.map((m) => ({ ...m }))
      const oldStart = group.start
      const oldEnd = group.end
      const oldSpan = oldEnd - oldStart
      const anchor = side === 'left' ? oldEnd : oldStart
      const drag = createKeyframeDragSession(
        api,
        snap.map((member) => ({
          trackId: member.trackId,
          kfId: member.kfId,
          startTime: member.time,
        })),
      )

      const previewAt = (ev: PointerEvent) => {
        const dx = (ev.clientX - startX) / PX_PER_SECOND
        // The dragged edge moves by dx. The anchor stays put. Compute
        // the new span and the resulting scale factor.
        let newStart = oldStart
        let newEnd = oldEnd
        if (side === 'left') {
          // Don't let the left edge cross the anchor (would invert the
          // group) or go below 0.
          newStart = clamp(oldStart + dx, 0, oldEnd - 0.01)
        } else {
          newEnd = clamp(oldEnd + dx, oldStart + 0.01, duration)
        }
        const newSpan = newEnd - newStart
        // Guard against degenerate cases: if oldSpan is ~0, scale
        // factor is undefined; just anchor everyone to the dragged
        // edge so the user can re-spread by widening the bar.
        if (oldSpan < 0.001) return
        const ratio = newSpan / oldSpan
        drag.previewTimes(
          snap.map((member) => ({
            trackId: member.trackId,
            kfId: member.kfId,
            // newTime = anchor + (oldTime - anchor) * ratio. The
            // opposite edge remains fixed and interior points stay
            // proportional.
            time: clamp(
              anchor + (member.time - anchor) * ratio,
              0,
              duration,
            ),
          })),
        )
      }
      const cleanup = () => {
        window.removeEventListener('pointermove', previewAt)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onCancel)
      }
      const onUp = (ev: PointerEvent) => {
        previewAt(ev)
        cleanup()
        drag.commit()
      }
      const onCancel = () => {
        cleanup()
        drag.cancel()
      }
      window.addEventListener('pointermove', previewAt)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onCancel)
    }

  /**
   * Body drag — uniform shift. `setPointerCapture` keeps us live even
   * if the pointer wanders outside the slim bar.
   */
  const onBodyPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).dataset.groupHandle) return
    e.stopPropagation()
    e.preventDefault()
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      const allIn = memberKeys.every((key) => selectedKfs.has(key))
      const next = new Set(selectedKfs)
      if (allIn) {
        for (const key of memberKeys) next.delete(key)
      } else {
        for (const key of memberKeys) next.add(key)
      }
      replaceKfs([...next])
      return
    }
    if (!allSelected) replaceKfs(memberKeys)
    const startX = e.clientX
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const snap = group.members.map((m) => ({ ...m }))
    const minDelta = -group.start
    const maxDelta = duration - group.end
    const drag = createKeyframeDragSession(
      api,
      snap.map((member) => ({
        trackId: member.trackId,
        kfId: member.kfId,
        startTime: member.time,
      })),
    )
    const previewAt = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / PX_PER_SECOND
      const cd = clamp(dx, minDelta, maxDelta)
      drag.preview(cd)
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', previewAt)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
    const onUp = (ev: PointerEvent) => {
      previewAt(ev)
      cleanup()
      drag.commit()
    }
    const onCancel = () => {
      cleanup()
      drag.cancel()
    }
    window.addEventListener('pointermove', previewAt)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  return (
    <div
      data-timeline-selection-surface="1"
      onPointerDown={onBodyPointerDown}
      title={`Group of ${group.members.length} keyframes · ${previewStart.toFixed(2)}s–${previewEnd.toFixed(2)}s — drag to shift, drag edges to scale`}
      className="absolute z-20 h-4 cursor-grab rounded-[4px] ring-1 hover:brightness-110"
      style={
        {
          left,
          top: 4,
          width,
          touchAction: 'none',
          background: fill,
          boxShadow:
            '0 0 0 0 color-mix(in oklab, var(--color-group-bar-ring) 60%, transparent)',
          '--tw-ring-color': 'var(--color-group-bar-ring)',
        } as React.CSSProperties
      }
    >
      <div
        data-group-handle="left"
        onPointerDown={onScalePointerDown('left')}
        className="absolute top-0 bottom-0 left-0 cursor-ew-resize rounded-l hover:bg-white/10"
        style={{ width: edgeHitWidth }}
        title="Drag to scale group's start"
      >
        <span className="absolute top-1/2 left-[5px] h-2.5 w-0.5 -translate-y-1/2 rounded-full bg-white mix-blend-overlay" />
      </div>
      <div
        data-group-handle="right"
        onPointerDown={onScalePointerDown('right')}
        className="absolute top-0 right-0 bottom-0 cursor-ew-resize rounded-r hover:bg-white/10"
        style={{ width: edgeHitWidth }}
        title="Drag to scale group's end"
      >
        <span className="absolute top-1/2 right-1 h-2.5 w-0.5 -translate-y-1/2 rounded-full bg-white mix-blend-overlay" />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inline icons
// ---------------------------------------------------------------------------

/**
 * Group glyph — a small "stack of cards" icon that sits in front of
 * the Group row's label. Reads as "this row represents a group of
 * tracks, not a single track." Sized to match the row's text height.
 */
function GroupGlyph() {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0 opacity-90"
    >
      <rect x="2.25" y="4.25" width="7.5" height="5.5" rx="1" />
      <path d="M3.5 3 L 8.5 3" />
      <path d="M4.5 1.75 L 7.5 1.75" />
    </svg>
  )
}

/**
 * Visible chevron used for the group expand/collapse button. Rotates
 * from "right-pointing" (collapsed) to "down-pointing" (expanded). The
 * earlier ▸/▾ glyphs were too small to read at 8px and disappeared
 * against the accent-soft background. This is a real SVG chevron at
 * 12px with currentColor so it picks up the accent.
 */
function Chevron({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={[
        'shrink-0 transition-transform',
        collapsed ? 'rotate-0' : 'rotate-90',
      ].join(' ')}
    >
      {/* Right-pointing chevron at rest; rotated 90° when expanded. */}
      <path d="M4.5 3 L 8 6 L 4.5 9" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function humanProperty(id: string, nodeKind?: string): string {
  // Cameras are uniform-scale, so `transform.scaleX` (the only scale
  // track we keep on cameras) should read as just "Scale" — not
  // "Scale X". Same row, different label.
  if (nodeKind === 'camera' && id === 'transform.scaleX') return 'Scale'
  // For cameras, `transform.rotation` represents Z-axis spin (roll)
  // and the rotationX / rotationY tracks make tilt and pan first-class.
  // Show the three as "Rotate X / Y / Z" so the timeline matches the
  // inspector exactly.
  if (nodeKind === 'camera' && id === 'transform.rotation') return 'Rotate Z'
  if (nodeKind === 'camera' && id === 'transform.rotationX') return 'Rotate X'
  if (nodeKind === 'camera' && id === 'transform.rotationY') return 'Rotate Y'
  // Compact the verbose PropertyId strings for the label column.
  const map: Record<string, string> = {
    'transform.x': 'X',
    'transform.y': 'Y',
    'transform.rotation': 'Rotation',
    'transform.rotationX': 'Rotate X',
    'transform.rotationY': 'Rotate Y',
    'transform.scaleX': 'Scale X',
    'transform.scaleY': 'Scale Y',
    'appearance.opacity': 'Opacity',
    'appearance.cornerRadius': 'Corner',
    'appearance.fill': 'Fill',
    'layout.gap': 'Gap',
    'layout.padding.top': 'Pad T',
    'layout.padding.right': 'Pad R',
    'layout.padding.bottom': 'Pad B',
    'layout.padding.left': 'Pad L',
    'layout.direction': 'Direction',
    'size.width': 'Width',
    'size.height': 'Height',
    'transform.z': 'Z',
    variant: 'Variant',
  }
  return map[id] ?? id
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

function normalizeTimelineWorkArea(
  range: { start: number; end: number },
  duration: number,
  minSpan: number,
): { start: number; end: number } {
  const safeDuration = Math.max(minSpan, duration)
  let start = clamp(Math.min(range.start, range.end), 0, safeDuration)
  let end = clamp(Math.max(range.start, range.end), 0, safeDuration)
  if (end - start < minSpan) {
    if (start + minSpan <= safeDuration) end = start + minSpan
    else start = Math.max(0, end - minSpan)
  }
  return { start, end }
}

/**
 * Section pill. A colored, length-bearing bar above the ruler.
 *
 *   - Drag the body  → shift both bounds by the same delta
 *   - Drag left edge → resize the start (end stays put)
 *   - Drag right edge → resize the end (start stays put)
 *   - Right-click    → rename / delete / isolate / set color
 *   - Double-click   → rename
 *   - Click          → isolate this section (one-click focus)
 *
 * Edge handles are 6 px wide, transparent unless hovered. Outer
 * cursor is grab; edges are ew-resize. All transactions write
 * through `api.setSection` which the UndoManager covers.
 */
function SectionPill({
  section,
  prev,
  next,
  api,
  duration,
  isolated,
  setIsolatedRange,
  openContextMenu,
}: {
  section: Section
  /**
   * Sorted-by-start neighbors. When the user drags an edge that's
   * shared with a neighbor, the neighbor's matching edge moves with
   * it — sections feel attached, never overlap or gap.
   */
  prev?: Section
  next?: Section
  api: SceneAPI
  duration: number
  isolated: boolean
  setIsolatedRange: (
    r: { start: number; end: number; label?: string } | null,
  ) => void
  openContextMenu: (
    menu: import('@/state/ui').ContextMenuState,
  ) => void
}) {
  const displayedSection = useSectionPreview(section)
  const left = displayedSection.start * PX_PER_SECOND
  const width = Math.max(
    2,
    (displayedSection.end - displayedSection.start) * PX_PER_SECOND,
  )

  // Neighbor-aware bounds. Sections are always attached: each one's
  // left edge can't pass its left neighbor's start (and vice versa
  // for the right edge). Within those bounds, the section can move /
  // resize freely.
  const MIN_SECTION = 0.05 // seconds — keeps neighbors from collapsing
  const leftBound = prev ? prev.start + MIN_SECTION : 0
  const rightBound = next ? next.end - MIN_SECTION : duration

  const onBodyPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button === 2) return
    if ((e.target as HTMLElement).dataset.sectionEdge) return
    e.stopPropagation()
    e.preventDefault()
    const startX = e.clientX
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    // Snapshot prev/next at drag-start so each pointermove issues a
    // consistent preview from an immutable base. A preceding commit may still
    // be held for one paint, so read that visible value before the durable prop.
    const startSection = sectionDragPreviewStore.getSection(
      section.id,
      section,
    )
    const span = startSection.end - startSection.start
    const startSec = startSection.start
    const startPrev = prev
      ? { ...sectionDragPreviewStore.getSection(prev.id, prev) }
      : null
    const startNext = next
      ? { ...sectionDragPreviewStore.getSection(next.id, next) }
      : null
    // Body drag of an attached section moves the BOUNDARIES with it.
    // Dragging right grows the right neighbor's left edge by the
    // same delta (i.e. shrinks the right neighbor); dragging left
    // shrinks the left neighbor's end by the delta. The section
    // can't drag past the neighbor's far edge minus MIN.
    const minDelta =
      (startPrev ? startPrev.start + MIN_SECTION : 0) - startSec
    const maxDelta =
      (startNext ? startNext.end - MIN_SECTION : duration) - startSec - span
    const drag = createSectionDragSession(api)
    const onMove = (ev: PointerEvent) => {
      const dx = clamp(
        (ev.clientX - startX) / PX_PER_SECOND,
        minDelta,
        maxDelta,
      )
      const newStart = startSec + dx
      const newEnd = newStart + span
      const targets: Section[] = [
        { ...startSection, start: newStart, end: newEnd },
      ]
      // Neighbors share boundaries — push their matching edges in
      // lockstep so we never gap or overlap.
      if (startPrev) {
        targets.push({ ...startPrev, end: newStart })
      }
      if (startNext) {
        targets.push({ ...startNext, start: newEnd })
      }
      drag.preview(targets)
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
    const onUp = (ev: PointerEvent) => {
      onMove(ev)
      cleanup()
      drag.commit()
    }
    const onCancel = () => {
      cleanup()
      drag.cancel()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  const onEdgePointerDown =
    (side: 'left' | 'right') => (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button === 2) return
      e.stopPropagation()
      e.preventDefault()
      const startX = e.clientX
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      // Snapshot the neighbor at drag-start. The user's mental model
      // is "I'm grabbing the boundary between two sections" — both
      // edges need to move in lockstep against a stable starting
      // pair, otherwise quick drags can race scene mutations.
      const startSection = {
        ...sectionDragPreviewStore.getSection(section.id, section),
      }
      const startNeighbor =
        side === 'left'
          ? prev
            ? { ...sectionDragPreviewStore.getSection(prev.id, prev) }
            : null
          : next
            ? { ...sectionDragPreviewStore.getSection(next.id, next) }
            : null
      const drag = createSectionDragSession(api)

      const onMove = (ev: PointerEvent) => {
        const dx = (ev.clientX - startX) / PX_PER_SECOND
        if (side === 'left') {
          // Boundary between prev and section. The boundary can't go
          // below prev.start + MIN, and can't pass section.end - MIN.
          const lo = startNeighbor ? startNeighbor.start + MIN_SECTION : 0
          const hi = startSection.end - MIN_SECTION
          const nextStart = clamp(startSection.start + dx, lo, hi)
          const targets: Section[] = [
            { ...startSection, start: nextStart },
          ]
          if (startNeighbor) {
            targets.push({ ...startNeighbor, end: nextStart })
          }
          drag.preview(targets)
        } else {
          // Boundary between section and next. Mirror.
          const lo = startSection.start + MIN_SECTION
          const hi = startNeighbor
            ? startNeighbor.end - MIN_SECTION
            : duration
          const nextEnd = clamp(startSection.end + dx, lo, hi)
          const targets: Section[] = [{ ...startSection, end: nextEnd }]
          if (startNeighbor) {
            targets.push({ ...startNeighbor, start: nextEnd })
          }
          drag.preview(targets)
        }
      }
      const cleanup = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onCancel)
      }
      const onUp = (ev: PointerEvent) => {
        onMove(ev)
        cleanup()
        drag.commit()
      }
      const onCancel = () => {
        cleanup()
        drag.cancel()
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onCancel)
    }
  // Reference both bounds even if a refactor temporarily removes use,
  // so the linter's no-unused-vars doesn't flag them. They're surfaced
  // in cursor / hover tooltips below.
  void leftBound
  void rightBound

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    openContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: isolated ? 'Exit isolation' : `Isolate "${section.name}"`,
          onClick: () => {
            if (isolated) setIsolatedRange(null)
            else
              setIsolatedRange({
                start: section.start,
                end: section.end,
                label: section.name,
              })
          },
        },
        {
          label: 'Rename',
          onClick: () => {
            const next = window.prompt('Chapter name', section.name)
            if (next != null) api.setSection({ ...section, name: next })
          },
        },
        {
          label: 'Set color…',
          onClick: () => {
            const next = window.prompt(
              'Chapter color (CSS color string)',
              section.color,
            )
            if (next != null) api.setSection({ ...section, color: next })
          },
        },
        { kind: 'separator' as const },
        {
          label: 'Delete chapter',
          danger: true,
          onClick: () => api.deleteSection(section.id),
        },
      ],
    })
  }

  const toggleIsolate = () => {
    setIsolatedRange(
      isolated
        ? null
        : { start: section.start, end: section.end, label: section.name },
    )
  }

  return (
    <div
      onPointerDown={onBodyPointerDown}
      onDoubleClick={() => {
        const next = window.prompt('Chapter name', section.name)
        if (next != null) api.setSection({ ...section, name: next })
      }}
      onContextMenu={onContextMenu}
      title={`${displayedSection.name} · ${displayedSection.start.toFixed(2)}s → ${displayedSection.end.toFixed(
        2,
      )}s — drag to move, edges to resize, click the focus icon to isolate, right-click for more`}
      className={[
        'absolute top-1/2 flex h-5 -translate-y-1/2 cursor-grab items-center gap-1.5 overflow-hidden rounded-full pr-1 pl-2.5 select-none',
        isolated ? 'ring-2 ring-white/80' : '',
      ].join(' ')}
      style={{
        left,
        width,
        background: displayedSection.color,
        color: 'white',
      }}
    >
      <span className="flex-1 truncate text-[11px] font-medium">
        {displayedSection.name}
      </span>
      {/* Isolate toggle. Sits on the right end of the pill so it
          doesn't compete with the label for left-side real estate.
          stopPropagation on pointerdown AND click so it never
          accidentally arms the body's drag-to-move handler. */}
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          toggleIsolate()
        }}
        title={isolated ? 'Exit isolation (Esc)' : 'Isolate this section'}
        className={[
          'flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-colors',
          isolated
            ? 'bg-white text-black hover:brightness-90'
            : 'bg-white/20 text-white hover:bg-white/40',
        ].join(' ')}
      >
        <IsolateGlyph filled={isolated} />
      </button>
      {/* Edge resize handles. Transparent until hovered so the pill
          reads as one shape; cursor flips to ew-resize on the
          handles only. */}
      <div
        data-section-edge="left"
        onPointerDown={onEdgePointerDown('left')}
        className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-white/30"
      />
      <div
        data-section-edge="right"
        onPointerDown={onEdgePointerDown('right')}
        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-white/30"
      />
    </div>
  )
}

/**
 * Focus-frame glyph used by the isolate button. Outlined when idle,
 * filled center when the section is currently isolated — gives the
 * user clear "you are here" feedback.
 */
function IsolateGlyph({ filled }: { filled: boolean }) {
  return (
    <svg
      width={10}
      height={10}
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.25}
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Four corner brackets — classic "focus / crop" glyph. */}
      <path d="M1 3 V 1 H 3" />
      <path d="M7 1 H 9 V 3" />
      <path d="M9 7 V 9 H 7" />
      <path d="M3 9 H 1 V 7" />
      {filled && (
        <rect
          x="3.5"
          y="3.5"
          width="3"
          height="3"
          fill="currentColor"
          stroke="none"
        />
      )}
    </svg>
  )
}

/**
 * Snap threshold in pixels. Designers from After Effects / Premiere
 * expect snap distance to feel zoom-consistent — at 80 px/sec the
 * effective range is ~75 ms, at 320 px/sec it's ~19 ms. The snap
 * uses the live PX_PER_SECOND so a single threshold value works
 * across all zoom levels.
 */
const SNAP_THRESHOLD_PX = 6

/**
 * Snap `time` to the nearest other keyframe time within
 * `SNAP_THRESHOLD_PX` of screen distance, ignoring any keys in
 * `excludeKeys`. Returns the snapped time, or `time` unchanged if
 * the user is holding Alt (snap-disable) or no candidate is in
 * range.
 *
 * Symmetric: snaps both forward and backward to whichever neighbor
 * is closer. Markers also count as snap targets — designers expect
 * to snap a keyframe to a section boundary.
 */
function snapTime(
  time: number,
  flatTracks: Track[],
  excludeKeys: Set<string>,
  altHeld: boolean,
  markerTimes: number[] = [],
): number {
  if (altHeld) return time
  const thresholdSec = SNAP_THRESHOLD_PX / Math.max(1, PX_PER_SECOND)
  let best = time
  let bestDist = thresholdSec
  for (const t of flatTracks) {
    for (const kf of t.keyframes) {
      if (excludeKeys.has(kfKey(t.id, kf.id))) continue
      const d = Math.abs(kf.time - time)
      if (d < bestDist) {
        bestDist = d
        best = kf.time
      }
    }
  }
  for (const mt of [...markerTimes, ...BEAT_SNAP_TIMES]) {
    const d = Math.abs(mt - time)
    if (d < bestDist) {
      bestDist = d
      best = mt
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// Transport icons. Inline SVG so we don't pull in an icon package for four
// glyphs. Sized to fit a 7×7 button (h-7 w-7) at 16px, currentColor fill.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Duration control — lets the user set the total scene duration without
// leaving the timeline. Mirrors Jitter / After Effects: the total comp
// length is scene-level metadata, but it's edited right where the ruler
// that depends on it lives. Step buttons bump by one second; the text
// field accepts a direct number, committing on blur / Enter.
// ---------------------------------------------------------------------------

function DurationControl({
  duration,
  onChange,
}: {
  duration: number
  onChange: (next: number) => void
}) {
  const nudge = (delta: number) => onChange(Math.max(0.1, duration + delta))
  const onInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const n = parseFloat(e.currentTarget.value)
    if (Number.isFinite(n)) onChange(n)
  }
  return (
    // Compact duration control — sits next to the playhead readout
    // in the unified time group. No wrapping label ("Duration") here:
    // the slash separator + playhead-time-on-the-left already say
    // "this is the comp's total length." The -/+ buttons stay for
    // quick nudging without grabbing the field.
    <div className="flex items-center gap-1">
      <button
        onClick={() => nudge(-1)}
        className="flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-panel hover:text-text"
        title="−1 second"
      >
        −
      </button>
      <div className="flex items-center rounded border border-border bg-panel px-2 font-mono text-[11px] text-text">
        <input
          type="number"
          min={0.1}
          step={0.5}
          value={Number.isFinite(duration) ? duration.toFixed(2) : ''}
          onChange={onInput}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
          }}
          className="h-6 w-14 bg-transparent text-right outline-none tabular-nums"
        />
        <span className="ml-0.5 text-text-dim">s</span>
      </div>
      <button
        onClick={() => nudge(1)}
        className="flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-panel hover:text-text"
        title="+1 second"
      >
        +
      </button>
    </div>
  )
}

function TransportIcon({ kind }: { kind: 'start' | 'play' | 'pause' | 'end' }) {
  const common = {
    width: 12,
    height: 12,
    viewBox: '0 0 12 12',
    fill: 'currentColor',
  } as const
  if (kind === 'play') {
    return (
      <svg {...common}>
        <path d="M3 1.5l7 4.5-7 4.5z" />
      </svg>
    )
  }
  if (kind === 'pause') {
    return (
      <svg {...common}>
        <rect x="2.5" y="2" width="2.5" height="8" rx="0.4" />
        <rect x="7" y="2" width="2.5" height="8" rx="0.4" />
      </svg>
    )
  }
  if (kind === 'start') {
    return (
      <svg {...common}>
        <rect x="2" y="2" width="1.5" height="8" rx="0.4" />
        <path d="M11 1.5l-7 4.5 7 4.5z" />
      </svg>
    )
  }
  // end
  return (
    <svg {...common}>
      <path d="M1 1.5l7 4.5-7 4.5z" />
      <rect x="8.5" y="2" width="1.5" height="8" rx="0.4" />
    </svg>
  )
}
