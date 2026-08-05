// SPDX-License-Identifier: Apache-2.0

import {
  Music2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Upload,
  Volume2,
  VolumeX,
} from 'lucide-react'
import {
  useCallback,
  useMemo,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  editMasterAudioClip,
  isMasterAudioNode,
  masterAudioClipDuration,
  type MasterAudioEditMode,
  type MasterAudioNode,
} from '@/audio/masterAudio'
import { useProjectAPI } from '@/project'
import { useSceneAPI, useSceneVersion } from '@/scene'
import {
  resizeSequenceOccurrenceOut,
  type ResolvedSequenceItem,
} from '@/sequence'
import { useUI } from '@/state/ui'
import { importAudioFile } from '@/ui/importMedia'

const LABEL_COLUMN_WIDTH = 184
const MIN_PIXELS_PER_SECOND = 72
const SCENE_TRACK_HEIGHT = 88
const MASTER_AUDIO_ROW_HEIGHT = 36

/**
 * Master sequence timeline.
 *
 * Composition keyframes remain on the scene timeline. This strip visualizes
 * the assembled movie: scene occurrences, overlaps, transitions and the
 * master playhead. It deliberately uses sequence time instead of rewriting
 * scene-local keyframes when cards are reordered.
 */
export function MasterTimeline() {
  const version = useSceneVersion()
  const api = useSceneAPI()
  const project = useProjectAPI()
  const map = useMemo(
    () => project.getSequenceTimeMap(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project, version],
  )
  const timelineHeight = useUI((state) => state.timelineHeight)
  const setTimelineHeight = useUI((state) => state.setTimelineHeight)
  const playing = useUI((state) => state.playing)
  const setPlaying = useUI((state) => state.setPlaying)
  const setPlayhead = useUI((state) => state.setPlayhead)
  const setPreviewScope = useUI((state) => state.setPreviewScope)
  const setProgramSequencePosition = useUI(
    (state) => state.setProgramSequencePosition,
  )
  const selection = useUI((state) => state.selection)
  const setSelection = useUI((state) => state.setSelection)
  const setInspectorMode = useUI((state) => state.setInspectorMode)
  const stripRef = useRef<HTMLDivElement>(null)
  const audioInputRef = useRef<HTMLInputElement>(null)
  const pixelsPerSecond = Math.max(
    MIN_PIXELS_PER_SECOND,
    useUI((state) => state.timelinePxPerSecond),
  )
  const masterAudio = useMemo(() => {
    const clips: MasterAudioNode[] = []
    for (const id of api.getAllNodeIds()) {
      const node = api.getNode(id)
      if (isMasterAudioNode(node)) clips.push(node)
    }
    return clips.sort((a, b) => a.startTime - b.startTime)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, version])
  const contentDuration = Math.max(
    map.duration,
    ...masterAudio.map(
      (node) => node.startTime + masterAudioClipDuration(node),
    ),
  )
  const width = Math.max(480, contentDuration * pixelsPerSecond)
  const contentHeight =
    SCENE_TRACK_HEIGHT +
    Math.max(1, masterAudio.length) * MASTER_AUDIO_ROW_HEIGHT

  const selectMasterAudio = useCallback(
    (nodeId: string) => {
      setPlaying(false)
      setPreviewScope('sequence')
      setSelection([nodeId])
      setInspectorMode('properties')
    },
    [
      setInspectorMode,
      setPlaying,
      setPreviewScope,
      setSelection,
    ],
  )

  const importMasterAudio = useCallback(
    async (files: FileList | null) => {
      if (!files?.length) return
      const imported: string[] = []
      for (const file of Array.from(files)) {
        try {
          imported.push(await importAudioFile(file, api, null))
        } catch (error) {
          console.warn('[master-audio] import failed', file.name, error)
        }
      }
      if (imported.length === 0) return
      setPlaying(false)
      setPreviewScope('sequence')
      setSelection(imported)
      setInspectorMode('properties')
    },
    [
      api,
      setInspectorMode,
      setPlaying,
      setPreviewScope,
      setSelection,
    ],
  )

  const beginMasterAudioEdit = useCallback(
    (
      event: ReactPointerEvent<HTMLElement>,
      node: MasterAudioNode,
      mode: MasterAudioEditMode,
    ) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      selectMasterAudio(node.id)
      const startClientX = event.clientX
      const snapshot = {
        duration: node.duration,
        playbackRate: node.playbackRate,
        startTime: node.startTime,
        trimStart: node.trimStart,
        trimEnd: node.trimEnd,
      }
      const onMove = (move: PointerEvent) => {
        const next = editMasterAudioClip(
          snapshot,
          mode,
          (move.clientX - startClientX) / pixelsPerSecond,
          map.duration,
          map.frameRate,
        )
        api.doc.transact(() => {
          api.setNodeProperty(node.id, 'startTime', next.startTime)
          api.setNodeProperty(node.id, 'trimStart', next.trimStart)
          api.setNodeProperty(node.id, 'trimEnd', next.trimEnd)
        }, 'master-audio-edit')
      }
      const cleanup = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
      }
      const onUp = () => cleanup()
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    [
      api,
      map.duration,
      map.frameRate,
      pixelsPerSecond,
      selectMasterAudio,
    ],
  )

  const beginOccurrenceOutResize = useCallback(
    (
      event: ReactPointerEvent<HTMLElement>,
      resolved: ResolvedSequenceItem,
    ) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      setPlaying(false)
      const startClientX = event.clientX
      const initialSourceEnd = resolved.sourceEnd
      const onMove = (move: PointerEvent) => {
        const requestedSourceEnd =
          initialSourceEnd +
          (move.clientX - startClientX) / pixelsPerSecond
        project.updateSequenceItem(
          resolved.item.id,
          resizeSequenceOccurrenceOut(
            resolved,
            requestedSourceEnd,
            map.frameRate,
          ),
        )
      }
      const cleanup = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
      }
      const onUp = () => cleanup()
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    [
      map.frameRate,
      pixelsPerSecond,
      project,
      setPlaying,
    ],
  )

  const seekFromClientX = useCallback(
    (clientX: number) => {
      const element = stripRef.current
      if (!element) return
      const rect = element.getBoundingClientRect()
      const time = clamp(
        (clientX - rect.left + element.scrollLeft) / pixelsPerSecond,
        0,
        map.duration,
      )
      setPreviewScope('sequence')
      setPlayhead(time)
    },
    [map.duration, pixelsPerSecond, setPlayhead, setPreviewScope],
  )

  const onScrubPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    setPlaying(false)
    seekFromClientX(event.clientX)
    const element = event.currentTarget
    element.setPointerCapture(event.pointerId)
    const onMove = (move: PointerEvent) => seekFromClientX(move.clientX)
    const onUp = (up: PointerEvent) => {
      try {
        element.releasePointerCapture(up.pointerId)
      } catch {
        // Pointer capture can already be released if the window loses focus.
      }
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  const onResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    const startY = event.clientY
    const startHeight = timelineHeight
    const onMove = (move: PointerEvent) =>
      setTimelineHeight(startHeight - (move.clientY - startY))
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  return (
    <section
      className="relative flex shrink-0 flex-col border-t border-border bg-panel"
      style={{ height: timelineHeight }}
      data-master-timeline="1"
    >
      <div
        onPointerDown={onResizePointerDown}
        className="absolute top-0 right-0 left-0 z-30 h-1 -translate-y-1/2 cursor-ns-resize hover:bg-accent/50"
        title="Drag to resize timeline"
      />

      <div className="hm-chrome-bar flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <span className="rounded-[var(--radius-control)] bg-accent-soft px-2 py-1 text-[10px] font-semibold text-accent">
          Master
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title="Go to sequence start"
            onClick={() => {
              setPlaying(false)
              setPlayhead(0)
              setProgramSequencePosition(null, null)
            }}
            className="hm-icon-button h-7 w-7"
          >
            <SkipBack size={13} />
          </button>
          <button
            type="button"
            data-transport-toggle="1"
            aria-label={
              playing ? 'Pause master sequence' : 'Play master sequence'
            }
            title={
              playing ? 'Pause master sequence' : 'Play master sequence'
            }
            onClick={() => {
              setPreviewScope('sequence')
              if (!playing && useUI.getState().playhead >= map.duration) {
                setPlayhead(0)
              }
              setPlaying(!playing)
            }}
            className="hm-icon-button h-7 w-7 bg-accent-soft text-accent hover:bg-accent-soft hover:brightness-110"
          >
            {playing ? <Pause size={13} /> : <Play size={13} />}
          </button>
          <button
            type="button"
            title="Go to sequence end"
            onClick={() => {
              setPlaying(false)
              setPreviewScope('sequence')
              setPlayhead(map.duration)
            }}
            className="hm-icon-button h-7 w-7"
          >
            <SkipForward size={13} />
          </button>
        </div>
        <MasterTimeReadout duration={map.duration} frameRate={map.frameRate} />
        <div className="flex-1" />
        <input
          ref={audioInputRef}
          type="file"
          accept="audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.oga,.opus"
          multiple
          hidden
          onChange={(event) => {
            void importMasterAudio(event.target.files)
            event.target.value = ''
          }}
        />
        <button
          type="button"
          onClick={() => audioInputRef.current?.click()}
          className="hm-secondary-action h-7 px-2"
          title="Import a soundtrack on the Master timeline"
        >
          <Upload size={11} />
          Add audio
        </button>
        <span className="text-[10px] text-text-dim">
          {map.items.length} scenes
        </span>
        <span className="font-mono text-[10px] tabular-nums text-text-muted">
          {map.duration.toFixed(2)}s
        </span>
      </div>

      <div className="flex h-7 shrink-0 border-b border-border bg-panel">
        <div
          className="flex shrink-0 items-center border-r border-border px-3 text-[10px] font-medium text-text-dim"
          style={{ width: LABEL_COLUMN_WIDTH }}
        >
          Sequence
        </div>
        <div className="relative min-w-0 flex-1 overflow-hidden">
          <div
            className="relative h-full"
            style={{ width }}
            onPointerDown={onScrubPointerDown}
          >
            <MasterRuler
              duration={map.duration}
              pixelsPerSecond={pixelsPerSecond}
            />
            <MasterPlayheadLine pixelsPerSecond={pixelsPerSecond} rulerOnly />
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex" style={{ minHeight: contentHeight }}>
          <div
            className="shrink-0 border-r border-border bg-panel"
            style={{ width: LABEL_COLUMN_WIDTH, minHeight: contentHeight }}
          >
            <div
              className="border-b border-border px-3 py-3"
              style={{ height: SCENE_TRACK_HEIGHT }}
            >
              <div className="text-[10px] font-medium text-text">
                Scene assembly
              </div>
              <div className="mt-1 text-[9px] leading-4 text-text-dim">
                Drag scene ends to trim. The speaker controls the Master
                soundtrack for each occurrence.
              </div>
            </div>
            <div className="flex min-h-9 items-center gap-2 px-3">
              <Music2 size={12} className="shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[10px] font-medium text-text">
                  Master audio
                </div>
                <div className="font-mono text-[8px] text-text-dim">
                  {masterAudio.length
                    ? `${masterAudio.length} soundtrack${masterAudio.length === 1 ? '' : 's'}`
                    : 'No soundtrack'}
                </div>
              </div>
              <button
                type="button"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-text-muted hover:bg-panel-raised hover:text-text"
                title="Import Master audio"
                aria-label="Import Master audio"
                onClick={() => audioInputRef.current?.click()}
              >
                <Upload size={11} />
              </button>
            </div>
          </div>
          <div
            ref={stripRef}
            className="relative min-w-0 flex-1 overflow-x-auto bg-app-bg"
            onPointerDown={onScrubPointerDown}
          >
            <div
              className="relative"
              style={{ width, minHeight: contentHeight }}
            >
              <div className="absolute inset-0 bg-[linear-gradient(to_right,color-mix(in_oklab,var(--color-border)_45%,transparent)_1px,transparent_1px)] [background-size:72px_100%]" />
              <div
                className="pointer-events-none absolute right-0 left-0 border-t border-border/70"
                style={{ top: SCENE_TRACK_HEIGHT }}
              />
              {Array.from({
                length: Math.max(1, masterAudio.length),
              }).map((_, index) => (
                <div
                  key={`audio-row-${index}`}
                  className="pointer-events-none absolute right-0 left-0 border-b border-border/35"
                  style={{
                    top:
                      SCENE_TRACK_HEIGHT +
                      (index + 1) * MASTER_AUDIO_ROW_HEIGHT,
                  }}
                />
              ))}
              {map.items.map((resolved, index) => {
                const left = resolved.masterStart * pixelsPerSecond
                const itemWidth = Math.max(
                  36,
                  resolved.duration * pixelsPerSecond,
                )
                const transitionWidth =
                  resolved.transitionOut * pixelsPerSecond
                const soundtrackMuted =
                  resolved.item.masterAudioMuted ?? false
                const selectOccurrence = () => {
                  setPlaying(false)
                  setPreviewScope('sequence')
                  setPlayhead(resolved.masterStart)
                  setProgramSequencePosition(
                    resolved.item.id,
                    resolved.scene.id,
                  )
                }
                return (
                  <div
                    key={resolved.item.id}
                    role="button"
                    tabIndex={0}
                    onClick={(event) => {
                      event.stopPropagation()
                      selectOccurrence()
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter') return
                      event.preventDefault()
                      selectOccurrence()
                    }}
                    className={[
                      'absolute top-2 h-[58px] overflow-hidden rounded-md border text-left shadow-sm transition-colors',
                      index % 2 === 0
                        ? 'border-accent/55 bg-accent-soft/65 hover:border-accent'
                        : 'border-[oklch(0.72_0.14_205)]/55 bg-[oklch(0.72_0.14_205)]/15 hover:border-[oklch(0.72_0.14_205)]',
                    ].join(' ')}
                    style={{ left, width: itemWidth, zIndex: index + 1 }}
                    data-master-scene={resolved.scene.id}
                  >
                    <span className="absolute top-1.5 left-1.5 flex h-4 min-w-4 items-center justify-center rounded bg-black/25 px-1 font-mono text-[8px] text-text">
                      {index + 1}
                    </span>
                    <span className="absolute top-1.5 right-1.5 font-mono text-[8px] text-text-dim">
                      {resolved.duration.toFixed(2)}s
                    </span>
                    <span className="absolute right-7 bottom-2 left-2 truncate text-[10px] font-semibold text-text">
                      {resolved.scene.name}
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      aria-pressed={soundtrackMuted}
                      className={[
                        'absolute right-2 bottom-1.5 z-20 flex h-5 w-5 items-center justify-center rounded',
                        soundtrackMuted
                          ? 'bg-red-500/15 text-red-300'
                          : 'bg-black/20 text-text-muted hover:text-text',
                      ].join(' ')}
                      title={
                        soundtrackMuted
                          ? `Restore Master audio in ${resolved.scene.name}`
                          : `Mute Master audio in ${resolved.scene.name}`
                      }
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation()
                        project.updateSequenceItem(resolved.item.id, {
                          masterAudioMuted: !soundtrackMuted,
                        })
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return
                        event.preventDefault()
                        event.stopPropagation()
                        project.updateSequenceItem(resolved.item.id, {
                          masterAudioMuted: !soundtrackMuted,
                        })
                      }}
                    >
                      {soundtrackMuted ? (
                        <VolumeX size={11} />
                      ) : (
                        <Volume2 size={11} />
                      )}
                    </span>
                    {transitionWidth > 0 ? (
                      <span
                        className="absolute top-0 right-0 h-full border-l border-white/20 bg-[repeating-linear-gradient(135deg,rgba(255,255,255,0.12),rgba(255,255,255,0.12)_3px,transparent_3px,transparent_6px)]"
                        style={{ width: transitionWidth }}
                        title={`${resolved.transitionOut.toFixed(2)}s crossfade`}
                      />
                    ) : null}
                    <span
                      className="absolute top-0 right-0 z-10 h-full w-2 cursor-ew-resize border-r-2 border-transparent hover:border-white/70 hover:bg-white/10"
                      title={`Drag to change ${resolved.scene.name} occurrence length`}
                      data-master-out-handle={resolved.item.id}
                      onClick={(event) => event.stopPropagation()}
                      onPointerDown={(event) =>
                        beginOccurrenceOutResize(event, resolved)
                      }
                    />
                  </div>
                )
              })}
              {map.transitions.map((transition) => (
                <div
                  key={`${transition.fromItemId}:${transition.toItemId}`}
                  className="pointer-events-none absolute top-[69px] h-3 rounded-full border border-white/15 bg-white/5 px-1.5 text-[7px] font-semibold uppercase tracking-[0.06em] text-text-muted"
                  style={{
                    left: transition.start * pixelsPerSecond,
                    width: Math.max(
                      28,
                      transition.duration * pixelsPerSecond,
                    ),
                  }}
                >
                  Blend
                </div>
              ))}
              {masterAudio.map((node, index) => (
                <MasterAudioClip
                  key={node.id}
                  node={node}
                  index={index}
                  pixelsPerSecond={pixelsPerSecond}
                  selected={selection.includes(node.id)}
                  onSelect={() => selectMasterAudio(node.id)}
                  onToggleMute={() =>
                    api.setNodeProperty(node.id, 'muted', !node.muted)
                  }
                  onBeginEdit={(event, mode) =>
                    beginMasterAudioEdit(event, node, mode)
                  }
                />
              ))}
              {masterAudio.length === 0 ? (
                <button
                  type="button"
                  className="absolute flex h-7 items-center gap-1.5 rounded border border-dashed border-border px-3 text-[9px] text-text-dim hover:border-accent/50 hover:text-text"
                  style={{ top: SCENE_TRACK_HEIGHT + 4, left: 8 }}
                  onClick={(event) => {
                    event.stopPropagation()
                    audioInputRef.current?.click()
                  }}
                >
                  <Music2 size={11} />
                  Add Master soundtrack
                </button>
              ) : null}
              <MasterPlayheadLine pixelsPerSecond={pixelsPerSecond} />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function MasterAudioClip({
  node,
  index,
  pixelsPerSecond,
  selected,
  onSelect,
  onToggleMute,
  onBeginEdit,
}: {
  node: MasterAudioNode
  index: number
  pixelsPerSecond: number
  selected: boolean
  onSelect: () => void
  onToggleMute: () => void
  onBeginEdit: (
    event: ReactPointerEvent<HTMLElement>,
    mode: MasterAudioEditMode,
  ) => void
}) {
  const duration = masterAudioClipDuration(node)
  const width = Math.max(24, duration * pixelsPerSecond)
  const left = Math.max(0, node.startTime) * pixelsPerSecond
  const beatSpacing =
    node.beatGrid && node.beatGrid.bpm > 0
      ? ((60 / node.beatGrid.bpm) / Math.max(0.05, node.playbackRate)) *
        pixelsPerSecond
      : 0
  const beatOffset =
    node.beatGrid && beatSpacing > 0
      ? (((node.beatGrid.firstBeatTime - node.trimStart) /
          Math.max(0.05, node.playbackRate)) *
          pixelsPerSecond) %
        beatSpacing
      : 0

  return (
    <div
      role="button"
      tabIndex={0}
      aria-selected={selected}
      data-master-audio={node.id}
      className={[
        'absolute h-7 cursor-grab overflow-hidden rounded border shadow-sm active:cursor-grabbing',
        node.muted
          ? 'border-border-strong bg-panel-raised text-text-muted'
          : 'border-accent/65 bg-accent-soft text-accent',
        selected ? 'ring-1 ring-accent ring-offset-1 ring-offset-app-bg' : '',
      ].join(' ')}
      style={{
        top: SCENE_TRACK_HEIGHT + index * MASTER_AUDIO_ROW_HEIGHT + 4,
        left,
        width,
        backgroundImage:
          beatSpacing > 0
            ? 'linear-gradient(to right, color-mix(in oklab, currentColor 24%, transparent) 1px, transparent 1px)'
            : undefined,
        backgroundSize:
          beatSpacing > 0 ? `${Math.max(2, beatSpacing)}px 100%` : undefined,
        backgroundPositionX:
          beatSpacing > 0 ? `${beatOffset}px` : undefined,
      }}
      title={`${node.name} · ${duration.toFixed(2)}s · drag to move, drag edges to trim`}
      onClick={(event) => {
        event.stopPropagation()
        onSelect()
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return
        event.preventDefault()
        onSelect()
      }}
      onPointerDown={(event) => onBeginEdit(event, 'move')}
    >
      <span
        className="absolute top-0 bottom-0 left-0 z-20 w-2 cursor-ew-resize rounded-l hover:bg-white/15"
        data-master-audio-trim="start"
        onPointerDown={(event) => onBeginEdit(event, 'trim-start')}
      />
      <span
        className="absolute top-0 right-0 bottom-0 z-20 w-2 cursor-ew-resize rounded-r hover:bg-white/15"
        data-master-audio-trim="end"
        onPointerDown={(event) => onBeginEdit(event, 'trim-end')}
      />
      <span
        role="button"
        tabIndex={0}
        aria-pressed={node.muted}
        className="absolute top-0 bottom-0 left-2 z-10 flex w-5 items-center justify-center rounded hover:bg-black/15"
        title={node.muted ? `Unmute ${node.name}` : `Mute ${node.name}`}
        onPointerDown={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onClick={(event) => {
          event.stopPropagation()
          onToggleMute()
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          event.stopPropagation()
          onToggleMute()
        }}
      >
        {node.muted ? <VolumeX size={11} /> : <Volume2 size={11} />}
      </span>
      <span className="pointer-events-none absolute inset-y-0 right-7 left-8 flex min-w-0 items-center gap-1.5">
        <Music2 size={10} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate text-[9px] font-semibold">
          {node.name}
        </span>
        {node.beatGrid ? (
          <span className="shrink-0 rounded bg-black/15 px-1 font-mono text-[7px] tabular-nums">
            {node.beatGrid.bpm.toFixed(1)} BPM
          </span>
        ) : null}
      </span>
      <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center font-mono text-[7px] tabular-nums opacity-75">
        {duration.toFixed(1)}s
      </span>
    </div>
  )
}

function MasterTimeReadout({
  duration,
  frameRate,
}: {
  duration: number
  frameRate: number
}) {
  const playhead = useUI((state) => state.playhead)
  const frame = Math.round(clamp(playhead, 0, duration) * frameRate)
  return (
    <span className="rounded border border-border bg-panel px-2 py-1 font-mono text-[9px] tabular-nums text-text-muted">
      {clamp(playhead, 0, duration).toFixed(2)}s · f{frame}
    </span>
  )
}

function MasterPlayheadLine({
  pixelsPerSecond,
  rulerOnly = false,
}: {
  pixelsPerSecond: number
  rulerOnly?: boolean
}) {
  const playhead = useUI((state) => state.playhead)
  return (
    <div
      className={[
        'pointer-events-none absolute top-0 z-20 w-px bg-playhead',
        rulerOnly ? 'h-full' : 'h-full',
      ].join(' ')}
      style={{ left: Math.max(0, playhead * pixelsPerSecond) }}
    >
      {!rulerOnly ? (
        <span className="absolute -top-0.5 -left-1 h-2 w-2 rotate-45 bg-playhead" />
      ) : null}
    </div>
  )
}

function MasterRuler({
  duration,
  pixelsPerSecond,
}: {
  duration: number
  pixelsPerSecond: number
}) {
  const ticks = []
  const step = pixelsPerSecond >= 120 ? 0.5 : pixelsPerSecond >= 60 ? 1 : 2
  for (let time = 0; time <= duration + 0.0001; time += step) {
    ticks.push(
      <span
        key={time}
        className="absolute top-0 h-full border-l border-border/70 pl-1 font-mono text-[8px] text-text-dim"
        style={{ left: time * pixelsPerSecond }}
      >
        {time.toFixed(step < 1 ? 1 : 0)}s
      </span>,
    )
  }
  return <>{ticks}</>
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}
