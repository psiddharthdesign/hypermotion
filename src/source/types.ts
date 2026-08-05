// SPDX-License-Identifier: Apache-2.0

import type {
  ExplainerScriptBeat,
  ExplainerSourceRef,
  StoryboardDemoStep,
} from '../explainer/types'

/**
 * Hard limits for source captures. Adapters may request lower limits, but never
 * higher ones. Keeping the manifest bounded makes it safe to accept over MCP.
 */
export const SOURCE_CAPTURE_LIMITS = {
  routes: 64,
  screens: 128,
  statesPerScreen: 16,
  domNodes: 5_000,
  domDepth: 32,
  attributesPerNode: 64,
  styles: 5_000,
  components: 1_024,
  interactions: 1_024,
  assets: 512,
  textLength: 20_000,
  valueLength: 4_096,
} as const

export type SourceOriginKind =
  | 'codebase'
  | 'browser'
  | 'design-tool'
  | 'upload'
  | 'mcp'
  | 'manual'

export interface SourceProvenanceInput {
  origin: SourceOriginKind
  /** Stable, non-secret identifier for the provider or repository. */
  sourceId: string
  /** Provider-local locator. Repository paths must remain relative. */
  locator: string
  revision?: string
  capturedAt?: string
  integrity?: string
}

export interface SourceProvenance {
  origin: SourceOriginKind
  sourceId: string
  locator: string
  revision: string | null
  capturedAt: string | null
  integrity: string | null
}

export type SourceFramework =
  | {
      kind: 'nextjs'
      router: 'app' | 'pages' | 'mixed'
      shadcn: boolean
      tailwind: boolean
      typescript: boolean
    }
  | {
      kind: 'web'
      name?: string
      typescript?: boolean
    }
  | {
      kind: 'native'
      name: string
    }
  | {
      kind: 'other'
      name: string
    }

export interface SourceProjectInput {
  id?: string
  name: string
  /** Must be "." or a repository-relative directory. */
  rootPath?: string
  packageName?: string
  framework?: SourceFramework
}

export interface SourceCaptureManifestInput {
  version?: 1
  id?: string
  provenance: SourceProvenanceInput
  project: SourceProjectInput
  routes: readonly SourceRouteInput[]
  assets?: readonly SourceAssetInput[]
}

export interface SourceRouteInput {
  id?: string
  /** URL pathname, for example "/dashboard" or "/settings/[id]". */
  path: string
  label?: string
  sourcePath?: string
  screens: readonly SourceScreenInput[]
}

export interface SourceViewport {
  width: number
  height: number
  deviceScaleFactor?: number
}

export interface SourceScreenInput {
  id?: string
  /** Provider-local key, stable across captures when possible. */
  key?: string
  name: string
  sourcePath?: string
  viewport: SourceViewport
  states: readonly SourceScreenStateInput[]
}

export type SourceInteractionStateKind =
  | 'default'
  | 'loading'
  | 'error'
  | 'success'
  | 'empty'
  | 'disabled'
  | 'custom'

export interface SourceScreenStateInput {
  id?: string
  name: string
  kind: SourceInteractionStateKind
  dom: SourceDomNodeInput
  styles?: readonly SourceStyleSnapshotInput[]
  components?: readonly SourceComponentBoundaryInput[]
  interactions?: readonly SourceInteractionInput[]
}

export interface SourceDomNodeInput {
  /** Unique within one screen state. Used instead of brittle CSS selectors. */
  key: string
  tag: string
  role?: string
  text?: string
  attributes?: Readonly<Record<string, string>>
  classNames?: readonly string[]
  assetKeys?: readonly string[]
  children?: readonly SourceDomNodeInput[]
}

export interface SourceStyleSnapshotInput {
  nodeKey: string
  pseudo?: string
  computed: Readonly<Record<string, string>>
  tokens?: Readonly<Record<string, string>>
}

export interface SourceComponentBoundaryInput {
  key: string
  name: string
  rootNodeKey: string
  /** Same key across screens/states means the boundary is reusable. */
  reuseKey?: string
  sourcePath?: string
  exportName?: string
  variant?: string
  props?: Readonly<Record<string, string | number | boolean | null>>
}

export type SourceInteractionAction =
  | 'focus'
  | 'click'
  | 'type'
  | 'submit'
  | 'navigate'
  | 'wait'
  | 'state-change'

export interface SourceInteractionInput {
  id?: string
  order?: number
  action: SourceInteractionAction
  targetNodeKey: string
  label?: string
  inputHint?: string
  resultingState?: string
}

export type SourceAssetKind =
  | 'image'
  | 'svg'
  | 'icon'
  | 'font'
  | 'video'
  | 'audio'
  | 'logo'

export type SourceAssetLocationInput =
  | {
      kind: 'project-file'
      path: string
    }
  | {
      kind: 'remote'
      url: string
      contentType?: string
    }
  | {
      kind: 'inline'
      mediaType: string
      byteLength: number
      integrity: string
      /** Inline SVG is permitted only after script/event validation. */
      text?: string
    }

export interface SourceAssetInput {
  id?: string
  key: string
  kind: SourceAssetKind
  label?: string
  location: SourceAssetLocationInput
  width?: number
  height?: number
}

export interface SourceManifestLimits {
  routes?: number
  screens?: number
  statesPerScreen?: number
  domNodes?: number
  domDepth?: number
  attributesPerNode?: number
  styles?: number
  components?: number
  interactions?: number
  assets?: number
  textLength?: number
  valueLength?: number
}

export interface NormalizeSourceManifestOptions {
  limits?: SourceManifestLimits
}

export type SourceManifestIssueCode =
  | 'invalid-type'
  | 'required'
  | 'unsupported-version'
  | 'limit-exceeded'
  | 'duplicate-key'
  | 'missing-reference'
  | 'unsafe-path'
  | 'unsafe-url'
  | 'remote-script'
  | 'unsafe-dom'
  | 'unsafe-style'
  | 'invalid-route'
  | 'invalid-state'
  | 'invalid-viewport'
  | 'invalid-provenance'

export interface SourceManifestIssue {
  code: SourceManifestIssueCode
  path: string
  message: string
}

export interface SourceManifestValidationResult {
  ok: boolean
  issues: SourceManifestIssue[]
}

export interface NormalizedSourceManifest {
  version: 1
  id: string
  provenance: SourceProvenance
  project: NormalizedSourceProject
  routes: NormalizedSourceRoute[]
  assets: NormalizedSourceAsset[]
  components: NormalizedSourceComponent[]
  stats: SourceManifestStats
}

export interface NormalizedSourceProject {
  id: string
  name: string
  rootPath: string
  packageName: string | null
  framework: SourceFramework | null
  provenance: SourceProvenance
}

export interface NormalizedSourceRoute {
  id: string
  path: string
  label: string
  sourcePath: string | null
  screens: NormalizedSourceScreen[]
  provenance: SourceProvenance
}

export interface NormalizedSourceScreen {
  id: string
  key: string
  name: string
  sourcePath: string | null
  viewport: Required<SourceViewport>
  states: NormalizedSourceScreenState[]
  provenance: SourceProvenance
}

export interface NormalizedSourceScreenState {
  id: string
  name: string
  kind: SourceInteractionStateKind
  dom: NormalizedSourceDomNode
  styles: NormalizedSourceStyleSnapshot[]
  componentOccurrenceIds: string[]
  interactions: NormalizedSourceInteraction[]
  provenance: SourceProvenance
}

export interface NormalizedSourceDomNode {
  id: string
  key: string
  tag: string
  role: string | null
  text: string | null
  attributes: Record<string, string>
  classNames: string[]
  assetIds: string[]
  children: NormalizedSourceDomNode[]
  provenance: SourceProvenance
}

export interface NormalizedSourceStyleSnapshot {
  id: string
  nodeId: string
  pseudo: string | null
  computed: Record<string, string>
  tokens: Record<string, string>
  provenance: SourceProvenance
}

export interface NormalizedSourceInteraction {
  id: string
  order: number
  action: SourceInteractionAction
  targetNodeId: string
  label: string
  inputHint: string | null
  resultingStateId: string | null
  provenance: SourceProvenance
}

export interface NormalizedSourceComponentOccurrence {
  id: string
  componentId: string
  routeId: string
  screenId: string
  stateId: string
  stateKind: SourceInteractionStateKind
  rootNodeId: string
  boundaryKey: string
  variantName: string
  props: Record<string, string | number | boolean | null>
  signature: string
  provenance: SourceProvenance
}

export interface NormalizedSourceComponentVariant {
  id: string
  name: string
  stateKinds: SourceInteractionStateKind[]
  occurrenceIds: string[]
  signatures: string[]
}

export interface NormalizedSourceComponent {
  id: string
  reuseKey: string
  name: string
  sourcePath: string | null
  exportName: string | null
  reusable: boolean
  occurrences: NormalizedSourceComponentOccurrence[]
  variants: NormalizedSourceComponentVariant[]
  provenance: SourceProvenance
}

export interface NormalizedSourceAsset {
  id: string
  key: string
  kind: SourceAssetKind
  label: string
  location:
    | { kind: 'project-file'; path: string }
    | { kind: 'remote'; url: string; contentType: string | null }
    | {
        kind: 'inline'
        mediaType: string
        byteLength: number
        integrity: string
        text: string | null
      }
  width: number | null
  height: number | null
  provenance: SourceProvenance
}

export interface SourceManifestStats {
  routes: number
  screens: number
  states: number
  domNodes: number
  styles: number
  componentOccurrences: number
  reusableComponents: number
  interactions: number
  assets: number
}

export interface ExplainerDemoGuidance {
  id: string
  title: string
  routeSourceRefId: string
  screenSourceRefId: string
  initialState: SourceInteractionStateKind
  terminalStates: SourceInteractionStateKind[]
  componentSourceRefIds: string[]
  steps: ExplainerDemoGuidanceStep[]
}

export interface ExplainerDemoGuidanceStep {
  id: string
  order: number
  label: string
  action: StoryboardDemoStep['action']
  targetSourceRefId: string
  fromState: SourceInteractionStateKind
  toState: SourceInteractionStateKind | null
  inputHint: string | null
}

export interface ExplainerSourcePackage {
  sourceRefs: ExplainerSourceRef[]
  demoGuidance: ExplainerDemoGuidance[]
  scriptBeats: ExplainerScriptBeat[]
}
