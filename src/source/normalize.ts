// SPDX-License-Identifier: Apache-2.0

import { canonicalRecord, shortHash, stableSourceId } from './id'
import { normalizeProjectPath } from './safety'
import type {
  NormalizeSourceManifestOptions,
  NormalizedSourceAsset,
  NormalizedSourceComponent,
  NormalizedSourceComponentOccurrence,
  NormalizedSourceComponentVariant,
  NormalizedSourceDomNode,
  NormalizedSourceInteraction,
  NormalizedSourceManifest,
  NormalizedSourceProject,
  NormalizedSourceRoute,
  NormalizedSourceScreen,
  NormalizedSourceScreenState,
  NormalizedSourceStyleSnapshot,
  SourceAssetInput,
  SourceCaptureManifestInput,
  SourceComponentBoundaryInput,
  SourceDomNodeInput,
  SourceInteractionStateKind,
  SourceProvenance,
  SourceScreenInput,
  SourceScreenStateInput,
  SourceStyleSnapshotInput,
} from './types'
import { assertValidSourceCaptureManifest } from './validate'

interface PendingComponent {
  boundary: SourceComponentBoundaryInput
  route: NormalizedSourceRoute
  screen: NormalizedSourceScreen
  state: NormalizedSourceScreenState
  rootNode: NormalizedSourceDomNode
}

interface NormalizationContext {
  provenance: SourceProvenance
  assetIdByKey: ReadonlyMap<string, string>
  pendingComponents: PendingComponent[]
}

const STATE_ORDER: Readonly<Record<SourceInteractionStateKind, number>> = {
  default: 0,
  loading: 1,
  success: 2,
  error: 3,
  empty: 4,
  disabled: 5,
  custom: 6,
}

/**
 * Validate and canonicalize a capture into deterministic, JSON-compatible
 * source data. This function performs no I/O and never executes source code.
 */
export function normalizeSourceCaptureManifest(
  input: SourceCaptureManifestInput,
  options: NormalizeSourceManifestOptions = {},
): NormalizedSourceManifest {
  assertValidSourceCaptureManifest(input, options.limits)

  const provenance = normalizeProvenance(input.provenance)
  const manifestId = stableSourceId(
    'manifest',
    input.id ?? input.project.name,
    canonicalRecord({
      origin: provenance.origin,
      sourceId: provenance.sourceId,
      locator: provenance.locator,
      revision: provenance.revision,
      project: input.project.name,
    }),
  )
  const projectId = stableSourceId(
    'project',
    input.project.id ?? input.project.name,
    `${manifestId}|${input.project.name}`,
  )
  const project: NormalizedSourceProject = {
    id: projectId,
    name: clean(input.project.name),
    rootPath: normalizeProjectPath(input.project.rootPath ?? '.'),
    packageName: nullableClean(input.project.packageName),
    framework: input.project.framework
      ? cloneFramework(input.project.framework)
      : null,
    provenance: deriveProvenance(provenance, `project:${projectId}`),
  }

  const assets = [...(input.assets ?? [])]
    .sort(compareAssetInputs)
    .map((asset) => normalizeAsset(asset, manifestId, provenance))
  const assetIdByKey = new Map(assets.map((asset) => [asset.key, asset.id]))
  const context: NormalizationContext = {
    provenance,
    assetIdByKey,
    pendingComponents: [],
  }
  const routes = [...input.routes]
    .sort((left, right) => compareText(left.path, right.path))
    .map((routeInput) => {
      const routeId = stableSourceId(
        'route',
        routeInput.id ?? routeInput.label ?? routeInput.path,
        `${projectId}|${routeInput.path}`,
      )
      const route: NormalizedSourceRoute = {
        id: routeId,
        path: routeInput.path,
        label: nullableClean(routeInput.label) ?? routeLabel(routeInput.path),
        sourcePath: routeInput.sourcePath
          ? normalizeProjectPath(routeInput.sourcePath)
          : null,
        screens: [],
        provenance: deriveProvenance(provenance, `route:${routeInput.path}`),
      }
      route.screens = [...routeInput.screens]
        .sort(compareScreenInputs)
        .map((screenInput) =>
          normalizeScreen(screenInput, route, context),
        )
      return route
    })

  const components = inferComponents(context.pendingComponents, provenance)
  const stats = computeStats(routes, components, assets)
  return {
    version: 1,
    id: manifestId,
    provenance,
    project,
    routes,
    assets,
    components,
    stats,
  }
}

function normalizeScreen(
  input: SourceScreenInput,
  route: NormalizedSourceRoute,
  context: NormalizationContext,
): NormalizedSourceScreen {
  const key = clean(input.key ?? input.name)
  const screenId = stableSourceId(
    'screen',
    input.id ?? key,
    `${route.id}|${key}|${input.viewport.width}x${input.viewport.height}`,
  )
  const screen: NormalizedSourceScreen = {
    id: screenId,
    key,
    name: clean(input.name),
    sourcePath: input.sourcePath
      ? normalizeProjectPath(input.sourcePath)
      : null,
    viewport: {
      width: Math.round(input.viewport.width),
      height: Math.round(input.viewport.height),
      deviceScaleFactor: input.viewport.deviceScaleFactor ?? 1,
    },
    states: [],
    provenance: deriveProvenance(
      context.provenance,
      `route:${route.path}/screen:${key}`,
    ),
  }

  const sortedStates = [...input.states].sort(compareStateInputs)
  const stateIdByName = new Map(
    sortedStates.map((stateInput) => [
      clean(stateInput.name),
      stableSourceId(
        'state',
        stateInput.id ?? stateInput.name,
        `${screenId}|${stateInput.kind}|${clean(stateInput.name)}`,
      ),
    ]),
  )
  screen.states = sortedStates.map((stateInput) =>
    normalizeState(
      stateInput,
      route,
      screen,
      stateIdByName,
      context,
    ),
  )
  return screen
}

function normalizeState(
  input: SourceScreenStateInput,
  route: NormalizedSourceRoute,
  screen: NormalizedSourceScreen,
  stateIdByName: ReadonlyMap<string, string>,
  context: NormalizationContext,
): NormalizedSourceScreenState {
  const stateName = clean(input.name)
  const stateId =
    stateIdByName.get(stateName) ??
    stableSourceId('state', stateName, `${screen.id}|${input.kind}|${stateName}`)
  const nodeByKey = new Map<string, NormalizedSourceDomNode>()
  const dom = normalizeDomNode(
    input.dom,
    stateId,
    [],
    nodeByKey,
    context,
  )
  const state: NormalizedSourceScreenState = {
    id: stateId,
    name: stateName,
    kind: input.kind,
    dom,
    styles: [...(input.styles ?? [])]
      .sort(compareStyleInputs)
      .map((style) =>
        normalizeStyle(style, stateId, nodeByKey, context.provenance),
      ),
    componentOccurrenceIds: [],
    interactions: [...(input.interactions ?? [])]
      .map((interaction, originalIndex) => ({
        interaction,
        originalIndex,
      }))
      .sort((left, right) => {
        const leftOrder = left.interaction.order ?? left.originalIndex
        const rightOrder = right.interaction.order ?? right.originalIndex
        return (
          leftOrder - rightOrder ||
          compareText(
            interactionSeed(left.interaction),
            interactionSeed(right.interaction),
          )
        )
      })
      .map(({ interaction }, index) =>
        normalizeInteraction(
          interaction,
          index,
          stateId,
          nodeByKey,
          stateIdByName,
          context.provenance,
        ),
      ),
    provenance: deriveProvenance(
      context.provenance,
      `route:${route.path}/screen:${screen.key}/state:${input.kind}:${stateName}`,
    ),
  }

  for (const boundary of [...(input.components ?? [])].sort(
    compareComponentBoundaries,
  )) {
    const rootNode = nodeByKey.get(boundary.rootNodeKey)
    if (!rootNode) continue
    context.pendingComponents.push({
      boundary,
      route,
      screen,
      state,
      rootNode,
    })
  }
  return state
}

function normalizeDomNode(
  input: SourceDomNodeInput,
  stateId: string,
  parentKeys: readonly string[],
  nodeByKey: Map<string, NormalizedSourceDomNode>,
  context: NormalizationContext,
): NormalizedSourceDomNode {
  const ancestry = [...parentKeys, input.key]
  const nodeId = stableSourceId(
    'node',
    input.key,
    `${stateId}|${ancestry.join('/')}`,
  )
  const node: NormalizedSourceDomNode = {
    id: nodeId,
    key: clean(input.key),
    tag: clean(input.tag).toLocaleLowerCase('en-US'),
    role: nullableClean(input.role)?.toLocaleLowerCase('en-US') ?? null,
    text: nullableClean(input.text),
    attributes: sortedStringRecord(input.attributes),
    classNames: sortedUnique(input.classNames ?? []),
    assetIds: sortedUnique(
      (input.assetKeys ?? [])
        .map((key) => context.assetIdByKey.get(key))
        .filter((id): id is string => id !== undefined),
    ),
    children: [],
    provenance: deriveProvenance(
      context.provenance,
      `state:${stateId}/dom:${ancestry.join('/')}`,
    ),
  }
  nodeByKey.set(input.key, node)
  node.children = [...(input.children ?? [])]
    .sort((left, right) => compareText(left.key, right.key))
    .map((child) =>
      normalizeDomNode(child, stateId, ancestry, nodeByKey, context),
    )
  return node
}

function normalizeStyle(
  input: SourceStyleSnapshotInput,
  stateId: string,
  nodeByKey: ReadonlyMap<string, NormalizedSourceDomNode>,
  provenance: SourceProvenance,
): NormalizedSourceStyleSnapshot {
  const nodeId = nodeByKey.get(input.nodeKey)?.id ?? input.nodeKey
  const pseudo = nullableClean(input.pseudo)
  const id = stableSourceId(
    'style',
    input.nodeKey,
    `${stateId}|${nodeId}|${pseudo ?? 'base'}`,
  )
  return {
    id,
    nodeId,
    pseudo,
    computed: sortedStringRecord(input.computed),
    tokens: sortedStringRecord(input.tokens),
    provenance: deriveProvenance(
      provenance,
      `state:${stateId}/style:${input.nodeKey}:${pseudo ?? 'base'}`,
    ),
  }
}

function normalizeInteraction(
  input: SourceScreenStateInput['interactions'] extends
    readonly (infer T)[] | undefined
    ? T
    : never,
  index: number,
  stateId: string,
  nodeByKey: ReadonlyMap<string, NormalizedSourceDomNode>,
  stateIdByName: ReadonlyMap<string, string>,
  provenance: SourceProvenance,
): NormalizedSourceInteraction {
  const order = input.order ?? index
  const targetNodeId = nodeByKey.get(input.targetNodeKey)?.id ?? input.targetNodeKey
  const resultingStateName = nullableClean(input.resultingState)
  const id = stableSourceId(
    'interaction',
    input.id ?? `${input.action}-${input.targetNodeKey}`,
    `${stateId}|${order}|${interactionSeed(input)}`,
  )
  return {
    id,
    order,
    action: input.action,
    targetNodeId,
    label:
      nullableClean(input.label) ??
      `${humanize(input.action)} ${humanize(input.targetNodeKey)}`,
    inputHint: nullableClean(input.inputHint),
    resultingStateId:
      resultingStateName === null
        ? null
        : stateIdByName.get(resultingStateName) ?? null,
    provenance: deriveProvenance(
      provenance,
      `state:${stateId}/interaction:${id}`,
    ),
  }
}

function inferComponents(
  pending: readonly PendingComponent[],
  provenance: SourceProvenance,
): NormalizedSourceComponent[] {
  const groups = new Map<string, PendingComponent[]>()
  for (const item of pending) {
    const key = componentReuseKey(item.boundary)
    const items = groups.get(key)
    if (items) items.push(item)
    else groups.set(key, [item])
  }

  return [...groups.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([reuseKey, unsortedItems]) => {
      const items = [...unsortedItems].sort(comparePendingComponents)
      const first = items[0]!
      const componentId = stableSourceId(
        'component',
        first.boundary.name,
        reuseKey,
      )
      const occurrences = items.map((item) =>
        createOccurrence(item, componentId, provenance),
      )
      for (const occurrence of occurrences) {
        const state = findStateForOccurrence(items, occurrence)
        if (state) state.componentOccurrenceIds.push(occurrence.id)
      }
      const variants = inferVariants(componentId, occurrences)
      const sourcePaths = sortedUnique(
        items
          .map((item) => item.boundary.sourcePath)
          .filter((path): path is string => path !== undefined),
      )
      const exportNames = sortedUnique(
        items
          .map((item) => item.boundary.exportName)
          .filter((name): name is string => name !== undefined),
      )
      return {
        id: componentId,
        reuseKey,
        name: sortedUnique(items.map((item) => clean(item.boundary.name)))[0]!,
        sourcePath: sourcePaths[0]
          ? normalizeProjectPath(sourcePaths[0])
          : null,
        exportName: exportNames[0] ?? null,
        reusable:
          new Set(occurrences.map((occurrence) => occurrence.stateId)).size > 1,
        occurrences,
        variants,
        provenance: deriveProvenance(
          provenance,
          `component:${reuseKey}`,
        ),
      } satisfies NormalizedSourceComponent
    })
}

function createOccurrence(
  item: PendingComponent,
  componentId: string,
  provenance: SourceProvenance,
): NormalizedSourceComponentOccurrence {
  const variantName =
    nullableClean(item.boundary.variant) ?? humanize(item.state.kind)
  const props = sortedPrimitiveRecord(item.boundary.props)
  const signature = shortHash(
    canonicalRecord({
      variantName,
      props,
      dom: domFingerprint(item.rootNode),
    }),
  )
  const id = stableSourceId(
    'occurrence',
    item.boundary.key,
    `${componentId}|${item.state.id}|${item.rootNode.id}|${variantName}`,
  )
  return {
    id,
    componentId,
    routeId: item.route.id,
    screenId: item.screen.id,
    stateId: item.state.id,
    stateKind: item.state.kind,
    rootNodeId: item.rootNode.id,
    boundaryKey: item.boundary.key,
    variantName,
    props,
    signature,
    provenance: deriveProvenance(
      provenance,
      `state:${item.state.id}/component:${item.boundary.key}`,
    ),
  }
}

function inferVariants(
  componentId: string,
  occurrences: readonly NormalizedSourceComponentOccurrence[],
): NormalizedSourceComponentVariant[] {
  const grouped = new Map<string, NormalizedSourceComponentOccurrence[]>()
  for (const occurrence of occurrences) {
    const key = occurrence.variantName.toLocaleLowerCase('en-US')
    const group = grouped.get(key)
    if (group) group.push(occurrence)
    else grouped.set(key, [occurrence])
  }
  return [...grouped.entries()]
    .map(([key, group]) => ({
      key,
      group: [...group].sort(compareOccurrences),
    }))
    .sort((left, right) => {
      const leftOrder = Math.min(
        ...left.group.map((item) => STATE_ORDER[item.stateKind]),
      )
      const rightOrder = Math.min(
        ...right.group.map((item) => STATE_ORDER[item.stateKind]),
      )
      return leftOrder - rightOrder || compareText(left.key, right.key)
    })
    .map(({ key, group }) => ({
      id: stableSourceId('variant', group[0]!.variantName, `${componentId}|${key}`),
      name: group[0]!.variantName,
      stateKinds: sortedUnique(group.map((item) => item.stateKind)).sort(
        (left, right) => STATE_ORDER[left] - STATE_ORDER[right],
      ),
      occurrenceIds: group.map((item) => item.id),
      signatures: sortedUnique(group.map((item) => item.signature)),
    }))
}

function findStateForOccurrence(
  items: readonly PendingComponent[],
  occurrence: NormalizedSourceComponentOccurrence,
): NormalizedSourceScreenState | null {
  return (
    items.find(
      (item) =>
        item.state.id === occurrence.stateId &&
        item.rootNode.id === occurrence.rootNodeId &&
        item.boundary.key === occurrence.boundaryKey,
    )?.state ?? null
  )
}

function normalizeAsset(
  input: SourceAssetInput,
  manifestId: string,
  provenance: SourceProvenance,
): NormalizedSourceAsset {
  const id = stableSourceId(
    'asset',
    input.id ?? input.key,
    `${manifestId}|asset:${input.key}`,
  )
  let location: NormalizedSourceAsset['location']
  if (input.location.kind === 'project-file') {
    location = {
      kind: 'project-file',
      path: normalizeProjectPath(input.location.path),
    }
  } else if (input.location.kind === 'remote') {
    location = {
      kind: 'remote',
      url: new URL(input.location.url).toString(),
      contentType: nullableClean(input.location.contentType),
    }
  } else {
    location = {
      kind: 'inline',
      mediaType: clean(input.location.mediaType).toLocaleLowerCase('en-US'),
      byteLength: input.location.byteLength,
      integrity: clean(input.location.integrity),
      text: nullableClean(input.location.text),
    }
  }
  return {
    id,
    key: clean(input.key),
    kind: input.kind,
    label: nullableClean(input.label) ?? humanize(input.key),
    location,
    width: finitePositive(input.width) ? input.width : null,
    height: finitePositive(input.height) ? input.height : null,
    provenance: deriveProvenance(provenance, `asset:${input.key}`),
  }
}

function normalizeProvenance(
  input: SourceCaptureManifestInput['provenance'],
): SourceProvenance {
  return {
    origin: input.origin,
    sourceId: clean(input.sourceId),
    locator:
      input.origin === 'codebase'
        ? normalizeProjectPath(input.locator)
        : clean(input.locator),
    revision: nullableClean(input.revision),
    capturedAt: nullableClean(input.capturedAt),
    integrity: nullableClean(input.integrity),
  }
}

function deriveProvenance(
  source: SourceProvenance,
  locator: string,
): SourceProvenance {
  return {
    ...source,
    locator: `${source.locator}#${locator}`,
  }
}

function componentReuseKey(boundary: SourceComponentBoundaryInput): string {
  const explicit = nullableClean(boundary.reuseKey)
  if (explicit) return `key:${explicit.toLocaleLowerCase('en-US')}`
  const sourcePath = nullableClean(boundary.sourcePath)
  const exportName = nullableClean(boundary.exportName)
  if (sourcePath && exportName) {
    return `source:${normalizeProjectPath(sourcePath)}#${exportName}`
  }
  if (sourcePath) {
    return `source:${normalizeProjectPath(sourcePath)}#${clean(boundary.name)}`
  }
  return `name:${clean(boundary.name).toLocaleLowerCase('en-US')}`
}

function domFingerprint(node: NormalizedSourceDomNode): unknown {
  return {
    tag: node.tag,
    role: node.role,
    text: node.text,
    attributes: node.attributes,
    classNames: node.classNames,
    assetIds: node.assetIds,
    children: node.children.map(domFingerprint),
  }
}

function computeStats(
  routes: readonly NormalizedSourceRoute[],
  components: readonly NormalizedSourceComponent[],
  assets: readonly NormalizedSourceAsset[],
): NormalizedSourceManifest['stats'] {
  let screens = 0
  let states = 0
  let domNodes = 0
  let styles = 0
  let interactions = 0
  for (const route of routes) {
    screens += route.screens.length
    for (const screen of route.screens) {
      states += screen.states.length
      for (const state of screen.states) {
        domNodes += countDomNodes(state.dom)
        styles += state.styles.length
        interactions += state.interactions.length
      }
    }
  }
  return {
    routes: routes.length,
    screens,
    states,
    domNodes,
    styles,
    componentOccurrences: components.reduce(
      (sum, component) => sum + component.occurrences.length,
      0,
    ),
    reusableComponents: components.filter((component) => component.reusable)
      .length,
    interactions,
    assets: assets.length,
  }
}

function countDomNodes(node: NormalizedSourceDomNode): number {
  return 1 + node.children.reduce((sum, child) => sum + countDomNodes(child), 0)
}

function routeLabel(path: string): string {
  if (path === '/') return 'Home'
  const segment = path.split('/').filter(Boolean).at(-1) ?? 'Screen'
  return humanize(segment.replace(/\[(?:\.\.\.)?([^\]]+)\]/g, '$1'))
}

function compareAssetInputs(
  left: SourceAssetInput,
  right: SourceAssetInput,
): number {
  return compareText(left.key, right.key)
}

function compareScreenInputs(
  left: SourceScreenInput,
  right: SourceScreenInput,
): number {
  return (
    compareText(left.key ?? left.name, right.key ?? right.name) ||
    left.viewport.width - right.viewport.width ||
    left.viewport.height - right.viewport.height
  )
}

function compareStateInputs(
  left: SourceScreenStateInput,
  right: SourceScreenStateInput,
): number {
  return (
    STATE_ORDER[left.kind] - STATE_ORDER[right.kind] ||
    compareText(left.name, right.name)
  )
}

function compareStyleInputs(
  left: SourceStyleSnapshotInput,
  right: SourceStyleSnapshotInput,
): number {
  return (
    compareText(left.nodeKey, right.nodeKey) ||
    compareText(left.pseudo ?? '', right.pseudo ?? '')
  )
}

function compareComponentBoundaries(
  left: SourceComponentBoundaryInput,
  right: SourceComponentBoundaryInput,
): number {
  return (
    compareText(componentReuseKey(left), componentReuseKey(right)) ||
    compareText(left.key, right.key)
  )
}

function comparePendingComponents(
  left: PendingComponent,
  right: PendingComponent,
): number {
  return (
    compareText(left.route.path, right.route.path) ||
    compareText(left.screen.key, right.screen.key) ||
    STATE_ORDER[left.state.kind] - STATE_ORDER[right.state.kind] ||
    compareText(left.state.name, right.state.name) ||
    compareText(left.boundary.key, right.boundary.key)
  )
}

function compareOccurrences(
  left: NormalizedSourceComponentOccurrence,
  right: NormalizedSourceComponentOccurrence,
): number {
  return (
    compareText(left.routeId, right.routeId) ||
    compareText(left.screenId, right.screenId) ||
    STATE_ORDER[left.stateKind] - STATE_ORDER[right.stateKind] ||
    compareText(left.stateId, right.stateId) ||
    compareText(left.id, right.id)
  )
}

function interactionSeed(
  input: NonNullable<SourceScreenStateInput['interactions']>[number],
): string {
  return [
    input.action,
    input.targetNodeKey,
    input.resultingState ?? '',
    input.label ?? '',
  ].join('|')
}

function sortedStringRecord(
  input: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  if (!input) return {}
  return Object.fromEntries(
    Object.entries(input)
      .map(([key, value]) => [clean(key), clean(value)] as const)
      .sort(([left], [right]) => compareText(left, right)),
  )
}

function sortedPrimitiveRecord(
  input:
    | Readonly<Record<string, string | number | boolean | null>>
    | undefined,
): Record<string, string | number | boolean | null> {
  if (!input) return {}
  return Object.fromEntries(
    Object.entries(input).sort(([left], [right]) => compareText(left, right)),
  )
}

function cloneFramework(
  framework: NonNullable<SourceCaptureManifestInput['project']['framework']>,
): NonNullable<SourceCaptureManifestInput['project']['framework']> {
  return { ...framework }
}

function sortedUnique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort(compareText)
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, 'en-US')
}

function humanize(value: string): string {
  const cleaned = value
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/[_:./\-[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return 'Item'
  return cleaned.charAt(0).toLocaleUpperCase('en-US') + cleaned.slice(1)
}

function clean(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function nullableClean(value: string | undefined): string | null {
  if (value === undefined) return null
  const normalized = clean(value)
  return normalized.length > 0 ? normalized : null
}

function finitePositive(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}
