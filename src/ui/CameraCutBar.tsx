// SPDX-License-Identifier: Apache-2.0

import { Camera, EyeOff, Trash2 } from 'lucide-react'
import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useProjectAPI } from '@/project'
import { useSceneAPI, useSceneVersion } from '@/scene'
import type { CameraNode } from '@/scene'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import {
  normalizeCameraCuts,
  resolveProgramCamera,
  type CameraCut,
} from '@/sequence'
import { useUI } from '@/state/ui'
import {
  cameraCutChangesProgram,
  cameraCutsAtPlayhead,
  cameraProgramSegments,
  commitCameraCutUpsert,
  planCameraCutDrag,
  planCameraCutUpsert,
  planRedundantCameraCutCleanup,
  suggestCameraCutTarget,
  type CameraCutDragPlan,
} from '@/ui/CameraCutBar.helpers'
import {
  cameraCutDeleteKeyGuard,
  isCameraCutDeleteKey,
} from '@/ui/cameraCutKeyboard'

const CAMERA_CUT_DRAG_THRESHOLD_PX = 3

interface CameraCutDragSession {
  pointerId: number
  cutId: string
  startClientX: number
  cuts: CameraCut[]
  dragging: boolean
  plan: CameraCutDragPlan | null
}

/**
 * Camera switching controls rendered in the right Properties inspector.
 *
 * Timing stays in CameraCutTimelineLane; this component only owns authored
 * choices and the add/replace action. Keeping the surfaces separate removes a
 * second miniature time ruler without hiding camera output state.
 */
export function SceneCameraControls() {
  const model = useCameraCutModel()
  const [preferredCutCameraId, setPreferredCutCameraId] = useState('')
  if (!model) return null

  const {
    project,
    sceneApi,
    scene,
    ownedCameras,
    cameraById,
    cuts,
    cutsHere,
    programCamera,
    editorViewValue,
    setCameraView,
    playhead,
    frameRate,
  } = model
  const programCameras = ownedCameras.map((camera) => ({
    id: camera.id,
    enabled: camera.enabled,
  }))
  const enabledCameras = ownedCameras.filter(
    (camera) => camera.enabled !== false,
  )
  const simpleTwoCameraMode = enabledCameras.length === 2
  const existingCutCameraId = cutsHere.at(-1)?.cameraId
  const existingCutChangesProgram =
    existingCutCameraId !== undefined &&
    cameraCutChangesProgram({
      scene,
      playhead,
      frameRate,
      cameras: programCameras,
      targetCameraId: existingCutCameraId,
      fallbackCameraId: sceneApi.getDefaultCameraId(),
    })
  const suggestedCutCameraId =
    suggestCameraCutTarget({
      cameras: programCameras,
      currentCameraId: programCamera?.id,
      // Keep a useful same-frame assignment, but automatically repair a
      // repeated same-camera marker instead of trapping the two-camera flow
      // behind a disabled action.
      existingCutCameraId:
        !simpleTwoCameraMode && existingCutChangesProgram
        ? existingCutCameraId
        : undefined,
      preferredCameraId: simpleTwoCameraMode
        ? undefined
        : preferredCutCameraId,
    }) ?? ''
  const usefulCutCameras = enabledCameras.filter((camera) =>
    cameraCutChangesProgram({
      scene,
      playhead,
      frameRate,
      cameras: programCameras,
      targetCameraId: camera.id,
      fallbackCameraId: sceneApi.getDefaultCameraId(),
    }),
  )
  const cutCameraId = simpleTwoCameraMode
    ? suggestedCutCameraId
    : usefulCutCameras.some(
          (camera) => camera.id === suggestedCutCameraId,
        )
      ? suggestedCutCameraId
      : usefulCutCameras[0]?.id ?? ''
  const cutTargetCamera = cutCameraId
    ? cameraById.get(cutCameraId) ?? null
    : null
  const cutChangesProgram =
    cutCameraId !== '' &&
    cameraCutChangesProgram({
      scene,
      playhead,
      frameRate,
      cameras: programCameras,
      targetCameraId: cutCameraId,
      fallbackCameraId: sceneApi.getDefaultCameraId(),
    })
  const canApplyCut =
    cutCameraId !== '' &&
    (cutChangesProgram ||
      (simpleTwoCameraMode && cutsHere.length > 0))
  const lockedEditorCamera =
    editorViewValue === 'program'
      ? null
      : cameraById.get(editorViewValue) ?? null

  const addOrReplaceCut = () => {
    if (!cutCameraId || !canApplyCut) return
    const plan = planCameraCutUpsert({
      cuts,
      playhead,
      duration: scene.duration,
      frameRate,
      cameraId: cutCameraId,
      createId: createCameraCutId,
    })
    const plannedCuts = Object.fromEntries(
      [
        ...cuts.filter(
          (cut) => !plan.removeCutIds.includes(cut.id),
        ),
        plan.cut,
      ].map((cut) => [cut.id, cut]),
    )
    const cleanup = simpleTwoCameraMode
      ? planRedundantCameraCutCleanup({
          scene: { ...scene, cameraCuts: plannedCuts },
          frameRate,
          cameras: programCameras,
          fallbackCameraId: sceneApi.getDefaultCameraId(),
        })
      : { removeCutIds: [], changed: false }
    sceneApi.doc.transact(
      () => {
        commitCameraCutUpsert(plan, {
          removeCut: (cutId) =>
            project.removeCameraCut(scene.id, cutId),
          upsertCut: (cut) => project.upsertCameraCut(scene.id, cut),
          revealProgramOutput: () =>
            setCameraView(scene.id, { mode: 'program' }),
        })
        for (const cutId of cleanup.removeCutIds) {
          project.removeCameraCut(scene.id, cutId)
        }
      },
      UNDOABLE_GESTURE_ORIGIN,
    )
    setPreferredCutCameraId('')
  }

  return (
    <section
      data-camera-cut-controls="1"
      data-timeline-selection-surface="1"
      aria-labelledby="camera-switching-heading"
    >
      <div className="mb-2 flex items-center gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Camera
            size={14}
            aria-hidden
            className="shrink-0 text-accent"
          />
          <h3
            id="camera-switching-heading"
            className="hm-section-heading truncate"
          >
            Camera switching
          </h3>
        </div>
      </div>

      <div className="space-y-2">
        <div
          data-camera-program-now={programCamera?.id ?? 'none'}
          className="flex min-w-0 items-baseline gap-2 py-1"
        >
          <span className="shrink-0 text-[10px] text-text-dim">
            Program now
          </span>
          <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-text">
            {programCamera?.name ?? 'No enabled camera'}
          </span>
          <span className="shrink-0 font-mono text-[9px] tabular-nums text-text-dim">
            {formatTime(playhead)}
          </span>
        </div>

        {lockedEditorCamera ? (
          <button
            type="button"
            data-camera-editor-view-locked={lockedEditorCamera.id}
            onClick={() => setCameraView(scene.id, { mode: 'program' })}
            aria-label={`Return editor view to Program output from ${lockedEditorCamera.name}`}
            title="Return editor view to Program output"
            className="hm-control-surface flex min-h-7 w-full items-center gap-2 px-2 py-1.5 text-left active:scale-[0.98]"
          >
            <EyeOff
              size={12}
              aria-hidden
              className="shrink-0 text-accent"
            />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-[10px] font-medium text-text">
                Viewing {lockedEditorCamera.name}
              </div>
              <div className="mt-0.5 text-[9px] text-text-dim">
                Click to return to Program
              </div>
            </div>
          </button>
        ) : null}

        {enabledCameras.length < 2 ? (
          <div
            role="status"
            data-camera-cut-needs-camera="1"
            className="rounded-[var(--radius-control)] border border-dashed border-border px-2.5 py-2 text-[10px] leading-snug text-text-dim"
          >
            Add another enabled camera in Layers to create a switch.
          </div>
        ) : (
          <>
            {!simpleTwoCameraMode ? (
              <CameraSelect
                label="Switch to"
                title="Camera that becomes Program at the current playhead"
                value={cutCameraId}
                cameras={usefulCutCameras}
                disabled={usefulCutCameras.length === 0}
                onChange={setPreferredCutCameraId}
              />
            ) : null}

            <div className="flex gap-2">
              <button
                type="button"
                data-camera-cut-primary-action="1"
                onClick={addOrReplaceCut}
                disabled={!canApplyCut}
                aria-keyshortcuts="Meta+B Control+B"
                title={
                  !canApplyCut
                    ? 'Choose a different enabled camera'
                    : cutsHere.length > 0
                    ? `Replace the camera cut at ${formatTime(playhead)} · ⌘B`
                    : `Add a camera cut at ${formatTime(playhead)} · ⌘B`
                }
                className="hm-primary-action h-7 flex-1 px-2 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span className="truncate">
                  {simpleTwoCameraMode && cutTargetCamera
                    ? `Switch to ${cutTargetCamera.name} at ${formatTime(playhead)}`
                    : cutsHere.length > 0
                    ? `Replace cut at ${formatTime(playhead)}`
                    : `Add cut at ${formatTime(playhead)}`}
                </span>
              </button>

              {cutsHere.length > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    sceneApi.doc.transact(() => {
                      for (const cut of cutsHere) {
                        project.removeCameraCut(scene.id, cut.id)
                      }
                    }, UNDOABLE_GESTURE_ORIGIN)
                  }}
                  aria-label="Delete camera cut at playhead"
                  title="Delete camera cut at playhead"
                  className="hm-icon-button h-7 w-7 shrink-0 border border-border hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-500"
                >
                  <Trash2 size={12} />
                </button>
              ) : null}
            </div>
          </>
        )}
      </div>
    </section>
  )
}

/** Label paired with CameraCutTimelineLane in Timeline's sticky left column. */
export function CameraCutTimelineLeftRow() {
  const model = useCameraCutModel()
  if (!model) return null
  return (
    <div
      data-camera-cut-lane-label="1"
      className="flex h-7 items-center gap-2 border-b border-border bg-panel-raised/45 px-3"
    >
      <Camera size={12} className="shrink-0 text-accent" />
      <span className="truncate text-[9px] font-semibold tracking-[0.07em] text-text-muted uppercase">
        Camera cuts
      </span>
      <span className="ml-auto rounded bg-panel-raised px-1 font-mono text-[8px] tabular-nums text-text-dim">
        {model.cuts.length}
      </span>
    </div>
  )
}

/**
 * Program-camera spans and cut markers in the keyframe timeline coordinate
 * system. The shared ruler, zoom, scroll position, and playhead now describe
 * camera switching directly—there is no detached mini timeline.
 */
export function CameraCutTimelineLane({
  duration,
  totalWidth,
  pxPerSecond,
}: {
  duration: number
  totalWidth: number
  pxPerSecond: number
}) {
  const model = useCameraCutModel()
  const [dragPreview, setDragPreview] =
    useState<CameraCutDragPlan | null>(null)
  const dragSessionRef = useRef<CameraCutDragSession | null>(null)
  const suppressMarkerClickRef = useRef<string | null>(null)
  const setPlayhead = useUI((state) => state.setPlayhead)
  const setPlaying = useUI((state) => state.setPlaying)
  const openContextMenu = useUI((state) => state.openContextMenu)
  if (!model) return null

  const {
    project,
    scene,
    sceneApi,
    ownedCameras,
    cameraById,
    cuts,
    playhead,
    frameRate,
  } = model
  const displayCuts = dragPreview?.previewCuts ?? cuts
  const displayScene = dragPreview
    ? {
        ...scene,
        cameraCuts: Object.fromEntries(
          displayCuts.map((cut) => [cut.id, cut]),
        ),
      }
    : scene
  const segments = cameraProgramSegments({
    scene: displayScene,
    frameRate,
    cameras: ownedCameras.map((camera) => ({
      id: camera.id,
      enabled: camera.enabled,
    })),
    fallbackCameraId: sceneApi.getDefaultCameraId(),
  })
  const displayProgram = resolveProgramCamera({
    scene: displayScene,
    localTime: playhead,
    frameRate,
    cameras: ownedCameras.map((camera) => ({
      id: camera.id,
      enabled: camera.enabled,
    })),
    fallbackCameraId: sceneApi.getDefaultCameraId(),
  })
  const seek = (time: number) => {
    setPlaying(false)
    setPlayhead(Math.max(0, Math.min(duration, time)))
  }
  const commitDragPlan = (plan: CameraCutDragPlan) => {
    sceneApi.doc.transact(() => {
      for (const cutId of plan.removeCutIds) {
        project.removeCameraCut(scene.id, cutId)
      }
      project.upsertCameraCut(scene.id, plan.cut)
    }, UNDOABLE_GESTURE_ORIGIN)
  }
  const beginCutDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    cut: CameraCut,
  ) => {
    event.stopPropagation()
    if (event.button !== 0) return
    event.currentTarget.focus({ preventScroll: true })
    setPlaying(false)
    event.currentTarget.setPointerCapture(event.pointerId)
    dragSessionRef.current = {
      pointerId: event.pointerId,
      cutId: cut.id,
      startClientX: event.clientX,
      cuts: [...cuts],
      dragging: false,
      plan: null,
    }
  }
  const previewCutDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    const session = dragSessionRef.current
    if (!session || session.pointerId !== event.pointerId) return
    if (
      !session.dragging &&
      Math.abs(event.clientX - session.startClientX) <
        CAMERA_CUT_DRAG_THRESHOLD_PX
    ) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    session.dragging = true
    const lane = event.currentTarget.parentElement
    if (!lane) return
    const rect = lane.getBoundingClientRect()
    const plan = planCameraCutDrag({
      cuts: session.cuts,
      cutId: session.cutId,
      time: (event.clientX - rect.left) / Math.max(1, pxPerSecond),
      duration,
      frameRate,
    })
    if (!plan) return
    session.plan = plan
    setDragPreview(plan)
  }
  const finishCutDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    commit: boolean,
  ) => {
    const session = dragSessionRef.current
    if (!session || session.pointerId !== event.pointerId) return
    event.stopPropagation()
    if (session.dragging) event.preventDefault()
    dragSessionRef.current = null
    setDragPreview(null)
    if (!session.dragging) return

    // A drag still produces a browser click after pointerup. Suppress exactly
    // that click so retiming never also seeks or Option-deletes the cut.
    suppressMarkerClickRef.current = session.cutId
    window.setTimeout(() => {
      if (suppressMarkerClickRef.current === session.cutId) {
        suppressMarkerClickRef.current = null
      }
    }, 0)
    if (commit && session.plan?.changed) commitDragPlan(session.plan)
  }

  return (
    <div
      data-camera-cut-lane="1"
      className="relative h-7 overflow-hidden border-b border-border bg-panel-raised/20"
      style={{ width: totalWidth }}
      onPointerDown={(event) => {
        if (
          event.button !== 0 ||
          (event.target as Element).closest('button')
        ) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        const rect = event.currentTarget.getBoundingClientRect()
        seek((event.clientX - rect.left) / Math.max(1, pxPerSecond))
      }}
    >
      {segments.map((segment) => {
        const camera = segment.cameraId
          ? cameraById.get(segment.cameraId)
          : null
        const active =
          playhead >= segment.start &&
          (playhead < segment.end ||
            (segment.end === duration && playhead === duration))
        return (
          <button
            key={segment.id}
            type="button"
            data-camera-program-segment={segment.cameraId ?? 'none'}
            onClick={() => seek(segment.start)}
            title={`${formatTime(segment.start)}–${formatTime(segment.end)} · ${camera?.name ?? 'No camera'}`}
            className={[
              'absolute inset-y-1 flex min-w-0 items-center overflow-hidden rounded-sm border px-2 text-left',
              active
                ? 'border-accent/55 bg-accent-soft text-accent'
                : 'border-border/80 bg-panel text-text-muted hover:border-border-strong hover:text-text',
            ].join(' ')}
            style={{
              left: segment.start * pxPerSecond + 2,
              width: Math.max(
                1,
                (segment.end - segment.start) * pxPerSecond - 4,
              ),
            }}
          >
            <span className="truncate text-[9px] font-medium">
              {camera?.name ?? 'No camera'}
            </span>
          </button>
        )
      })}

      {displayCuts.map((cut) => {
        const camera = cameraById.get(cut.cameraId)
        const active = displayProgram.resolvedCut?.id === cut.id
        const dragging = dragPreview?.cut.id === cut.id
        return (
          <button
            key={cut.id}
            type="button"
            data-camera-cut-marker={cut.id}
            data-camera-cut-dragging={dragging ? 'true' : undefined}
            onPointerDown={(event) => beginCutDrag(event, cut)}
            onPointerMove={previewCutDrag}
            onPointerUp={(event) => finishCutDrag(event, true)}
            onPointerCancel={(event) => finishCutDrag(event, false)}
            onLostPointerCapture={(event) => finishCutDrag(event, true)}
            onClick={(event) => {
              event.stopPropagation()
              if (suppressMarkerClickRef.current === cut.id) {
                suppressMarkerClickRef.current = null
                return
              }
              if (event.altKey) {
                sceneApi.doc.transact(
                  () => project.removeCameraCut(scene.id, cut.id),
                  UNDOABLE_GESTURE_ORIGIN,
                )
                return
              }
              seek(cut.time)
            }}
            onKeyDown={(event) => {
              if (isCameraCutDeleteKey(event.key)) {
                cameraCutDeleteKeyGuard.claim(event.key)
                event.preventDefault()
                event.stopPropagation()
                sceneApi.doc.transact(
                  () => project.removeCameraCut(scene.id, cut.id),
                  UNDOABLE_GESTURE_ORIGIN,
                )
                return
              }
              if (
                event.key !== 'ArrowLeft' &&
                event.key !== 'ArrowRight'
              ) {
                return
              }
              event.preventDefault()
              event.stopPropagation()
              const direction = event.key === 'ArrowRight' ? 1 : -1
              if (direction > 0 && cut.time >= duration) return
              const frames = event.shiftKey ? 10 : 1
              const plan = planCameraCutDrag({
                cuts,
                cutId: cut.id,
                time: cut.time + direction * (frames / frameRate),
                duration,
                frameRate,
              })
              if (plan?.changed) commitDragPlan(plan)
            }}
            onContextMenu={(event) => {
              event.preventDefault()
              event.stopPropagation()
              openContextMenu({
                x: event.clientX,
                y: event.clientY,
                items: [
                  {
                    label: `Go to ${formatTime(cut.time)}`,
                    onClick: () => seek(cut.time),
                  },
                  { kind: 'separator' },
                  {
                    label: 'Delete camera cut',
                    danger: true,
                    onClick: () =>
                      sceneApi.doc.transact(
                        () => project.removeCameraCut(scene.id, cut.id),
                        UNDOABLE_GESTURE_ORIGIN,
                      ),
                  },
                ],
              })
            }}
            aria-label={`Camera cut at ${formatTime(cut.time)} to ${camera?.name ?? 'camera'}. Drag horizontally or use arrow keys to retime.`}
            aria-roledescription="draggable camera cut"
            aria-keyshortcuts="ArrowLeft ArrowRight Delete Backspace"
            aria-current={active ? 'true' : undefined}
            title={`${formatTime(cut.time)} · ${camera?.name ?? cut.cameraId} · Drag to retime · Arrow keys nudge · Right-click or Option-click to delete`}
            className={[
              'absolute top-1/2 z-[31] h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rotate-45 cursor-ew-resize touch-none border ring-2 ring-panel shadow-sm active:cursor-grabbing focus:outline-none focus:ring-accent',
              active
                ? 'border-accent bg-accent'
                : 'border-border-strong bg-panel-raised hover:border-accent',
            ].join(' ')}
            style={{ left: cut.time * pxPerSecond }}
          />
        )
      })}
    </div>
  )
}

function useCameraCutModel() {
  const project = useProjectAPI()
  const sceneApi = useSceneAPI()
  useSceneVersion()
  const timelineScope = useUI((state) => state.timelineScope)
  const playhead = useUI((state) => state.playhead)
  const cameraViews = useUI((state) => state.cameraViewByComposition)
  const setCameraView = useUI((state) => state.setCameraView)

  const scene = project.getActiveScene()
  // A Master playhead can map to overlapping occurrences. Camera cuts remain
  // authored in the unambiguous scene-local timeline.
  if (timelineScope !== 'scene' || !scene) return null

  const ownedCameras = scene.cameraIds
    .map((cameraId) => sceneApi.getNode(cameraId))
    .filter(
      (node): node is CameraNode =>
        node?.kind === 'camera' && node.parent === null,
    )
  const cameraById = new Map(
    ownedCameras.map((camera) => [camera.id, camera]),
  )
  const frameRate = sceneApi.getMeta().frameRate
  const cuts = normalizeCameraCuts(scene.cameraCuts, {
    duration: scene.duration,
    frameRate,
  }).filter((cut) => cameraById.has(cut.cameraId))
  const program = resolveProgramCamera({
    scene,
    localTime: playhead,
    frameRate,
    cameras: ownedCameras.map((camera) => ({
      id: camera.id,
      enabled: camera.enabled,
    })),
    fallbackCameraId: sceneApi.getDefaultCameraId(),
  })
  const programCamera = program.cameraId
    ? cameraById.get(program.cameraId) ?? null
    : null
  const defaultCameraId =
    scene.defaultCameraId && cameraById.has(scene.defaultCameraId)
      ? scene.defaultCameraId
      : ''
  const cameraView = cameraViews[scene.id] ?? { mode: 'program' as const }
  const editorViewValue =
    cameraView.mode === 'camera' && cameraById.has(cameraView.cameraId)
      ? cameraView.cameraId
      : 'program'
  const cutsHere = cameraCutsAtPlayhead(
    cuts,
    playhead,
    scene.duration,
    frameRate,
  )

  return {
    project,
    sceneApi,
    scene,
    ownedCameras,
    cameraById,
    frameRate,
    cuts,
    cutsHere,
    program,
    programCamera,
    defaultCameraId,
    editorViewValue,
    setCameraView,
    playhead,
  }
}

function CameraSelect({
  label,
  title,
  value,
  cameras,
  disabled,
  onChange,
}: {
  label: string
  title: string
  value: string
  cameras: readonly CameraNode[]
  disabled: boolean
  onChange: (cameraId: string) => void
}) {
  return (
    <label
      className="block text-[10px] font-medium text-text-muted"
      title={title}
    >
      {label}
      <select
        aria-label={`${label} camera`}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="hm-control-surface mt-1 h-7 w-full px-2 text-[11px] text-text outline-none disabled:opacity-40"
      >
        {cameras.length === 0 && <option value="">No cameras</option>}
        {cameras.length > 0 && !value && (
          <option value="" disabled>
            Select camera
          </option>
        )}
        {cameras.map((camera) => (
          <option key={camera.id} value={camera.id}>
            {camera.name}
          </option>
        ))}
      </select>
    </label>
  )
}

function formatTime(time: number): string {
  return `${Math.max(0, time).toFixed(2)}s`
}

function createCameraCutId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `cut_${crypto.randomUUID()}`
  }
  return `cut_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}
