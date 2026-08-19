// SPDX-License-Identifier: Apache-2.0

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  EXPORT_FORMATS,
  EXPORT_QUALITIES,
  exportScene,
  useExportProgress,
  type ExportFormat,
  type ExportFormatId,
  type ExportQualityId,
  type ExportRange,
} from '@/export'
import {
  chooseExportDirectory,
  getDefaultExportDirectory,
  sanitizeExportTitle,
  writeExportBlob,
} from '@/export/destination'
import { useSceneAPI, useSceneVersion } from '@/scene'
import { useUI } from '@/state/ui'
import { useProjectAPI } from '@/project'
import { parseTimeExpression } from '@/ui/fields/timeExpression'
import { SelectField } from '@/ui/fields/SelectField'

/**
 * Export popover (spec sheet layout).
 *
 * Aligned label column on the left, control column on the right. Every
 * row reads as `Property → control`, the same shape Google AI Studio
 * uses for video settings, Fireflies for downloads, and Anthropic-side
 * settings dialogs in general. The previous "matrix of chips +
 * cosmetic chapter strip" layout was redrawn here — same data, calmer
 * presentation.
 *
 * Pipeline note: format choice is just MP4 / WebM / GIF now. The
 * previous "MP4 · Fast" vs "MP4 · HQ" split has been removed because
 * both routes use the same captureRect → WebCodecs pipeline today; the
 * Fast/HQ trade-off is genuinely controlled by the Resolution chip
 * (Comp = fast, 4K = HQ). One less knob to explain.
 *
 * Rows:
 *   1. Format     — segmented [MP4 · WebM · GIF]
 *   2. Resolution — segmented [Comp · 720p · 2K · 4K]
 *   3. Frame rate — segmented [24 · 30 · 60]
 *   4. Range      — segmented [Full · Chapter · Custom]
 *                   then a sub-row that depends on the mode:
 *                     Full     → just the resolved time/frame readout
 *                     Chapter  → chapter dropdown + readout
 *                     Custom   → Start / End / Frames numeric inputs
 *
 * The footer carries the resolved filename + dimensions on the left
 * and Cancel / Export buttons on the right.
 */

type FpsId = 24 | 30 | 60
type RangeMode = 'full' | 'chapter' | 'work' | 'custom'
type ExportScope = 'scene' | 'sequence'

const PANEL_WIDTH = 480
const LABEL_COL = 88

export function ExportMenu({
  anchorRect,
  onClose,
}: {
  anchorRect: DOMRect
  onClose: () => void
}) {
  const api = useSceneAPI()
  const version = useSceneVersion()
  const project = useProjectAPI()
  const isolatedRange = useUI((s) => s.isolatedRange)
  const workAreaRange = useUI((s) => s.workAreaRange)
  const selectedSequenceItemId = useUI((s) => s.selectedSequenceItemId)
  const exportPhase = useExportProgress((s) => s.phase)
  const exportRunning =
    exportPhase === 'rendering' || exportPhase === 'encoding'

  void version
  const meta = api.getMeta()
  const sections = api.getSections()
  const sequenceMap = useMemo(
    () => project.getSequenceTimeMap(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project, version],
  )
  const activeComposition = project.getActiveScene()
  const compositions = useMemo(
    () => project.getScenes(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project, version],
  )
  const hasSequence = sequenceMap.items.length > 1
  const [exportScope, setExportScope] = useState<ExportScope>(() =>
    hasSequence ? 'sequence' : 'scene',
  )
  const [compositionSceneId, setCompositionSceneId] = useState(
    () => activeComposition?.id ?? compositions[0]?.id ?? '',
  )
  const selectedComposition =
    compositions.find((composition) => composition.id === compositionSceneId) ??
    activeComposition ??
    compositions[0] ??
    null
  const selectedCompositionIsActive =
    selectedComposition?.id === activeComposition?.id
  const exportDuration =
    exportScope === 'sequence'
      ? sequenceMap.duration
      : selectedComposition?.duration ?? meta.duration
  const exportName =
    exportScope === 'scene'
      ? selectedComposition?.name ?? meta.name
      : meta.name
  const exportWorkArea =
    exportScope === 'scene'
      ? selectedComposition?.workArea ??
        (selectedCompositionIsActive ? workAreaRange : null)
      : null
  const bridge =
    typeof window === 'undefined' ? undefined : window.hypermotion
  const [exportTitleState, setExportTitleState] = useState(() => ({
    sourceName: exportName,
    value: sanitizeExportTitle(exportName),
  }))
  const exportTitle =
    exportTitleState.sourceName === exportName
      ? exportTitleState.value
      : sanitizeExportTitle(exportName)
  const setExportTitle = (value: string) => {
    setExportTitleState({ sourceName: exportName, value })
  }
  const [folderPath, setFolderPath] = useState('')
  const [folderPending, setFolderPending] = useState(Boolean(bridge))

  useEffect(() => {
    if (!bridge) return
    let active = true
    void getDefaultExportDirectory(bridge)
      .then((directory) => {
        if (active) setFolderPath(directory)
      })
      .finally(() => {
        if (active) setFolderPending(false)
      })
    return () => {
      active = false
    }
  }, [bridge])

  // Format. Default MP4 — share-ready, captures the most cases. Drives
  // the file extension downstream + which pipeline the orchestrator
  // picks.
  const [formatId, setFormatId] = useState<ExportFormatId>('mp4')
  const format =
    EXPORT_FORMATS.find((f) => f.id === formatId) ?? EXPORT_FORMATS[0]

  // Resolution. Defaults to 'comp' (match scene) — fastest path because
  // capturePage is already at the artboard's native CSS rect.
  const [qualityId, setQualityId] = useState<ExportQualityId>('comp')
  const quality =
    EXPORT_QUALITIES.find((q) => q.id === qualityId) ?? EXPORT_QUALITIES[0]

  // Frame rate. Default to scene fps when it matches one of the chips,
  // else 60 (the most common motion-tool default).
  const sceneFps = meta.frameRate
  const [fps, setFps] = useState<FpsId>(() => {
    if (sceneFps === 24 || sceneFps === 30 || sceneFps === 60) {
      return sceneFps as FpsId
    }
    return 60
  })

  // Range. Default to the active chapter when one's isolated, else full.
  const initialMode: RangeMode =
    exportScope === 'scene'
      ? isolatedRange
        ? 'chapter'
        : exportWorkArea
          ? 'work'
          : 'full'
      : 'full'
  const [rangeMode, setRangeMode] = useState<RangeMode>(initialMode)
  // Multi-chapter selection. A Set keyed by section id; rendered + sent
  // to the orchestrator in timeline order. One element = single chapter
  // (matches the prior "Chapter" mode behavior); 2+ elements = segments
  // export, glued back-to-back in the resulting file.
  const [chapterIds, setChapterIds] = useState<Set<string>>(() => {
    if (isolatedRange?.label) {
      const match = sections.find((s) => s.name === isolatedRange.label)
      if (match) return new Set([match.id])
    }
    if (sections[0]) return new Set([sections[0].id])
    return new Set()
  })
  const [customStart, setCustomStart] = useState<number>(
    isolatedRange ? isolatedRange.start : 0,
  )
  const [customEnd, setCustomEnd] = useState<number>(
    isolatedRange ? isolatedRange.end : exportDuration,
  )

  // Selected chapters in timeline order — derive once for both the
  // range memo and the readout.
  const selectedChapters = useMemo(() => {
    return sections
      .filter((s) => chapterIds.has(s.id))
      .sort((a, b) => a.start - b.start)
  }, [sections, chapterIds])

  // Resolved range — single source of truth for the export call.
  //
  //   Full         → 'full'
  //   Chapter (0)  → 'full' (with Export disabled — guarded below)
  //   Chapter (1)  → 'time'
  //   Chapter (2+) → 'segments'
  //   Custom       → 'time'
  const range = useMemo<ExportRange>(() => {
    if (rangeMode === 'full') return { kind: 'full' }
    if (rangeMode === 'chapter') {
      if (selectedChapters.length === 0) return { kind: 'full' }
      if (selectedChapters.length === 1) {
        const ch = selectedChapters[0]
        return { kind: 'time', startSec: ch.start, endSec: ch.end }
      }
      return {
        kind: 'segments',
        segments: selectedChapters.map((c) => ({
          startSec: c.start,
          endSec: c.end,
        })),
      }
    }
    if (rangeMode === 'work' && exportWorkArea) {
      return {
        kind: 'time',
        startSec: exportWorkArea.start,
        endSec: exportWorkArea.end,
      }
    }
    return { kind: 'time', startSec: customStart, endSec: customEnd }
  }, [rangeMode, selectedChapters, exportWorkArea, customStart, customEnd])

  // Filename tag — empty string when not partial, sanitized chapter
  // ids joined when one or more chapters are selected.
  //   1 chapter  → "intro"
  //   2+         → "intro-hold"
  const filenameTag = useMemo(() => {
    if (rangeMode !== 'chapter') return undefined
    if (selectedChapters.length === 0) return undefined
    return selectedChapters
      .map((c) => c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
      .filter(Boolean)
      .join('-')
  }, [rangeMode, selectedChapters])

  const exportDisabled =
    exportRunning ||
    (Boolean(bridge) && !folderPath) ||
    (exportScope === 'scene' && !selectedComposition) ||
    (rangeMode === 'chapter' && selectedChapters.length === 0)

  // Range readout values. For segments, sum each span's duration; for
  // simple ranges, take the bounds directly. `frameCount` is what we
  // surface as "N frames" in the readout — matches what the encoder
  // will actually emit.
  const rangeStart =
    range.kind === 'full'
      ? 0
      : range.kind === 'time'
        ? range.startSec
        : range.kind === 'segments' && range.segments.length > 0
          ? range.segments[0].startSec
          : 0
  const rangeEnd =
    range.kind === 'full'
      ? exportDuration
      : range.kind === 'time'
        ? range.endSec
        : range.kind === 'segments' && range.segments.length > 0
          ? range.segments[range.segments.length - 1].endSec
          : exportDuration
  const totalSelectedSec =
    range.kind === 'segments'
      ? range.segments.reduce((acc, s) => acc + (s.endSec - s.startSec), 0)
      : rangeEnd - rangeStart
  const frameCount = Math.max(1, Math.round(totalSelectedSec * fps))

  // Position the panel below the trigger, flipping above when there's
  // not enough room. Mirrors the previous behaviour.
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const pad = 6
    let left = anchorRect.right - rect.width
    let top = anchorRect.bottom + 4
    if (left + rect.width + pad > vw) left = vw - rect.width - pad
    if (left < pad) left = pad
    if (top + rect.height + pad > vh) {
      top = Math.max(pad, anchorRect.top - rect.height - 4)
    }
    setPos({ left, top })
  }, [anchorRect])

  // Dismiss on Escape / click-outside / scroll, like ContextMenu.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const el = menuRef.current
      if (el && el.contains(e.target as Node)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    const onScroll = () => onClose()
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('wheel', onScroll, { passive: true })
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', onScroll)
    }
  }, [onClose])

  const onExport = () => {
    if (exportDisabled) return
    const safeTitle = sanitizeExportTitle(exportTitle, exportName)
    setExportTitle(safeTitle)
    onClose()
    void exportScene({
      api,
      sceneName: safeTitle,
      durationSec: exportDuration,
      scope: exportScope,
      compositionSceneId:
        exportScope === 'scene' ? selectedComposition?.id : undefined,
      selectedSequenceItemId:
        exportScope === 'scene'
          ? selectedSequenceItemId ?? undefined
          : undefined,
      frameRate: meta.frameRate,
      format,
      quality,
      exportFps: fps,
      range,
      filenameTag,
      onBlob:
        bridge && folderPath
          ? async (blob, resolvedFileName) => {
              await writeExportBlob(
                bridge,
                folderPath,
                resolvedFileName,
                blob,
              )
            }
          : undefined,
      // No pipeline override: the orchestrator picks captureRect when
      // running under Electron and falls back to tab capture in the
      // web tree. The previous Fast/HQ chip distinction was redundant.
    })
  }

  const totalFrames = Math.max(1, Math.round(exportDuration * fps))
  const hasChapters =
    exportScope === 'scene' &&
    selectedCompositionIsActive &&
    sections.length > 0

  return createPortal(
    <div
      ref={menuRef}
      role="dialog"
      aria-label="Export"
      style={{
        position: 'fixed',
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        visibility: pos ? 'visible' : 'hidden',
        width: PANEL_WIDTH,
      }}
      className="hm-popover-surface z-[100] overflow-hidden border border-border"
    >
      {/* Compact job metadata; the redundant dialog title is intentionally omitted. */}
      <div className="flex items-center justify-end border-b border-border px-4 py-2.5">
        <span className="font-mono text-[10px] tabular-nums text-text-dim">
          {exportDuration.toFixed(2)}s · {totalFrames}f @ {fps}fps
        </span>
      </div>

      {/* Body — spec sheet rows */}
      <div className="px-4 py-3">
        <FieldRow label="Title">
          <input
            type="text"
            value={exportTitle}
            aria-label="Export title"
            spellCheck={false}
            onChange={(event) => setExportTitle(event.target.value)}
            onBlur={() =>
              setExportTitle(sanitizeExportTitle(exportTitle, exportName))
            }
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') {
                event.preventDefault()
                setExportTitle(sanitizeExportTitle(exportName))
                event.currentTarget.blur()
              }
            }}
            className="hm-control-surface hm-control-compact h-8 w-full px-3 text-[11px] text-text outline-none"
          />
        </FieldRow>

        <FieldRow label="Folder">
          <button
            type="button"
            aria-label="Choose export folder"
            aria-busy={folderPending}
            title={folderPath || undefined}
            disabled={!bridge || folderPending}
            onClick={() => {
              if (!bridge) return
              setFolderPending(true)
              void chooseExportDirectory(
                bridge,
                folderPath,
                exportTitle,
                formatId,
              )
                .then((selection) => {
                  if (!selection) return
                  setFolderPath(selection.directory)
                  setExportTitle(selection.title)
                })
                .finally(() => setFolderPending(false))
            }}
            className="hm-control-surface hm-control-compact flex h-8 w-full min-w-0 items-center px-3 text-left font-mono text-[10px] text-text-muted outline-none disabled:cursor-default disabled:opacity-60"
          >
            <span className="truncate">
              {folderPending
                ? 'Loading folder…'
                : folderPath || (bridge ? 'Choose a folder' : 'Downloads')}
            </span>
          </button>
        </FieldRow>

        <div className="my-2 border-t border-border" />

        <FieldRow label="Output">
          <Segments>
            <SegmentBtn
              active={exportScope === 'scene'}
              onClick={() => {
                setExportScope('scene')
                setRangeMode('full')
                setCustomStart(0)
                setCustomEnd(
                  selectedComposition?.duration ?? meta.duration,
                )
              }}
            >
              Individual scene
            </SegmentBtn>
            <SegmentBtn
              active={exportScope === 'sequence'}
              onClick={() => {
                setExportScope('sequence')
                setRangeMode('full')
                setCustomStart(0)
                setCustomEnd(sequenceMap.duration)
              }}
              title={
                hasSequence
                  ? 'Render every ordered scene as one movie'
                  : 'The sequence currently contains one scene'
              }
            >
              Full sequence
            </SegmentBtn>
          </Segments>
        </FieldRow>

        {exportScope === 'scene' && selectedComposition ? (
          <FieldRow label="Scene">
            <SelectField
              value={selectedComposition.id}
              options={compositions.map((composition, index) => ({
                value: composition.id,
                label: `${index + 1} · ${composition.name}`,
              }))}
              onCommit={(nextId) => {
                const nextComposition = compositions.find(
                  (composition) => composition.id === nextId,
                )
                if (!nextComposition) return
                setCompositionSceneId(nextId)
                setRangeMode('full')
                setCustomStart(0)
                setCustomEnd(nextComposition.duration)
              }}
              ariaLabel="Scene to export"
            />
          </FieldRow>
        ) : null}

        <FieldRow label="Format">
          <Segments>
            {EXPORT_FORMATS.map((f) => (
              <SegmentBtn
                key={f.id}
                active={f.id === formatId}
                onClick={() => setFormatId(f.id)}
              >
                {f.label}
              </SegmentBtn>
            ))}
          </Segments>
        </FieldRow>

        <FieldRow label="Resolution">
          <Segments>
            {EXPORT_QUALITIES.map((q) => (
              <SegmentBtn
                key={q.id}
                active={q.id === qualityId}
                onClick={() => setQualityId(q.id)}
                title={q.hint}
              >
                {q.label}
              </SegmentBtn>
            ))}
          </Segments>
        </FieldRow>

        <FieldRow label="Frame rate">
          <Segments>
            {([24, 30, 60] as FpsId[]).map((f) => (
              <SegmentBtn
                key={f}
                active={fps === f}
                onClick={() => setFps(f)}
              >
                {f}
              </SegmentBtn>
            ))}
          </Segments>
        </FieldRow>

        {/* Range — segmented mode + conditional sub-row.
            The wrapper is `w-full` so the segmented track stays at the
            full value-column width regardless of which sub-row is
            currently rendered. Without this, Full mode's short
            "00:00 — 00:05" readout would shrink the column and pull
            the tabs in with it (Pipedrive / Writer / Care.com all keep
            the mode track stable; only the sub-row changes shape). */}
        <FieldRow label="Range" align="start">
          <div className="flex w-full flex-col gap-2">
            <Segments>
              <SegmentBtn
                active={rangeMode === 'full'}
                onClick={() => setRangeMode('full')}
              >
                Full
              </SegmentBtn>
              {hasChapters && (
                <SegmentBtn
                  active={rangeMode === 'chapter'}
                  onClick={() => setRangeMode('chapter')}
                >
                  Chapter
                </SegmentBtn>
              )}
              {exportScope === 'scene' && exportWorkArea && (
                <SegmentBtn
                  active={rangeMode === 'work'}
                  onClick={() => setRangeMode('work')}
                >
                  Work
                </SegmentBtn>
              )}
              <SegmentBtn
                active={rangeMode === 'custom'}
                onClick={() => setRangeMode('custom')}
              >
                Custom
              </SegmentBtn>
            </Segments>

            {rangeMode === 'full' && (
              <RangeReadout
                start={rangeStart}
                end={rangeEnd}
                frames={frameCount}
              />
            )}

            {rangeMode === 'chapter' && hasChapters && (
              <div className="flex flex-col gap-2">
                <ChapterChips
                  sections={sections}
                  selected={chapterIds}
                  onToggle={(id) =>
                    setChapterIds((prev) => {
                      const next = new Set(prev)
                      if (next.has(id)) next.delete(id)
                      else next.add(id)
                      return next
                    })
                  }
                />
                <ChapterRangeReadout
                  selected={selectedChapters}
                  totalSec={totalSelectedSec}
                  frames={frameCount}
                />
              </div>
            )}

            {rangeMode === 'work' && exportWorkArea && (
              <RangeReadout
                start={rangeStart}
                end={rangeEnd}
                frames={frameCount}
              />
            )}

            {rangeMode === 'custom' && (
              <CustomRangeFields
                start={customStart}
                end={customEnd}
                fps={fps}
                duration={exportDuration}
                onStart={setCustomStart}
                onEnd={setCustomEnd}
                frames={frameCount}
              />
            )}
          </div>
        </FieldRow>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 border-t border-border bg-panel px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onClose}
            className="hm-secondary-action"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onExport}
            disabled={exportDisabled}
            className={[
              'hm-primary-action transition-opacity',
              exportDisabled
                ? 'cursor-not-allowed bg-accent/40 text-white/70'
                : 'bg-accent text-white hover:brightness-110',
            ].join(' ')}
          >
            {exportRunning ? 'Export in progress' : 'Export'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ---------------------------------------------------------------------------
// Layout primitives.
// ---------------------------------------------------------------------------

/**
 * One row of the spec sheet — fixed-width label on the left, control
 * area on the right. `align="start"` is for rows whose control stack
 * grows vertically (Range mode + sub-row); the label sticks to the
 * top of the row instead of vertical-centering.
 */
function FieldRow({
  label,
  children,
  align = 'center',
}: {
  label: string
  children: React.ReactNode
  align?: 'center' | 'start'
}) {
  return (
    <div
      className={[
        'flex gap-3 py-1.5',
        align === 'start' ? 'items-start' : 'items-center',
      ].join(' ')}
    >
      <span
        style={{ width: LABEL_COL }}
        className={[
          'shrink-0 text-[11px] text-text-muted',
          align === 'start' ? 'pt-1.5' : '',
        ].join(' ')}
      >
        {label}
      </span>
      <div className="flex min-w-0 flex-1 items-center">{children}</div>
    </div>
  )
}

/**
 * Segmented track — visually identical to `LabeledSegmented` in
 * Inspector.tsx (the Layout / Type — None / Stack / Grid control). Same
 * Tailwind classes so the two panels read as the same component. If
 * we later lift LabeledSegmented into a shared primitive, this
 * collapses to one import.
 *
 * Items use `flex-1` so the segments share the value column equally,
 * which is what makes the control read as proportioned tabs rather
 * than a row of content-width pills.
 */
function Segments({ children }: { children: React.ReactNode }) {
  return (
    <div className="hm-control-surface hm-inspector-segmented">
      {children}
    </div>
  )
}

function SegmentBtn({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean
  onClick: () => void
  title?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      data-active={active ? 'true' : 'false'}
      className="hm-inspector-segment"
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Range sub-row helpers.
// ---------------------------------------------------------------------------

function RangeReadout({
  start,
  end,
  frames,
  compact,
}: {
  start: number
  end: number
  frames: number
  compact?: boolean
}) {
  const fmtSec = (n: number) => {
    const totalMs = Math.round(n * 1000)
    const min = Math.floor(totalMs / 60000)
    const sec = Math.floor((totalMs % 60000) / 1000)
    return `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
  }
  return (
    <div
      className={[
        'font-mono text-[10px] tabular-nums text-text-muted',
        compact ? '' : 'pt-0.5',
      ].join(' ')}
    >
      <span className="text-text">{fmtSec(start)}</span>
      <span className="text-text-dim"> — </span>
      <span className="text-text">{fmtSec(end)}</span>
      <span className="text-text-dim">
        {' '}
        · {frames} frame{frames === 1 ? '' : 's'}
      </span>
    </div>
  )
}

/**
 * Custom range — three inputs: Start, End (both editable in time
 * format `mm:ss.cc`), and Frames (read-only, derived). Mirrors the
 * Google AI Studio "Start Time / End Time / FPS" pattern. The unit
 * toggle that used to flip Start/End between seconds and frames was
 * dropped — frames are now always shown read-only as a derived
 * value, which is what users wanted to see anyway.
 */
function CustomRangeFields({
  start,
  end,
  fps,
  duration,
  onStart,
  onEnd,
  frames,
}: {
  start: number
  end: number
  fps: number
  duration: number
  onStart: (n: number) => void
  onEnd: (n: number) => void
  frames: number
}) {
  return (
    <div className="flex items-end gap-2">
      <TimeInput
        label="Start"
        seconds={start}
        max={Math.max(0, end - 1 / fps)}
        onCommit={(s) => onStart(Math.max(0, Math.min(end - 1 / fps, s)))}
      />
      <span className="pb-1.5 text-[11px] text-text-dim">→</span>
      <TimeInput
        label="End"
        seconds={end}
        max={duration}
        onCommit={(s) => onEnd(Math.max(start + 1 / fps, Math.min(duration, s)))}
      />
      <ReadOnlyCell label="Frames" value={frames.toString()} />
    </div>
  )
}

function TimeInput({
  label,
  seconds,
  max,
  onCommit,
}: {
  label: string
  seconds: number
  max: number
  onCommit: (n: number) => void
}) {
  const fmt = (n: number) => {
    const totalMs = Math.max(0, Math.round(n * 1000))
    const min = Math.floor(totalMs / 60000)
    const sec = Math.floor((totalMs % 60000) / 1000)
    const cs = Math.floor((totalMs % 1000) / 10)
    return `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`
  }
  const parse = (raw: string): number | null => {
    const trimmed = raw.trim()
    if (!trimmed) return null
    // Keep conventional timecode entry, and also accept explicit duration
    // units such as `10s`, `2m`, `1hr`, and `250ms`.
    const m = trimmed.match(/^(\d+):(\d+)(?:\.(\d+))?$/)
    if (m) {
      const min = Number(m[1])
      const sec = Number(m[2])
      const cs = m[3] ? Number(`0.${m[3]}`) : 0
      return min * 60 + sec + cs
    }
    return parseTimeExpression(trimmed)
  }
  const [draft, setDraft] = useState(fmt(seconds))
  const [focused, setFocused] = useState(false)
  const cancelBlurCommitRef = useRef(false)
  const commit = () => {
    const parsed = parse(draft)
    if (parsed === null) {
      setDraft(fmt(seconds))
      return
    }
    onCommit(Math.min(max, Math.max(0, parsed)))
  }
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] uppercase tracking-wider text-text-dim">
        {label}
      </span>
      <input
        type="text"
        inputMode="decimal"
        value={focused ? draft : fmt(seconds)}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => {
          setDraft(fmt(seconds))
          setFocused(true)
          cancelBlurCommitRef.current = false
        }}
        onBlur={() => {
          setFocused(false)
          if (cancelBlurCommitRef.current) {
            cancelBlurCommitRef.current = false
          } else {
            commit()
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') {
            e.preventDefault()
            cancelBlurCommitRef.current = true
            setDraft(fmt(seconds))
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        className="w-[88px] rounded border border-border bg-panel px-2 py-1 text-center font-mono text-[11px] tabular-nums text-text outline-none focus:border-accent"
      />
    </div>
  )
}

function ReadOnlyCell({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] uppercase tracking-wider text-text-dim">
        {label}
      </span>
      <div className="flex h-[26px] w-[64px] items-center justify-center rounded border border-border bg-panel font-mono text-[11px] tabular-nums text-text-dim">
        {value}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Chapter chips — multi-select within the Chapter range mode.
// ---------------------------------------------------------------------------

type ChapterSection = ReturnType<
  ReturnType<typeof useSceneAPI>['getSections']
>[number]

/**
 * Toggleable chip per section. Selected chips fill with the chapter's
 * own color (the same swatch the timeline uses for chapter pills),
 * unselected chips render outlined. Single-select feels identical to
 * the prior dropdown UX; multi-select drives the orchestrator's
 * `segments` range path.
 */
function ChapterChips({
  sections,
  selected,
  onToggle,
}: {
  sections: ChapterSection[]
  selected: Set<string>
  onToggle: (id: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {sections.map((s) => {
        const active = selected.has(s.id)
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onToggle(s.id)}
            className={[
              'inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-medium transition-colors',
              active
                ? 'text-text'
                : 'border-border bg-panel text-text-muted hover:text-text',
            ].join(' ')}
            style={
              active
                ? {
                    // Tint with the chapter's color at low opacity so
                    // multiple selected chips keep their identity. The
                    // border picks up the same color at full strength.
                    backgroundColor: `${s.color}1F`,
                    borderColor: s.color,
                  }
                : undefined
            }
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: s.color }}
            />
            <span className="truncate">{s.name}</span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * Readout under the chip row — shows the resolved time / frame totals
 * across the (possibly non-contiguous) chapter selection.
 *
 *   0 selected   → "Pick at least one chapter" hint
 *   1 selected   → "00:02 — 00:03 · 81 frames" (matches old single-Chapter UX)
 *   2+ selected  → "Intro + Hold · 2.0s · 120 frames"
 */
function ChapterRangeReadout({
  selected,
  totalSec,
  frames,
}: {
  selected: ChapterSection[]
  totalSec: number
  frames: number
}) {
  if (selected.length === 0) {
    return (
      <p className="font-mono text-[10px] tabular-nums text-text-dim">
        Pick at least one chapter to export.
      </p>
    )
  }
  if (selected.length === 1) {
    return (
      <RangeReadout
        start={selected[0].start}
        end={selected[0].end}
        frames={frames}
        compact
      />
    )
  }
  const names = selected.map((s) => s.name).join(' + ')
  return (
    <p className="font-mono text-[10px] tabular-nums text-text-muted">
      <span className="text-text">{names}</span>
      <span className="text-text-dim"> · </span>
      <span className="text-text">{totalSec.toFixed(1)}s</span>
      <span className="text-text-dim"> · </span>
      <span className="text-text">{frames}</span>
      <span className="text-text-dim"> frames</span>
    </p>
  )
}

// Type re-exports so any callers of this module keep their imports
// working — `ExportFormat` was used in the old FormatChoiceCard
// definition and is still useful for downstream typing.
export type { ExportFormat }
