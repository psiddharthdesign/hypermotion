// SPDX-License-Identifier: Apache-2.0

import { useMemo } from 'react'
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
  viewportPointToPlaneLocal,
  type PlaneQuad,
  type ProjectedPoint2D,
} from '@/render3d/selectionProjection'
import { ResizeHandles } from '@/ui/ResizeHandles'

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
  const viewport = useMemo(() => ({ width, height }), [height, width])
  const resolvedCamera = useMemo(
    () => resolveCamera3D(camera, cameraAnim, viewport),
    [camera, cameraAnim, viewport],
  )
  const planeBuildContext = useMemo(() => {
    void sceneVersion
    return createPlaneBuildContext(api)
  }, [api, sceneVersion])
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
  const planeByNodeId = useMemo(() => {
    if (targetNodeIds.size === 0) return new Map<NodeId, Plane3D>()
    const planes = buildWorldPlanes(api, solved, animated, resolvedCamera, {
      context: planeBuildContext,
      independentNodes: true,
      targetNodeIds,
    })
    return new Map(planes.map((plane) => [plane.nodeId, plane]))
  }, [animated, api, planeBuildContext, resolvedCamera, solved, targetNodeIds])

  if (selectedIds.length === 0) return null

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
          const component = node.kind === 'component' || node.kind === 'instance'
          return (
            <polygon
              key={id}
              points={quad.map((point) => `${point.x},${point.y}`).join(' ')}
              fill="none"
              stroke={
                component ? 'oklch(0.64 0.24 300)' : 'var(--color-accent)'
              }
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
