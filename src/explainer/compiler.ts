// SPDX-License-Identifier: Apache-2.0

import { validateStoryboard } from './validate'
import type {
  CompileStoryboardOptions,
  DemoStoryboardScene,
  DesignStoryboardScene,
  ExplainerAudioAnalysis,
  ExplainerBrand,
  ExplainerBrief,
  ExplainerScriptBeat,
  ExplainerSourceRef,
  ExplainerStoryboard,
  LogoStoryboardScene,
  StoryboardBeatPlan,
  StoryboardCameraAction,
  StoryboardCameraCut,
  StoryboardCameraDirection,
  StoryboardCameraRole,
  StoryboardComponentDirection,
  StoryboardCue,
  StoryboardCueKind,
  StoryboardDemoStep,
  StoryboardLayer3DDirection,
  StoryboardLayerRole,
  StoryboardScene,
  StoryboardSceneBase,
  StoryboardSceneKind,
  StoryboardTransition,
  StoryboardTransitionKind,
  TextStoryboardScene,
} from './types'

export const DEFAULT_EXPLAINER_DURATION_SECONDS = 12
export const DEFAULT_EXPLAINER_MIN_DURATION_SECONDS = 10
export const DEFAULT_EXPLAINER_MAX_DURATION_SECONDS = 15

const DEFAULT_FRAME_RATE = 60
const DEFAULT_CANVAS = { width: 1920, height: 1080 }
const MIN_SCENE_DURATION = 1.1
const TIME_PRECISION = 10_000
const EPSILON = 1 / TIME_PRECISION

interface ScriptAtom {
  text: string
  sceneType?: StoryboardSceneKind
  sourceRefIds: string[]
  action?: string
}

interface SceneSpec {
  kind: StoryboardSceneKind
  text: string
  sourceRefIds: string[]
  action?: string
}

interface BeatEvidence {
  source: StoryboardBeatPlan['source']
  sourceRefId: string | null
  audioDurationSeconds: number | null
  confidence: number | null
  bpm: number | null
  firstBeatTime: number | null
  beatTimes: number[]
  downbeatTimes: number[]
  energyPeakTimes: number[]
}

/**
 * Compile an explainer brief into a deterministic, renderer-independent plan.
 *
 * The same brief and options always produce byte-for-byte equivalent JSON:
 * IDs are ordinal, ordering is explicit, and no wall-clock/random state is
 * consulted. The returned storyboard includes a validation snapshot in `qc`.
 */
export function compileBriefToStoryboard(
  brief: ExplainerBrief,
  options: CompileStoryboardOptions = {},
): ExplainerStoryboard {
  const durationBounds = normalizeDurationBounds(options)
  const durationSeconds = normalizeDuration(
    options.durationSeconds ??
      brief.targetDurationSeconds ??
      preferredAudioDuration(brief.audioAnalysis),
    durationBounds.min,
    durationBounds.max,
  )
  const frameRate = normalizeFrameRate(options.frameRate)
  const canvas = normalizeCanvas(options.canvas)
  const title = nonBlank(brief.title) ?? 'Feature explainer'
  const brand = normalizeBrand(brief.brand, title)
  const sourceRefs = normalizeSourceRefs(brief.sourceRefs)
  const script = normalizeScript(brief)
  const sceneSpecs = createSceneSpecs(brief, script, sourceRefs, brand, title)
  const beatEvidence = createBeatEvidence(
    brief.audioAnalysis,
    durationSeconds,
  )
  const boundaries = createSceneBoundaries(
    sceneSpecs,
    durationSeconds,
    beatEvidence,
  )

  const cues: StoryboardCue[] = []
  const cameraCuts: StoryboardCameraCut[] = []
  let cueOrdinal = 0
  let cameraCutOrdinal = 0

  const addCue = (
    sceneId: string,
    kind: StoryboardCueKind,
    requestedTime: number,
    rangeStart: number,
    rangeEnd: number,
    label: string,
  ): StoryboardCue => {
    cueOrdinal += 1
    const snap = snapWithinRange(
      requestedTime,
      beatEvidence.beatTimes,
      rangeStart,
      rangeEnd,
    )
    const cue: StoryboardCue = {
      id: `cue-${pad(cueOrdinal)}-${kind}`,
      sceneId,
      kind,
      time: snap.time,
      requestedTime: roundTime(requestedTime),
      beatSnapped: snap.beatIndex !== null,
      beatIndex: snap.beatIndex,
      label,
    }
    cues.push(cue)
    return cue
  }

  const addCameraCut = (
    scene: StoryboardScene,
    cameraRole: StoryboardCameraRole,
    requestedTime: number,
    rangeStart: number,
    rangeEnd: number,
    label: string,
  ): StoryboardCameraCut => {
    const cue = addCue(
      scene.id,
      'camera-cut',
      requestedTime,
      rangeStart,
      rangeEnd,
      label,
    )
    cameraCutOrdinal += 1
    const cut: StoryboardCameraCut = {
      id: `camera-cut-${pad(cameraCutOrdinal)}`,
      sceneId: scene.id,
      cameraId: cameraIdForRole(cameraRole),
      cameraRole,
      time: cue.time,
      cueId: cue.id,
      beatSnapped: cue.beatSnapped,
    }
    cameraCuts.push(cut)
    scene.cueIds.push(cue.id)
    scene.cameraCutIds.push(cut.id)
    return cut
  }

  const scenes = sceneSpecs.map((spec, index) => {
    const scene = createScene(
      spec,
      index,
      boundaries[index] ?? 0,
      boundaries[index + 1] ?? durationSeconds,
      sourceRefs,
      brand,
    )
    const entryKind: StoryboardCueKind =
      scene.kind === 'logo' ? 'logo-hit' : 'scene-start'
    const entryCue = addCue(
      scene.id,
      entryKind,
      scene.startTime,
      scene.startTime,
      scene.startTime,
      scene.kind === 'logo' ? 'Logo hit' : `${scene.title} begins`,
    )
    scene.cueIds.push(entryCue.id)

    addSceneContentCues(scene, spec, addCue)
    addSceneCameraProgram(scene, addCameraCut)
    scene.layerDirections = createLayerDirections(
      scene,
      directionUses3d(brief),
    )
    return scene
  })

  const transitions = createTransitions(scenes, addCue)
  for (const scene of scenes) {
    const sceneCuts = cameraCuts
      .filter((cut) => cut.sceneId === scene.id)
      .sort(compareTimedIds)
    scene.cameraDirections = createCameraDirections(scene, sceneCuts)
  }

  cues.sort(compareTimedIds)
  cameraCuts.sort(compareTimedIds)

  const storyboard: ExplainerStoryboard = {
    version: 1,
    id: `${slug(brief.id ?? title)}-storyboard`,
    briefId: nonBlank(brief.id),
    title,
    durationSeconds,
    frameRate,
    canvas,
    brand,
    sourceRefs,
    scenes,
    transitions,
    beatPlan: {
      ...beatEvidence,
      cues,
      cameraCuts,
    },
    qc: [],
  }
  storyboard.qc = validateStoryboard(storyboard, {
    minDurationSeconds: durationBounds.min,
    maxDurationSeconds: durationBounds.max,
  }).issues
  return storyboard
}

function normalizeDurationBounds(options: CompileStoryboardOptions): {
  min: number
  max: number
} {
  const min = finitePositive(options.minDurationSeconds)
    ? options.minDurationSeconds
    : DEFAULT_EXPLAINER_MIN_DURATION_SECONDS
  const requestedMax = finitePositive(options.maxDurationSeconds)
    ? options.maxDurationSeconds
    : DEFAULT_EXPLAINER_MAX_DURATION_SECONDS
  return {
    min,
    max: Math.max(min, requestedMax),
  }
}

function preferredAudioDuration(
  audio: ExplainerAudioAnalysis | undefined,
): number | undefined {
  return finitePositive(audio?.durationSeconds)
    ? audio.durationSeconds
    : undefined
}

function normalizeDuration(
  value: number | undefined,
  min: number,
  max: number,
): number {
  const candidate = finitePositive(value)
    ? value
    : DEFAULT_EXPLAINER_DURATION_SECONDS
  return roundTime(clamp(candidate, min, max))
}

function normalizeFrameRate(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined || value <= 0) {
    return DEFAULT_FRAME_RATE
  }
  return Math.round(clamp(value, 1, 120))
}

function normalizeCanvas(
  canvas: CompileStoryboardOptions['canvas'],
): { width: number; height: number } {
  if (
    !canvas ||
    !finitePositive(canvas.width) ||
    !finitePositive(canvas.height)
  ) {
    return { ...DEFAULT_CANVAS }
  }
  return {
    width: Math.round(canvas.width),
    height: Math.round(canvas.height),
  }
}

function normalizeBrand(
  brand: ExplainerBrand | undefined,
  fallbackName: string,
): ExplainerBrand {
  return {
    name: nonBlank(brand?.name) ?? fallbackName,
    ...(nonBlank(brand?.tagline)
      ? { tagline: nonBlank(brand?.tagline)! }
      : {}),
    ...(nonBlank(brand?.logoSourceRefId)
      ? { logoSourceRefId: nonBlank(brand?.logoSourceRefId)! }
      : {}),
    ...(nonBlank(brand?.primaryColor)
      ? { primaryColor: nonBlank(brand?.primaryColor)! }
      : {}),
    ...(nonBlank(brand?.accentColor)
      ? { accentColor: nonBlank(brand?.accentColor)! }
      : {}),
    ...(nonBlank(brand?.backgroundColor)
      ? { backgroundColor: nonBlank(brand?.backgroundColor)! }
      : {}),
    ...(nonBlank(brand?.fontFamily)
      ? { fontFamily: nonBlank(brand?.fontFamily)! }
      : {}),
  }
}

function normalizeSourceRefs(
  refs: readonly ExplainerSourceRef[] | undefined,
): ExplainerSourceRef[] {
  return (refs ?? []).map((ref, index) => ({
    ...ref,
    id: nonBlank(ref.id) ?? `source-${pad(index + 1)}`,
    ...(nonBlank(ref.label) ? { label: nonBlank(ref.label)! } : {}),
    ...(nonBlank(ref.uri) ? { uri: nonBlank(ref.uri)! } : {}),
    ...(nonBlank(ref.route) ? { route: nonBlank(ref.route)! } : {}),
    ...(nonBlank(ref.component)
      ? { component: nonBlank(ref.component)! }
      : {}),
    ...(ref.metadata ? { metadata: { ...ref.metadata } } : {}),
  }))
}

function normalizeScript(brief: ExplainerBrief): ScriptAtom[] {
  const script = brief.script
  if (typeof script === 'string') {
    return splitScriptText(script).map((text) => ({
      text,
      sourceRefIds: [],
    }))
  }
  if (script) {
    const atoms: ScriptAtom[] = []
    const hook = nonBlank(script.hook)
    if (hook) atoms.push({ text: hook, sceneType: 'text', sourceRefIds: [] })
    for (const beat of script.beats ?? []) {
      const atom = atomFromScriptBeat(beat)
      if (atom) atoms.push(atom)
    }
    const close = nonBlank(script.close)
    if (close) atoms.push({ text: close, sceneType: 'logo', sourceRefIds: [] })
    return atoms
  }
  const directionText =
    typeof brief.direction === 'string'
      ? brief.direction
      : brief.direction?.summary
  return splitScriptText(directionText ?? '').map((text) => ({
    text,
    sourceRefIds: [],
  }))
}

function atomFromScriptBeat(beat: ExplainerScriptBeat): ScriptAtom | null {
  const text = nonBlank(beat.text)
  if (!text) return null
  return {
    text,
    ...(beat.sceneType ? { sceneType: beat.sceneType } : {}),
    sourceRefIds: [...(beat.sourceRefIds ?? [])],
    ...(nonBlank(beat.action) ? { action: nonBlank(beat.action)! } : {}),
  }
}

function splitScriptText(value: string): string[] {
  const matches = value.replaceAll('\r', '\n').match(/[^.!?\n]+(?:[.!?]+|$)/g)
  return (matches ?? [])
    .map((part) => nonBlank(part))
    .filter((part): part is string => part !== null)
}

function createSceneSpecs(
  brief: ExplainerBrief,
  atoms: ScriptAtom[],
  sourceRefs: ExplainerSourceRef[],
  brand: ExplainerBrand,
  title: string,
): SceneSpec[] {
  const kinds = chooseSceneKinds(brief, atoms)
  const consumed = new Set<number>()
  return kinds.map((kind, index) => {
    if (kind === 'logo') {
      const closing = atoms.find((atom) => atom.sceneType === 'logo')?.text
      return {
        kind,
        text: closing ?? brand.tagline ?? brand.name,
        sourceRefIds: logoSourceIds(brand, sourceRefs),
      }
    }

    const atomIndex = findAtomIndex(atoms, consumed, kind)
    const atom = atomIndex === -1 ? null : atoms[atomIndex] ?? null
    if (atomIndex !== -1) consumed.add(atomIndex)
    const sourceRefIds =
      atom?.sourceRefIds.length
        ? atom.sourceRefIds
        : sourceIdsForScene(kind, sourceRefs)
    return {
      kind,
      text: atom?.text ?? fallbackSceneText(kind, index, title, brand),
      sourceRefIds,
      ...(atom?.action ? { action: atom.action } : {}),
    }
  })
}

function chooseSceneKinds(
  brief: ExplainerBrief,
  atoms: ScriptAtom[],
): StoryboardSceneKind[] {
  const directedOrder =
    typeof brief.direction === 'object'
      ? brief.direction.sceneOrder
      : undefined
  let contentKinds: Exclude<StoryboardSceneKind, 'logo'>[]
  if (directedOrder && directedOrder.length > 0) {
    contentKinds = [...directedOrder]
  } else {
    const scriptedKinds = atoms
      .map((atom) => atom.sceneType)
      .filter(
        (
          kind,
        ): kind is Exclude<StoryboardSceneKind, 'logo'> =>
          kind !== undefined && kind !== 'logo',
      )
    if (scriptedKinds.length > 0) {
      contentKinds = scriptedKinds
    } else {
      contentKinds = atoms.length >= 3
        ? ['text', 'design', 'text', 'demo']
        : ['text', 'design', 'demo']
    }
  }
  if (contentKinds[0] !== 'text') contentKinds.unshift('text')
  return [...contentKinds.slice(0, 6), 'logo']
}

function findAtomIndex(
  atoms: ScriptAtom[],
  consumed: Set<number>,
  kind: Exclude<StoryboardSceneKind, 'logo'>,
): number {
  const exact = atoms.findIndex(
    (atom, index) => !consumed.has(index) && atom.sceneType === kind,
  )
  if (exact !== -1) return exact
  const semantic = atoms.findIndex(
    (atom, index) =>
      !consumed.has(index) &&
      atom.sceneType === undefined &&
      atomMatchesSceneKind(atom, kind),
  )
  if (semantic !== -1) return semantic
  const untyped = atoms.findIndex(
    (atom, index) =>
      !consumed.has(index) &&
      atom.sceneType === undefined,
  )
  if (untyped !== -1) return untyped
  return atoms.findIndex(
    (atom, index) =>
      !consumed.has(index) &&
      atom.sceneType !== 'logo',
  )
}

function atomMatchesSceneKind(
  atom: ScriptAtom,
  kind: Exclude<StoryboardSceneKind, 'logo'>,
): boolean {
  const text = `${atom.text} ${atom.action ?? ''}`.toLocaleLowerCase()
  const describesDemo =
    /(click|tap|type|form|field|submit|success|state|action|result)/.test(text)
  const describesDesign =
    /(design|dashboard|screen|component|layer|interface|layout|reveal)/.test(text)
  if (kind === 'demo') return describesDemo
  if (kind === 'design') return describesDesign && !describesDemo
  return !describesDemo && !describesDesign
}

function fallbackSceneText(
  kind: Exclude<StoryboardSceneKind, 'logo'>,
  index: number,
  title: string,
  brand: ExplainerBrand,
): string {
  if (kind === 'text') {
    return index === 0 ? title : `${brand.name}, made clear`
  }
  if (kind === 'design') return `See ${title} come together`
  return `Watch ${title} in action`
}

function sourceIdsForScene(
  kind: Exclude<StoryboardSceneKind, 'logo'>,
  refs: ExplainerSourceRef[],
): string[] {
  if (kind === 'text') return []
  const acceptedKinds =
    kind === 'design'
      ? new Set(['screen', 'component', 'route', 'codebase', 'asset'])
      : new Set(['screen', 'component', 'route', 'codebase'])
  return refs
    .filter((ref) => acceptedKinds.has(ref.kind))
    .map((ref) => ref.id)
    .slice(0, 6)
}

function logoSourceIds(
  brand: ExplainerBrand,
  refs: ExplainerSourceRef[],
): string[] {
  const explicit = nonBlank(brand.logoSourceRefId)
  if (explicit) return [explicit]
  const logo = refs.find((ref) => ref.kind === 'logo')
  return logo ? [logo.id] : []
}

function createBeatEvidence(
  audio: ExplainerAudioAnalysis | undefined,
  duration: number,
): BeatEvidence {
  const downbeatTimes = normalizeTimes(audio?.downbeats, duration)
  const explicitBeats = normalizeTimes(
    [...(audio?.beats ?? []), ...downbeatTimes],
    duration,
  )
  const bpm =
    Number.isFinite(audio?.bpm) &&
    audio?.bpm !== undefined &&
    audio.bpm >= 30 &&
    audio.bpm <= 300
      ? audio.bpm
      : null
  const firstBeatTime =
    Number.isFinite(audio?.firstBeatTime) &&
    audio?.firstBeatTime !== undefined
      ? audio.firstBeatTime
      : explicitBeats[0] ?? (bpm !== null ? 0 : null)
  const generatedBeats =
    explicitBeats.length === 0 && bpm !== null
      ? generateBeatTimes(bpm, firstBeatTime ?? 0, duration)
      : explicitBeats
  return {
    source:
      explicitBeats.length > 0
        ? 'detected'
        : generatedBeats.length > 0
          ? 'tempo'
          : 'none',
    sourceRefId: nonBlank(audio?.sourceRefId),
    audioDurationSeconds: finitePositive(audio?.durationSeconds)
      ? audio.durationSeconds
      : null,
    confidence:
      Number.isFinite(audio?.confidence) && audio?.confidence !== undefined
        ? clamp(audio.confidence, 0, 1)
        : null,
    bpm,
    firstBeatTime,
    beatTimes: generatedBeats,
    downbeatTimes,
    energyPeakTimes: normalizeTimes(audio?.energyPeaks, duration),
  }
}

function normalizeTimes(
  times: readonly number[] | undefined,
  duration: number,
): number[] {
  const unique = new Set<number>()
  for (const time of times ?? []) {
    if (!Number.isFinite(time) || time < 0 || time > duration) continue
    unique.add(roundTime(time))
  }
  return [...unique].sort((a, b) => a - b)
}

function generateBeatTimes(
  bpm: number,
  firstBeatTime: number,
  duration: number,
): number[] {
  const interval = 60 / bpm
  let time = firstBeatTime
  if (!Number.isFinite(time)) time = 0
  while (time < 0) time += interval
  const beats: number[] = []
  for (
    let guard = 0;
    time <= duration + EPSILON && guard < 10_000;
    guard += 1, time += interval
  ) {
    beats.push(roundTime(time))
  }
  return beats
}

function createSceneBoundaries(
  specs: SceneSpec[],
  duration: number,
  beats: BeatEvidence,
): number[] {
  const weights = specs.map((spec) => sceneWeight(spec.kind))
  const weightTotal = weights.reduce((sum, value) => sum + value, 0)
  const boundaries = [0]
  let elapsedWeight = 0

  for (let index = 0; index < specs.length - 1; index += 1) {
    elapsedWeight += weights[index] ?? 0
    const ideal = duration * (elapsedWeight / weightTotal)
    const previous = boundaries[index] ?? 0
    const remainingScenes = specs.length - index - 1
    const min = previous + MIN_SCENE_DURATION
    const max = duration - remainingScenes * MIN_SCENE_DURATION
    const nextKind = specs[index + 1]?.kind
    const preferred =
      nextKind === 'logo' && beats.downbeatTimes.length > 0
        ? beats.downbeatTimes
        : beats.beatTimes
    const snapped = nearestTimeWithin(preferred, ideal, min, max)
    boundaries.push(roundTime(snapped ?? clamp(ideal, min, max)))
  }
  boundaries.push(duration)
  return boundaries
}

function sceneWeight(kind: StoryboardSceneKind): number {
  if (kind === 'text') return 1.7
  if (kind === 'design') return 2.5
  if (kind === 'demo') return 2.8
  return 1.6
}

function createScene(
  spec: SceneSpec,
  order: number,
  startTime: number,
  endTime: number,
  sourceRefs: ExplainerSourceRef[],
  brand: ExplainerBrand,
): StoryboardScene {
  const id = `scene-${pad(order + 1)}-${spec.kind}`
  const base: StoryboardSceneBase = {
    id,
    order,
    kind: spec.kind,
    title: sceneTitle(spec.kind, order),
    purpose: scenePurpose(spec.kind),
    startTime,
    endTime,
    sourceRefIds: [...spec.sourceRefIds],
    transitionInId: null,
    transitionOutId: null,
    cueIds: [],
    cameraCutIds: [],
    layerDirections: [],
    cameraDirections: [],
  }
  if (spec.kind === 'text') {
    const scene: TextStoryboardScene = {
      ...base,
      kind: 'text',
      text: spec.text,
      treatment: order === 0 ? 'headline' : 'statement',
    }
    return scene
  }
  if (spec.kind === 'design') {
    const scene: DesignStoryboardScene = {
      ...base,
      kind: 'design',
      caption: spec.text,
      components: createComponentDirections(id, spec, sourceRefs),
    }
    return scene
  }
  if (spec.kind === 'demo') {
    const scene: DemoStoryboardScene = {
      ...base,
      kind: 'demo',
      caption: spec.text,
      steps: [],
    }
    return scene
  }
  const logoSourceRefId =
    spec.sourceRefIds[0] ??
    nonBlank(brand.logoSourceRefId) ??
    null
  const scene: LogoStoryboardScene = {
    ...base,
    kind: 'logo',
    brandName: brand.name,
    tagline: nonBlank(brand.tagline) ?? nonBlank(spec.text),
    logoSourceRefId,
  }
  return scene
}

function createComponentDirections(
  sceneId: string,
  spec: SceneSpec,
  refs: ExplainerSourceRef[],
): StoryboardComponentDirection[] {
  const refById = new Map(refs.map((ref) => [ref.id, ref]))
  const candidates = spec.sourceRefIds
    .map((id) => refById.get(id))
    .filter(
      (ref): ref is ExplainerSourceRef =>
        ref !== undefined &&
        (ref.kind === 'component' ||
          ref.kind === 'screen' ||
          ref.kind === 'route'),
    )
  if (candidates.length === 0) {
    return [{
      id: `${sceneId}-component-01-generated-focus`,
      name: 'Primary feature surface',
      sourceRefId: null,
      variantStates: ['default', 'focused'],
      focusOrder: 0,
    }]
  }
  return candidates.slice(0, 4).map((ref, index) => ({
    id: `${sceneId}-component-${pad(index + 1)}-${slug(ref.id)}`,
    name: nonBlank(ref.label) ?? nonBlank(ref.component) ?? ref.id,
    sourceRefId: ref.id,
    variantStates: ['default', 'focused', 'active'],
    focusOrder: index,
  }))
}

function addSceneContentCues(
  scene: StoryboardScene,
  spec: SceneSpec,
  addCue: (
    sceneId: string,
    kind: StoryboardCueKind,
    requestedTime: number,
    rangeStart: number,
    rangeEnd: number,
    label: string,
  ) => StoryboardCue,
): void {
  const duration = scene.endTime - scene.startTime
  const insetStart = Math.min(
    scene.endTime,
    scene.startTime + Math.min(0.18, duration * 0.12),
  )
  const insetEnd = Math.max(insetStart, scene.endTime - Math.min(0.18, duration * 0.12))

  if (scene.kind === 'logo') return
  if (scene.kind === 'text') {
    const cue = addCue(
      scene.id,
      'text-reveal',
      scene.startTime + duration * 0.32,
      insetStart,
      insetEnd,
      'Reveal copy',
    )
    scene.cueIds.push(cue.id)
    return
  }
  if (scene.kind === 'design') {
    const cue = addCue(
      scene.id,
      'design-focus',
      scene.startTime + duration * 0.42,
      insetStart,
      insetEnd,
      'Separate and focus component layers',
    )
    scene.cueIds.push(cue.id)
    return
  }

  const actions = demoActions(spec)
  const fractions = actions.length === 3 ? [0.24, 0.55, 0.8] : [0.3, 0.72]
  const steps: StoryboardDemoStep[] = actions.map((action, index) => {
    const cue = addCue(
      scene.id,
      'demo-action',
      scene.startTime + duration * (fractions[index] ?? 0.5),
      insetStart,
      insetEnd,
      action.label,
    )
    scene.cueIds.push(cue.id)
    return {
      id: `${scene.id}-step-${pad(index + 1)}`,
      label: action.label,
      action: action.action,
      targetSourceRefId: scene.sourceRefIds[0] ?? null,
      cueId: cue.id,
    }
  })
  scene.steps = steps
}

function demoActions(
  spec: SceneSpec,
): Array<{
  label: string
  action: StoryboardDemoStep['action']
}> {
  const text = `${spec.text} ${spec.action ?? ''}`.toLocaleLowerCase()
  if (/(form|submit|success|input|field)/.test(text)) {
    return [
      { label: 'Focus the form', action: 'focus' },
      { label: 'Submit the action', action: 'submit' },
      { label: 'Reveal success state', action: 'success' },
    ]
  }
  return [
    { label: 'Focus the control', action: 'focus' },
    { label: 'Activate the feature', action: 'click' },
    { label: 'Reveal the result', action: 'state-change' },
  ]
}

function addSceneCameraProgram(
  scene: StoryboardScene,
  addCameraCut: (
    scene: StoryboardScene,
    cameraRole: StoryboardCameraRole,
    requestedTime: number,
    rangeStart: number,
    rangeEnd: number,
    label: string,
  ) => StoryboardCameraCut,
): void {
  const duration = scene.endTime - scene.startTime
  const primaryRole: StoryboardCameraRole =
    scene.kind === 'text'
      ? 'wide'
      : scene.kind === 'design'
        ? 'detail'
        : scene.kind === 'demo'
          ? 'wide'
          : 'hero'
  addCameraCut(
    scene,
    primaryRole,
    scene.startTime,
    scene.startTime,
    scene.startTime,
    `Switch to ${primaryRole} camera`,
  )

  if (scene.kind !== 'design' && scene.kind !== 'demo') return
  const secondaryRole: StoryboardCameraRole =
    scene.kind === 'design' ? 'hero' : 'action'
  const inset = Math.min(0.2, duration * 0.1)
  addCameraCut(
    scene,
    secondaryRole,
    scene.startTime + duration * 0.62,
    scene.startTime + inset,
    scene.endTime - inset,
    `Switch to ${secondaryRole} camera`,
  )
}

function createCameraDirections(
  scene: StoryboardScene,
  cuts: StoryboardCameraCut[],
): StoryboardCameraDirection[] {
  return cuts.map((cut, index) => {
    const action = cameraAction(scene.kind, cut.cameraRole, index)
    return {
      id: `${scene.id}-camera-direction-${pad(index + 1)}`,
      cameraId: cut.cameraId,
      cameraRole: cut.cameraRole,
      action,
      startTime: cut.time,
      endTime: cuts[index + 1]?.time ?? scene.endTime,
      target: scene.sourceRefIds[0] ?? `${scene.kind}:primary`,
      ...cameraPose(action),
    }
  })
}

function cameraAction(
  kind: StoryboardSceneKind,
  role: StoryboardCameraRole,
  index: number,
): StoryboardCameraAction {
  if (kind === 'text') return 'push-in'
  if (kind === 'logo') return 'pull-out'
  if (kind === 'design') return index === 0 ? 'push-in' : 'orbit'
  return role === 'action' ? 'track' : 'pan'
}

function cameraPose(
  action: StoryboardCameraAction,
): Pick<StoryboardCameraDirection, 'from' | 'to'> {
  if (action === 'push-in') {
    return { from: { zoom: 1 }, to: { zoom: 1.14, focusDepth: 72 } }
  }
  if (action === 'pull-out') {
    return { from: { zoom: 1.12 }, to: { zoom: 1 } }
  }
  if (action === 'orbit') {
    return {
      from: { rotationY: -5, zoom: 1.08 },
      to: { rotationY: 5, zoom: 1.12, focusDepth: 88 },
    }
  }
  if (action === 'track') {
    return { from: { x: -36, zoom: 1.08 }, to: { x: 36, zoom: 1.16 } }
  }
  if (action === 'pan') {
    return { from: { x: -24 }, to: { x: 24, zoom: 1.08 } }
  }
  return {}
}

function createLayerDirections(
  scene: StoryboardScene,
  use3d: boolean,
): StoryboardLayer3DDirection[] {
  if (scene.kind === 'text') return []
  const duration = scene.endTime - scene.startTime
  const settleTime = roundTime(scene.startTime + duration * 0.48)
  if (scene.kind === 'logo') {
    return [
      layerDirection(
        scene,
        0,
        'logo',
        scene.logoSourceRefId,
        use3d ? 72 : 0,
        settleTime,
      ),
    ]
  }
  const roles: StoryboardLayerRole[] =
    scene.kind === 'design'
      ? ['background', 'surface', 'focus']
      : ['surface', 'control', 'success']
  const depths = use3d ? [-64, 0, 88] : [0, 0, 0]
  return roles.map((role, index) =>
    layerDirection(
      scene,
      index,
      role,
      scene.sourceRefIds[index] ?? scene.sourceRefIds[0] ?? null,
      depths[index] ?? 0,
      settleTime,
    ),
  )
}

function layerDirection(
  scene: StoryboardScene,
  index: number,
  role: StoryboardLayerRole,
  sourceRefId: string | null,
  depth: number,
  settleTime: number,
): StoryboardLayer3DDirection {
  const lateral = (index - 1) * 24
  return {
    id: `${scene.id}-layer-${pad(index + 1)}-${role}`,
    target: sourceRefId ?? `${scene.kind}:${role}`,
    sourceRefId,
    role,
    startTime: scene.startTime,
    endTime: settleTime,
    depth,
    from: {
      x: lateral,
      y: 20 + index * 8,
      z: depth - 72,
      rotationX: 5,
      rotationY: lateral / 8,
      opacity: 0,
    },
    to: {
      x: 0,
      y: 0,
      z: depth,
      rotationX: 0,
      rotationY: 0,
      opacity: 1,
    },
  }
}

function createTransitions(
  scenes: StoryboardScene[],
  addCue: (
    sceneId: string,
    kind: StoryboardCueKind,
    requestedTime: number,
    rangeStart: number,
    rangeEnd: number,
    label: string,
  ) => StoryboardCue,
): StoryboardTransition[] {
  const transitions: StoryboardTransition[] = []
  for (let index = 0; index < scenes.length - 1; index += 1) {
    const from = scenes[index]
    const to = scenes[index + 1]
    if (!from || !to) continue
    const boundary = to.startTime
    const duration = roundTime(
      Math.min(0.36, Math.max(0.18, (from.endTime - from.startTime) * 0.12)),
    )
    const cue = addCue(
      to.id,
      'transition',
      boundary,
      boundary,
      boundary,
      `${from.title} to ${to.title}`,
    )
    const transition: StoryboardTransition = {
      id: `transition-${pad(index + 1)}`,
      fromSceneId: from.id,
      toSceneId: to.id,
      kind: transitionKind(from.kind, to.kind),
      startTime: roundTime(boundary - duration),
      endTime: boundary,
      beatSnapped: cue.beatSnapped,
      cueId: cue.id,
    }
    transitions.push(transition)
    from.transitionOutId = transition.id
    to.transitionInId = transition.id
    to.cueIds.push(cue.id)
  }
  return transitions
}

function transitionKind(
  from: StoryboardSceneKind,
  to: StoryboardSceneKind,
): StoryboardTransitionKind {
  if (to === 'logo') return 'match-cut'
  if (from === 'text' && to === 'design') return 'zoom-through'
  if (to === 'demo') return 'push'
  if (from === 'design' && to === 'text') return 'crossfade'
  return 'cut'
}

function directionUses3d(brief: ExplainerBrief): boolean {
  return typeof brief.direction === 'object'
    ? brief.direction.use3dLayers !== false
    : true
}

function sceneTitle(kind: StoryboardSceneKind, order: number): string {
  if (kind === 'text') return order === 0 ? 'Opening statement' : 'Bridge'
  if (kind === 'design') return 'Design reveal'
  if (kind === 'demo') return 'Feature demonstration'
  return 'Brand sign-off'
}

function scenePurpose(kind: StoryboardSceneKind): string {
  if (kind === 'text') return 'Establish one clear narrative idea.'
  if (kind === 'design') {
    return 'Separate the interface into components and reveal its visual hierarchy.'
  }
  if (kind === 'demo') {
    return 'Show the user action, state change, and successful outcome.'
  }
  return 'Resolve the story with a concise logo animation.'
}

function cameraIdForRole(role: StoryboardCameraRole): string {
  return `camera-${role}`
}

function snapWithinRange(
  requestedTime: number,
  beatTimes: number[],
  rangeStart: number,
  rangeEnd: number,
): { time: number; beatIndex: number | null } {
  const candidate = nearestIndexedTimeWithin(
    beatTimes,
    requestedTime,
    rangeStart,
    rangeEnd,
  )
  if (!candidate) {
    return {
      time: roundTime(clamp(requestedTime, rangeStart, rangeEnd)),
      beatIndex: null,
    }
  }
  return {
    time: candidate.time,
    beatIndex: candidate.index,
  }
}

function nearestTimeWithin(
  times: number[],
  requestedTime: number,
  min: number,
  max: number,
): number | null {
  return nearestIndexedTimeWithin(times, requestedTime, min, max)?.time ?? null
}

function nearestIndexedTimeWithin(
  times: number[],
  requestedTime: number,
  min: number,
  max: number,
): { time: number; index: number } | null {
  let best: { time: number; index: number } | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  times.forEach((time, index) => {
    if (time < min - EPSILON || time > max + EPSILON) return
    const distance = Math.abs(time - requestedTime)
    if (
      distance < bestDistance - EPSILON ||
      (Math.abs(distance - bestDistance) <= EPSILON &&
        (best === null || time < best.time))
    ) {
      best = { time, index }
      bestDistance = distance
    }
  })
  return best
}

function compareTimedIds(
  a: { time: number; id: string },
  b: { time: number; id: string },
): number {
  return a.time - b.time || a.id.localeCompare(b.id)
}

function finitePositive(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0
}

function nonBlank(value: string | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function roundTime(value: number): number {
  return Math.round(value * TIME_PRECISION) / TIME_PRECISION
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function slug(value: string): string {
  const normalized = value
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || 'explainer'
}
