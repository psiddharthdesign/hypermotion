// SPDX-License-Identifier: Apache-2.0

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { Download, Upload } from 'lucide-react'
import {
  exportCompositionToHypeBytes,
  importScenesFromHypeBytes,
  useProjectAPI,
} from '@/project'
import { useSceneAPI, useSceneVersion } from '@/scene'
import { useUI } from '@/state/ui'
import type { CompositionScene, SequenceItem } from '@/sequence'
import { AppIcon } from '@/ui/AppIcon'
import { NumberReadout } from '@/ui/fields/NumberReadout'
import { useToast } from '@/ui/toastStore'

const SCENE_ITEM_DRAG_TYPE = 'application/x-hypermotion-sequence-item'

/**
 * Ordered filmstrip for the project sequence.
 *
 * A scene card is both an edit target and a sequence occurrence. Selecting it
 * activates that composition's root/default camera in the legacy projection,
 * so the existing canvas, layer tree and inspector immediately edit the right
 * scene. Reordering only changes the master sequence; it never reparents or
 * drops authored layers.
 */
export function SceneNavigator() {
  const version = useSceneVersion()
  const sceneApi = useSceneAPI()
  const project = useProjectAPI()
  const selectedItemId = useUI((state) => state.selectedSequenceItemId)
  const activeCompositionId = useUI((state) => state.activeCompositionId)
  const programSequenceItemId = useUI(
    (state) => state.programSequenceItemId,
  )
  const setSelectedSequenceItem = useUI(
    (state) => state.setSelectedSequenceItem,
  )
  const setPlayhead = useUI((state) => state.setPlayhead)
  const setPlaying = useUI((state) => state.setPlaying)
  const timelineScope = useUI((state) => state.timelineScope)
  const setTimelineScope = useUI((state) => state.setTimelineScope)
  const setPreviewScope = useUI((state) => state.setPreviewScope)
  const showToast = useToast((state) => state.show)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [transferBusy, setTransferBusy] = useState(false)
  const [sceneStripFade, setSceneStripFade] = useState({
    left: false,
    right: false,
  })
  const importInputRef = useRef<HTMLInputElement>(null)
  const sceneStripRef = useRef<HTMLDivElement>(null)

  const scenes = useMemo(
    () => project.getScenes(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project, version],
  )
  const items = useMemo(
    () => project.getSequenceItems(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project, version],
  )
  const sceneById = useMemo(
    () => new Map(scenes.map((scene) => [scene.id, scene])),
    [scenes],
  )

  const updateSceneStripFade = useCallback(() => {
    const viewport = sceneStripRef.current
    if (!viewport) return

    const maxScrollLeft = Math.max(
      0,
      viewport.scrollWidth - viewport.clientWidth,
    )
    const next = {
      left: viewport.scrollLeft > 1,
      right: maxScrollLeft - viewport.scrollLeft > 1,
    }
    setSceneStripFade((current) =>
      current.left === next.left && current.right === next.right
        ? current
        : next,
    )
  }, [])

  useEffect(() => {
    const viewport = sceneStripRef.current
    if (!viewport) return

    updateSceneStripFade()
    const resizeObserver = new ResizeObserver(updateSceneStripFade)
    resizeObserver.observe(viewport)
    if (viewport.firstElementChild instanceof HTMLElement) {
      resizeObserver.observe(viewport.firstElementChild)
    }
    return () => resizeObserver.disconnect()
  }, [items.length, updateSceneStripFade])

  // Hydrate the editor-only selection from the document's persisted active
  // composition after IndexedDB/file loading. This does not pick a different
  // scene; it only gives the UI store the same occurrence id.
  useEffect(() => {
    const activeId = project.getActiveSceneId()
    const activeItem =
      items.find((item) => item.id === selectedItemId) ??
      items.find((item) => item.sceneId === activeId) ??
      items[0]
    if (!activeItem) return
    if (
      selectedItemId !== activeItem.id ||
      activeCompositionId !== activeItem.sceneId
    ) {
      setSelectedSequenceItem(activeItem.id, activeItem.sceneId)
    }
  }, [
    activeCompositionId,
    items,
    project,
    selectedItemId,
    setSelectedSequenceItem,
  ])

  // Camera creation/deletion happens through the established SceneAPI action
  // surface. Fold any newly-created, unclaimed camera into the active
  // composition, and prune deleted camera/cut references.
  useEffect(() => {
    const activeId = project.getActiveSceneId()
    if (activeId) project.reconcileSceneCameras(activeId)
    // The reconcile function is idempotent and writes only when ownership
    // changed, so including the document version cannot loop indefinitely.
  }, [project, version])

  const selectItem = (item: SequenceItem) => {
    setPlaying(false)
    project.activateScene(item.sceneId)
    setSelectedSequenceItem(item.id, item.sceneId)
    setTimelineScope('scene')
    setPreviewScope('scene')
    setPlayhead(0)
  }

  const addScene = () => {
    const created = project.createScene({ insertAt: items.length })
    const item = project
      .getSequenceItems()
      .findLast((candidate) => candidate.sceneId === created.id)
    if (item) {
      setSelectedSequenceItem(item.id, created.id)
      setTimelineScope('scene')
      setPreviewScope('scene')
      setPlayhead(0)
    }
  }

  const selectTransferredScene = (itemId: string, sceneId: string) => {
    setPlaying(false)
    setSelectedSequenceItem(itemId, sceneId)
    setTimelineScope('scene')
    setPreviewScope('scene')
    setPlayhead(0)
  }

  const importBytes = async (bytes: Uint8Array) => {
    setTransferBusy(true)
    showToast({ tone: 'loading', title: 'Importing scenes…' })
    try {
      // Paint the progress state before decoding and cloning a large Yjs file.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      )
      const result = importScenesFromHypeBytes(project, bytes)
      const first = result.scenes[0]
      if (first) {
        selectTransferredScene(first.sequenceItemId, first.sceneId)
      }
      const count = result.scenes.length
      const compatibilityNote = result.warnings.join(' ')
      showToast({
        tone: 'success',
        title: 'Scenes imported',
        description: `${count} scene${count === 1 ? ' was' : 's were'} added to the end of the sequence.${compatibilityNote ? ` ${compatibilityNote}` : ''}`,
      })
    } catch (error) {
      console.error('[scene-import] failed', error)
      showToast({
        tone: 'error',
        title: "Couldn't import scenes",
        description:
          error instanceof Error
            ? error.message
            : 'The .hype file could not be read.',
      })
    } finally {
      setTransferBusy(false)
    }
  }

  const importScenes = () => {
    if (transferBusy) return
    const bridge = window.hypermotion
    if (!bridge) {
      importInputRef.current?.click()
      return
    }
    void (async () => {
      try {
        const result = (await bridge.invoke('file:show-open-dialog', {
          title: 'Import scenes from .hype',
          trackRecent: false,
        })) as { path: string; bytes: Uint8Array } | null
        if (!result) return
        await importBytes(new Uint8Array(result.bytes))
      } catch (error) {
        console.error('[scene-import] dialog failed', error)
        showToast({
          tone: 'error',
          title: "Couldn't import scenes",
          description:
            error instanceof Error
              ? error.message
              : 'The .hype file could not be read.',
        })
      }
    })()
  }

  const exportSelectedScene = () => {
    if (transferBusy) return
    const item =
      items.find((candidate) => candidate.id === selectedItemId) ??
      items.find((candidate) => candidate.sceneId === activeCompositionId)
    if (!item) return
    const composition = sceneById.get(item.sceneId)
    if (!composition) return

    void (async () => {
      setTransferBusy(true)
      try {
        const bytes = exportCompositionToHypeBytes(project, composition.id)
        const suggestedName = `${safeFilename(composition.name)}.hype`
        const bridge = window.hypermotion
        if (bridge) {
          const path = (await bridge.invoke('file:show-save-dialog', {
            title: 'Export scene as .hype',
            suggestedName,
          })) as string | null
          if (!path) return
          const written = (await bridge.invoke('file:write', {
            path,
            bytes,
            trackRecent: false,
          })) as boolean
          if (!written) {
            throw new Error('The scene file could not be written.')
          }
        } else {
          downloadHypeFile(bytes, suggestedName)
        }
        showToast({
          tone: 'success',
          title: 'Scene exported',
          description: `${composition.name} was saved as a portable .hype file.`,
        })
      } catch (error) {
        console.error('[scene-export] failed', error)
        showToast({
          tone: 'error',
          title: "Couldn't export scene",
          description:
            error instanceof Error
              ? error.message
              : 'The scene could not be exported.',
        })
      } finally {
        setTransferBusy(false)
      }
    })()
  }

  const duplicate = (item: SequenceItem, index: number) => {
    const created = project.duplicateScene(item.sceneId, index + 1)
    if (!created) return
    const copyItem = project
      .getSequenceItems()
      .find((candidate) => candidate.sceneId === created.id)
    if (copyItem) {
      setSelectedSequenceItem(copyItem.id, created.id)
      setTimelineScope('scene')
      setPreviewScope('scene')
      setPlayhead(0)
    }
  }

  const remove = (item: SequenceItem) => {
    const deletingEditTarget =
      item.id === selectedItemId || item.sceneId === activeCompositionId
    const result = project.deleteScene(item.sceneId)
    if (!result.deleted || !result.activeSceneId) return
    // A card can be deleted without first selecting it. Preserve the current
    // edit occurrence, timeline mode, and playhead when its composition is
    // still alive; ProjectAPI likewise preserves the legacy projection.
    if (!deletingEditTarget) return
    const nextItem = project
      .getSequenceItems()
      .find((candidate) => candidate.sceneId === result.activeSceneId)
    if (nextItem) {
      setSelectedSequenceItem(nextItem.id, nextItem.sceneId)
      setTimelineScope('scene')
      setPreviewScope('scene')
      setPlayhead(0)
    }
  }

  const onDrop = (event: DragEvent, item: SequenceItem, index: number) => {
    event.preventDefault()
    const dragged = event.dataTransfer.getData(SCENE_ITEM_DRAG_TYPE)
    setDragOverId(null)
    if (!dragged || dragged === item.id) return
    project.reorderSequenceItem(dragged, index)
  }

  return (
    <section
      data-scene-navigator="1"
      aria-label="Scenes"
      className="pointer-events-none absolute inset-x-0 top-3 z-50 flex justify-center px-3"
    >
      <div className="hm-popover-surface pointer-events-auto flex max-w-full items-center gap-1.5 border border-border p-1.5 backdrop-blur-xl">
        <div className="grid h-10 shrink-0 grid-cols-2 gap-0.5 rounded-[var(--radius-panel)] bg-control p-1 shadow-[var(--shadow-control)]">
          <ScopeButton
            active={timelineScope === 'scene'}
            label="Scene"
            onClick={() => {
              setPlaying(false)
              setTimelineScope('scene')
              setPreviewScope('scene')
              setPlayhead(0)
            }}
          />
          <ScopeButton
            active={timelineScope === 'sequence'}
            label="Master"
            transportSpace={timelineScope === 'sequence'}
            onClick={() => {
              setPlaying(false)
              setTimelineScope('sequence')
              setPreviewScope('sequence')
              setPlayhead(0)
            }}
          />
        </div>

        <div className="h-8 w-px shrink-0 bg-border" />

        <div className="relative max-w-[min(54vw,560px)] min-w-0">
          <div
            ref={sceneStripRef}
            data-scene-strip-viewport="1"
            onScroll={updateSceneStripFade}
            className="overflow-x-auto overflow-y-hidden py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <div className="flex min-w-max items-center gap-1.5 px-0.5">
              {items.map((item, index) => {
                const composition = sceneById.get(item.sceneId)
                if (!composition) return null
                const selected =
                  item.id === selectedItemId ||
                  (!selectedItemId && composition.id === activeCompositionId)
                return (
                  <SceneCard
                    key={item.id}
                    index={index}
                    item={item}
                    scene={composition}
                    selected={selected}
                    program={programSequenceItemId === item.id}
                    dragOver={dragOverId === item.id}
                    rootBackground={rootBackground(sceneApi, composition)}
                    onSelect={() => selectItem(item)}
                    onDuplicate={() => duplicate(item, index)}
                    onDelete={() => remove(item)}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'move'
                      event.dataTransfer.setData(
                        SCENE_ITEM_DRAG_TYPE,
                        item.id,
                      )
                    }}
                    onDragOver={(event) => {
                      event.preventDefault()
                      event.dataTransfer.dropEffect = 'move'
                      setDragOverId(item.id)
                    }}
                    onDragLeave={() =>
                      setDragOverId((current) =>
                        current === item.id ? null : current,
                      )
                    }
                    onDrop={(event) => onDrop(event, item, index)}
                  />
                )
              })}

              <button
                type="button"
                onClick={addScene}
                disabled={transferBusy}
                title="Add scene"
                aria-label="Add scene"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-panel)] border border-dashed border-border bg-control text-text-dim transition-[border-color,background-color,color,scale] hover:border-accent hover:bg-accent-soft/30 hover:text-accent active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40"
              >
                <AppIcon name="plus" size={16} />
              </button>
            </div>
          </div>

          <div
            aria-hidden="true"
            data-scene-strip-fade="left"
            className={[
              'pointer-events-none absolute inset-y-0 left-0 z-10 w-6 transition-opacity motion-reduce:transition-none',
              sceneStripFade.left ? 'opacity-100' : 'opacity-0',
            ].join(' ')}
            style={{
              background:
                'linear-gradient(to right, var(--color-panel-raised), transparent)',
              transitionDuration: 'var(--duration-ui-fast)',
            }}
          />
          <div
            aria-hidden="true"
            data-scene-strip-fade="right"
            className={[
              'pointer-events-none absolute inset-y-0 right-0 z-10 w-6 transition-opacity motion-reduce:transition-none',
              sceneStripFade.right ? 'opacity-100' : 'opacity-0',
            ].join(' ')}
            style={{
              background:
                'linear-gradient(to left, var(--color-panel-raised), transparent)',
              transitionDuration: 'var(--duration-ui-fast)',
            }}
          />
        </div>

        <input
          ref={importInputRef}
          type="file"
          accept=".hype,application/x-hypermotion"
          className="hidden"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (!file) return
            void file
              .arrayBuffer()
              .then((buffer) => importBytes(new Uint8Array(buffer)))
          }}
        />

        <div
          aria-hidden="true"
          data-scene-transfer-divider="1"
          className="mx-0.5 h-8 w-px shrink-0 bg-border"
        />

        <button
          type="button"
          onClick={exportSelectedScene}
          disabled={transferBusy || items.length === 0}
          title="Export selected scene as .hype"
          aria-label="Export selected scene as .hype"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-panel)] border border-border bg-control text-text-dim transition-[border-color,background-color,color,scale] hover:border-accent hover:bg-accent-soft/30 hover:text-accent active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40"
        >
          <Upload size={16} strokeWidth={1.75} />
        </button>

        <button
          type="button"
          onClick={importScenes}
          disabled={transferBusy}
          title="Import scenes from .hype"
          aria-label="Import scenes from .hype"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-panel)] border border-border bg-control text-text-dim transition-[border-color,background-color,color,scale] hover:border-accent hover:bg-accent-soft/30 hover:text-accent active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40"
        >
          <Download size={16} strokeWidth={1.75} />
        </button>
      </div>
    </section>
  )
}

function SceneCard({
  index,
  item,
  scene,
  selected,
  program,
  dragOver,
  rootBackground,
  onSelect,
  onDuplicate,
  onDelete,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  index: number
  item: SequenceItem
  scene: CompositionScene
  selected: boolean
  program: boolean
  dragOver: boolean
  rootBackground: string
  onSelect: () => void
  onDuplicate: () => void
  onDelete: () => void
  onDragStart: (event: DragEvent) => void
  onDragOver: (event: DragEvent) => void
  onDragLeave: () => void
  onDrop: (event: DragEvent) => void
}) {
  const cardRef = useRef<HTMLElement>(null)
  const [tooltipPosition, setTooltipPosition] = useState<{
    left: number
    top: number
  } | null>(null)
  const tooltipId = `scene-name-tooltip-${item.id}`

  const showSceneName = () => {
    const bounds = cardRef.current?.getBoundingClientRect()
    if (!bounds) return
    setTooltipPosition({
      left: bounds.left + bounds.width / 2,
      top: bounds.bottom + 8,
    })
  }

  return (
    <article
      ref={cardRef}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onMouseEnter={showSceneName}
      onMouseLeave={() => setTooltipPosition(null)}
      onFocusCapture={showSceneName}
      onBlurCapture={(event) => {
        if (
          !event.currentTarget.contains(event.relatedTarget as Node | null)
        ) {
          setTooltipPosition(null)
        }
      }}
      data-sequence-item={item.id}
      aria-current={selected ? 'true' : undefined}
      className={[
        'group relative h-10 w-16 shrink-0 rounded-[var(--radius-panel)] transition-transform',
        selected
          ? 'ring-2 ring-inset ring-accent'
          : 'ring-1 ring-inset ring-border hover:ring-border-strong',
        program && !selected ? 'ring-emerald-400/70' : '',
        dragOver ? 'scale-[0.96] ring-2 ring-inset ring-accent' : '',
      ].join(' ')}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-label={`Edit scene ${index + 1}: ${scene.name}`}
        aria-describedby={tooltipPosition ? tooltipId : undefined}
        className="relative h-full w-full overflow-hidden rounded-[calc(var(--radius-panel)_-_2px)] bg-panel-raised outline-none focus-visible:ring-2 focus-visible:ring-accent"
        style={{ background: rootBackground }}
      >
        <span className="absolute inset-0 bg-black/10 transition-colors group-hover:bg-black/5" />
        <span className="absolute bottom-1 left-1 flex h-4 min-w-4 items-center justify-center rounded bg-black/65 px-0.5 font-mono text-[8px] text-white">
          <NumberReadout value={index + 1} />
        </span>
        {program ? (
          <span className="absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full bg-emerald-400 ring-1 ring-black/35" />
        ) : null}
        {selected ? (
          <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-white shadow-sm">
            <AppIcon name="check" size={10} />
          </span>
        ) : null}
      </button>

      <div className="absolute inset-y-1 right-1 flex flex-col justify-between opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onDuplicate()
          }}
          title="Duplicate scene"
          aria-label={`Duplicate ${scene.name}`}
          className="flex h-4 w-4 items-center justify-center rounded bg-black/65 text-white/80 transition-colors hover:bg-black/80 hover:text-white active:scale-[0.96]"
        >
          <AppIcon name="copy" size={9} />
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onDelete()
          }}
          title="Delete scene"
          aria-label={`Delete ${scene.name}`}
          className="flex h-4 w-4 items-center justify-center rounded bg-black/65 text-white/80 transition-colors hover:bg-red-600 hover:text-white active:scale-[0.96]"
        >
          <AppIcon name="trash" size={9} />
        </button>
      </div>

      {tooltipPosition && typeof document !== 'undefined'
        ? createPortal(
            <div
              id={tooltipId}
              role="tooltip"
              data-scene-name-tooltip="1"
              className="pointer-events-none fixed z-[120] max-w-[min(280px,calc(100vw-24px))] -translate-x-1/2 rounded-md border border-border bg-panel-raised px-2 py-1.5 text-center text-[11px] font-medium leading-tight text-text shadow-[var(--shadow-popover)]"
              style={tooltipPosition}
            >
              {scene.name}
            </div>,
            document.body,
          )
        : null}
    </article>
  )
}

function ScopeButton({
  active,
  label,
  transportSpace = false,
  onClick,
}: {
  active: boolean
  label: string
  transportSpace?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-transport-toggle={transportSpace ? '1' : undefined}
      aria-pressed={active}
      className={[
        'min-w-[50px] rounded-md px-2 text-[10px] font-semibold transition-[background-color,color,box-shadow,scale] active:scale-[0.96]',
        active
          ? 'bg-panel-raised text-text shadow-sm'
          : 'text-text-dim hover:bg-panel-raised/55 hover:text-text-muted',
      ].join(' ')}
    >
      {label}
    </button>
  )
}

function rootBackground(
  api: ReturnType<typeof useSceneAPI>,
  scene: CompositionScene,
): string {
  const root = api.getNode(scene.rootNodeId)
  const fill = root?.appearance.fill
  if (fill?.kind === 'solid') return fill.color
  if (fill?.kind === 'linear') {
    const stops = fill.stops
      .map((stop) => `${stop.color} ${Math.round(stop.at * 100)}%`)
      .join(', ')
    return `linear-gradient(${fill.angle}deg, ${stops})`
  }
  if (fill?.kind === 'radial') {
    const stops = fill.stops
      .map((stop) => `${stop.color} ${Math.round(stop.at * 100)}%`)
      .join(', ')
    return `radial-gradient(circle, ${stops})`
  }
  return 'var(--color-canvas-fallback)'
}

function downloadHypeFile(bytes: Uint8Array, filename: string): void {
  const copy = new Uint8Array(bytes)
  const buffer = copy.buffer.slice(
    copy.byteOffset,
    copy.byteOffset + copy.byteLength,
  )
  const blob = new Blob([buffer], { type: 'application/x-hypermotion' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_ ]/g, '').trim() || 'Scene'
}
