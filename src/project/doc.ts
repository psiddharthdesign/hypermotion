// SPDX-License-Identifier: Apache-2.0

import * as Y from 'yjs'
import type { Node, NodeId, SceneMeta, Track } from '@/scene'
import type { SceneAPI } from '@/scene/doc'
import {
  buildSequenceTimeMap,
  type CameraCut,
  type CompositionScene,
  type CompositionWorkArea,
  type SequenceItem,
  type SequenceTimeMap,
  type SequenceTransition,
} from '@/sequence'

/**
 * First-class project/sequence state.
 *
 * The editor historically stored one composition directly in the `scene`
 * Y.Map.  The sequence layer keeps that representation as a compatibility
 * projection: activating a composition mirrors its root, duration and default
 * camera into the legacy fields. Existing canvas/inspector/animation code can
 * therefore edit the selected composition while new code gets an ordered,
 * multi-scene project model.
 *
 * The three collections are direct children of `scene` (rather than nested
 * below a replaceable `project` map). `loadSceneIntoDoc` updates direct child
 * maps/arrays in place, so API closures remain valid when a .hype file is
 * opened.
 */

export interface CreateCompositionInput {
  name?: string
  duration?: number
  duplicateFromSceneId?: string
  insertAt?: number
}

export interface DeleteCompositionResult {
  deleted: boolean
  reason?: 'missing' | 'last-scene'
  activeSceneId: string | null
}

export interface ProjectAPI {
  readonly scene: SceneAPI

  /** Idempotently upgrades a legacy one-composition document. */
  ensureInitialized(): void

  getScenes(): CompositionScene[]
  getScene(id: string): CompositionScene | null
  getSequenceItems(): SequenceItem[]
  getSequenceTimeMap(): SequenceTimeMap
  getActiveSceneId(): string | null
  getActiveScene(): CompositionScene | null

  activateScene(id: string): void
  createScene(input?: CreateCompositionInput): CompositionScene
  duplicateScene(id: string, insertAt?: number): CompositionScene | null
  /**
   * Register a composition whose nodes have already been cloned into this
   * document. This narrow entry point is used by cross-file scene transfer;
   * callers must never write the project Yjs collections directly.
   */
  registerTransferredScene(
    composition: CompositionScene,
    insertAt?: number,
  ): SequenceItem
  deleteScene(id: string): DeleteCompositionResult
  updateScene(
    id: string,
    patch: Partial<Pick<CompositionScene, 'name' | 'duration'>>,
  ): void
  /**
   * Set the composition-owned work area used by Scene preview and Master.
   * Null, or a range spanning the complete composition, clears the override.
   */
  setSceneWorkArea(
    id: string,
    workArea: CompositionWorkArea | null,
  ): void
  /** Attach a parentless pasteboard asset to a composition lifecycle. */
  registerWorkspaceNode(sceneId: string, nodeId: NodeId): void

  addSequenceItem(sceneId: string, insertAt?: number): SequenceItem
  removeSequenceItem(itemId: string): void
  reorderSequenceItem(itemId: string, toIndex: number): void
  updateSequenceItem(
    itemId: string,
    patch: Partial<
      Pick<
        SequenceItem,
        | 'trimStart'
        | 'duration'
        | 'holdDuration'
        | 'transitionOut'
        | 'masterAudioMuted'
      >
    >,
  ): void
  setTransition(itemId: string, transition: SequenceTransition): void

  setDefaultCamera(sceneId: string, cameraId: NodeId): void
  reconcileSceneCameras(sceneId?: string): CompositionScene | null
  upsertCameraCut(sceneId: string, cut: CameraCut): void
  removeCameraCut(sceneId: string, cutId: string): void
}

const SCHEMA_VERSION = 2
const DEFAULT_DURATION = 5
const projectCache = new WeakMap<SceneAPI, ProjectAPI>()

export function getProjectAPI(sceneApi: SceneAPI): ProjectAPI {
  const cached = projectCache.get(sceneApi)
  if (cached) return cached
  const created = createProjectAPI(sceneApi)
  projectCache.set(sceneApi, created)
  return created
}

export function createProjectAPI(api: SceneAPI): ProjectAPI {
  const scene = api.doc.getMap<unknown>('scene')
  const compositions = ensureMap<CompositionScene>(scene, 'compositionScenes')
  const sequenceItems = ensureMap<SequenceItem>(scene, 'sequenceItems')
  const sequenceOrder = ensureArray<string>(scene, 'sequenceOrder')

  const readScene = (id: string): CompositionScene | null => {
    const raw = compositions.get(id)
    return raw ? normalizeComposition(raw, api) : null
  }

  const orderedItems = (): SequenceItem[] => {
    const out: SequenceItem[] = []
    const seen = new Set<string>()
    for (const id of sequenceOrder.toArray()) {
      if (seen.has(id)) continue
      const item = sequenceItems.get(id)
      if (!item || !compositions.has(item.sceneId)) continue
      seen.add(id)
      out.push(normalizeSequenceItem(item))
    }
    // Self-heal older experimental builds that wrote the item map before
    // sequenceOrder existed. Map insertion order is deterministic in Yjs.
    for (const [id, item] of sequenceItems.entries()) {
      if (seen.has(id) || !compositions.has(item.sceneId)) continue
      out.push(normalizeSequenceItem(item))
    }
    return out
  }

  const writeLegacyProjection = (composition: CompositionScene): void => {
    const meta = scene.get('meta') as Y.Map<unknown> | undefined
    scene.set('root', composition.rootNodeId)
    scene.set('activeCameraId', composition.defaultCameraId)
    scene.set('activeCompositionId', composition.id)
    if (meta) meta.set('duration', composition.duration)
  }

  const ensureCompositionRoot = (
    composition: CompositionScene,
  ): CompositionScene => {
    const rootsClaimedByOtherScenes = new Set(
      [...compositions.entries()]
        .filter(([sceneId]) => sceneId !== composition.id)
        .map(([, other]) => other.rootNodeId),
    )
    const existingRoot = api.getNode(composition.rootNodeId)
    if (
      existingRoot?.kind === 'frame' &&
      existingRoot.parent === null &&
      !existingRoot.workspaceOnly &&
      !rootsClaimedByOtherScenes.has(existingRoot.id)
    ) {
      return composition
    }

    const candidates = api
      .getAllNodeIds()
      .map((id) => api.getNode(id))
      .filter(
        (node): node is Extract<Node, { kind: 'frame' }> =>
          node?.kind === 'frame' &&
          node.parent === null &&
          !node.workspaceOnly &&
          !rootsClaimedByOtherScenes.has(node.id),
      )
    const projectedRootId = api.getRoot()
    const reusableRoot =
      candidates.find((candidate) => candidate.id === projectedRootId) ??
      (candidates.length === 1 ? candidates[0] : null)
    // Only salvage children when the referenced parent is genuinely absent.
    // If a corrupt composition points at a real nested/non-frame node, moving
    // its children would steal authored content from the tree that owns it.
    const orphanedChildren =
      existingRoot === null
        ? api
            .getAllNodeIds()
            .map((id) => api.getNode(id))
            .filter(
              (node): node is Node =>
                !!node && node.parent === composition.rootNodeId,
            )
        : []

    let rootNodeId = reusableRoot?.id ?? ''
    let repaired = composition
    api.doc.transact(() => {
      if (!rootNodeId) {
        const meta = api.getMeta()
        rootNodeId = api.createNode('frame', null, {
          name: composition.name,
          size: { width: meta.canvas.width, height: meta.canvas.height },
          layout: {
            mode: 'none',
            direction: 'column',
            justify: 'start',
            align: 'start',
            gap: 0,
            padding: { top: 0, right: 0, bottom: 0, left: 0 },
            wrap: false,
            columns: 1,
            rowGap: 0,
            columnGap: 0,
          },
          appearance: {
            opacity: 1,
            fill: null,
            stroke: null,
            cornerRadius: 0,
            effects: [],
          },
          clipsContent: true,
        })
      }
      for (const child of orphanedChildren) {
        if (child.id === rootNodeId) continue
        api.appendChild(rootNodeId, child.id)
      }
      repaired = { ...composition, rootNodeId }
      compositions.set(composition.id, repaired)
    }, 'composition-root-repair')
    return repaired
  }

  const ensureInitialized = (): void => {
    if (compositions.size > 0 && sequenceItems.size > 0) {
      const activeId = scene.get('activeCompositionId')
      const activeScene =
        typeof activeId === 'string' && compositions.has(activeId)
          ? readScene(activeId)
          : null
      const first = orderedItems()[0]
      let projectedScene =
        activeScene ?? (first ? readScene(first.sceneId) : null)

      if (projectedScene) {
        projectedScene = ensureCompositionRoot(projectedScene)
        const projectedRootId = api.getRoot()
        const projectedRoot = projectedRootId
          ? api.getNode(projectedRootId)
          : null
        const activeRoot = api.getNode(projectedScene.rootNodeId)
        const projectionIsStale =
          projectedRoot?.kind !== 'frame' ||
          projectedRootId !== projectedScene.rootNodeId ||
          activeId !== projectedScene.id

        // Canvas and Layers still consume the legacy `scene.root` projection.
        // Scene switching or Fast Refresh can leave that pointer empty/stale
        // even though the composition's real root is alive. Repair it here,
        // before either surface reads it, so drawing never silently bails and
        // the layer tree cannot disagree with the active composition.
        if (activeRoot?.kind === 'frame' && projectionIsStale) {
          const projection = projectedScene
          api.doc.transact(
            () => writeLegacyProjection(projection),
            'projection-repair',
          )
        }
      }
      if (!scene.has('sequenceSchemaVersion')) {
        scene.set('sequenceSchemaVersion', SCHEMA_VERSION)
      }
      return
    }

    const meta = api.getMeta()
    const rootNodeId = api.getRoot()
    if (!rootNodeId) return
    const cameras = api
      .getAllNodeIds()
      .map((id) => api.getNode(id))
      .filter(
        (node): node is Extract<Node, { kind: 'camera' }> =>
          node?.kind === 'camera' && node.parent === null,
      )
    const sceneId = uniqueId('scene')
    const itemId = uniqueId('item')
    const defaultCameraId =
      api.getActiveCameraId() ??
      cameras.find((camera) => camera.enabled)?.id ??
      cameras[0]?.id ??
      null
    const migrated: CompositionScene = {
      id: sceneId,
      name: meta.name?.trim() || 'Scene 1',
      rootNodeId,
      duration: positiveFinite(meta.duration, DEFAULT_DURATION),
      workspaceNodeIds: [],
      cameraIds: cameras.map((camera) => camera.id),
      defaultCameraId,
      cameraCuts: {},
    }
    const occurrence: SequenceItem = {
      id: itemId,
      sceneId,
      trimStart: 0,
      transitionOut: { kind: 'cut', duration: 0 },
    }

    api.doc.transact(() => {
      compositions.set(sceneId, migrated)
      sequenceItems.set(itemId, occurrence)
      sequenceOrder.push([itemId])
      scene.set('sequenceSchemaVersion', SCHEMA_VERSION)
      writeLegacyProjection(migrated)
    }, 'migration')
  }

  const projectApi: ProjectAPI = {
    scene: api,
    ensureInitialized,

    getScenes: () => {
      ensureInitialized()
      const order = orderedItems()
      const sceneOrder = new Map<string, number>()
      order.forEach((item, index) => {
        if (!sceneOrder.has(item.sceneId)) sceneOrder.set(item.sceneId, index)
      })
      return [...compositions.values()]
        .map((composition) => normalizeComposition(composition, api))
        .sort(
          (a, b) =>
            (sceneOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
            (sceneOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER),
        )
    },

    getScene: (id) => {
      ensureInitialized()
      return readScene(id)
    },

    getSequenceItems: () => {
      ensureInitialized()
      return orderedItems()
    },

    getSequenceTimeMap: () => {
      ensureInitialized()
      return buildSequenceTimeMap({
        scenes: projectApi.getScenes(),
        items: orderedItems(),
        frameRate: api.getMeta().frameRate,
      })
    },

    getActiveSceneId: () => {
      ensureInitialized()
      const active = scene.get('activeCompositionId')
      return typeof active === 'string' && compositions.has(active)
        ? active
        : null
    },

    getActiveScene: () => {
      const id = projectApi.getActiveSceneId()
      return id ? readScene(id) : null
    },

    activateScene: (id) => {
      ensureInitialized()
      const composition = readScene(id)
      if (!composition) throw new Error(`Scene not found: ${id}`)
      const liveComposition = ensureCompositionRoot(composition)
      api.doc.transact(
        () => writeLegacyProjection(liveComposition),
        'scene-activate',
      )
    },

    createScene: (input = {}) => {
      ensureInitialized()
      if (input.duplicateFromSceneId) {
        const duplicated = projectApi.duplicateScene(
          input.duplicateFromSceneId,
          input.insertAt,
        )
        if (!duplicated) {
          throw new Error(`Scene not found: ${input.duplicateFromSceneId}`)
        }
        if (input.name || input.duration) {
          projectApi.updateScene(duplicated.id, {
            ...(input.name ? { name: input.name } : {}),
            ...(input.duration ? { duration: input.duration } : {}),
          })
        }
        return projectApi.getScene(duplicated.id) ?? duplicated
      }

      const meta = api.getMeta()
      const sceneId = uniqueId('scene')
      let rootNodeId = ''
      let cameraId = ''
      const nextName =
        input.name?.trim() || `Scene ${Math.max(1, compositions.size + 1)}`
      const duration = positiveFinite(input.duration, DEFAULT_DURATION)

      api.doc.transact(() => {
        rootNodeId = api.createNode('frame', null, {
          name: nextName,
          size: { width: meta.canvas.width, height: meta.canvas.height },
          layout: {
            mode: 'flex',
            direction: 'column',
            justify: 'center',
            align: 'center',
            gap: 0,
            padding: { top: 0, right: 0, bottom: 0, left: 0 },
            wrap: false,
            columns: 1,
            rowGap: 0,
            columnGap: 0,
          },
          appearance: {
            opacity: 1,
            fill: { kind: 'solid', color: '#111113' },
            stroke: null,
            cornerRadius: 0,
            effects: [],
          },
          clipsContent: true,
        })
        cameraId = api.createNode('camera', null, {
          name: 'Camera',
          transform: {
            x: meta.canvas.width / 2,
            y: meta.canvas.height / 2,
            z: 0,
            rotation: 0,
            rotationX: 0,
            rotationY: 0,
            scaleX: 1,
            scaleY: 1,
          },
        })
        const created: CompositionScene = {
          id: sceneId,
          name: nextName,
          rootNodeId,
          duration,
          workspaceNodeIds: [],
          cameraIds: [cameraId],
          defaultCameraId: cameraId,
          cameraCuts: {},
        }
        compositions.set(sceneId, created)
      }, 'scene-create')

      const item = projectApi.addSequenceItem(sceneId, input.insertAt)
      void item
      projectApi.activateScene(sceneId)
      return readScene(sceneId)!
    },

    duplicateScene: (id, insertAt) => {
      ensureInitialized()
      const source = readScene(id)
      if (!source) return null
      const nodeMap = new Map<NodeId, NodeId>()
      let newRoot = ''

      api.doc.transact(() => {
        newRoot = cloneSubtree(api, source.rootNodeId, null, nodeMap)
      }, 'scene-duplicate')

      const newCameraIds: NodeId[] = []
      api.doc.transact(() => {
        for (const cameraId of source.cameraIds) {
          const camera = api.getNode(cameraId)
          if (!camera || camera.kind !== 'camera') continue
          const duplicateId = cloneSingleNode(api, camera, null)
          nodeMap.set(cameraId, duplicateId)
          cloneTracks(api, camera.id, duplicateId)
          newCameraIds.push(duplicateId)
        }
      }, 'scene-duplicate')

      const newId = uniqueId('scene')
      const copyNumber = compositions.size + 1
      const copied: CompositionScene = {
        ...source,
        id: newId,
        name: `${source.name} copy ${copyNumber}`,
        rootNodeId: newRoot,
        cameraIds: newCameraIds,
        defaultCameraId: source.defaultCameraId
          ? nodeMap.get(source.defaultCameraId) ?? newCameraIds[0] ?? null
          : newCameraIds[0] ?? null,
        cameraCuts: Object.fromEntries(
          Object.values(source.cameraCuts)
            .map((cut) => {
              const cameraId = nodeMap.get(cut.cameraId)
              if (!cameraId) return null
              const nextCut: CameraCut = {
                ...cut,
                id: uniqueId('cut'),
                cameraId,
              }
              return [nextCut.id, nextCut] as const
            })
            .filter(
              (entry): entry is readonly [string, CameraCut] => entry !== null,
            ),
        ),
      }
      api.doc.transact(() => compositions.set(newId, copied), 'scene-duplicate')
      projectApi.addSequenceItem(newId, insertAt)
      projectApi.activateScene(newId)
      return copied
    },

    registerTransferredScene: (composition, insertAt) => {
      if (compositions.has(composition.id)) {
        throw new Error(`Scene already exists: ${composition.id}`)
      }
      const root = api.getNode(composition.rootNodeId)
      if (!root || root.kind !== 'frame' || root.parent !== null) {
        throw new Error(
          `Transferred scene has an invalid root: ${composition.rootNodeId}`,
        )
      }
      for (const cameraId of composition.cameraIds) {
        const camera = api.getNode(cameraId)
        if (!camera || camera.kind !== 'camera' || camera.parent !== null) {
          throw new Error(
            `Transferred scene has an invalid camera: ${cameraId}`,
          )
        }
      }
      for (const workspaceNodeId of composition.workspaceNodeIds ?? []) {
        const workspaceNode = api.getNode(workspaceNodeId)
        if (
          !workspaceNode ||
          workspaceNode.parent !== null ||
          !workspaceNode.workspaceOnly
        ) {
          throw new Error(
            `Transferred scene has an invalid workspace node: ${workspaceNodeId}`,
          )
        }
      }
      if (
        composition.defaultCameraId !== null &&
        !composition.cameraIds.includes(composition.defaultCameraId)
      ) {
        throw new Error(
          `Transferred scene default camera is not owned: ${composition.defaultCameraId}`,
        )
      }
      for (const cut of Object.values(composition.cameraCuts)) {
        if (!composition.cameraIds.includes(cut.cameraId)) {
          throw new Error(
            `Transferred scene camera cut is not owned: ${cut.id}`,
          )
        }
      }

      const item: SequenceItem = {
        id: uniqueId('item'),
        sceneId: composition.id,
        trimStart: 0,
        transitionOut: { kind: 'cut', duration: 0 },
      }
      api.doc.transact(() => {
        compositions.set(composition.id, cloneValue(composition))
        sequenceItems.set(item.id, item)
        const index = clampIndex(
          insertAt ?? sequenceOrder.length,
          sequenceOrder.length,
        )
        sequenceOrder.insert(index, [item.id])
        scene.set('sequenceSchemaVersion', SCHEMA_VERSION)
      }, 'scene-transfer-register')
      return item
    },

    deleteScene: (id) => {
      ensureInitialized()
      const composition = readScene(id)
      if (!composition) {
        return {
          deleted: false,
          reason: 'missing',
          activeSceneId: projectApi.getActiveSceneId(),
        }
      }
      if (compositions.size <= 1) {
        return {
          deleted: false,
          reason: 'last-scene',
          activeSceneId: id,
        }
      }
      const items = orderedItems()
      const firstItemIndex = items.findIndex((item) => item.sceneId === id)
      const activeId = projectApi.getActiveSceneId()
      const retainedActiveScene =
        activeId && activeId !== id ? readScene(activeId) : null
      // One composition can occur more than once in the sequence. Choosing
      // the immediately-adjacent item without filtering by scene id can point
      // the legacy projection at the very root/camera nodes deleted below.
      const nextItem =
        items
          .slice(Math.max(0, firstItemIndex + 1))
          .find((item) => item.sceneId !== id) ??
        items
          .slice(0, Math.max(0, firstItemIndex))
          .reverse()
          .find((item) => item.sceneId !== id) ??
        items.find((item) => item.sceneId !== id)
      // Deleting a background composition should not steal edit focus from a
      // still-live active scene. Only choose a sequence neighbor when the
      // deleted composition was itself active (or the projection was stale).
      const nextScene =
        retainedActiveScene ??
        (nextItem ? readScene(nextItem.sceneId) : null) ??
        [...compositions.keys()]
          .filter((compositionId) => compositionId !== id)
          .map(readScene)
          .find((candidate): candidate is CompositionScene => candidate !== null) ??
        null
      const workspaceNodesClaimedElsewhere = new Set(
        [...compositions.entries()]
          .filter(([compositionId]) => compositionId !== id)
          .flatMap(([, other]) => [...(other.workspaceNodeIds ?? [])]),
      )

      api.doc.transact(() => {
        for (const item of items) {
          if (item.sceneId !== id) continue
          removeArrayValue(sequenceOrder, item.id)
          sequenceItems.delete(item.id)
        }
        compositions.delete(id)
        api.deleteNode(composition.rootNodeId)
        for (const cameraId of composition.cameraIds) api.deleteNode(cameraId)
        for (const nodeId of composition.workspaceNodeIds ?? []) {
          if (workspaceNodesClaimedElsewhere.has(nodeId)) continue
          const node = api.getNode(nodeId)
          // Only explicitly-owned pasteboard roots are lifecycle-managed.
          // Corrupt/stale ownership metadata must never make scene deletion
          // remove an artboard node or an ordinary user-authored layer.
          if (!node || node.parent !== null || !node.workspaceOnly) continue
          const stillReferenced = api.getAllNodeIds().some((candidateId) => {
            if (candidateId === nodeId) return false
            const candidate = api.getNode(candidateId)
            return (
              candidate?.componentSourceId === nodeId ||
              (candidate?.kind === 'instance' &&
                candidate.componentId === nodeId)
            )
          })
          if (!stillReferenced) api.deleteNode(nodeId)
        }
        if (nextScene) writeLegacyProjection(nextScene)
      }, 'scene-delete')
      return {
        deleted: true,
        activeSceneId: nextScene?.id ?? null,
      }
    },

    updateScene: (id, patch) => {
      ensureInitialized()
      const current = readScene(id)
      if (!current) throw new Error(`Scene not found: ${id}`)
      const next: CompositionScene = {
        ...current,
        ...(patch.name !== undefined
          ? { name: patch.name.trim() || current.name }
          : {}),
        ...(patch.duration !== undefined
          ? { duration: positiveFinite(patch.duration, current.duration) }
          : {}),
      }
      const normalizedWorkArea = normalizeCompositionWorkArea(
        current.workArea,
        next.duration,
      )
      if (normalizedWorkArea) next.workArea = normalizedWorkArea
      else delete next.workArea
      api.doc.transact(() => {
        compositions.set(id, next)
        if (scene.get('activeCompositionId') === id) {
          writeLegacyProjection(next)
        }
        for (const [itemId, item] of sequenceItems.entries()) {
          if (item.sceneId !== id || item.duration === undefined) continue
          const maxDuration = Math.max(
            0,
            next.duration - positiveFinite(item.trimStart, 0),
          )
          if (item.duration > maxDuration) {
            sequenceItems.set(itemId, { ...item, duration: maxDuration })
          }
        }
      }, 'scene-update')
    },

    setSceneWorkArea: (id, workArea) => {
      ensureInitialized()
      const current = readScene(id)
      if (!current) throw new Error(`Scene not found: ${id}`)
      const normalized = normalizeCompositionWorkArea(
        workArea ?? undefined,
        current.duration,
      )
      if (
        current.workArea?.start === normalized?.start &&
        current.workArea?.end === normalized?.end &&
        (current.workArea === undefined) === (normalized === undefined)
      ) {
        return
      }
      const next: CompositionScene = { ...current }
      if (normalized) next.workArea = normalized
      else delete next.workArea
      api.doc.transact(
        () => compositions.set(id, next),
        'scene-work-area',
      )
    },

    registerWorkspaceNode: (sceneId, nodeId) => {
      ensureInitialized()
      const current = readScene(sceneId)
      if (!current) throw new Error(`Scene not found: ${sceneId}`)
      const node = api.getNode(nodeId)
      if (!node) throw new Error(`Workspace node not found: ${nodeId}`)
      if (node.parent !== null || !node.workspaceOnly) {
        throw new Error(
          `Workspace node ${nodeId} must be parentless and workspace-only`,
        )
      }
      const workspaceNodeIds = [...(current.workspaceNodeIds ?? [])]
      if (workspaceNodeIds.includes(nodeId)) return
      api.doc.transact(
        () =>
          compositions.set(sceneId, {
            ...current,
            workspaceNodeIds: [...workspaceNodeIds, nodeId],
          }),
        'scene-workspace-node',
      )
    },

    addSequenceItem: (sceneId, insertAt) => {
      ensureInitialized()
      const composition = readScene(sceneId)
      if (!composition) throw new Error(`Scene not found: ${sceneId}`)
      const item: SequenceItem = {
        id: uniqueId('item'),
        sceneId,
        trimStart: 0,
        transitionOut: { kind: 'cut', duration: 0 },
      }
      api.doc.transact(() => {
        sequenceItems.set(item.id, item)
        const index = clampIndex(
          insertAt ?? sequenceOrder.length,
          sequenceOrder.length,
        )
        sequenceOrder.insert(index, [item.id])
      }, 'sequence-add')
      return item
    },

    removeSequenceItem: (itemId) => {
      ensureInitialized()
      if (sequenceItems.size <= 1) return
      api.doc.transact(() => {
        sequenceItems.delete(itemId)
        removeArrayValue(sequenceOrder, itemId)
      }, 'sequence-remove')
    },

    reorderSequenceItem: (itemId, toIndex) => {
      ensureInitialized()
      const from = sequenceOrder.toArray().indexOf(itemId)
      if (from < 0) return
      const bounded = clampIndex(toIndex, Math.max(0, sequenceOrder.length - 1))
      if (from === bounded) return
      api.doc.transact(() => {
        sequenceOrder.delete(from, 1)
        sequenceOrder.insert(bounded, [itemId])
      }, 'sequence-reorder')
    },

    updateSequenceItem: (itemId, patch) => {
      ensureInitialized()
      const item = sequenceItems.get(itemId)
      if (!item) throw new Error(`Sequence item not found: ${itemId}`)
      const composition = readScene(item.sceneId)
      if (!composition) throw new Error(`Scene not found: ${item.sceneId}`)
      const trimStart = clamp(
        finite(patch.trimStart ?? item.trimStart, 0),
        0,
        composition.duration,
      )
      const requestedDuration =
        Object.prototype.hasOwnProperty.call(patch, 'duration')
          ? patch.duration
          : item.duration
      const duration =
        requestedDuration === undefined
          ? undefined
          : clamp(
              finite(requestedDuration, 0),
              0,
              composition.duration - trimStart,
            )
      const effectiveDuration =
        duration ?? composition.duration - trimStart
      const requestedHoldDuration =
        Object.prototype.hasOwnProperty.call(patch, 'holdDuration')
          ? patch.holdDuration
          : item.holdDuration
      const holdDuration = Math.max(
        0,
        finite(requestedHoldDuration, 0),
      )
      const masterAudioMuted =
        Object.prototype.hasOwnProperty.call(patch, 'masterAudioMuted')
          ? patch.masterAudioMuted === true
          : item.masterAudioMuted === true
      const next: SequenceItem = {
        ...item,
        ...patch,
        trimStart,
        transitionOut: normalizeTransition(
          patch.transitionOut ?? item.transitionOut,
          effectiveDuration + holdDuration,
        ),
      }
      if (duration === undefined) delete next.duration
      else next.duration = duration
      if (holdDuration > 0) next.holdDuration = holdDuration
      else delete next.holdDuration
      // False is the default. Keeping only the meaningful true value makes
      // existing files byte-light and preserves compatibility with schema-v2
      // projects authored before occurrence audio controls existed.
      if (masterAudioMuted) next.masterAudioMuted = true
      else delete next.masterAudioMuted
      api.doc.transact(
        () => sequenceItems.set(itemId, next),
        'sequence-update',
      )
    },

    setTransition: (itemId, transition) => {
      projectApi.updateSequenceItem(itemId, { transitionOut: transition })
    },

    setDefaultCamera: (sceneId, cameraId) => {
      ensureInitialized()
      const current = readScene(sceneId)
      const camera = api.getNode(cameraId)
      if (!current) throw new Error(`Scene not found: ${sceneId}`)
      if (!camera || camera.kind !== 'camera') {
        throw new Error(`Camera not found: ${cameraId}`)
      }
      const owner = [...compositions.entries()].find(
        ([otherSceneId, composition]) =>
          otherSceneId !== sceneId &&
          (composition.cameraIds ?? []).includes(cameraId),
      )?.[0]
      if (owner) {
        throw new Error(
          `Camera ${cameraId} already belongs to scene ${owner}`,
        )
      }
      const cameraIds = current.cameraIds.includes(cameraId)
        ? [...current.cameraIds]
        : [...current.cameraIds, cameraId]
      const next = { ...current, cameraIds, defaultCameraId: cameraId }
      api.doc.transact(() => {
        compositions.set(sceneId, next)
        if (scene.get('activeCompositionId') === sceneId) {
          scene.set('activeCameraId', cameraId)
        }
      }, 'camera-default')
    },

    reconcileSceneCameras: (sceneId) => {
      ensureInitialized()
      const id = sceneId ?? projectApi.getActiveSceneId()
      if (!id) return null
      const current = readScene(id)
      if (!current) return null
      const allLive = api
        .getAllNodeIds()
        .map((nodeId) => api.getNode(nodeId))
        .filter(
          (node): node is Extract<Node, { kind: 'camera' }> =>
            node?.kind === 'camera' && node.parent === null,
        )
      const claimedElsewhere = new Set(
        [...compositions.entries()]
          .filter(([otherId]) => otherId !== id)
          .flatMap(([, composition]) => [...(composition.cameraIds ?? [])]),
      )
      const cameraIds = [
        ...current.cameraIds.filter((cameraId) =>
          allLive.some((camera) => camera.id === cameraId),
        ),
        ...allLive
          .filter(
            (camera) =>
              !current.cameraIds.includes(camera.id) &&
              !claimedElsewhere.has(camera.id),
          )
          .map((camera) => camera.id),
      ]
      const defaultCameraId =
        current.defaultCameraId &&
        cameraIds.includes(current.defaultCameraId)
          ? current.defaultCameraId
          : cameraIds[0] ?? null
      const cameraCuts = Object.fromEntries(
        Object.entries(current.cameraCuts).filter(([, cut]) =>
          cameraIds.includes(cut.cameraId),
        ),
      )
      const next = { ...current, cameraIds, defaultCameraId, cameraCuts }
      if (!sameCompositionCameraState(current, next)) {
        api.doc.transact(() => {
          compositions.set(id, next)
          if (scene.get('activeCompositionId') === id) {
            scene.set('activeCameraId', defaultCameraId)
          }
        }, 'camera-reconcile')
      }
      return next
    },

    upsertCameraCut: (sceneId, cut) => {
      ensureInitialized()
      const current = projectApi.reconcileSceneCameras(sceneId)
      if (!current) throw new Error(`Scene not found: ${sceneId}`)
      if (!current.cameraIds.includes(cut.cameraId)) {
        throw new Error(
          `Camera ${cut.cameraId} does not belong to scene ${sceneId}`,
        )
      }
      const normalized: CameraCut = {
        ...cut,
        id: cut.id || uniqueId('cut'),
        time: clamp(finite(cut.time, 0), 0, current.duration),
      }
      api.doc.transact(
        () =>
          compositions.set(sceneId, {
            ...current,
            cameraCuts: {
              ...current.cameraCuts,
              [normalized.id]: normalized,
            },
          }),
        'camera-cut',
      )
    },

    removeCameraCut: (sceneId, cutId) => {
      ensureInitialized()
      const current = readScene(sceneId)
      if (!current || !current.cameraCuts[cutId]) return
      const cameraCuts = { ...current.cameraCuts }
      delete cameraCuts[cutId]
      api.doc.transact(
        () => compositions.set(sceneId, { ...current, cameraCuts }),
        'camera-cut',
      )
    },
  }

  return projectApi
}

function normalizeComposition(
  raw: CompositionScene,
  api: SceneAPI,
): CompositionScene {
  const workspaceNodeIds = Array.from(
    new Set(raw.workspaceNodeIds ?? []),
  ).filter((id) => {
    const node = api.getNode(id)
    return node?.parent === null && node.workspaceOnly === true
  })
  const cameraIds = Array.from(new Set(raw.cameraIds ?? [])).filter(
    (id) => api.getNode(id)?.kind === 'camera',
  )
  const duration = positiveFinite(raw.duration, DEFAULT_DURATION)
  const workArea = normalizeCompositionWorkArea(raw.workArea, duration)
  const cameraCuts = Object.fromEntries(
    Object.entries(raw.cameraCuts ?? {})
      .filter(([, cut]) => cameraIds.includes(cut.cameraId))
      .map(([id, cut]) => [
        id,
        {
          ...cut,
          id,
          time: clamp(Number.isFinite(cut.time) ? cut.time : 0, 0, duration),
        },
      ]),
  )
  const normalized: CompositionScene = {
    ...raw,
    name: raw.name?.trim() || 'Scene',
    duration,
    workspaceNodeIds,
    cameraIds,
    defaultCameraId:
      raw.defaultCameraId && cameraIds.includes(raw.defaultCameraId)
        ? raw.defaultCameraId
        : cameraIds[0] ?? null,
    cameraCuts,
  }
  if (workArea) normalized.workArea = workArea
  else delete normalized.workArea
  return normalized
}

function normalizeCompositionWorkArea(
  raw: CompositionWorkArea | undefined,
  duration: number,
): CompositionWorkArea | undefined {
  if (!raw) return undefined
  const start = clamp(finite(raw.start, 0), 0, duration)
  const end = clamp(finite(raw.end, duration), 0, duration)
  // Missing means full duration and follows later duration changes. Collapse
  // an authored full-range override to that canonical representation.
  if (end <= start || (start === 0 && end === duration)) return undefined
  return { start, end }
}

function normalizeSequenceItem(item: SequenceItem): SequenceItem {
  const duration =
    item.duration === undefined
      ? undefined
      : Math.max(0, finite(item.duration, 0))
  const holdDuration = Math.max(0, finite(item.holdDuration, 0))
  const normalized: SequenceItem = {
    ...item,
    trimStart: Math.max(0, finite(item.trimStart, 0)),
    duration,
    // An omitted duration means "the remainder of the composition", not zero.
    // The pure time-map layer has the scene context needed to clamp this
    // transition precisely; preserve the authored request until then.
    transitionOut: normalizeTransition(
      item.transitionOut,
      duration === undefined ? undefined : duration + holdDuration,
    ),
  }
  if (holdDuration > 0) normalized.holdDuration = holdDuration
  else delete normalized.holdDuration
  if (item.masterAudioMuted === true) normalized.masterAudioMuted = true
  else delete normalized.masterAudioMuted
  return normalized
}

function normalizeTransition(
  transition: SequenceTransition | undefined,
  itemDuration?: number,
): SequenceTransition {
  if (!transition || transition.kind === 'cut') {
    return { kind: 'cut', duration: 0 }
  }
  const maximumDuration =
    itemDuration === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(0, itemDuration)
  return {
    kind: 'crossfade',
    duration: clamp(finite(transition.duration, 0), 0, maximumDuration),
  }
}

function cloneSubtree(
  api: SceneAPI,
  sourceId: NodeId,
  parent: NodeId | null,
  nodeMap: Map<NodeId, NodeId>,
): NodeId {
  const source = api.getNode(sourceId)
  if (!source) throw new Error(`Node not found while duplicating: ${sourceId}`)
  const duplicateId = cloneSingleNode(api, source, parent)
  nodeMap.set(sourceId, duplicateId)
  cloneTracks(api, sourceId, duplicateId)
  for (const child of api.getChildren(sourceId)) {
    cloneSubtree(api, child.id, duplicateId, nodeMap)
  }
  return duplicateId
}

function cloneSingleNode(
  api: SceneAPI,
  node: Node,
  parent: NodeId | null,
): NodeId {
  const {
    id: _id,
    kind: _kind,
    parent: _parent,
    children: _children,
    ...cloned
  } = cloneValue(node)
  void _id
  void _kind
  void _parent
  void _children
  return api.createNode(
    node.kind,
    parent,
    cloned as Parameters<SceneAPI['createNode']>[2],
  )
}

function cloneTracks(api: SceneAPI, sourceId: NodeId, targetId: NodeId): void {
  for (const track of api.getTracksForNode(sourceId)) {
    const copied = cloneValue(track) as Track
    api.setTrack({
      ...copied,
      id: uniqueId('track'),
      nodeId: targetId,
      keyframes: copied.keyframes.map((keyframe) => ({
        ...keyframe,
        id: uniqueId('kf'),
      })),
    })
  }
}

function sameCompositionCameraState(
  left: CompositionScene,
  right: CompositionScene,
): boolean {
  return (
    left.defaultCameraId === right.defaultCameraId &&
    left.cameraIds.join('\u0000') === right.cameraIds.join('\u0000') &&
    JSON.stringify(left.cameraCuts) === JSON.stringify(right.cameraCuts)
  )
}

function ensureMap<T>(
  parent: Y.Map<unknown>,
  key: string,
): Y.Map<T> {
  const existing = parent.get(key)
  if (existing instanceof Y.Map) return existing as Y.Map<T>
  const created = new Y.Map<T>()
  parent.set(key, created)
  return created
}

function ensureArray<T>(
  parent: Y.Map<unknown>,
  key: string,
): Y.Array<T> {
  const existing = parent.get(key)
  if (existing instanceof Y.Array) return existing as Y.Array<T>
  const created = new Y.Array<T>()
  parent.set(key, created)
  return created
}

function removeArrayValue<T>(array: Y.Array<T>, value: T): void {
  const index = array.toArray().indexOf(value)
  if (index >= 0) array.delete(index, 1)
}

function uniqueId(prefix: string): string {
  const uuid =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
  return `${prefix}_${uuid}`
}

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value)) as T
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function positiveFinite(value: unknown, fallback: number): number {
  const number = finite(value, fallback)
  return number > 0 ? number : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function clampIndex(value: number, max: number): number {
  if (!Number.isFinite(value)) return max
  return Math.max(0, Math.min(max, Math.trunc(value)))
}

export function sceneMetaForComposition(
  meta: SceneMeta,
  composition: CompositionScene,
): SceneMeta {
  return {
    ...meta,
    name: composition.name,
    duration: composition.duration,
  }
}
