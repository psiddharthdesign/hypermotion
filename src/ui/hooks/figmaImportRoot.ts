// SPDX-License-Identifier: Apache-2.0

import * as Y from 'yjs'
import type { NodeId } from '@/scene/types'
import type { SceneAPI } from '@/scene/doc'
import { getProjectAPI } from '@/project/doc'
import type { CompositionScene } from '@/sequence'

/**
 * Resolve a live frame for imports and repair the legacy root projection when
 * a scene switch or hot reload leaves `scene.root` pointing at a deleted node.
 */
export function resolveFigmaImportRoot(api: SceneAPI): NodeId | null {
  const projectedRootId = api.getRoot()
  const projectedRoot = projectedRootId
    ? api.getNode(projectedRootId)
    : null
  if (projectedRoot?.kind === 'frame') return projectedRoot.id

  const project = getProjectAPI(api)
  // Inspect the stored compositions before calling a ProjectAPI getter:
  // getters intentionally repair a missing active root. For imports, however,
  // an already-live composition is the safer destination than manufacturing a
  // replacement artboard while another authored scene is available.
  const sceneState = api.doc.getMap<unknown>('scene')
  const storedCompositions = sceneState.get('compositionScenes')
  const activeId = sceneState.get('activeCompositionId')
  if (
    storedCompositions instanceof Y.Map &&
    typeof activeId === 'string'
  ) {
    const active = storedCompositions.get(activeId) as
      | CompositionScene
      | undefined
    const activeRoot = active ? api.getNode(active.rootNodeId) : null
    if (active && activeRoot?.kind !== 'frame') {
      const fallback = Array.from(
        (storedCompositions as Y.Map<CompositionScene>).values(),
      ).find(
        (scene) =>
          scene.id !== active.id &&
          api.getNode(scene.rootNodeId)?.kind === 'frame',
      )
      if (fallback) {
        project.activateScene(fallback.id)
        return fallback.rootNodeId
      }
    }
  }

  const activeScene = project.getActiveScene()
  if (activeScene) {
    const activeRoot = api.getNode(activeScene.rootNodeId)
    if (activeRoot?.kind === 'frame') {
      project.activateScene(activeScene.id)
      return activeRoot.id
    }
  }

  const fallbackScene = project
    .getScenes()
    .find((scene) => api.getNode(scene.rootNodeId)?.kind === 'frame')
  if (fallbackScene) {
    project.activateScene(fallbackScene.id)
    return fallbackScene.rootNodeId
  }

  // A document can retain cameras, tracks, and composition metadata after its
  // artboard node has been removed. Import needs a concrete parent, so recover
  // a minimal scene using the current canvas dimensions instead of asking the
  // user to repair internal project state manually.
  try {
    const meta = api.getMeta()
    const recovered = project.createScene({
      name: activeScene?.name
        ? `${activeScene.name} recovered`
        : meta.name?.trim()
          ? `${meta.name} recovered`
          : 'Recovered scene',
      duration: activeScene?.duration ?? meta.duration,
    })
    return recovered.rootNodeId
  } catch (error) {
    console.error('[figma-import] could not recover a missing scene root', error)
    return null
  }
}
