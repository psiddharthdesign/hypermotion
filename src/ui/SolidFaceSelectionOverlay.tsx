// SPDX-License-Identifier: Apache-2.0
import { useMemo } from 'react'
import type { AnimatedValue } from '@/anim'
import type { CameraNode, NodeId, SceneAPI } from '@/scene'
import type { SolvedLayout } from '@/layout'
import { buildWorldPlanes, createPlaneBuildContext, resolveCamera3D } from '@/render3d/scene3d'
import { selectedSolidNodeIds } from './solidFaceSelection'
import { SolidFaceControls } from './SolidFaceControls'

export function SolidFaceSelectionOverlay({ api, layout, animated, camera, cameraAnim, selection, width, height, zoom, sceneVersion, clientToViewport }: {
  api: SceneAPI; layout: SolvedLayout; animated: Record<NodeId, AnimatedValue>
  camera: CameraNode; cameraAnim?: AnimatedValue; selection: readonly NodeId[]
  width: number; height: number; zoom: number; sceneVersion: number
  clientToViewport: (x: number, y: number) => { x: number; y: number } | null
}) {
  const context = useMemo(() => { void sceneVersion; return createPlaneBuildContext(api) }, [api, sceneVersion])
  const viewport = useMemo(() => ({ width, height }), [width, height])
  const resolved = useMemo(() => resolveCamera3D(camera, cameraAnim, viewport), [camera, cameraAnim, viewport])
  const targets = useMemo(() => { void sceneVersion; return selectedSolidNodeIds(api, selection) }, [api, selection, sceneVersion])
  const planes = useMemo(() => buildWorldPlanes(api, layout, animated, resolved, { context, independentNodes: true }), [api, layout, animated, resolved, context])
  const occlusionPlanes = useMemo(() => buildWorldPlanes(api, layout, animated, resolved, { context }), [api, layout, animated, resolved, context])
  const editable = useMemo(() => planes.filter(plane => targets.has(plane.nodeId) && plane.extrusion), [planes, targets])
  return <SolidFaceControls api={api} planes={editable} occlusionPlanes={occlusionPlanes} placementPlanes={planes} placementIgnoreIds={targets} camera={resolved} width={width} height={height} zoom={zoom} animated={animated} enabled clientToViewport={clientToViewport} />
}
