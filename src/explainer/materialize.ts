// SPDX-License-Identifier: Apache-2.0

import { addKeyframe } from '@/anim/tracks'
import type { ProjectAPI } from '@/project/doc'
import type {
  Appearance,
  EasingKind,
  Layout,
  Node,
  NodeId,
  PropertyId,
  Transform,
} from '@/scene/types'
import type { SceneAPI } from '@/scene/doc'
import type {
  SequenceTransition,
} from '@/sequence/types'
import type {
  DemoStoryboardScene,
  DesignStoryboardScene,
  ExplainerSourceRef,
  ExplainerStoryboard,
  LogoStoryboardScene,
  StoryboardCameraDirection,
  StoryboardCue,
  StoryboardLayer3DDirection,
  StoryboardScene,
  StoryboardTransition,
  TextStoryboardScene,
} from './types'
import { validateStoryboard } from './validate'

const EASE_OUT_EXPO: EasingKind = { bezier: [0.16, 1, 0.3, 1] }
const EASE_IN_OUT: EasingKind = { bezier: [0.65, 0, 0.35, 1] }

export type MaterializeStoryboardMode = 'append' | 'replace-empty'

export interface MaterializeStoryboardInput {
  storyboard: ExplainerStoryboard
  project: ProjectAPI
  mode: MaterializeStoryboardMode
  /** A resolved data URL, file URL, or absolute media path. */
  audioSrc?: string
  /**
   * Suppresses spatial/camera motion while preserving opacity, state, cuts,
   * and timing. Hosts can bind this to their reduced-motion preference.
   */
  reducedMotion?: boolean
}

export type MaterializeStoryboardIssueSeverity = 'warning' | 'error'

export interface MaterializeStoryboardIssue {
  code: string
  severity: MaterializeStoryboardIssueSeverity
  message: string
  storyboardSceneId?: string
}

export interface MaterializedStoryboardScene {
  storyboardSceneId: string
  compositionSceneId: string
  sequenceItemId: string
  rootNodeId: NodeId
  /** Incoming transition handle before storyboard-local time zero. */
  localTimeOffset: number
  duration: number
  nodeIds: NodeId[]
  componentNodeIds: NodeId[]
  instanceNodeIds: NodeId[]
  cameraIds: NodeId[]
  cameraCutIds: string[]
  trackIds: string[]
}

export interface MaterializeStoryboardResult {
  scenes: MaterializedStoryboardScene[]
  compositionSceneIds: string[]
  sequenceItemIds: string[]
  nodeIds: NodeId[]
  audioNodeId: NodeId | null
  removedPlaceholderSceneId: string | null
  issues: MaterializeStoryboardIssue[]
}

interface SceneBuildContext {
  storyboard: ExplainerStoryboard
  scene: StoryboardScene
  project: ProjectAPI
  api: SceneAPI
  compositionSceneId: string
  sequenceItemId: string
  rootNodeId: NodeId
  localTimeOffset: number
  duration: number
  reducedMotion: boolean
  cueById: ReadonlyMap<string, StoryboardCue>
  sourceById: ReadonlyMap<string, ExplainerSourceRef>
  nodeIds: NodeId[]
  componentNodeIds: NodeId[]
  instanceNodeIds: NodeId[]
}

interface SceneContent {
  roleNodeIds: Partial<Record<StoryboardLayer3DDirection['role'], NodeId>>
}

/**
 * Turn a validated explainer storyboard into editable Hyper Motion content.
 *
 * Every storyboard scene becomes an independently rooted ProjectAPI
 * composition and one ordered sequence occurrence. Storyboard master times
 * are translated to composition-local times; non-cut transitions reserve an
 * incoming pre-roll handle so overlap does not shorten the final sequence.
 */
export function materializeStoryboard(
  input: MaterializeStoryboardInput,
): MaterializeStoryboardResult {
  const issues: MaterializeStoryboardIssue[] = []
  const validation = validateStoryboard(input.storyboard)
  for (const issue of validation.issues) {
    issues.push({
      code: `storyboard-${issue.code}`,
      severity: issue.severity,
      message: issue.message,
      ...(issue.sceneId ? { storyboardSceneId: issue.sceneId } : {}),
    })
  }
  if (!validation.ok) {
    return emptyResult(issues)
  }

  const { project, storyboard } = input
  const api = project.scene
  api.setMeta({
    name: storyboard.title,
    frameRate: storyboard.frameRate,
    canvas: { ...storyboard.canvas },
  })
  ensureMaterializationSeed(api, storyboard)
  project.ensureInitialized()
  const initialScenes = project.getScenes()
  const placeholder = replaceablePlaceholder(
    input.mode,
    initialScenes,
    project,
  )
  if (
    input.mode === 'replace-empty' &&
    initialScenes.length > 0 &&
    placeholder === null
  ) {
    issues.push({
      code: 'replace-empty-skipped',
      severity: 'warning',
      message:
        'The existing project is not a single empty scene; generated scenes were appended without deleting authored content.',
    })
  }

  const cueById = new Map(
    storyboard.beatPlan.cues.map((cue) => [cue.id, cue]),
  )
  const sourceById = new Map(
    storyboard.sourceRefs.map((source) => [source.id, source]),
  )
  const transitionByFrom = new Map(
    storyboard.transitions.map((transition) => [
      transition.fromSceneId,
      transition,
    ]),
  )
  const transitionByTo = new Map(
    storyboard.transitions.map((transition) => [
      transition.toSceneId,
      transition,
    ]),
  )
  const resultScenes: MaterializedStoryboardScene[] = []

  for (const storyboardScene of [...storyboard.scenes].sort(
    (left, right) => left.order - right.order,
  )) {
    const incomingTransition = transitionByTo.get(storyboardScene.id)
    const localTimeOffset = effectiveTransitionDuration(incomingTransition)
    const duration = Math.max(
      1 / storyboard.frameRate,
      storyboardScene.endTime -
        storyboardScene.startTime +
        localTimeOffset,
    )
    const existingItemIds = new Set(
      project.getSequenceItems().map((item) => item.id),
    )

    try {
      const composition = project.createScene({
        name: sceneName(storyboardScene),
        duration,
      })
      const sequenceItem = project
        .getSequenceItems()
        .find((item) => !existingItemIds.has(item.id))
      if (!sequenceItem) {
        throw new Error('ProjectAPI did not return the created sequence item.')
      }

      const context: SceneBuildContext = {
        storyboard,
        scene: storyboardScene,
        project,
        api,
        compositionSceneId: composition.id,
        sequenceItemId: sequenceItem.id,
        rootNodeId: composition.rootNodeId,
        localTimeOffset,
        duration,
        reducedMotion: input.reducedMotion ?? false,
        cueById,
        sourceById,
        nodeIds: [composition.rootNodeId],
        componentNodeIds: [],
        instanceNodeIds: [],
      }
      configureCompositionRoot(context)
      const content = materializeSceneContent(context)
      for (const componentNodeId of context.componentNodeIds) {
        project.registerWorkspaceNode(composition.id, componentNodeId)
      }
      applyLayerDirections(context, content)
      const cameraProgram = materializeCameraProgram(context)

      project.updateSequenceItem(sequenceItem.id, {
        trimStart: 0,
        duration,
      })
      const outgoingTransition = transitionByFrom.get(storyboardScene.id)
      project.setTransition(
        sequenceItem.id,
        materializedTransition(outgoingTransition),
      )
      if (
        outgoingTransition &&
        outgoingTransition.kind !== 'cut' &&
        outgoingTransition.kind !== 'crossfade'
      ) {
        issues.push({
          code: 'transition-approximated',
          severity: 'warning',
          storyboardSceneId: storyboardScene.id,
          message:
            `${outgoingTransition.kind} is stored as a timed crossfade until the sequence renderer supports that transition kind.`,
        })
      }

      const nodeIdSet = new Set(context.nodeIds)
      const trackIds = api
        .getAllTracks()
        .filter((track) => nodeIdSet.has(track.nodeId))
        .map((track) => track.id)
      resultScenes.push({
        storyboardSceneId: storyboardScene.id,
        compositionSceneId: composition.id,
        sequenceItemId: sequenceItem.id,
        rootNodeId: composition.rootNodeId,
        localTimeOffset,
        duration,
        nodeIds: [...context.nodeIds],
        componentNodeIds: [...context.componentNodeIds],
        instanceNodeIds: [...context.instanceNodeIds],
        cameraIds: cameraProgram.cameraIds,
        cameraCutIds: cameraProgram.cameraCutIds,
        trackIds,
      })
    } catch (error) {
      issues.push({
        code: 'scene-materialization-failed',
        severity: 'error',
        storyboardSceneId: storyboardScene.id,
        message:
          error instanceof Error
            ? error.message
            : `Failed to materialize ${storyboardScene.id}.`,
      })
    }
  }

  let removedPlaceholderSceneId: string | null = null
  if (placeholder && resultScenes.length > 0) {
    const deletion = project.deleteScene(placeholder.id)
    if (deletion.deleted) {
      removedPlaceholderSceneId = placeholder.id
    } else {
      issues.push({
        code: 'replace-empty-delete-failed',
        severity: 'warning',
        message: 'The empty placeholder scene could not be removed.',
      })
    }
  }

  const audioNodeId = materializeSequenceAudio(input, issues)
  if (audioNodeId) {
    // Audio is sequence-level and intentionally belongs to no composition.
    // It still participates in the complete materialization result.
  }

  const firstCreated = resultScenes[0]
  if (firstCreated) project.activateScene(firstCreated.compositionSceneId)

  const sceneNodeIds = resultScenes.flatMap((scene) => scene.nodeIds)
  return {
    scenes: resultScenes,
    compositionSceneIds: resultScenes.map(
      (scene) => scene.compositionSceneId,
    ),
    sequenceItemIds: resultScenes.map((scene) => scene.sequenceItemId),
    nodeIds: audioNodeId ? [...sceneNodeIds, audioNodeId] : sceneNodeIds,
    audioNodeId,
    removedPlaceholderSceneId,
    issues,
  }
}

function configureCompositionRoot(context: SceneBuildContext): void {
  const { api, rootNodeId, storyboard, scene } = context
  api.setNodeProperty(rootNodeId, 'name', `${scene.title} · ${scene.id}`)
  api.setNodeProperty(rootNodeId, 'size', { ...storyboard.canvas })
  api.setNodeProperty(rootNodeId, 'layout', columnLayout({
    justify: 'center',
    align: 'center',
    gap: 24,
    padding: 64,
  }))
  api.setNodeProperty(
    rootNodeId,
    'appearance',
    appearance(
      storyboard.brand.backgroundColor ?? '#111113',
      0,
    ),
  )
}

/**
 * SceneAPI documents are allowed to start without an artboard. ProjectAPI's
 * legacy migration needs one, so create a deliberately empty placeholder that
 * `replace-empty` can safely remove after materialization.
 */
function ensureMaterializationSeed(
  api: SceneAPI,
  storyboard: ExplainerStoryboard,
): void {
  if (api.getRoot()) return
  api.createNode('frame', null, {
    name: 'Empty scene',
    size: { ...storyboard.canvas },
    layout: columnLayout({
      justify: 'center',
      align: 'center',
      gap: 0,
      padding: 0,
    }),
    appearance: appearance(
      storyboard.brand.backgroundColor ?? '#111113',
      0,
    ),
    clipsContent: true,
  })
}

function materializeSceneContent(context: SceneBuildContext): SceneContent {
  switch (context.scene.kind) {
    case 'text':
      return materializeTextScene(context, context.scene)
    case 'design':
      return materializeDesignScene(context, context.scene)
    case 'demo':
      return materializeDemoScene(context, context.scene)
    case 'logo':
      return materializeLogoScene(context, context.scene)
  }
}

function materializeTextScene(
  context: SceneBuildContext,
  scene: TextStoryboardScene,
): SceneContent {
  const { storyboard } = context
  const stage = createNode(context, 'frame', context.rootNodeId, {
    name: `Text stage · ${scene.id}`,
    size: {
      width: Math.round(storyboard.canvas.width * 0.76),
      height: 'hug',
    },
    layout: columnLayout({
      justify: 'center',
      align: 'center',
      gap: 20,
      padding: 32,
    }),
    appearance: appearance(null, 0),
    clipsContent: false,
  })
  createNode(context, 'text', stage, {
    name: 'Brand label',
    text: storyboard.brand.name,
    fontFamily: fontFamily(context),
    fontSize: 18,
    fontWeight: 600,
    letterSpacing: 1.2,
    color: storyboard.brand.accentColor ?? '#a1a1aa',
    textAlign: 'center',
  })
  const headline = createNode(context, 'text', stage, {
    name: scene.treatment === 'headline' ? 'Headline' : 'Statement',
    text: scene.text,
    size: { width: 'fill', height: 'hug' },
    fontFamily: fontFamily(context),
    fontSize: scene.treatment === 'caption' ? 48 : 76,
    fontWeight: 700,
    lineHeight: 1.04,
    letterSpacing: -1.6,
    color: '#f7f7f8',
    textAlign: 'center',
  })
  const revealCue = cueForKind(context, 'text-reveal')
  const revealTime = revealCue
    ? localTime(context, revealCue.time)
    : context.localTimeOffset
  animateEntrance(
    context,
    headline,
    revealTime,
    Math.min(context.duration, revealTime + 0.48),
    24,
  )
  return { roleNodeIds: {} }
}

function materializeDesignScene(
  context: SceneBuildContext,
  scene: DesignStoryboardScene,
): SceneContent {
  const { api, storyboard } = context
  const stage = createNode(context, 'frame', context.rootNodeId, {
    name: `Design stage · ${scene.id}`,
    size: {
      width: Math.round(storyboard.canvas.width * 0.78),
      height: Math.round(storyboard.canvas.height * 0.68),
    },
    layout: columnLayout({
      justify: 'center',
      align: 'center',
      gap: 16,
      padding: 32,
    }),
    appearance: appearance(null, 0),
    clipsContent: false,
  })
  const background = createNode(context, 'frame', stage, {
    name: 'Background plane',
    position: 'absolute',
    size: { width: 'fill', height: 'fill' },
    layout: columnLayout({
      justify: 'center',
      align: 'center',
      gap: 0,
      padding: 0,
    }),
    appearance: appearance('#18181b', 32),
    clipsContent: true,
  })
  const surface = createNode(context, 'frame', stage, {
    name: 'Component surface',
    position: 'absolute',
    size: {
      width: Math.round(storyboard.canvas.width * 0.68),
      height: Math.round(storyboard.canvas.height * 0.52),
    },
    layout: gridLayout(Math.max(1, Math.min(2, scene.components.length))),
    appearance: borderedAppearance('#f4f4f5', '#d4d4d8', 24),
    clipsContent: true,
  })

  const focusCue = cueForKind(context, 'design-focus')
  const focusTime = focusCue
    ? localTime(context, focusCue.time)
    : context.localTimeOffset + context.duration * 0.4
  for (const direction of scene.components) {
    const states = nonEmptyStates(direction.variantStates)
    const componentId = createComponentAsset(
      context,
      direction.name,
      states,
    )
    const instanceId = createNode(context, 'instance', surface, {
      name: `${direction.name} instance`,
      componentId,
      selection: { State: states[0]! },
      overrides: {},
      interactions: [],
      size: { width: 'fill', height: 180 },
      layout: columnLayout({
        justify: 'center',
        align: 'stretch',
        gap: 8,
        padding: 20,
      }),
      appearance: borderedAppearance('#ffffff', '#e4e4e7', 16),
    })
    context.instanceNodeIds.push(instanceId)
    if (states.length > 1) {
      addKeyframe(
        api,
        instanceId,
        'variant',
        0,
        { State: states[0]! },
        EASE_IN_OUT,
      )
      addKeyframe(
        api,
        instanceId,
        'variant',
        focusTime,
        { State: states[Math.min(1, states.length - 1)]! },
      )
    }
  }

  const focus = createNode(context, 'frame', stage, {
    name: 'Focus callout',
    position: 'absolute',
    size: { width: 420, height: 'hug' },
    layout: columnLayout({
      justify: 'center',
      align: 'start',
      gap: 8,
      padding: 20,
    }),
    appearance: borderedAppearance(
      storyboard.brand.primaryColor ?? '#3f5bf6',
      storyboard.brand.accentColor ?? '#8ba3ff',
      16,
    ),
    clipsContent: false,
  })
  createNode(context, 'text', focus, {
    name: 'Design caption',
    text: scene.caption,
    size: { width: 'fill', height: 'hug' },
    fontFamily: fontFamily(context),
    fontSize: 24,
    fontWeight: 650,
    lineHeight: 1.18,
    color: '#f7f7f8',
  })

  return {
    roleNodeIds: {
      background,
      surface,
      focus,
    },
  }
}

function materializeDemoScene(
  context: SceneBuildContext,
  scene: DemoStoryboardScene,
): SceneContent {
  const { storyboard, api } = context
  const stage = createNode(context, 'frame', context.rootNodeId, {
    name: `Demo stage · ${scene.id}`,
    size: {
      width: Math.round(storyboard.canvas.width * 0.76),
      height: Math.round(storyboard.canvas.height * 0.68),
    },
    layout: columnLayout({
      justify: 'center',
      align: 'center',
      gap: 16,
      padding: 32,
    }),
    appearance: appearance(null, 0),
    clipsContent: false,
  })
  const surface = createNode(context, 'frame', stage, {
    name: 'Demo surface',
    position: 'absolute',
    size: { width: 680, height: 'hug' },
    layout: columnLayout({
      justify: 'start',
      align: 'stretch',
      gap: 18,
      padding: 36,
    }),
    appearance: borderedAppearance('#fafafa', '#d4d4d8', 24),
    clipsContent: true,
  })
  createNode(context, 'text', surface, {
    name: 'Demo caption',
    text: scene.caption,
    size: { width: 'fill', height: 'hug' },
    fontFamily: fontFamily(context),
    fontSize: 28,
    fontWeight: 650,
    lineHeight: 1.2,
    color: '#18181b',
  })
  const input = createNode(context, 'frame', surface, {
    name: 'Form input',
    size: { width: 'fill', height: 64 },
    layout: rowLayout({
      justify: 'start',
      align: 'center',
      gap: 8,
      padding: 16,
    }),
    appearance: borderedAppearance('#ffffff', '#d4d4d8', 12),
    clipsContent: true,
  })
  createNode(context, 'text', input, {
    name: 'Input value',
    text: 'Product update',
    fontFamily: fontFamily(context),
    fontSize: 19,
    fontWeight: 500,
    color: '#3f3f46',
  })
  const control = createNode(context, 'frame', surface, {
    name: 'Submit control',
    size: { width: 'fill', height: 60 },
    layout: rowLayout({
      justify: 'center',
      align: 'center',
      gap: 8,
      padding: 16,
    }),
    appearance: appearance(
      storyboard.brand.primaryColor ?? '#3f5bf6',
      12,
    ),
    clipsContent: true,
  })
  createNode(context, 'text', control, {
    name: 'Submit label',
    text: 'Submit',
    fontFamily: fontFamily(context),
    fontSize: 19,
    fontWeight: 650,
    color: '#f8fafc',
  })
  const success = createNode(context, 'frame', stage, {
    name: 'Success state',
    position: 'absolute',
    size: { width: 360, height: 'hug' },
    layout: rowLayout({
      justify: 'center',
      align: 'center',
      gap: 12,
      padding: 20,
    }),
    appearance: borderedAppearance('#dcfce7', '#86efac', 18),
    clipsContent: false,
  })
  createNode(context, 'text', success, {
    name: 'Success label',
    text: 'Success — ready for the next step',
    fontFamily: fontFamily(context),
    fontSize: 20,
    fontWeight: 650,
    color: '#166534',
  })

  const states = [
    'default',
    ...scene.steps.map((step) => stateForDemoAction(step.action)),
  ].filter(uniqueString)
  const componentId = createComponentAsset(
    context,
    'Feature form',
    states,
  )
  const instanceId = createNode(context, 'instance', surface, {
    name: 'Feature form state instance',
    componentId,
    selection: { State: states[0]! },
    overrides: {},
    interactions: [],
    size: { width: 'fill', height: 96 },
    layout: columnLayout({
      justify: 'center',
      align: 'stretch',
      gap: 8,
      padding: 12,
    }),
    appearance: appearance(null, 0),
  })
  context.instanceNodeIds.push(instanceId)
  addKeyframe(
    api,
    instanceId,
    'variant',
    0,
    { State: states[0]! },
    EASE_IN_OUT,
  )

  let successTime = context.duration
  for (const step of scene.steps) {
    const cue = context.cueById.get(step.cueId)
    if (!cue) continue
    const time = localTime(context, cue.time)
    const state = stateForDemoAction(step.action)
    addKeyframe(api, instanceId, 'variant', time, { State: state })
    if (
      step.action === 'click' ||
      step.action === 'submit' ||
      step.action === 'state-change'
    ) {
      animateControlFeedback(context, control, time)
    }
    if (step.action === 'success') successTime = time
  }
  animateOpacity(
    context,
    success,
    Math.max(0, successTime - 0.01),
    Math.min(context.duration, successTime + 0.28),
    0,
    1,
  )

  return {
    roleNodeIds: {
      surface,
      control,
      success,
    },
  }
}

function materializeLogoScene(
  context: SceneBuildContext,
  scene: LogoStoryboardScene,
): SceneContent {
  const { storyboard } = context
  const logoStage = createNode(context, 'frame', context.rootNodeId, {
    name: `Logo lockup · ${scene.id}`,
    size: {
      width: Math.round(storyboard.canvas.width * 0.56),
      height: 'hug',
    },
    layout: columnLayout({
      justify: 'center',
      align: 'center',
      gap: 18,
      padding: 40,
    }),
    appearance: appearance(null, 0),
    clipsContent: false,
  })
  const logoSource = scene.logoSourceRefId
    ? context.sourceById.get(scene.logoSourceRefId)
    : undefined
  if (logoSource?.uri) {
    createNode(context, 'image', logoStage, {
      name: `${scene.brandName} logo`,
      src: logoSource.uri,
      size: { width: 260, height: 128 },
      fit: 'contain',
    })
  } else {
    createNode(context, 'text', logoStage, {
      name: 'Brand mark',
      text: scene.brandName,
      fontFamily: fontFamily(context),
      fontSize: 84,
      fontWeight: 750,
      letterSpacing: -2,
      color: '#f7f7f8',
      textAlign: 'center',
    })
  }
  if (scene.tagline) {
    createNode(context, 'text', logoStage, {
      name: 'Tagline',
      text: scene.tagline,
      fontFamily: fontFamily(context),
      fontSize: 24,
      fontWeight: 500,
      color: '#a1a1aa',
      textAlign: 'center',
    })
  }
  const logoCue = cueForKind(context, 'logo-hit')
  const start = logoCue
    ? localTime(context, logoCue.time)
    : context.localTimeOffset
  animateLogo(
    context,
    logoStage,
    start,
    Math.min(context.duration, start + 0.64),
  )
  return { roleNodeIds: { logo: logoStage } }
}

function createComponentAsset(
  context: SceneBuildContext,
  name: string,
  states: string[],
): NodeId {
  const { api, storyboard } = context
  const workspaceIndex = api
    .getAllNodeIds()
    .reduce((count, nodeId) => {
      const node = api.getNode(nodeId)
      return count + (node?.parent === null && node.workspaceOnly ? 1 : 0)
    }, 0)
  const workspaceColumn = workspaceIndex % 2
  const workspaceRow = Math.floor(workspaceIndex / 2)
  const componentId = createNode(context, 'component', null, {
    name: `${name} component`,
    workspaceOnly: true,
    // Component masters stay editable on the pasteboard, but must never sit
    // over the composition at the default fitted view. Arrange them in a
    // stable grid immediately to the right of the artboard.
    transform: {
      x: storyboard.canvas.width + 64 + workspaceColumn * 344,
      y: workspaceRow * 184,
      z: 0,
      rotation: 0,
      rotationX: 0,
      rotationY: 0,
      scaleX: 1,
      scaleY: 1,
    },
    size: { width: 320, height: 160 },
    layout: columnLayout({
      justify: 'center',
      align: 'stretch',
      gap: 12,
      padding: 20,
    }),
    appearance: borderedAppearance('#ffffff', '#e4e4e7', 16),
    variants: [{ name: 'State', values: states }],
    defaultSelection: { State: states[0]! },
    variantOverrides: states.slice(1).map((state) => ({
      match: { State: state },
      overrides: {},
    })),
    componentProperties: [],
    variantTransition: {
      duration: 0.24,
      easing: EASE_IN_OUT,
      presetId: 'smooth',
      strength: 55,
    },
    timelines: {},
    interactions: [],
  })
  context.componentNodeIds.push(componentId)
  createNode(context, 'text', componentId, {
    name: `${name} component label`,
    text: name,
    size: { width: 'fill', height: 'hug' },
    fontFamily: fontFamily(context),
    fontSize: 20,
    fontWeight: 650,
    color: '#18181b',
  })
  createNode(context, 'frame', componentId, {
    name: `${name} component accent`,
    size: { width: 'fill', height: 12 },
    layout: rowLayout({
      justify: 'start',
      align: 'center',
      gap: 0,
      padding: 0,
    }),
    appearance: appearance(
      storyboard.brand.primaryColor ?? '#3f5bf6',
      6,
    ),
    clipsContent: true,
  })
  return componentId
}

function applyLayerDirections(
  context: SceneBuildContext,
  content: SceneContent,
): void {
  for (const direction of context.scene.layerDirections) {
    const nodeId = content.roleNodeIds[direction.role]
    if (!nodeId) continue
    const current = context.api.getNode(nodeId)
    if (!current) continue
    const usesPlane =
      direction.depth !== 0 ||
      direction.from.z !== 0 ||
      direction.from.rotationX !== 0 ||
      direction.from.rotationY !== 0
    context.api.setNodeProperty(nodeId, 'transform', {
      ...current.transform,
      x: direction.to.x,
      y: direction.to.y,
      z: direction.to.z,
      rotationX: direction.to.rotationX,
      rotationY: direction.to.rotationY,
      renderMode: usesPlane ? 'plane' : current.transform.renderMode,
    })
    context.api.setNodeProperty(nodeId, 'appearance', {
      ...current.appearance,
      opacity: direction.to.opacity,
    })
    const start = localTime(context, direction.startTime)
    const end = localTime(context, direction.endTime)
    animateOpacity(
      context,
      nodeId,
      start,
      end,
      direction.from.opacity,
      direction.to.opacity,
    )
    if (context.reducedMotion) continue
    animatePropertyPair(
      context,
      nodeId,
      'transform.x',
      start,
      end,
      direction.from.x,
      direction.to.x,
    )
    animatePropertyPair(
      context,
      nodeId,
      'transform.y',
      start,
      end,
      direction.from.y,
      direction.to.y,
    )
    animatePropertyPair(
      context,
      nodeId,
      'transform.z',
      start,
      end,
      direction.from.z,
      direction.to.z,
    )
    animatePropertyPair(
      context,
      nodeId,
      'transform.rotationX',
      start,
      end,
      direction.from.rotationX,
      direction.to.rotationX,
    )
    animatePropertyPair(
      context,
      nodeId,
      'transform.rotationY',
      start,
      end,
      direction.from.rotationY,
      direction.to.rotationY,
    )
  }
}

function materializeCameraProgram(context: SceneBuildContext): {
  cameraIds: NodeId[]
  cameraCutIds: string[]
} {
  const { api, project, storyboard, scene } = context
  const composition = project.getScene(context.compositionSceneId)
  if (!composition?.defaultCameraId) {
    return { cameraIds: [], cameraCutIds: [] }
  }
  const cuts = storyboard.beatPlan.cameraCuts
    .filter((cut) => cut.sceneId === scene.id)
    .sort((left, right) => left.time - right.time || left.id.localeCompare(right.id))
  const directions = [...scene.cameraDirections].sort(
    (left, right) =>
      left.startTime - right.startTime || left.id.localeCompare(right.id),
  )
  const cameraKeys = [
    ...cuts.map((cut) => cut.cameraId),
    ...directions.map((direction) => direction.cameraId),
  ].filter(uniqueString)
  if (cameraKeys.length === 0) cameraKeys.push(`camera-${scene.kind}`)

  const cameraIdByKey = new Map<string, NodeId>()
  const primaryKey = cameraKeys[0]!
  cameraIdByKey.set(primaryKey, composition.defaultCameraId)
  const createdCameraIds: NodeId[] = [composition.defaultCameraId]
  if (!context.nodeIds.includes(composition.defaultCameraId)) {
    context.nodeIds.push(composition.defaultCameraId)
  }

  for (const cameraKey of cameraKeys.slice(1)) {
    const direction = directions.find(
      (candidate) => candidate.cameraId === cameraKey,
    )
    const cameraId = api.createNode('camera', null, {
      name: cameraName(cameraKey, direction),
      projection: 'perspective',
      transform: cameraTransform(
        storyboard.canvas,
        direction?.to ?? direction?.from,
      ),
      focalLength: 1000,
      fieldOfView: 35,
      pointOfInterestX: storyboard.canvas.width / 2,
      pointOfInterestY: storyboard.canvas.height / 2,
      pointOfInterestZ: 0,
      focusMode: 'screen',
      focusX: storyboard.canvas.width / 2,
      focusY: storyboard.canvas.height / 2,
      focusWorldX: storyboard.canvas.width / 2,
      focusWorldY: storyboard.canvas.height / 2,
      focusWorldZ: direction?.to?.focusDepth ?? 0,
      focusDistance: direction?.to?.focusDepth ?? 0,
    })
    context.nodeIds.push(cameraId)
    createdCameraIds.push(cameraId)
    cameraIdByKey.set(cameraKey, cameraId)
    // setDefaultCamera also registers an otherwise-unowned camera.
    project.setDefaultCamera(context.compositionSceneId, cameraId)
  }
  project.setDefaultCamera(
    context.compositionSceneId,
    composition.defaultCameraId,
  )

  const primaryDirections = directions.filter(
    (direction) => direction.cameraId === primaryKey,
  )
  configureExistingCamera(
    context,
    composition.defaultCameraId,
    primaryKey,
    primaryDirections.at(-1),
  )

  for (const direction of directions) {
    const cameraId = cameraIdByKey.get(direction.cameraId)
    if (!cameraId) continue
    animateCameraDirection(context, cameraId, direction)
  }

  const cameraCutIds: string[] = []
  for (const cut of cuts) {
    const cameraId = cameraIdByKey.get(cut.cameraId)
    if (!cameraId) continue
    project.upsertCameraCut(context.compositionSceneId, {
      id: cut.id,
      time: localTime(context, cut.time),
      cameraId,
    })
    cameraCutIds.push(cut.id)
  }
  return {
    cameraIds: [
      ...(project.getScene(context.compositionSceneId)?.cameraIds ??
        createdCameraIds),
    ],
    cameraCutIds,
  }
}

function configureExistingCamera(
  context: SceneBuildContext,
  cameraId: NodeId,
  cameraKey: string,
  direction: StoryboardCameraDirection | undefined,
): void {
  const { api, storyboard } = context
  api.setNodeProperty(cameraId, 'name', cameraName(cameraKey, direction))
  api.setNodeProperty(
    cameraId,
    'transform',
    cameraTransform(
      storyboard.canvas,
      direction?.to ?? direction?.from,
    ),
  )
  api.setNodeProperty(cameraId, 'focalLength', 1000)
  api.setNodeProperty(cameraId, 'fieldOfView', 35)
  api.setNodeProperty(
    cameraId,
    'pointOfInterestX',
    storyboard.canvas.width / 2,
  )
  api.setNodeProperty(
    cameraId,
    'pointOfInterestY',
    storyboard.canvas.height / 2,
  )
  api.setNodeProperty(
    cameraId,
    'focusDistance',
    direction?.to?.focusDepth ?? 0,
  )
}

function animateCameraDirection(
  context: SceneBuildContext,
  cameraId: NodeId,
  direction: StoryboardCameraDirection,
): void {
  if (context.reducedMotion) return
  const start = localTime(context, direction.startTime)
  const end = localTime(context, direction.endTime)
  const from = cameraTransform(context.storyboard.canvas, direction.from)
  const to = cameraTransform(context.storyboard.canvas, direction.to)
  animatePropertyPair(
    context,
    cameraId,
    'transform.x',
    start,
    end,
    from.x,
    to.x,
  )
  animatePropertyPair(
    context,
    cameraId,
    'transform.y',
    start,
    end,
    from.y,
    to.y,
  )
  animatePropertyPair(
    context,
    cameraId,
    'transform.z',
    start,
    end,
    from.z,
    to.z,
  )
  animatePropertyPair(
    context,
    cameraId,
    'transform.rotationX',
    start,
    end,
    from.rotationX,
    to.rotationX,
  )
  animatePropertyPair(
    context,
    cameraId,
    'transform.rotationY',
    start,
    end,
    from.rotationY,
    to.rotationY,
  )
  animatePropertyPair(
    context,
    cameraId,
    'transform.scaleX',
    start,
    end,
    from.scaleX,
    to.scaleX,
  )
  animatePropertyPair(
    context,
    cameraId,
    'transform.scaleY',
    start,
    end,
    from.scaleY,
    to.scaleY,
  )
  if (
    direction.from?.focusDepth !== undefined ||
    direction.to?.focusDepth !== undefined
  ) {
    animatePropertyPair(
      context,
      cameraId,
      'camera.focusDistance',
      start,
      end,
      direction.from?.focusDepth ?? 0,
      direction.to?.focusDepth ?? direction.from?.focusDepth ?? 0,
    )
  }
}

function materializeSequenceAudio(
  input: MaterializeStoryboardInput,
  issues: MaterializeStoryboardIssue[],
): NodeId | null {
  const src = input.audioSrc?.trim()
  if (input.audioSrc !== undefined && !src) {
    issues.push({
      code: 'invalid-audio-source',
      severity: 'warning',
      message: 'The provided audio source was blank, so no audio node was created.',
    })
    return null
  }
  if (!src) return null
  const { storyboard, project } = input
  const duration = finitePositive(
    storyboard.beatPlan.audioDurationSeconds,
    storyboard.durationSeconds,
  )
  const beatGrid = finitePositive(storyboard.beatPlan.bpm, 0) > 0
    ? {
        version: 1 as const,
        bpm: storyboard.beatPlan.bpm!,
        firstBeatTime: Math.max(
          0,
          storyboard.beatPlan.firstBeatTime ?? 0,
        ),
        beatsPerBar: 4,
        beatUnit: 4 as const,
        subdivisions: [],
      }
    : undefined
  return project.scene.createNode('audio', null, {
    name: `Sequence audio · ${storyboard.id}`,
    src,
    duration,
    volume: 1,
    playbackRate: 1,
    muted: false,
    startTime: 0,
    trimStart: 0,
    trimEnd: duration,
    loop: false,
    workspaceOnly: true,
    ...(beatGrid ? { beatGrid } : {}),
  })
}

function animateEntrance(
  context: SceneBuildContext,
  nodeId: NodeId,
  start: number,
  end: number,
  yOffset: number,
): void {
  animateOpacity(context, nodeId, start, end, 0, 1)
  if (context.reducedMotion) return
  animatePropertyPair(
    context,
    nodeId,
    'transform.y',
    start,
    end,
    yOffset,
    0,
  )
}

function animateLogo(
  context: SceneBuildContext,
  nodeId: NodeId,
  start: number,
  end: number,
): void {
  animateOpacity(context, nodeId, start, end, 0, 1)
  if (context.reducedMotion) return
  animatePropertyPair(
    context,
    nodeId,
    'transform.scaleX',
    start,
    end,
    0.88,
    1,
  )
  animatePropertyPair(
    context,
    nodeId,
    'transform.scaleY',
    start,
    end,
    0.88,
    1,
  )
}

function animateControlFeedback(
  context: SceneBuildContext,
  nodeId: NodeId,
  time: number,
): void {
  if (context.reducedMotion) {
    animateOpacity(
      context,
      nodeId,
      Math.max(0, time - 0.06),
      Math.min(context.duration, time + 0.14),
      0.72,
      1,
    )
    return
  }
  addKeyframe(
    context.api,
    nodeId,
    'transform.scaleX',
    Math.max(0, time - 0.06),
    1,
    EASE_IN_OUT,
  )
  addKeyframe(context.api, nodeId, 'transform.scaleX', time, 0.96)
  addKeyframe(
    context.api,
    nodeId,
    'transform.scaleX',
    Math.min(context.duration, time + 0.14),
    1,
  )
  addKeyframe(
    context.api,
    nodeId,
    'transform.scaleY',
    Math.max(0, time - 0.06),
    1,
    EASE_IN_OUT,
  )
  addKeyframe(context.api, nodeId, 'transform.scaleY', time, 0.96)
  addKeyframe(
    context.api,
    nodeId,
    'transform.scaleY',
    Math.min(context.duration, time + 0.14),
    1,
  )
}

function animateOpacity(
  context: SceneBuildContext,
  nodeId: NodeId,
  start: number,
  end: number,
  from: number,
  to: number,
): void {
  animatePropertyPair(
    context,
    nodeId,
    'appearance.opacity',
    start,
    end,
    from,
    to,
  )
}

function animatePropertyPair(
  context: SceneBuildContext,
  nodeId: NodeId,
  propertyId: PropertyId,
  start: number,
  end: number,
  from: number,
  to: number,
): void {
  const safeStart = clamp(start, 0, context.duration)
  const safeEnd = clamp(
    Math.max(end, safeStart + 1 / context.storyboard.frameRate),
    safeStart,
    context.duration,
  )
  addKeyframe(
    context.api,
    nodeId,
    propertyId,
    safeStart,
    from,
    EASE_OUT_EXPO,
  )
  addKeyframe(context.api, nodeId, propertyId, safeEnd, to)
}

function createNode(
  context: SceneBuildContext,
  kind: Node['kind'],
  parent: NodeId | null,
  props: Parameters<SceneAPI['createNode']>[2],
): NodeId {
  const nodeId = context.api.createNode(kind, parent, props)
  context.nodeIds.push(nodeId)
  return nodeId
}

function localTime(context: SceneBuildContext, masterTime: number): number {
  return clamp(
    masterTime - context.scene.startTime + context.localTimeOffset,
    0,
    context.duration,
  )
}

function cueForKind(
  context: SceneBuildContext,
  kind: StoryboardCue['kind'],
): StoryboardCue | null {
  for (const cueId of context.scene.cueIds) {
    const cue = context.cueById.get(cueId)
    if (cue?.kind === kind) return cue
  }
  return null
}

function materializedTransition(
  transition: StoryboardTransition | undefined,
): SequenceTransition {
  if (!transition || transition.kind === 'cut') {
    return { kind: 'cut', duration: 0 }
  }
  return {
    kind: 'crossfade',
    duration: effectiveTransitionDuration(transition),
  }
}

function effectiveTransitionDuration(
  transition: StoryboardTransition | undefined,
): number {
  if (!transition || transition.kind === 'cut') return 0
  return Math.max(0, transition.endTime - transition.startTime)
}

function replaceablePlaceholder(
  mode: MaterializeStoryboardMode,
  scenes: ReturnType<ProjectAPI['getScenes']>,
  project: ProjectAPI,
): ReturnType<ProjectAPI['getScene']> {
  if (mode !== 'replace-empty' || scenes.length !== 1) return null
  const scene = scenes[0]
  if (!scene) return null
  const root = project.scene.getNode(scene.rootNodeId)
  if (!root || root.kind !== 'frame') return null
  if (project.scene.getChildren(root.id).length > 0) return null
  const ownedNodeIds = new Set([root.id, ...scene.cameraIds])
  const hasTracks = project.scene
    .getAllTracks()
    .some((track) => ownedNodeIds.has(track.nodeId))
  return hasTracks ? null : scene
}

function cameraTransform(
  canvas: ExplainerStoryboard['canvas'],
  pose: StoryboardCameraDirection['to'] | undefined,
): Transform {
  const zoom = finitePositive(pose?.zoom, 1)
  return {
    x: canvas.width / 2 + finiteNumber(pose?.x, 0),
    y: canvas.height / 2 + finiteNumber(pose?.y, 0),
    z: finiteNumber(pose?.z, 0),
    rotation: 0,
    rotationX: finiteNumber(pose?.rotationX, 0),
    rotationY: finiteNumber(pose?.rotationY, 0),
    scaleX: zoom,
    scaleY: zoom,
    anchorX: 0.5,
    anchorY: 0.5,
    anchorZ: 0,
    space: 'world',
    renderMode: 'flat',
  }
}

function cameraName(
  cameraKey: string,
  direction: StoryboardCameraDirection | undefined,
): string {
  const role = direction?.cameraRole ?? cameraKey.replace(/^camera-/, '')
  return `Camera · ${role}`
}

function sceneName(scene: StoryboardScene): string {
  return `${String(scene.order + 1).padStart(2, '0')} · ${scene.title}`
}

function fontFamily(context: SceneBuildContext): string {
  return context.storyboard.brand.fontFamily ?? 'Inter'
}

function stateForDemoAction(
  action: DemoStoryboardScene['steps'][number]['action'],
): string {
  if (action === 'focus') return 'focused'
  if (action === 'submit') return 'submitting'
  if (action === 'success') return 'success'
  if (action === 'state-change') return 'result'
  if (action === 'type') return 'filled'
  return 'active'
}

function nonEmptyStates(states: readonly string[]): string[] {
  const unique = states
    .map((state) => state.trim())
    .filter((state) => state.length > 0)
    .filter(uniqueString)
  return unique.length > 0 ? unique : ['default']
}

function emptyResult(
  issues: MaterializeStoryboardIssue[],
): MaterializeStoryboardResult {
  return {
    scenes: [],
    compositionSceneIds: [],
    sequenceItemIds: [],
    nodeIds: [],
    audioNodeId: null,
    removedPlaceholderSceneId: null,
    issues,
  }
}

function columnLayout(options: {
  justify: Layout['justify']
  align: Layout['align']
  gap: number
  padding: number
}): Layout {
  return {
    mode: 'flex',
    direction: 'column',
    justify: options.justify,
    align: options.align,
    gap: options.gap,
    padding: uniformPadding(options.padding),
    wrap: false,
    columns: 1,
    rowGap: options.gap,
    columnGap: options.gap,
  }
}

function rowLayout(options: {
  justify: Layout['justify']
  align: Layout['align']
  gap: number
  padding: number
}): Layout {
  return {
    ...columnLayout(options),
    direction: 'row',
  }
}

function gridLayout(columns: number): Layout {
  return {
    mode: 'grid',
    direction: 'row',
    justify: 'center',
    align: 'stretch',
    gap: 20,
    padding: uniformPadding(28),
    wrap: true,
    columns,
    rowGap: 20,
    columnGap: 20,
  }
}

function uniformPadding(value: number): Layout['padding'] {
  return { top: value, right: value, bottom: value, left: value }
}

function appearance(fill: string | null, cornerRadius: number): Appearance {
  return {
    opacity: 1,
    fill: fill ? { kind: 'solid', color: fill } : null,
    stroke: null,
    cornerRadius,
    blendMode: 'normal',
    effects: [],
  }
}

function borderedAppearance(
  fill: string,
  stroke: string,
  cornerRadius: number,
): Appearance {
  return {
    ...appearance(fill, cornerRadius),
    stroke: {
      color: stroke,
      width: 1,
      align: 'inside',
      style: 'solid',
      dashLength: 0,
      dashGap: 0,
    },
  }
}

function finiteNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : fallback
}

function finitePositive(
  value: number | null | undefined,
  fallback: number,
): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback
}

function uniqueString(value: string, index: number, values: string[]): boolean {
  return values.indexOf(value) === index
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
