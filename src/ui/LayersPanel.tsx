// SPDX-License-Identifier: Apache-2.0

import {
  memo,
  useMemo,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from 'react'
import { getAnimEngine } from '@/anim'
import { useProjectAPI } from '@/project'
import { useSceneAPI, useSceneVersion } from '@/scene'
import type { CameraNode, Node, NodeId, NodeKind } from '@/scene'
import type { SceneAPI } from '@/scene/doc'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import { useUI } from '@/state/ui'
import { buildNodeContextMenu } from '@/ui/contextMenuActions'
import { instantiateComponent, setLockedRecursive } from '@/ui/actions'
import {
  addCamera,
  deleteCameraSafely,
  duplicateCamera,
  listSceneCameras,
  setSceneDefaultCamera,
} from '@/ui/cameraActions'
import {
  planCameraRowProgramSwitch,
  resolveCameraRowIndicators,
} from '@/ui/cameraRowIndicators'
import { AppIcon, type AppIconName } from '@/ui/AppIcon'
import { getLastSolvedLayout } from '@/ui/hooks/lastSolvedLayout'
import { createProgramCameraPreviewSnapshot } from '@/ui/programCameraPreview'
import {
  fitWorkspaceBounds,
  type WorkspaceBounds,
} from '@/ui/workspaceFocus'

const ASSET_LIBRARY_ENABLED = false

/**
 * Layers panel.
 *
 * Step 3.6 polish: each row shows an eye and a lock toggle, names are
 * editable inline (double-click), and rows can be drag-reordered within
 * their parent's children array using native HTML5 drag-and-drop.
 *
 * Drag behavior:
 *   - You can drag any non-root row.
 *   - Drop target: three vertical zones on the target row.
 *       Top 25%    → drop as a sibling *above* the target
 *       Middle 50% → drop *into* the target as a new child, but only
 *                    when the target is a container (frame / component
 *                    / instance). Leaves like rect / text / image skip
 *                    the middle zone — dropping on them falls through
 *                    to above/below.
 *       Bottom 25% → drop as a sibling *below* the target
 *   - Drop across parents is allowed (reparents), but we guard against
 *     dropping into your own descendant (would create a cycle).
 *
 * Kept on native HTML5 DnD instead of @dnd-kit to avoid an install. The
 * tree is shallow in practice and native DnD is fine at this size.
 */
export function LayersPanel() {
  useSceneVersion()
  const api = useSceneAPI()
  const project = useProjectAPI()
  const rootId = api.getRoot()
  const root = rootId ? api.getNode(rootId) : null
  const componentEditId = useUI((s) => s.componentEditId)
  const editMaster = componentEditId ? api.getNode(componentEditId) : null
  const cameras = listSceneCameras(api)
  const defaultCameraId = api.getDefaultCameraId()
  const activeScene = project.getActiveScene()
  const programCameras = useMemo(
    () =>
      activeScene
        ? activeScene.cameraIds
            .map((cameraId) => api.getNode(cameraId))
            .filter(
              (node): node is CameraNode =>
                node?.kind === 'camera' && node.parent === null,
            )
            .map((camera) => ({
              id: camera.id,
              enabled: camera.enabled,
            }))
        : [],
    [activeScene, api],
  )
  const programCameraSnapshot = useMemo(
    () =>
      activeScene
        ? createProgramCameraPreviewSnapshot({
            scene: activeScene,
            frameRate: api.getMeta().frameRate,
            cameras: programCameras,
            fallbackCameraId: defaultCameraId,
            previewScope: 'scene',
            editorView: { mode: 'program' },
            readLocalTime: getAnimEngine().getPlayhead,
          })
        : () => defaultCameraId,
    [
      activeScene,
      api,
      defaultCameraId,
      programCameras,
    ],
  )
  const programCameraId = useSyncExternalStore(
    getAnimEngine().subscribe,
    programCameraSnapshot,
    programCameraSnapshot,
  )
  const pasteboardNodes = api
    .getAllNodeIds()
    .map((id) => api.getNode(id))
    .filter((node): node is Node => !!node && !!node.workspaceOnly && node.parent === null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const width = useUI((s) => s.layersWidth)
  const setWidth = useUI((s) => s.setLayersWidth)
  const setView = useUI((s) => s.setView)
  const [tab, setTab] = useState<'layers' | 'components'>('layers')
  const [componentsModalOpen, setComponentsModalOpen] = useState(false)

  const showWorkspaceItems = (nodes: Node[], includeOutputScene: boolean) => {
    const workspace = document.querySelector<HTMLElement>(
      '[data-canvas-workspace="1"]',
    )
    const viewportRect = workspace?.parentElement?.getBoundingClientRect()
    const canvas = api.getMeta().canvas ?? { width: 960, height: 540 }
    if (!viewportRect) return

    const bounds = nodes
      .map(workspaceBoundsForNode)
      .filter((item): item is WorkspaceBounds => item !== null)
    if (includeOutputScene) {
      bounds.unshift({
        x: 0,
        y: 0,
        width: canvas.width,
        height: canvas.height,
      })
    }
    const nextView = fitWorkspaceBounds({
      bounds,
      artboardWidth: canvas.width,
      artboardHeight: canvas.height,
      viewportWidth: viewportRect.width,
      viewportHeight: viewportRect.height,
      maxZoom: includeOutputScene ? 1.25 : 2,
    })
    if (nextView) setView(nextView)
  }

  // Resize: pointer drag on the right edge writes the new width.
  // Pointer capture survives leaving the handle so the user can drag
  // off-element without the resize stopping mid-stride.
  const onResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    const startX = e.clientX
    const startWidth = width
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const onMove = (ev: PointerEvent) => {
      setWidth(startWidth + (ev.clientX - startX))
    }
    const onUp = (ev: PointerEvent) => {
      try {
        ;(e.currentTarget as HTMLElement).releasePointerCapture(ev.pointerId)
      } catch {
        /* already released */
      }
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  return (
    <aside
      className="relative flex shrink-0 flex-col border-r border-border bg-panel"
      style={{ width }}
    >
      <LayerSelectionReveal scrollerRef={scrollerRef} />
      <div className="flex h-12 shrink-0 items-center border-b border-border px-3">
        <div className="hm-control-surface hm-inspector-segmented">
          <SidebarTab
            active={tab === 'layers'}
            label="Layers"
            onClick={() => setTab('layers')}
          />
          <SidebarTab
            active={tab === 'components'}
            label="Assets"
            onClick={() => setTab('components')}
          />
        </div>
      </div>
      {tab === 'layers' ? (
        <div ref={scrollerRef} className="flex-1 overflow-auto py-2">
          {editMaster && editMaster.kind === 'component' ? (
            <>
              <div className="px-3 pb-2 text-[10px] font-medium text-accent">
                Master component
              </div>
              <Row node={editMaster} depth={0} rootId={editMaster.id} />
            </>
          ) : (
            <>
          {/* Cameras sit above the artboard tree as their own section. They
              are scene-level nodes (parent: null, not children of root), so
              the regular tree walk cannot surface them. A row click selects
              a camera for Inspector; its square authors Program output at the
              playhead. Advanced editor-only viewing stays in Properties. */}
          <CamerasSection
            cameras={cameras}
            defaultCameraId={defaultCameraId}
            programCameraId={programCameraId}
          />
          {root ? (
            <>
              <PanelSectionLabel label="Scene layers" />
              <Row node={root} depth={0} rootId={rootId} />
            </>
          ) : (
            <p className="px-3 py-4 text-text-dim">
              Empty scene.
              <br />
              <span className="text-[11px]">Press R to draw a rectangle.</span>
            </p>
          )}
          {pasteboardNodes.length > 0 ? (
            <div className="mt-3 border-t border-border pt-2">
              <div className="flex items-center justify-between gap-2 px-3 pb-1">
                <div className="text-[11px] font-medium text-text-muted">
                  Workspace · {pasteboardNodes.length}
                </div>
                <button
                  type="button"
                  onClick={() => showWorkspaceItems(pasteboardNodes, true)}
                  className="rounded px-1.5 py-0.5 text-[10px] font-medium text-text-muted hover:bg-panel-raised hover:text-text"
                  title="Fit the output scene and all workspace items on screen"
                >
                  Show all
                </button>
              </div>
              {pasteboardNodes.map((node) => (
                <Row key={node.id} node={node} depth={0} rootId={rootId} />
              ))}
            </div>
          ) : null}
            </>
          )}
        </div>
      ) : (
        <ComponentsPanel onViewAll={() => setComponentsModalOpen(true)} />
      )}
      {ASSET_LIBRARY_ENABLED && componentsModalOpen ? (
        <ComponentsModal onClose={() => setComponentsModalOpen(false)} />
      ) : null}
      {/* Right-edge drag handle. 4px wide, sits half-outside the panel
          so the handle hit area straddles the border line — easier to
          grab than a 1px border. */}
      <div
        onPointerDown={onResizeDown}
        title="Drag to resize"
        className="absolute right-0 top-0 z-10 h-full w-1 -translate-x-1/2 cursor-col-resize hover:bg-accent/50"
      />
    </aside>
  )
}

function PanelSectionLabel({
  label,
  meta,
}: {
  label: string
  meta?: string
}) {
  return (
    <div className="mt-1 flex items-center justify-between gap-2 px-3 pb-1 pt-1 text-[11px] font-medium text-text-muted">
      <span>{label}</span>
      {meta ? <span className="font-normal tracking-normal">{meta}</span> : null}
    </div>
  )
}

function SidebarTab({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-active={active ? 'true' : 'false'}
      className="hm-inspector-segment"
    >
      {label}
    </button>
  )
}

function ComponentsPanel({ onViewAll }: { onViewAll: () => void }) {
  useSceneVersion()
  const api = useSceneAPI()
  const components = listComponents(api)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-3">
        <span className="text-[11px] font-medium text-text-muted">
          Asset library
        </span>
        <div className="flex items-center gap-1">
          <span
            role="status"
            className="rounded border border-border bg-panel-raised px-1.5 py-0.5 text-[9px] font-semibold text-text-dim"
          >
            Coming soon
          </span>
          <button
            type="button"
            disabled={!ASSET_LIBRARY_ENABLED}
            onClick={onViewAll}
            title="Coming soon"
            className="rounded px-1.5 py-1 text-[9px] font-medium text-text-dim disabled:cursor-not-allowed disabled:opacity-45"
          >
            View all
          </button>
        </div>
      </div>
      <div
        aria-disabled="true"
        className="pointer-events-none flex-1 select-none overflow-auto py-2 opacity-35"
      >
        {components.length === 0 ? (
          <p className="px-3 py-4 text-[11px] text-text-dim">
            Components
            <br />
            <span className="text-[10px]">Reusable assets will appear here.</span>
          </p>
        ) : (
          components.map((component) => (
            <button
              key={component.id}
              type="button"
              disabled
              draggable={false}
              className="group flex w-full cursor-not-allowed items-center gap-2 px-3 py-2 text-left text-[11px] text-text-muted"
            >
              <span className="text-accent">
                <AppIcon name="nodes" size={12} />
              </span>
              <span className="min-w-0 flex-1 truncate">{component.name}</span>
              <span className="text-[10px] text-text-dim">
                {api.getChildren(component.id).length}
              </span>
            </button>
          ))
        )}
      </div>
      <div
        aria-disabled="true"
        className="pointer-events-none select-none border-t border-border px-3 py-3 opacity-35"
      >
        <div className="text-[10px] font-medium text-text-dim">
          Imported assets
        </div>
        <div className="mt-2 rounded-md border border-dashed border-border px-3 py-2 text-[10px] text-text-dim">
          Images and media
        </div>
      </div>
    </div>
  )
}

function ComponentsModal({ onClose }: { onClose: () => void }) {
  useSceneVersion()
  const api = useSceneAPI()
  const rootId = api.getRoot()
  const components = listComponents(api)
  const [query, setQuery] = useState('')
  const [activeId, setActiveId] = useState<string | null>(
    components[0]?.id ?? null,
  )
  const setSelection = useUI((s) => s.setSelection)
  const filtered = components.filter((component) =>
    component.name.toLowerCase().includes(query.trim().toLowerCase()),
  )
  const active =
    filtered.find((component) => component.id === activeId) ??
    filtered[0] ??
    null

  const insert = () => {
    if (!active || !rootId) return
    const meta = api.getMeta()
    const id = instantiateComponent(api, active.id, rootId, {
      absolute: true,
      position: {
        x: Math.round(meta.canvas.width / 2 - 80),
        y: Math.round(meta.canvas.height / 2 - 60),
      },
    })
    if (id) setSelection([id])
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45">
      <div className="hm-dialog-surface flex h-[620px] w-[860px] flex-col">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-[15px] font-semibold text-text">
            Components
          </h2>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search components"
            className="hm-control-surface mt-3 h-8 w-full px-3 text-[13px] text-text outline-none placeholder:text-text-dim"
          />
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-[220px_1fr]">
          <div className="border-r border-border bg-app-bg/40 p-2">
            {filtered.length === 0 ? (
              <p className="px-2 py-3 text-[12px] text-text-dim">
                No matches.
              </p>
            ) : (
              filtered.map((component) => {
                const selected = component.id === active?.id
                return (
                  <button
                    key={component.id}
                    type="button"
                    onClick={() => setActiveId(component.id)}
                    className={[
                      'flex w-full items-center gap-2 rounded px-2 py-2 text-left text-[12px]',
                      selected
                        ? 'text-text'
                        : 'text-text-muted hover:bg-panel-raised hover:text-text',
                    ].join(' ')}
                    style={
                      selected
                        ? { backgroundColor: 'var(--color-accent-soft)' }
                        : undefined
                    }
                  >
                    <span className="text-accent">
                      <AppIcon name="nodes" size={13} />
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {component.name}
                    </span>
                  </button>
                )
              })
            )}
          </div>
          <div className="flex min-h-0 flex-col p-5">
            {active ? (
              <>
                <div className="flex flex-1 items-center justify-center rounded-md border border-border bg-app-bg">
                  <div className="rounded-md border border-accent/55 bg-panel px-8 py-6 text-center shadow-lg">
                    <div className="flex justify-center text-accent">
                      <AppIcon name="nodes" size={28} />
                    </div>
                    <div className="mt-2 text-[14px] font-semibold text-text">
                      {active.name}
                    </div>
                    <div className="mt-1 text-[11px] text-text-dim">
                      Master component
                    </div>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-3 gap-3 text-[12px]">
                  <ComponentFact label="Name" value={active.name} />
                  <ComponentFact
                    label="Children"
                    value={String(api.getChildren(active.id).length)}
                  />
                  <ComponentFact
                    label="Instances"
                    value={String(countInstances(api, active.id))}
                  />
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center text-[13px] text-text-dim">
                No component selected.
              </div>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="hm-secondary-action"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={insert}
            disabled={!active}
            className="hm-primary-action disabled:cursor-not-allowed disabled:opacity-40"
          >
            Insert
          </button>
        </div>
      </div>
    </div>
  )
}

function ComponentFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-panel-raised px-3 py-2">
      <div className="text-[10px] text-text-dim">
        {label}
      </div>
      <div className="mt-1 truncate text-[12px] font-medium text-text">
        {value}
      </div>
    </div>
  )
}

function listComponents(api: SceneAPI): Extract<Node, { kind: 'component' }>[] {
  return api
    .getAllNodeIds()
    .map((id) => api.getNode(id))
    .filter(
      (node): node is Extract<Node, { kind: 'component' }> =>
        !!node && node.kind === 'component',
    )
}

function countInstances(api: SceneAPI, componentId: NodeId): number {
  let count = 0
  for (const id of api.getAllNodeIds()) {
    const node = api.getNode(id)
    if (node?.kind === 'instance' && node.componentId === componentId) {
      count++
    }
  }
  return count
}

function CamerasSection({
  cameras,
  defaultCameraId,
  programCameraId,
}: {
  cameras: CameraNode[]
  defaultCameraId: NodeId | null
  programCameraId: NodeId | null
}) {
  return (
    <div className="mb-1 border-b border-border pb-1">
      <div className="flex h-6 items-center px-3">
        <span className="text-[11px] font-medium text-text-muted">
          Cameras
        </span>
        <span className="ml-1.5 rounded bg-panel-raised px-1 text-[9px] tabular-nums text-text-dim">
          {cameras.length}
        </span>
      </div>
      {cameras.map((camera) => (
        <CameraRow
          key={camera.id}
          node={camera}
          {...resolveCameraRowIndicators(
            camera.id,
            defaultCameraId,
            programCameraId,
          )}
          cameraCount={cameras.length}
        />
      ))}
      <AddCameraRow />
    </div>
  )
}

/**
 * Dedicated row for one scene-level camera.
 *
 * Clicking the row edits the camera in Inspector. The square is intentionally
 * simpler: it always means Program output at the current playhead.
 */
function CameraRow({
  node,
  isDefault,
  isProgramNow,
  cameraCount,
}: {
  node: CameraNode
  isDefault: boolean
  isProgramNow: boolean
  cameraCount: number
}) {
  const api = useSceneAPI()
  const project = useProjectAPI()
  const selection = useUI((s) => s.selection)
  const setSelection = useUI((s) => s.setSelection)
  const setCameraView = useUI((s) => s.setCameraView)
  const clearSelection = useUI((s) => s.clearSelection)
  const toggleInSelection = useUI((s) => s.toggleInSelection)
  const openContextMenu = useUI((s) => s.openContextMenu)
  const selected = selection.includes(node.id)
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(node.name)

  const commitName = () => {
    const name = draftName.trim()
    if (name && name !== node.name) api.setNodeProperty(node.id, 'name', name)
    setEditing(false)
  }

  const setAsProgramDefault = () => {
    if (api.getDefaultCameraId() !== node.id) {
      setSceneDefaultCamera(api, node.id)
    }
  }

  const switchProgramAtPlayhead = () => {
    const scene = project.getActiveScene()
    if (!scene) return
    const ui = useUI.getState()
    const playhead = ui.playing
      ? getAnimEngine().getPlayhead()
      : ui.playhead
    const cameras = scene.cameraIds
      .map((cameraId) => api.getNode(cameraId))
      .filter(
        (camera): camera is CameraNode =>
          camera?.kind === 'camera' && camera.parent === null,
      )
      .map((camera) => ({
        id: camera.id,
        enabled: camera.enabled,
      }))
    const plan = planCameraRowProgramSwitch({
      scene,
      playhead,
      frameRate: api.getMeta().frameRate,
      cameras,
      targetCameraId: node.id,
      fallbackCameraId: api.getDefaultCameraId(),
      createId: createLayersCameraCutId,
    })

    if (plan?.changed) {
      api.doc.transact(() => {
        if (plan.setDefaultCameraId) {
          project.setDefaultCamera(scene.id, plan.setDefaultCameraId)
        }
        for (const cutId of plan.removeCutIds) {
          project.removeCameraCut(scene.id, cutId)
        }
        if (plan.cut) {
          project.upsertCameraCut(scene.id, plan.cut)
        }
      }, UNDOABLE_GESTURE_ORIGIN)
    }

    // The Layers control always reveals the authored result. Editor-only
    // camera locks remain available in Properties when explicitly needed.
    setCameraView(scene.id, { mode: 'program' })
  }

  const duplicate = () => {
    const id = duplicateCamera(api, node.id)
    if (id) setSelection([id])
  }

  const remove = () => {
    const sceneId = project.getActiveSceneId()
    const editorView = sceneId
      ? useUI.getState().cameraViewByComposition[sceneId]
      : undefined
    const wasEditorViewLocked =
      editorView?.mode === 'camera' &&
      editorView.cameraId === node.id
    const wasDefault = api.getDefaultCameraId() === node.id
    const result = deleteCameraSafely(api, node.id)
    if (!result.deleted) return
    if (wasEditorViewLocked && sceneId) {
      setCameraView(sceneId, { mode: 'program' })
    }
    if (selection.includes(node.id)) {
      if (wasDefault && result.activeCameraId) {
        setSelection([result.activeCameraId])
      } else {
        clearSelection()
      }
    }
  }

  return (
    <div
      data-layer-row={node.id}
      onClick={(e) => {
        if (e.shiftKey || e.metaKey || e.ctrlKey) {
          toggleInSelection(node.id, true)
        } else {
          setSelection([node.id])
        }
      }}
      onDoubleClick={() => {
        setDraftName(node.name)
        setEditing(true)
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        if (!selection.includes(node.id)) setSelection([node.id])
        openContextMenu({
          x: e.clientX,
          y: e.clientY,
          items: [
            {
              label: isDefault
                ? 'Scene default camera'
                : 'Set as scene default',
              disabled: isDefault,
              onClick: setAsProgramDefault,
            },
            {
              label: 'Duplicate camera',
              onClick: duplicate,
            },
            { kind: 'separator' },
            {
              label:
                cameraCount <= 1
                  ? 'Keep at least one camera'
                  : 'Delete camera',
              disabled: cameraCount <= 1,
              danger: true,
              onClick: remove,
            },
          ],
        })
      }}
      className={[
        'group flex h-6 shrink-0 cursor-default items-center gap-1.5 px-3 text-[10px]',
        selected
          ? 'bg-accent-soft text-text'
          : 'text-text-muted hover:bg-app-bg hover:text-text',
      ].join(' ')}
    >
      <KindGlyph node={node} />
      {editing ? (
        <input
          autoFocus
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitName()
            if (e.key === 'Escape') setEditing(false)
          }}
          className="min-w-0 flex-1 bg-transparent outline-none"
        />
      ) : (
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          duplicate()
        }}
        title="Duplicate camera"
        aria-label={`Duplicate ${node.name}`}
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-text-dim opacity-0 transition-colors hover:bg-panel-raised hover:text-text group-hover:opacity-100"
      >
        <AppIcon name="copy" size={11} />
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          remove()
        }}
        disabled={cameraCount <= 1}
        title={
          cameraCount <= 1
            ? 'A scene must keep at least one camera'
            : 'Delete camera'
        }
        aria-label={`Delete ${node.name}`}
        className={[
          'flex h-4 w-4 shrink-0 items-center justify-center rounded opacity-0 transition-colors group-hover:opacity-100',
          cameraCount <= 1
            ? 'cursor-not-allowed text-text-dim/35'
            : 'text-text-dim hover:bg-[oklch(0.55_0.2_25)]/15 hover:text-[oklch(0.68_0.2_25)]',
        ].join(' ')}
      >
        <AppIcon name="trash" size={11} />
      </button>
      <LockToggle
        locked={node.locked}
        onClick={(e) => {
          e.stopPropagation()
          api.setNodeProperty(node.id, 'locked', !node.locked)
        }}
      />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          switchProgramAtPlayhead()
        }}
        title={
          node.enabled === false
            ? `${node.name} is disabled`
            : isProgramNow
            ? `${node.name} is on Program at the playhead`
            : `Switch Program to ${node.name} at the playhead`
        }
        disabled={node.enabled === false}
        aria-pressed={isProgramNow}
        aria-label={
          isProgramNow
            ? `${node.name} is the Program camera at the current playhead`
            : `Switch Program to ${node.name} at the current playhead`
        }
        data-program-camera-control={node.id}
        className={[
          'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
          isProgramNow
            ? 'border-accent bg-accent text-white'
            : node.enabled === false
            ? 'cursor-not-allowed border-border text-transparent opacity-35'
            : 'border-border text-transparent hover:border-accent hover:text-accent',
        ].join(' ')}
      >
        <AppIcon name="check" size={10} />
      </button>
    </div>
  )
}

/** Tiny lock indicator for the camera row. Kept inline since the main
 *  Row has its own version that operates recursively on children —
 *  cameras have no children, so the simpler form is enough here. */
function LockToggle({
  locked,
  onClick,
}: {
  locked: boolean
  onClick: (e: ReactMouseEvent) => void
}) {
  return (
    <button
      onClick={onClick}
      title={locked ? 'Unlock' : 'Lock'}
      className={[
        'flex h-4 w-4 items-center justify-center rounded text-[10px] transition-colors',
        locked
          ? 'text-text opacity-100'
          : 'text-text-dim opacity-0 hover:text-text group-hover:opacity-100',
      ].join(' ')}
    >
      {locked ? <LockClosedIcon /> : <LockOpenIcon />}
    </button>
  )
}

/**
 * Add-camera stays visible even when the scene already has cameras. The new
 * camera starts from the default camera's static view, becomes default, and is
 * selected for immediate editing.
 */
function AddCameraRow() {
  const api = useSceneAPI()
  const setSelection = useUI((s) => s.setSelection)
  return (
    <button
      type="button"
      onClick={() => {
        const id = addCamera(api)
        setSelection([id])
      }}
      className="group mx-3 mt-0.5 flex h-6 w-[calc(100%-1.5rem)] items-center gap-1.5 rounded border border-dashed border-border px-2 text-[10px] text-text-dim transition-colors hover:border-accent hover:bg-accent-soft/30 hover:text-accent"
      title="Add another camera from the current view"
    >
      <AppIcon name="plus" size={11} />
      <span className="font-medium">Add camera</span>
    </button>
  )
}

/**
 * Keep selection-following out of LayersPanel itself. Subscribing the panel to
 * the full selection array made a click rebuild the complete recursive tree.
 * This zero-DOM leaf owns the reveal/scroll effect without invalidating rows.
 */
function LayerSelectionReveal({
  scrollerRef,
}: {
  scrollerRef: RefObject<HTMLDivElement | null>
}) {
  const api = useSceneAPI()
  const selectedId = useUI((state) => state.selection.at(-1) ?? null)
  const layersCollapsed = useUI((state) => state.layersCollapsed)
  const toggleLayerCollapsed = useUI((state) => state.toggleLayerCollapsed)
  const lastSelectedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!selectedId) {
      lastSelectedRef.current = null
      return
    }
    if (lastSelectedRef.current === selectedId) return
    lastSelectedRef.current = selectedId

    let current: string | null = selectedId
    while (current) {
      const node = api.getNode(current)
      if (!node) break
      const parent: string | null = node.parent
      if (parent && layersCollapsed.has(parent)) {
        toggleLayerCollapsed(parent)
      }
      current = parent
    }

    requestAnimationFrame(() => {
      const scroller = scrollerRef.current
      if (!scroller) return
      const row = scroller.querySelector(
        `[data-layer-row="${cssEscape(selectedId)}"]`,
      ) as HTMLElement | null
      row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    })
  }, [api, layersCollapsed, scrollerRef, selectedId, toggleLayerCollapsed])

  return null
}

const Row = memo(function LayerRow({
  node,
  depth,
  rootId,
}: {
  node: Node
  depth: number
  rootId: NodeId
}) {
  const api = useSceneAPI()
  const toggleInSelection = useUI((s) => s.toggleInSelection)
  const setSelection = useUI((s) => s.setSelection)
  const setView = useUI((s) => s.setView)
  const setComponentEditId = useUI((s) => s.setComponentEditId)
  const extendSelectionTo = useUI((s) => s.extendSelectionTo)
  const openContextMenu = useUI((s) => s.openContextMenu)
  const collapsed = useUI((s) => s.layersCollapsed.has(node.id))
  const toggleLayerCollapsed = useUI((s) => s.toggleLayerCollapsed)
  // Boolean-per-row subscription: a selection change now updates only the
  // rows whose selected state actually changed instead of every row in a
  // large imported Figma tree.
  const selected = useUI((s) => s.selection.includes(node.id))
  const isComponentNode = node.kind === 'component' || node.kind === 'instance'
  const children = api.getChildren(node.id).filter((child) => child.kind !== 'audio')
  const hasChildren = children.length > 0
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(node.name)
  const [dropEdge, setDropEdge] = useState<'above' | 'into' | 'below' | null>(
    null,
  )
  const isRoot = node.id === rootId
  // Which nodes accept "drop into" as a new child. Frames and components
  // are the real containers. Instances technically expose children
  // through their component definition — dropping a foreign node inside
  // would break the instance contract, so we skip them too. Root is a
  // frame so it qualifies automatically.
  const isContainer = node.kind === 'frame' || node.kind === 'component'

  const commitName = () => {
    const name = draftName.trim()
    if (name && name !== node.name) {
      api.setNodeProperty(node.id, 'name', name)
    }
    setEditing(false)
  }

  const onDragStart = (e: DragEvent) => {
    if (isRoot) {
      e.preventDefault()
      return
    }
    e.dataTransfer.setData('text/hyper-motion-node', node.id)
    e.dataTransfer.effectAllowed = 'move'
  }

  const onDragOver = (e: DragEvent) => {
    const draggingId = e.dataTransfer.types.includes('text/hyper-motion-node')
    if (!draggingId) return
    e.preventDefault()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const y = e.clientY - rect.top
    const ratio = y / rect.height
    // Three zones on containers, two on leaves. Root has a special case:
    // it's the artboard and only accepts drop-into (siblings of root
    // don't exist).
    if (isRoot) {
      setDropEdge('into')
    } else if (isContainer) {
      if (ratio < 0.25) setDropEdge('above')
      else if (ratio > 0.75) setDropEdge('below')
      else setDropEdge('into')
    } else {
      setDropEdge(ratio < 0.5 ? 'above' : 'below')
    }
  }

  const onDragLeave = () => setDropEdge(null)

  const onDrop = (e: DragEvent) => {
    const srcId = e.dataTransfer.getData('text/hyper-motion-node')
    const edge = dropEdge
    setDropEdge(null)
    if (!srcId || srcId === node.id) return
    // Guard against cycles — can't drop a node into its own descendant.
    if (isDescendant(api, node.id, srcId)) return

    if (edge === 'into') {
      // Drop as a new child of this node. appendChild reparents and
      // positions at the end of the children array, which matches the
      // visual reading order (bottom = frontmost).
      reparentPreservingVisualPosition(api, srcId, node.id)
      return
    }

    // Sibling drop (above / below). For this path we need the target to
    // have a parent — root is handled above via 'into' only.
    if (!node.parent) return
    const parentId = node.parent
    const siblings = api.getChildren(parentId).map((c) => c.id)
    const targetIdx = siblings.indexOf(node.id)
    if (targetIdx < 0) return
    const insertIdx = edge === 'above' ? targetIdx : targetIdx + 1
    // appendChild reparents; then moveChild positions within new parent.
    reparentPreservingVisualPosition(api, srcId, parentId)
    // After appendChild, srcId is at the end of siblings. Re-query to
    // account for the fact that it may already have been in this parent.
    const nextSiblings = api.getChildren(parentId).map((c) => c.id)
    const clampedIdx = Math.min(insertIdx, nextSiblings.length - 1)
    api.moveChild(parentId, srcId, clampedIdx)
  }

  return (
    <>
      <div
        data-layer-row={node.id}
        draggable={!isRoot}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onContextMenu={(e) => {
          if (isRoot) return // nothing to offer on the artboard row
          e.preventDefault()
          e.stopPropagation()
          // Keep behavior parallel to the Canvas: right-clicking a row
          // not currently selected snaps selection to it, so the menu
          // actions always match what's highlighted.
          const selection = useUI.getState().selection
          const targetIds = selection.includes(node.id) ? selection : [node.id]
          if (!selection.includes(node.id)) setSelection([node.id])
          openContextMenu({
            x: e.clientX,
            y: e.clientY,
            items: buildNodeContextMenu(api, targetIds),
          })
        }}
        onClick={(e) => {
          // Figma conventions:
          //   plain click   → replace selection with just this row
          //   meta/ctrl+clk → toggle this row in/out of the selection
          //   shift+click   → extend selection from anchor to this row
          //                    along the currently-visible layer order
          if (e.shiftKey) {
            const order = collectVisibleIds(
              api,
              useUI.getState().layersCollapsed,
            )
            // When the range spans both a parent and its children,
            // drop the children — selecting a parent implies its whole
            // subtree. This matches what users mean when they lasso
            // across nested layers: they want to operate on the
            // outermost layers, not on the parents *and* every leaf.
            extendSelectionTo(node.id, order, (ids) =>
              filterDescendants(api, ids),
            )
          } else if (e.metaKey || e.ctrlKey) {
            toggleInSelection(node.id, true)
          } else {
            setSelection([node.id])
          }
        }}
        onDoubleClick={() => {
          if (node.kind === 'component' || node.kind === 'instance') {
            const masterId = node.kind === 'instance' ? node.componentId : node.id
            setComponentEditId(masterId)
            setSelection([masterId])
            return
          }
          setDraftName(node.name)
          setEditing(true)
        }}
        className={[
          'group relative flex w-full items-center gap-1 py-1 pr-2 text-left text-[10px] transition-colors',
          selected
            ? isComponentNode
              ? 'text-text'
              : 'bg-accent-soft text-text'
            : 'text-text-muted hover:bg-panel-raised hover:text-text',
          dropEdge === 'above' ? 'border-t-2 border-t-accent' : '',
          dropEdge === 'below' ? 'border-b-2 border-b-accent' : '',
          // "Drop into" highlight — outline the whole row so the user
          // can see the target frame about to swallow the dragged layer.
          // Inset ring so it doesn't push siblings around.
          dropEdge === 'into'
            ? 'ring-2 ring-inset ring-accent bg-accent-soft/40'
            : '',
        ].join(' ')}
        style={{
          paddingLeft: 8 + depth * 12,
          contentVisibility: 'auto',
          containIntrinsicSize: '0 24px',
          ...(selected && isComponentNode
            ? { backgroundColor: 'var(--color-accent-soft)' }
            : {}),
        }}
      >
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation()
              toggleLayerCollapsed(node.id)
            }}
            title={collapsed ? 'Expand' : 'Collapse'}
            className="flex h-3 w-3 shrink-0 items-center justify-center text-[9px] text-text-dim hover:text-text"
          >
            {collapsed ? '▸' : '▾'}
          </button>
        ) : (
          <span className="h-3 w-3 shrink-0" />
        )}
        <KindGlyph node={node} />
        {/* Mask indicator. Tiny accent moon glyph next to the kind
            icon, only present when the node has been flagged via
            Cmd+Opt+M. Hovering shows "Used as mask" so users who
            don't recognize the glyph still get the affordance. */}
        {node.isMask ? (
          <span
            title="Used as mask (Cmd+Opt+M to release)"
            className="flex h-3 w-3 shrink-0 items-center justify-center text-accent"
            aria-label="mask"
          >
            <MaskGlyph />
          </span>
        ) : null}
        {editing ? (
          <input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName()
              if (e.key === 'Escape') setEditing(false)
            }}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 bg-transparent text-[10px] text-text outline-none ring-1 ring-accent/60 rounded px-1"
          />
        ) : (
          <span className="flex-1 truncate">{node.name}</span>
        )}
        {node.workspaceOnly && node.parent === null ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setSelection([node.id])
              const workspace = document.querySelector<HTMLElement>(
                '[data-canvas-workspace="1"]',
              )
              const viewportRect = workspace?.parentElement?.getBoundingClientRect()
              const canvas = api.getMeta().canvas ?? { width: 960, height: 540 }
              const bounds = workspaceBoundsForNode(node)
              if (!viewportRect || !bounds) return
              const nextView = fitWorkspaceBounds({
                bounds: [bounds],
                artboardWidth: canvas.width,
                artboardHeight: canvas.height,
                viewportWidth: viewportRect.width,
                viewportHeight: viewportRect.height,
                maxZoom: 2,
              })
              if (nextView) setView(nextView)
            }}
            className="rounded px-1.5 py-0.5 text-[9px] font-medium text-text-dim opacity-70 hover:bg-panel-raised hover:text-text group-hover:opacity-100"
            title={`Show ${node.name} on canvas`}
            aria-label={`Show ${node.name} on canvas`}
          >
            Show
          </button>
        ) : null}
        <IconToggle
          active={node.visible}
          onClick={(e) => {
            e.stopPropagation()
            api.setNodeProperty(node.id, 'visible', !node.visible)
          }}
          title={
            node.visible
              ? 'Hide layer (and its children)'
              : 'Show layer'
          }
        >
          {node.visible ? <EyeIcon /> : <EyeOffIcon />}
        </IconToggle>
        <IconToggle
          active={!node.locked}
          onClick={(e) => {
            e.stopPropagation()
            // Cascade to descendants. A lock on a container implies its
            // children are locked too — otherwise the lock is meaningless
            // (you could still drag the inner badge of a "locked" card).
            setLockedRecursive(api, node.id, !node.locked)
          }}
          title={node.locked ? 'Unlock (cascades to children)' : 'Lock (cascades to children)'}
        >
          {node.locked ? <LockClosedIcon /> : <LockOpenIcon />}
        </IconToggle>
      </div>
      {!collapsed &&
        children.map((c) => (
          <Row key={c.id} node={c} depth={depth + 1} rootId={rootId} />
        ))}
    </>
  )
})

function workspaceBoundsForNode(node: Node): WorkspaceBounds | null {
  if (node.kind === 'audio' || node.kind === 'camera') return null

  let width = 100
  let height = 100
  if ('size' in node) {
    width = typeof node.size.width === 'number' ? node.size.width : width
    height = typeof node.size.height === 'number' ? node.size.height : height
  }
  if (node.kind === 'text') {
    if (node.size.width === 'hug') {
      width = Math.max(24, node.text.length * node.fontSize * 0.58)
    }
    if (node.size.height === 'hug') {
      height = Math.max(1, node.fontSize * node.lineHeight)
    }
  }

  return {
    x: node.transform.x,
    y: node.transform.y,
    width: Math.max(1, width),
    height: Math.max(1, height),
  }
}

function IconToggle({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean
  onClick: (e: React.MouseEvent) => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={[
        'flex h-4 w-4 items-center justify-center rounded text-[10px] transition-colors',
        active
          ? 'text-text-dim opacity-0 hover:text-text group-hover:opacity-100'
          : 'text-text opacity-100',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Row-action SVG icons (eye, lock). Inline because they're tiny and only
// used here. currentColor stroke so the IconToggle's text-* class drives
// the color naturally.
// ---------------------------------------------------------------------------

function eyeProps() {
  return {
    width: 12,
    height: 12,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.4,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
}

function EyeIcon() {
  return (
    <svg {...eyeProps()}>
      <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="1.8" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg {...eyeProps()}>
      <path d="M2 3l12 10" />
      <path d="M3.5 5.4C2.4 6.4 1.5 8 1.5 8s2.5 4.5 6.5 4.5c1 0 1.9-.2 2.7-.6" />
      <path d="M6.5 4.1c.5-.1 1-.1 1.5-.1 4 0 6.5 4 6.5 4s-.6 1.1-1.7 2.2" />
    </svg>
  )
}

function LockClosedIcon() {
  return (
    <svg {...eyeProps()}>
      <rect x="3" y="7" width="10" height="7" rx="1.2" />
      <path d="M5 7V5a3 3 0 016 0v2" />
    </svg>
  )
}

function LockOpenIcon() {
  return (
    <svg {...eyeProps()}>
      <rect x="3" y="7" width="10" height="7" rx="1.2" />
      <path d="M5 7V5a3 3 0 015.5-1.7" />
    </svg>
  )
}

/**
 * MaskGlyph — Figma uses a half-moon shape for "Used as mask". This
 * is two overlapping circles where the right one carves out of the
 * left, producing the canonical crescent. 10×10 to fit the row icon
 * size (h-3 w-3 = 12px container with a ~10px glyph inside).
 */
function MaskGlyph() {
  return (
    <svg
      width={10}
      height={10}
      viewBox="0 0 10 10"
      aria-hidden="true"
    >
      <circle cx="4" cy="5" r="3.5" fill="currentColor" />
      <circle cx="6" cy="5" r="3.5" fill="var(--color-panel)" />
    </svg>
  )
}

const KIND_ICONS: Record<NodeKind, AppIconName> = {
  frame: 'frame',
  rect: 'square',
  ellipse: 'circle',
  vector: 'vector',
  text: 'text',
  image: 'image',
  shader: 'sparkle',
  component: 'nodes',
  instance: 'layers',
  camera: 'camera',
  video: 'video',
  audio: 'audio',
}

/**
 * Frames get a mode-aware glyph so the Layers panel reflects whether
 * a frame is plain, flex, or grid at a glance — without having to open
 * the Inspector to check. Row/column stacks use directional variants
 * from the same outline family as the other node-kind glyphs.
 */
function iconFor(node: Node): AppIconName {
  if (node.kind === 'frame') {
    if (node.layout.mode === 'flex') {
      return node.layout.direction === 'row' ? 'stack-x' : 'stack-y'
    }
    if (node.layout.mode === 'grid') return 'grid'
  }
  return KIND_ICONS[node.kind]
}

function KindGlyph({ node }: { node: Node }) {
  const isComponentNode = node.kind === 'component' || node.kind === 'instance'
  const icon = iconFor(node)
  return (
    <span
      className="flex w-3 shrink-0 items-center justify-center text-text-dim"
      style={{
        color: isComponentNode ? 'var(--color-accent)' : undefined,
      }}
    >
      <AppIcon name={icon} size={11} />
    </span>
  )
}

function createLayersCameraCutId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `cut_${crypto.randomUUID()}`
  }
  return `cut_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Walk the scene from root depth-first in sibling order, returning the
 * ids that are currently visible in the Layers panel. Collapsed
 * subtrees are skipped so Shift+click ranges only cover what the user
 * can actually see — matching Figma's behavior.
 */
/**
 * Escape an arbitrary string for use as a CSS attribute-selector value.
 * Our node ids are nanoid-style (letters/digits/_/-) so they're already
 * safe, but if id-generation ever changes or a custom id slips in we
 * don't want a runtime SecurityError to take out the panel.
 */
function cssEscape(s: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(s)
  }
  return s.replace(/["\\\]]/g, '\\$&')
}

function collectVisibleIds(
  api: ReturnType<typeof useSceneAPI>,
  collapsed: Set<string>,
): string[] {
  const rootId = api.getRoot()
  if (!rootId) return []
  const out: string[] = []
  const walk = (id: string) => {
    out.push(id)
    if (collapsed.has(id)) return
    for (const child of api.getChildren(id)) walk(child.id)
  }
  walk(rootId)
  return out
}

/**
 * Reparent `srcId` under `newParentId`, keeping the node visually in place.
 *
 * The naïve `api.appendChild(newParent, src)` on its own preserves the
 * node's `transform.x/y`, but `transform` is an OFFSET on top of the
 * parent-relative layout origin — so the meaning of those numbers
 * changes the moment the parent changes. A node at world (200, 150) as
 * a child of root, dropped into a frame at world (400, 300), would
 * otherwise appear at world (600, 450) — "inside" the frame in the
 * tree, but visually still rendered in its old spot (or worse, jumped
 * clear outside the frame's visible bounds). Users see "my text didn't
 * move inside the frame," exactly the bug report here.
 *
 * Behavior by new-parent layout mode:
 *
 *   - mode 'none' (default free-positioning): compensate transform.x/y
 *     so the node's world position stays put across the reparent. The
 *     node then visually sits wherever it was before, but as a child of
 *     the new frame. Subsequent drags / keyboard moves behave as the
 *     user expects. This is Figma's reparenting semantics.
 *
 *   - mode 'flex' or 'grid': the parent's solver will arrange the child
 *     into a slot. Keeping an arbitrary transform offset on top would
 *     visually detach the child from its Yoga-assigned slot (it'd look
 *     like auto-layout is broken). Reset transform.x/y to (0, 0) so the
 *     child sits exactly where flex places it. Matches what Figma does
 *     when you drop a layer into an Auto-layout frame.
 *
 * If we can't read the last solved layout (first-paint race, scene
 * hasn't solved yet), we fall back to a plain `appendChild` rather than
 * leaving the node in a wrong spot — the user can still drag-correct.
 */
function reparentPreservingVisualPosition(
  api: SceneAPI,
  srcId: NodeId,
  newParentId: NodeId,
): void {
  const src = api.getNode(srcId)
  if (!src) return
  const newParent = api.getNode(newParentId)
  if (!newParent) return

  // Flex / grid parents arrange children into slots — don't carry a
  // pixel offset across the swap. Resetting transform here keeps the
  // layout visually consistent with Auto-layout expectations.
  const newParentMode =
    'layout' in newParent ? newParent.layout.mode : 'none'
  if (newParentMode === 'flex' || newParentMode === 'grid') {
    api.appendChild(newParentId, srcId)
    api.setNodeProperty(srcId, 'transform', {
      ...src.transform,
      x: 0,
      y: 0,
    })
    return
  }

  // mode 'none' — preserve visual world position by shifting transform
  // to counteract the new parent's content origin.
  const solved = getLastSolvedLayout()
  const srcRect = solved?.[srcId]
  const newParentRect = solved?.[newParentId]

  if (!solved || !srcRect || !newParentRect) {
    api.appendChild(newParentId, srcId)
    return
  }

  // Old visual world position (ignoring rotation/scale — an approximation
  // that matches the rendered result for the common translate-only case).
  // srcRect.x/y is Yoga's placement of the child; transform.x/y is the
  // CSS translate composed on top by NodeView.
  const oldWorldX = srcRect.x + src.transform.x
  const oldWorldY = srcRect.y + src.transform.y

  // After appendChild under newParent with mode='none', Yoga will place
  // the child at positionType=absolute at (0, 0) of newParent's content
  // box — so the child's new layout origin is approximately
  // newParentRect.x / newParentRect.y (ignoring newParent's padding; an
  // acceptable approximation since the padding is the user-specified
  // interior space, and snapping INTO that space is reasonable).
  const newTransformX = oldWorldX - newParentRect.x
  const newTransformY = oldWorldY - newParentRect.y

  api.appendChild(newParentId, srcId)
  api.setNodeProperty(srcId, 'transform', {
    ...src.transform,
    x: newTransformX,
    y: newTransformY,
  })
}

/** True if `maybeAncestor` is an ancestor of `id` (including when equal). */
function isDescendant(
  api: ReturnType<typeof useSceneAPI>,
  id: string,
  maybeAncestor: string,
): boolean {
  if (id === maybeAncestor) return true
  let n = api.getNode(id)
  while (n && n.parent) {
    if (n.parent === maybeAncestor) return true
    n = api.getNode(n.parent)
  }
  return false
}

/**
 * Remove any id that has another id from the set as an ancestor. Used to
 * collapse a shift-click range into its roots — if you shift-selected
 * from "A" down through a bunch of its children to "B", and A contains
 * B, we keep only A. O(n²) ancestor walk; the selection is small.
 */
function filterDescendants(
  api: ReturnType<typeof useSceneAPI>,
  ids: string[],
): string[] {
  const set = new Set(ids)
  return ids.filter((id) => {
    let n = api.getNode(id)
    while (n && n.parent) {
      if (set.has(n.parent)) return false
      n = api.getNode(n.parent)
    }
    return true
  })
}
