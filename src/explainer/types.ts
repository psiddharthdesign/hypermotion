// SPDX-License-Identifier: Apache-2.0

/**
 * Framework-agnostic inputs and outputs for short feature explainer planning.
 *
 * These types deliberately contain only JSON-compatible values. A future MCP
 * adapter can resolve source references into Hyper Motion nodes without making
 * this compiler depend on React, Electron, Yjs, or the renderer.
 */

export type StoryboardSceneKind = 'text' | 'design' | 'demo' | 'logo'

export interface ExplainerBrief {
  id?: string
  title?: string
  /** Desired finished duration. The default compiler constrains this to 10–15s. */
  targetDurationSeconds?: number
  direction?: string | ExplainerDirection
  script?: string | ExplainerScript
  brand?: ExplainerBrand
  sourceRefs?: readonly ExplainerSourceRef[]
  audioAnalysis?: ExplainerAudioAnalysis
}

export interface ExplainerDirection {
  summary: string
  tone?: 'minimal' | 'playful' | 'cinematic' | 'technical' | 'bold'
  pacing?: 'calm' | 'balanced' | 'fast'
  sceneOrder?: readonly Exclude<StoryboardSceneKind, 'logo'>[]
  use3dLayers?: boolean
  cameraStyle?: 'subtle' | 'dynamic' | 'cinematic'
}

export interface ExplainerScript {
  hook?: string
  beats?: readonly ExplainerScriptBeat[]
  close?: string
}

export interface ExplainerScriptBeat {
  id?: string
  text: string
  sceneType?: StoryboardSceneKind
  sourceRefIds?: readonly string[]
  action?: string
}

export interface ExplainerBrand {
  name: string
  tagline?: string
  logoSourceRefId?: string
  primaryColor?: string
  accentColor?: string
  backgroundColor?: string
  fontFamily?: string
}

export type ExplainerSourceKind =
  | 'codebase'
  | 'route'
  | 'screen'
  | 'component'
  | 'asset'
  | 'logo'
  | 'audio'
  | 'other'

export interface ExplainerSourceRef {
  id: string
  kind: ExplainerSourceKind
  label?: string
  uri?: string
  route?: string
  component?: string
  metadata?: Readonly<Record<string, string | number | boolean | null>>
}

export interface ExplainerAudioAnalysis {
  sourceRefId?: string
  durationSeconds?: number
  bpm?: number
  /** First detected or authored beat in source-local seconds. */
  firstBeatTime?: number
  /** Source-local beat times. */
  beats?: readonly number[]
  /** Source-local downbeat times, when the analyzer can distinguish them. */
  downbeats?: readonly number[]
  /** Optional high-energy moments that are useful for logo or interaction hits. */
  energyPeaks?: readonly number[]
  confidence?: number
}

export interface CompileStoryboardOptions {
  durationSeconds?: number
  minDurationSeconds?: number
  maxDurationSeconds?: number
  frameRate?: number
  canvas?: {
    width: number
    height: number
  }
}

export interface ExplainerStoryboard {
  version: 1
  id: string
  briefId: string | null
  title: string
  durationSeconds: number
  frameRate: number
  canvas: {
    width: number
    height: number
  }
  brand: ExplainerBrand
  sourceRefs: ExplainerSourceRef[]
  scenes: StoryboardScene[]
  transitions: StoryboardTransition[]
  beatPlan: StoryboardBeatPlan
  /** Snapshot of validation issues at compile time. Re-validation is always safe. */
  qc: StoryboardQcIssue[]
}

export interface StoryboardSceneBase {
  id: string
  order: number
  kind: StoryboardSceneKind
  title: string
  purpose: string
  startTime: number
  endTime: number
  sourceRefIds: string[]
  transitionInId: string | null
  transitionOutId: string | null
  cueIds: string[]
  cameraCutIds: string[]
  layerDirections: StoryboardLayer3DDirection[]
  cameraDirections: StoryboardCameraDirection[]
}

export interface TextStoryboardScene extends StoryboardSceneBase {
  kind: 'text'
  text: string
  treatment: 'headline' | 'statement' | 'caption'
}

export interface DesignStoryboardScene extends StoryboardSceneBase {
  kind: 'design'
  caption: string
  components: StoryboardComponentDirection[]
}

export interface DemoStoryboardScene extends StoryboardSceneBase {
  kind: 'demo'
  caption: string
  steps: StoryboardDemoStep[]
}

export interface LogoStoryboardScene extends StoryboardSceneBase {
  kind: 'logo'
  brandName: string
  tagline: string | null
  logoSourceRefId: string | null
}

export type StoryboardScene =
  | TextStoryboardScene
  | DesignStoryboardScene
  | DemoStoryboardScene
  | LogoStoryboardScene

export interface StoryboardComponentDirection {
  id: string
  name: string
  sourceRefId: string | null
  variantStates: string[]
  focusOrder: number
}

export interface StoryboardDemoStep {
  id: string
  label: string
  action: 'focus' | 'click' | 'type' | 'submit' | 'state-change' | 'success'
  targetSourceRefId: string | null
  cueId: string
}

export type StoryboardTransitionKind =
  | 'cut'
  | 'crossfade'
  | 'push'
  | 'zoom-through'
  | 'match-cut'

export interface StoryboardTransition {
  id: string
  fromSceneId: string
  toSceneId: string
  kind: StoryboardTransitionKind
  startTime: number
  endTime: number
  beatSnapped: boolean
  cueId: string
}

export type StoryboardCueKind =
  | 'scene-start'
  | 'text-reveal'
  | 'design-focus'
  | 'demo-action'
  | 'camera-cut'
  | 'transition'
  | 'logo-hit'

export interface StoryboardCue {
  id: string
  sceneId: string
  kind: StoryboardCueKind
  time: number
  requestedTime: number
  beatSnapped: boolean
  beatIndex: number | null
  label: string
}

export interface StoryboardBeatPlan {
  source: 'detected' | 'tempo' | 'none'
  sourceRefId: string | null
  audioDurationSeconds: number | null
  confidence: number | null
  bpm: number | null
  firstBeatTime: number | null
  beatTimes: number[]
  downbeatTimes: number[]
  energyPeakTimes: number[]
  cues: StoryboardCue[]
  cameraCuts: StoryboardCameraCut[]
}

export type StoryboardCameraRole = 'wide' | 'detail' | 'action' | 'hero'

export interface StoryboardCameraCut {
  id: string
  sceneId: string
  cameraId: string
  cameraRole: StoryboardCameraRole
  time: number
  cueId: string
  beatSnapped: boolean
}

export type StoryboardCameraAction =
  | 'hold'
  | 'push-in'
  | 'pull-out'
  | 'pan'
  | 'orbit'
  | 'track'
  | 'rack-focus'

export interface StoryboardCameraPose {
  x?: number
  y?: number
  z?: number
  rotationX?: number
  rotationY?: number
  zoom?: number
  focusDepth?: number
}

export interface StoryboardCameraDirection {
  id: string
  cameraId: string
  cameraRole: StoryboardCameraRole
  action: StoryboardCameraAction
  startTime: number
  endTime: number
  target: string
  from?: StoryboardCameraPose
  to?: StoryboardCameraPose
}

export type StoryboardLayerRole =
  | 'background'
  | 'surface'
  | 'control'
  | 'focus'
  | 'success'
  | 'logo'

export interface StoryboardLayer3DDirection {
  id: string
  target: string
  sourceRefId: string | null
  role: StoryboardLayerRole
  startTime: number
  endTime: number
  depth: number
  from: {
    x: number
    y: number
    z: number
    rotationX: number
    rotationY: number
    opacity: number
  }
  to: {
    x: number
    y: number
    z: number
    rotationX: number
    rotationY: number
    opacity: number
  }
}

export type StoryboardQcSeverity = 'error' | 'warning'

export type StoryboardQcCode =
  | 'invalid-duration'
  | 'invalid-frame-rate'
  | 'duplicate-id'
  | 'no-scenes'
  | 'invalid-scene-order'
  | 'invalid-scene-range'
  | 'scene-gap'
  | 'scene-overlap'
  | 'missing-final-logo'
  | 'logo-not-final'
  | 'invalid-transition'
  | 'invalid-cue'
  | 'invalid-camera-cut'
  | 'invalid-camera-direction'
  | 'invalid-layer-direction'
  | 'missing-source-ref'
  | 'missing-design-source'
  | 'missing-logo-source'
  | 'audio-analysis-unavailable'
  | 'beat-snap-mismatch'

export interface StoryboardQcIssue {
  code: StoryboardQcCode
  severity: StoryboardQcSeverity
  message: string
  path: string
  sceneId?: string
}

export interface StoryboardValidationResult {
  ok: boolean
  issues: StoryboardQcIssue[]
  errors: StoryboardQcIssue[]
  warnings: StoryboardQcIssue[]
}

export interface StoryboardValidationOptions {
  minDurationSeconds?: number
  maxDurationSeconds?: number
  timeTolerance?: number
}
