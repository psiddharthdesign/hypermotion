// SPDX-License-Identifier: Apache-2.0

import * as Y from 'yjs'
import {
  createSceneAPI,
  type SceneAPI,
  type UiStateSlab,
} from '@/scene/doc'
import {
  readScene,
  sceneToBytes,
} from '@/scene/file'
import type {
  ComponentTimeline,
  CustomFont,
  Interaction,
  InteractionAction,
  InteractionTarget,
  Node,
  NodeId,
  Track,
} from '@/scene/types'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import type {
  CameraCut,
  CompositionScene,
} from '@/sequence/types'
import {
  createProjectAPI,
  type ProjectAPI,
} from './doc'

export interface TransferredScene {
  sourceSceneId: string
  sceneId: string
  sequenceItemId: string
  name: string
}

export interface SceneTransferResult {
  scenes: TransferredScene[]
  warnings: string[]
}

interface CompositionGraph {
  nodeIds: Set<NodeId>
  workspaceRootIds: Set<NodeId>
}

interface TransferIdMaps {
  node: Map<NodeId, NodeId>
  track: Map<string, string>
  keyframeByTrack: Map<string, Map<string, string>>
  keyframeKey: Map<string, string>
}

interface FontTransferPlan {
  familyMap: Map<string, string>
  fonts: CustomFont[]
}

/**
 * Append every unique composition from another `.hype` document.
 *
 * The donor bytes are always decoded into a side document. Applying their
 * Yjs update to the live editor would merge top-level project keys and CRDT
 * history, which can replace roots or meta rather than append content.
 */
export function importScenesFromHypeBytes(
  target: ProjectAPI,
  bytes: Uint8Array,
): SceneTransferResult {
  const source = readScene(bytes)
  try {
    const sourceProject = createProjectAPI(source.api)
    sourceProject.ensureInitialized()
    return transferCompositionScenes(sourceProject, target)
  } finally {
    source.doc.destroy()
  }
}

/** Create an ordinary one-composition `.hype` package. */
export function exportCompositionToHypeBytes(
  source: ProjectAPI,
  sceneId: string,
): Uint8Array {
  source.ensureInitialized()
  const composition = source.getScene(sceneId)
  if (!composition) throw new Error(`Scene not found: ${sceneId}`)

  const doc = new Y.Doc()
  const targetApi = createSceneAPI(doc)
  for (const nodeId of targetApi.getAllNodeIds()) targetApi.deleteNode(nodeId)
  targetApi.setMeta({
    ...cloneValue(source.scene.getMeta()),
    name: composition.name,
    duration: composition.duration,
  })
  const targetProject = createProjectAPI(targetApi)

  try {
    transferCompositionScenesIntoDocument(source, targetProject, [sceneId])
    // Sections are currently project-global. They belong in a standalone
    // exported file, but are deliberately not merged into an existing project
    // by the import path because that would expose them on unrelated scenes.
    for (const section of source.scene.getSections()) {
      targetApi.setSection({ ...cloneValue(section), id: uniqueId('section') })
    }
    return sceneToBytes(doc)
  } finally {
    doc.destroy()
  }
}

/**
 * Cross-document composition clone shared by import and portable export.
 * Every document-scoped id is minted afresh and all known node references are
 * rewritten in a second pass after the full dependency graph exists.
 */
export function transferCompositionScenes(
  source: ProjectAPI,
  target: ProjectAPI,
  requestedSceneIds?: readonly string[],
): SceneTransferResult {
  const warnings = compatibilityWarnings(source.scene, target.scene)
  // A brand-new export document has no user state to protect. All live-editor
  // imports take the staged path below so a malformed donor cannot leave half
  // of its graph in the target document.
  if (!target.scene.getRoot()) {
    return {
      ...transferCompositionScenesIntoDocument(
        source,
        target,
        requestedSceneIds,
      ),
      warnings,
    }
  }

  const targetStateVector = Y.encodeStateVector(target.scene.doc)
  const stagedDoc = new Y.Doc()
  try {
    Y.applyUpdate(stagedDoc, Y.encodeStateAsUpdate(target.scene.doc))
    const stagedApi = createSceneAPI(stagedDoc)
    const stagedProject = createProjectAPI(stagedApi)
    const result = transferCompositionScenesIntoDocument(
      source,
      stagedProject,
      requestedSceneIds,
    )
    const stagedUpdate = Y.encodeStateAsUpdate(stagedDoc, targetStateVector)
    Y.applyUpdate(
      target.scene.doc,
      stagedUpdate,
      UNDOABLE_GESTURE_ORIGIN,
    )
    return { ...result, warnings }
  } finally {
    stagedDoc.destroy()
  }
}

function transferCompositionScenesIntoDocument(
  source: ProjectAPI,
  target: ProjectAPI,
  requestedSceneIds?: readonly string[],
): Pick<SceneTransferResult, 'scenes'> {
  source.ensureInitialized()
  const sourceScenes = source.getScenes()
  const requested = requestedSceneIds
    ? new Set(requestedSceneIds)
    : null
  const compositions = requested
    ? sourceScenes.filter((scene) => requested.has(scene.id))
    : sourceScenes
  if (compositions.length === 0) {
    throw new Error('No scenes were found in this file.')
  }
  if (requested && compositions.length !== requested.size) {
    throw new Error('One or more requested scenes could not be found.')
  }

  // Upgrade a legacy target before adding anything. A fresh export document
  // has no root and must stay empty until its transferred scene is registered.
  if (target.scene.getRoot()) target.ensureInitialized()
  const insertAt = target.getSequenceItems().length
  const graphs = new Map<string, CompositionGraph>()
  const allNodeIds = new Set<NodeId>()
  for (const composition of compositions) {
    const graph = collectCompositionGraph(source.scene, composition)
    graphs.set(composition.id, graph)
    for (const nodeId of graph.nodeIds) allNodeIds.add(nodeId)
  }
  const dependencyRootByNode = new Map<NodeId, NodeId>()
  for (const graph of graphs.values()) {
    for (const workspaceRootId of graph.workspaceRootIds) {
      for (const nodeId of collectSubtreeNodeIds(source.scene, workspaceRootId)) {
        dependencyRootByNode.set(nodeId, workspaceRootId)
      }
    }
  }
  for (const composition of compositions) {
    const graph = graphs.get(composition.id)
    if (!graph) throw new Error(`Scene graph not found: ${composition.id}`)
    expandCompositionDependencies(
      source.scene,
      graph,
      allNodeIds,
      dependencyRootByNode,
    )
  }
  validateCompositionGraphs(
    source.scene,
    compositions,
    graphs,
    allNodeIds,
  )

  const ids: TransferIdMaps = {
    node: new Map<NodeId, NodeId>(),
    track: new Map<string, string>(),
    keyframeByTrack: new Map<string, Map<string, string>>(),
    keyframeKey: new Map<string, string>(),
  }
  const fontPlan = planCustomFonts(source.scene, target.scene)
  const transferred: TransferredScene[] = []
  target.scene.doc.transact(() => {
    // Roots first keeps the freshly-created standalone document's legacy root
    // pointed at an artboard instead of a component dependency.
    for (const composition of compositions) {
      cloneSubtreeAcrossDocuments(
        source.scene,
        target.scene,
        composition.rootNodeId,
        null,
        allNodeIds,
        ids,
        fontPlan.familyMap,
      )
    }
    for (const composition of compositions) {
      const graph = graphs.get(composition.id)
      if (!graph) continue
      for (const workspaceRootId of graph.workspaceRootIds) {
        cloneSubtreeAcrossDocuments(
          source.scene,
          target.scene,
          workspaceRootId,
          null,
          allNodeIds,
          ids,
          fontPlan.familyMap,
        )
      }
      for (const cameraId of composition.cameraIds) {
        cloneSubtreeAcrossDocuments(
          source.scene,
          target.scene,
          cameraId,
          null,
          allNodeIds,
          ids,
          fontPlan.familyMap,
        )
      }
    }
    // Clone any dependency root not reached above (for example a pasteboard
    // image sampled by a shader).
    for (const sourceNodeId of allNodeIds) {
      if (ids.node.has(sourceNodeId)) continue
      const sourceNode = source.scene.getNode(sourceNodeId)
      if (!sourceNode) continue
      cloneSubtreeAcrossDocuments(
        source.scene,
        target.scene,
        sourceNodeId,
        null,
        allNodeIds,
        ids,
        fontPlan.familyMap,
      )
    }
    if (ids.node.size !== allNodeIds.size) {
      throw new Error('The source scene graph contains unreachable nodes.')
    }

    for (const sourceNodeId of allNodeIds) {
      remapNodeReferences(
        source.scene,
        target.scene,
        sourceNodeId,
        ids.node,
        fontPlan.familyMap,
      )
    }
    for (const graph of graphs.values()) {
      for (const sourceWorkspaceId of graph.workspaceRootIds) {
        const targetWorkspaceId = requiredMappedNode(
          sourceWorkspaceId,
          ids.node,
        )
        target.scene.setNodeProperty(
          targetWorkspaceId,
          'workspaceOnly',
          true,
        )
      }
    }
    copyCustomFonts(target.scene, fontPlan)
    copyUiState(source.scene, target.scene, ids)

    compositions.forEach((composition, index) => {
      const graph = graphs.get(composition.id)
      if (!graph) throw new Error(`Scene graph not found: ${composition.id}`)
      const copied = remapComposition(composition, graph, ids.node)
      const item = target.registerTransferredScene(copied, insertAt + index)
      transferred.push({
        sourceSceneId: composition.id,
        sceneId: copied.id,
        sequenceItemId: item.id,
        name: copied.name,
      })
    })
    const first = transferred[0]
    if (first) target.activateScene(first.sceneId)
  }, UNDOABLE_GESTURE_ORIGIN)
  return { scenes: transferred }
}

function collectCompositionGraph(
  api: SceneAPI,
  composition: CompositionScene,
): CompositionGraph {
  const nodeIds = new Set<NodeId>()
  const workspaceRootIds = new Set<NodeId>(composition.workspaceNodeIds ?? [])
  for (const nodeId of collectSubtreeNodeIds(api, composition.rootNodeId)) {
    nodeIds.add(nodeId)
  }
  for (const workspaceNodeId of workspaceRootIds) {
    for (const nodeId of collectSubtreeNodeIds(api, workspaceNodeId)) {
      nodeIds.add(nodeId)
    }
  }
  for (const cameraId of composition.cameraIds) {
    for (const nodeId of collectSubtreeNodeIds(api, cameraId)) {
      nodeIds.add(nodeId)
    }
  }
  return { nodeIds, workspaceRootIds }
}

function collectSubtreeNodeIds(api: SceneAPI, rootId: NodeId): NodeId[] {
  const result: NodeId[] = []
  const seen = new Set<NodeId>()
  const visit = (nodeId: NodeId): void => {
    if (seen.has(nodeId)) return
    seen.add(nodeId)
    const node = api.getNode(nodeId)
    if (!node) return
    result.push(nodeId)
    for (const child of api.getChildren(nodeId)) visit(child.id)
  }
  visit(rootId)
  return result
}

function expandCompositionDependencies(
  api: SceneAPI,
  graph: CompositionGraph,
  allNodeIds: Set<NodeId>,
  dependencyRootByNode: Map<NodeId, NodeId>,
): void {
  const queue = [...graph.nodeIds]
  for (let index = 0; index < queue.length; index += 1) {
    const nodeId = queue[index]!
    const node = api.getNode(nodeId)
    if (!node) throw new Error(`Node not found: ${nodeId}`)
    for (const reference of nodeReferences(node)) {
      if (graph.nodeIds.has(reference)) continue
      const referenced = api.getNode(reference)
      if (!referenced) {
        throw new Error(`Referenced node does not exist: ${reference}`)
      }
      const knownDependencyRoot = dependencyRootByNode.get(reference)
      const root = knownDependencyRoot
        ? api.getNode(knownDependencyRoot)
        : topLevelNode(api, referenced)
      if (!root || (root.kind !== 'component' && !root.workspaceOnly)) {
        throw new Error(
          `A scene references a layer owned by another scene: ${reference}`,
        )
      }
      graph.workspaceRootIds.add(root.id)
      for (const dependencyId of collectSubtreeNodeIds(api, root.id)) {
        dependencyRootByNode.set(dependencyId, root.id)
        allNodeIds.add(dependencyId)
        if (graph.nodeIds.has(dependencyId)) continue
        graph.nodeIds.add(dependencyId)
        queue.push(dependencyId)
      }
    }
  }
}

function validateCompositionGraphs(
  api: SceneAPI,
  compositions: readonly CompositionScene[],
  graphs: ReadonlyMap<string, CompositionGraph>,
  allNodeIds: ReadonlySet<NodeId>,
): void {
  const workspaceRoots = new Set<NodeId>()
  for (const graph of graphs.values()) {
    for (const id of graph.workspaceRootIds) workspaceRoots.add(id)
  }
  for (const composition of compositions) {
    const graph = graphs.get(composition.id)
    const root = api.getNode(composition.rootNodeId)
    if (!graph || !root || root.kind !== 'frame' || root.parent !== null) {
      throw new Error(`Scene "${composition.name}" has an invalid root.`)
    }
    for (const cameraId of composition.cameraIds) {
      const camera = api.getNode(cameraId)
      if (!camera || camera.kind !== 'camera' || camera.parent !== null) {
        throw new Error(`Scene "${composition.name}" has an invalid camera.`)
      }
    }
    if (
      composition.defaultCameraId !== null &&
      !composition.cameraIds.includes(composition.defaultCameraId)
    ) {
      throw new Error(`Scene "${composition.name}" has an invalid default camera.`)
    }
    for (const cut of Object.values(composition.cameraCuts)) {
      if (!composition.cameraIds.includes(cut.cameraId)) {
        throw new Error(`Scene "${composition.name}" has an invalid camera cut.`)
      }
    }
    for (const workspaceNodeId of composition.workspaceNodeIds ?? []) {
      const workspaceNode = api.getNode(workspaceNodeId)
      if (
        !workspaceNode ||
        workspaceNode.parent !== null ||
        (workspaceNode.kind !== 'component' && !workspaceNode.workspaceOnly)
      ) {
        throw new Error(`Scene "${composition.name}" has an invalid workspace asset.`)
      }
    }
    for (const nodeId of graph.nodeIds) {
      const node = api.getNode(nodeId)
      if (!node) throw new Error(`Scene "${composition.name}" has a missing layer.`)
      if (
        node.parent &&
        !allNodeIds.has(node.parent) &&
        !workspaceRoots.has(node.id)
      ) {
        throw new Error(`Scene "${composition.name}" has an unreachable layer.`)
      }
      for (const reference of nodeReferences(node)) {
        if (!graph.nodeIds.has(reference)) {
          throw new Error(
            `Scene "${composition.name}" has an unsupported cross-scene reference.`,
          )
        }
      }
    }
  }
}

function cloneSubtreeAcrossDocuments(
  source: SceneAPI,
  target: SceneAPI,
  sourceId: NodeId,
  parent: NodeId | null,
  allowed: ReadonlySet<NodeId>,
  ids: TransferIdMaps,
  fontFamilyMap: ReadonlyMap<string, string>,
): NodeId {
  const existing = ids.node.get(sourceId)
  if (existing) return existing
  if (!allowed.has(sourceId)) {
    throw new Error(`Node is outside the transferred scene: ${sourceId}`)
  }
  const sourceNode = source.getNode(sourceId)
  if (!sourceNode) throw new Error(`Node not found: ${sourceId}`)
  const targetId = cloneSingleNode(
    target,
    sourceNode,
    parent,
    fontFamilyMap,
  )
  ids.node.set(sourceId, targetId)
  cloneTracks(source, target, sourceId, targetId, ids)
  for (const child of source.getChildren(sourceId)) {
    if (!allowed.has(child.id)) continue
    cloneSubtreeAcrossDocuments(
      source,
      target,
      child.id,
      targetId,
      allowed,
      ids,
      fontFamilyMap,
    )
  }
  return targetId
}

function cloneSingleNode(
  target: SceneAPI,
  node: Node,
  parent: NodeId | null,
  fontFamilyMap: ReadonlyMap<string, string>,
): NodeId {
  const {
    id: _id,
    kind: _kind,
    parent: _parent,
    children: _children,
    ...props
  } = cloneValue(node)
  void _id
  void _kind
  void _parent
  void _children
  const remappedProps = remapFontFamilyValues(props, fontFamilyMap)
  return target.createNode(
    node.kind,
    parent,
    remappedProps as Parameters<SceneAPI['createNode']>[2],
  )
}

function cloneTracks(
  source: SceneAPI,
  target: SceneAPI,
  sourceId: NodeId,
  targetId: NodeId,
  ids: TransferIdMaps,
): void {
  for (const sourceTrack of source.getTracksForNode(sourceId)) {
    const track = cloneValue(sourceTrack)
    const trackId = uniqueId('track')
    const keyframeIds = new Map<string, string>()
    ids.track.set(sourceTrack.id, trackId)
    ids.keyframeByTrack.set(sourceTrack.id, keyframeIds)
    target.setTrack({
      ...track,
      id: trackId,
      nodeId: targetId,
      keyframes: track.keyframes.map((keyframe) => {
        const keyframeId = uniqueId('kf')
        keyframeIds.set(keyframe.id, keyframeId)
        ids.keyframeKey.set(
          `${sourceTrack.id}:${keyframe.id}`,
          `${trackId}:${keyframeId}`,
        )
        return { ...keyframe, id: keyframeId }
      }),
    })
  }
}

function remapNodeReferences(
  source: SceneAPI,
  target: SceneAPI,
  sourceId: NodeId,
  nodeMap: ReadonlyMap<NodeId, NodeId>,
  fontFamilyMap: ReadonlyMap<string, string>,
): void {
  const sourceNode = source.getNode(sourceId)
  const targetId = nodeMap.get(sourceId)
  if (!sourceNode || !targetId) return

  if (sourceNode.componentSourceId) {
    target.setNodeProperty(
      targetId,
      'componentSourceId',
      requiredMappedNode(sourceNode.componentSourceId, nodeMap),
    )
  }
  if (sourceNode.kind === 'shader') {
    target.setNodeProperty(
      targetId,
      'sourceNodeId',
      sourceNode.sourceNodeId
        ? requiredMappedNode(sourceNode.sourceNodeId, nodeMap)
        : undefined,
    )
  }
  if (sourceNode.kind === 'camera') {
    target.setNodeProperty(
      targetId,
      'focusTargetNodeId',
      sourceNode.focusTargetNodeId
        ? requiredMappedNode(sourceNode.focusTargetNodeId, nodeMap)
        : null,
    )
  }
  if (sourceNode.kind === 'instance') {
    target.setNodeProperty(
      targetId,
      'componentId',
      requiredMappedNode(sourceNode.componentId, nodeMap),
    )
    target.setNodeProperty(
      targetId,
      'overrides',
      remapOverrideRecord(sourceNode.overrides, nodeMap, fontFamilyMap),
    )
    target.setNodeProperty(
      targetId,
      'interactions',
      sourceNode.interactions.map((interaction) =>
        remapInteraction(interaction, nodeMap, fontFamilyMap),
      ),
    )
  }
  if (sourceNode.kind === 'component') {
    target.setNodeProperty(
      targetId,
      'variantOverrides',
      sourceNode.variantOverrides.map((variant) => ({
        ...cloneValue(variant),
        overrides: remapOverrideRecord(
          variant.overrides,
          nodeMap,
          fontFamilyMap,
        ),
      })),
    )
    target.setNodeProperty(
      targetId,
      'componentProperties',
      sourceNode.componentProperties.map((property) => ({
        ...cloneValue(property),
        nodeId: requiredMappedNode(property.nodeId, nodeMap),
      })),
    )
    target.setNodeProperty(
      targetId,
      'timelines',
      remapComponentTimelines(
        sourceNode.timelines,
        nodeMap,
        fontFamilyMap,
      ),
    )
    target.setNodeProperty(
      targetId,
      'interactions',
      sourceNode.interactions.map((interaction) =>
        remapInteraction(interaction, nodeMap, fontFamilyMap),
      ),
    )
  }
}

function remapComposition(
  source: CompositionScene,
  graph: CompositionGraph,
  nodeMap: ReadonlyMap<NodeId, NodeId>,
): CompositionScene {
  const rootNodeId = requiredMappedNode(source.rootNodeId, nodeMap)
  const cameraIds = source.cameraIds.map((id) => requiredMappedNode(id, nodeMap))
  const defaultCameraId = source.defaultCameraId
    ? requiredMappedNode(source.defaultCameraId, nodeMap)
    : null
  const cameraCuts: Record<string, CameraCut> = {}
  for (const cut of Object.values(source.cameraCuts)) {
    const id = uniqueId('cut')
    cameraCuts[id] = {
      ...cloneValue(cut),
      id,
      cameraId: requiredMappedNode(cut.cameraId, nodeMap),
    }
  }
  return {
    ...cloneValue(source),
    id: uniqueId('scene'),
    rootNodeId,
    workspaceNodeIds: [...graph.workspaceRootIds].map((id) =>
      requiredMappedNode(id, nodeMap),
    ),
    cameraIds,
    defaultCameraId,
    cameraCuts,
  }
}

function nodeReferences(node: Node): NodeId[] {
  const references: NodeId[] = []
  if (node.componentSourceId) references.push(node.componentSourceId)
  if (node.kind === 'shader' && node.sourceNodeId) {
    references.push(node.sourceNodeId)
  }
  if (node.kind === 'camera' && node.focusTargetNodeId) {
    references.push(node.focusTargetNodeId)
  }
  if (node.kind === 'instance') {
    references.push(node.componentId, ...Object.keys(node.overrides))
    for (const interaction of node.interactions) {
      references.push(...interactionReferences(interaction))
    }
  }
  if (node.kind === 'component') {
    for (const variant of node.variantOverrides) {
      references.push(...Object.keys(variant.overrides))
    }
    for (const property of node.componentProperties) {
      references.push(property.nodeId)
    }
    for (const timeline of Object.values(node.timelines)) {
      for (const track of timeline.tracks) references.push(track.nodeId)
    }
    for (const interaction of node.interactions) {
      references.push(...interactionReferences(interaction))
    }
  }
  return references
}

function interactionReferences(interaction: Interaction): NodeId[] {
  const references = interaction.sourceNodeId ? [interaction.sourceNodeId] : []
  const visit = (action: InteractionAction): void => {
    if (action.type === 'after') {
      visit(action.action)
      return
    }
    if (action.target?.kind === 'node') references.push(action.target.nodeId)
    if (action.target?.kind === 'instance') {
      references.push(action.target.instanceId)
    }
  }
  interaction.actions.forEach(visit)
  return references
}

function remapInteraction(
  source: Interaction,
  nodeMap: ReadonlyMap<NodeId, NodeId>,
  fontFamilyMap: ReadonlyMap<string, string>,
): Interaction {
  const interaction = remapFontFamilyValues(
    cloneValue(source),
    fontFamilyMap,
  )
  if (interaction.sourceNodeId) {
    interaction.sourceNodeId = requiredMappedNode(
      interaction.sourceNodeId,
      nodeMap,
    )
  }
  interaction.actions = interaction.actions.map((action) =>
    remapInteractionAction(action, nodeMap, fontFamilyMap),
  )
  return interaction
}

function remapInteractionAction(
  source: InteractionAction,
  nodeMap: ReadonlyMap<NodeId, NodeId>,
  fontFamilyMap: ReadonlyMap<string, string>,
): InteractionAction {
  if (source.type === 'after') {
    return {
      ...remapFontFamilyValues(cloneValue(source), fontFamilyMap),
      action: remapInteractionAction(
        source.action,
        nodeMap,
        fontFamilyMap,
      ),
    }
  }
  const action = remapFontFamilyValues(cloneValue(source), fontFamilyMap)
  if (!action.target) return action
  action.target = remapInteractionTarget(action.target, nodeMap)
  return action
}

function remapInteractionTarget(
  target: InteractionTarget,
  nodeMap: ReadonlyMap<NodeId, NodeId>,
): InteractionTarget {
  if (target.kind === 'self') return target
  if (target.kind === 'node') {
    return {
      kind: 'node',
      nodeId: requiredMappedNode(target.nodeId, nodeMap),
    }
  }
  return {
    kind: 'instance',
    instanceId: requiredMappedNode(target.instanceId, nodeMap),
  }
}

function remapOverrideRecord(
  overrides: Record<NodeId, Record<string, unknown>>,
  nodeMap: ReadonlyMap<NodeId, NodeId>,
  fontFamilyMap: ReadonlyMap<string, string>,
): Record<NodeId, Record<string, unknown>> {
  const remapped: Record<NodeId, Record<string, unknown>> = {}
  for (const [sourceId, values] of Object.entries(overrides)) {
    const targetId = requiredMappedNode(sourceId, nodeMap)
    remapped[targetId] = remapFontFamilyValues(
      cloneValue(values),
      fontFamilyMap,
    )
  }
  return remapped
}

function remapComponentTimelines(
  timelines: Record<string, ComponentTimeline>,
  nodeMap: ReadonlyMap<NodeId, NodeId>,
  fontFamilyMap: ReadonlyMap<string, string>,
): Record<string, ComponentTimeline> {
  const remapped: Record<string, ComponentTimeline> = {}
  for (const [id, timeline] of Object.entries(timelines)) {
    remapped[id] = {
      ...remapFontFamilyValues(cloneValue(timeline), fontFamilyMap),
      tracks: timeline.tracks.map((track): Track => ({
        ...remapFontFamilyValues(cloneValue(track), fontFamilyMap),
        id: uniqueId('track'),
        nodeId: requiredMappedNode(track.nodeId, nodeMap),
        keyframes: track.keyframes.map((keyframe) => ({
          ...remapFontFamilyValues(cloneValue(keyframe), fontFamilyMap),
          id: uniqueId('kf'),
        })),
      })),
    }
  }
  return remapped
}

function topLevelNode(api: SceneAPI, node: Node): Node {
  let current = node
  const seen = new Set<NodeId>()
  while (current.parent && !seen.has(current.id)) {
    seen.add(current.id)
    const parent = api.getNode(current.parent)
    if (!parent) break
    current = parent
  }
  return current
}

function compatibilityWarnings(source: SceneAPI, target: SceneAPI): string[] {
  const sourceMeta = source.getMeta()
  const targetMeta = target.getMeta()
  const warnings: string[] = []
  if (
    sourceMeta.canvas.width !== targetMeta.canvas.width ||
    sourceMeta.canvas.height !== targetMeta.canvas.height
  ) {
    warnings.push(
      `Imported scenes use ${sourceMeta.canvas.width}×${sourceMeta.canvas.height}; this project stays ${targetMeta.canvas.width}×${targetMeta.canvas.height}.`,
    )
  }
  if (sourceMeta.frameRate !== targetMeta.frameRate) {
    warnings.push(
      `Imported scenes use ${sourceMeta.frameRate} FPS; this project stays ${targetMeta.frameRate} FPS.`,
    )
  }
  return warnings
}

function planCustomFonts(source: SceneAPI, target: SceneAPI): FontTransferPlan {
  const sourceFonts = source.getAllCustomFonts().map(cloneValue)
  const targetFonts = target.getAllCustomFonts()
  const familyMap = new Map<string, string>()
  const fonts: CustomFont[] = []
  const usedIds = new Set(targetFonts.map((font) => font.id))
  const usedFamilyNames = new Set(
    [...sourceFonts, ...targetFonts].map((font) => normalizedFamily(font.family)),
  )
  const sourceByFamily = new Map<string, CustomFont[]>()
  for (const font of sourceFonts) {
    const key = normalizedFamily(font.family)
    const group = sourceByFamily.get(key) ?? []
    group.push(font)
    sourceByFamily.set(key, group)
  }

  for (const donorFamily of sourceByFamily.values()) {
    const first = donorFamily[0]
    if (!first) continue
    const descriptorConflict = donorFamily.some((donor) =>
      targetFonts.some(
        (existing) =>
          sameFontDescriptor(existing, donor) &&
          !sameFontBytes(existing, donor),
      ),
    )
    const importedFamily = descriptorConflict
      ? uniqueImportedFamily(first.family, usedFamilyNames)
      : first.family
    if (descriptorConflict) {
      for (const donor of donorFamily) {
        familyMap.set(donor.family, importedFamily)
      }
    }

    for (const donor of donorFamily) {
      const planned = { ...donor, family: importedFamily }
      const existingFace = [...targetFonts, ...fonts].find((candidate) =>
        sameFontDescriptor(candidate, planned),
      )
      if (existingFace && sameFontBytes(existingFace, planned)) continue
      if (existingFace) {
        throw new Error(
          `The source contains conflicting files for ${planned.family} ${planned.weight} ${planned.style}.`,
        )
      }
      if (usedIds.has(planned.id)) planned.id = uniqueId('font')
      usedIds.add(planned.id)
      fonts.push(planned)
    }
  }
  return { familyMap, fonts }
}

function copyCustomFonts(target: SceneAPI, plan: FontTransferPlan): void {
  for (const font of plan.fonts) target.setCustomFont(cloneValue(font))
}

function sameFontDescriptor(left: CustomFont, right: CustomFont): boolean {
  return (
    normalizedFamily(left.family) === normalizedFamily(right.family) &&
    left.weight === right.weight &&
    left.style === right.style
  )
}

function sameFontBytes(left: CustomFont, right: CustomFont): boolean {
  if (!(left.bytes instanceof Uint8Array) || !(right.bytes instanceof Uint8Array)) {
    throw new Error('An embedded font has invalid binary data.')
  }
  if (left.bytes.byteLength !== right.bytes.byteLength) return false
  for (let index = 0; index < left.bytes.byteLength; index += 1) {
    if (left.bytes[index] !== right.bytes[index]) return false
  }
  return true
}

function normalizedFamily(family: string): string {
  return family.trim().toLocaleLowerCase()
}

function uniqueImportedFamily(
  family: string,
  usedNames: Set<string>,
): string {
  let suffix = 1
  let candidate = `${family} (Imported)`
  while (usedNames.has(normalizedFamily(candidate))) {
    suffix += 1
    candidate = `${family} (Imported ${suffix})`
  }
  usedNames.add(normalizedFamily(candidate))
  return candidate
}

function remapFontFamilyValues<T>(
  value: T,
  familyMap: ReadonlyMap<string, string>,
): T {
  if (!value || typeof value !== 'object' || value instanceof Uint8Array) {
    return value
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      value[index] = remapFontFamilyValues(value[index], familyMap)
    }
    return value
  }
  const record = value as Record<string, unknown>
  for (const [key, child] of Object.entries(record)) {
    if (key === 'fontFamily' && typeof child === 'string') {
      record[key] = familyMap.get(child) ?? child
      continue
    }
    record[key] = remapFontFamilyValues(child, familyMap)
  }
  return value
}

function copyUiState(
  source: SceneAPI,
  target: SceneAPI,
  ids: TransferIdMaps,
): void {
  const sourceUi = source.getUiState()
  const targetUi = target.getUiState()
  const trackGroups: UiStateSlab['trackGroups'] = {
    ...cloneValue(targetUi.trackGroups),
  }
  const kfGroups: UiStateSlab['kfGroups'] = {
    ...cloneValue(targetUi.kfGroups),
  }
  const kfGroupCollapsed: UiStateSlab['kfGroupCollapsed'] = {
    ...cloneValue(targetUi.kfGroupCollapsed),
  }
  const staggerSets: UiStateSlab['staggerSets'] = {
    ...cloneValue(targetUi.staggerSets),
  }
  let changed = false

  for (const group of Object.values(sourceUi.trackGroups)) {
    if (
      group.trackIds.length < 2 ||
      !group.trackIds.every((trackId) => ids.track.has(trackId))
    ) {
      continue
    }
    const id = uniqueId('track-group')
    trackGroups[id] = {
      ...cloneValue(group),
      trackIds: group.trackIds.map((trackId) => ids.track.get(trackId)!),
    }
    changed = true
  }

  for (const [sourceGroupId, keys] of Object.entries(sourceUi.kfGroups)) {
    if (sourceGroupId.startsWith('stagger-set:')) continue
    const remapped = keys.map((key) => ids.keyframeKey.get(key))
    if (remapped.length < 2 || remapped.some((key) => !key)) continue
    const id = uniqueId('keyframe-group')
    kfGroups[id] = remapped as string[]
    if (sourceUi.kfGroupCollapsed[sourceGroupId]) {
      kfGroupCollapsed[id] = true
    }
    changed = true
  }

  for (const set of Object.values(sourceUi.staggerSets)) {
    if (
      set.layerIds.length < 2 ||
      !set.layerIds.every((nodeId) => ids.node.has(nodeId))
    ) {
      continue
    }
    const members: UiStateSlab['staggerSets'][string]['members'] = {}
    let valid = true
    for (const [sourceNodeId, properties] of Object.entries(set.members)) {
      const targetNodeId = ids.node.get(sourceNodeId)
      if (!targetNodeId) {
        valid = false
        break
      }
      const remappedProperties: Record<string, string[]> = {}
      for (const [propertyId, keyframeIds] of Object.entries(properties)) {
        if (!keyframeIds) continue
        const sourceTrack = source
          .getTracksForNode(sourceNodeId)
          .find((track) => track.propertyId === propertyId)
        const keyframeMap = sourceTrack
          ? ids.keyframeByTrack.get(sourceTrack.id)
          : undefined
        const mappedIds = keyframeIds.map((id) => keyframeMap?.get(id))
        if (!sourceTrack || mappedIds.some((id) => !id)) {
          valid = false
          break
        }
        remappedProperties[propertyId] = mappedIds as string[]
      }
      if (!valid) break
      members[targetNodeId] = remappedProperties
    }
    if (!valid) continue
    const id = uniqueId('stagger-set')
    staggerSets[id] = {
      ...cloneValue(set),
      id,
      layerIds: set.layerIds.map((nodeId) => ids.node.get(nodeId)!),
      members,
    }
    changed = true
  }

  if (changed) {
    target.setUiState({
      trackGroups,
      kfGroups,
      kfGroupCollapsed,
      staggerSets,
    })
  }
}

function requiredMappedNode(
  sourceId: NodeId,
  nodeMap: ReadonlyMap<NodeId, NodeId>,
): NodeId {
  const mapped = nodeMap.get(sourceId)
  if (!mapped) throw new Error(`Referenced node was not transferred: ${sourceId}`)
  return mapped
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
