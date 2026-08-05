// SPDX-License-Identifier: Apache-2.0

import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react'
import type { SolvedLayout } from '@/layout'
import type { AnimatedValue } from '@/ui/hooks/useAnimatedValues'
import type { CameraNode, NodeId, SceneAPI } from '@/scene'
import {
  buildWorldPlanes,
  createPlaneBuildContext,
  resolveCamera3D,
  type Plane3D,
} from '@/render3d/scene3d'
import {
  projectPlaneQuad,
  viewportPointToMotionPathLocal,
  viewportPointToPlaneLocal,
  type PlaneQuad,
  type ProjectedPoint2D,
} from '@/render3d/selectionProjection'
import { ResizeHandles } from '@/ui/ResizeHandles'
import {
  recordKeyframesForPatch,
  stampToActiveTracksForPatch,
} from '@/anim'
import { useUI } from '@/state/ui'
import {
  canMoveProjectedSelection,
  passedProjectedMoveThreshold,
  type ParentLayoutMode,
} from '@/ui/cameraSelectionDrag'
import {
  commitNodeTransformPreviews,
  nodeTransformDragOrigin,
  nodeTransformPreviewStore,
  type NodeTransformPreview,
} from '@/ui/nodeTransformPreviewStore'
import { nodeGeometryPreviewStore } from '@/ui/nodeGeometryPreviewStore'
import { nodeGeometryPreviewRect } from '@/ui/nodeGeometryPreviewRect'

export interface CameraSelectionOverlayProps {
  api: SceneAPI
  solved: SolvedLayout
  animated: Record<NodeId, AnimatedValue>
  camera: CameraNode
  cameraAnim: AnimatedValue | undefined
  selectedIds: NodeId[]
  width: number
  height: number
  zoom: number
  sceneVersion: number
  clientToViewport: (
    clientX: number,
    clientY: number,
  ) => ProjectedPoint2D | null
}

/**
 * Camera-accurate editor chrome for the WebGL scene.
 *
 * The visible scene, hit testing, outline, and resize handles all derive from
 * the same resolved camera + world plane. This is deliberately rendered in
 * the small animated WebGL leaf so camera keyframes do not reconcile Canvas.
 */
export function CameraSelectionOverlay({
  api,
  solved,
  animated,
  camera,
  cameraAnim,
  selectedIds,
  width,
  height,
  zoom,
  sceneVersion,
  clientToViewport,
}: CameraSelectionOverlayProps) {
  const moveRef = useRef<{
    pointerId: number
    startClientX: number
    startClientY: number
    startLocal: ProjectedPoint2D
    plane: Plane3D
    camera: ReturnType<typeof resolveCamera3D>
    tx0: number
    ty0: number
    staticOffsetX: number
    staticOffsetY: number
    authorOffsetX: number
    authorOffsetY: number
    latest: NodeTransformPreview
    moved: boolean
  } | null>(null)
  const viewport = useMemo(() => ({ width, height }), [height, width])
  const resolvedCamera = useMemo(
    () => resolveCamera3D(camera, cameraAnim, viewport),
    [camera, cameraAnim, viewport],
  )
  const planeBuildContext = useMemo(() => {
    void sceneVersion
    return createPlaneBuildContext(api)
  }, [api, sceneVersion])
  const geometryPreview = useSyncExternalStore(
    nodeGeometryPreviewStore.subscribe,
    nodeGeometryPreviewStore.getSnapshot,
    nodeGeometryPreviewStore.getSnapshot,
  )
  const rootId = planeBuildContext.rootId
  const targetNodeIds = useMemo(
    () =>
      new Set(
        selectedIds.filter((id) => {
          const node = planeBuildContext.nodesById.get(id)
          return id !== rootId && node?.kind !== 'camera'
        }),
      ),
    [planeBuildContext, rootId, selectedIds],
  )
  const previewSolved = useMemo(() => {
    let next: SolvedLayout | null = null
    for (const nodeId of targetNodeIds) {
      const value = geometryPreview[nodeId]
      const node = planeBuildContext.nodesById.get(nodeId)
      const rect = solved[nodeId]
      if (!value || !node || !rect) continue
      next ??= { ...solved }
      next[nodeId] = nodeGeometryPreviewRect(node, rect, value)
    }
    return next ?? solved
  }, [geometryPreview, planeBuildContext, solved, targetNodeIds])
  const planeByNodeId = useMemo(() => {
    if (targetNodeIds.size === 0) return new Map<NodeId, Plane3D>()
    const planes = buildWorldPlanes(api, previewSolved, animated, resolvedCamera, {
      context: planeBuildContext,
      independentNodes: true,
      targetNodeIds,
    })
    return new Map(planes.map((plane) => [plane.nodeId, plane]))
  }, [
    animated,
    api,
    planeBuildContext,
    previewSolved,
    resolvedCamera,
    targetNodeIds,
  ])

  const strokeWidth = 1.5 / Math.max(zoom, 0.001)
  const singleSelection = selectedIds.length === 1 ? selectedIds[0]! : null
  const singleNode = singleSelection
    ? planeBuildContext.nodesById.get(singleSelection)
    : null
  const singlePlane = singleSelection
    ? planeByNodeId.get(singleSelection)
    : null
  const singleQuad = singlePlane
    ? projectPlaneQuad(singlePlane, resolvedCamera, viewport)
    : null
  const showHandles =
    !!singleNode &&
    !!singlePlane &&
    !!singleQuad &&
    !singleNode.locked &&
    'size' in singleNode
  const singleParent = singleNode?.parent
    ? planeBuildContext.nodesById.get(singleNode.parent)
    : null
  const parentLayoutMode: ParentLayoutMode =
    singleParent && 'layout' in singleParent
      ? singleParent.layout.mode
      : 'none'
  const showMoveSurface =
    !!singleNode &&
    !!singlePlane &&
    !!singleQuad &&
    canMoveProjectedSelection({
      isRoot: singleNode.id === rootId,
      locked: singleNode.locked,
      position: singleNode.position,
      parentLayoutMode,
    })

  const startMove = useCallback(
    (event: React.PointerEvent<SVGPolygonElement>) => {
      if (event.button !== 0 || !singleNode || !singlePlane) return
      const viewportPoint = clientToViewport(event.clientX, event.clientY)
      if (!viewportPoint) return
      const startLocal = viewportPointToMotionPathLocal(
        viewportPoint,
        0,
        singlePlane,
        resolvedCamera,
        viewport,
      )
      if (!startLocal) return

      event.preventDefault()
      event.stopPropagation()
      const origin = nodeTransformDragOrigin(
        singleNode,
        animated[singleNode.id],
      )
      moveRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startLocal,
        // Freeze the incoming-parent basis and camera for the whole gesture.
        // Scene-version rerenders caused by each live transform write must not
        // move the coordinate system underneath the held pointer.
        plane: singlePlane,
        camera: resolvedCamera,
        tx0: origin.display.x,
        ty0: origin.display.y,
        staticOffsetX: origin.static.x - origin.display.x,
        staticOffsetY: origin.static.y - origin.display.y,
        authorOffsetX: origin.author.x - origin.display.x,
        authorOffsetY: origin.author.y - origin.display.y,
        latest: origin.display,
        moved: false,
      }

      const element = event.currentTarget
      element.setPointerCapture(event.pointerId)

      const onMove = (moveEvent: PointerEvent) => {
        const move = moveRef.current
        if (!move || moveEvent.pointerId !== move.pointerId) return
        if (
          !move.moved &&
          !passedProjectedMoveThreshold(
            move.startClientX,
            move.startClientY,
            moveEvent.clientX,
            moveEvent.clientY,
          )
        ) {
          return
        }

        const currentViewportPoint = clientToViewport(
          moveEvent.clientX,
          moveEvent.clientY,
        )
        if (!currentViewportPoint) return
        const currentLocal = viewportPointToMotionPathLocal(
          currentViewportPoint,
          0,
          move.plane,
          move.camera,
          viewport,
        )
        if (!currentLocal) return

        move.moved = true
        move.latest = {
          x: move.tx0 + currentLocal.x - move.startLocal.x,
          y: move.ty0 + currentLocal.y - move.startLocal.y,
        }
        nodeTransformPreviewStore.preview({
          [singleNode.id]: move.latest,
        })
      }

      const onUp = (upEvent: PointerEvent) => {
        const move = moveRef.current
        if (!move || upEvent.pointerId !== move.pointerId) return
        try {
          element.releasePointerCapture(move.pointerId)
        } catch {
          // The browser may already have released a cancelled pointer.
        }

        if (move.moved) {
          const ui = useUI.getState()
          commitNodeTransformPreviews(
            api,
            {
              [singleNode.id]: {
                x: move.latest.x + move.staticOffsetX,
                y: move.latest.y + move.staticOffsetY,
              },
            },
            (nodeId) => {
              const authorPatch = {
                x: move.latest.x + move.authorOffsetX,
                y: move.latest.y + move.authorOffsetY,
              }
              if (ui.recording) {
                recordKeyframesForPatch(
                  api,
                  nodeId,
                  ui.playhead,
                  'transform',
                  authorPatch,
                )
              } else {
                stampToActiveTracksForPatch(
                  api,
                  nodeId,
                  ui.playhead,
                  'transform',
                  authorPatch,
                )
              }
            },
          )
          nodeTransformPreviewStore.finish()
        } else {
          nodeTransformPreviewStore.clear()
        }

        moveRef.current = null
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    [
      api,
      animated,
      clientToViewport,
      resolvedCamera,
      singleNode,
      singlePlane,
      viewport,
    ],
  )

  if (selectedIds.length === 0) return null

  return (
    <div
      className="pointer-events-none absolute inset-0 z-[20]"
      data-export-hide="1"
    >
      <svg
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-visible"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
      >
        {showMoveSurface && singleQuad ? (
          <polygon
            data-camera-selection-move-surface={singleNode!.id}
            points={singleQuad
              .map((point) => `${point.x},${point.y}`)
              .join(' ')}
            fill="transparent"
            stroke="none"
            onPointerDown={startMove}
            style={{
              cursor: 'move',
              pointerEvents: 'all',
              touchAction: 'none',
            }}
          />
        ) : null}
        {selectedIds.map((id) => {
          const node = planeBuildContext.nodesById.get(id)
          if (!node || node.kind === 'camera') return null
          const quad =
            id === rootId
              ? rootViewportQuad(width, height)
              : planeByNodeId.has(id)
                ? projectPlaneQuad(
                    planeByNodeId.get(id)!,
                    resolvedCamera,
                    viewport,
                  )
                : null
          if (!quad) return null
          return (
            <polygon
              key={id}
              points={quad.map((point) => `${point.x},${point.y}`).join(' ')}
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth={strokeWidth}
              strokeLinejoin="round"
            />
          )
        })}
      </svg>
      {showHandles ? (
        <ResizeHandles
          nodeId={singleSelection!}
          rectWidth={singlePlane.rect.width}
          rectHeight={singlePlane.rect.height}
          zoom={zoom}
          projection={{
            quad: singleQuad,
            clientToLocal: (clientX, clientY) => {
              const point = clientToViewport(clientX, clientY)
              return point
                ? viewportPointToPlaneLocal(
                    point,
                    singlePlane,
                    resolvedCamera,
                    viewport,
                  )
                : null
            },
          }}
        />
      ) : null}
    </div>
  )
}

function rootViewportQuad(
  width: number,
  height: number,
): PlaneQuad<ProjectedPoint2D> {
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ]
}
