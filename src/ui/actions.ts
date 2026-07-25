// SPDX-License-Identifier: Apache-2.0

import type {
  ComponentPropertyDefinition,
  ComponentPropertyType,
  EasingKind,
  Interaction,
  InteractionEventKind,
  Layout,
  Node as SceneNode,
  NodeId,
  SizeAxis,
  Stroke,
  Track,
  VariantSelection,
} from '@/scene'
import type { SceneAPI } from '@/scene/doc'
import { addKeyframe, findTrack, getAnimEngine } from '@/anim'
import { isCursorInstance } from '@/scene/builtins/cursorComponent'
import { getLastSolvedLayout } from '@/ui/hooks/lastSolvedLayout'

const DEFAULT_COMPONENT_STROKE: Stroke = {
  color: 'oklch(0.6 0 0)',
  width: 1,
  align: 'inside',
  style: 'solid',
  dashLength: 6,
  dashGap: 4,
}

/**
 * High-level scene actions that are reused across keyboard shortcuts,
 * the right-click context menu, and (eventually) the top-bar menus.
 *
 * These all call straight into SceneAPI, so they end up in the
 * Y.UndoManager transaction that the keyboard hook sets up. No extra
 * wiring needed for undo/redo.
 */

/**
 * Default layout applied when a new auto-layout frame is created via
 * Shift+A or the right-click "Wrap in auto layout" action. Matches
 * Figma's defaults: horizontal row, 8px gap + padding, hug content.
 */
export const DEFAULT_AUTO_LAYOUT: Layout = {
  mode: 'flex',
  direction: 'row',
  justify: 'start',
  align: 'center',
  gap: 8,
  padding: { top: 8, right: 8, bottom: 8, left: 8 },
  wrap: false,
  columns: 3,
  rowGap: 8,
  columnGap: 8,
}

/**
 * Default layout applied when wrapping in a grid. Two-column grid with
 * 8px gap on both axes — small enough that the cards stay tight but
 * visibly different from the flex default.
 */
export const DEFAULT_GRID_LAYOUT: Layout = {
  mode: 'grid',
  direction: 'row',
  justify: 'start',
  align: 'start',
  gap: 8,
  padding: { top: 8, right: 8, bottom: 8, left: 8 },
  wrap: true,
  columns: 2,
  rowGap: 8,
  columnGap: 8,
}

/**
 * Wrap the given nodes in a new auto-layout frame.
 *
 * Semantics:
 *   - All nodes must share the same parent. If they don't, we bail —
 *     cross-parent wrapping is ambiguous (whose parent wins?) and
 *     Figma silently forbids it too.
 *   - The new frame is created under the common parent, then the
 *     selected nodes are reparented into it in their original order.
 *   - Size is 'hug' on both axes so the frame collapses to its
 *     children — users expand from there if they want a fill / fixed
 *     container.
 *
 * Returns the new frame id, or null on invalid input.
 */
export function wrapInAutoLayout(
  api: SceneAPI,
  ids: NodeId[],
): NodeId | null {
  return wrapInContainer(api, ids, { name: 'Auto layout', layout: DEFAULT_AUTO_LAYOUT })
}

/**
 * Same shape as wrapInAutoLayout but stamps a grid-mode layout on the
 * new container. Users reach this via the "Wrap in grid" context menu
 * entry.
 */
export function wrapInGrid(api: SceneAPI, ids: NodeId[]): NodeId | null {
  return wrapInContainer(api, ids, { name: 'Grid', layout: DEFAULT_GRID_LAYOUT })
}

/**
 * Create a master component from the current selection.
 *
 * MVP behavior intentionally mirrors the existing wrap action: the
 * selected layers become children of a new Component node under their
 * parent. That keeps the master visible/editable on canvas while giving
 * instances a stable `componentId` to reference.
 */
export function createComponentFromSelection(
  api: SceneAPI,
  ids: NodeId[],
): NodeId | null {
  if (ids.length === 0) return null
  const nodes = ids
    .map((id) => api.getNode(id))
    .filter((n): n is SceneNode => !!n)
    .filter((n) => n.parent != null && n.kind !== 'camera')
  if (nodes.length === 0) return null

  if (nodes.length === 1 && nodes[0]!.kind === 'component') {
    return nodes[0]!.id
  }

  const firstParent = nodes[0]!.parent as NodeId
  const allSameParent = nodes.every((n) => n.parent === firstParent)
  const siblings = allSameParent
    ? api.getChildren(firstParent).map((c) => c.id)
    : []
  const sortedIds = allSameParent
    ? nodes
        .map((n) => n.id)
        .sort((a, b) => siblings.indexOf(a) - siblings.indexOf(b))
    : nodes.map((n) => n.id)
  const selectedSiblingIndexes = sortedIds
    .map((id) => siblings.indexOf(id))
    .filter((index) => index >= 0)
  const insertionIndex =
    allSameParent && selectedSiblingIndexes.length > 0
      ? Math.min(...selectedSiblingIndexes)
      : -1
  const parentNode = api.getNode(firstParent)
  const parentLayoutMode =
    parentNode && 'layout' in parentNode ? parentNode.layout.mode : 'none'
  const shouldStayInLayout =
    allSameParent &&
    parentLayoutMode !== 'none' &&
    nodes.every((node) => node.position !== 'absolute')

  const bounds = getSelectionBounds(nodes, firstParent)
  const componentId = api.createNode('component', firstParent, {
    name: nodes.length === 1 ? `${nodes[0]!.name} component` : 'Component',
    size: { width: bounds.width, height: bounds.height },
    layout: {
      mode: 'none',
      direction: 'row',
      justify: 'start',
      align: 'start',
      gap: 0,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      wrap: false,
      columns: 3,
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
    position: shouldStayInLayout ? 'flow' : 'absolute',
    transform: {
      x: shouldStayInLayout ? 0 : bounds.x,
      y: shouldStayInLayout ? 0 : bounds.y,
      z: 0,
      rotation: 0,
      rotationX: 0,
      rotationY: 0,
      scaleX: 1,
      scaleY: 1,
    },
    variants: [{ name: 'State', values: ['Default'] }],
    defaultSelection: { State: 'Default' },
    variantOverrides: [],
    componentProperties: [],
    variantTransition: {
      duration: 0.3,
      easing: 'ease-in-out',
      presetId: 'smooth',
      strength: 50,
    },
    timelines: {},
    interactions: [],
  })
  if (insertionIndex >= 0) {
    api.moveChild(firstParent, componentId, insertionIndex)
  }

  for (const id of sortedIds) {
    const child = api.getNode(id)
    if (!child) continue
    const childRect = bounds.rects[id]
    api.appendChild(componentId, id)
    api.setNodeProperty(id, 'position', 'absolute')
    api.setNodeProperty(id, 'transform', {
      ...child.transform,
      x: Math.round((childRect?.x ?? child.transform.x) - bounds.x),
      y: Math.round((childRect?.y ?? child.transform.y) - bounds.y),
    })
  }
  return componentId
}

export function fitComponentToChildren(
  api: SceneAPI,
  componentId: NodeId,
  opts: { preserveHug?: boolean } = {},
): boolean {
  const component = api.getNode(componentId)
  if (!component || component.kind !== 'component') return false
  const bounds = measureComponentChildBounds(api, componentId)
  if (!bounds) return false
  const width = Math.max(1, Math.ceil(bounds.maxX - bounds.minX))
  const height = Math.max(1, Math.ceil(bounds.maxY - bounds.minY))
  const currentWidth =
    typeof component.size.width === 'number' ? component.size.width : 0
  const currentHeight =
    typeof component.size.height === 'number' ? component.size.height : 0
  const shouldNormalize =
    Math.abs(bounds.minX) >= 0.5 || Math.abs(bounds.minY) >= 0.5
  if (
    !shouldNormalize &&
    Math.abs(currentWidth - width) < 0.5 &&
    Math.abs(currentHeight - height) < 0.5
  ) {
    return false
  }
  api.doc.transact(() => {
    if (shouldNormalize) {
      for (const child of api.getChildren(component.id)) {
        api.setNodeProperty(child.id, 'transform', {
          ...child.transform,
          x: child.transform.x - bounds.minX,
          y: child.transform.y - bounds.minY,
        })
      }
    }
    api.setNodeProperty(component.id, 'size', {
      width:
        opts.preserveHug && component.size.width === 'hug'
          ? 'hug'
          : width,
      height:
        opts.preserveHug && component.size.height === 'hug'
          ? 'hug'
          : height,
    })
  })
  syncComponentInstances(api, component.id)
  return true
}

export function exposeComponentProperty(
  api: SceneAPI,
  nodeId: NodeId,
  path: string,
  type: ComponentPropertyType,
  name?: string,
): string | null {
  const component = findOwningComponent(api, nodeId)
  if (!component) return null
  const existing = component.componentProperties.find(
    (prop) => prop.nodeId === nodeId && prop.path === path,
  )
  if (existing) return existing.id
  const node = api.getNode(nodeId)
  const prop: ComponentPropertyDefinition = {
    id: genActionId(),
    nodeId,
    path,
    type,
    name: name ?? defaultComponentPropertyName(node?.name ?? 'Layer', path),
  }
  api.setNodeProperty(component.id, 'componentProperties', [
    ...component.componentProperties,
    prop,
  ] as never)
  return prop.id
}

export function removeComponentProperty(
  api: SceneAPI,
  componentId: NodeId,
  propertyId: string,
): void {
  const component = api.getNode(componentId)
  if (!component || component.kind !== 'component') return
  api.setNodeProperty(
    component.id,
    'componentProperties',
    component.componentProperties.filter((prop) => prop.id !== propertyId) as never,
  )
}

export function updateComponentPropertyDefinition(
  api: SceneAPI,
  componentId: NodeId,
  propertyId: string,
  patch: Partial<ComponentPropertyDefinition>,
): void {
  const component = api.getNode(componentId)
  if (!component || component.kind !== 'component') return
  api.setNodeProperty(
    component.id,
    'componentProperties',
    component.componentProperties.map((prop) =>
      prop.id === propertyId ? { ...prop, ...patch, id: prop.id } : prop,
    ) as never,
  )
}

export function setComponentSourceProperty(
  api: SceneAPI,
  componentId: NodeId,
  propertyId: string,
  value: unknown,
): void {
  const component = api.getNode(componentId)
  if (!component || component.kind !== 'component') return
  const prop = component.componentProperties.find((p) => p.id === propertyId)
  if (!prop) return
  const source = api.getNode(prop.nodeId)
  if (!source) return
  const patch =
    prop.path === 'appearance.stroke.width'
      ? setPathValue(source as unknown as Record<string, unknown>, 'appearance.stroke', {
          ...DEFAULT_COMPONENT_STROKE,
          ...(source.appearance.stroke ?? {}),
          width: value,
        })
      : setPathValue({}, prop.path, value)
  applyPatchStatic(api, source.id, patch)
  syncComponentInstances(api, component.id)
}

export function setInstanceComponentProperty(
  api: SceneAPI,
  instanceId: NodeId,
  propertyId: string,
  value: unknown,
): void {
  const instance = api.getNode(instanceId)
  if (!instance || instance.kind !== 'instance') return
  const component = api.getNode(instance.componentId)
  if (!component || component.kind !== 'component') return
  const prop = component.componentProperties.find((p) => p.id === propertyId)
  if (!prop) return
  const currentNodeOverrides = instance.overrides[prop.nodeId] ?? {}
  const source = api.getNode(prop.nodeId)
  const nextNodeOverrides =
    prop.path === 'appearance.stroke.width' && source
      ? setPathValue(currentNodeOverrides, 'appearance.stroke', {
          ...DEFAULT_COMPONENT_STROKE,
          ...(source.appearance.stroke ?? {}),
          ...((getPathValue(
            currentNodeOverrides,
            'appearance.stroke',
          ) as object | undefined) ?? {}),
          width: value,
        })
      : setPathValue(currentNodeOverrides, prop.path, value)
  const nextOverrides = {
    ...instance.overrides,
    [prop.nodeId]: nextNodeOverrides,
  }
  api.setNodeProperty(instance.id, 'overrides', nextOverrides)
  const targetId = mapInstanceChildrenBySource(api, instanceId).get(prop.nodeId)
  if (targetId) applyPatchStatic(api, targetId, nextNodeOverrides)
}

export function resetInstanceComponentProperty(
  api: SceneAPI,
  instanceId: NodeId,
  propertyId: string,
): void {
  const instance = api.getNode(instanceId)
  if (!instance || instance.kind !== 'instance') return
  const component = api.getNode(instance.componentId)
  if (!component || component.kind !== 'component') return
  const prop = component.componentProperties.find((p) => p.id === propertyId)
  if (!prop) return
  const currentNodeOverrides = instance.overrides[prop.nodeId] ?? {}
  const nextNodeOverrides = unsetPathValue(currentNodeOverrides, prop.path)
  const nextOverrides = { ...instance.overrides }
  if (Object.keys(nextNodeOverrides).length === 0) {
    delete nextOverrides[prop.nodeId]
  } else {
    nextOverrides[prop.nodeId] = nextNodeOverrides
  }
  api.setNodeProperty(instance.id, 'overrides', nextOverrides)
  materializeComponentChildren(api, component.id, instance.id)
  applyVariantSelectionStatic(api, instance.id, instance.selection)
  applyInstanceOverridesStatic(api, instance.id)
}

/**
 * Create a linked instance of a master component.
 *
 * The current renderer cannot yet draw virtual repeated children with
 * duplicate ids, so instances are materialized as children whose
 * `componentSourceId` points back to the corresponding master node.
 * `syncComponentInstances` refreshes those materialized children from
 * the master definition.
 */
export function instantiateComponent(
  api: SceneAPI,
  componentId: NodeId,
  parentId?: NodeId | null,
  opts?: {
    position?: { x: number; y: number }
    absolute?: boolean
    workspaceOnly?: boolean
    alwaysOnTop?: boolean
  },
): NodeId | null {
  const component = api.getNode(componentId)
  if (!component || component.kind !== 'component') return null
  const parent = parentId === undefined ? component.parent : parentId
  if (!parent && !opts?.workspaceOnly) return null

  const instanceId = api.createNode('instance', parent, {
    name: `${component.name} instance`,
    componentId,
    size: component.size,
    layout: component.layout,
    appearance: component.appearance,
    alwaysOnTop: opts?.alwaysOnTop ?? false,
    selection: component.defaultSelection,
    overrides: {},
    interactions: [],
    position: opts?.absolute ? 'absolute' : 'flow',
    workspaceOnly: opts?.workspaceOnly ?? false,
    transform: {
      ...component.transform,
      x: opts?.position?.x ?? component.transform.x + 24,
      y: opts?.position?.y ?? component.transform.y + 24,
    },
  })
  materializeComponentChildren(api, componentId, instanceId)
  const instance = api.getNode(instanceId)
  if (instance?.kind === 'instance') {
    applyVariantSelectionStatic(api, instanceId, instance.selection)
    applyInstanceOverridesStatic(api, instanceId)
  }
  return instanceId
}

export function ensureComponentStateAxis(api: SceneAPI, componentId: NodeId): void {
  const component = api.getNode(componentId)
  if (!component || component.kind !== 'component') return
  if (component.variants.some((axis) => axis.name === 'State')) return
  api.doc.transact(() => {
    api.setNodeProperty(component.id, 'variants', [
      ...component.variants,
      { name: 'State', values: ['Default'] },
    ])
    api.setNodeProperty(component.id, 'defaultSelection', {
      ...component.defaultSelection,
      State: 'Default',
    })
  })
}

export function captureComponentVariant(
  api: SceneAPI,
  componentId: NodeId,
  variantName: string,
): void {
  const component = api.getNode(componentId)
  if (!component || component.kind !== 'component') return
  const cleanName = variantName.trim() || `Variant ${component.variantOverrides.length + 1}`
  const axes = component.variants.some((axis) => axis.name === 'State')
    ? component.variants.map((axis) =>
        axis.name === 'State' && !axis.values.includes(cleanName)
          ? { ...axis, values: [...axis.values, cleanName] }
          : axis,
      )
    : [...component.variants, { name: 'State', values: ['Default', cleanName] }]
  const overrides = captureComponentSubtree(api, componentId)
  const nextOverrides = [
    ...component.variantOverrides.filter(
      (variant) => variant.match.State !== cleanName,
    ),
    { match: { State: cleanName }, overrides },
  ]
  api.doc.transact(() => {
    api.setNodeProperty(component.id, 'variants', axes)
    api.setNodeProperty(component.id, 'defaultSelection', {
      ...component.defaultSelection,
      State: component.defaultSelection.State ?? 'Default',
    })
    api.setNodeProperty(component.id, 'variantOverrides', nextOverrides)
  })
}

export const upsertComponentVariant = captureComponentVariant

export function applyComponentVariantState(
  api: SceneAPI,
  componentId: NodeId,
  variantName: string,
): void {
  const component = api.getNode(componentId)
  if (!component || component.kind !== 'component') return
  const variant = component.variantOverrides.find(
    (entry) => entry.match.State === variantName,
  )
  if (!variant) return
  api.doc.transact(() => {
    for (const [nodeId, patch] of Object.entries(variant.overrides)) {
      applyPatchStatic(api, nodeId, patch)
    }
  })
  fitComponentToChildren(api, component.id)
}

export function removeComponentVariant(
  api: SceneAPI,
  componentId: NodeId,
  variantName: string,
): void {
  const component = api.getNode(componentId)
  if (!component || component.kind !== 'component') return
  if (variantName === 'Default') return
  api.doc.transact(() => {
    api.setNodeProperty(
      component.id,
      'variants',
      component.variants.map((axis) =>
        axis.name === 'State'
          ? { ...axis, values: axis.values.filter((value) => value !== variantName) }
          : axis,
      ) as never,
    )
    api.setNodeProperty(
      component.id,
      'variantOverrides',
      component.variantOverrides.filter(
        (variant) => variant.match.State !== variantName,
      ) as never,
    )
    if (component.defaultSelection.State === variantName) {
      api.setNodeProperty(component.id, 'defaultSelection', {
        ...component.defaultSelection,
        State: 'Default',
      } as never)
    }
  })
}

export function addComponentVariantInteraction(
  api: SceneAPI,
  componentId: NodeId,
  opts: {
    event: InteractionEventKind
    targetState: string
    sourceNodeId?: NodeId
    delay?: number
  },
): string | null {
  const component = api.getNode(componentId)
  if (!component || component.kind !== 'component') return null
  const action = {
    type: 'setVariant' as const,
    selection: { State: opts.targetState },
  }
  const interaction: Interaction = {
    id: genActionId(),
    sourceNodeId: opts.sourceNodeId,
    event: opts.event,
    actions:
      opts.delay && opts.delay > 0
        ? [{ type: 'after', delay: opts.delay, action }]
        : [action],
  }
  api.setNodeProperty(component.id, 'interactions', [
    ...component.interactions,
    interaction,
  ] as never)
  return interaction.id
}

export function updateComponentInteraction(
  api: SceneAPI,
  componentId: NodeId,
  interactionId: string,
  patch: Partial<Interaction>,
): void {
  const component = api.getNode(componentId)
  if (!component || component.kind !== 'component') return
  api.setNodeProperty(
    component.id,
    'interactions',
    component.interactions.map((interaction) =>
      interaction.id === interactionId
        ? { ...interaction, ...patch, id: interaction.id }
        : interaction,
    ) as never,
  )
}

export function removeComponentInteraction(
  api: SceneAPI,
  componentId: NodeId,
  interactionId: string,
): void {
  const component = api.getNode(componentId)
  if (!component || component.kind !== 'component') return
  api.setNodeProperty(
    component.id,
    'interactions',
    component.interactions.filter((interaction) => interaction.id !== interactionId) as never,
  )
}

export function applyInstanceVariantTransition(
  api: SceneAPI,
  instanceId: NodeId,
  selection: VariantSelection,
  opts: { playhead: number; keyframe?: boolean },
): void {
  const instance = api.getNode(instanceId)
  if (!instance || instance.kind !== 'instance') return
  const component = api.getNode(instance.componentId)
  if (!component || component.kind !== 'component') return
  const nextSelection = { ...instance.selection, ...selection }

  // The built-in cursor exposes State as one semantic, stepped timeline
  // property. Creating child-opacity transitions here produced seven noisy
  // tracks and made a state change impossible to reason about on the
  // timeline. Auto Key creates the first semantic track; after that, edits
  // keep stamping the active track just like the other inspector fields.
  if (isCursorInstance(api, instance)) {
    const hasVariantTrack = !!findTrack(api, instance.id, 'variant')
    api.doc.transact(() => {
      api.setNodeProperty(instance.id, 'selection', nextSelection)
      applyVariantSelectionStatic(api, instance.id, nextSelection)
      if (opts.keyframe || hasVariantTrack) {
        addKeyframe(
          api,
          instance.id,
          'variant',
          opts.playhead,
          nextSelection,
          'linear',
        )
      }
    })
    return
  }

  const overrides = resolveVariantOverrideForSelection(
    component,
    nextSelection,
  )
  const sourceToMaterialized = mapInstanceChildrenBySource(api, instanceId)
  const duration = Math.max(0, component.variantTransition.duration)
  const easing = component.variantTransition.easing

  api.doc.transact(() => {
    api.setNodeProperty(instance.id, 'selection', nextSelection)
    for (const [sourceId, patch] of Object.entries(overrides)) {
      const targetId = sourceToMaterialized.get(sourceId)
      if (!targetId) continue
      animatePatch(api, targetId, patch, opts.playhead, duration, easing)
    }
  })
}

function resolveVariantOverrideForSelection(
  component: Extract<SceneNode, { kind: 'component' }>,
  selection: VariantSelection,
): Record<NodeId, Record<string, unknown>> {
  const out: Record<NodeId, Record<string, unknown>> = {}
  for (const variant of component.variantOverrides) {
    let matches = true
    for (const [axis, value] of Object.entries(variant.match)) {
      if (selection[axis] !== value) {
        matches = false
        break
      }
    }
    if (!matches) continue
    for (const [nodeId, patch] of Object.entries(variant.overrides)) {
      out[nodeId] = { ...(out[nodeId] ?? {}), ...patch }
    }
  }
  return out
}

function captureComponentSubtree(
  api: SceneAPI,
  componentId: NodeId,
): Record<NodeId, Record<string, unknown>> {
  const out: Record<NodeId, Record<string, unknown>> = {}
  const visit = (id: NodeId) => {
    const node = api.getNode(id)
    if (!node || node.id === componentId) {
      for (const child of api.getChildren(id)) visit(child.id)
      return
    }
    out[node.id] = captureVariantProps(node)
    for (const child of api.getChildren(id)) visit(child.id)
  }
  visit(componentId)
  return out
}

function captureVariantProps(node: SceneNode): Record<string, unknown> {
  const props: Record<string, unknown> = {
    transform: node.transform,
    appearance: node.appearance,
    visible: node.visible,
  }
  if ('size' in node) props.size = node.size
  if ('layout' in node) props.layout = node.layout
  if (node.kind === 'text') {
    props.text = node.text
    props.color = node.color
    props.fontSize = node.fontSize
    props.fontWeight = node.fontWeight
    props.lineHeight = node.lineHeight
    props.letterSpacing = node.letterSpacing
    props.textAlign = node.textAlign
  }
  return props
}

function mapInstanceChildrenBySource(
  api: SceneAPI,
  instanceId: NodeId,
): Map<NodeId, NodeId> {
  const out = new Map<NodeId, NodeId>()
  const visit = (id: NodeId) => {
    const node = api.getNode(id)
    if (!node) return
    if (node.componentSourceId) out.set(node.componentSourceId, node.id)
    for (const child of api.getChildren(id)) visit(child.id)
  }
  visit(instanceId)
  return out
}

function animatePatch(
  api: SceneAPI,
  nodeId: NodeId,
  patch: Record<string, unknown>,
  playhead: number,
  duration: number,
  easing: EasingKind,
): void {
  const node = api.getNode(nodeId)
  if (!node) return
  const animated =
    duration <= 0 ? getAnimEngine().getSnapshot()[nodeId] : undefined
  const addTransition = (
    propertyId: Parameters<typeof addKeyframe>[2],
    currentValue: number,
    targetValue: number,
  ) => {
    if (duration > 0) {
      addKeyframe(
        api,
        nodeId,
        propertyId,
        playhead,
        currentValue,
        easing,
      )
      addKeyframe(
        api,
        nodeId,
        propertyId,
        playhead + duration,
        targetValue,
        easing,
      )
      return
    }

    // A zero-duration variant is a stepped state change. Two keys at the
    // same timestamp collapse into one (the track helper intentionally
    // de-duplicates near-identical times), which would make the new value
    // extend backwards through the whole scene. Hold the previous value one
    // frame before the playhead, then land on the target at the playhead.
    const frameDuration = 1 / Math.max(1, api.getMeta().frameRate)
    const holdDuration = Math.max(0.011, frameDuration)
    if (playhead >= holdDuration) {
      addKeyframe(
        api,
        nodeId,
        propertyId,
        playhead - holdDuration,
        currentValue,
        'linear',
      )
    }
    addKeyframe(
      api,
      nodeId,
      propertyId,
      playhead,
      targetValue,
      'linear',
    )
  }
  if (patch.transform && typeof patch.transform === 'object') {
    const target = patch.transform as Partial<SceneNode['transform']>
    for (const key of ['x', 'y', 'z', 'rotation', 'rotationX', 'rotationY', 'scaleX', 'scaleY'] as const) {
      const value = target[key]
      if (typeof value !== 'number') continue
      addTransition(
        `transform.${key}` as never,
        animated?.[key] ?? node.transform[key],
        value,
      )
    }
    api.setNodeProperty(nodeId, 'transform', { ...node.transform, ...target })
  }
  if (patch.appearance && typeof patch.appearance === 'object') {
    const target = patch.appearance as Partial<SceneNode['appearance']>
    if (typeof target.opacity === 'number') {
      addTransition(
        'appearance.opacity',
        animated?.opacity ?? node.appearance.opacity,
        target.opacity,
      )
    }
    if (typeof target.cornerRadius === 'number') {
      addTransition(
        'appearance.cornerRadius',
        animated?.cornerRadius ?? node.appearance.cornerRadius,
        target.cornerRadius,
      )
    }
    api.setNodeProperty(nodeId, 'appearance', deepMerge(node.appearance, target))
  }
  if (patch.size && typeof patch.size === 'object' && 'size' in node) {
    api.setNodeProperty(nodeId, 'size', { ...node.size, ...(patch.size as object) })
  }
  if (patch.layout && typeof patch.layout === 'object' && 'layout' in node) {
    api.setNodeProperty(nodeId, 'layout', { ...node.layout, ...(patch.layout as object) })
  }
  for (const [key, value] of Object.entries(patch)) {
    if (
      [
        'id',
        'kind',
        'parent',
        'children',
        'transform',
        'appearance',
        'size',
        'layout',
      ].includes(key)
    ) continue
    api.setNodeProperty(nodeId, key as never, value as never)
  }
}

export function syncComponentInstances(api: SceneAPI, componentId: NodeId): void {
  for (const id of api.getAllNodeIds()) {
    const node = api.getNode(id)
    if (!node || node.kind !== 'instance' || node.componentId !== componentId) {
      continue
    }
    const component = api.getNode(componentId)
    if (!component || component.kind !== 'component') continue
    api.setNodeProperty(node.id, 'size', component.size)
    api.setNodeProperty(node.id, 'layout', component.layout)
    materializeComponentChildren(api, componentId, node.id)
    applyVariantSelectionStatic(api, node.id, node.selection)
    applyInstanceOverridesStatic(api, node.id)
  }
}

function applyVariantSelectionStatic(
  api: SceneAPI,
  instanceId: NodeId,
  selection: VariantSelection,
): void {
  const instance = api.getNode(instanceId)
  if (!instance || instance.kind !== 'instance') return
  const component = api.getNode(instance.componentId)
  if (!component || component.kind !== 'component') return
  const overrides = resolveVariantOverrideForSelection(component, selection)
  const sourceToMaterialized = mapInstanceChildrenBySource(api, instanceId)
  for (const [sourceId, patch] of Object.entries(overrides)) {
    const targetId = sourceToMaterialized.get(sourceId)
    if (!targetId) continue
    applyPatchStatic(api, targetId, patch)
  }
}

function applyInstanceOverridesStatic(api: SceneAPI, instanceId: NodeId): void {
  const instance = api.getNode(instanceId)
  if (!instance || instance.kind !== 'instance') return
  const sourceToMaterialized = mapInstanceChildrenBySource(api, instanceId)
  for (const [sourceId, patch] of Object.entries(instance.overrides)) {
    const targetId = sourceToMaterialized.get(sourceId)
    if (!targetId) continue
    applyPatchStatic(api, targetId, patch)
  }
}

function applyPatchStatic(
  api: SceneAPI,
  nodeId: NodeId,
  patch: Record<string, unknown>,
): void {
  const node = api.getNode(nodeId)
  if (!node) return
  if (patch.transform && typeof patch.transform === 'object') {
    api.setNodeProperty(nodeId, 'transform', {
      ...node.transform,
      ...(patch.transform as object),
    })
  }
  if (patch.appearance && typeof patch.appearance === 'object') {
    api.setNodeProperty(nodeId, 'appearance', {
      ...deepMerge(node.appearance, patch.appearance as Record<string, unknown>),
    })
  }
  if (patch.size && typeof patch.size === 'object' && 'size' in node) {
    api.setNodeProperty(nodeId, 'size', { ...node.size, ...(patch.size as object) })
  }
  if (patch.layout && typeof patch.layout === 'object' && 'layout' in node) {
    api.setNodeProperty(nodeId, 'layout', { ...node.layout, ...(patch.layout as object) })
  }
  for (const [key, value] of Object.entries(patch)) {
    if (
      [
        'id',
        'kind',
        'parent',
        'children',
        'componentSourceId',
        'workspaceOnly',
        'transform',
        'appearance',
        'size',
        'layout',
      ].includes(key)
    ) continue
    api.setNodeProperty(nodeId, key as never, value as never)
  }
}

function findOwningComponent(
  api: SceneAPI,
  nodeId: NodeId,
): Extract<SceneNode, { kind: 'component' }> | null {
  let current = api.getNode(nodeId)
  while (current?.parent) {
    const parent = api.getNode(current.parent)
    if (parent?.kind === 'component') return parent
    current = parent
  }
  return current?.kind === 'component' ? current : null
}

function defaultComponentPropertyName(layerName: string, path: string): string {
  const label =
    path === 'text'
      ? 'Text'
      : path === 'color'
        ? 'Text color'
        : path === 'appearance.fill'
          ? 'Fill'
          : path === 'appearance.stroke'
            ? 'Stroke'
            : path === 'appearance.stroke.width'
              ? 'Stroke width'
              : path === 'appearance.cornerRadius'
                ? 'Radius'
                : path === 'appearance.opacity'
                  ? 'Opacity'
                  : path === 'size'
                    ? 'Size'
                    : path
  return `${layerName} ${label}`
}

function setPathValue(
  source: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const keys = path.split('.')
  if (keys.length === 1) return { ...source, [path]: value }
  const [head, ...rest] = keys
  const current =
    source[head!] && typeof source[head!] === 'object'
      ? (source[head!] as Record<string, unknown>)
      : {}
  return {
    ...source,
    [head!]: setPathValue(current, rest.join('.'), value),
  }
}

function getPathValue(source: Record<string, unknown>, path: string): unknown {
  let cur: unknown = source
  for (const key of path.split('.')) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}

function unsetPathValue(
  source: Record<string, unknown>,
  path: string,
): Record<string, unknown> {
  const keys = path.split('.')
  const [head, ...rest] = keys
  if (!head) return source
  if (rest.length === 0) {
    const { [head]: _removed, ...remaining } = source
    void _removed
    return remaining
  }
  const current = source[head]
  if (!current || typeof current !== 'object') return source
  const nextChild = unsetPathValue(current as Record<string, unknown>, rest.join('.'))
  const next = { ...source }
  if (Object.keys(nextChild).length === 0) {
    delete next[head]
  } else {
    next[head] = nextChild
  }
  return next
}

function deepMerge<T extends Record<string, unknown>>(
  base: T,
  patch: Record<string, unknown>,
): T {
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    const current = out[key]
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      current &&
      typeof current === 'object' &&
      !Array.isArray(current)
    ) {
      out[key] = deepMerge(
        current as Record<string, unknown>,
        value as Record<string, unknown>,
      )
    } else {
      out[key] = value
    }
  }
  return out as T
}

function materializeComponentChildren(
  api: SceneAPI,
  componentId: NodeId,
  instanceId: NodeId,
): void {
  const existing = api.getChildren(instanceId).map((child) => child.id)
  for (const childId of existing) deleteNodeWithTracks(api, childId)
  for (const child of api.getChildren(componentId)) {
    cloneFromComponentSource(api, child.id, instanceId)
  }
}

function deleteNodeWithTracks(api: SceneAPI, nodeId: NodeId): void {
  for (const child of api.getChildren(nodeId)) {
    deleteNodeWithTracks(api, child.id)
  }
  for (const track of api.getTracksForNode(nodeId)) {
    api.deleteTrack(track.id)
  }
  api.deleteNode(nodeId)
}

function cloneFromComponentSource(
  api: SceneAPI,
  sourceId: NodeId,
  parentId: NodeId,
): NodeId | null {
  const source = api.getNode(sourceId)
  if (!source || source.kind === 'camera') return null
  const cloneId = api.createNode(source.kind, parentId, {
    ...stripNodeLinks(source),
    name: source.name,
    componentSourceId: source.id,
  } as Partial<SceneNode>)
  for (const track of api.getTracksForNode(sourceId)) {
    cloneTrack(api, track, cloneId)
  }
  for (const child of api.getChildren(sourceId)) {
    cloneFromComponentSource(api, child.id, cloneId)
  }
  return cloneId
}

function cloneTrack(api: SceneAPI, track: Track, nodeId: NodeId): void {
  api.setTrack({
    id: genActionId(),
    nodeId,
    propertyId: track.propertyId,
    defaultEasing: track.defaultEasing,
    keyframes: track.keyframes.map((kf) => ({ ...kf, id: genActionId() })),
  })
}

export function measureComponentChildBounds(
  api: SceneAPI,
  componentId: NodeId,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const children = api.getChildren(componentId)
  if (children.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = 0
  let maxY = 0
  const visit = (node: SceneNode, parentX: number, parentY: number) => {
    const x = parentX + node.transform.x
    const y = parentY + node.transform.y
    const size = measureStaticNodeSize(api, node)
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x + size.width)
    maxY = Math.max(maxY, y + size.height)
    for (const child of api.getChildren(node.id)) {
      visit(child, x, y)
    }
  }
  for (const child of children) visit(child, 0, 0)
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null
  return { minX, minY, maxX, maxY }
}

function measureStaticNodeSize(
  api: SceneAPI,
  node: SceneNode,
): { width: number; height: number } {
  if (node.kind === 'text') {
    const textWidth = Math.max(1, node.text.length * node.fontSize * 0.58)
    const textHeight = Math.max(1, node.fontSize * node.lineHeight)
    return {
      width: measureSizeAxis(node.size.width, textWidth),
      height: measureSizeAxis(node.size.height, textHeight),
    }
  }
  if ('size' in node) {
    const nested =
      'layout' in node && node.layout.mode === 'none'
        ? measureComponentChildBounds(api, node.id)
        : null
    return {
      width: measureSizeAxis(
        node.size.width,
        nested ? nested.maxX - nested.minX : 100,
      ),
      height: measureSizeAxis(
        node.size.height,
        nested ? nested.maxY - nested.minY : 100,
      ),
    }
  }
  return { width: 100, height: 100 }
}

function measureSizeAxis(value: SizeAxis, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function getSelectionBounds(nodes: SceneNode[], parentId: NodeId): {
  x: number
  y: number
  width: number
  height: number
  rects: Record<NodeId, { x: number; y: number; width: number; height: number }>
} {
  const solved = getLastSolvedLayout()
  const parentRect = solved?.[parentId] ?? { x: 0, y: 0, width: 0, height: 0 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const rects: Record<
    NodeId,
    { x: number; y: number; width: number; height: number }
  > = {}
  for (const node of nodes) {
    const solvedRect = solved?.[node.id]
    const width =
      solvedRect?.width ??
      ('size' in node && typeof node.size.width === 'number'
        ? node.size.width
        : 100)
    const height =
      solvedRect?.height ??
      ('size' in node && typeof node.size.height === 'number'
        ? node.size.height
        : 100)
    const rect = {
      x: (solvedRect?.x ?? 0) + node.transform.x - parentRect.x,
      y: (solvedRect?.y ?? 0) + node.transform.y - parentRect.y,
      width,
      height,
    }
    rects[node.id] = rect
    minX = Math.min(minX, rect.x)
    minY = Math.min(minY, rect.y)
    maxX = Math.max(maxX, rect.x + rect.width)
    maxY = Math.max(maxY, rect.y + rect.height)
  }
  const x = Number.isFinite(minX) ? Math.round(minX) : 0
  const y = Number.isFinite(minY) ? Math.round(minY) : 0
  const width = Number.isFinite(maxX) ? Math.max(1, Math.round(maxX - minX)) : 1
  const height = Number.isFinite(maxY) ? Math.max(1, Math.round(maxY - minY)) : 1
  return {
    x,
    y,
    width,
    height,
    rects,
  }
}

function stripNodeLinks<T extends object>(node: T): Partial<T> {
  const { id: _id, parent: _parent, children: _children, ...rest } =
    node as unknown as { id: unknown; parent: unknown; children: unknown }
  void _id
  void _parent
  void _children
  return rest as Partial<T>
}

function genActionId(): string {
  return (
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 10)
  )
}

function wrapInContainer(
  api: SceneAPI,
  ids: NodeId[],
  opts: { name: string; layout: Layout },
): NodeId | null {
  if (ids.length === 0) return null
  const nodes = ids
    .map((id) => api.getNode(id))
    .filter((n): n is SceneNode => !!n)
  if (nodes.length !== ids.length) return null

  // Filter out the root and any orphan camera — those can never be
  // wrapped. If nothing wrappable remains, bail.
  const wrappable = nodes.filter((n) => n.parent != null && n.kind !== 'camera')
  if (wrappable.length === 0) return null

  // Pick a target parent. If everything already shares one, use it
  // (preserves position-in-siblings ordering). Otherwise fall back to
  // the FIRST wrappable node's parent — this lets the user select two
  // unrelated frames and still get a wrap, instead of a silent no-op.
  // The non-matching nodes will be re-parented into the new container.
  const firstParent = wrappable[0]!.parent as NodeId
  const allSameParent = wrappable.every((n) => n.parent === firstParent)
  const parentId = firstParent

  // Preserve child order within the home parent so visual stacking is
  // stable for the same-parent case. For mixed parents, the wrap order
  // matches selection order — there's no canonical sibling list to
  // sort against once parents diverge.
  const sortedIds = allSameParent
    ? (() => {
        const siblings = api.getChildren(parentId).map((c) => c.id)
        return [...ids].sort(
          (a, b) => siblings.indexOf(a) - siblings.indexOf(b),
        )
      })()
    : wrappable.map((n) => n.id)

  // Outer parent's layout mode decides whether the new frame needs a
  // transform offset. Under mode='none', the new frame is absolutely
  // positioned inside the parent — we want it at the selection's
  // bounding-box top-left so the wrap doesn't teleport the visual.
  // Under flex/grid, Yoga places the new frame in flow; a non-zero
  // transform here would smear it off its slot and reintroduce the
  // exact bug we fixed for children. Nested autolayouts must zero out.
  const parentNode = api.getNode(parentId)
  const parentMode =
    parentNode && 'layout' in parentNode ? parentNode.layout.mode : 'none'

  // Compute the bounding box of the selection in PARENT-space so we can
  // place the new frame there (instead of at 0,0 which would visually
  // "teleport" the selection away from its existing position). This is
  // the Figma behavior: wrap keeps everything where it was.
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let sawBounds = false
  for (const n of nodes) {
    if (!('size' in n) || !('transform' in n)) continue
    const w = typeof n.size.width === 'number' ? n.size.width : 0
    const h = typeof n.size.height === 'number' ? n.size.height : 0
    if (w <= 0 && h <= 0) continue
    const x = n.transform.x
    const y = n.transform.y
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x + w)
    maxY = Math.max(maxY, y + h)
    sawBounds = true
  }
  const useBoundsOffset = parentMode === 'none' && sawBounds
  const boundsX = useBoundsOffset ? Math.round(minX) : 0
  const boundsY = useBoundsOffset ? Math.round(minY) : 0

  const frameId = api.createNode('frame', parentId, {
    name: opts.name,
    size: { width: 'hug', height: 'hug' },
    layout: { ...opts.layout },
    appearance: {
      opacity: 1,
      fill: null,
      stroke: null,
      cornerRadius: 0,
      effects: [],
    },
    clipsContent: false,
    // Position the new frame at the selection's top-left. Only meaningful
    // when the outer parent is mode='none'; otherwise zero so the outer
    // parent's flex/grid flow governs (nested autolayouts stay aligned).
    transform: {
      x: boundsX,
      y: boundsY,
      z: 0,
      rotation: 0,
      rotationX: 0,
      rotationY: 0,
      scaleX: 1,
      scaleY: 1,
    },
  })

  for (const id of sortedIds) {
    api.appendChild(frameId, id)
    // CRITICAL: zero the child's transform when entering a flex/grid
    // container. Yoga flows the child into its slot, and we add
    // transform on top as a post-layout offset. Keeping a pre-wrap
    // dragged transform would smear every child off its slot and make
    // them look like they "vanished". This is exactly the bug users
    // hit: "after Shift+A, elements jump elsewhere."
    const child = api.getNode(id)
    if (!child) continue
    if (opts.layout.mode === 'flex' || opts.layout.mode === 'grid') {
      api.setNodeProperty(id, 'transform', {
        ...child.transform,
        x: 0,
        y: 0,
      })
      // Similarly, if the child had `fill` on either axis from when it
      // sat under mode='none' (where fill means "span the parent"), that
      // will collapse inside a hug/hug frame in flex/grid — Yoga has
      // nothing concrete to stretch against. Pin to a pixel size so the
      // wrapped element is still visible. Prefer the solved numeric size
      // the child had at wrap time, fallback to 100×100.
      if ('size' in child) {
        const nextW =
          typeof child.size.width === 'number' ? child.size.width : 100
        const nextH =
          typeof child.size.height === 'number' ? child.size.height : 100
        const needsPin =
          child.size.width === 'fill' || child.size.height === 'fill'
        if (needsPin) {
          api.setNodeProperty(id, 'size', { width: nextW, height: nextH })
        }
      }
    }
  }
  return frameId
}

/**
 * Dissolve a frame, hoisting its children to the frame's parent at the
 * frame's position in the sibling list, then deleting the frame.
 *
 * Used by "Remove auto layout" and Cmd+Shift+G (ungroup). No-op if the
 * node isn't a frame with a parent.
 */
export function ungroupFrame(api: SceneAPI, frameId: NodeId): NodeId[] {
  const frame = api.getNode(frameId)
  if (!frame || frame.kind !== 'frame' || !frame.parent) return []
  const parentId = frame.parent
  const siblings = api.getChildren(parentId).map((c) => c.id)
  const frameIdx = siblings.indexOf(frameId)
  const kids = api.getChildren(frameId).map((c) => c.id)
  // Reparent each kid, then slide it into position just before the frame.
  for (let i = 0; i < kids.length; i++) {
    const kid = kids[i]!
    api.appendChild(parentId, kid)
    api.moveChild(parentId, kid, Math.max(0, frameIdx + i))
  }
  api.deleteNode(frameId)
  return kids
}

/**
 * Lock (or unlock) a node *and every descendant*.
 *
 * Matches the Figma expectation that locking a container freezes the
 * whole subtree — you can't reach into a locked frame and drag its
 * inner badge, and you don't want to either: a lock you added for
 * "don't let me accidentally move this card" would be meaningless if
 * every child inside it was still hot.
 *
 * Unlocking cascades too, which is the intuitive undo of a cascaded
 * lock. This does mean: if a user had manually locked one nested layer
 * before locking the parent, unlocking the parent also unlocks that
 * nested layer. That's a deliberate simplification — preserving prior
 * per-child lock state would require shadow metadata, and the common
 * case (lock a card → unlock the card) is the one we optimize for.
 *
 * All writes go through setNodeProperty, so Y.UndoManager groups the
 * whole cascade into one undo step via captureTimeout.
 */
export function setLockedRecursive(
  api: SceneAPI,
  id: NodeId,
  locked: boolean,
): void {
  const stack: NodeId[] = [id]
  while (stack.length > 0) {
    const next = stack.pop()!
    const node = api.getNode(next)
    if (!node) continue
    if (node.locked !== locked) {
      api.setNodeProperty(next, 'locked', locked)
    }
    for (const child of api.getChildren(next)) stack.push(child.id)
  }
}

/**
 * Belt-and-braces: keep the root node coherent with the scene meta.
 *
 * The scene root represents the artboard. Two things can drift:
 *   1. Transform. Transforms on root make no sense — there's nothing
 *      "outside" the artboard for it to translate or rotate relative
 *      to. Older scenes may have a non-zero rotation stashed from
 *      before the Inspector hid the Transform fields for root.
 *   2. Size vs. meta.canvas. The artboard's pixel box is stored twice
 *      — meta.canvas (width/height) drives the checkerboard, and
 *      root.size drives the Yoga solve. When they drift (e.g. older
 *      sample scenes had canvas=1470×900 but root=640×360), the flex
 *      solve packs children into the smaller box, leaving the rest of
 *      the artboard empty. We force root.size to be numeric pixels
 *      matching canvas so "center / end" layouts actually fill the
 *      visible artboard.
 *
 * Runs once per load in App.Shell. Silent; no user-visible churn.
 */
export function normalizeRoot(api: SceneAPI): void {
  const rootId = api.getRoot()
  if (!rootId) return
  const root = api.getNode(rootId)
  if (!root) return

  const t = root.transform
  if (
    t.x !== 0 ||
    t.y !== 0 ||
    t.rotation !== 0 ||
    t.scaleX !== 1 ||
    t.scaleY !== 1
  ) {
    api.setNodeProperty(rootId, 'transform', {
      x: 0,
      y: 0,
      z: 0,
      rotation: 0,
      rotationX: 0,
      rotationY: 0,
      scaleX: 1,
      scaleY: 1,
    })
  }

  if ('size' in root) {
    const meta = api.getMeta()
    const canvasW = Math.max(1, Math.round(meta.canvas?.width ?? 0))
    const canvasH = Math.max(1, Math.round(meta.canvas?.height ?? 0))
    if (canvasW > 0 && canvasH > 0) {
      const needsSize =
        root.size.width !== canvasW || root.size.height !== canvasH
      if (needsSize) {
        api.setNodeProperty(rootId, 'size', {
          width: canvasW,
          height: canvasH,
        })
      }
    }
  }
}

/**
 * Strip leftover `transform.scaleY` tracks from cameras. Cameras now
 * use a single uniform-scale model — only `transform.scaleX` carries
 * the animation, and the renderer applies it on both axes. Older
 * sessions that paired both tracks need this one-shot cleanup so the
 * timeline doesn't show a stale "Scale Y" row.
 *
 * Hand-tested decision to delete (rather than convert) the scaleY
 * track: keeping it would either require silently merging into scaleX
 * (lossy if the values diverged) or leaving an inert track that the
 * renderer ignores (confusing). Both worse than just dropping it,
 * which is also what the user expected when they asked for unified
 * camera scale.
 */
export function pruneCameraScaleYTracks(api: SceneAPI): void {
  const cameraId = api.getActiveCameraId()
  if (!cameraId) return
  const tracks = api.getTracksForNode(cameraId)
  const stale = tracks.filter((t) => t.propertyId === 'transform.scaleY')
  if (stale.length === 0) return
  api.doc.transact(() => {
    for (const t of stale) api.deleteTrack(t.id)
  })
}

/**
 * Recenter the camera to the artboard center if it's parked at the
 * artboard's bottom-right CORNER. An earlier code path created
 * cameras at `(canvas.width, canvas.height)` instead of the intended
 * center `(canvas.width / 2, canvas.height / 2)`, which shifted the
 * viewfinder gizmo off the artboard and gave users an apparently
 * disconnected camera+scene. Detects only the exact corner pose so
 * we don't stomp legitimate user pans.
 */
export function recenterStaleCamera(api: SceneAPI): void {
  const cameraId = api.getActiveCameraId()
  if (!cameraId) return
  const camera = api.getNode(cameraId)
  if (!camera || camera.kind !== 'camera') return
  const meta = api.getMeta()
  const w = meta.canvas.width
  const h = meta.canvas.height
  const t = camera.transform
  // Only act on the exact "bottom-right corner" pose. Any other
  // position is treated as user intent.
  const isStaleCorner = t.x === w && t.y === h
  if (!isStaleCorner) return
  api.setNodeProperty(cameraId, 'transform', {
    ...t,
    x: w / 2,
    y: h / 2,
  })
}

/**
 * Snap the active camera's transform x/y to the artboard center.
 *
 * Called whenever the canvas size changes — the user explicitly opted
 * in to "camera always points at the middle." Without this, resizing
 * from 1920×1080 to 1080×1920 leaves the camera parked at the OLD
 * center (960, 540), which is no longer the middle of anything and
 * pushes the visible artboard off-screen in the viewfinder.
 *
 * Z, rotation, scale are preserved — the user's dolly / pan-tilt /
 * zoom intent shouldn't change just because they made the artboard
 * taller.
 */
export function centerCameraOnCanvas(api: SceneAPI): void {
  const cameraId = api.getActiveCameraId()
  if (!cameraId) return
  const camera = api.getNode(cameraId)
  if (!camera || camera.kind !== 'camera') return
  const meta = api.getMeta()
  const targetX = (meta.canvas?.width ?? 0) / 2
  const targetY = (meta.canvas?.height ?? 0) / 2
  const t = camera.transform
  if (t.x === targetX && t.y === targetY) return
  api.setNodeProperty(cameraId, 'transform', { ...t, x: targetX, y: targetY })
}

/**
 * Convert a camera's pre-3D `transform.scaleX` (the legacy "Scale"
 * field) into an equivalent `transform.z`, so the user's previously
 * zoomed-in camera doesn't snap back to identity zoom on the first
 * load after the 3D refactor.
 *
 * Math: the camera renders with apparentScale = FL / (FL - z), so
 *   z = FL × (1 - 1/scale)
 * with FL = 1000 (matches Canvas.tsx). Static-only — animation
 * tracks on transform.scaleX/scaleY are dropped (the camera no
 * longer reads from those tracks; users animate Z instead).
 */
export function migrateCameraScaleToZ(api: SceneAPI): void {
  const cameraId = api.getActiveCameraId()
  if (!cameraId) return
  const camera = api.getNode(cameraId)
  if (!camera || camera.kind !== 'camera') return
  const t = camera.transform
  const FL = 1000
  // Average the two scale axes — older sessions wrote scaleX === scaleY
  // for cameras anyway, but be defensive against asymmetric data.
  const scale = (t.scaleX + t.scaleY) / 2
  const needsConversion = scale !== 1 && t.z === 0
  if (!needsConversion) return
  const z = FL * (1 - 1 / Math.max(0.01, scale))
  api.doc.transact(() => {
    api.setNodeProperty(cameraId, 'transform', {
      ...t,
      z,
      scaleX: 1,
      scaleY: 1,
    })
    // Drop legacy transform.scaleX/scaleY tracks — they don't drive
    // the camera anymore. Z is the dolly axis now.
    const tracks = api.getTracksForNode(cameraId)
    for (const tr of tracks) {
      if (
        tr.propertyId === 'transform.scaleX' ||
        tr.propertyId === 'transform.scaleY'
      ) {
        api.deleteTrack(tr.id)
      }
    }
  })
}
