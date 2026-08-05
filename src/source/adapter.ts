// SPDX-License-Identifier: Apache-2.0

import type {
  ExplainerScriptBeat,
  ExplainerSourceRef,
  StoryboardDemoStep,
} from '../explainer/types'
import { stableSourceId } from './id'
import type {
  ExplainerDemoGuidance,
  ExplainerDemoGuidanceStep,
  ExplainerSourcePackage,
  NormalizedSourceComponent,
  NormalizedSourceComponentOccurrence,
  NormalizedSourceDomNode,
  NormalizedSourceInteraction,
  NormalizedSourceManifest,
  NormalizedSourceRoute,
  NormalizedSourceScreen,
  NormalizedSourceScreenState,
  SourceInteractionStateKind,
} from './types'

const TERMINAL_STATE_KINDS = new Set<SourceInteractionStateKind>([
  'success',
  'error',
  'empty',
])

/**
 * Convert normalized capture data into the existing explainer compiler's
 * source references plus deterministic demo direction. No renderer concerns
 * leak into this adapter.
 */
export function adaptSourceManifestForExplainer(
  manifest: NormalizedSourceManifest,
): ExplainerSourcePackage {
  const sourceRefs: ExplainerSourceRef[] = []
  sourceRefs.push(projectSourceRef(manifest))

  for (const route of manifest.routes) {
    sourceRefs.push(routeSourceRef(manifest, route))
    for (const screen of route.screens) {
      sourceRefs.push(screenSourceRef(manifest, route, screen))
    }
  }
  for (const component of manifest.components) {
    sourceRefs.push(componentSourceRef(manifest, component))
  }
  for (const asset of manifest.assets) {
    sourceRefs.push({
      id: asset.id,
      kind:
        asset.kind === 'logo'
          ? 'logo'
          : asset.kind === 'audio'
            ? 'audio'
            : 'asset',
      label: asset.label,
      uri: sourceUri(manifest.id, `asset/${asset.id}`),
      metadata: {
        assetKind: asset.kind,
        origin: asset.provenance.origin,
        locator: asset.provenance.locator,
        ...(asset.width === null ? {} : { width: asset.width }),
        ...(asset.height === null ? {} : { height: asset.height }),
      },
    })
  }

  const demoGuidance = manifest.routes.flatMap((route) =>
    route.screens.map((screen) =>
      buildDemoGuidance(manifest, route, screen),
    ),
  )
  const scriptBeats: ExplainerScriptBeat[] = demoGuidance.map((guidance) => ({
    id: `${guidance.id}-beat`,
    text: `Watch ${guidance.title} in action`,
    sceneType: 'demo',
    sourceRefIds: [
      guidance.screenSourceRefId,
      ...guidance.componentSourceRefIds,
    ],
    action: guidance.steps.map((step) => step.label).join(' → '),
  }))
  return { sourceRefs, demoGuidance, scriptBeats }
}

function buildDemoGuidance(
  manifest: NormalizedSourceManifest,
  route: NormalizedSourceRoute,
  screen: NormalizedSourceScreen,
): ExplainerDemoGuidance {
  const defaultState =
    screen.states.find((state) => state.kind === 'default') ?? screen.states[0]!
  const componentIds = componentIdsForScreen(manifest, screen.id)
  const componentSourceRefIds = componentIds.slice(0, 8)
  const fallbackTarget = componentSourceRefIds[0] ?? screen.id
  const steps = explicitDemoSteps(
    manifest,
    screen,
    defaultState,
    fallbackTarget,
  )
  const normalizedSteps =
    steps.length > 0
      ? steps
      : inferredStateSteps(screen, defaultState, fallbackTarget)
  return {
    id: stableSourceId(
      'demo',
      screen.name,
      `${manifest.id}|${route.id}|${screen.id}`,
    ),
    title: `${screen.name} on ${route.label}`,
    routeSourceRefId: route.id,
    screenSourceRefId: screen.id,
    initialState: defaultState.kind,
    terminalStates: screen.states
      .map((state) => state.kind)
      .filter((kind) => TERMINAL_STATE_KINDS.has(kind)),
    componentSourceRefIds,
    steps: normalizedSteps,
  }
}

function explicitDemoSteps(
  manifest: NormalizedSourceManifest,
  screen: NormalizedSourceScreen,
  initialState: NormalizedSourceScreenState,
  fallbackTarget: string,
): ExplainerDemoGuidanceStep[] {
  const stateById = new Map(screen.states.map((state) => [state.id, state]))
  const visited = new Set<string>()
  const result: ExplainerDemoGuidanceStep[] = []
  let current: NormalizedSourceScreenState | undefined = initialState

  while (current && !visited.has(current.id) && result.length < 16) {
    visited.add(current.id)
    const interactions = [...current.interactions].sort(
      (left, right) => left.order - right.order || left.id.localeCompare(right.id),
    )
    if (interactions.length === 0) break
    let nextState: NormalizedSourceScreenState | undefined
    for (const interaction of interactions) {
      const resultingState = interaction.resultingStateId
        ? stateById.get(interaction.resultingStateId)
        : undefined
      result.push(
        guidanceStep(
          manifest,
          screen,
          current,
          resultingState,
          interaction,
          result.length,
          fallbackTarget,
        ),
      )
      if (resultingState) nextState = resultingState
    }
    current = nextState
  }
  return result
}

function guidanceStep(
  manifest: NormalizedSourceManifest,
  screen: NormalizedSourceScreen,
  state: NormalizedSourceScreenState,
  resultingState: NormalizedSourceScreenState | undefined,
  interaction: NormalizedSourceInteraction,
  order: number,
  fallbackTarget: string,
): ExplainerDemoGuidanceStep {
  const target =
    componentForNode(manifest, screen, state, interaction.targetNodeId)?.id ??
    fallbackTarget
  return {
    id: stableSourceId(
      'demo-step',
      interaction.action,
      `${screen.id}|${state.id}|${interaction.id}`,
    ),
    order,
    label: interaction.label,
    action: mapDemoAction(interaction.action, resultingState?.kind),
    targetSourceRefId: target,
    fromState: state.kind,
    toState: resultingState?.kind ?? null,
    inputHint: interaction.inputHint,
  }
}

function inferredStateSteps(
  screen: NormalizedSourceScreen,
  initialState: NormalizedSourceScreenState,
  targetSourceRefId: string,
): ExplainerDemoGuidanceStep[] {
  const preferredKinds: SourceInteractionStateKind[] = [
    'loading',
    'success',
    'error',
    'empty',
  ]
  const targetStates = preferredKinds
    .map((kind) => screen.states.find((state) => state.kind === kind))
    .filter((state): state is NormalizedSourceScreenState => state !== undefined)
  let previous = initialState
  return targetStates.map((state, order) => {
    const action: StoryboardDemoStep['action'] =
      state.kind === 'success'
        ? 'success'
        : state.kind === 'loading'
          ? 'submit'
          : 'state-change'
    const step: ExplainerDemoGuidanceStep = {
      id: stableSourceId(
        'demo-step',
        state.kind,
        `${screen.id}|${previous.id}|${state.id}`,
      ),
      order,
      label:
        state.kind === 'loading'
          ? `Submit and show ${state.name}`
          : `Reveal ${state.name}`,
      action,
      targetSourceRefId,
      fromState: previous.kind,
      toState: state.kind,
      inputHint: null,
    }
    previous = state
    return step
  })
}

function componentForNode(
  manifest: NormalizedSourceManifest,
  screen: NormalizedSourceScreen,
  state: NormalizedSourceScreenState,
  nodeId: string,
): NormalizedSourceComponent | null {
  const descendantsByRoot = new Map<string, Set<string>>()
  collectDescendants(state.dom, descendantsByRoot)
  const candidates: {
    component: NormalizedSourceComponent
    occurrence: NormalizedSourceComponentOccurrence
    size: number
  }[] = []
  for (const component of manifest.components) {
    for (const occurrence of component.occurrences) {
      if (occurrence.screenId !== screen.id || occurrence.stateId !== state.id) {
        continue
      }
      const descendants = descendantsByRoot.get(occurrence.rootNodeId)
      if (descendants?.has(nodeId)) {
        candidates.push({
          component,
          occurrence,
          size: descendants.size,
        })
      }
    }
  }
  candidates.sort(
    (left, right) =>
      left.size - right.size ||
      left.occurrence.id.localeCompare(right.occurrence.id),
  )
  return candidates[0]?.component ?? null
}

function collectDescendants(
  node: NormalizedSourceDomNode,
  result: Map<string, Set<string>>,
): Set<string> {
  const descendants = new Set<string>([node.id])
  for (const child of node.children) {
    for (const id of collectDescendants(child, result)) descendants.add(id)
  }
  result.set(node.id, descendants)
  return descendants
}

function componentIdsForScreen(
  manifest: NormalizedSourceManifest,
  screenId: string,
): string[] {
  return manifest.components
    .filter((component) =>
      component.occurrences.some((occurrence) => occurrence.screenId === screenId),
    )
    .map((component) => component.id)
}

function projectSourceRef(
  manifest: NormalizedSourceManifest,
): ExplainerSourceRef {
  const framework = manifest.project.framework
  return {
    id: manifest.project.id,
    kind: 'codebase',
    label: manifest.project.name,
    uri: sourceUri(manifest.id, 'project'),
    metadata: {
      origin: manifest.provenance.origin,
      locator: manifest.provenance.locator,
      ...(manifest.provenance.revision === null
        ? {}
        : { revision: manifest.provenance.revision }),
      framework: framework?.kind ?? 'unknown',
      nextRouter: framework?.kind === 'nextjs' ? framework.router : 'n/a',
      shadcn: framework?.kind === 'nextjs' ? framework.shadcn : false,
      tailwind: framework?.kind === 'nextjs' ? framework.tailwind : false,
      typescript:
        framework?.kind === 'nextjs'
          ? framework.typescript
          : framework?.kind === 'web'
            ? (framework.typescript ?? false)
            : false,
    },
  }
}

function routeSourceRef(
  manifest: NormalizedSourceManifest,
  route: NormalizedSourceRoute,
): ExplainerSourceRef {
  return {
    id: route.id,
    kind: 'route',
    label: route.label,
    uri: sourceUri(manifest.id, `route/${route.id}`),
    route: route.path,
    metadata: {
      screenCount: route.screens.length,
      locator: route.provenance.locator,
      ...(route.sourcePath === null ? {} : { sourcePath: route.sourcePath }),
    },
  }
}

function screenSourceRef(
  manifest: NormalizedSourceManifest,
  route: NormalizedSourceRoute,
  screen: NormalizedSourceScreen,
): ExplainerSourceRef {
  return {
    id: screen.id,
    kind: 'screen',
    label: screen.name,
    uri: sourceUri(manifest.id, `screen/${screen.id}`),
    route: route.path,
    metadata: {
      width: screen.viewport.width,
      height: screen.viewport.height,
      deviceScaleFactor: screen.viewport.deviceScaleFactor,
      states: screen.states.map((state) => state.kind).join(','),
      locator: screen.provenance.locator,
      ...(screen.sourcePath === null ? {} : { sourcePath: screen.sourcePath }),
    },
  }
}

function componentSourceRef(
  manifest: NormalizedSourceManifest,
  component: NormalizedSourceComponent,
): ExplainerSourceRef {
  return {
    id: component.id,
    kind: 'component',
    label: component.name,
    uri: sourceUri(manifest.id, `component/${component.id}`),
    component: component.exportName ?? component.name,
    metadata: {
      reusable: component.reusable,
      occurrenceCount: component.occurrences.length,
      variants: component.variants.map((variant) => variant.name).join(','),
      locator: component.provenance.locator,
      ...(component.sourcePath === null
        ? {}
        : { sourcePath: component.sourcePath }),
    },
  }
}

function mapDemoAction(
  action: NormalizedSourceInteraction['action'],
  resultingState: SourceInteractionStateKind | undefined,
): StoryboardDemoStep['action'] {
  if (
    action === 'focus' ||
    action === 'click' ||
    action === 'type' ||
    action === 'submit'
  ) {
    return action
  }
  if (resultingState === 'success') return 'success'
  return 'state-change'
}

function sourceUri(manifestId: string, path: string): string {
  return `source://${manifestId}/${path}`
}
