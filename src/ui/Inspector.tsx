// SPDX-License-Identifier: Apache-2.0

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  Activity,
  AlertTriangle,
  Check,
  RefreshCw,
} from 'lucide-react'
import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from 'motion/react'
import { AppIcon, type AppIconName } from '@/ui/AppIcon'
import { useProjectAPI, type ProjectAPI } from '@/project'
import { useUI } from '@/state/ui'
import {
  MAX_CAMERA_SCROLL_SENSITIVITY,
  MIN_CAMERA_SCROLL_SENSITIVITY,
  MAX_LAYER_BLUR_PX,
  clampLayerBlurAmount,
  effectBlurPropertyId,
  effectStableId,
  normalizeCameraScrollSensitivity,
  normalizeEllipseArc,
  useSceneAPI,
  useSceneVersion,
} from '@/scene'
import type {
  Appearance,
  BlendMode,
  CameraNode,
  ComponentPropertyDefinition,
  CornerRadii,
  Effect,
  FlexAlign,
  FlexDirection,
  FlexJustify,
  FrameNode,
  ImageNode,
  Layout,
  LayoutGuide,
  LayoutMode,
  Node,
  NodeId,
  Position,
  Size,
  Stroke,
  TextNode,
  Transform,
  Interaction,
  InteractionEventKind,
  VariantTransition,
} from '@/scene'
import { isImageFile } from '@/ui/importImage'
import {
  captureVideoPoster,
  decodeAudioMeta,
  decodeVideoMeta,
  isAudioFile,
  isVideoFile,
  normalizeVideoFileForBrowser,
  readMediaFileAsDataUrl,
  VIDEO_PLAYBACK_PROXY_WARNING,
} from '@/ui/importMedia'
import { getLastSolvedLayout } from '@/ui/hooks/lastSolvedLayout'
import { transformForAbsolutePosition } from '@/ui/positionMode'
import { pivotPreservingTransformPatch } from '@/ui/pivotTransform'
import { useAnimatedValues } from '@/ui/hooks/useAnimatedValues'
import {
  cameraPreviewStore,
  cameraTransformPreview,
} from '@/ui/cameraPreviewStore'
import { nodeGeometryPreviewStore } from '@/ui/nodeGeometryPreviewStore'
import {
  nodeLayoutPreviewStore,
  type NodeLayoutPreview,
} from '@/ui/nodeLayoutPreviewStore'
import { nodeTransformPreviewStore } from '@/ui/nodeTransformPreviewStore'
import {
  resetCameraTransformGroup,
  type CameraTransformResetGroup,
} from '@/ui/cameraReset'
import type { SceneAPI } from '@/scene/doc'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import {
  CheckboxField,
  ColorField,
  FieldRow,
  FillField,
  KeyframeButton,
  KeyframeSliderRow,
  MultiKeyframeButton,
  NumberField,
  ScalePairField,
  SelectField,
  SizeAxisField,
  SquircleSurface,
  StrokeWidthField,
  TextField,
  TimeField,
} from '@/ui/fields'
import {
  formatNumericDisplayValue,
  formatNumericValue,
  parseNumericExpression,
  stabilizeNumericValue,
} from '@/ui/fields/numericExpression'
import { PresetsPanel } from '@/ui/PresetsPanel'
import { PaperShaderInspector } from '@/ui/PaperShaderInspector'
import { AlignTools } from '@/ui/AlignTools'
import { EasingPicker } from '@/ui/EasingPicker'
import { currentAnimationAuthorTime } from '@/ui/animationPlayhead'
import {
  applyRenderModeToSelection,
  RENDER_MODE_OPTIONS,
  renderModeEligibleNodes,
  type RenderMode,
} from '@/ui/multiRenderMode'
import type { AnimatedValue, EasingPresetId } from '@/anim'
import {
  defaultLayerMotionPath,
  MAX_LAYER_MOTION_PATH_POINTS,
  normalizeLayerMotionPath,
  type LayerMotionPath,
} from '@/anim/layerMotionPath'
import {
  addComponentVariantInteraction,
  applyComponentVariantState,
  applyInstanceVariantTransition,
  ensureComponentStateAxis,
  exposeComponentProperty,
  fitComponentToChildren,
  removeComponentProperty,
  removeComponentInteraction,
  removeComponentVariant,
  resetInstanceComponentProperty,
  setComponentSourceProperty,
  setInstanceComponentProperty,
  setLockedRecursive,
  updateComponentInteraction,
  updateComponentPropertyDefinition,
  upsertComponentVariant,
  wrapInAutoLayout,
} from '@/ui/actions'
import {
  analyzeBeatPcm,
  beatAnchorAfterTrimChange,
  recurringBeatAtOrAfter,
  type AudioBeatGrid,
  type NoteDivision,
  type TempoCandidate,
} from '@/audio/beatSync'
import { loadAudioBuffer } from '@/audio/audioBuffer'
import { TextMotionPathEditor } from '@/ui/TextMotionPathEditor'
import { isCursorInstance } from '@/scene/builtins/cursorComponent'
import {
  addKeyframe,
  findKeyframeAt,
  findTrack,
  getAnimEngine,
  recordKeyframesForPatch,
  removeTrack,
  stampToActiveTracksForPatch,
  toggleKeyframe,
} from '@/anim'
import {
  staggerLayerOffset,
  stampStaggerSetPatch,
} from '@/anim/staggerSets'
import {
  GOOGLE_FONTS,
  isGoogleFont,
  loadGoogleFont,
  type GoogleFontSpec,
} from '@/ui/fonts/googleFonts'
import {
  bytesToCustomFont,
  FONT_FILE_EXTENSIONS,
  libraryAdd,
  libraryGetAll,
  pickFontFiles,
  probeFontFile,
  subscribeLibrary,
  type CustomFont,
} from '@/fonts'

const BLEND_MODE_OPTIONS: Array<{ value: BlendMode; label: string }> = [
  { value: 'normal', label: 'Normal' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'screen', label: 'Screen' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'darken', label: 'Darken' },
  { value: 'lighten', label: 'Lighten' },
  { value: 'color-dodge', label: 'Color Dodge' },
  { value: 'color-burn', label: 'Color Burn' },
  { value: 'hard-light', label: 'Hard Light' },
  { value: 'soft-light', label: 'Soft Light' },
  { value: 'difference', label: 'Difference' },
  { value: 'exclusion', label: 'Exclusion' },
  { value: 'hue', label: 'Hue' },
  { value: 'saturation', label: 'Saturation' },
  { value: 'color', label: 'Color' },
  { value: 'luminosity', label: 'Luminosity' },
]

const PADDING_PROPERTY_IDS = {
  top: 'layout.padding.top',
  right: 'layout.padding.right',
  bottom: 'layout.padding.bottom',
  left: 'layout.padding.left',
} as const

// Padding and gap are spatial adjustments with a useful everyday scrub range,
// but they are not data-model capped at 256px. KeyframeSliderRow keeps this
// display domain separate from the numeric field's validation constraints.
const SPACING_SLIDER_MIN = 0
const SPACING_SLIDER_MAX = 256

// Position and rotation stay numerically unbounded, but still need a stable,
// predictable scrub surface. These soft domains only map pointer travel; the
// adjacent numeric fields continue to accept values outside the track.
const POSITION_SLIDER_MIN = -1000
const POSITION_SLIDER_MAX = 1000
const ROTATION_SLIDER_MIN = -180
const ROTATION_SLIDER_MAX = 180

/**
 * Right sidebar: two modes.
 *
 *   Properties — edit whatever is selected (or the scene itself if nothing
 *                is). This is the Figma-style inspector.
 *   Animate    — Jitter-style preset picker (Fade In, Slide Up, Pop, etc).
 *                Writes real keyframes onto the selected node at the
 *                current playhead.
 *
 * The mode toggle is tab-style at the top and lives in UI state so it
 * persists while the user clicks around the canvas. Defaulting to
 * Properties keeps first impressions identical to a Figma inspector;
 * designers who want Jitter-mode flip the toggle once and stay there.
 *
 * Scene-mode (nothing selected or root selected) surfaces meta, canvas
 * size, root background, and root auto-layout — the things Jitter
 * exposes as "Scene" controls.
 */
export function Inspector() {
  useSceneVersion()
  const api = useSceneAPI()
  const project = useProjectAPI()
  const selection = useUI((s) => s.selection)
  const mode = useUI((s) => s.inspectorMode)
  const rootId = api.getRoot()
  const width = useUI((s) => s.inspectorWidth)
  const setWidth = useUI((s) => s.setInspectorWidth)

  // Compute which variant of the inspector to render.
  const showScene =
    selection.length === 0 || (selection.length === 1 && selection[0] === rootId)
  const singleNode =
    selection.length === 1 ? api.getNode(selection[0]!) : null
  const multiNodes =
    selection.length > 1
      ? (selection
          .map((id) => api.getNode(id))
          .filter((n): n is Node => !!n) as Node[])
      : null
  const activeScene = project.getActiveScene()
  const context = showScene
    ? {
        name: activeScene?.name || api.getMeta().name || 'Untitled',
        type: 'Scene',
        icon: 'frame' as AppIconName,
      }
    : multiNodes && multiNodes.length > 1
      ? {
          name: `${multiNodes.length} layers selected`,
          type: 'Multiple selection',
          icon: 'layers' as AppIconName,
        }
      : singleNode
        ? {
            name: singleNode.name || humanizeNodeKind(singleNode.kind),
            type: humanizeNodeKind(singleNode.kind),
            icon: inspectorIconForNode(singleNode),
          }
        : {
            name: 'Nothing selected',
            type: 'Selection',
            icon: 'nodes' as AppIconName,
          }
  const shouldReduceMotion = useReducedMotion()

  // Drag the LEFT edge to resize. Mirrors LayersPanel's right-edge
  // handle. Pointer math is inverted (dragging left grows width).
  const onResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    const startX = e.clientX
    const startWidth = width
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const onMove = (ev: PointerEvent) => {
      setWidth(startWidth - (ev.clientX - startX))
    }
    const onUp = (ev: PointerEvent) => {
      try {
        ;(e.currentTarget as HTMLElement).releasePointerCapture(ev.pointerId)
      } catch {
        /* already released */
      }
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  return (
    <aside
      data-inspector-root="1"
      aria-label="Inspector"
      className="relative flex shrink-0 flex-col border-l border-border bg-panel"
      style={{ width }}
    >
      <div
        onPointerDown={onResizeDown}
        title="Drag to resize"
        className="absolute left-0 top-0 z-10 h-full w-1 -translate-x-1/2 cursor-col-resize hover:bg-accent/50"
      />
      <div className="shrink-0 border-b border-border bg-panel p-4">
        <ModeTabs />
        <InspectorContext {...context} />
      </div>
      <div
        data-inspector-scroll="1"
        className="flex-1 overflow-y-auto overflow-x-hidden py-4 pl-4 pr-2 text-[12px]"
      >
        <div
          data-timeline-properties-slot
          data-timeline-selection-surface="1"
          className={
            mode === 'properties'
              ? 'mb-4 space-y-4 empty:hidden'
              : 'hidden'
          }
        />
        <AnimatePresence initial={false} mode="popLayout">
          <motion.div
            key={mode}
            id={`inspector-${mode}-panel`}
            role="tabpanel"
            aria-labelledby={`inspector-${mode}-tab`}
            className="min-h-full"
            initial={{ opacity: 0 }}
            animate={{
              opacity: 1,
              transition: {
                duration: shouldReduceMotion ? 0 : 0.12,
                ease: [0.23, 1, 0.32, 1],
              },
            }}
            exit={{
              opacity: 0,
              transition: {
                duration: shouldReduceMotion ? 0 : 0.07,
                ease: [0.23, 1, 0.32, 1],
              },
            }}
          >
            {mode === 'animate' ? (
              <PresetsPanel />
            ) : showScene ? (
              <SceneDetails api={api} project={project} />
            ) : multiNodes && multiNodes.length > 1 ? (
              <MultiNodeDetails nodes={multiNodes} api={api} />
            ) : singleNode ? (
              <NodeDetails node={singleNode} api={api} />
            ) : null}
          </motion.div>
        </AnimatePresence>
      </div>
    </aside>
  )
}

// ---------------------------------------------------------------------------
// Mode links
// ---------------------------------------------------------------------------

function ModeTabs() {
  const mode = useUI((s) => s.inspectorMode)
  const setMode = useUI((s) => s.setInspectorMode)
  const modes = ['properties', 'animate'] as const

  const moveFocus = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    current: (typeof modes)[number],
  ) => {
    const currentIndex = modes.indexOf(current)
    let nextIndex = currentIndex
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % modes.length
    else if (event.key === 'ArrowLeft')
      nextIndex = (currentIndex - 1 + modes.length) % modes.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = modes.length - 1
    else return
    event.preventDefault()
    document.getElementById(`inspector-${modes[nextIndex]}-tab`)?.focus()
  }

  return (
    <SquircleSurface
      radius={6}
      role="tablist"
      aria-label="Inspector mode"
      data-timeline-selection-surface="1"
      className="hm-control-surface hm-inspector-segmented"
    >
        {modes.map((m) => {
          const active = mode === m
          return (
            <button
              key={m}
              id={`inspector-${m}-tab`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`inspector-${m}-panel`}
              tabIndex={active ? 0 : -1}
              onClick={() => setMode(m)}
              onKeyDown={(event) => moveFocus(event, m)}
              data-active={active}
              className="hm-inspector-segment focus-visible:outline-none"
            >
              {m === 'properties' ? 'Properties' : 'Animate'}
            </button>
          )
        })}
    </SquircleSurface>
  )
}

function InspectorContext({
  name,
  type,
  icon,
}: {
  name: string
  type: string
  icon: AppIconName
}) {
  return (
    <div className="mt-3 flex min-w-0 items-center gap-2.5 px-1">
      <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-panel-raised text-text-muted shadow-[var(--shadow-control)]">
        <AppIcon name={icon} size={15} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-semibold text-text" title={name}>
          {name}
        </div>
        <div className="truncate text-[11px] text-text-dim" title={type}>
          {type}
        </div>
      </div>
    </div>
  )
}

function humanizeNodeKind(kind: Node['kind']): string {
  return kind
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function formatInspectorSizeAxis(value: Size['width']): string {
  if (typeof value === 'number') return `${Number(value.toFixed(2))} px`
  return value === 'hug' ? 'Hug' : 'Fill'
}

function inspectorIconForNode(node: Node): AppIconName {
  switch (node.kind) {
    case 'camera':
      return 'camera'
    case 'text':
      return 'text'
    case 'image':
      return 'image'
    case 'video':
      return 'video'
    case 'audio':
      return 'audio'
    case 'ellipse':
      return 'circle'
    case 'rect':
      return 'square'
    case 'vector':
      return 'vector'
    case 'shader':
      return 'sparkle'
    case 'frame':
    case 'component':
    case 'instance':
      return 'frame'
    default:
      return 'nodes'
  }
}

function InspectorDisclosure({
  storageKey,
  title,
  children,
  defaultOpen = false,
}: {
  storageKey: string
  title: string
  children: ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(() => {
    if (typeof window === 'undefined') return defaultOpen
    try {
      const stored = window.localStorage.getItem(
        `hyper-motion.inspector.disclosure.${storageKey}`,
      )
      return stored == null ? defaultOpen : stored === '1'
    } catch {
      return defaultOpen
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(
        `hyper-motion.inspector.disclosure.${storageKey}`,
        open ? '1' : '0',
      )
    } catch {
      // Local persistence is a convenience; private contexts can reject it.
    }
  }, [open, storageKey])

  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="group mt-1"
    >
      <summary className="flex h-7 cursor-pointer list-none select-none items-center rounded-md px-1 text-[12px] font-medium text-text-muted transition-colors duration-150 ease-[var(--ease-ui-out)] hover:bg-app-bg hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45">
        <svg
          viewBox="0 0 12 12"
          aria-hidden="true"
          className="mr-1 h-2.5 w-2.5 shrink-0 transition-transform duration-150 ease-[var(--ease-ui-out)] group-open:rotate-90"
        >
          <path
            d="m4.5 2.5 3.5 3.5-3.5 3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span>{title}</span>
      </summary>
      <div className="space-y-1.5 pt-1.5">{children}</div>
    </details>
  )
}

// ---------------------------------------------------------------------------
// Scene mode (nothing or root selected)
// ---------------------------------------------------------------------------

/**
 * Scene-mode inspector.
 *
 * The Scene is the artboard — a fixed-size document surface. It's NOT a
 * transformable frame: no position, no rotation, no scale. But the
 * artboard CAN have a layout mode (None / Flex / Grid) which determines
 * how its direct children — the top-level layers — are arranged. This
 * mirrors Figma's "page" surface where auto-layout can be toggled on
 * the frame itself.
 *
 * What's still off-limits for Scene:
 *   - Transform (position, rotation, scale)  — the artboard is fixed.
 *   - Corner radius                          — the artboard isn't a shape.
 *   - Clipping                               — always on (conceptually).
 *   - Size via "Size" section                — driven by Canvas Width / Height.
 */
function SceneDetails({ api, project }: { api: SceneAPI; project: ProjectAPI }) {
  const meta = api.getMeta()
  const activeScene = project.getActiveScene()
  const selectedSequenceItemId = useUI(
    (state) => state.selectedSequenceItemId,
  )
  const sequenceItems = project.getSequenceItems()
  const activeSequenceItem =
    sequenceItems.find((item) => item.id === selectedSequenceItemId) ??
    sequenceItems.find((item) => item.sceneId === activeScene?.id)
  const activeTransition = activeSequenceItem?.transitionOut ?? {
    kind: 'cut' as const,
    duration: 0,
  }
  const rootId = api.getRoot()
  const root = rootId ? api.getNode(rootId) : null
  const playing = useUI((state) => state.playing)
  const rootAnimationIds = useMemo(
    () => (!playing && rootId ? [rootId] : []),
    [playing, rootId],
  )
  const rootAnimated = useAnimatedValues(rootAnimationIds)
  const rootAnim = rootId
    ? playing
      ? getAnimEngine().getSnapshot()[rootId]
      : rootAnimated[rootId]
    : undefined
  const liveRootFill =
    rootAnim?.fill !== undefined
      ? ({ kind: 'solid', color: rootAnim.fill } as const)
      : root?.appearance.fill ?? null
  const liveRootCorner =
    rootAnim?.cornerRadius ?? root?.appearance.cornerRadius ?? 0

  const commitRootFill = (fill: Appearance['fill']) => {
    if (!root || root.kind !== 'frame') return
    const current = api.getNode(root.id)
    if (!current || current.kind !== 'frame') return
    const authorTime = currentAnimationAuthorTime()
    api.doc.transact(() => {
      api.setNodeProperty(root.id, 'appearance', {
        ...current.appearance,
        fill,
      })
      if (useUI.getState().recording) {
        recordKeyframesForPatch(api, root.id, authorTime, 'appearance', {
          fill,
        })
      } else {
        stampToActiveTracksForPatch(
          api,
          root.id,
          authorTime,
          'appearance',
          { fill },
        )
      }
    }, UNDOABLE_GESTURE_ORIGIN)
  }

  const commitRootCorner = (cornerRadius: number) => {
    if (!root || root.kind !== 'frame') return
    const current = api.getNode(root.id)
    if (!current || current.kind !== 'frame') return
    const next = Math.max(0, cornerRadius)
    const authorTime = currentAnimationAuthorTime()
    api.doc.transact(() => {
      api.setNodeProperty(root.id, 'appearance', {
        ...current.appearance,
        cornerRadius: next,
      })
      if (useUI.getState().recording) {
        recordKeyframesForPatch(api, root.id, authorTime, 'appearance', {
          cornerRadius: next,
        })
      } else {
        stampToActiveTracksForPatch(
          api,
          root.id,
          authorTime,
          'appearance',
          { cornerRadius: next },
        )
      }
    }, UNDOABLE_GESTURE_ORIGIN)
  }

  // Canvas dimensions and the root frame's size are the same thing:
  // "how big is the artboard." Keep them in lockstep so the Yoga solve
  // for the Scene uses the full artboard and children actually follow
  // its flex / grid rules.
  const setCanvasSize = (width: number, height: number) => {
    const safeW = Math.max(1, Math.round(width))
    const safeH = Math.max(1, Math.round(height))
    api.setMeta({ canvas: { width: safeW, height: safeH } })
    if (root && 'size' in root) {
      api.setNodeProperty(root.id, 'size', { width: safeW, height: safeH })
    }
  }
  return (
    <div className="space-y-4">
      <Section title="Scene">
        <FieldRow label="Name">
          <TextField
            value={activeScene?.name ?? meta.name}
            onCommit={(n) => {
              if (activeScene) project.updateScene(activeScene.id, { name: n })
              else api.setMeta({ name: n })
              // Keep the layers-panel label in sync. The root node's
              // name is what LayersPanel renders; without this they
              // drift (Inspector shows the new name, Layers still shows
              // the old one).
              if (root) api.setNodeProperty(root.id, 'name', n)
            }}
            allowEmpty={false}
          />
        </FieldRow>
        <KeyframeSliderRow
          label="Width"
          value={meta.canvas.width}
          onCommit={(v) => setCanvasSize(v, meta.canvas.height)}
          min={1}
          adaptiveSpan={1920}
          step={1}
          suffix="px"
        />
        <KeyframeSliderRow
          label="Height"
          value={meta.canvas.height}
          onCommit={(v) => setCanvasSize(meta.canvas.width, v)}
          min={1}
          adaptiveSpan={1080}
          step={1}
          suffix="px"
        />
        <KeyframeSliderRow
          label="Duration"
          value={activeScene?.duration ?? meta.duration}
          onCommit={(v) => {
            const duration = Math.max(0.1, v)
            if (activeScene) {
              project.updateScene(activeScene.id, { duration })
            } else {
              api.setMeta({ duration })
            }
          }}
          min={0.1}
          adaptiveSpan={20}
          step={0.1}
          suffix="s"
        />
        <KeyframeSliderRow
          label="Frame rate"
          value={meta.frameRate}
          onCommit={(v) =>
            api.setMeta({ frameRate: Math.max(1, Math.round(v)) })
          }
          min={1}
          max={240}
          step={1}
          suffix="FPS"
        />
      </Section>

      {activeSequenceItem ? (
        <Section title="Sequence">
          <FieldRow label="Transition">
            <SelectField<'cut' | 'crossfade'>
              value={activeTransition.kind}
              options={[
                { value: 'cut', label: 'Cut' },
                { value: 'crossfade', label: 'Crossfade' },
              ]}
              onCommit={(kind) =>
                project.setTransition(activeSequenceItem.id, {
                  kind,
                  duration: kind === 'crossfade' ? 0.35 : 0,
                })
              }
              width="w-full"
            />
          </FieldRow>
          {activeTransition.kind === 'crossfade' ? (
            <FieldRow label="Blend duration">
              <TimeField
                value={activeTransition.duration}
                onCommit={(duration) =>
                  project.setTransition(activeSequenceItem.id, {
                    kind: 'crossfade',
                    duration,
                  })
                }
                min={0}
                max={activeScene?.duration ?? meta.duration}
                step={0.05}
                ariaLabel="Crossfade duration"
              />
            </FieldRow>
          ) : null}
        </Section>
      ) : null}

      {root && root.kind === 'frame' ? (
        <>
          <Section title="Background">
            <FillField
              value={liveRootFill}
              onCommit={commitRootFill}
              keyframe={
                <KeyframeButton
                  nodeId={root.id}
                  propertyId="appearance.fill"
                  currentValue={
                    liveRootFill?.kind === 'solid'
                      ? liveRootFill.color
                      : null
                  }
                />
              }
            />
            <div aria-hidden="true" className="border-t border-border" />
            <StrokeControls
              value={root.appearance.stroke}
              onCommit={(stroke) =>
                api.setNodeProperty(root.id, 'appearance', {
                  ...root.appearance,
                  stroke,
                })
              }
            />
            {root.appearance.cornerRadii ? (
              <FieldRow
                label="Corner"
                keyframe={
                  <KeyframeButton
                    nodeId={root.id}
                    propertyId="appearance.cornerRadius"
                    currentValue={null}
                  />
                }
              >
                <CornerField
                  uniformValue={liveRootCorner}
                  cornerRadii={root.appearance.cornerRadii}
                  onCommitUniform={commitRootCorner}
                  onPromoteToPerCorner={(initial) =>
                    api.setNodeProperty(root.id, 'appearance', {
                      ...root.appearance,
                      cornerRadii: initial,
                    })
                  }
                  onCommitPerCorner={(next) =>
                    api.setNodeProperty(root.id, 'appearance', {
                      ...root.appearance,
                      cornerRadii: next,
                    })
                  }
                  onClearPerCorner={() =>
                    api.setNodeProperty(root.id, 'appearance', {
                      ...root.appearance,
                      cornerRadii: undefined,
                    })
                  }
                />
              </FieldRow>
            ) : (
              <KeyframeSliderRow
                label="Corner"
                value={liveRootCorner}
                onCommit={commitRootCorner}
                onScrubPreview={(value) =>
                  nodeTransformPreviewStore.preview({
                    [root.id]: { cornerRadius: Math.max(0, value) },
                  })
                }
                onScrubCommit={(value) => {
                  commitRootCorner(value)
                  nodeTransformPreviewStore.finish()
                }}
                onScrubCancel={() => nodeTransformPreviewStore.clear()}
                min={0}
                adaptiveSpan={100}
                step={1}
                suffix="px"
                labelAccessory={
                  <CornerLinkButton
                    linked={true}
                    onToggle={() =>
                      api.setNodeProperty(root.id, 'appearance', {
                        ...root.appearance,
                        cornerRadii: {
                          tl: liveRootCorner,
                          tr: liveRootCorner,
                          br: liveRootCorner,
                          bl: liveRootCorner,
                        },
                      })
                    }
                  />
                }
                keyframe={
                  <KeyframeButton
                    nodeId={root.id}
                    propertyId="appearance.cornerRadius"
                    currentValue={liveRootCorner}
                  />
                }
              />
            )}
            <SectionToggleRow
              label="Clip"
              value={root.clipsContent}
              plain
              onCommit={(v) => api.setNodeProperty(root.id, 'clipsContent', v)}
            />
          </Section>

          <LayoutSection
            nodeId={root.id}
            layout={root.layout}
            onPatch={(patch) => {
              api.setNodeProperty(root.id, 'layout', {
                ...root.layout,
                ...patch,
              })
              const authorTime = currentAnimationAuthorTime()
              if (useUI.getState().recording) {
                recordKeyframesForPatch(
                  api,
                  root.id,
                  authorTime,
                  'layout',
                  patch,
                )
              } else {
                stampToActiveTracksForPatch(
                  api,
                  root.id,
                  authorTime,
                  'layout',
                  patch,
                )
              }
              // Scene root never gets renamed — its label is the scene
              // name (meta.name), not a mode-derived default. A user who
              // named their scene "Landing hero" expects that name to
              // persist across mode switches. No-op; intentional.
            }}
          />
        </>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Multi-select multi-edit.
// ---------------------------------------------------------------------------

/**
 * Inspector view when 2+ nodes are selected.
 *
 * Mirrors NodeDetails section-for-section, but every field shows the
 * *shared* value across the selection. If all selected nodes agree on a
 * value we render it straight; if they disagree we mark the field
 * "mixed" and seed it with the first node's value so the user has a
 * starting point. Committing a field fans out `setNodeProperty` to
 * every selected node — Y.UndoManager's captureTimeout groups the
 * fan-out into a single undo step.
 *
 * Sections are hidden when they don't apply to the whole selection:
 *   - Size requires every selected node to carry `size`.
 *   - Layout requires every selected node to carry `layout`
 *     (frames/components/instances).
 *   - The Clip toggle appears only when every selected node is a frame.
 */
function MultiNodeDetails({ nodes, api }: { nodes: Node[]; api: SceneAPI }) {
  const setSelection = useUI((s) => s.setSelection)
  const selection = useUI((s) => s.selection)
  const recording = useUI((s) => s.recording)
  const staggerOn = useUI((s) => s.staggerOn)
  const staggerDelay = useUI((s) => s.staggerDelay)
  const activeStaggerSetId = useUI((s) => s.activeStaggerSetId)
  const staggerDraftLayerIds = useUI((s) => s.staggerDraftLayerIds)
  const activeStaggerSet = activeStaggerSetId
    ? api.getUiState().staggerSets[activeStaggerSetId]
    : undefined
  const count = nodes.length
  const staggerActive =
    staggerOn && activeStaggerSetId !== null && nodes.length > 1
  const staggerOptions = activeStaggerSetId
    ? {
        setId: activeStaggerSetId,
        layerIds:
          activeStaggerSet?.layerIds ??
          (staggerDraftLayerIds.length > 1
            ? staggerDraftLayerIds
            : nodes.map((node) => node.id)),
        delay: activeStaggerSet?.delay ?? staggerDelay,
        order: activeStaggerSet?.order ?? ('forward' as const),
      }
    : null

  // Capability gates — skip whole sections that don't fit every node.
  const allHaveSize = nodes.every((n) => 'size' in n)
  const allHaveLayout = nodes.every((n) => 'layout' in n)
  const allFrames = nodes.every((n) => n.kind === 'frame')
  const renderModeNodes = renderModeEligibleNodes(nodes)

  // Per-group patchers. Each writes to every selected node that has
  // that group, preserving the node's other fields in the same group.
  // When `recording` is on, every patched key also stamps a keyframe at
  // the current playhead — we stamp *after* `setNodeProperty` so the
  // value written to the track matches what the scene now holds.
  // Two-step stamp policy:
  //   1. If recording is on, stamp keyframes for every animatable key
  //      in the patch — even properties without an existing track. This
  //      mirrors AE's stopwatch (record mode creates new tracks).
  //   2. Otherwise, only stamp keys that ALREADY have a track. Without
  //      this, the static-value update is invisibly stomped by the
  //      track at the current playhead under REPLACE semantics.
  // recording=on already covers active tracks (it stamps everything),
  // so the two paths never overlap.
  const stampPatchAll = (
    group: 'transform' | 'appearance' | 'size' | 'layout',
    patch: Record<string, unknown>,
  ) => {
    const authorTime = currentAnimationAuthorTime()
    if (staggerActive && staggerOptions) {
      const trackIds = stampStaggerSetPatch(
        api,
        authorTime,
        group,
        patch,
        recording ? 'record' : 'active-track',
        staggerOptions,
      )
      if (trackIds.length > 0) {
        useUI.getState().setSelectedTrackIds(trackIds)
      }
      return
    }
    for (const node of nodes) {
      if (recording) {
        recordKeyframesForPatch(api, node.id, authorTime, group, patch)
      } else {
        stampToActiveTracksForPatch(api, node.id, authorTime, group, patch)
      }
    }
  }
  const patchTransformAll = (patch: Partial<Transform>) => {
    api.doc.transact(() => {
      for (const n of nodes) {
        api.setNodeProperty(n.id, 'transform', { ...n.transform, ...patch })
      }
      stampPatchAll('transform', patch)
    }, UNDOABLE_GESTURE_ORIGIN)
  }
  const patchAppearanceAll = (patch: Partial<Appearance>) => {
    api.doc.transact(() => {
      for (const n of nodes) {
        api.setNodeProperty(n.id, 'appearance', { ...n.appearance, ...patch })
      }
      stampPatchAll('appearance', patch)
    }, UNDOABLE_GESTURE_ORIGIN)
  }
  const previewVisualAll = (patch: AnimatedValue) => {
    const previews: Record<NodeId, AnimatedValue> = {}
    for (const current of nodes) previews[current.id] = patch
    nodeTransformPreviewStore.preview(previews)
  }
  const commitTransformScrubAll = (patch: Partial<Transform>) => {
    patchTransformAll(patch)
    nodeTransformPreviewStore.finish()
  }
  const commitAppearanceScrubAll = (patch: Partial<Appearance>) => {
    patchAppearanceAll(patch)
    nodeTransformPreviewStore.finish()
  }
  const cancelVisualPreview = () => nodeTransformPreviewStore.clear()
  const patchSizeAll = (patch: Partial<Size>) => {
    api.doc.transact(() => {
      for (const n of nodes) {
        if ('size' in n) {
          api.setNodeProperty(n.id, 'size', { ...n.size, ...patch })
          if (
            n.kind === 'component' &&
            (patch.width === 'hug' || patch.height === 'hug')
          ) {
            fitComponentToChildren(api, n.id, { preserveHug: true })
          }
        }
      }
      stampPatchAll('size', patch)
    }, UNDOABLE_GESTURE_ORIGIN)
  }
  const previewSizeAll = (patch: Partial<Size>) => {
    nodeGeometryPreviewStore.preview(
      Object.fromEntries(
        nodes.flatMap((current) =>
          'size' in current
            ? [[current.id, { size: patch }] as const]
            : [],
        ),
      ),
    )
  }
  const commitSizeScrubAll = (patch: Partial<Size>) => {
    patchSizeAll(patch)
    nodeGeometryPreviewStore.finish()
  }
  const cancelGeometryPreview = () => nodeGeometryPreviewStore.clear()
  const patchLayoutAll = (patch: Partial<Layout>) => {
    const DEFAULT_FRAME_NAMES = new Set(['Auto layout', 'Grid', 'Frame'])
    api.doc.transact(() => {
      for (const n of nodes) {
        if (!('layout' in n)) continue
        api.setNodeProperty(n.id, 'layout', { ...n.layout, ...patch })
        // Rename default-named frames when mode changes — same logic
        // as single-node NodeDetails so a multi-select mode switch
        // doesn't leave half the layer panel saying "Auto layout"
        // for grids.
        if (patch.mode && patch.mode !== n.layout.mode) {
          if (DEFAULT_FRAME_NAMES.has(n.name)) {
            const nextName =
              patch.mode === 'flex'
                ? 'Auto layout'
                : patch.mode === 'grid'
                  ? 'Grid'
                  : 'Frame'
            if (nextName !== n.name) {
              api.setNodeProperty(n.id, 'name', nextName)
            }
          }
          // Auto-layout mode means "the parent owns child placement."
          // When a free-canvas frame flips to Stack/Grid, direct children
          // often still carry absolute positioning and stale x/y offsets
          // from dragging/import/duplicate. If we preserve those, Stack
          // appears broken: Yoga lays out the children, then the renderer
          // shifts them back to their old free positions. Normalize direct
          // children into flow on the mode switch so the user gets the
          // expected "arrange these items" behavior.
          const isAutoLayout = patch.mode === 'flex' || patch.mode === 'grid'
          if (isAutoLayout) {
            for (const child of api.getChildren(n.id)) {
              if (child.position !== 'flow') {
                api.setNodeProperty(child.id, 'position', 'flow')
              }
              if (child.transform.x !== 0 || child.transform.y !== 0) {
                api.setNodeProperty(child.id, 'transform', {
                  ...child.transform,
                  x: 0,
                  y: 0,
                })
              }
            }
          }
        }
      }
      stampPatchAll('layout', patch)
    })
  }

  // Shared values across the selection — `mixed` means they disagree.
  const cVisible = common(nodes, (n) => n.visible)
  const cLocked = common(nodes, (n) => n.locked)

  const cX = common(nodes, (n) => n.transform.x)
  const cY = common(nodes, (n) => n.transform.y)
  const cZ = common(nodes, (n) => n.transform.z)
  const cRot = common(nodes, (n) => n.transform.rotation)
  const cRotX = common(nodes, (n) => n.transform.rotationX)
  const cRotY = common(nodes, (n) => n.transform.rotationY)
  const cSX = common(nodes, (n) => n.transform.scaleX)
  const cSY = common(nodes, (n) => n.transform.scaleY)
  const cSpace = common(nodes, (n) => n.transform.space ?? 'local')
  const cRenderMode =
    renderModeNodes.length > 0
      ? common(renderModeNodes, (n) => n.transform.renderMode ?? 'flat')
      : null

  const cW = allHaveSize
    ? common(nodes, (n) => ('size' in n ? n.size.width : 0))
    : null
  const cH = allHaveSize
    ? common(nodes, (n) => ('size' in n ? n.size.height : 0))
    : null

  const cOpacity = common(nodes, (n) => n.appearance.opacity)
  const cBlendMode = common(
    nodes,
    (n) => n.appearance.blendMode ?? 'normal',
  )
  // Fill reads the full Fill shape — solid, linear, or radial. common()
  // does structural JSON equality so two nodes with the same gradient
  // stops + angle still resolve to a non-mixed value.
  const cFill = common(nodes, (n) => n.appearance.fill)
  const cStroke = common(nodes, (n) => n.appearance.stroke)
  const cCorner = common(nodes, (n) => n.appearance.cornerRadius)
  const cClip = allFrames
    ? common(nodes, (n) => (n.kind === 'frame' ? n.clipsContent : false))
    : null

  const cLayout = allHaveLayout
    ? {
        mode: common(nodes, (n) => ('layout' in n ? n.layout.mode : 'none')),
        direction: common(nodes, (n) =>
          'layout' in n ? n.layout.direction : 'row',
        ),
        justify: common(nodes, (n) =>
          'layout' in n ? n.layout.justify : 'start',
        ),
        align: common(nodes, (n) => ('layout' in n ? n.layout.align : 'start')),
        gap: common(nodes, (n) => ('layout' in n ? n.layout.gap : 0)),
        wrap: common(nodes, (n) => ('layout' in n ? n.layout.wrap : false)),
        columns: common(nodes, (n) => ('layout' in n ? n.layout.columns : 1)),
        rowGap: common(nodes, (n) => ('layout' in n ? n.layout.rowGap : 0)),
        columnGap: common(nodes, (n) =>
          'layout' in n ? n.layout.columnGap : 0,
        ),
        padding: common(nodes, (n) =>
          'layout' in n
            ? n.layout.padding
            : { top: 0, right: 0, bottom: 0, left: 0 },
        ),
      }
    : null

  return (
    <div className="space-y-4">
      <div className="rounded border border-border bg-panel-raised px-3 py-2 text-text-muted">
        <div className="text-[12px]">{count} layers selected</div>
        <div className="mt-0.5 text-[10px] text-text-dim">
          Edits apply to every selected layer. Fields showing{' '}
          <span className="font-medium text-text-muted">mixed</span> have
          differing values.
        </div>
        <div className="mt-1 text-[10px] text-text-dim">
          Press S to arm Stagger. Each diamond adds that property across all
          selected layers to the same stagger set.
        </div>
      </div>

      <Section title="Node">
        <FieldRow label="Visible">
          <MixedCell mixed={cVisible.mixed}>
            <CheckboxField
              value={cVisible.value}
              onCommit={(v) => {
                for (const n of nodes)
                  api.setNodeProperty(n.id, 'visible', v)
              }}
            />
          </MixedCell>
        </FieldRow>
        <FieldRow label="Locked">
          <MixedCell mixed={cLocked.mixed}>
            <CheckboxField
              value={cLocked.value}
              onCommit={(v) => {
                // Cascade to descendants for each selected subtree — same
                // rationale as the Layers panel toggle: a lock on a
                // container implies its children are locked too.
                for (const n of nodes) setLockedRecursive(api, n.id, v)
              }}
            />
          </MixedCell>
        </FieldRow>
      </Section>

      <Section title="Transform">
        {/* Align tools span the full width of the section as a top
            band, Framer-style. Greys out automatically when the
            selection sits inside a stack (parent has flex / grid
            layout) — alignment via transform would just visually
            shift the node out of its solved Yoga position. */}
          <AlignTools api={api} selection={selection} />
        {cRenderMode ? (
          <FieldRow label="Render mode">
            <MixedCell mixed={cRenderMode.mixed}>
              <SelectField<RenderMode>
                value={cRenderMode.value}
                options={RENDER_MODE_OPTIONS}
                onCommit={(renderMode) =>
                  applyRenderModeToSelection(api, nodes, renderMode)
                }
                width="w-full"
              />
            </MixedCell>
          </FieldRow>
        ) : null}
        <FieldRow label="3D space">
          <MixedCell mixed={cSpace.mixed}>
            <SelectField<NonNullable<Transform['space']>>
              value={cSpace.value}
              options={[
                { value: 'local', label: 'Local plane' },
                { value: 'world', label: 'World' },
              ]}
              onCommit={(space) => patchTransformAll({ space })}
              width="w-full"
            />
          </MixedCell>
        </FieldRow>
        <ScalePairField
          scaleX={cSX.value}
          scaleY={cSY.value}
          mixedX={cSX.mixed}
          mixedY={cSY.mixed}
          onCommitX={(v) => patchTransformAll({ scaleX: v })}
          onCommitY={(v) => patchTransformAll({ scaleY: v })}
          onCommitPair={({ scaleX, scaleY }) =>
            patchTransformAll({ scaleX, scaleY })
          }
          onScrubPreviewPair={({ scaleX, scaleY }) =>
            previewVisualAll({ scaleX, scaleY })
          }
          onScrubCommitPair={({ scaleX, scaleY }) =>
            commitTransformScrubAll({ scaleX, scaleY })
          }
          onScrubCancel={cancelVisualPreview}
          keyframeX={
            <MultiKeyframeButton
              targets={nodes.map((node) => ({
                nodeId: node.id,
                currentValue: node.transform.scaleX,
              }))}
              propertyId="transform.scaleX"
            />
          }
          keyframeY={
            <MultiKeyframeButton
              targets={nodes.map((node) => ({
                nodeId: node.id,
                currentValue: node.transform.scaleY,
              }))}
              propertyId="transform.scaleY"
            />
          }
        />
      </Section>

      <Section title="Position">
        <KeyframeSliderRow
          label="Position X"
          value={cX.value}
          onCommit={(v) => patchTransformAll({ x: v })}
          onScrubPreview={(v) => previewVisualAll({ x: v })}
          onScrubCommit={(v) => commitTransformScrubAll({ x: v })}
          onScrubCancel={cancelVisualPreview}
          sliderMin={POSITION_SLIDER_MIN}
          sliderMax={POSITION_SLIDER_MAX}
          step={1}
          mixed={cX.mixed}
          keyframe={
            <MultiKeyframeButton
              targets={nodes.map((node) => ({
                nodeId: node.id,
                currentValue: node.transform.x,
              }))}
              propertyId="transform.x"
            />
          }
        />
        <KeyframeSliderRow
          label="Position Y"
          value={cY.value}
          onCommit={(v) => patchTransformAll({ y: v })}
          onScrubPreview={(v) => previewVisualAll({ y: v })}
          onScrubCommit={(v) => commitTransformScrubAll({ y: v })}
          onScrubCancel={cancelVisualPreview}
          sliderMin={POSITION_SLIDER_MIN}
          sliderMax={POSITION_SLIDER_MAX}
          step={1}
          mixed={cY.mixed}
          keyframe={
            <MultiKeyframeButton
              targets={nodes.map((node) => ({
                nodeId: node.id,
                currentValue: node.transform.y,
              }))}
              propertyId="transform.y"
            />
          }
        />
        <KeyframeSliderRow
          label="Position Z"
          value={cZ.value}
          onCommit={(v) => patchTransformAll({ z: v })}
          onScrubPreview={(v) => previewVisualAll({ z: v })}
          onScrubCommit={(v) => commitTransformScrubAll({ z: v })}
          onScrubCancel={cancelVisualPreview}
          sliderMin={POSITION_SLIDER_MIN}
          sliderMax={POSITION_SLIDER_MAX}
          step={1}
          mixed={cZ.mixed}
          keyframe={
            <MultiKeyframeButton
              targets={nodes.map((node) => ({
                nodeId: node.id,
                currentValue: node.transform.z,
              }))}
              propertyId="transform.z"
            />
          }
        />
      </Section>

      <Section title="Rotation">
        <KeyframeSliderRow
          label="Rotate X"
          value={cRotX.value}
          onCommit={(v) => patchTransformAll({ rotationX: v })}
          onScrubPreview={(v) => previewVisualAll({ rotationX: v })}
          onScrubCommit={(v) =>
            commitTransformScrubAll({ rotationX: v })
          }
          onScrubCancel={cancelVisualPreview}
          sliderMin={ROTATION_SLIDER_MIN}
          sliderMax={ROTATION_SLIDER_MAX}
          step={1}
          suffix="°"
          mixed={cRotX.mixed}
          keyframe={
            <MultiKeyframeButton
              targets={nodes.map((node) => ({
                nodeId: node.id,
                currentValue: node.transform.rotationX,
              }))}
              propertyId="transform.rotationX"
            />
          }
        />
        <KeyframeSliderRow
          label="Rotate Y"
          value={cRotY.value}
          onCommit={(v) => patchTransformAll({ rotationY: v })}
          onScrubPreview={(v) => previewVisualAll({ rotationY: v })}
          onScrubCommit={(v) =>
            commitTransformScrubAll({ rotationY: v })
          }
          onScrubCancel={cancelVisualPreview}
          sliderMin={ROTATION_SLIDER_MIN}
          sliderMax={ROTATION_SLIDER_MAX}
          step={1}
          suffix="°"
          mixed={cRotY.mixed}
          keyframe={
            <MultiKeyframeButton
              targets={nodes.map((node) => ({
                nodeId: node.id,
                currentValue: node.transform.rotationY,
              }))}
              propertyId="transform.rotationY"
            />
          }
        />
        <KeyframeSliderRow
          label="Rotate Z"
          value={cRot.value}
          onCommit={(v) => patchTransformAll({ rotation: v })}
          onScrubPreview={(v) => previewVisualAll({ rotation: v })}
          onScrubCommit={(v) =>
            commitTransformScrubAll({ rotation: v })
          }
          onScrubCancel={cancelVisualPreview}
          sliderMin={ROTATION_SLIDER_MIN}
          sliderMax={ROTATION_SLIDER_MAX}
          step={1}
          suffix="°"
          mixed={cRot.mixed}
          keyframe={
            <MultiKeyframeButton
              targets={nodes.map((node) => ({
                nodeId: node.id,
                currentValue: node.transform.rotation,
              }))}
              propertyId="transform.rotation"
            />
          }
        />
      </Section>

      {cW && cH ? (
        <Section title="Size">
          <FieldRow
            label="Width"
            keyframe={
              <MultiKeyframeButton
                targets={nodes.flatMap((node) =>
                  'size' in node && typeof node.size.width === 'number'
                    ? [{ nodeId: node.id, currentValue: node.size.width }]
                    : [],
                )}
                propertyId="size.width"
              />
            }
          >
            {/* Don't wrap SizeAxisField in MixedCell — the badge used
             * to steal width from the Fixed/Hug/Fill pills on mixed
             * selections, forcing users to first pick Hug before Fill
             * became reachable. The field now owns its own mixed
             * indicator and the pills stay at full width. */}
            <SizeAxisField
              value={cW.value}
              mixed={cW.mixed}
              onCommit={(w) => patchSizeAll({ width: w })}
              onScrubPreview={(width) => previewSizeAll({ width })}
              onScrubCommit={(width) => commitSizeScrubAll({ width })}
              onScrubCancel={cancelGeometryPreview}
            />
          </FieldRow>
          <FieldRow
            label="Height"
            keyframe={
              <MultiKeyframeButton
                targets={nodes.flatMap((node) =>
                  'size' in node && typeof node.size.height === 'number'
                    ? [{ nodeId: node.id, currentValue: node.size.height }]
                    : [],
                )}
                propertyId="size.height"
              />
            }
          >
            <SizeAxisField
              value={cH.value}
              mixed={cH.mixed}
              onCommit={(h) => patchSizeAll({ height: h })}
              onScrubPreview={(height) => previewSizeAll({ height })}
              onScrubCommit={(height) => commitSizeScrubAll({ height })}
              onScrubCancel={cancelGeometryPreview}
            />
          </FieldRow>
        </Section>
      ) : null}

      {cLayout && allHaveLayout ? (
        <MultiLayoutSection
          common={cLayout}
          onPatch={patchLayoutAll}
          nodes={nodes}
        />
      ) : null}

      <Section title="Appearance">
        <KeyframeSliderRow
          label="Opacity"
          value={cOpacity.value * 100}
          onCommit={(v) => patchAppearanceAll({ opacity: v / 100 })}
          onScrubPreview={(v) => previewVisualAll({ opacity: v / 100 })}
          onScrubCommit={(v) =>
            commitAppearanceScrubAll({ opacity: v / 100 })
          }
          onScrubCancel={cancelVisualPreview}
          min={0}
          max={100}
          step={1}
          suffix="%"
          mixed={cOpacity.mixed}
          keyframe={
            <MultiKeyframeButton
              targets={nodes.map((node) => ({
                nodeId: node.id,
                currentValue: node.appearance.opacity,
              }))}
              propertyId="appearance.opacity"
            />
          }
        />
        <FieldRow
          label="Blend"
          keyframe={
            <MultiKeyframeButton
              targets={nodes.map((node) => ({
                nodeId: node.id,
                currentValue: node.appearance.blendMode ?? 'normal',
              }))}
              propertyId="appearance.blendMode"
            />
          }
        >
          <MixedCell mixed={cBlendMode.mixed}>
            <SelectField<BlendMode>
              value={cBlendMode.value}
              options={BLEND_MODE_OPTIONS}
              onCommit={(blendMode) => patchAppearanceAll({ blendMode })}
              width="w-full"
            />
          </MixedCell>
        </FieldRow>
        {/* Fill editor. When every selected node has the same fill
            (including gradients, via structural equality on common()),
            we show the full editor so the user can edit stops / angle
            / center directly. On Mixed we still render the editor rather
            than hiding behind "Mixed" — editing propagates to every
            selected node through patchAppearanceAll, matching the
            "keep Fill visible" rule from the solo multi-select fix. */}
        <FillField
          value={cFill.value ?? null}
          mixed={cFill.mixed}
          onCommit={(fill) => patchAppearanceAll({ fill })}
          keyframe={
            <MultiKeyframeButton
              targets={nodes.flatMap((node) =>
                node.appearance.fill?.kind === 'solid'
                  ? [
                      {
                        nodeId: node.id,
                        currentValue: node.appearance.fill.color,
                      },
                    ]
                  : [],
              )}
              propertyId="appearance.fill"
            />
          }
        />
        <div aria-hidden="true" className="border-t border-border" />
        <FieldRow label="Stroke">
          <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
            <MixedCell mixed={cStroke.mixed}>
              <ColorField
                value={cStroke.value?.color ?? null}
                onCommit={(c) => {
                  if (c === null) patchAppearanceAll({ stroke: null })
                  else
                    patchAppearanceAll({
                      stroke: { ...(cStroke.value ?? STROKE_DEFAULT), color: c },
                    })
                }}
              />
            </MixedCell>
            {cStroke.value ? (
              <button
                type="button"
                onClick={() => patchAppearanceAll({ stroke: null })}
                title="Remove stroke"
                aria-label="Remove stroke"
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-dim hover:bg-panel-raised hover:text-text"
              >
                ×
              </button>
            ) : null}
          </div>
        </FieldRow>
        {!cStroke.mixed && cStroke.value ? (
          <>
            <StrokeWidthField
              value={cStroke.value}
              onCommit={(next) => patchAppearanceAll({ stroke: next })}
            />
            <FieldRow label="Align">
              <SelectField<Stroke['align']>
                value={cStroke.value.align}
                options={
                  [
                    { value: 'inside', label: 'Inside' },
                    { value: 'center', label: 'Center' },
                    { value: 'outside', label: 'Outside' },
                  ] as const
                }
                onCommit={(a) =>
                  patchAppearanceAll({
                    stroke: { ...cStroke.value!, align: a },
                  })
                }
                width="w-full"
              />
            </FieldRow>
          </>
        ) : null}
        <KeyframeSliderRow
          label="Corner"
          value={cCorner.value}
          onCommit={(v) =>
            patchAppearanceAll({ cornerRadius: Math.max(0, v) })
          }
          onScrubPreview={(v) =>
            previewVisualAll({ cornerRadius: Math.max(0, v) })
          }
          onScrubCommit={(v) =>
            commitAppearanceScrubAll({ cornerRadius: Math.max(0, v) })
          }
          onScrubCancel={cancelVisualPreview}
          min={0}
          adaptiveSpan={100}
          step={1}
          suffix="px"
          mixed={cCorner.mixed}
          keyframe={
            <MultiKeyframeButton
              targets={nodes.map((node) => ({
                nodeId: node.id,
                currentValue: node.appearance.cornerRadius,
              }))}
              propertyId="appearance.cornerRadius"
            />
          }
        />
        {cClip ? (
          <SectionToggleRow
            label="Clip"
            value={cClip.value}
            mixed={cClip.mixed}
            plain
            onCommit={(v) => {
              for (const n of nodes) {
                if (n.kind === 'frame') {
                  api.setNodeProperty(n.id, 'clipsContent', v)
                }
              }
            }}
          />
        ) : null}
      </Section>

      <button
        type="button"
        onClick={() => {
          const id = wrapInAutoLayout(api, selection)
          if (id) setSelection([id])
        }}
        className="w-full rounded border border-border bg-panel-raised px-3 py-2 text-left text-[12px] text-text transition-colors hover:border-accent/50 hover:bg-accent-soft/40"
      >
        <div className="flex items-center justify-between">
          <span>Wrap in auto layout</span>
          <kbd className="font-mono text-[10px] text-text-dim">⇧A</kbd>
        </div>
        <div className="mt-0.5 text-[10px] text-text-dim">
          Wraps these into a frame that lays them out side-by-side.
        </div>
      </button>
    </div>
  )
}

/**
 * Layout section for the multi-select case. Hides or surfaces the same
 * sub-fields as the single-node LayoutSection, but wraps every input in
 * a MixedCell so disagreement is visible at a glance.
 *
 * We don't reuse the single-node LayoutSection because its patcher is
 * over one node's layout, and the mixed indicators wouldn't fit without
 * restructuring that function. The duplication is small and the
 * explicit shape makes it easier to audit which fields support multi.
 */
function MultiLayoutSection({
  common: c,
  onPatch,
  nodes,
}: {
  common: {
    mode: Common<LayoutMode>
    direction: Common<FlexDirection>
    justify: Common<FlexJustify>
    align: Common<FlexAlign>
    gap: Common<number>
    wrap: Common<boolean>
    columns: Common<number>
    rowGap: Common<number>
    columnGap: Common<number>
    padding: Common<{ top: number; right: number; bottom: number; left: number }>
  }
  onPatch: (patch: Partial<Layout>) => void
  nodes: Node[]
}) {
  const previewAll = (patch: NodeLayoutPreview) => {
    nodeLayoutPreviewStore.preview(
      Object.fromEntries(
        nodes
          .filter((node) => 'layout' in node)
          .map((node) => [node.id, patch]),
      ),
    )
  }
  const commitPreviewAll = (patch: Partial<Layout>) => {
    onPatch(patch)
    nodeLayoutPreviewStore.finish()
  }

  return (
    <Section title="Layout">
      <FieldRow label="Mode">
        <MixedCell mixed={c.mode.mixed}>
          <LayoutModeControl
            value={c.mode.value}
            onCommit={(m) => onPatch({ mode: m })}
          />
        </MixedCell>
      </FieldRow>
      {c.mode.value === 'flex' && !c.mode.mixed ? (
        <>
          <FieldRow
            label="Direction"
            keyframe={
              <MultiKeyframeButton
                targets={nodes.flatMap((node) =>
                  'layout' in node
                    ? [
                        {
                          nodeId: node.id,
                          currentValue: node.layout.direction,
                        },
                      ]
                    : [],
                )}
                propertyId="layout.direction"
              />
            }
          >
            <MixedCell mixed={c.direction.mixed}>
              <IconSegmented<FlexDirection>
                value={c.direction.value}
                options={[
                  { id: 'row', icon: <DirectionRowIcon />, title: 'Horizontal' },
                  {
                    id: 'column',
                    icon: <DirectionColumnIcon />,
                    title: 'Vertical',
                  },
                ]}
                onChange={(d) => onPatch({ direction: d })}
              />
            </MixedCell>
          </FieldRow>
          <FieldRow label="Distribute">
            <MixedCell mixed={c.justify.mixed}>
              <SelectField<FlexJustify>
                value={c.justify.value}
                options={
                  ['start', 'center', 'end', 'space-between', 'space-around'] as const
                }
                onCommit={(j) => onPatch({ justify: j })}
              />
            </MixedCell>
          </FieldRow>
          <FieldRow label="Align">
            <MixedCell mixed={c.align.mixed}>
              <IconSegmented<FlexAlign>
                value={c.align.value}
                options={
                  c.direction.value === 'row'
                    ? ([
                        { id: 'start', icon: <AlignTopIcon />, title: 'Top' },
                        { id: 'center', icon: <AlignMidYIcon />, title: 'Middle' },
                        { id: 'end', icon: <AlignBottomIcon />, title: 'Bottom' },
                        {
                          id: 'stretch',
                          icon: <AlignStretchIcon />,
                          title: 'Stretch',
                        },
                      ] as const)
                    : ([
                        { id: 'start', icon: <AlignLeftIcon />, title: 'Left' },
                        { id: 'center', icon: <AlignMidXIcon />, title: 'Center' },
                        { id: 'end', icon: <AlignRightIcon />, title: 'Right' },
                        {
                          id: 'stretch',
                          icon: <AlignStretchIcon />,
                          title: 'Stretch',
                        },
                      ] as const)
                }
                onChange={(a) => onPatch({ align: a })}
              />
            </MixedCell>
          </FieldRow>
          <FieldRow label="Wrap">
            <MixedCell mixed={c.wrap.mixed}>
              <LabeledSegmented<'true' | 'false'>
                value={c.wrap.value ? 'true' : 'false'}
                options={[
                  { id: 'true', label: 'Yes' },
                  { id: 'false', label: 'No' },
                ]}
                onChange={(value) => onPatch({ wrap: value === 'true' })}
              />
            </MixedCell>
          </FieldRow>
          <KeyframeSliderRow
            label="Gap"
            value={c.gap.value}
            onCommit={(v) => onPatch({ gap: Math.max(0, v) })}
            onScrubPreview={(v) => previewAll({ gap: Math.max(0, v) })}
            onScrubCommit={(v) =>
              commitPreviewAll({ gap: Math.max(0, v) })
            }
            onScrubCancel={() => nodeLayoutPreviewStore.clear()}
            min={0}
            sliderMin={SPACING_SLIDER_MIN}
            sliderMax={SPACING_SLIDER_MAX}
            step={1}
            suffix="px"
            mixed={c.gap.mixed}
            keyframe={
              <MultiKeyframeButton
                targets={nodes.flatMap((node) =>
                  'layout' in node
                    ? [{ nodeId: node.id, currentValue: node.layout.gap }]
                    : [],
                )}
                propertyId="layout.gap"
              />
            }
          />
        </>
      ) : c.mode.value === 'grid' && !c.mode.mixed ? (
        <>
          <FieldRow label="Columns">
            <MixedCell mixed={c.columns.mixed}>
              <NumberField
                value={c.columns.value}
                onCommit={(v) =>
                  onPatch({ columns: Math.max(1, Math.round(v)) })
                }
                onScrubPreview={(v) =>
                  previewAll({ columns: Math.max(1, Math.round(v)) })
                }
                onScrubCommit={(v) =>
                  commitPreviewAll({ columns: Math.max(1, Math.round(v)) })
                }
                onScrubCancel={() => nodeLayoutPreviewStore.clear()}
                min={1}
                step={1}
              />
            </MixedCell>
          </FieldRow>
          <FieldRow label="Gap">
            <div className="grid w-full min-w-0 grid-cols-2 gap-1.5">
              <MixedCell mixed={c.rowGap.mixed}>
                <NumberField
                  value={c.rowGap.value}
                  onCommit={(v) => onPatch({ rowGap: Math.max(0, v) })}
                  onScrubPreview={(v) =>
                    previewAll({ rowGap: Math.max(0, v) })
                  }
                  onScrubCommit={(v) =>
                    commitPreviewAll({ rowGap: Math.max(0, v) })
                  }
                  onScrubCancel={() => nodeLayoutPreviewStore.clear()}
                  min={0}
                  prefix="R"
                  suffix="px"
                  ariaLabel="Row gap"
                  width="w-full"
                />
              </MixedCell>
              <MixedCell mixed={c.columnGap.mixed}>
                <NumberField
                  value={c.columnGap.value}
                  onCommit={(v) => onPatch({ columnGap: Math.max(0, v) })}
                  onScrubPreview={(v) =>
                    previewAll({ columnGap: Math.max(0, v) })
                  }
                  onScrubCommit={(v) =>
                    commitPreviewAll({ columnGap: Math.max(0, v) })
                  }
                  onScrubCancel={() => nodeLayoutPreviewStore.clear()}
                  min={0}
                  prefix="C"
                  suffix="px"
                  ariaLabel="Column gap"
                  width="w-full"
                />
              </MixedCell>
            </div>
          </FieldRow>
          <FieldRow label="Align">
            <MixedCell mixed={c.align.mixed}>
              <SelectField<FlexAlign>
                value={c.align.value}
                options={['start', 'center', 'end', 'stretch'] as const}
                onCommit={(a) => onPatch({ align: a })}
              />
            </MixedCell>
          </FieldRow>
        </>
      ) : null}
      {/* Free-positioned children use their transforms directly. Preserve
          stored padding while the mode is None, but do not expose a control
          that has no predictable effect on that mode. */}
      {!c.mode.mixed && c.mode.value !== 'none' ? (
        (['top', 'right', 'bottom', 'left'] as const).map((side) => (
          <KeyframeSliderRow
            key={side}
            label={`Padding ${side.charAt(0).toUpperCase()}`}
            value={c.padding.value[side]}
            onCommit={(v) =>
              onPatch({
                padding: {
                  ...c.padding.value,
                  [side]: Math.max(0, v),
                },
              })
            }
            onScrubPreview={(v) =>
              previewAll({ padding: { [side]: Math.max(0, v) } })
            }
            onScrubCommit={(v) =>
              commitPreviewAll({
                padding: {
                  ...c.padding.value,
                  [side]: Math.max(0, v),
                },
              })
            }
            onScrubCancel={() => nodeLayoutPreviewStore.clear()}
            min={0}
            sliderMin={SPACING_SLIDER_MIN}
            sliderMax={SPACING_SLIDER_MAX}
            step={1}
            suffix="px"
            mixed={c.padding.mixed}
            keyframe={
              <MultiKeyframeButton
                targets={nodes.flatMap((node) =>
                  'layout' in node
                    ? [
                        {
                          nodeId: node.id,
                          currentValue: node.layout.padding[side],
                        },
                      ]
                    : [],
                )}
                propertyId={PADDING_PROPERTY_IDS[side]}
              />
            }
          />
        ))
      ) : null}
    </Section>
  )
}

/**
 * Renders a field with a small "mixed" badge pinned to the right when
 * the selection disagrees on this value. The field itself is displayed
 * normally and stays fully interactive — the badge is a hint, not a
 * lock. Committing a value overwrites the mix on every selected node.
 */
function MixedCell({
  mixed,
  children,
}: {
  mixed: boolean
  children: ReactNode
}) {
  return (
    <div className="hm-inspector-mixed relative flex w-full items-center gap-1">
      <div className="hm-inspector-mixed-value min-w-0 flex-1">{children}</div>
      {mixed ? (
        <span
          title="Values differ across the selection"
          className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 rounded bg-panel px-1 text-[9px] font-medium text-accent"
        >
          Mixed
        </span>
      ) : null}
    </div>
  )
}

type Common<T> = { value: T; mixed: boolean }

/**
 * Reduce a selection to a single value + "did they all agree" flag.
 * Uses JSON equality so object-valued properties (fill, padding) match
 * structurally. The inputs are small (few nodes, few fields) so the
 * string round-trip is free.
 */
function common<T>(nodes: Node[], getter: (n: Node) => T): Common<T> {
  if (nodes.length === 0) {
    return { value: undefined as unknown as T, mixed: false }
  }
  const first = getter(nodes[0]!)
  const firstKey = stableKey(first)
  for (let i = 1; i < nodes.length; i++) {
    if (stableKey(getter(nodes[i]!)) !== firstKey) {
      return { value: first, mixed: true }
    }
  }
  return { value: first, mixed: false }
}

function stableKey(v: unknown): string {
  if (v === null || v === undefined) return String(v)
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

// ---------------------------------------------------------------------------
// Per-node details
// ---------------------------------------------------------------------------

type PivotPreset =
  | 'custom'
  | 'center'
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'

function pivotPresetPatch(
  preset: Exclude<PivotPreset, 'custom'>,
): { anchorX: number; anchorY: number; anchorZ: number } {
  switch (preset) {
    case 'left':
      return { anchorX: 0, anchorY: 0.5, anchorZ: 0 }
    case 'right':
      return { anchorX: 1, anchorY: 0.5, anchorZ: 0 }
    case 'top':
      return { anchorX: 0.5, anchorY: 0, anchorZ: 0 }
    case 'bottom':
      return { anchorX: 0.5, anchorY: 1, anchorZ: 0 }
    case 'top-left':
      return { anchorX: 0, anchorY: 0, anchorZ: 0 }
    case 'top-right':
      return { anchorX: 1, anchorY: 0, anchorZ: 0 }
    case 'bottom-left':
      return { anchorX: 0, anchorY: 1, anchorZ: 0 }
    case 'bottom-right':
      return { anchorX: 1, anchorY: 1, anchorZ: 0 }
    default:
      return { anchorX: 0.5, anchorY: 0.5, anchorZ: 0 }
  }
}

function pivotPresetForTransform(transform: Transform): PivotPreset {
  const x = transform.anchorX ?? 0.5
  const y = transform.anchorY ?? 0.5
  const z = transform.anchorZ ?? 0
  if (Math.abs(z) > 0.001) return 'custom'
  const close = (a: number, b: number) => Math.abs(a - b) < 0.001
  if (close(x, 0.5) && close(y, 0.5)) return 'center'
  if (close(x, 0) && close(y, 0.5)) return 'left'
  if (close(x, 1) && close(y, 0.5)) return 'right'
  if (close(x, 0.5) && close(y, 0)) return 'top'
  if (close(x, 0.5) && close(y, 1)) return 'bottom'
  if (close(x, 0) && close(y, 0)) return 'top-left'
  if (close(x, 1) && close(y, 0)) return 'top-right'
  if (close(x, 0) && close(y, 1)) return 'bottom-left'
  if (close(x, 1) && close(y, 1)) return 'bottom-right'
  return 'custom'
}

function NodeDetails({ node, api }: { node: Node; api: SceneAPI }) {
  const version = useSceneVersion()
  const playing = useUI((state) => state.playing)
  const focusPickingCameraId = useUI((state) => state.focusPickingCameraId)
  const setFocusPickingCameraId = useUI(
    (state) => state.setFocusPickingCameraId,
  )
  // Whether this node's parent is a frame with fill explicitly set to
  // null. When that's the case, a child fill would paint on top of a
  // parent that's invisible — so we dim the FillField to signal
  // "editing this won't show up until you give the parent a fill."
  // (Earlier this section computed `parentFillNull` and used it to
  // disable a child's FillField when the parent had no fill. That was
  // wrong reasoning — a child's fill paints its own pixels and is
  // perfectly visible regardless of parent fill state. Removed so
  // every node, including auto-layout children, can take a fill.)

  // Live animated values for this node. When a track is active on a
  // property, the engine emits the interpolated value every frame —
  // the Inspector fields should display THAT (not the dormant static
  // value) so the user sees motion in real time as the playhead moves.
  // Editing a value here still writes the static + stamps the active
  // track via `patchTransform` / `stampForPatch`, so types are
  // consistent in both directions.
  const inspectorAnimationIds = useMemo(
    () => (playing ? [] : [node.id]),
    [node.id, playing],
  )
  const animMap = useAnimatedValues(inspectorAnimationIds)
  const anim = playing
    ? getAnimEngine().getSnapshot()[node.id]
    : animMap[node.id]
  const liveX = anim?.x ?? node.transform.x
  const liveY = anim?.y ?? node.transform.y
  const liveZ = anim?.z ?? node.transform.z
  const liveRot = anim?.rotation ?? node.transform.rotation
  const liveRotX = anim?.rotationX ?? node.transform.rotationX
  const liveRotY = anim?.rotationY ?? node.transform.rotationY
  const liveSX = anim?.scaleX ?? node.transform.scaleX
  const liveSY = anim?.scaleY ?? node.transform.scaleY
  const liveAnchorX = anim?.anchorX ?? node.transform.anchorX ?? 0.5
  const liveAnchorY = anim?.anchorY ?? node.transform.anchorY ?? 0.5
  const liveAnchorZ = anim?.anchorZ ?? node.transform.anchorZ ?? 0
  const liveOpacity = anim?.opacity ?? node.appearance.opacity
  const liveCornerRadius =
    anim?.cornerRadius ?? node.appearance.cornerRadius
  const liveBlendMode =
    anim?.blendMode ?? node.appearance.blendMode ?? 'normal'
  const liveEllipseArc =
    node.kind === 'ellipse'
      ? normalizeEllipseArc({
          ...node.arc,
          startAngle: anim?.arcStart ?? node.arc.startAngle,
          sweep: anim?.arcSweep ?? node.arc.sweep,
          innerRadius: anim?.arcInnerRadius ?? node.arc.innerRadius,
        })
      : null
  const liveWidth =
    'size' in node ? anim?.width ?? node.size.width : null
  const liveHeight =
    'size' in node ? anim?.height ?? node.size.height : null
  const liveFill =
    anim?.fill !== undefined
      ? ({ kind: 'solid', color: anim.fill } as const)
      : node.appearance.fill
  const cursorInstance = isCursorInstance(api, node)
  const supportsMotionPath =
    node.id !== api.getRoot() &&
    node.kind !== 'camera' &&
    node.kind !== 'audio' &&
    !cursorInstance
  const motionPath =
    supportsMotionPath ? normalizeLayerMotionPath(node.motionPath) : null
  const liveMotionPathProgress =
    anim?.motionPathProgress ?? motionPath?.progress ?? 0
  const liveFocusDistance =
    node.kind === 'camera'
      ? anim?.focusDistance ?? node.focusDistance ?? 0
      : 0
  const liveFocusX =
    node.kind === 'camera'
      ? anim?.focusX ?? node.focusX ?? node.transform.x
      : 0
  const liveFocusY =
    node.kind === 'camera'
      ? anim?.focusY ?? node.focusY ?? node.transform.y
      : 0
  const liveFocusRadius =
    node.kind === 'camera' ? anim?.focusRadius ?? node.focusRadius ?? 160 : 160
  const liveFocusFalloff =
    node.kind === 'camera' ? anim?.focusFalloff ?? node.focusFalloff ?? 180 : 180
  const liveFStop =
    node.kind === 'camera' ? anim?.fStop ?? node.fStop ?? 2.8 : 2.8
  const liveBladeCount =
    node.kind === 'camera' ? anim?.bladeCount ?? node.bladeCount ?? 7 : 7
  const liveBladeRotation =
    node.kind === 'camera'
      ? anim?.bladeRotation ?? node.bladeRotation ?? 0
      : 0
  const liveBokehRatio =
    node.kind === 'camera' ? anim?.bokehRatio ?? node.bokehRatio ?? 1 : 1
  const liveBlurLevel =
    node.kind === 'camera' ? anim?.blurLevel ?? node.blurLevel ?? 1 : 1
  const liveFieldOfView =
    node.kind === 'camera' ? anim?.fieldOfView ?? node.fieldOfView ?? 35 : 35
  const cameraScrollSensitivity =
    node.kind === 'camera'
      ? normalizeCameraScrollSensitivity(node.scrollSensitivity)
      : 1
  const liveNearClip =
    node.kind === 'camera' ? anim?.nearClip ?? node.nearClip ?? 1 : 1
  const liveFarClip =
    node.kind === 'camera' ? anim?.farClip ?? node.farClip ?? 100000 : 100000
  const liveBlurQuality =
    node.kind === 'camera'
      ? Math.max(24, anim?.blurQuality ?? node.blurQuality ?? 24)
      : 24
  const liveChromaticAberrationAmount =
    node.kind === 'camera'
      ? anim?.chromaticAberrationAmount ?? node.chromaticAberrationAmount ?? 4
      : 4
  const liveChromaticAberrationAngle =
    node.kind === 'camera'
      ? anim?.chromaticAberrationAngle ?? node.chromaticAberrationAngle ?? 0
      : 0
  const liveBloomStrength =
    node.kind === 'camera'
      ? anim?.bloomStrength ?? node.bloomStrength ?? 0.8
      : 0.8
  const liveBloomRadius =
    node.kind === 'camera'
      ? anim?.bloomRadius ?? node.bloomRadius ?? 0.35
      : 0.35
  const liveBloomThreshold =
    node.kind === 'camera'
      ? anim?.bloomThreshold ?? node.bloomThreshold ?? 0.75
      : 0.75
  const liveVhsIntensity =
    node.kind === 'camera'
      ? anim?.vhsIntensity ?? node.vhsIntensity ?? 0.65
      : 0.65
  const liveVhsNoise =
    node.kind === 'camera'
      ? anim?.vhsNoise ?? node.vhsNoise ?? 0.35
      : 0.35
  const liveVhsScanlines =
    node.kind === 'camera'
      ? anim?.vhsScanlines ?? node.vhsScanlines ?? 0.5
      : 0.5
  const liveVhsColorBleed =
    node.kind === 'camera'
      ? anim?.vhsColorBleed ?? node.vhsColorBleed ?? 3
      : 3
  const focusTargetOptions = useMemo(() => {
    // `version` makes this list react to layer additions, deletions and names.
    void version
    if (node.kind !== 'camera') return []
    return api
      .getAllNodeIds()
      .map((id) => api.getNode(id))
      .filter(
        (candidate): candidate is Node =>
          !!candidate && candidate.kind !== 'camera' && candidate.id !== node.id,
      )
      .map((candidate) => ({
        value: candidate.id,
        label: candidate.name || candidate.kind,
      }))
  }, [api, node.id, node.kind, version])
  // Convenience patchers. Each reads the current group, merges the patch,
  // and writes the whole group back. This is the granularity setNodeProperty
  // accepts today; later we might split groups into nested Y.Maps so
  // collaborators editing different fields don't conflict.
  //
  // Two stamp paths:
  //   1. recording=on    — stamp every animatable key (creates tracks
  //                        if needed). Mirrors AE's stopwatch.
  //   2. recording=off   — only stamp keys that already have a track,
  //                        so the live edit lands on the keyframe at
  //                        playhead. Without this, REPLACE semantics
  //                        in the engine make the static-value update
  //                        invisible (the track value wins on every
  //                        frame). The user sees a "frozen" field.
  // We read the store directly (not via hook) so commit handlers don't
  // re-subscribe per render — one-shot reads are fine here.
  const stampForPatch = (
    group:
      | 'transform'
      | 'appearance'
      | 'shape'
      | 'size'
      | 'camera'
      | 'motionPath'
      | 'layout',
    patch: Record<string, unknown>,
  ) => {
    const ui = useUI.getState()
    const activeSet = ui.activeStaggerSetId
      ? api.getUiState().staggerSets[ui.activeStaggerSetId]
      : undefined
    const draftLayerIds =
      !activeSet &&
      ui.staggerDraftLayerIds.length > 1 &&
      ui.staggerDraftLayerIds.includes(node.id)
        ? ui.staggerDraftLayerIds
        : null
    if (
      ui.staggerOn &&
      (activeSet?.layerIds.includes(node.id) || draftLayerIds !== null)
    ) {
      const setId = activeSet?.id ?? ui.activeStaggerSetId
      const layerIds = activeSet?.layerIds ?? draftLayerIds
      if (!setId || !layerIds) return
      const delay = activeSet?.delay ?? ui.staggerDelay
      const order = activeSet?.order ?? 'forward'
      const baseTime = Math.max(
        0,
        ui.playhead -
          staggerLayerOffset(layerIds, node.id, delay, order),
      )
      const trackIds = stampStaggerSetPatch(
        api,
        baseTime,
        group,
        patch,
        ui.recording ? 'record' : 'active-track',
        {
          setId,
          layerIds,
          delay,
          order,
        },
      )
      if (trackIds.length > 0) {
        ui.setSelectedTrackIds(trackIds)
      }
      return
    }
    if (ui.recording) {
      recordKeyframesForPatch(api, node.id, ui.playhead, group, patch)
    } else {
      stampToActiveTracksForPatch(api, node.id, ui.playhead, group, patch)
    }
  }
  const patchTransform = (patch: Partial<Transform>) => {
    // Read the FRESHEST transform from the api at call time, not from
    // the React closure's `node.transform` snapshot. Two back-to-back
    // calls (e.g. the linked Scale axes calling onCommitX + onCommitY
    // synchronously) both read the same stale snapshot otherwise, and
    // the second overwrites the first. Reading via api.getNode picks
    // up whatever the previous call just wrote.
    const current = api.getNode(node.id)?.transform ?? node.transform
    api.doc.transact(() => {
      api.setNodeProperty(node.id, 'transform', { ...current, ...patch })
      stampForPatch('transform', patch)
    }, UNDOABLE_GESTURE_ORIGIN)
  }
  const previewCameraTransform = (patch: Partial<Transform>) => {
    if (node.kind !== 'camera') return
    cameraPreviewStore.set(
      node.id,
      cameraTransformPreview({
        ...node.transform,
        x: liveX,
        y: liveY,
        z: liveZ,
        rotation: liveRot,
        rotationX: liveRotX,
        rotationY: liveRotY,
        scaleX: liveSX,
        scaleY: liveSY,
        ...patch,
      }),
    )
  }
  const commitCameraTransformScrub = (patch: Partial<Transform>) => {
    if (node.kind !== 'camera') return
    patchTransform(patch)
    cameraPreviewStore.clear(node.id)
  }
  const resetCameraGroup = (group: CameraTransformResetGroup) => {
    if (node.kind !== 'camera') return
    const ui = useUI.getState()
    const playhead = ui.playing
      ? getAnimEngine().getPlayhead()
      : ui.playhead
    // A stale number-field scrub preview must not visually override the
    // neutral pose that this command writes into the scene and timeline.
    cameraPreviewStore.clear(node.id)
    resetCameraTransformGroup(api, node.id, group, playhead)
  }
  const patchAppearance = (patch: Partial<Appearance>) => {
    api.doc.transact(() => {
      api.setNodeProperty(node.id, 'appearance', {
        ...node.appearance,
        ...patch,
      })
      stampForPatch('appearance', patch)
    }, UNDOABLE_GESTURE_ORIGIN)
  }
  const patchEllipseArc = (
    patch: Partial<NonNullable<typeof liveEllipseArc>>,
  ) => {
    const current = api.getNode(node.id)
    if (!current || current.kind !== 'ellipse') return
    const next = normalizeEllipseArc({ ...current.arc, ...patch })
    api.doc.transact(() => {
      api.setNodeProperty(node.id, 'arc', next)
      stampForPatch('shape', patch)
    }, UNDOABLE_GESTURE_ORIGIN)
  }
  const commitEffects = (effects: Effect[]) => {
    const current = api.getNode(node.id)
    if (!current) return
    api.doc.transact(() => {
      api.setNodeProperty(node.id, 'appearance', {
        ...current.appearance,
        effects,
      })
    }, UNDOABLE_GESTURE_ORIGIN)
  }
  const commitEffectBlur = (effectId: string, rawValue: number) => {
    const current = api.getNode(node.id)
    if (!current) return
    const effects = [...(current.appearance.effects ?? [])]
    const index = effects.findIndex(
      (effect, effectIndex) =>
        effectStableId(effect, effectIndex) === effectId,
    )
    const effect = effects[index]
    if (!effect) return
    const value = normalizedEffectBlur(effect, rawValue)
    effects[index] =
      effect.kind === 'blur'
        ? { ...effect, amount: value }
        : { ...effect, blur: value }
    const propertyId = effectBlurPropertyId(effectId)
    const authorTime = currentAnimationAuthorTime()
    const ui = useUI.getState()
    api.doc.transact(() => {
      api.setNodeProperty(node.id, 'appearance', {
        ...current.appearance,
        effects,
      })
      if (ui.recording || findTrack(api, node.id, propertyId)) {
        addKeyframe(api, node.id, propertyId, authorTime, value)
      }
    }, UNDOABLE_GESTURE_ORIGIN)
  }
  const previewEffectBlur = (effectId: string, rawValue: number) => {
    const current = api.getNode(node.id)
    const effects = current?.appearance.effects ?? []
    const effect = effects.find(
      (candidate, index) => effectStableId(candidate, index) === effectId,
    )
    if (!effect) return
    nodeTransformPreviewStore.preview({
      [node.id]: {
        effectBlur: {
          [effectId]: normalizedEffectBlur(effect, rawValue),
        },
      },
    })
  }
  const commitEffectBlurScrub = (effectId: string, value: number) => {
    commitEffectBlur(effectId, value)
    nodeTransformPreviewStore.finish()
  }
  const removeEffect = (effectId: string, effects: Effect[]) => {
    const current = api.getNode(node.id)
    if (!current) return
    const propertyId = effectBlurPropertyId(effectId)
    api.doc.transact(() => {
      api.setNodeProperty(node.id, 'appearance', {
        ...current.appearance,
        effects,
      })
      const track = findTrack(api, node.id, propertyId)
      if (track) removeTrack(api, track.id)
    }, UNDOABLE_GESTURE_ORIGIN)
  }
  const previewNodeVisual = (patch: AnimatedValue) => {
    nodeTransformPreviewStore.preview({ [node.id]: patch })
  }
  const commitTransformScrub = (patch: Partial<Transform>) => {
    patchTransform(patch)
    nodeTransformPreviewStore.finish()
  }
  const commitAppearanceScrub = (patch: Partial<Appearance>) => {
    patchAppearance(patch)
    nodeTransformPreviewStore.finish()
  }
  const commitEllipseArcScrub = (
    patch: Partial<NonNullable<typeof liveEllipseArc>>,
  ) => {
    patchEllipseArc(patch)
    nodeTransformPreviewStore.finish()
  }
  const cancelNodeVisualPreview = () => nodeTransformPreviewStore.clear()
  const patchSize = (patch: Partial<Size>) => {
    const current = api.getNode(node.id)
    if (!current || !('size' in current)) return
    api.doc.transact(() => {
      api.setNodeProperty(node.id, 'size', { ...current.size, ...patch })
      if (
        current.kind === 'component' &&
        (patch.width === 'hug' || patch.height === 'hug')
      ) {
        fitComponentToChildren(api, current.id, { preserveHug: true })
      }
      stampForPatch('size', patch)
    }, UNDOABLE_GESTURE_ORIGIN)
  }
  const previewSize = (patch: Partial<Size>) => {
    if (!('size' in node)) return
    nodeGeometryPreviewStore.preview({ [node.id]: { size: patch } })
  }
  const commitSizeScrub = (patch: Partial<Size>) => {
    patchSize(patch)
    nodeGeometryPreviewStore.finish()
  }
  const cancelGeometryPreview = () => nodeGeometryPreviewStore.clear()
  const addMotionPath = () => {
    if (!supportsMotionPath) return
    api.doc.transact(() => {
      api.setNodeProperty(
        node.id,
        'motionPath',
        defaultLayerMotionPath(),
      )
    }, UNDOABLE_GESTURE_ORIGIN)
  }
  const patchMotionPath = (patch: Partial<LayerMotionPath>) => {
    if (!supportsMotionPath) return
    const currentNode = api.getNode(node.id)
    if (!currentNode) return
    const current =
      normalizeLayerMotionPath(currentNode.motionPath) ??
      defaultLayerMotionPath()
    const next = normalizeLayerMotionPath({ ...current, ...patch })
    if (!next) return
    api.doc.transact(() => {
      api.setNodeProperty(node.id, 'motionPath', next)
      if (patch.progress !== undefined) {
        stampForPatch('motionPath', { progress: next.progress })
      }
    }, UNDOABLE_GESTURE_ORIGIN)
  }
  const removeMotionPath = () => {
    if (!supportsMotionPath) return
    api.doc.transact(() => {
      api.setNodeProperty(node.id, 'motionPath', null)
      const progressTrack = findTrack(
        api,
        node.id,
        'motionPath.progress',
      )
      if (progressTrack) removeTrack(api, progressTrack.id)
    }, UNDOABLE_GESTURE_ORIGIN)
  }
  const patchCamera = (
    patch: Partial<
      Pick<
        CameraNode,
        | 'focusMode'
        | 'depthOfField'
        | 'focusDistance'
        | 'focusX'
        | 'focusY'
        | 'focusWorldX'
        | 'focusWorldY'
        | 'focusWorldZ'
        | 'focusRadius'
        | 'focusFalloff'
        | 'focusTargetNodeId'
        | 'focalLength'
        | 'scrollSensitivity'
        | 'aperture'
        | 'fStop'
        | 'bladeCount'
        | 'bladeRotation'
        | 'bokehRatio'
        | 'dofPreviewQuality'
        | 'iso'
        | 'blurLevel'
        | 'fieldOfView'
        | 'nearClip'
        | 'farClip'
        | 'pointOfInterestX'
        | 'pointOfInterestY'
        | 'pointOfInterestZ'
        | 'blurQuality'
        | 'chromaticAberrationEnabled'
        | 'chromaticAberrationAmount'
        | 'chromaticAberrationAngle'
        | 'bloomEnabled'
        | 'bloomStrength'
        | 'bloomRadius'
        | 'bloomThreshold'
        | 'vhsEnabled'
        | 'vhsIntensity'
        | 'vhsNoise'
        | 'vhsScanlines'
        | 'vhsColorBleed'
        | 'showFocusPlane'
      >
    >,
  ) => {
    if (node.kind !== 'camera') return
    if (patch.focusMode !== undefined) {
      api.setNodeProperty(node.id, 'focusMode', patch.focusMode)
    }
    if (patch.depthOfField !== undefined) {
      api.setNodeProperty(node.id, 'depthOfField', patch.depthOfField)
    }
    if (patch.focusDistance !== undefined) {
      api.setNodeProperty(node.id, 'focusDistance', patch.focusDistance)
    }
    if (patch.focusX !== undefined) {
      api.setNodeProperty(node.id, 'focusX', patch.focusX)
    }
    if (patch.focusY !== undefined) {
      api.setNodeProperty(node.id, 'focusY', patch.focusY)
    }
    if (patch.focusWorldX !== undefined) {
      api.setNodeProperty(node.id, 'focusWorldX', patch.focusWorldX)
    }
    if (patch.focusWorldY !== undefined) {
      api.setNodeProperty(node.id, 'focusWorldY', patch.focusWorldY)
    }
    if (patch.focusWorldZ !== undefined) {
      api.setNodeProperty(node.id, 'focusWorldZ', patch.focusWorldZ)
    }
    if (patch.focusRadius !== undefined) {
      api.setNodeProperty(node.id, 'focusRadius', patch.focusRadius)
    }
    if (patch.focusFalloff !== undefined) {
      api.setNodeProperty(node.id, 'focusFalloff', patch.focusFalloff)
    }
    if (patch.focusTargetNodeId !== undefined) {
      api.setNodeProperty(node.id, 'focusTargetNodeId', patch.focusTargetNodeId)
    }
    if (patch.focalLength !== undefined) {
      api.setNodeProperty(node.id, 'focalLength', patch.focalLength)
    }
    if (patch.scrollSensitivity !== undefined) {
      api.setNodeProperty(
        node.id,
        'scrollSensitivity',
        normalizeCameraScrollSensitivity(patch.scrollSensitivity),
      )
    }
    if (patch.aperture !== undefined) {
      api.setNodeProperty(node.id, 'aperture', patch.aperture)
    }
    if (patch.fStop !== undefined) {
      api.setNodeProperty(node.id, 'fStop', patch.fStop)
    }
    if (patch.bladeCount !== undefined) {
      api.setNodeProperty(node.id, 'bladeCount', patch.bladeCount)
    }
    if (patch.bladeRotation !== undefined) {
      api.setNodeProperty(node.id, 'bladeRotation', patch.bladeRotation)
    }
    if (patch.bokehRatio !== undefined) {
      api.setNodeProperty(node.id, 'bokehRatio', patch.bokehRatio)
    }
    if (patch.dofPreviewQuality !== undefined) {
      api.setNodeProperty(
        node.id,
        'dofPreviewQuality',
        patch.dofPreviewQuality,
      )
    }
    if (patch.iso !== undefined) {
      api.setNodeProperty(node.id, 'iso', patch.iso)
    }
    if (patch.blurLevel !== undefined) {
      api.setNodeProperty(node.id, 'blurLevel', patch.blurLevel)
    }
    if (patch.fieldOfView !== undefined) {
      api.setNodeProperty(node.id, 'fieldOfView', patch.fieldOfView)
    }
    if (patch.nearClip !== undefined) {
      api.setNodeProperty(node.id, 'nearClip', patch.nearClip)
    }
    if (patch.farClip !== undefined) {
      api.setNodeProperty(node.id, 'farClip', patch.farClip)
    }
    if (patch.pointOfInterestX !== undefined) {
      api.setNodeProperty(node.id, 'pointOfInterestX', patch.pointOfInterestX)
    }
    if (patch.pointOfInterestY !== undefined) {
      api.setNodeProperty(node.id, 'pointOfInterestY', patch.pointOfInterestY)
    }
    if (patch.pointOfInterestZ !== undefined) {
      api.setNodeProperty(node.id, 'pointOfInterestZ', patch.pointOfInterestZ)
    }
    if (patch.blurQuality !== undefined) {
      api.setNodeProperty(node.id, 'blurQuality', patch.blurQuality)
    }
    if (patch.chromaticAberrationEnabled !== undefined) {
      api.setNodeProperty(
        node.id,
        'chromaticAberrationEnabled',
        patch.chromaticAberrationEnabled,
      )
    }
    if (patch.chromaticAberrationAmount !== undefined) {
      api.setNodeProperty(
        node.id,
        'chromaticAberrationAmount',
        patch.chromaticAberrationAmount,
      )
    }
    if (patch.chromaticAberrationAngle !== undefined) {
      api.setNodeProperty(
        node.id,
        'chromaticAberrationAngle',
        patch.chromaticAberrationAngle,
      )
    }
    if (patch.bloomEnabled !== undefined) {
      api.setNodeProperty(node.id, 'bloomEnabled', patch.bloomEnabled)
    }
    if (patch.bloomStrength !== undefined) {
      api.setNodeProperty(node.id, 'bloomStrength', patch.bloomStrength)
    }
    if (patch.bloomRadius !== undefined) {
      api.setNodeProperty(node.id, 'bloomRadius', patch.bloomRadius)
    }
    if (patch.bloomThreshold !== undefined) {
      api.setNodeProperty(node.id, 'bloomThreshold', patch.bloomThreshold)
    }
    if (patch.vhsEnabled !== undefined) {
      api.setNodeProperty(node.id, 'vhsEnabled', patch.vhsEnabled)
    }
    if (patch.vhsIntensity !== undefined) {
      api.setNodeProperty(node.id, 'vhsIntensity', patch.vhsIntensity)
    }
    if (patch.vhsNoise !== undefined) {
      api.setNodeProperty(node.id, 'vhsNoise', patch.vhsNoise)
    }
    if (patch.vhsScanlines !== undefined) {
      api.setNodeProperty(node.id, 'vhsScanlines', patch.vhsScanlines)
    }
    if (patch.vhsColorBleed !== undefined) {
      api.setNodeProperty(node.id, 'vhsColorBleed', patch.vhsColorBleed)
    }
    if (patch.showFocusPlane !== undefined) {
      api.setNodeProperty(node.id, 'showFocusPlane', patch.showFocusPlane)
    }
    stampForPatch('camera', patch)
  }
  const previewCameraProperties = (patch: AnimatedValue) => {
    if (node.kind !== 'camera') return
    cameraPreviewStore.set(node.id, patch)
  }
  const commitCameraPropertiesScrub = (
    patch: Parameters<typeof patchCamera>[0],
  ) => {
    if (node.kind !== 'camera') return
    patchCamera(patch)
    cameraPreviewStore.finish(node.id)
  }
  const cancelCameraPropertiesPreview = () => {
    if (node.kind !== 'camera') return
    cameraPreviewStore.clear(node.id)
  }
  const pivotPreset = node.kind === 'camera' ? 'center' : pivotPresetForTransform(node.transform)
  const patchLayout = (patch: Partial<Layout>) => {
    if (!('layout' in node)) return
    api.setNodeProperty(node.id, 'layout', { ...node.layout, ...patch })
    stampForPatch('layout', patch)
    // If the user's changing the layout mode AND the frame still has
    // one of the default auto-generated names, retitle it so the layers
    // panel doesn't say "Auto layout" for a frame that's been flipped
    // to Grid mode. A user-edited name is left alone — this only
    // overwrites the defaults wrapInAutoLayout / wrapInGrid stamp on.
    if (patch.mode && patch.mode !== node.layout.mode) {
      const DEFAULT_FRAME_NAMES = new Set(['Auto layout', 'Grid', 'Frame'])
      if (DEFAULT_FRAME_NAMES.has(node.name)) {
        const nextName =
          patch.mode === 'flex'
            ? 'Auto layout'
            : patch.mode === 'grid'
              ? 'Grid'
              : 'Frame'
        if (nextName !== node.name) {
          api.setNodeProperty(node.id, 'name', nextName)
        }
      }
      // Auto-layout mode means "the parent owns child placement."
      // Convert direct children into flow and clear stale x/y offsets
      // when the user switches a frame/scene into Stack/Grid; otherwise
      // old free-canvas offsets keep visually fighting the Yoga result.
      const isAutoLayout = patch.mode === 'flex' || patch.mode === 'grid'
      if (isAutoLayout) {
        api.doc.transact(() => {
          for (const child of api.getChildren(node.id)) {
            if (child.position !== 'flow') {
              api.setNodeProperty(child.id, 'position', 'flow')
            }
            if (child.transform.x !== 0 || child.transform.y !== 0) {
              api.setNodeProperty(child.id, 'transform', {
                ...child.transform,
                x: 0,
                y: 0,
              })
            }
          }
        })
      }
    }
  }
  return (
    <div className="space-y-4">
      <Section title="Node">
        <FieldRow label="Name">
          <TextField
            value={node.name}
            onCommit={(n) => api.setNodeProperty(node.id, 'name', n)}
            allowEmpty={false}
          />
        </FieldRow>
        <FieldRow label="Kind">
          <span className="pr-1.5 text-[12px] text-text">
            {node.kind}
          </span>
        </FieldRow>
        <FieldRow label="Id">
          <span className="pr-1.5 font-mono text-[11px] text-text-muted">
            {node.id.slice(0, 8)}…
          </span>
        </FieldRow>
        <FieldRow label="Visible">
          <CheckboxField
            value={node.visible}
            onCommit={(v) => api.setNodeProperty(node.id, 'visible', v)}
          />
        </FieldRow>
        <FieldRow label="Locked">
          <CheckboxField
            value={node.locked}
            onCommit={(v) => setLockedRecursive(api, node.id, v)}
          />
        </FieldRow>
        {node.kind === 'instance' && (
          <FieldRow label="Always on top">
            <CheckboxField
              value={node.alwaysOnTop}
              onCommit={(alwaysOnTop) =>
                api.setNodeProperty(node.id, 'alwaysOnTop', alwaysOnTop)
              }
            />
          </FieldRow>
        )}
      </Section>

      {node.kind === 'audio' && (
        <>
          <AudioBeatSection key={node.id} node={node} api={api} />
          <MediaSection node={node} api={api} />
        </>
      )}

      {(node.kind === 'component' || node.kind === 'instance') ? (
        <>
          <ComponentVariablesSection node={node} api={api} />
          <VariantsSection node={node} api={api} />
          <PrototypeSection node={node} api={api} />
        </>
      ) : (
        <ExposeComponentPropertiesSection node={node} api={api} />
      )}

      {node.kind !== 'audio' && <PositionSection node={node} api={api} />}

      {node.kind === 'camera' && (
        <>
          <CameraViewportControlsHint />

          <Section
            title="Camera Position"
            action={
              <CameraSectionResetButton
                label="Reset position"
                title="Reset camera position to the scene center and add or update its X, Y, and Z keyframes at the current playhead."
                onClick={() => resetCameraGroup('position')}
              />
            }
          >
            <KeyframeSliderRow
              label="Position X"
              value={liveX}
              onCommit={(v) => patchTransform({ x: v })}
              onScrubPreview={(v) => previewCameraTransform({ x: v })}
              onScrubCommit={(v) => commitCameraTransformScrub({ x: v })}
              onScrubCancel={() => cameraPreviewStore.clear(node.id)}
              sliderMin={POSITION_SLIDER_MIN}
              sliderMax={POSITION_SLIDER_MAX}
              step={1}
              suffix="px"
              keyframe={
                <KeyframeButton
                  nodeId={node.id}
                  propertyId="transform.x"
                  currentValue={liveX}
                />
              }
            />
            <KeyframeSliderRow
              label="Position Y"
              value={liveY}
              onCommit={(v) => patchTransform({ y: v })}
              onScrubPreview={(v) => previewCameraTransform({ y: v })}
              onScrubCommit={(v) => commitCameraTransformScrub({ y: v })}
              onScrubCancel={() => cameraPreviewStore.clear(node.id)}
              sliderMin={POSITION_SLIDER_MIN}
              sliderMax={POSITION_SLIDER_MAX}
              step={1}
              suffix="px"
              keyframe={
                <KeyframeButton
                  nodeId={node.id}
                  propertyId="transform.y"
                  currentValue={liveY}
                />
              }
            />
            <KeyframeSliderRow
              label="Position Z"
              value={liveZ}
              onCommit={(v) => patchTransform({ z: v })}
              onScrubPreview={(v) => previewCameraTransform({ z: v })}
              onScrubCommit={(v) => commitCameraTransformScrub({ z: v })}
              onScrubCancel={() => cameraPreviewStore.clear(node.id)}
              sliderMin={POSITION_SLIDER_MIN}
              sliderMax={POSITION_SLIDER_MAX}
              step={1}
              suffix="px"
              keyframe={
                <KeyframeButton
                  nodeId={node.id}
                  propertyId="transform.z"
                  currentValue={liveZ}
                />
              }
            />
            <FieldRow label="Scroll intensity" layout="compound">
              <SliderField
                value={Math.round(cameraScrollSensitivity * 100)}
                onCommit={(percent) =>
                  patchCamera({ scrollSensitivity: percent / 100 })
                }
                min={MIN_CAMERA_SCROLL_SENSITIVITY * 100}
                max={MAX_CAMERA_SCROLL_SENSITIVITY * 100}
                step={5}
                suffix="%"
              />
            </FieldRow>
          </Section>

          <Section
            title="Camera Rotation"
            action={
              <CameraSectionResetButton
                label="Reset rotation"
                title="Reset all camera rotation axes to 0° and add or update their keyframes at the current playhead."
                onClick={() => resetCameraGroup('rotation')}
              />
            }
          >
            <KeyframeSliderRow
              label="Rotate X"
              value={liveRotX}
              onCommit={(v) => patchTransform({ rotationX: v })}
              onScrubPreview={(v) =>
                previewCameraTransform({ rotationX: v })
              }
              onScrubCommit={(v) =>
                commitCameraTransformScrub({ rotationX: v })
              }
              onScrubCancel={() => cameraPreviewStore.clear(node.id)}
              sliderMin={ROTATION_SLIDER_MIN}
              sliderMax={ROTATION_SLIDER_MAX}
              step={1}
              suffix="°"
              keyframe={
                <KeyframeButton
                  nodeId={node.id}
                  propertyId="transform.rotationX"
                  currentValue={liveRotX}
                />
              }
            />
            <KeyframeSliderRow
              label="Rotate Y"
              value={liveRotY}
              onCommit={(v) => patchTransform({ rotationY: v })}
              onScrubPreview={(v) =>
                previewCameraTransform({ rotationY: v })
              }
              onScrubCommit={(v) =>
                commitCameraTransformScrub({ rotationY: v })
              }
              onScrubCancel={() => cameraPreviewStore.clear(node.id)}
              sliderMin={ROTATION_SLIDER_MIN}
              sliderMax={ROTATION_SLIDER_MAX}
              step={1}
              suffix="°"
              keyframe={
                <KeyframeButton
                  nodeId={node.id}
                  propertyId="transform.rotationY"
                  currentValue={liveRotY}
                />
              }
            />
            <KeyframeSliderRow
              label="Rotate Z"
              value={liveRot}
              onCommit={(v) => patchTransform({ rotation: v })}
              onScrubPreview={(v) =>
                previewCameraTransform({ rotation: v })
              }
              onScrubCommit={(v) =>
                commitCameraTransformScrub({ rotation: v })
              }
              onScrubCancel={() => cameraPreviewStore.clear(node.id)}
              sliderMin={ROTATION_SLIDER_MIN}
              sliderMax={ROTATION_SLIDER_MAX}
              step={1}
              suffix="°"
              keyframe={
                <KeyframeButton
                  nodeId={node.id}
                  propertyId="transform.rotation"
                  currentValue={liveRot}
                />
              }
            />
          </Section>

        </>
      )}

      {supportsMotionPath && (
        <MotionPathSection
          nodeId={node.id}
          path={motionPath}
          progress={liveMotionPathProgress}
          onAdd={addMotionPath}
          onRemove={removeMotionPath}
          onPatch={patchMotionPath}
        />
      )}

      {node.kind !== 'camera' && node.kind !== 'audio' && (
      <Section title="Transform">
        {/* See multi-select branch above for rationale. */}
        <AlignTools api={api} selection={[node.id]} />
        <KeyframeSliderRow
          label="Position X"
          value={liveX}
          onCommit={(v) => patchTransform({ x: v })}
          onScrubPreview={(v) => previewNodeVisual({ x: v })}
          onScrubCommit={(v) => commitTransformScrub({ x: v })}
          onScrubCancel={cancelNodeVisualPreview}
          sliderMin={POSITION_SLIDER_MIN}
          sliderMax={POSITION_SLIDER_MAX}
          step={1}
          suffix="px"
          keyframe={
            <KeyframeButton
              nodeId={node.id}
              propertyId="transform.x"
              currentValue={liveX}
            />
          }
        />
        <KeyframeSliderRow
          label="Position Y"
          value={liveY}
          onCommit={(v) => patchTransform({ y: v })}
          onScrubPreview={(v) => previewNodeVisual({ y: v })}
          onScrubCommit={(v) => commitTransformScrub({ y: v })}
          onScrubCancel={cancelNodeVisualPreview}
          sliderMin={POSITION_SLIDER_MIN}
          sliderMax={POSITION_SLIDER_MAX}
          step={1}
          suffix="px"
          keyframe={
            <KeyframeButton
              nodeId={node.id}
              propertyId="transform.y"
              currentValue={liveY}
            />
          }
        />
        <KeyframeSliderRow
          label="Rotate Z"
          value={liveRot}
          onCommit={(v) => patchTransform({ rotation: v })}
          onScrubPreview={(v) => previewNodeVisual({ rotation: v })}
          onScrubCommit={(v) => commitTransformScrub({ rotation: v })}
          onScrubCancel={cancelNodeVisualPreview}
          sliderMin={ROTATION_SLIDER_MIN}
          sliderMax={ROTATION_SLIDER_MAX}
          step={1}
          suffix="°"
          keyframe={
            <KeyframeButton
              nodeId={node.id}
              propertyId="transform.rotation"
              currentValue={liveRot}
            />
          }
        />
        <ScalePairField
          nodeId={node.id}
          scaleX={liveSX}
          scaleY={liveSY}
          onCommitX={(v) => patchTransform({ scaleX: v })}
          onCommitY={(v) => patchTransform({ scaleY: v })}
          onCommitPair={({ scaleX, scaleY }) =>
            patchTransform({ scaleX, scaleY })
          }
          onScrubPreviewPair={({ scaleX, scaleY }) =>
            previewNodeVisual({ scaleX, scaleY })
          }
          onScrubCommitPair={({ scaleX, scaleY }) =>
            commitTransformScrub({ scaleX, scaleY })
          }
          onScrubCancel={cancelNodeVisualPreview}
        />
        <InspectorDisclosure
          storageKey="advanced-transform"
          title="Advanced transform"
        >
          <FieldRow label="Render mode">
            <SelectField<RenderMode>
              value={node.transform.renderMode ?? 'flat'}
              options={RENDER_MODE_OPTIONS}
              onCommit={(renderMode) => patchTransform({ renderMode })}
              width="w-full"
            />
          </FieldRow>
          <FieldRow label="3D space">
            <SelectField<NonNullable<Transform['space']>>
              value={node.transform.space ?? 'local'}
              options={[
                { value: 'local', label: 'Local plane' },
                { value: 'world', label: 'World' },
              ]}
              onCommit={(space) => patchTransform({ space })}
              width="w-full"
            />
          </FieldRow>
          <KeyframeSliderRow
            label="Position Z"
            value={liveZ}
            onCommit={(v) => patchTransform({ z: v })}
            onScrubPreview={(v) => previewNodeVisual({ z: v })}
            onScrubCommit={(v) => commitTransformScrub({ z: v })}
            onScrubCancel={cancelNodeVisualPreview}
            sliderMin={POSITION_SLIDER_MIN}
            sliderMax={POSITION_SLIDER_MAX}
            step={1}
            suffix="px"
            keyframe={
              <KeyframeButton
                nodeId={node.id}
                propertyId="transform.z"
                currentValue={liveZ}
              />
            }
          />
          <KeyframeSliderRow
            label="Rotate X"
            value={liveRotX}
            onCommit={(v) => patchTransform({ rotationX: v })}
            onScrubPreview={(v) => previewNodeVisual({ rotationX: v })}
            onScrubCommit={(v) =>
              commitTransformScrub({ rotationX: v })
            }
            onScrubCancel={cancelNodeVisualPreview}
            sliderMin={ROTATION_SLIDER_MIN}
            sliderMax={ROTATION_SLIDER_MAX}
            step={1}
            suffix="°"
            keyframe={
              <KeyframeButton
                nodeId={node.id}
                propertyId="transform.rotationX"
                currentValue={liveRotX}
              />
            }
          />
          <KeyframeSliderRow
            label="Rotate Y"
            value={liveRotY}
            onCommit={(v) => patchTransform({ rotationY: v })}
            onScrubPreview={(v) => previewNodeVisual({ rotationY: v })}
            onScrubCommit={(v) =>
              commitTransformScrub({ rotationY: v })
            }
            onScrubCancel={cancelNodeVisualPreview}
            sliderMin={ROTATION_SLIDER_MIN}
            sliderMax={ROTATION_SLIDER_MAX}
            step={1}
            suffix="°"
            keyframe={
              <KeyframeButton
                nodeId={node.id}
                propertyId="transform.rotationY"
                currentValue={liveRotY}
              />
            }
          />
          <FieldRow label="Pivot">
            <SelectField<PivotPreset>
              value={pivotPreset}
              options={[
                { value: 'center', label: 'Center' },
                { value: 'left', label: 'Left edge' },
                { value: 'right', label: 'Right edge' },
                { value: 'top', label: 'Top edge' },
                { value: 'bottom', label: 'Bottom edge' },
                { value: 'top-left', label: 'Top left' },
                { value: 'top-right', label: 'Top right' },
                { value: 'bottom-left', label: 'Bottom left' },
                { value: 'bottom-right', label: 'Bottom right' },
                { value: 'custom', label: 'Custom' },
              ]}
              onCommit={(preset) => {
                if (preset === 'custom') return
                const nextPivot = pivotPresetPatch(preset)
                const rect = getLastSolvedLayout()?.[node.id]
                if (!rect) {
                  patchTransform(nextPivot)
                  return
                }
                patchTransform(
                  pivotPreservingTransformPatch(
                    {
                      ...node.transform,
                      x: liveX,
                      y: liveY,
                      z: liveZ,
                      rotation: liveRot,
                      rotationX: liveRotX,
                      rotationY: liveRotY,
                      scaleX: liveSX,
                      scaleY: liveSY,
                      anchorX: anim?.anchorX ?? node.transform.anchorX,
                      anchorY: anim?.anchorY ?? node.transform.anchorY,
                      anchorZ: anim?.anchorZ ?? node.transform.anchorZ,
                    },
                    rect.width,
                    rect.height,
                    nextPivot,
                  ),
                )
              }}
              width="w-full"
            />
          </FieldRow>
          <KeyframeSliderRow
            label="Anchor X"
            value={liveAnchorX * 100}
            onCommit={(v) =>
              patchTransform({ anchorX: Math.max(0, Math.min(1, v / 100)) })
            }
            onScrubPreview={(v) =>
              previewNodeVisual({
                anchorX: Math.max(0, Math.min(1, v / 100)),
              })
            }
            onScrubCommit={(v) =>
              commitTransformScrub({
                anchorX: Math.max(0, Math.min(1, v / 100)),
              })
            }
            onScrubCancel={cancelNodeVisualPreview}
            min={0}
            max={100}
            step={1}
            suffix="%"
            keyframe={
              <KeyframeButton
                nodeId={node.id}
                propertyId="transform.anchorX"
                currentValue={liveAnchorX}
              />
            }
          />
          <KeyframeSliderRow
            label="Anchor Y"
            value={liveAnchorY * 100}
            onCommit={(v) =>
              patchTransform({ anchorY: Math.max(0, Math.min(1, v / 100)) })
            }
            onScrubPreview={(v) =>
              previewNodeVisual({
                anchorY: Math.max(0, Math.min(1, v / 100)),
              })
            }
            onScrubCommit={(v) =>
              commitTransformScrub({
                anchorY: Math.max(0, Math.min(1, v / 100)),
              })
            }
            onScrubCancel={cancelNodeVisualPreview}
            min={0}
            max={100}
            step={1}
            suffix="%"
            keyframe={
              <KeyframeButton
                nodeId={node.id}
                propertyId="transform.anchorY"
                currentValue={liveAnchorY}
              />
            }
          />
          <KeyframeSliderRow
            label="Anchor Z"
            value={liveAnchorZ}
            onCommit={(v) => patchTransform({ anchorZ: v })}
            onScrubPreview={(v) => previewNodeVisual({ anchorZ: v })}
            onScrubCommit={(v) => commitTransformScrub({ anchorZ: v })}
            onScrubCancel={cancelNodeVisualPreview}
            adaptiveSpan={1000}
            step={1}
            suffix="px"
            keyframe={
              <KeyframeButton
                nodeId={node.id}
                propertyId="transform.anchorZ"
                currentValue={liveAnchorZ}
              />
            }
          />
        </InspectorDisclosure>
      </Section>
      )}

      {'size' in node && node.kind !== 'audio' && (
        <Section
          title={`Size · W ${formatInspectorSizeAxis(liveWidth ?? node.size.width)} × H ${formatInspectorSizeAxis(liveHeight ?? node.size.height)}`}
        >
          <FieldRow
            label="Width"
            keyframe={
              <KeyframeButton
                nodeId={node.id}
                propertyId="size.width"
                currentValue={typeof liveWidth === 'number' ? liveWidth : null}
              />
            }
          >
            <SizeAxisField
              value={liveWidth ?? node.size.width}
              onCommit={(w) => patchSize({ width: w })}
              onScrubPreview={(width) => previewSize({ width })}
              onScrubCommit={(width) => commitSizeScrub({ width })}
              onScrubCancel={cancelGeometryPreview}
            />
          </FieldRow>
          <FieldRow
            label="Height"
            keyframe={
              <KeyframeButton
                nodeId={node.id}
                propertyId="size.height"
                currentValue={typeof liveHeight === 'number' ? liveHeight : null}
              />
            }
          >
            <SizeAxisField
              value={liveHeight ?? node.size.height}
              onCommit={(h) => patchSize({ height: h })}
              onScrubPreview={(height) => previewSize({ height })}
              onScrubCommit={(height) => commitSizeScrub({ height })}
              onScrubCancel={cancelGeometryPreview}
            />
          </FieldRow>
        </Section>
      )}

      {node.kind === 'text' && (
        <TypographySection node={node} api={api} />
      )}

      {node.kind === 'image' && (
        <ImageSection node={node} api={api} />
      )}

      {node.kind === 'shader' && (
        <PaperShaderInspector node={node} api={api} />
      )}

      {(node.kind === 'audio' || node.kind === 'video') && (
        <MediaSection node={node} api={api} />
      )}

      {'layout' in node && (
        <LayoutSection
          nodeId={node.id}
          layout={node.layout}
          onPatch={patchLayout}
        />
      )}

      {/* Layout guides — Figma-style stacked overlays. Only on
          frame nodes (other shapes don't host children to align
          against). The guides themselves render on the canvas. */}
      {node.kind === 'frame' && (
        <LayoutGuidesSection node={node} api={api} />
      )}

      {/* Cameras don't paint. Hiding the whole Appearance block keeps
          the Inspector honest — opacity, fill, stroke, corner don't
          apply to a viewpoint. A camera-specific section with
          projection + a future "enabled" toggle slots in here when we
          expand the camera feature surface. */}
      {node.kind !== 'camera' && node.kind !== 'audio' ? (
        <Section title="Appearance">
          <KeyframeSliderRow
            label="Opacity"
            value={liveOpacity * 100}
            onCommit={(v) => patchAppearance({ opacity: v / 100 })}
            onScrubPreview={(v) => previewNodeVisual({ opacity: v / 100 })}
            onScrubCommit={(v) =>
              commitAppearanceScrub({ opacity: v / 100 })
            }
            onScrubCancel={cancelNodeVisualPreview}
            min={0}
            max={100}
            step={1}
            suffix="%"
            keyframe={
              <KeyframeButton
                nodeId={node.id}
                propertyId="appearance.opacity"
                currentValue={liveOpacity}
              />
            }
          />
          <FieldRow
            label="Blend"
            keyframe={
              <KeyframeButton
                nodeId={node.id}
                propertyId="appearance.blendMode"
                currentValue={liveBlendMode}
              />
            }
          >
            <SelectField<BlendMode>
              value={liveBlendMode}
              options={BLEND_MODE_OPTIONS}
              onCommit={(blendMode) => patchAppearance({ blendMode })}
              width="w-full"
            />
          </FieldRow>
          {node.kind === 'ellipse' && liveEllipseArc ? (
            <>
              <div className="text-[11px] font-medium text-text-muted">
                Arc
              </div>
              <KeyframeSliderRow
                label="Start angle"
                value={liveEllipseArc.startAngle}
                onCommit={(startAngle) => patchEllipseArc({ startAngle })}
                onScrubPreview={(arcStart) =>
                  previewNodeVisual({ arcStart })
                }
                onScrubCommit={(startAngle) =>
                  commitEllipseArcScrub({ startAngle })
                }
                onScrubCancel={cancelNodeVisualPreview}
                min={-180}
                max={180}
                step={0.1}
                suffix="°"
                keyframe={
                  <KeyframeButton
                    nodeId={node.id}
                    propertyId="shape.arcStart"
                    currentValue={liveEllipseArc.startAngle}
                  />
                }
              />
              <KeyframeSliderRow
                label="Sweep"
                value={liveEllipseArc.sweep * 100}
                onCommit={(sweep) =>
                  patchEllipseArc({ sweep: sweep / 100 })
                }
                onScrubPreview={(sweep) =>
                  previewNodeVisual({ arcSweep: sweep / 100 })
                }
                onScrubCommit={(sweep) =>
                  commitEllipseArcScrub({ sweep: sweep / 100 })
                }
                onScrubCancel={cancelNodeVisualPreview}
                min={0}
                max={100}
                step={0.1}
                suffix="%"
                keyframe={
                  <KeyframeButton
                    nodeId={node.id}
                    propertyId="shape.arcSweep"
                    currentValue={liveEllipseArc.sweep}
                  />
                }
              />
              <KeyframeSliderRow
                label="Inner radius"
                value={liveEllipseArc.innerRadius * 100}
                onCommit={(innerRadius) =>
                  patchEllipseArc({ innerRadius: innerRadius / 100 })
                }
                onScrubPreview={(innerRadius) =>
                  previewNodeVisual({ arcInnerRadius: innerRadius / 100 })
                }
                onScrubCommit={(innerRadius) =>
                  commitEllipseArcScrub({ innerRadius: innerRadius / 100 })
                }
                onScrubCancel={cancelNodeVisualPreview}
                min={0}
                max={100}
                step={0.1}
                suffix="%"
                keyframe={
                  <KeyframeButton
                    nodeId={node.id}
                    propertyId="shape.arcInnerRadius"
                    currentValue={liveEllipseArc.innerRadius}
                  />
                }
              />
              <div aria-hidden="true" className="border-t border-border" />
            </>
          ) : null}
          <FillField
            value={liveFill}
            onCommit={(fill) => patchAppearance({ fill })}
            keyframe={
              <KeyframeButton
                nodeId={node.id}
                propertyId="appearance.fill"
                currentValue={
                  liveFill?.kind === 'solid' ? liveFill.color : null
                }
              />
            }
          />
          <div aria-hidden="true" className="border-t border-border" />
          <StrokeControls
            value={node.appearance.stroke}
            onCommit={(stroke) => patchAppearance({ stroke })}
          />
          {node.kind !== 'ellipse' ? (node.appearance.cornerRadii ? (
            <FieldRow
              label="Corner"
              keyframe={
                <KeyframeButton
                  nodeId={node.id}
                  propertyId="appearance.cornerRadius"
                  currentValue={null}
                />
              }
            >
              <CornerField
                uniformValue={liveCornerRadius}
                cornerRadii={node.appearance.cornerRadii}
                onCommitUniform={(v) => patchAppearance({ cornerRadius: v })}
                onPromoteToPerCorner={(initial) =>
                  patchAppearance({ cornerRadii: initial })
                }
                onCommitPerCorner={(next) =>
                  patchAppearance({ cornerRadii: next })
                }
                onClearPerCorner={() =>
                  patchAppearance({ cornerRadii: undefined })
                }
              />
            </FieldRow>
          ) : (
            <KeyframeSliderRow
              label="Corner"
              value={liveCornerRadius}
              onCommit={(v) =>
                patchAppearance({ cornerRadius: Math.max(0, v) })
              }
              onScrubPreview={(v) =>
                previewNodeVisual({ cornerRadius: Math.max(0, v) })
              }
              onScrubCommit={(v) =>
                commitAppearanceScrub({ cornerRadius: Math.max(0, v) })
              }
              onScrubCancel={cancelNodeVisualPreview}
              min={0}
              adaptiveSpan={100}
              step={1}
              suffix="px"
              labelAccessory={
                <CornerLinkButton
                  linked={true}
                  onToggle={() =>
                    patchAppearance({
                      cornerRadii: {
                        tl: liveCornerRadius,
                        tr: liveCornerRadius,
                        br: liveCornerRadius,
                        bl: liveCornerRadius,
                      },
                    })
                  }
                />
              }
              keyframe={
                <KeyframeButton
                  nodeId={node.id}
                  propertyId="appearance.cornerRadius"
                  currentValue={liveCornerRadius}
                />
              }
            />
          )) : null}
          {node.kind === 'frame' ? (
            <SectionToggleRow
              label="Clip"
              value={node.clipsContent}
              plain
              onCommit={(v) =>
                api.setNodeProperty(node.id, 'clipsContent', v)
              }
            />
          ) : null}
        </Section>
      ) : (
        <>{/* camera path emits its own sections below */}</>
      )}

      {node.kind !== 'camera' && (
        <EffectsSection
          nodeId={node.id}
          value={node.appearance.effects ?? []}
          animatedBlur={anim?.effectBlur}
          onCommit={commitEffects}
          onRemove={removeEffect}
          onBlurCommit={commitEffectBlur}
          onBlurPreview={previewEffectBlur}
          onBlurScrubCommit={commitEffectBlurScrub}
          onBlurCancel={cancelNodeVisualPreview}
        />
      )}

      {node.kind === 'camera' && (
        <>
          <Section title="Lens">
            <KeyframeSliderRow
              label="Field of View"
              value={liveFieldOfView}
              onCommit={(v) =>
                patchCamera({ fieldOfView: Math.max(1, Math.min(175, v)) })
              }
              onScrubPreview={(v) =>
                previewCameraProperties({
                  fieldOfView: Math.max(1, Math.min(175, v)),
                })
              }
              onScrubCommit={(v) =>
                commitCameraPropertiesScrub({
                  fieldOfView: Math.max(1, Math.min(175, v)),
                })
              }
              onScrubCancel={cancelCameraPropertiesPreview}
              min={1}
              max={175}
              step={0.5}
              suffix="°"
              keyframe={
                <KeyframeButton
                  nodeId={node.id}
                  propertyId="camera.fieldOfView"
                  currentValue={liveFieldOfView}
                  variant="boxed"
                />
              }
            />
            <KeyframeSliderRow
              label="Clip start"
              value={liveNearClip}
              onCommit={(v) =>
                patchCamera({
                  nearClip: Math.max(0.001, Math.min(liveFarClip - 0.001, v)),
                })
              }
              onScrubPreview={(v) =>
                previewCameraProperties({
                  nearClip: Math.max(
                    0.001,
                    Math.min(liveFarClip - 0.001, v),
                  ),
                })
              }
              onScrubCommit={(v) =>
                commitCameraPropertiesScrub({
                  nearClip: Math.max(
                    0.001,
                    Math.min(liveFarClip - 0.001, v),
                  ),
                })
              }
              onScrubCancel={cancelCameraPropertiesPreview}
              min={0.001}
              max={Math.max(0.002, liveFarClip - 0.001)}
              adaptiveSpan={1000}
              step={0.1}
              keyframe={
                <KeyframeButton
                  nodeId={node.id}
                  propertyId="camera.nearClip"
                  currentValue={liveNearClip}
                />
              }
            />
            <KeyframeSliderRow
              label="Clip end"
              value={liveFarClip}
              onCommit={(v) =>
                patchCamera({ farClip: Math.max(liveNearClip + 0.001, v) })
              }
              onScrubPreview={(v) =>
                previewCameraProperties({
                  farClip: Math.max(liveNearClip + 0.001, v),
                })
              }
              onScrubCommit={(v) =>
                commitCameraPropertiesScrub({
                  farClip: Math.max(liveNearClip + 0.001, v),
                })
              }
              onScrubCancel={cancelCameraPropertiesPreview}
              min={liveNearClip + 0.001}
              adaptiveSpan={100000}
              step={10}
              keyframe={
                <KeyframeButton
                  nodeId={node.id}
                  propertyId="camera.farClip"
                  currentValue={liveFarClip}
                />
              }
            />
            <FillField
              label="Background"
              value={node.background ?? null}
              onCommit={(fill) => api.setNodeProperty(node.id, 'background', fill)}
            />
          </Section>

          <Section title="Depth of Field">
            <SectionToggleRow
              label="Enable"
              value={node.depthOfField ?? false}
              onCommit={(depthOfField) =>
                patchCamera({
                  depthOfField,
                  ...(depthOfField && (node.aperture ?? 0) <= 0
                    ? { aperture: 1 }
                    : {}),
                })
              }
            />
            {node.depthOfField ? (
              <>
                <FieldRow label="Focus mode" layout="compound">
                  <SelectField<CameraNode['focusMode']>
                    value={node.focusMode ?? 'screen'}
                    options={[
                      { value: 'plane', label: 'Distance' },
                      { value: 'screen', label: 'Point' },
                      { value: 'target', label: 'Object' },
                    ]}
                    onCommit={(focusMode) => {
                      const targetId =
                        focusMode === 'target'
                          ? node.focusTargetNodeId ??
                            focusTargetOptions[0]?.value ??
                            null
                          : null
                      patchCamera({ focusMode, focusTargetNodeId: targetId })
                    }}
                    width="w-full"
                  />
                </FieldRow>

                {node.focusMode === 'target' ? (
                  <FieldRow label="Target" layout="compound">
                    <SelectField<string>
                      value={node.focusTargetNodeId ?? ''}
                      options={[
                        { value: '', label: 'Choose layer' },
                        ...focusTargetOptions,
                      ]}
                      onCommit={(focusTargetNodeId) =>
                        patchCamera({
                          focusMode: 'target',
                          focusTargetNodeId: focusTargetNodeId || null,
                        })
                      }
                      width="w-full"
                    />
                  </FieldRow>
                ) : (
                  <KeyframeSliderRow
                    label="Focus distance"
                    value={liveFocusDistance}
                    onCommit={(v) =>
                      patchCamera({
                        focusDistance: v,
                        focusWorldZ: v,
                        focusTargetNodeId: null,
                      })
                    }
                    onScrubPreview={(v) =>
                      previewCameraProperties({
                        focusDistance: v,
                        focusWorldZ: v,
                      })
                    }
                    onScrubCommit={(v) =>
                      commitCameraPropertiesScrub({
                        focusDistance: v,
                        focusWorldZ: v,
                        focusTargetNodeId: null,
                      })
                    }
                    onScrubCancel={cancelCameraPropertiesPreview}
                    adaptiveSpan={2000}
                    step={1}
                    suffix="px"
                    keyframe={
                      <KeyframeButton
                        nodeId={node.id}
                        propertyId="camera.focusDistance"
                        currentValue={liveFocusDistance}
                      />
                    }
                  />
                )}

                {node.focusMode === 'screen' ? (
                  <>
                    <FieldRow label="Pick point">
                      <button
                        type="button"
                        onClick={() =>
                          setFocusPickingCameraId(
                            focusPickingCameraId === node.id ? null : node.id,
                          )
                        }
                        className={[
                          'h-7 w-full rounded-md border px-2 text-[11px] transition-colors',
                          focusPickingCameraId === node.id
                            ? 'border-accent bg-accent/15 text-accent'
                            : 'border-border bg-app-bg text-text-muted hover:border-border-strong hover:text-text',
                        ].join(' ')}
                      >
                        {focusPickingCameraId === node.id
                          ? 'Cancel picking'
                          : 'Pick on canvas'}
                      </button>
                    </FieldRow>
                    <KeyframeSliderRow
                      label="Point X"
                      value={liveFocusX}
                      onCommit={(v) =>
                        patchCamera({
                          focusMode: 'screen',
                          focusX: v,
                          focusWorldX: v,
                          focusTargetNodeId: null,
                        })
                      }
                      onScrubPreview={(v) =>
                        previewCameraProperties({
                          focusX: v,
                          focusWorldX: v,
                        })
                      }
                      onScrubCommit={(v) =>
                        commitCameraPropertiesScrub({
                          focusMode: 'screen',
                          focusX: v,
                          focusWorldX: v,
                          focusTargetNodeId: null,
                        })
                      }
                      onScrubCancel={cancelCameraPropertiesPreview}
                      adaptiveSpan={Math.max(
                        1000,
                        api.getMeta().canvas.width,
                      )}
                      step={1}
                      suffix="px"
                      keyframe={
                        <KeyframeButton
                          nodeId={node.id}
                          propertyId="camera.focusX"
                          currentValue={liveFocusX}
                        />
                      }
                    />
                    <KeyframeSliderRow
                      label="Point Y"
                      value={liveFocusY}
                      onCommit={(v) =>
                        patchCamera({
                          focusMode: 'screen',
                          focusY: v,
                          focusWorldY: v,
                          focusTargetNodeId: null,
                        })
                      }
                      onScrubPreview={(v) =>
                        previewCameraProperties({
                          focusY: v,
                          focusWorldY: v,
                        })
                      }
                      onScrubCommit={(v) =>
                        commitCameraPropertiesScrub({
                          focusMode: 'screen',
                          focusY: v,
                          focusWorldY: v,
                          focusTargetNodeId: null,
                        })
                      }
                      onScrubCancel={cancelCameraPropertiesPreview}
                      adaptiveSpan={Math.max(
                        1000,
                        api.getMeta().canvas.height,
                      )}
                      step={1}
                      suffix="px"
                      keyframe={
                        <KeyframeButton
                          nodeId={node.id}
                          propertyId="camera.focusY"
                          currentValue={liveFocusY}
                        />
                      }
                    />
                    <KeyframeSliderRow
                      label="Point radius"
                      value={liveFocusRadius}
                      onCommit={(v) =>
                        patchCamera({ focusRadius: Math.max(4, v) })
                      }
                      onScrubPreview={(v) =>
                        previewCameraProperties({ focusRadius: Math.max(4, v) })
                      }
                      onScrubCommit={(v) =>
                        commitCameraPropertiesScrub({
                          focusRadius: Math.max(4, v),
                        })
                      }
                      onScrubCancel={cancelCameraPropertiesPreview}
                      min={4}
                      adaptiveSpan={2000}
                      step={5}
                      suffix="px"
                      keyframe={
                        <KeyframeButton
                          nodeId={node.id}
                          propertyId="camera.focusRadius"
                          currentValue={liveFocusRadius}
                          variant="boxed"
                        />
                      }
                    />
                    <KeyframeSliderRow
                      label="Blur falloff"
                      value={liveFocusFalloff}
                      onCommit={(v) =>
                        patchCamera({ focusFalloff: Math.max(1, v) })
                      }
                      onScrubPreview={(v) =>
                        previewCameraProperties({
                          focusFalloff: Math.max(1, v),
                        })
                      }
                      onScrubCommit={(v) =>
                        commitCameraPropertiesScrub({
                          focusFalloff: Math.max(1, v),
                        })
                      }
                      onScrubCancel={cancelCameraPropertiesPreview}
                      min={1}
                      adaptiveSpan={4000}
                      step={5}
                      suffix="px"
                      keyframe={
                        <KeyframeButton
                          nodeId={node.id}
                          propertyId="camera.focusFalloff"
                          currentValue={liveFocusFalloff}
                          variant="boxed"
                        />
                      }
                    />
                    <p className="px-2 text-[10px] leading-4 text-text-dim">
                      Sharp inside Point radius. Blur grows progressively across
                      Blur falloff, reaching Max blur beyond the outer ring.
                    </p>
                  </>
                ) : null}

                <SectionToggleRow
                  label="Show focus plane"
                  value={node.showFocusPlane ?? false}
                  onCommit={(showFocusPlane) =>
                    patchCamera({ showFocusPlane })
                  }
                />

                <div className="!mt-4 border-t border-border pt-3 text-[11px] font-medium uppercase tracking-wide text-text-dim">
                  Aperture
                </div>
                <KeyframeSliderRow
                  label="F-Stop"
                  value={liveFStop}
                  onCommit={(v) =>
                    patchCamera({ fStop: Math.max(0.1, Math.min(64, v)) })
                  }
                  onScrubPreview={(v) =>
                    previewCameraProperties({
                      fStop: Math.max(0.1, Math.min(64, v)),
                    })
                  }
                  onScrubCommit={(v) =>
                    commitCameraPropertiesScrub({
                      fStop: Math.max(0.1, Math.min(64, v)),
                    })
                  }
                  onScrubCancel={cancelCameraPropertiesPreview}
                  min={0.1}
                  max={64}
                  step={0.1}
                  keyframe={
                    <KeyframeButton
                      nodeId={node.id}
                      propertyId="camera.fStop"
                      currentValue={liveFStop}
                      variant="boxed"
                    />
                  }
                />
                <KeyframeSliderRow
                  label="Blades"
                  value={Math.round(liveBladeCount)}
                  onCommit={(v) =>
                    patchCamera({
                      bladeCount: Math.max(3, Math.min(16, Math.round(v))),
                    })
                  }
                  onScrubPreview={(v) =>
                    previewCameraProperties({
                      bladeCount: Math.max(3, Math.min(16, Math.round(v))),
                    })
                  }
                  onScrubCommit={(v) =>
                    commitCameraPropertiesScrub({
                      bladeCount: Math.max(3, Math.min(16, Math.round(v))),
                    })
                  }
                  onScrubCancel={cancelCameraPropertiesPreview}
                  min={3}
                  max={16}
                  step={1}
                  keyframe={
                    <KeyframeButton
                      nodeId={node.id}
                      propertyId="camera.bladeCount"
                      currentValue={liveBladeCount}
                      variant="boxed"
                    />
                  }
                />
                <KeyframeSliderRow
                  label="Rotation"
                  value={liveBladeRotation}
                  onCommit={(bladeRotation) =>
                    patchCamera({ bladeRotation })
                  }
                  onScrubPreview={(bladeRotation) =>
                    previewCameraProperties({ bladeRotation })
                  }
                  onScrubCommit={(bladeRotation) =>
                    commitCameraPropertiesScrub({ bladeRotation })
                  }
                  onScrubCancel={cancelCameraPropertiesPreview}
                  adaptiveSpan={360}
                  step={1}
                  suffix="°"
                  keyframe={
                    <KeyframeButton
                      nodeId={node.id}
                      propertyId="camera.bladeRotation"
                      currentValue={liveBladeRotation}
                    />
                  }
                />
                <KeyframeSliderRow
                  label="Bokeh ratio"
                  value={liveBokehRatio}
                  onCommit={(v) =>
                    patchCamera({
                      bokehRatio: Math.max(0.25, Math.min(4, v)),
                    })
                  }
                  onScrubPreview={(v) =>
                    previewCameraProperties({
                      bokehRatio: Math.max(0.25, Math.min(4, v)),
                    })
                  }
                  onScrubCommit={(v) =>
                    commitCameraPropertiesScrub({
                      bokehRatio: Math.max(0.25, Math.min(4, v)),
                    })
                  }
                  onScrubCancel={cancelCameraPropertiesPreview}
                  min={0.25}
                  max={4}
                  step={0.05}
                  keyframe={
                    <KeyframeButton
                      nodeId={node.id}
                      propertyId="camera.bokehRatio"
                      currentValue={liveBokehRatio}
                      variant="boxed"
                    />
                  }
                />
                <KeyframeSliderRow
                  label="Max blur"
                  value={Math.max(0, Math.min(128, liveBlurLevel))}
                  onCommit={(v) =>
                    patchCamera({ blurLevel: Math.max(0, Math.min(128, v)) })
                  }
                  onScrubPreview={(v) =>
                    previewCameraProperties({
                      blurLevel: Math.max(0, Math.min(128, v)),
                    })
                  }
                  onScrubCommit={(v) =>
                    commitCameraPropertiesScrub({
                      blurLevel: Math.max(0, Math.min(128, v)),
                    })
                  }
                  onScrubCancel={cancelCameraPropertiesPreview}
                  min={0}
                  max={128}
                  step={1}
                  suffix="px"
                  keyframe={
                    <KeyframeButton
                      nodeId={node.id}
                      propertyId="camera.blurLevel"
                      currentValue={liveBlurLevel}
                      variant="boxed"
                    />
                  }
                />
                <FieldRow label="Preview quality" layout="compound">
                  <SelectField<CameraNode['dofPreviewQuality']>
                    value={node.dofPreviewQuality ?? 'balanced'}
                    options={[
                      { value: 'draft', label: 'Draft · 6 taps' },
                      { value: 'balanced', label: 'Balanced · 24 taps' },
                      { value: 'high', label: 'High · 48 taps' },
                    ]}
                    onCommit={(dofPreviewQuality) =>
                      patchCamera({ dofPreviewQuality })
                    }
                    width="w-full"
                  />
                </FieldRow>
                <KeyframeSliderRow
                  label="Export samples"
                  value={liveBlurQuality}
                  onCommit={(v) =>
                    patchCamera({
                      blurQuality: Math.max(24, Math.min(48, Math.round(v))),
                    })
                  }
                  onScrubPreview={(v) =>
                    previewCameraProperties({
                      blurQuality: Math.max(24, Math.min(48, Math.round(v))),
                    })
                  }
                  onScrubCommit={(v) =>
                    commitCameraPropertiesScrub({
                      blurQuality: Math.max(24, Math.min(48, Math.round(v))),
                    })
                  }
                  onScrubCancel={cancelCameraPropertiesPreview}
                  min={24}
                  max={48}
                  step={1}
                  suffix="taps"
                  keyframe={
                    <KeyframeButton
                      nodeId={node.id}
                      propertyId="camera.blurQuality"
                      currentValue={liveBlurQuality}
                      variant="boxed"
                    />
                  }
                />
                <p className="px-2 text-[10px] leading-4 text-text-dim">
                  Preview controls live smoothness. Export samples controls the
                  final rendered bokeh quality.
                </p>
              </>
            ) : (
              <p className="px-2 text-[11px] leading-4 text-text-dim">
                Enable depth of field to configure focus, aperture and quality.
              </p>
            )}
          </Section>
          <Section title="Post Effects">
            <SectionToggleRow
              label="Chromatic aberration"
              value={node.chromaticAberrationEnabled ?? false}
              onCommit={(chromaticAberrationEnabled) =>
                patchCamera({ chromaticAberrationEnabled })
              }
            />
            {node.chromaticAberrationEnabled ? (
              <>
                <p className="px-2 text-[10px] leading-4 text-text-dim">
                  Red and blue each move by Amount in opposite directions.
                </p>
                <KeyframeSliderRow
                  label="Amount"
                  value={liveChromaticAberrationAmount}
                  onCommit={(v) =>
                    patchCamera({
                      chromaticAberrationAmount: Math.max(0, Math.min(64, v)),
                    })
                  }
                  onScrubPreview={(v) =>
                    previewCameraProperties({
                      chromaticAberrationAmount: Math.max(
                        0,
                        Math.min(64, v),
                      ),
                    })
                  }
                  onScrubCommit={(v) =>
                    commitCameraPropertiesScrub({
                      chromaticAberrationAmount: Math.max(
                        0,
                        Math.min(64, v),
                      ),
                    })
                  }
                  onScrubCancel={cancelCameraPropertiesPreview}
                  min={0}
                  max={64}
                  step={0.5}
                  suffix="px"
                  keyframe={
                    <KeyframeButton
                      nodeId={node.id}
                      propertyId="camera.chromaticAberrationAmount"
                      currentValue={liveChromaticAberrationAmount}
                      variant="boxed"
                    />
                  }
                />
                <KeyframeSliderRow
                  label="Angle"
                  value={liveChromaticAberrationAngle}
                  onCommit={(v) =>
                    patchCamera({ chromaticAberrationAngle: v })
                  }
                  onScrubPreview={(chromaticAberrationAngle) =>
                    previewCameraProperties({ chromaticAberrationAngle })
                  }
                  onScrubCommit={(chromaticAberrationAngle) =>
                    commitCameraPropertiesScrub({ chromaticAberrationAngle })
                  }
                  onScrubCancel={cancelCameraPropertiesPreview}
                  adaptiveSpan={360}
                  step={1}
                  suffix="°"
                  keyframe={
                    <KeyframeButton
                      nodeId={node.id}
                      propertyId="camera.chromaticAberrationAngle"
                      currentValue={liveChromaticAberrationAngle}
                      variant="boxed"
                    />
                  }
                />
              </>
            ) : null}

            <div className="border-t border-border" />

            <SectionToggleRow
              label="Bloom"
              value={node.bloomEnabled ?? false}
              onCommit={(bloomEnabled) => patchCamera({ bloomEnabled })}
            />
            {node.bloomEnabled ? (
              <>
                <p className="px-2 text-[10px] leading-4 text-text-dim">
                  Spreads bright pixels into a soft glow around highlights.
                </p>
                <KeyframeSliderRow
                  label="Strength"
                  value={liveBloomStrength}
                  onCommit={(v) =>
                    patchCamera({ bloomStrength: Math.max(0, Math.min(4, v)) })
                  }
                  onScrubPreview={(v) =>
                    previewCameraProperties({
                      bloomStrength: Math.max(0, Math.min(4, v)),
                    })
                  }
                  onScrubCommit={(v) =>
                    commitCameraPropertiesScrub({
                      bloomStrength: Math.max(0, Math.min(4, v)),
                    })
                  }
                  onScrubCancel={cancelCameraPropertiesPreview}
                  min={0}
                  max={4}
                  step={0.05}
                  keyframe={
                    <KeyframeButton
                      nodeId={node.id}
                      propertyId="camera.bloomStrength"
                      currentValue={liveBloomStrength}
                      variant="boxed"
                    />
                  }
                />
                <KeyframeSliderRow
                  label="Radius"
                  value={liveBloomRadius * 100}
                  onCommit={(v) =>
                    patchCamera({
                      bloomRadius: Math.max(0, Math.min(1, v / 100)),
                    })
                  }
                  onScrubPreview={(v) =>
                    previewCameraProperties({
                      bloomRadius: Math.max(0, Math.min(1, v / 100)),
                    })
                  }
                  onScrubCommit={(v) =>
                    commitCameraPropertiesScrub({
                      bloomRadius: Math.max(0, Math.min(1, v / 100)),
                    })
                  }
                  onScrubCancel={cancelCameraPropertiesPreview}
                  min={0}
                  max={100}
                  step={1}
                  suffix="%"
                  keyframe={
                    <KeyframeButton
                      nodeId={node.id}
                      propertyId="camera.bloomRadius"
                      currentValue={liveBloomRadius}
                      variant="boxed"
                    />
                  }
                />
                <KeyframeSliderRow
                  label="Threshold"
                  value={liveBloomThreshold * 100}
                  onCommit={(v) =>
                    patchCamera({
                      bloomThreshold: Math.max(0, Math.min(1, v / 100)),
                    })
                  }
                  onScrubPreview={(v) =>
                    previewCameraProperties({
                      bloomThreshold: Math.max(0, Math.min(1, v / 100)),
                    })
                  }
                  onScrubCommit={(v) =>
                    commitCameraPropertiesScrub({
                      bloomThreshold: Math.max(0, Math.min(1, v / 100)),
                    })
                  }
                  onScrubCancel={cancelCameraPropertiesPreview}
                  min={0}
                  max={100}
                  step={1}
                  suffix="%"
                  keyframe={
                    <KeyframeButton
                      nodeId={node.id}
                      propertyId="camera.bloomThreshold"
                      currentValue={liveBloomThreshold}
                      variant="boxed"
                    />
                  }
                />
              </>
            ) : null}

            <div className="border-t border-border" />

            <SectionToggleRow
              label="VHS tape"
              value={node.vhsEnabled ?? false}
              onCommit={(vhsEnabled) => patchCamera({ vhsEnabled })}
            />
            {node.vhsEnabled ? (
              <>
                <p className="px-2 text-[10px] leading-4 text-text-dim">
                  Adds frame-stable tape wobble, grain, scanlines and color
                  bleed driven by the scene playhead.
                </p>
                <KeyframeSliderRow
                  label="Intensity"
                  value={liveVhsIntensity * 100}
                  onCommit={(v) =>
                    patchCamera({
                      vhsIntensity: Math.max(0, Math.min(1, v / 100)),
                    })
                  }
                  onScrubPreview={(v) =>
                    previewCameraProperties({
                      vhsIntensity: Math.max(0, Math.min(1, v / 100)),
                    })
                  }
                  onScrubCommit={(v) =>
                    commitCameraPropertiesScrub({
                      vhsIntensity: Math.max(0, Math.min(1, v / 100)),
                    })
                  }
                  onScrubCancel={cancelCameraPropertiesPreview}
                  min={0}
                  max={100}
                  step={1}
                  suffix="%"
                  keyframe={
                    <KeyframeButton
                      nodeId={node.id}
                      propertyId="camera.vhsIntensity"
                      currentValue={liveVhsIntensity}
                      variant="boxed"
                    />
                  }
                />
                <KeyframeSliderRow
                  label="Noise"
                  value={liveVhsNoise * 100}
                  onCommit={(v) =>
                    patchCamera({
                      vhsNoise: Math.max(0, Math.min(1, v / 100)),
                    })
                  }
                  onScrubPreview={(v) =>
                    previewCameraProperties({
                      vhsNoise: Math.max(0, Math.min(1, v / 100)),
                    })
                  }
                  onScrubCommit={(v) =>
                    commitCameraPropertiesScrub({
                      vhsNoise: Math.max(0, Math.min(1, v / 100)),
                    })
                  }
                  onScrubCancel={cancelCameraPropertiesPreview}
                  min={0}
                  max={100}
                  step={1}
                  suffix="%"
                  keyframe={
                    <KeyframeButton
                      nodeId={node.id}
                      propertyId="camera.vhsNoise"
                      currentValue={liveVhsNoise}
                      variant="boxed"
                    />
                  }
                />
                <KeyframeSliderRow
                  label="Scanlines"
                  value={liveVhsScanlines * 100}
                  onCommit={(v) =>
                    patchCamera({
                      vhsScanlines: Math.max(0, Math.min(1, v / 100)),
                    })
                  }
                  onScrubPreview={(v) =>
                    previewCameraProperties({
                      vhsScanlines: Math.max(0, Math.min(1, v / 100)),
                    })
                  }
                  onScrubCommit={(v) =>
                    commitCameraPropertiesScrub({
                      vhsScanlines: Math.max(0, Math.min(1, v / 100)),
                    })
                  }
                  onScrubCancel={cancelCameraPropertiesPreview}
                  min={0}
                  max={100}
                  step={1}
                  suffix="%"
                  keyframe={
                    <KeyframeButton
                      nodeId={node.id}
                      propertyId="camera.vhsScanlines"
                      currentValue={liveVhsScanlines}
                      variant="boxed"
                    />
                  }
                />
                <KeyframeSliderRow
                  label="Color bleed"
                  value={liveVhsColorBleed}
                  onCommit={(v) =>
                    patchCamera({
                      vhsColorBleed: Math.max(0, Math.min(32, v)),
                    })
                  }
                  onScrubPreview={(v) =>
                    previewCameraProperties({
                      vhsColorBleed: Math.max(0, Math.min(32, v)),
                    })
                  }
                  onScrubCommit={(v) =>
                    commitCameraPropertiesScrub({
                      vhsColorBleed: Math.max(0, Math.min(32, v)),
                    })
                  }
                  onScrubCancel={cancelCameraPropertiesPreview}
                  min={0}
                  max={32}
                  step={0.5}
                  suffix="px"
                  keyframe={
                    <KeyframeButton
                      nodeId={node.id}
                      propertyId="camera.vhsColorBleed"
                      currentValue={liveVhsColorBleed}
                      variant="boxed"
                    />
                  }
                />
              </>
            ) : null}
          </Section>
          <CameraAnimationActions node={node} api={api} />
        </>
      )}
    </div>
  )
}

function MotionPathSection({
  nodeId,
  path,
  progress,
  onAdd,
  onRemove,
  onPatch,
}: {
  nodeId: NodeId
  path: LayerMotionPath | null
  progress: number
  onAdd: () => void
  onRemove: () => void
  onPatch: (patch: Partial<LayerMotionPath>) => void
}) {
  if (!path) {
    return (
      <Section title="Motion Path">
        <button
          type="button"
          onClick={onAdd}
          className="flex h-8 w-full items-center justify-center rounded-md border border-border bg-panel-raised text-[11px] font-medium text-text-muted hover:border-border-strong hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        >
          Add motion path
        </button>
        <p className="text-[10px] leading-4 text-text-dim">
          Move this layer along an editable Bézier rail.
        </p>
      </Section>
    )
  }

  return (
    <Section
      title="Motion Path"
      action={
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove motion path"
          title="Remove the path and its progress animation"
          className="rounded px-1.5 py-1 text-[10px] font-medium text-text-dim hover:bg-panel-raised hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        >
          Remove
        </button>
      }
    >
      <KeyframeSliderRow
        label="Progress"
        value={Math.round(progress * 100)}
        onCommit={(value) => onPatch({ progress: value / 100 })}
        onScrubPreview={(value) =>
          nodeTransformPreviewStore.preview({
            [nodeId]: { motionPathProgress: value / 100 },
          })
        }
        onScrubCommit={(value) => {
          onPatch({ progress: value / 100 })
          nodeTransformPreviewStore.finish()
        }}
        onScrubCancel={() => nodeTransformPreviewStore.clear()}
        min={0}
        max={100}
        step={1}
        suffix="%"
        keyframe={
          <KeyframeButton
            nodeId={nodeId}
            propertyId="motionPath.progress"
            currentValue={progress}
          />
        }
      />
      <FieldRow label="Follow path">
        <CheckboxField
          value={path.autoOrient}
          onCommit={(autoOrient) => onPatch({ autoOrient })}
        />
      </FieldRow>
      <FieldRow label="Rotation offset">
        <NumberField
          value={path.rotationOffset}
          onCommit={(rotationOffset) => onPatch({ rotationOffset })}
          step={1}
          suffix="°"
          ariaLabel="Motion path rotation offset"
        />
      </FieldRow>
      <FieldRow label="Constant speed">
        <CheckboxField
          value={path.parameterization === 'arc-length'}
          onCommit={(constantSpeed) =>
            onPatch({
              parameterization: constantSpeed
                ? 'arc-length'
                : 'parametric',
            })
          }
        />
      </FieldRow>
      <TextMotionPathEditor
        path={path}
        normalizePath={normalizeLayerMotionPath}
        onCommit={(next) => onPatch({ points: next.points })}
        onReset={() =>
          onPatch({ points: defaultLayerMotionPath().points })
        }
        unitLabel="pixels"
        startLabel="Start"
        endLabel="End"
        nudgeStep={1}
        maxPoints={MAX_LAYER_MOTION_PATH_POINTS}
        helperText="Drag points and handles to shape the layer rail in local pixels. The layer's transform remains the fixed start."
      />
    </Section>
  )
}

function CameraViewportControlsHint() {
  const recording = useUI((state) => state.recording)
  const controls = [
    { shortcut: 'MMB / Option-drag', action: 'Orbit' },
    { shortcut: 'Shift+MMB / Shift-scroll', action: 'Pan' },
    { shortcut: 'Ctrl+MMB / Scroll', action: 'Dolly' },
    { shortcut: 'Cmd/Ctrl-scroll', action: 'Canvas zoom' },
  ] as const

  return (
    <aside
      aria-label="Camera viewport controls"
      className="rounded border border-border bg-panel-raised px-2.5 py-2"
    >
      <div className="mb-2 text-[10px] font-semibold tracking-[0.08em] text-text-muted uppercase">
        Viewport controls
      </div>
      <dl className="space-y-1">
        {controls.map(({ shortcut, action }) => (
          <div
            key={action}
            className="flex min-w-0 items-center justify-between gap-2 text-[10px]"
          >
            <dt>
              <kbd className="font-mono text-text-muted">{shortcut}</kbd>
            </dt>
            <dd className="shrink-0 text-text-dim">{action}</dd>
          </div>
        ))}
      </dl>
      <div
        aria-live="polite"
        className={[
          'mt-2 flex items-start gap-1.5 border-t border-border pt-2 text-[10px] leading-4',
          recording ? 'text-red-500' : 'text-text-dim',
        ].join(' ')}
      >
        <span
          aria-hidden
          className={[
            'mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full',
            recording ? 'bg-red-500' : 'bg-text-dim',
          ].join(' ')}
        />
        <span>
          {recording
            ? 'Auto Key is on — camera gestures record to the timeline.'
            : 'Enable Auto Key in the timeline to record camera gestures.'}
        </span>
      </div>
    </aside>
  )
}

function CameraSectionResetButton({
  label,
  title,
  onClick,
}: {
  label: string
  title: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      onClick={onClick}
      className="rounded border border-border bg-panel px-1.5 py-1 text-[10px] font-medium text-text-muted hover:border-border-strong hover:text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
    >
      Reset scene
    </button>
  )
}

/**
 * Clear every animation track on the camera. The neutral-pose reset commands
 * now live beside their Position / Rotation section titles and intentionally
 * keyframe their values, so keeping the old non-keyframing "Reset transform"
 * button here would expose two conflicting reset behaviors.
 */
function CameraAnimationActions({ node, api }: { node: Node; api: SceneAPI }) {
  const tracks = api.getTracksForNode(node.id)
  if (tracks.length === 0) return null
  return (
    <div className="mt-2 flex flex-col gap-1">
      <button
        type="button"
        onClick={() => {
          api.doc.transact(() => {
            for (const t of tracks) removeTrack(api, t.id)
          })
        }}
        title="Remove every animation track on the camera. Static transform stays."
        className="rounded border border-border bg-panel px-2 py-1.5 text-[11px] text-text-muted hover:border-border-strong hover:text-text"
      >
        Clear animation ({tracks.length}{' '}
        {tracks.length === 1 ? 'track' : 'tracks'})
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Uniform Scale — single percent field used for cameras. Anamorphic
// camera scaling (X ≠ Y) isn't physically meaningful, and a single
// number matches how every other motion tool handles camera zoom. The
// field keeps `scaleX` and `scaleY` perfectly in sync via the parent's
// onCommit (which writes both), and the keyframe diamond stamps on
// BOTH `transform.scaleX` and `transform.scaleY` tracks together so an
// animated zoom never produces a stretched view.
// ---------------------------------------------------------------------------

export function UniformScaleField({
  nodeId,
  value,
  onCommit,
}: {
  nodeId: NodeId
  value: number
  onCommit: (next: number) => void
}) {
  const playhead = useUI((s) => s.playhead)
  const api = useSceneAPI()

  // Camera scale is uniform — only `transform.scaleX` carries the
  // animation track. The renderer reads scaleX and applies it to BOTH
  // axes when drawing the camera (see Canvas.tsx camera transform).
  // No matching scaleY track means the timeline shows ONE row, not
  // two, and there's no way to drift into anamorphic view.
  const track = findTrack(api, nodeId, 'transform.scaleX')
  const atPlayhead = findKeyframeAt(
    api,
    nodeId,
    'transform.scaleX',
    playhead,
  )
  const hasTrack = !!(track && track.keyframes.length)

  const onToggleKf = () => {
    toggleKeyframe(api, nodeId, 'transform.scaleX', playhead, value)
  }

  const state: 'at' | 'track' | 'none' = atPlayhead
    ? 'at'
    : hasTrack
      ? 'track'
      : 'none'

  return (
    <div className="flex w-full items-center gap-1">
      <UniformPercent value={value} onCommit={onCommit} />
      <button
        type="button"
        onClick={onToggleKf}
        title={
          state === 'at'
            ? `Remove keyframe at ${playhead.toFixed(2)}s`
            : state === 'track'
              ? `Add keyframe at ${playhead.toFixed(2)}s`
              : 'Add first keyframe (creates track)'
        }
        aria-label={
          state === 'at' ? 'Remove keyframe' : 'Add keyframe'
        }
        className="group flex h-4 w-4 shrink-0 items-center justify-center"
      >
        <span
          className={[
            'block h-[9px] w-[9px] rotate-45 border transition-colors',
            state === 'at'
              ? 'border-keyframe bg-keyframe group-hover:brightness-125'
              : state === 'track'
                ? 'border-keyframe bg-transparent group-hover:bg-keyframe/40'
                : 'border-text-dim/50 bg-transparent group-hover:border-keyframe group-hover:bg-keyframe/20',
          ].join(' ')}
        />
      </button>
    </div>
  )
}

/**
 * Bare percent input for the uniform-scale field. Same chrome pattern
 * as ScalePairField's PercentField — chrome on the wrapping label,
 * suffix in the flex flow so it never overlaps the digits.
 */
function UniformPercent({
  value,
  onCommit,
}: {
  value: number
  onCommit: (next: number) => void
}) {
  const [draft, setDraft] = useState(() => formatPct(value))
  const [focused, setFocused] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  const cancelBlurCommitRef = useRef(false)

  const commit = () => {
    const parsed = parseNumericExpression(draft)
    if (parsed == null) {
      setDraft(formatPct(value))
      return
    }
    const nextScale = parsed / 100
    if (nextScale !== value) onCommit(nextScale)
    setDraft(formatPct(nextScale))
  }

  return (
    <label
      className="hm-control-surface inline-flex h-7 min-w-0 flex-1 items-center"
      title="Uniform camera scale"
    >
      <input
        ref={ref}
        type="text"
        inputMode="decimal"
        value={focused ? draft : formatNumericDisplayValue(value * 100)}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => {
          setDraft(formatPct(value))
          setFocused(true)
          cancelBlurCommitRef.current = false
          e.currentTarget.select()
        }}
        onBlur={() => {
          setFocused(false)
          if (cancelBlurCommitRef.current) {
            cancelBlurCommitRef.current = false
          } else {
            commit()
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            ref.current?.blur()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            cancelBlurCommitRef.current = true
            setDraft(formatPct(value))
            ref.current?.blur()
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            const multiplier = e.shiftKey ? 10 : e.altKey ? 0.1 : 1
            const delta = (e.key === 'ArrowUp' ? 1 : -1) * multiplier
            const current = parseNumericExpression(draft) ?? value * 100
            const nextPct = stabilizeNumericValue(current + delta)
            setDraft(formatPctNumber(nextPct))
            onCommit(nextPct / 100)
          }
        }}
        className="min-w-0 flex-1 bg-transparent pl-1.5 py-0.5 text-right font-mono text-[12px] tabular-nums text-text outline-none"
      />
      <span
        className="pointer-events-none select-none pr-1.5 pl-0.5 text-[11px] text-text-dim"
        aria-hidden="true"
      >
        %
      </span>
    </label>
  )
}

function formatPct(scale: number): string {
  return formatPctNumber(stabilizeNumericValue(scale * 100))
}
function formatPctNumber(p: number): string {
  return formatNumericValue(p)
}

// ---------------------------------------------------------------------------
// Effects section — Figma-style stack of drop shadows, inner shadows,
// and layer blurs. The user can add multiple entries in any order, and
// each one renders in array order (later entries paint on top, exactly
// like Figma).
//
// Each row has a kind picker, the shape-specific controls, an eye toggle
// for visibility, and an X to delete. Reordering is via the up/down
// arrows for now — drag-and-drop reorder is a follow-up if anyone asks.
// ---------------------------------------------------------------------------

function EffectsSection({
  nodeId,
  value,
  animatedBlur,
  onCommit,
  onRemove,
  onBlurCommit,
  onBlurPreview,
  onBlurScrubCommit,
  onBlurCancel,
}: {
  nodeId: NodeId
  value: Effect[]
  animatedBlur?: Readonly<Record<string, number>>
  onCommit: (next: Effect[]) => void
  onRemove: (effectId: string, next: Effect[]) => void
  onBlurCommit: (effectId: string, value: number) => void
  onBlurPreview: (effectId: string, value: number) => void
  onBlurScrubCommit: (effectId: string, value: number) => void
  onBlurCancel: () => void
}) {
  const addEffect = () => {
    // New shadows default to a soft drop shadow that's visible on
    // most fills — small offset, ~8px blur, 30% black. Matches what
    // Figma drops in when you click + Drop Shadow.
    const next: Effect = {
      kind: 'shadow',
      color: 'oklch(0.18 0.004 280 / 0.30)',
      offsetX: 0,
      offsetY: 4,
      blur: 8,
      spread: 0,
      visible: true,
    }
    onCommit([...value, next])
  }

  const updateAt = (i: number, patch: Partial<Effect>) => {
    const next = value.slice()
    next[i] = { ...next[i], ...patch } as Effect
    onCommit(next)
  }

  const removeAt = (i: number) => {
    const effect = value[i]
    if (!effect) return
    onRemove(
      effectStableId(effect, i),
      value.filter((_, idx) => idx !== i),
    )
  }

  const moveUp = (i: number) => {
    if (i === 0) return
    const next = value.slice()
    ;[next[i - 1], next[i]] = [next[i]!, next[i - 1]!]
    onCommit(next)
  }

  const moveDown = (i: number) => {
    if (i === value.length - 1) return
    const next = value.slice()
    ;[next[i], next[i + 1]] = [next[i + 1]!, next[i]!]
    onCommit(next)
  }

  return (
    <Section
      title="Effects"
      action={
        <button
          type="button"
          onClick={addEffect}
          title="Add effect"
          className="flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-panel-raised hover:text-text"
        >
          +
        </button>
      }
    >
      {value.length === 0 ? (
        <div className="text-[11px] text-text-dim">
          No effects. Click + to add a drop shadow, inner shadow, or
          layer blur.
        </div>
      ) : (
        <div className="space-y-2">
          {value.map((effect, i) => {
            const effectId = effectStableId(effect, i)
            const staticBlur =
              effect.kind === 'blur' ? effect.amount : effect.blur
            const liveBlur = normalizedEffectBlur(
              effect,
              animatedBlur?.[effectId] ?? staticBlur,
            )
            return (
              <EffectRow
                key={effectId}
                nodeId={nodeId}
                effectId={effectId}
                effect={effect}
                liveBlur={liveBlur}
                onChange={(patch) => updateAt(i, patch)}
                onRemove={() => removeAt(i)}
                onMoveUp={() => moveUp(i)}
                onMoveDown={() => moveDown(i)}
                canMoveUp={i > 0}
                canMoveDown={i < value.length - 1}
                onBlurCommit={(next) => onBlurCommit(effectId, next)}
                onBlurPreview={(next) => onBlurPreview(effectId, next)}
                onBlurScrubCommit={(next) =>
                  onBlurScrubCommit(effectId, next)
                }
                onBlurCancel={onBlurCancel}
              />
            )
          })}
        </div>
      )}
    </Section>
  )
}

function EffectRow({
  nodeId,
  effectId,
  effect,
  liveBlur,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  onBlurCommit,
  onBlurPreview,
  onBlurScrubCommit,
  onBlurCancel,
}: {
  nodeId: NodeId
  effectId: string
  effect: Effect
  liveBlur: number
  onChange: (patch: Partial<Effect>) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  canMoveUp: boolean
  canMoveDown: boolean
  onBlurCommit: (value: number) => void
  onBlurPreview: (value: number) => void
  onBlurScrubCommit: (value: number) => void
  onBlurCancel: () => void
}) {
  const visible = effect.visible !== false
  // Convert kind in-place. We rebuild the row so the new kind picks up
  // the right defaults — switching from blur → shadow shouldn't drag a
  // dangling `amount` field along, etc.
  const setKind = (kind: Effect['kind']) => {
    if (effect.kind === kind) return
    if (kind === 'shadow') {
      onChange({
        kind: 'shadow',
        color: 'oklch(0.18 0.004 280 / 0.30)',
        offsetX: 0,
        offsetY: 4,
        blur: 8,
        spread: 0,
        visible,
      } as Partial<Effect>)
      return
    }
    if (kind === 'inner-shadow') {
      onChange({
        kind: 'inner-shadow',
        color: 'oklch(0.18 0.004 280 / 0.30)',
        offsetX: 0,
        offsetY: 4,
        blur: 8,
        spread: 0,
        visible,
      } as Partial<Effect>)
      return
    }
    onChange({ kind: 'blur', amount: 4, visible } as Partial<Effect>)
  }

  return (
    <div className="rounded-md bg-app-bg p-2 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <SelectField<Effect['kind']>
          value={effect.kind}
          options={[
            { value: 'shadow', label: 'Drop shadow' },
            { value: 'inner-shadow', label: 'Inner shadow' },
            { value: 'blur', label: 'Layer blur' },
          ]}
          onCommit={setKind}
          width="flex-1"
        />
        <button
          type="button"
          onClick={() => onMoveUp()}
          disabled={!canMoveUp}
          title="Move up"
          className="flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-panel-raised hover:text-text disabled:opacity-30 disabled:hover:bg-transparent"
        >
          ↑
        </button>
        <button
          type="button"
          onClick={() => onMoveDown()}
          disabled={!canMoveDown}
          title="Move down"
          className="flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-panel-raised hover:text-text disabled:opacity-30 disabled:hover:bg-transparent"
        >
          ↓
        </button>
        <button
          type="button"
          onClick={() => onChange({ visible: !visible } as Partial<Effect>)}
          title={visible ? 'Hide effect' : 'Show effect'}
          className={[
            'flex h-6 w-6 items-center justify-center rounded text-[11px]',
            visible
              ? 'text-text hover:bg-panel-raised'
              : 'text-text-dim hover:bg-panel-raised hover:text-text',
          ].join(' ')}
        >
          {visible ? '👁' : '◌'}
        </button>
        <button
          type="button"
          onClick={onRemove}
          title="Delete effect"
          className="flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-panel-raised hover:text-text"
        >
          ×
        </button>
      </div>
      {effect.kind === 'blur' ? (
        <EffectBlurSlider
          nodeId={nodeId}
          effectId={effectId}
          value={liveBlur}
          layerBlur
          onCommit={onBlurCommit}
          onScrubPreview={onBlurPreview}
          onScrubCommit={onBlurScrubCommit}
          onScrubCancel={onBlurCancel}
        />
      ) : (
        <ShadowFields
          nodeId={nodeId}
          effectId={effectId}
          effect={effect}
          liveBlur={liveBlur}
          onChange={onChange}
          onBlurCommit={onBlurCommit}
          onBlurPreview={onBlurPreview}
          onBlurScrubCommit={onBlurScrubCommit}
          onBlurCancel={onBlurCancel}
        />
      )}
    </div>
  )
}

function normalizedEffectBlur(effect: Effect, value: number): number {
  return effect.kind === 'blur'
    ? clampLayerBlurAmount(value)
    : Math.max(0, Number.isFinite(value) ? value : 0)
}

function EffectBlurSlider({
  nodeId,
  effectId,
  value,
  layerBlur = false,
  onCommit,
  onScrubPreview,
  onScrubCommit,
  onScrubCancel,
}: {
  nodeId: NodeId
  effectId: string
  value: number
  layerBlur?: boolean
  onCommit: (value: number) => void
  onScrubPreview: (value: number) => void
  onScrubCommit: (value: number) => void
  onScrubCancel: () => void
}) {
  return (
    <KeyframeSliderRow
      label="Blur"
      value={value}
      onCommit={onCommit}
      onScrubPreview={onScrubPreview}
      onScrubCommit={onScrubCommit}
      onScrubCancel={onScrubCancel}
      min={0}
      {...(layerBlur
        ? { max: MAX_LAYER_BLUR_PX }
        : { sliderMin: 0, sliderMax: MAX_LAYER_BLUR_PX })}
      step={0.1}
      suffix="px"
      keyframe={
        <KeyframeButton
          nodeId={nodeId}
          propertyId={effectBlurPropertyId(effectId)}
          currentValue={value}
          staggerable={false}
        />
      }
    />
  )
}

/**
 * Color + offset/blur/spread for drop and inner shadows. Inner is a
 * ShadowEffect with `kind: 'inner-shadow'`; the only difference between
 * the two paths is the kind tag — fields are identical.
 */
function ShadowFields({
  nodeId,
  effectId,
  effect,
  liveBlur,
  onChange,
  onBlurCommit,
  onBlurPreview,
  onBlurScrubCommit,
  onBlurCancel,
}: {
  nodeId: NodeId
  effectId: string
  effect: Extract<Effect, { kind: 'shadow' | 'inner-shadow' }>
  liveBlur: number
  onChange: (patch: Partial<Effect>) => void
  onBlurCommit: (value: number) => void
  onBlurPreview: (value: number) => void
  onBlurScrubCommit: (value: number) => void
  onBlurCancel: () => void
}) {
  return (
    <>
      <FieldRow label="Color">
        <ColorField
          value={effect.color}
          onCommit={(color) => onChange({ color } as Partial<Effect>)}
        />
      </FieldRow>
      <FieldRow label="X / Y">
        <NumberField
          value={effect.offsetX}
          onCommit={(v) => onChange({ offsetX: v } as Partial<Effect>)}
          width="w-16"
        />
        <NumberField
          value={effect.offsetY}
          onCommit={(v) => onChange({ offsetY: v } as Partial<Effect>)}
          width="w-16"
        />
      </FieldRow>
      <EffectBlurSlider
        nodeId={nodeId}
        effectId={effectId}
        value={liveBlur}
        onCommit={onBlurCommit}
        onScrubPreview={onBlurPreview}
        onScrubCommit={onBlurScrubCommit}
        onScrubCancel={onBlurCancel}
      />
      <FieldRow label="Spread">
        <NumberField
          value={effect.spread ?? 0}
          onCommit={(v) => onChange({ spread: v } as Partial<Effect>)}
          suffix="px"
        />
      </FieldRow>
    </>
  )
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

function ExposeComponentPropertiesSection({
  node,
  api,
}: {
  node: Node
  api: SceneAPI
}) {
  const component = findOwningComponent(api, node.id)
  if (!component || node.id === component.id) return null
  const exposed = new Set(
    component.componentProperties
      .filter((prop) => prop.nodeId === node.id)
      .map((prop) => prop.path),
  )
  const options = exposeOptionsForNode(node)
  if (options.length === 0) return null
  return (
    <Section title="Expose">
      <p className="mb-2 text-[11px] leading-4 text-text-dim">
        Make selected layer properties editable on instances.
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        {options.map((option) => {
          const active = exposed.has(option.path)
          const existing = component.componentProperties.find(
            (prop) => prop.nodeId === node.id && prop.path === option.path,
          )
          return (
            <button
              key={option.path}
              type="button"
              onClick={() =>
                active && existing
                  ? removeComponentProperty(api, component.id, existing.id)
                  : exposeComponentProperty(
                      api,
                      node.id,
                      option.path,
                      option.type,
                      `${node.name} ${option.name}`,
                    )
              }
              className={[
                'h-7 rounded-md border px-2 text-left text-[11px] font-medium',
                active
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-border bg-panel-raised text-text-muted hover:border-border-strong hover:text-text',
              ].join(' ')}
            >
              {option.name}
            </button>
          )
        })}
      </div>
    </Section>
  )
}

export function InstanceComponentPropertiesSection({
  node,
  api,
}: {
  node: Extract<Node, { kind: 'instance' }>
  api: SceneAPI
}) {
  const component = api.getNode(node.componentId)
  if (!component || component.kind !== 'component') return null
  if (component.componentProperties.length === 0) return null
  return (
    <Section title="Properties">
      <div className="space-y-2">
        {component.componentProperties.map((property) => {
          const source = api.getNode(property.nodeId)
          if (!source) return null
          const value = componentPropertyValue(node, source, property)
          const overridden = hasPathValue(
            node.overrides[property.nodeId] ?? {},
            property.path,
          )
          return (
            <div key={property.id} className="rounded-md border border-border bg-panel-raised p-2">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-[11px] font-semibold text-text">
                    {property.name}
                  </div>
                  <div className="truncate text-[10px] text-text-dim">
                    {source.name}
                  </div>
                </div>
                {overridden ? (
                  <button
                    type="button"
                    onClick={() =>
                      resetInstanceComponentProperty(api, node.id, property.id)
                    }
                    className="h-6 rounded border border-border px-1.5 text-[10px] text-text-muted hover:text-text"
                  >
                    Reset
                  </button>
                ) : null}
              </div>
              <ComponentPropertyControl
                property={property}
                value={value}
                onCommit={(next) =>
                  setInstanceComponentProperty(api, node.id, property.id, next)
                }
              />
            </div>
          )
        })}
      </div>
    </Section>
  )
}

function ComponentVariablesSection({
  node,
  api,
}: {
  node: Extract<Node, { kind: 'component' | 'instance' }>
  api: SceneAPI
}) {
  const [propertyMenuOpen, setPropertyMenuOpen] = useState(false)
  const recording = useUI((s) => s.recording)
  const animationNodeIds = useMemo(
    () => (node.kind === 'instance' ? [node.id] : []),
    [node.id, node.kind],
  )
  const animatedValues = useAnimatedValues(animationNodeIds)
  const component =
    node.kind === 'component' ? node : api.getNode(node.componentId)
  if (!component || component.kind !== 'component') return null
  const stateAxis = component.variants.find((axis) => axis.name === 'State')
  const values = stateAxis?.values.length ? stateAxis.values : ['Default']
  const animatedState =
    node.kind === 'instance'
      ? animatedValues[node.id]?.variant?.State
      : undefined
  const selectedState =
    node.kind === 'instance'
      ? animatedState ??
        node.selection.State ??
        component.defaultSelection.State ??
        values[0]!
      : component.defaultSelection.State ?? values[0]!
  const currentState = values.includes(selectedState) ? selectedState : values[0]!
  const stateLabel =
    node.kind === 'instance' ? 'Current state' : 'Default state'
  const currentSelection =
    node.kind === 'instance'
      ? {
          ...component.defaultSelection,
          ...node.selection,
          State: currentState,
        }
      : component.defaultSelection
  const cursorInstance =
    node.kind === 'instance' && isCursorInstance(api, node)
  const commitState = (value: string) => {
    if (node.kind === 'instance') {
      applyInstanceVariantTransition(
        api,
        node.id,
        { State: value },
        {
          playhead: currentAnimationAuthorTime(),
          keyframe: recording,
        },
      )
      return
    }
    api.setNodeProperty(component.id, 'defaultSelection', {
      ...component.defaultSelection,
      State: value,
    } as never)
  }
  const showComponentProperties =
    node.kind === 'component' || component.componentProperties.length > 0

  return (
    <Section title={component.name}>
      <div className="space-y-3">
        <FieldRow
          label={stateLabel}
          keyframe={
            cursorInstance ? (
              <KeyframeButton
                nodeId={node.id}
                propertyId="variant"
                currentValue={currentSelection}
              />
            ) : undefined
          }
        >
          <SelectField<string>
            value={currentState}
            options={values}
            width="w-full"
            ariaLabel={stateLabel}
            onCommit={commitState}
          />
        </FieldRow>

        {showComponentProperties ? (
          <div className="relative border-t border-border pt-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[12px] font-semibold text-text-dim">
                Properties
              </div>
              {node.kind === 'component' ? (
                <button
                  type="button"
                  onClick={() => setPropertyMenuOpen((open) => !open)}
                  className="hm-icon-button text-[18px] leading-none"
                  aria-label="Create property"
                >
                  +
                </button>
              ) : null}
            </div>
            {propertyMenuOpen && node.kind === 'component' ? (
              <div className="hm-popover-surface absolute right-0 top-8 z-20 w-44 p-2 text-text">
                <div className="px-2 pb-1.5 text-[11px] text-text-dim">
                  Create property
                </div>
                {[
                  ['◇', 'Variant'],
                  ['T', 'Text'],
                  ['◉', 'Boolean'],
                  ['◇', 'Instance swap'],
                  ['⊞', 'Slot'],
                ].map(([icon, label]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setPropertyMenuOpen(false)}
                    className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] text-text-muted hover:bg-control hover:text-text"
                  >
                    <span className="grid h-4 w-4 place-items-center font-mono text-[13px]">
                      {icon}
                    </span>
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            ) : null}

            <div className="space-y-1">
              {component.componentProperties.map((property) => {
                const source = api.getNode(property.nodeId)
                if (!source) return null
                const value =
                  node.kind === 'instance'
                    ? componentPropertyValue(node, source, property)
                    : getPathValue(
                        source as unknown as Record<string, unknown>,
                        property.path,
                      )
                const overridden =
                  node.kind === 'instance' &&
                  hasPathValue(
                    node.overrides[property.nodeId] ?? {},
                    property.path,
                  )
                return (
                  <ComponentPropertyRow
                    key={property.id}
                    icon={componentPropertyIcon(property.type)}
                    name={property.name}
                    value={formatComponentPropertyValue(value, property)}
                    control={
                      <div className="space-y-1.5">
                        {node.kind === 'component' ? (
                          <TextField
                            value={property.name}
                            onCommit={(name) =>
                              updateComponentPropertyDefinition(
                                api,
                                component.id,
                                property.id,
                                { name: name.trim() || property.name },
                              )
                            }
                            allowEmpty={false}
                          />
                        ) : null}
                        <ComponentPropertyControl
                          property={property}
                          value={value}
                          onCommit={(next) =>
                            node.kind === 'instance'
                              ? setInstanceComponentProperty(
                                  api,
                                  node.id,
                                  property.id,
                                  next,
                                )
                              : setComponentSourceProperty(
                                  api,
                                  component.id,
                                  property.id,
                                  next,
                                )
                          }
                        />
                        <div className="flex items-center justify-between gap-2">
                          <div className="truncate text-[10px] text-text-dim">
                            {source.name} · {variablePathLabel(property.path)}
                          </div>
                          <div className="flex shrink-0 gap-1">
                            {overridden ? (
                              <button
                                type="button"
                                onClick={() =>
                                  resetInstanceComponentProperty(
                                    api,
                                    node.id,
                                    property.id,
                                  )
                                }
                                className="h-6 rounded px-1.5 text-[10px] text-text-muted hover:bg-panel-raised hover:text-text"
                              >
                                Reset
                              </button>
                            ) : null}
                            {node.kind === 'component' ? (
                              <button
                                type="button"
                                onClick={() =>
                                  removeComponentProperty(
                                    api,
                                    component.id,
                                    property.id,
                                  )
                                }
                                className="h-6 rounded px-1.5 text-[10px] text-text-muted hover:bg-panel-raised hover:text-danger"
                              >
                                Remove
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    }
                  />
                )
              })}
            </div>
          </div>
        ) : null}
      </div>
    </Section>
  )
}

function ComponentPropertyRow({
  icon,
  name,
  value,
  control,
}: {
  icon: string
  name: string
  value: string
  control: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-md bg-panel-raised">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-8 w-full items-center gap-2 px-2 text-left"
      >
        <span className="grid h-5 w-5 shrink-0 place-items-center rounded border border-border bg-panel font-mono text-[11px] text-text-muted">
          {icon}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-text">
          {name}
          <span className="font-normal text-text-dim"> · {value}</span>
        </span>
      </button>
      {open ? <div className="border-t border-border px-2 py-2">{control}</div> : null}
    </div>
  )
}

function ComponentPropertyControl({
  property,
  value,
  onCommit,
}: {
  property: ComponentPropertyDefinition
  value: unknown
  onCommit: (value: unknown) => void
}) {
  if (property.type === 'text') {
    return (
      <TextField
        value={typeof value === 'string' ? value : ''}
        onCommit={onCommit}
        allowEmpty
      />
    )
  }
  if (property.type === 'fill') {
    return (
      <FillField
        label=""
        value={(value as Node['appearance']['fill']) ?? null}
        onCommit={onCommit}
      />
    )
  }
  if (property.type === 'color') {
    return (
      <ColorField
        value={typeof value === 'string' ? value : '#0a0a0c'}
        onCommit={(color) => {
          if (color) onCommit(color)
        }}
      />
    )
  }
  if (property.type === 'stroke') {
    return (
      <StrokeControls
        value={(value as Stroke | null) ?? null}
        onCommit={onCommit}
      />
    )
  }
  if (property.type === 'size') {
    const size = value as Size | undefined
    return (
      <div className="space-y-1">
        <SizeAxisField
          value={size?.width ?? 'hug'}
          onCommit={(width) => onCommit({ ...(size ?? {}), width })}
        />
        <SizeAxisField
          value={size?.height ?? 'hug'}
          onCommit={(height) => onCommit({ ...(size ?? {}), height })}
        />
      </div>
    )
  }
  if (property.type === 'boolean') {
    return (
      <CheckboxField
        value={typeof value === 'boolean' ? value : false}
        onCommit={onCommit}
      />
    )
  }
  return (
    <NumberField
      value={typeof value === 'number' ? value : 0}
      onCommit={onCommit}
      step={property.path.includes('opacity') ? 0.05 : 1}
      min={property.path.includes('opacity') ? 0 : undefined}
      max={property.path.includes('opacity') ? 1 : undefined}
    />
  )
}

function exposeOptionsForNode(node: Node): ComponentPropertyDefinition[] {
  const options: ComponentPropertyDefinition[] = []
  if (node.kind === 'text') {
    options.push(
      exposeOption('Text', node.id, 'text', 'text'),
      exposeOption('Text color', node.id, 'color', 'color'),
    )
  }
  if ('size' in node) {
    options.push(exposeOption('Size', node.id, 'size', 'size'))
  }
  if (node.kind !== 'camera') {
    options.push(
      exposeOption('Fill', node.id, 'appearance.fill', 'fill'),
      exposeOption('Stroke', node.id, 'appearance.stroke', 'stroke'),
      exposeOption('Border width', node.id, 'appearance.stroke.width', 'number'),
      exposeOption('Radius', node.id, 'appearance.cornerRadius', 'number'),
      exposeOption('Opacity', node.id, 'appearance.opacity', 'number'),
    )
  }
  if (node.kind === 'frame') {
    options.push(exposeOption('Clip content', node.id, 'clipsContent', 'boolean'))
  }
  return options
}

function exposeOption(
  name: string,
  nodeId: NodeId,
  path: string,
  type: ComponentPropertyDefinition['type'],
): ComponentPropertyDefinition {
  return { id: path, name, nodeId, path, type }
}

function componentPropertyValue(
  instance: Extract<Node, { kind: 'instance' }>,
  source: Node,
  property: ComponentPropertyDefinition,
): unknown {
  const override = getPathValue(instance.overrides[property.nodeId] ?? {}, property.path)
  if (override !== undefined) return override
  return getPathValue(source as unknown as Record<string, unknown>, property.path)
}

function componentPropertyIcon(type: ComponentPropertyDefinition['type']): string {
  switch (type) {
    case 'text':
      return 'T'
    case 'boolean':
      return 'O'
    case 'fill':
    case 'color':
    case 'stroke':
      return 'C'
    case 'size':
      return 'W'
    case 'number':
      return '#'
    default:
      return 'P'
  }
}

function formatComponentPropertyValue(
  value: unknown,
  property: ComponentPropertyDefinition,
): string {
  if (property.type === 'boolean') return value ? 'True' : 'False'
  if (property.type === 'text') {
    return truncatePropertyValue(typeof value === 'string' ? value : '')
  }
  if (property.type === 'number') {
    return typeof value === 'number' ? String(Number(value.toFixed(2))) : '0'
  }
  if (property.type === 'size') {
    const size = value as Partial<Size> | undefined
    return `${formatSizeAxis(size?.width)} x ${formatSizeAxis(size?.height)}`
  }
  if (property.type === 'color') return typeof value === 'string' ? value : 'Color'
  if (property.type === 'fill') return value ? 'Fill' : 'None'
  if (property.type === 'stroke') return value ? 'Stroke' : 'None'
  return truncatePropertyValue(value == null ? 'None' : String(value))
}

function truncatePropertyValue(value: string): string {
  return value.length > 34 ? `${value.slice(0, 31)}...` : value
}

function formatSizeAxis(value: unknown): string {
  if (typeof value === 'number') return String(Math.round(value))
  if (typeof value === 'string') return value
  return '-'
}

function getPathValue(source: Record<string, unknown>, path: string): unknown {
  let cur: unknown = source
  for (const key of path.split('.')) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}

function hasPathValue(source: Record<string, unknown>, path: string): boolean {
  return getPathValue(source, path) !== undefined
}

function variablePathLabel(path: string): string {
  switch (path) {
    case 'text':
      return 'Text'
    case 'color':
      return 'Text color'
    case 'appearance.fill':
      return 'Fill'
    case 'appearance.stroke':
      return 'Stroke'
    case 'appearance.stroke.width':
      return 'Border width'
    case 'appearance.cornerRadius':
      return 'Radius'
    case 'appearance.opacity':
      return 'Opacity'
    case 'size':
      return 'Size'
    case 'clipsContent':
      return 'Clip content'
    default:
      return path
  }
}

function isInsideNode(api: SceneAPI, nodeId: NodeId, ancestorId: NodeId): boolean {
  let current = api.getNode(nodeId)
  while (current?.parent) {
    if (current.parent === ancestorId) return true
    current = api.getNode(current.parent)
  }
  return false
}

function prototypeEventLabel(event: InteractionEventKind): string {
  switch (event) {
    case 'hoverIn':
      return 'Hover'
    case 'hoverOut':
      return 'Hover out'
    case 'pointerDown':
      return 'Press'
    case 'pointerUp':
      return 'Release'
    default:
      return 'Click'
  }
}

function interactionTargetState(interaction: Interaction): string | null {
  const action = interaction.actions[0]
  if (!action) return null
  if (action.type === 'setVariant') return action.selection.State ?? null
  if (action.type === 'after' && action.action.type === 'setVariant') {
    return action.action.selection.State ?? null
  }
  return null
}

function setInteractionTargetState(
  interaction: Interaction,
  state: string,
): Interaction['actions'] {
  return interaction.actions.map((action) => {
    if (action.type === 'setVariant') {
      return { ...action, selection: { ...action.selection, State: state } }
    }
    if (action.type === 'after' && action.action.type === 'setVariant') {
      return {
        ...action,
        action: {
          ...action.action,
          selection: { ...action.action.selection, State: state },
        },
      }
    }
    return action
  })
}

function findOwningComponent(
  api: SceneAPI,
  nodeId: NodeId,
): Extract<Node, { kind: 'component' }> | null {
  let current = api.getNode(nodeId)
  while (current?.parent) {
    const parent = api.getNode(current.parent)
    if (parent?.kind === 'component') return parent
    current = parent
  }
  return current?.kind === 'component' ? current : null
}

function VariantsSection({
  node,
  api,
}: {
  node: Extract<Node, { kind: 'component' | 'instance' }>
  api: SceneAPI
}) {
  const [draftName, setDraftName] = useState('')
  const [activeState, setActiveState] = useState<string | null>(null)
  const component =
    node.kind === 'component' ? node : api.getNode(node.componentId)
  if (!component || component.kind !== 'component') return null
  const stateAxis = component.variants.find((axis) => axis.name === 'State')
  const values = stateAxis?.values ?? ['Default']
  const currentState =
    node.kind === 'instance'
      ? node.selection.State ?? component.defaultSelection.State ?? values[0]!
      : component.defaultSelection.State ?? values[0]!
  const selectedState =
    activeState && values.includes(activeState) ? activeState : currentState
  const transition = component.variantTransition ?? DEFAULT_VARIANT_TRANSITION

  const patchTransition = (patch: Partial<VariantTransition>) => {
    api.setNodeProperty(component.id, 'variantTransition', {
      ...transition,
      ...patch,
    } as never)
  }
  const switchComponentState = (value: string) => {
    if (value === selectedState) return
    upsertComponentVariant(api, component.id, selectedState)
    applyComponentVariantState(api, component.id, value)
    setActiveState(value)
  }

  return (
    <Section title="Component states">
      {node.kind === 'component' ? (
        <>
          <FieldRow label="Axis">
            <button
              type="button"
              onClick={() => ensureComponentStateAxis(api, component.id)}
              className="h-7 rounded-md bg-app-bg px-2 text-[12px] font-medium text-text hover:ring-1 hover:ring-border"
            >
              State
            </button>
          </FieldRow>
          <div className="flex flex-wrap gap-1.5">
            {values.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => switchComponentState(value)}
                className={[
                  'h-7 rounded-md border px-2.5 text-[11px] font-semibold',
                  value === selectedState
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-border bg-panel-raised text-text-muted hover:text-text',
                ].join(' ')}
              >
                {value}
              </button>
            ))}
          </div>
          <FieldRow label="New">
            <div className="flex w-full gap-1">
              <input
                value={draftName}
                onChange={(e) => setDraftName(e.currentTarget.value)}
                placeholder={`Variant ${values.length + 1}`}
                className="h-7 min-w-0 flex-1 rounded-md bg-app-bg px-2 text-[12px] text-text outline-none ring-1 ring-transparent placeholder:text-text-dim focus:ring-accent/45"
              />
              <button
                type="button"
                onClick={() => {
                  const nextName = draftName.trim() || `Variant ${values.length + 1}`
                  upsertComponentVariant(api, component.id, selectedState)
                  upsertComponentVariant(api, component.id, nextName)
                  applyComponentVariantState(api, component.id, nextName)
                  setActiveState(nextName)
                  setDraftName('')
                }}
                className="h-7 rounded-md bg-accent px-2 text-[11px] font-semibold text-white"
              >
                Add
              </button>
            </div>
          </FieldRow>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => upsertComponentVariant(api, component.id, selectedState)}
              className="h-7 rounded-md border border-border bg-panel-raised px-2 text-[11px] font-semibold text-text-muted hover:text-text"
            >
              Update selected
            </button>
            <button
              type="button"
              disabled={selectedState === 'Default'}
              onClick={() => {
                removeComponentVariant(api, component.id, selectedState)
                applyComponentVariantState(api, component.id, 'Default')
                setActiveState('Default')
              }}
              className="h-7 rounded-md border border-border bg-panel-raised px-2 text-[11px] font-semibold text-text-muted hover:text-danger disabled:cursor-not-allowed disabled:opacity-40"
            >
              Delete selected
            </button>
          </div>
          <p className="text-[11px] leading-4 text-text-dim">
            Edit the master to the target look, then add a new state or update
            the selected state. Instances animate between these states.
          </p>
        </>
      ) : (
        <p className="text-[11px] leading-4 text-text-dim">
          Use the Current state dropdown above to change this instance.
          Transition settings below control how it animates between states.
        </p>
      )}

      <div className="border-t border-border pt-4">
        <FieldRow label="Duration">
          <TimeField
            value={transition.duration}
            onCommit={(duration) => patchTransition({ duration: Math.max(0, duration) })}
            min={0}
            step={0.05}
          />
        </FieldRow>
        <EasingPicker
          title="Transition"
          presetId={(transition.presetId as EasingPresetId | undefined) ?? 'smooth'}
          strength={transition.strength ?? 50}
          easingValue={transition.easing}
          onChange={({ presetId, strength, easing }) =>
            patchTransition({ presetId, strength, easing })
          }
        />
        <SpringControls transition={transition} onPatch={patchTransition} />
      </div>
    </Section>
  )
}

function PrototypeSection({
  node,
  api,
}: {
  node: Extract<Node, { kind: 'component' | 'instance' }>
  api: SceneAPI
}) {
  const [event, setEvent] = useState<InteractionEventKind>('click')
  const [targetState, setTargetState] = useState('Default')
  const [delay, setDelay] = useState(0)
  const component =
    node.kind === 'component' ? node : api.getNode(node.componentId)
  if (!component || component.kind !== 'component') return null
  const stateAxis = component.variants.find((axis) => axis.name === 'State')
  const values = stateAxis?.values.length ? stateAxis.values : ['Default']
  const selectedInnerNode =
    useUI.getState().selection.find((id) => id !== component.id && isInsideNode(api, id, component.id)) ??
    undefined
  const sourceNode = selectedInnerNode ? api.getNode(selectedInnerNode) : null
  const currentTargetState = values.includes(targetState) ? targetState : values[0]!
  const interactions = component.interactions

  return (
    <Section title="Prototype">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="mb-1 text-[10px] font-medium text-text-dim">
              Trigger
            </div>
            <SelectField<InteractionEventKind>
              value={event}
              options={['click', 'hoverIn', 'hoverOut', 'pointerDown', 'pointerUp']}
              width="w-full"
              onCommit={setEvent}
            />
          </div>
          <div>
            <div className="mb-1 text-[10px] font-medium text-text-dim">
              To state
            </div>
            <SelectField<string>
              value={currentTargetState}
              options={values}
              width="w-full"
              onCommit={setTargetState}
            />
          </div>
        </div>
        <FieldRow label="Delay">
          <TimeField
            value={delay}
            onCommit={(value) => setDelay(Math.max(0, value))}
            min={0}
            step={0.05}
          />
        </FieldRow>
        <button
          type="button"
          onClick={() =>
            addComponentVariantInteraction(api, component.id, {
              event,
              targetState: currentTargetState,
              delay,
              sourceNodeId: sourceNode?.id,
            })
          }
          className="h-8 w-full rounded-md bg-accent text-[12px] font-semibold text-white"
        >
          Add variant connector
        </button>
        <p className="text-[11px] leading-4 text-text-dim">
          Source is {sourceNode ? sourceNode.name : 'the component root'}. Select
          a child layer inside the master to attach the trigger to that layer.
        </p>

        {interactions.length > 0 ? (
          <div className="space-y-2 border-t border-border pt-3">
            {interactions.map((interaction) => {
              const target = interactionTargetState(interaction) ?? values[0]!
              const triggerLabel = prototypeEventLabel(interaction.event)
              return (
                <div
                  key={interaction.id}
                  className="rounded-md border border-border bg-panel-raised p-2"
                >
                  <div className="mb-2 flex items-center gap-2 text-[11px]">
                    <span className="rounded bg-app-bg px-1.5 py-0.5 font-semibold text-text">
                      {triggerLabel}
                    </span>
                    <span className="h-px flex-1 bg-accent/55" />
                    <span className="rounded bg-accent-soft px-1.5 py-0.5 font-semibold text-accent">
                      {target}
                    </span>
                  </div>
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <SelectField<string>
                      value={target}
                      options={values}
                      width="w-full"
                      onCommit={(value) =>
                        updateComponentInteraction(
                          api,
                          component.id,
                          interaction.id,
                          {
                            actions: setInteractionTargetState(
                              interaction,
                              value,
                            ),
                          },
                        )
                      }
                    />
                    <button
                      type="button"
                      onClick={() =>
                        removeComponentInteraction(api, component.id, interaction.id)
                      }
                      className="h-7 rounded border border-border px-2 text-[11px] text-text-muted hover:text-danger"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        ) : null}
      </div>
    </Section>
  )
}

const DEFAULT_VARIANT_TRANSITION: VariantTransition = {
  duration: 0.3,
  easing: 'ease-in-out',
  presetId: 'smooth',
  strength: 50,
}

function SpringControls({
  transition,
  onPatch,
}: {
  transition: VariantTransition
  onPatch: (patch: Partial<VariantTransition>) => void
}) {
  const spring =
    typeof transition.easing === 'object' && 'spring' in transition.easing
      ? transition.easing.spring
      : { stiffness: 240, damping: 22, mass: 1 }
  return (
    <div className="mt-3 rounded border border-border bg-panel-raised p-2.5">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wider text-text-dim">
          Spring
        </span>
        <button
          type="button"
          onClick={() =>
            onPatch({
              presetId: 'elastic',
              easing: { spring },
            })
          }
          className="rounded bg-app-bg px-2 py-1 text-[10px] font-medium text-text-muted hover:text-text"
        >
          Use spring
        </button>
      </div>
      <FieldRow label="Stiffness">
        <NumberField
          value={spring.stiffness}
          onCommit={(stiffness) =>
            onPatch({ easing: { spring: { ...spring, stiffness } } })
          }
          min={1}
          step={10}
        />
      </FieldRow>
      <FieldRow label="Damping">
        <NumberField
          value={spring.damping}
          onCommit={(damping) =>
            onPatch({ easing: { spring: { ...spring, damping } } })
          }
          min={0.1}
          step={1}
        />
      </FieldRow>
      <FieldRow label="Mass">
        <NumberField
          value={spring.mass}
          onCommit={(mass) =>
            onPatch({ easing: { spring: { ...spring, mass } } })
          }
          min={0.1}
          step={0.1}
        />
      </FieldRow>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Position — flow vs absolute. Mirrors Figma's "Absolute position" toggle.
// Even when a parent is free-positioned (`layout.mode = none`), keep the
// control visible so media/image layers can be explicitly pinned or put
// back into parent layout without hunting for a hidden state.
// ---------------------------------------------------------------------------

function PositionSection({ node, api }: { node: Node; api: SceneAPI }) {
  // Root is the artboard; it has no parent and the toggle would be
  // meaningless. Guard early so the section disappears for the Scene.
  if (!node.parent) return null
  const parent = api.getNode(node.parent)
  if (!parent) return null
  const parentMode = 'layout' in parent ? parent.layout.mode : 'none'

  const onChange = (next: Position) => {
    if (next === node.position) return
    api.doc.transact(() => {
      if (next === 'absolute') {
        // Capture the slot Yoga is about to remove and fold that delta into
        // the existing transform. Absolute left/top resolve from the parent
        // border box here, so subtracting padding would introduce a jump.
        const solved = getLastSolvedLayout()
        const childRect = solved?.[node.id]
        const parentRect = solved?.[parent.id]
        const current = api.getNode(node.id)
        if (childRect && parentRect && current) {
          api.setNodeProperty(
            node.id,
            'transform',
            transformForAbsolutePosition(
              current.transform,
              childRect,
              parentRect,
            ),
          )
        }
      }
      api.setNodeProperty(node.id, 'position', next)
    }, UNDOABLE_GESTURE_ORIGIN)
  }

  return (
    <Section title="Layout position">
      <FieldRow label="Mode">
        <SelectField<Position>
          value={node.position}
          options={[
            { value: 'flow', label: 'Relative / in layout' },
            { value: 'absolute', label: 'Absolute' },
          ]}
          onCommit={onChange}
          width="w-full"
        />
      </FieldRow>
      <p className="px-2 pt-0.5 text-[10.5px] leading-snug text-text-dim">
        {node.position === 'flow'
          ? parentMode === 'flex'
            ? 'Following parent auto layout.'
            : parentMode === 'grid'
              ? 'Following parent grid.'
              : 'Relative to the parent layer.'
          : 'Pinned by Transform — siblings ignore it.'}
      </p>
      {/* When this node is in flow under an auto-layout parent and
          carries a non-zero transform.x/y, the offset shifts it OFF
          the Yoga slot — usually unintentionally (stale offsets from
          import or a previous absolute → flow toggle). Surface a
          one-click reset so users can snap back to "exactly where
          the parent's layout placed me." */}
      {node.position === 'flow' &&
      (node.transform.x !== 0 || node.transform.y !== 0) ? (
        <div className="px-2 pt-1.5">
          <button
            type="button"
            onClick={() =>
              api.setNodeProperty(node.id, 'transform', {
                ...node.transform,
                x: 0,
                y: 0,
              })
            }
            className="rounded border border-border bg-panel px-2 py-1 text-[11px] text-text-muted hover:border-border-strong hover:text-text"
            title="Set transform.x and transform.y to 0 — snaps the element to the slot the parent's layout assigned."
          >
            Reset offset to layout slot
          </button>
        </div>
      ) : null}
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Typography — shown when the selected node is a text node.
// ---------------------------------------------------------------------------

/**
 * Font stacks surfaced in the Font dropdown. These are system / webfont
 * families that render without a network fetch. The dropdown label is
 * plain-English ("Sans-serif"), but the stored value is the CSS
 * font-family string so downstream CSS and the eventual Lottie/SVG
 * export can use it directly. Users can still set a custom stack by
 * writing to node.fontFamily programmatically — this list is a
 * curated shortcut, not a lock.
 */
const SYSTEM_FONTS: { value: string; label: string }[] = [
  { value: 'ui-sans-serif', label: 'Sans-serif' },
  { value: 'system-ui, sans-serif', label: 'System' },
  { value: 'ui-serif, Georgia, serif', label: 'Serif' },
  { value: '"Times New Roman", Times, serif', label: 'Times' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: 'ui-monospace, SFMono-Regular, Menlo, monospace', label: 'Mono' },
  { value: '"Courier New", Courier, monospace', label: 'Courier' },
  { value: 'Arial, Helvetica, sans-serif', label: 'Arial' },
  { value: 'Helvetica, Arial, sans-serif', label: 'Helvetica' },
]

/**
 * Build the <optgroup> structure for the Font dropdown. System stacks
 * sit at the top (always available, no network), then the Google Fonts
 * split by category so designers can scan for "give me a display face"
 * or "give me a mono." The value we store is the plain family name
 * for Google fonts (e.g. `"Inter"`), which matches what Canvas2D and
 * the DOM renderer will look up in `document.fonts`.
 */
function buildFontGroups(): Array<{
  label: string
  options: { value: string; label: string }[]
}> {
  const byCategory: Record<GoogleFontSpec['category'], GoogleFontSpec[]> = {
    sans: [],
    display: [],
    serif: [],
    mono: [],
    handwriting: [],
  }
  for (const f of GOOGLE_FONTS) byCategory[f.category].push(f)
  const categoryLabel: Record<GoogleFontSpec['category'], string> = {
    sans: 'Google · Sans',
    display: 'Google · Display',
    serif: 'Google · Serif',
    mono: 'Google · Mono',
    handwriting: 'Google · Handwriting',
  }
  return [
    { label: 'System', options: SYSTEM_FONTS },
    ...(Object.keys(byCategory) as GoogleFontSpec['category'][]).map((k) => ({
      label: categoryLabel[k],
      options: byCategory[k].map((f) => ({ value: f.value, label: f.label })),
    })),
  ]
}

const FONT_GROUPS = buildFontGroups()
const FONT_GROUPS_FLAT = FONT_GROUPS.flatMap((g) => g.options)

/**
 * Static sentinel group surfaced at the bottom of the Font dropdown.
 * Picking the option doesn't change fontFamily — TypographySection's
 * onCommit intercepts the sentinel value and opens the file picker
 * instead. Native <select> can't host an <option> with a custom click
 * handler, so this is the cleanest route.
 */
/** Sentinel select value that opens the file picker instead of
 *  committing as the new fontFamily. Picked unique to avoid colliding
 *  with any real family name. Declared at module scope so the static
 *  ADD_CUSTOM_FONT_GROUP can reference it. */
const ADD_CUSTOM_FONT_SENTINEL = '__add-custom-font__'

const ADD_CUSTOM_FONT_GROUP: {
  label: string
  options: { value: string; label: string }[]
} = {
  label: 'Custom',
  options: [
    { value: ADD_CUSTOM_FONT_SENTINEL, label: '+ Add custom font…' },
  ],
}

/**
 * Subscribe to the scene's `customFonts` map. Returns a fresh array
 * whenever any custom font is added / removed / updated.
 */
function useSceneCustomFonts(api: SceneAPI): CustomFont[] {
  const version = useSceneVersion()
  return useMemo(() => {
    void version
    return api.getAllCustomFonts()
  }, [api, version])
}

/**
 * Subscribe to the global font library (IndexedDB). Returns the full
 * library snapshot on every mutation. Async load on first mount;
 * returns [] until the IndexedDB read resolves.
 */
function useLibraryFonts(): CustomFont[] {
  const [fonts, setFonts] = useState<CustomFont[]>([])
  useEffect(() => {
    let cancelled = false
    const refresh = () => {
      void libraryGetAll().then((all) => {
        if (!cancelled) setFonts(all)
      })
    }
    refresh()
    const off = subscribeLibrary(refresh)
    return () => {
      cancelled = true
      off()
    }
  }, [])
  return fonts
}

/**
 * Build the Font dropdown's "Custom" groups. The scene-embedded set
 * sits above the library-only set so the user can see at a glance
 * what travels with the file vs what's local to this machine.
 *
 * De-dupes by family name — if a font is in both the scene AND the
 * library, the scene entry wins (it's the portable copy). Library
 * fonts that match a scene family are filtered out.
 */
function buildCustomFontGroups(
  sceneFonts: CustomFont[],
  libraryFonts: CustomFont[],
): Array<{
  label: string
  options: { value: string; label: string }[]
}> {
  const groups: Array<{
    label: string
    options: { value: string; label: string }[]
  }> = []
  if (sceneFonts.length > 0) {
    // De-dupe by family for the display — multiple weights of the
    // same family collapse to one entry (the picker only sets
    // fontFamily; weight is controlled separately).
    const families = uniqueByFamily(sceneFonts)
    groups.push({
      label: 'Custom · in scene',
      options: families.map((f) => ({ value: f.family, label: f.family })),
    })
  }
  const sceneFamilies = new Set(sceneFonts.map((f) => f.family))
  const libraryOnly = libraryFonts.filter((f) => !sceneFamilies.has(f.family))
  if (libraryOnly.length > 0) {
    const families = uniqueByFamily(libraryOnly)
    groups.push({
      label: 'Custom · library',
      options: families.map((f) => ({ value: f.family, label: f.family })),
    })
  }
  return groups
}

function uniqueByFamily(fonts: CustomFont[]): CustomFont[] {
  const seen = new Set<string>()
  const out: CustomFont[] = []
  for (const f of fonts) {
    if (seen.has(f.family)) continue
    seen.add(f.family)
    out.push(f)
  }
  return out
}

/**
 * Open the OS font file picker, probe each selected file, save to
 * library + scene, register with FontFace, and call `onApply` with
 * the family name of the first successfully-imported font. The
 * caller typically uses `onApply` to set the current text node's
 * fontFamily to the new font.
 */
async function addCustomFontsFromPicker(
  api: SceneAPI,
  onApply: (family: string) => void,
): Promise<void> {
  console.log('[fonts] opening file picker')
  const files = await pickFontFiles()
  console.log(
    `[fonts] picker returned ${files.length} file${files.length === 1 ? '' : 's'}`,
  )
  if (files.length === 0) return
  await addCustomFontFiles(files, api, onApply)
}

/**
 * Shared upload path for picker + drag-drop. Probes each file
 * sequentially, surfaces per-file errors AND successes via console
 * (so the user can see what's happening in DevTools while we don't
 * yet have a toast system), and applies the first successful font's
 * family. Throws are caught per-file so one bad font in a multi-file
 * upload doesn't kill the rest.
 *
 * Errors that prevent any font from importing also fire a window.alert
 * so the user immediately sees that something went wrong, even without
 * DevTools open. Replace with a proper toast once we have one.
 */
async function addCustomFontFiles(
  files: File[],
  api: SceneAPI,
  onApply: (family: string) => void,
): Promise<void> {
  let firstFamily: string | null = null
  const errors: Array<{ name: string; error: string }> = []
  for (const file of files) {
    try {
      console.log(`[fonts] importing "${file.name}" (${file.size} bytes)…`)
      const probe = await probeFontFile(file)
      console.log(
        `[fonts] probed "${file.name}" → format=${probe.format} family="${probe.family}"`,
      )
      const bytes = new Uint8Array(await file.arrayBuffer())
      const font = bytesToCustomFont(bytes, file.name, probe)
      // Save to BOTH the library (cross-scene reuse) AND the scene
      // (portability). Embedding into the scene is what makes the
      // .hype file self-contained.
      await libraryAdd(font)
      api.setCustomFont(font)
      console.log(
        `[fonts] ✓ added "${font.family}" (weight ${font.weight}, ${font.style}) — id=${font.id}`,
      )
      if (!firstFamily) firstFamily = font.family
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[fonts] ✗ failed to import "${file.name}": ${message}`)
      errors.push({ name: file.name, error: message })
    }
  }
  if (firstFamily) {
    onApply(firstFamily)
  } else if (errors.length > 0) {
    // Nothing imported AND we hit errors — surface to user via alert
    // so they're not staring at a silent failure. (Toasts when we
    // have them.)
    const summary = errors
      .map((e) => `• ${e.name}: ${e.error}`)
      .join('\n')
    if (typeof window !== 'undefined' && 'alert' in window) {
      window.alert(
        `Couldn't import font${errors.length === 1 ? '' : 's'}:\n\n${summary}\n\nCheck the file format (.woff2 / .woff / .ttf / .otf) and try again.`,
      )
    }
  }
}

/**
 * Weight presets. 100–900 in steps of 100 covers everything from
 * Thin to Black; most fonts only ship a handful of real faces and the
 * browser synthesizes the rest. We keep it simple and let the renderer
 * pick what's available.
 */
const FONT_WEIGHTS: { value: string; label: string }[] = [
  { value: '100', label: 'Thin 100' },
  { value: '200', label: 'ExtraLight 200' },
  { value: '300', label: 'Light 300' },
  { value: '400', label: 'Regular 400' },
  { value: '500', label: 'Medium 500' },
  { value: '600', label: 'SemiBold 600' },
  { value: '700', label: 'Bold 700' },
  { value: '800', label: 'ExtraBold 800' },
  { value: '900', label: 'Black 900' },
]

function TypographySection({
  node,
  api,
}: {
  node: TextNode
  api: SceneAPI
}) {
  // Normalize weight onto the nearest preset so the <select> has a
  // matching <option> to render. If a scene has an odd weight (say,
  // 350 from an imported file), we round to 300 for display but don't
  // mutate the underlying value until the user explicitly picks.
  const nearestWeight = FONT_WEIGHTS.reduce((best, opt) => {
    const o = Number(opt.value)
    const b = Number(best.value)
    return Math.abs(o - node.fontWeight) < Math.abs(b - node.fontWeight)
      ? opt
      : best
  }, FONT_WEIGHTS[3]!)

  // --- custom fonts: subscribe to scene + library so the picker
  // surfaces both. Scene-embedded fonts are the "Custom" group at the
  // top; library fonts (not yet embedded) follow as a separate group.
  const sceneFonts = useSceneCustomFonts(api)
  const libraryFonts = useLibraryFonts()
  const customGroups = useMemo(() => {
    return buildCustomFontGroups(sceneFonts, libraryFonts)
  }, [sceneFonts, libraryFonts])

  // Full picker = "Add custom font…" sentinel FIRST, then Custom
  // groups (in-scene + library), then System, then Google.
  //
  // Why "Add custom font…" goes first: designers don't scroll dropdowns
  // looking for an action button — they look at the top. Hiding the
  // entry under 5 Google groups (~40 options) is what made "I tried to
  // add a custom font but nothing happened" — they never found it.
  const allGroups = useMemo(
    () => [ADD_CUSTOM_FONT_GROUP, ...customGroups, ...FONT_GROUPS],
    [customGroups],
  )
  const allFlat = useMemo(
    () => allGroups.flatMap((g) => g.options),
    [allGroups],
  )

  // If the node's font-family isn't in the preset list (e.g. a custom
  // stack from elsewhere), fall back to the first system option for the
  // dropdown's displayed value — but keep the underlying value intact
  // until the user picks something new.
  const familyValue = allFlat.some((f) => f.value === node.fontFamily)
    ? node.fontFamily
    : FONT_GROUPS_FLAT[0]!.value

  // Pre-load any Google font already referenced by this text node so it
  // renders correctly the first time the Inspector surfaces it. Safe to
  // call on every render — `loadGoogleFont` is idempotent after the
  // first successful load.
  useEffect(() => {
    if (isGoogleFont(node.fontFamily)) {
      void loadGoogleFont(node.fontFamily.split(',')[0]!.trim())
    }
  }, [node.fontFamily])

  // Handle the user picking a value from the Font dropdown.
  const onFontPick = useCallback(
    (v: string): void => {
      if (v === ADD_CUSTOM_FONT_SENTINEL) {
        // Sentinel — open file picker, don't mutate fontFamily.
        void addCustomFontsFromPicker(api, (family) => {
          api.setNodeProperty(node.id, 'fontFamily', family)
        })
        return
      }
      // If the value matches a library font that ISN'T already in the
      // scene, copy it into the scene first so it survives a save.
      const libMatch = libraryFonts.find((f) => f.family === v)
      const sceneHasIt = sceneFonts.some((f) => f.family === v)
      if (libMatch && !sceneHasIt) {
        api.setCustomFont(libMatch)
      }
      // Kick off the Google fetch when relevant.
      if (isGoogleFont(v)) void loadGoogleFont(v)
      api.setNodeProperty(node.id, 'fontFamily', v)
    },
    [api, node.id, libraryFonts, sceneFonts],
  )

  // File-drop on the Font row — designers commonly drag a font file
  // straight from Finder onto the field they want to use it in.
  const onFontDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      const files = Array.from(e.dataTransfer.files ?? []).filter((f) =>
        FONT_FILE_EXTENSIONS.some((ext) =>
          f.name.toLowerCase().endsWith(`.${ext}`),
        ),
      )
      if (files.length === 0) return
      e.preventDefault()
      void addCustomFontFiles(files, api, (family) => {
        api.setNodeProperty(node.id, 'fontFamily', family)
      })
    },
    [api, node.id],
  )

  const onFontDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      // Required for `drop` to fire. Only enable when the drag carries
      // a file with a font extension — anything else (a node drag, a
      // string drag) gets the default reject behavior.
      if (e.dataTransfer.types.includes('Files')) {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }
    },
    [],
  )

  const previewTypography = (
    patch: Partial<
      Pick<TextNode, 'fontSize' | 'lineHeight' | 'letterSpacing'>
    >,
  ) => {
    nodeGeometryPreviewStore.preview({ [node.id]: patch })
  }
  const commitTypography = <
    K extends 'fontSize' | 'lineHeight' | 'letterSpacing',
  >(
    key: K,
    value: TextNode[K],
  ) => {
    api.setNodeProperty(node.id, key, value)
    nodeGeometryPreviewStore.finish()
  }
  const cancelTypographyPreview = () => nodeGeometryPreviewStore.clear()

  return (
    <Section title="Typography">
      <FieldRow label="Content">
        <TextAreaField
          value={node.text}
          onCommit={(v) => api.setNodeProperty(node.id, 'text', v)}
        />
      </FieldRow>
      <div
        onDrop={onFontDrop}
        onDragOver={onFontDragOver}
        title="Drop a .woff2 / .woff / .ttf / .otf file to add a custom font"
      >
        <FieldRow label="Font">
          <SelectField<string>
            value={familyValue}
            groups={allGroups}
            onCommit={onFontPick}
            width="w-full"
          />
        </FieldRow>
      </div>
      <FieldRow label="Weight">
        <SelectField<string>
          value={nearestWeight.value}
          options={FONT_WEIGHTS}
          onCommit={(v) =>
            api.setNodeProperty(node.id, 'fontWeight', Number(v))
          }
          width="w-full"
        />
      </FieldRow>
      <FieldRow label="Style">
        <SelectField<'normal' | 'italic'>
          value={node.fontStyle ?? 'normal'}
          options={
            [
              { value: 'normal', label: 'Normal' },
              { value: 'italic', label: 'Italic' },
            ] as const
          }
          onCommit={(style) => api.setNodeProperty(node.id, 'fontStyle', style)}
        />
      </FieldRow>
      <FieldRow label="Size">
        <NumberField
          value={node.fontSize}
          onCommit={(v) =>
            api.setNodeProperty(node.id, 'fontSize', Math.max(1, Math.round(v)))
          }
          onScrubPreview={(fontSize) =>
            previewTypography({ fontSize: Math.max(1, fontSize) })
          }
          onScrubCommit={(fontSize) =>
            commitTypography('fontSize', Math.max(1, Math.round(fontSize)))
          }
          onScrubCancel={cancelTypographyPreview}
          min={1}
          step={1}
          suffix="px"
        />
      </FieldRow>
      <FieldRow label="Line height">
        <NumberField
          value={Math.round(node.fontSize * node.lineHeight * 100) / 100}
          onCommit={(v) =>
            api.setNodeProperty(
              node.id,
              'lineHeight',
              Math.max(0.5, v / Math.max(1, node.fontSize)),
            )
          }
          onScrubPreview={(lineHeightPx) =>
            previewTypography({
              lineHeight: Math.max(
                0.5,
                lineHeightPx / Math.max(1, node.fontSize),
              ),
            })
          }
          onScrubCommit={(lineHeightPx) =>
            commitTypography(
              'lineHeight',
              Math.max(0.5, lineHeightPx / Math.max(1, node.fontSize)),
            )
          }
          onScrubCancel={cancelTypographyPreview}
          min={1}
          step={1}
          suffix="px"
        />
      </FieldRow>
      <FieldRow label="Tracking">
        <NumberField
          value={node.letterSpacing}
          onCommit={(v) => api.setNodeProperty(node.id, 'letterSpacing', v)}
          onScrubPreview={(letterSpacing) =>
            previewTypography({ letterSpacing })
          }
          onScrubCommit={(letterSpacing) =>
            commitTypography('letterSpacing', letterSpacing)
          }
          onScrubCancel={cancelTypographyPreview}
          min={-100}
          max={100}
          step={0.1}
          suffix="px"
        />
      </FieldRow>
      <FieldRow label="Align">
        <SelectField<'start' | 'center' | 'end' | 'justify'>
          value={node.textAlign}
          options={
            [
              { value: 'start', label: 'Left' },
              { value: 'center', label: 'Center' },
              { value: 'end', label: 'Right' },
              { value: 'justify', label: 'Justified' },
            ] as const
          }
          onCommit={(a) => api.setNodeProperty(node.id, 'textAlign', a)}
        />
      </FieldRow>
      <FieldRow label="Vertical">
        <SelectField<'top' | 'center' | 'bottom'>
          value={node.textAlignVertical ?? 'top'}
          options={
            [
              { value: 'top', label: 'Top' },
              { value: 'center', label: 'Center' },
              { value: 'bottom', label: 'Bottom' },
            ] as const
          }
          onCommit={(a) =>
            api.setNodeProperty(node.id, 'textAlignVertical', a)
          }
        />
      </FieldRow>
      <FieldRow label="Case">
        <SelectField<
          | 'original'
          | 'upper'
          | 'lower'
          | 'title'
          | 'small-caps'
          | 'small-caps-forced'
        >
          value={node.textCase ?? 'original'}
          options={
            [
              { value: 'original', label: 'Original' },
              { value: 'upper', label: 'Uppercase' },
              { value: 'lower', label: 'Lowercase' },
              { value: 'title', label: 'Title Case' },
              { value: 'small-caps', label: 'Small Caps' },
              { value: 'small-caps-forced', label: 'All Small Caps' },
            ] as const
          }
          onCommit={(textCase) =>
            api.setNodeProperty(node.id, 'textCase', textCase)
          }
        />
      </FieldRow>
      <FieldRow label="Decoration">
        <SelectField<'none' | 'underline' | 'strikethrough'>
          value={node.textDecoration ?? 'none'}
          options={
            [
              { value: 'none', label: 'None' },
              { value: 'underline', label: 'Underline' },
              { value: 'strikethrough', label: 'Strikethrough' },
            ] as const
          }
          onCommit={(decoration) =>
            api.setNodeProperty(node.id, 'textDecoration', decoration)
          }
        />
      </FieldRow>
      <FieldRow label="Color">
        <ColorField
          value={node.color}
          onCommit={(c) => {
            // Text color is never null — clearing the color picker on a
            // text node doesn't make sense (the glyphs would be
            // invisible). Fall back to the current value if the user
            // does clear it, so the UI behaves as "no-op" rather than
            // breaking the text.
            if (c) api.setNodeProperty(node.id, 'color', c)
          }}
        />
      </FieldRow>
    </Section>
  )
}

/**
 * Image-specific controls. Shows:
 *   - A thumbnail preview of the current src so users can confirm at a
 *     glance which asset they're editing (data: URLs are opaque).
 *   - A "Replace…" button that opens the file picker and swaps the
 *     current src. Size is NOT re-snapped to the new image's natural
 *     dimensions — the user may have resized intentionally and we
 *     don't want to stomp that. They can re-import via drag-drop if
 *     they want fresh sizing.
 *   - `fit` picker — maps 1:1 to CSS `object-fit`. 'cover' is the
 *     default because it's what almost every card / hero wants; the
 *     others are for full-bleed art, fit-inside badges, and pixel-art
 *     respectively.
 */
function ImageSection({ node, api }: { node: ImageNode; api: SceneAPI }) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const onReplace = (files: FileList | null) => {
    if (!files || files.length === 0) return
    const first = Array.from(files).find(isImageFile)
    if (!first) return
    // Read the file directly and swap just the `src` on the existing
    // node. We deliberately don't re-read natural dimensions or stomp
    // `size` — the user may have resized intentionally. Users who want
    // fresh sizing can drag-drop a new image instead.
    const reader = new FileReader()
    reader.onload = () => {
      const r = reader.result
      if (typeof r === 'string') {
        api.setNodeProperty(node.id, 'src', r)
      }
    }
    reader.readAsDataURL(first)
  }

  return (
    <Section title="Image">
      {node.importWarning ? (
        <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] leading-4 text-amber-900">
          <div className="mb-1 font-semibold">Imported as image fallback</div>
          <div>{node.importWarning}</div>
        </div>
      ) : null}
      <FieldRow label="Preview">
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
          {node.src ? (
            <img
              src={node.src}
              alt=""
              className="h-10 w-10 shrink-0 rounded border border-border object-cover"
              draggable={false}
            />
          ) : (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-dashed border-border text-[10px] text-text-dim">
              empty
            </div>
          )}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded border border-border px-2 py-1 text-[11px] text-text-muted hover:bg-panel-raised hover:text-text"
          >
            Replace…
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              onReplace(e.target.files)
              e.target.value = ''
            }}
          />
        </div>
      </FieldRow>
      <FieldRow label="Fit">
        <SelectField<ImageNode['fit']>
          value={node.fit}
          options={[
            { value: 'cover', label: 'Cover' },
            { value: 'contain', label: 'Contain' },
            { value: 'fill', label: 'Fill' },
            { value: 'none', label: 'None' },
          ]}
          onCommit={(f) => api.setNodeProperty(node.id, 'fit', f)}
          width="w-full"
        />
      </FieldRow>
    </Section>
  )
}

function MediaSection({
  node,
  api,
}: {
  node: Extract<Node, { kind: 'audio' | 'video' }>
  api: SceneAPI
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const setPlayhead = useUI((s) => s.setPlayhead)
  const setPlaying = useUI((s) => s.setPlaying)
  const playing = useUI((s) => s.playing)
  const duration = Math.max(0, node.duration || 0)
  const trimStart = Math.max(0, Math.min(duration, node.trimStart || 0))
  const trimEnd = Math.max(trimStart, Math.min(duration, node.trimEnd || duration))
  const clipLength = Math.max(0, trimEnd - trimStart)
  const playbackRate = Math.max(0.05, Math.min(16, node.playbackRate ?? 1))

  const onReplace = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const file = Array.from(files).find((candidate) =>
      node.kind === 'video' ? isVideoFile(candidate) : isAudioFile(candidate),
    )
    if (!file) return
    const normalized =
      node.kind === 'video'
        ? await normalizeVideoFileForBrowser(file)
        : { file, normalized: false }
    const sourceFile = normalized.file
    const src = await readMediaFileAsDataUrl(sourceFile)
    const meta =
      node.kind === 'video' ? await decodeVideoMeta(src) : await decodeAudioMeta(src)
    const poster =
      node.kind === 'video'
        ? await captureVideoPoster(src, meta.duration).catch(() => '')
        : ''
    api.doc.transact(() => {
      api.setNodeProperty(
        node.id,
        'name',
        sourceFile.name.replace(/\.[^.]+$/, '') || node.name,
      )
      api.setNodeProperty(node.id, 'src', src)
      api.setNodeProperty(node.id, 'duration', meta.duration)
      api.setNodeProperty(node.id, 'trimStart', 0)
      api.setNodeProperty(node.id, 'trimEnd', meta.duration)
      if (node.kind === 'video') {
        api.setNodeProperty(node.id, 'poster', poster)
        api.setNodeProperty(
          node.id,
          'importWarning',
          normalized.normalized ? VIDEO_PLAYBACK_PROXY_WARNING : '',
        )
        const videoMeta = meta as { width: number; height: number; duration: number }
        const currentW = typeof node.size.width === 'number' ? node.size.width : videoMeta.width
        const ratio = videoMeta.width > 0 ? currentW / videoMeta.width : 1
        api.setNodeProperty(node.id, 'size', {
          width: Math.max(1, Math.round(videoMeta.width * ratio)),
          height: Math.max(1, Math.round(videoMeta.height * ratio)),
        })
      } else {
        api.setNodeProperty(node.id, 'beatAnalysis', undefined)
        api.setNodeProperty(node.id, 'beatGrid', undefined)
      }
    }, 'media-replace')
  }

  return (
    <Section title={node.kind === 'audio' ? 'Audio' : 'Video'}>
      <FieldRow label="Source">
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
          {node.kind === 'video' && node.src ? (
            <video
              src={node.src}
              muted
              className="h-10 w-14 shrink-0 rounded border border-border object-cover"
            />
          ) : (
            <div className="flex h-10 w-14 shrink-0 items-center justify-center rounded border border-dashed border-border text-[10px] text-text-dim">
              {node.kind}
            </div>
          )}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded border border-border px-2 py-1 text-[11px] text-text-muted hover:bg-panel-raised hover:text-text"
          >
            Replace…
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept={
              node.kind === 'video'
                ? 'video/*,.mp4,.webm,.mov,.m4v,.ogv,.ogg'
                : 'audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.oga,.opus'
            }
            hidden
            onChange={(e) => {
              void onReplace(e.target.files)
              e.target.value = ''
            }}
          />
        </div>
      </FieldRow>
      <FieldRow label="Controls">
        <div className="flex min-w-0 flex-1 justify-end gap-1">
          <button
            type="button"
            onClick={() => {
              setPlayhead(node.startTime)
              setPlaying(false)
            }}
            className="rounded border border-border px-2 py-1 text-[11px] text-text-muted hover:bg-panel-raised hover:text-text"
          >
            Cue
          </button>
          <button
            type="button"
            onClick={() => {
              setPlayhead(node.startTime)
              setPlaying(true)
            }}
            className="rounded border border-border px-2 py-1 text-[11px] text-text-muted hover:bg-panel-raised hover:text-text"
          >
            Play clip
          </button>
          <button
            type="button"
            onClick={() => setPlaying(!playing)}
            className="rounded border border-border px-2 py-1 text-[11px] text-text-muted hover:bg-panel-raised hover:text-text"
          >
            {playing ? 'Pause' : 'Play'}
          </button>
        </div>
      </FieldRow>
      <FieldRow label="Duration">
        <div className="min-w-0 flex-1 text-right font-mono text-[11px] text-text-muted">
          {formatSeconds(duration)} · clip {formatSeconds(clipLength)} · plays{' '}
          {formatSeconds(clipLength / playbackRate)}
        </div>
      </FieldRow>
      {node.kind === 'video' ? (
        <>
          <FieldRow label="Fit">
            <SelectField<Extract<Node, { kind: 'video' }>['fit']>
              value={node.fit}
              options={[
                { value: 'cover', label: 'Cover' },
                { value: 'contain', label: 'Contain' },
                { value: 'fill', label: 'Fill' },
                { value: 'none', label: 'None' },
              ]}
              onCommit={(fit) => api.setNodeProperty(node.id, 'fit', fit)}
              width="w-full"
            />
          </FieldRow>
          <FieldRow label="Size">
            <div className="flex min-w-0 flex-1 justify-end gap-1">
              <button
                type="button"
                onClick={() => {
                  const canvas = api.getMeta().canvas
                  const w = Math.round(canvas.width * 0.5)
                  const ratio =
                    typeof node.size.width === 'number' &&
                    typeof node.size.height === 'number' &&
                    node.size.width > 0
                      ? node.size.height / node.size.width
                      : 9 / 16
                  api.setNodeProperty(node.id, 'size', {
                    width: w,
                    height: Math.round(w * ratio),
                  })
                }}
                className="rounded border border-border px-2 py-1 text-[11px] text-text-muted hover:bg-panel-raised hover:text-text"
              >
                50%
              </button>
              <button
                type="button"
                onClick={() => {
                  const canvas = api.getMeta().canvas
                  api.setNodeProperty(node.id, 'size', {
                    width: canvas.width,
                    height: canvas.height,
                  })
                  api.setNodeProperty(node.id, 'fit', 'cover')
                }}
                className="rounded border border-border px-2 py-1 text-[11px] text-text-muted hover:bg-panel-raised hover:text-text"
              >
                Fill scene
              </button>
            </div>
          </FieldRow>
        </>
      ) : null}
      <FieldRow label="Mute">
        <CheckboxField
          value={node.muted}
          onCommit={(v) => api.setNodeProperty(node.id, 'muted', v)}
        />
      </FieldRow>
      <FieldRow label="Volume">
        <NumberField
          value={Math.round((node.volume ?? 1) * 100)}
          onCommit={(v) =>
            api.setNodeProperty(node.id, 'volume', Math.max(0, Math.min(200, v)) / 100)
          }
          min={0}
          max={200}
          step={5}
          suffix="%"
        />
      </FieldRow>
      <FieldRow label="Speed">
        <div className="flex min-w-0 flex-1 items-center justify-end gap-1">
          <SelectField<string>
            value={String(playbackRate)}
            options={[
              { value: '0.25', label: '0.25×' },
              { value: '0.5', label: '0.5×' },
              { value: '1', label: '1×' },
              { value: '1.5', label: '1.5×' },
              { value: '2', label: '2×' },
              { value: '4', label: '4×' },
            ]}
            onCommit={(v) => api.setNodeProperty(node.id, 'playbackRate', Number(v))}
            width="w-24"
          />
          <NumberField
            value={playbackRate}
            onCommit={(v) =>
              api.setNodeProperty(node.id, 'playbackRate', Math.max(0.05, Math.min(16, v)))
            }
            min={0.05}
            max={16}
            step={0.05}
            suffix="×"
          />
        </div>
      </FieldRow>
      <FieldRow label="Start">
        <TimeField
          value={node.startTime ?? 0}
          onCommit={(v) => api.setNodeProperty(node.id, 'startTime', Math.max(0, v))}
          min={0}
          step={0.05}
        />
      </FieldRow>
      <FieldRow label="Trim in">
        <TimeField
          value={trimStart}
          onCommit={(v) => {
            const nextTrimStart = Math.max(0, Math.min(trimEnd, v))
            api.doc.transact(() => {
              api.setNodeProperty(node.id, 'trimStart', nextTrimStart)
              if (node.kind === 'audio' && node.beatGrid) {
                api.setNodeProperty(node.id, 'beatGrid', {
                  ...node.beatGrid,
                  firstBeatTime: beatAnchorAfterTrimChange(
                    node.beatGrid.firstBeatTime,
                    trimStart,
                    nextTrimStart,
                  ),
                })
              }
            }, 'media-trim-in')
          }}
          min={0}
          max={duration}
          step={0.05}
        />
      </FieldRow>
      <FieldRow label="Trim out">
        <TimeField
          value={trimEnd}
          onCommit={(v) =>
            api.setNodeProperty(
              node.id,
              'trimEnd',
              Math.max(trimStart, Math.min(duration, v)),
            )
          }
          min={0}
          max={duration}
          step={0.05}
        />
      </FieldRow>
      <FieldRow label="Loop">
        <CheckboxField
          value={node.loop}
          onCommit={(v) => api.setNodeProperty(node.id, 'loop', v)}
        />
      </FieldRow>
    </Section>
  )
}

function AudioBeatSection({
  node,
  api,
}: {
  node: Extract<Node, { kind: 'audio' }>
  api: SceneAPI
}) {
  const analysis = node.beatAnalysis
  const grid = node.beatGrid
  const [analyzing, setAnalyzing] = useState(false)
  const [message, setMessage] = useState('')
  const [tempoDraftValue, setTempoDraftValue] = useState(
    () => grid?.bpm ?? 120,
  )
  const [tempoDraftDirty, setTempoDraftDirty] = useState(false)
  const tapTimesRef = useRef<number[]>([])
  const tempoDraft = tempoDraftDirty
    ? tempoDraftValue
    : grid?.bpm ?? 120
  const status = analysis?.status ??
    (analysis ? (analysis.confidence >= 0.58 ? 'ok' : 'ambiguous') : null)
  const clipInPoint = Math.max(0, node.trimStart || 0)
  const stageTempo = useCallback(
    (bpm: number) => {
      setTempoDraftValue(bpm)
      setTempoDraftDirty(!grid || Math.abs(bpm - grid.bpm) >= 0.005)
    },
    [grid],
  )

  const writeGrid = useCallback(
    (patch: Partial<AudioBeatGrid>, fallbackBpm = analysis?.bpm ?? 120) => {
      const current: AudioBeatGrid = grid ?? {
        version: 1,
        bpm: fallbackBpm,
        firstBeatTime: analysis?.firstBeatTime ?? 0,
        beatsPerBar: 4,
        beatUnit: 4,
        swingPercent: 50,
        subdivisions: [],
      }
      api.setNodeProperty(node.id, 'beatGrid', { ...current, ...patch })
    },
    [analysis?.bpm, analysis?.firstBeatTime, api, grid, node.id],
  )

  const applyCandidate = useCallback(
    (candidate: TempoCandidate) => {
      writeGrid(
        {
          bpm: candidate.bpm,
          firstBeatTime: clipInPoint,
        },
        candidate.bpm,
      )
      setTempoDraftValue(candidate.bpm)
      setTempoDraftDirty(false)
      setMessage(
        `Applied ${candidate.bpm.toFixed(1)} BPM. Bar 1 starts with the audio on the timeline.`,
      )
    },
    [clipInPoint, writeGrid],
  )

  const applyManualTempo = useCallback(() => {
    const bpm = Math.max(30, Math.min(360, tempoDraft))
    writeGrid(
      {
        bpm,
        firstBeatTime: clipInPoint,
      },
      bpm,
    )
    setTempoDraftValue(bpm)
    setTempoDraftDirty(false)
    setMessage(
      `Applied ${bpm.toFixed(1)} BPM. Bar 1 starts with the audio on the timeline.`,
    )
  }, [clipInPoint, tempoDraft, writeGrid])

  const analyze = useCallback(async () => {
    setAnalyzing(true)
    setMessage('Decoding audio…')
    try {
      const buffer = await loadAudioBuffer(node.src)
      setMessage('Listening for a stable pulse…')
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
      const result = analyzeBeatPcm({
        sampleRate: buffer.sampleRate,
        channels: Array.from(
          { length: buffer.numberOfChannels },
          (_, channel) => buffer.getChannelData(channel),
        ),
      })
      api.doc.transact(() => {
        api.setNodeProperty(node.id, 'beatAnalysis', result)
      }, 'analyze-audio-beats')
      if (result.status === 'no-pulse') {
        setMessage('No stable pulse found. Set the tempo manually or use Tap.')
      } else if (result.status === 'ambiguous') {
        setMessage('Several tempos fit. Review a candidate before applying it.')
      } else {
        setMessage(
          `Detected ${result.bpm.toFixed(1)} BPM. Apply it if the timing sounds right.`,
        )
      }
    } catch (error) {
      console.warn('[beat-sync] analysis failed', error)
      setMessage('Could not analyze this file. Try WAV, MP3, M4A, or FLAC.')
    } finally {
      setAnalyzing(false)
    }
  }, [api, node.id, node.src])

  const tapTempo = useCallback(() => {
    const now = performance.now()
    const previous = tapTimesRef.current
    const recent =
      previous.length > 0 && now - previous[previous.length - 1]! <= 2_000
        ? [...previous, now].slice(-8)
        : [now]
    tapTimesRef.current = recent
    if (recent.length >= 2) {
      const intervals = recent
        .slice(1)
        .map((time, index) => time - recent[index]!)
        .filter((interval) => interval > 180 && interval < 2_000)
      if (intervals.length > 0) {
        const sorted = [...intervals].sort((a, b) => a - b)
        const median = sorted[Math.floor(sorted.length / 2)]!
        const bpm = Math.max(30, Math.min(300, 60_000 / median))
        stageTempo(bpm)
        setMessage(
          `${bpm.toFixed(1)} BPM from ${recent.length} taps${recent.length < 4 ? ' — keep tapping' : ' — ready to apply'}.`,
        )
      }
    } else {
      setMessage('Tap at least twice; four taps is better.')
    }
  }, [stageTempo])

  const candidates = (analysis?.candidates ?? [])
    .filter(
      (candidate, index, list) =>
        (!analysis || Math.abs(candidate.bpm - analysis.bpm) >= 0.5) &&
        list.findIndex((item) => Math.abs(item.bpm - candidate.bpm) < 0.5) ===
        index,
    )
    .slice(0, 4)
  const anchorNeedsReset =
    !!grid && grid.firstBeatTime < clipInPoint - 0.0005
  const currentMatchesDetection =
    !!grid &&
    !!analysis &&
    Math.abs(grid.bpm - analysis.bpm) < 0.25 &&
    !anchorNeedsReset
  const manualTempoPending = !grid || tempoDraftDirty || anchorNeedsReset
  const leadInSeconds = grid
    ? Math.max(0, grid.firstBeatTime - clipInPoint)
    : 0
  const matchingDetectedStart = grid && analysis
    ? Math.abs(grid.bpm - analysis.bpm) < 0.25
      ? analysis.firstBeatTime
      : analysis.candidates.find(
          (candidate) =>
            Math.abs(candidate.bpm - grid.bpm) < 0.25 &&
            candidate.firstBeatTime != null,
        )?.firstBeatTime
    : undefined
  const detectedStartAtClip =
    matchingDetectedStart != null && grid
      ? recurringBeatAtOrAfter(
          matchingDetectedStart,
          grid.bpm,
          clipInPoint,
        )
      : undefined
  const detectedLeadInSeconds = detectedStartAtClip != null
    ? Math.max(0, detectedStartAtClip - clipInPoint)
    : 0
  const statusLabel =
    status === 'ok'
      ? 'Stable pulse'
      : status === 'ambiguous'
        ? 'Review tempo'
        : status === 'no-pulse'
          ? 'No pulse'
          : 'Not analyzed'
  const statusTone =
    status === 'ok'
      ? 'border-[oklch(0.72_0.16_150)]/40 bg-[oklch(0.72_0.16_150)]/10 text-[oklch(0.72_0.16_150)]'
      : status === 'ambiguous' || status === 'no-pulse'
        ? 'border-[oklch(0.82_0.15_80)]/40 bg-[oklch(0.82_0.15_80)]/10 text-[oklch(0.82_0.15_80)]'
        : 'border-border bg-panel-raised text-text-muted'

  return (
    <Section
      title="Beat sync"
      preserveTimelineSelection
      action={
        <span
          className={[
            'rounded-full border px-2 py-0.5 text-[9px] font-medium',
            statusTone,
          ].join(' ')}
        >
          {statusLabel}
        </span>
      }
    >
      <div className="rounded-lg border border-border bg-panel-raised/55 p-3">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
            <Activity size={14} strokeWidth={1.9} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-medium text-text">
              Detect tempo and beat positions
            </div>
            <div className="mt-0.5 text-[10px] leading-4 text-text-dim">
              Analysis is an estimate. Markers align to seconds in the musical
              ruler below; you stay in control of the applied grid.
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void analyze()}
          disabled={analyzing || !node.src}
          className="mt-3 flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-accent text-[11px] font-semibold text-white shadow-sm hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
        >
          <RefreshCw
            size={13}
            strokeWidth={2}
            className={analyzing ? 'animate-spin' : ''}
          />
          {analyzing ? 'Analyzing audio…' : analysis ? 'Analyze again' : 'Analyze beats'}
        </button>
      </div>

      {analysis && status !== 'no-pulse' && (
        <div className="rounded-md border border-border bg-panel px-2.5 py-2">
          <div className="flex items-center gap-2">
            {status === 'ok' ? (
              <Check size={12} className="text-[oklch(0.72_0.16_150)]" />
            ) : (
              <AlertTriangle size={12} className="text-[oklch(0.82_0.15_80)]" />
            )}
            <span className="text-[10px] font-medium text-text">
              Detected {analysis.bpm.toFixed(1)} BPM
            </span>
            <span className="ml-auto font-mono text-[9px] text-text-dim">
              evidence {Math.round(analysis.confidence * 100)}%
            </span>
          </div>
          {!currentMatchesDetection && (
            <button
              type="button"
              onClick={() =>
                applyCandidate({
                  bpm: analysis.bpm,
                  confidence: analysis.confidence,
                  firstBeatTime: analysis.firstBeatTime,
                })
              }
              className="mt-2 h-6 w-full rounded border border-accent/50 bg-accent-soft text-[9px] font-semibold text-accent hover:bg-accent/20"
            >
              Apply detected tempo
            </button>
          )}
        </div>
      )}

      {candidates.length > 0 && (
        <div>
          <div className="mb-1.5 text-[9px] font-medium tracking-[0.05em] text-text-dim uppercase">
            Other candidates
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {candidates.map((candidate) => {
              const active =
                !!grid && Math.abs(grid.bpm - candidate.bpm) < 0.25
              return (
                <button
                  key={candidate.bpm}
                  type="button"
                  onClick={() => applyCandidate(candidate)}
                  className={[
                    'h-7 rounded border font-mono text-[10px] tabular-nums',
                    active
                      ? 'border-accent/60 bg-accent-soft font-semibold text-accent'
                      : 'border-border bg-panel text-text-muted hover:border-border-strong hover:text-text',
                  ].join(' ')}
                >
                  {candidate.bpm.toFixed(1)} BPM
                  {candidate.relationship &&
                    candidate.relationship !== 'direct'
                    ? ` · ${candidate.relationship}`
                    : ''}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div>
        <FieldRow label="Tempo">
          <div className="flex min-w-0 flex-1 items-center justify-end gap-1">
            <NumberField
              value={tempoDraft}
              onCommit={(value) => {
                const bpm = Math.max(30, Math.min(360, value))
                stageTempo(bpm)
                setMessage(
                  `${bpm.toFixed(1)} BPM entered. Apply it to update the musical grid.`,
                )
              }}
              min={30}
              max={360}
              step={0.1}
              suffix="BPM"
              ariaLabel="Manual tempo"
            />
            <button
              type="button"
              onClick={tapTempo}
              className="h-7 shrink-0 rounded border border-border bg-panel px-2 text-[9px] font-semibold text-text-muted hover:border-border-strong hover:text-text"
              title="Tap in time with the music"
            >
              Tap
            </button>
          </div>
        </FieldRow>
        <button
          type="button"
          onClick={applyManualTempo}
          disabled={!manualTempoPending}
          className="mt-1.5 h-7 w-full rounded border border-accent/50 bg-accent-soft text-[9px] font-semibold text-accent hover:bg-accent/20 disabled:cursor-default disabled:border-border disabled:bg-panel disabled:text-text-dim"
          title="Apply this BPM and start Bar 1 with the audio on the timeline"
        >
          {anchorNeedsReset && !tempoDraftDirty
            ? 'Re-anchor Bar 1'
            : 'Apply manual tempo'}
        </button>
        <div className="mt-1 text-[8px] leading-3 text-text-dim">
          Applying a tempo starts Bar 1 with the audio on the timeline. Add a
          lead-in separately below when you want one.
        </div>
      </div>

      {grid && (
        <>
          <FieldRow label="Tempo range">
            <div className="flex min-w-0 flex-1 justify-end gap-1">
              <button
                type="button"
                onClick={() => {
                  const bpm = Math.max(30, tempoDraft / 2)
                  stageTempo(bpm)
                  setMessage(
                    `${bpm.toFixed(1)} BPM entered. Apply it to update the musical grid.`,
                  )
                }}
                className="h-7 flex-1 rounded border border-border bg-panel font-mono text-[9px] text-text-muted hover:border-border-strong hover:text-text"
              >
                Half
              </button>
              <button
                type="button"
                onClick={() => {
                  const bpm = Math.min(360, tempoDraft * 2)
                  stageTempo(bpm)
                  setMessage(
                    `${bpm.toFixed(1)} BPM entered. Apply it to update the musical grid.`,
                  )
                }}
                className="h-7 flex-1 rounded border border-border bg-panel font-mono text-[9px] text-text-muted hover:border-border-strong hover:text-text"
              >
                Double
              </button>
            </div>
          </FieldRow>
          <FieldRow label="Meter">
            <div className="flex min-w-0 flex-1 items-center justify-end gap-1">
              <NumberField
                value={grid.beatsPerBar}
                onCommit={(value) =>
                  writeGrid({
                    beatsPerBar: Math.max(1, Math.min(16, Math.round(value))),
                  })
                }
                min={1}
                max={16}
                step={1}
              />
              <SelectField<string>
                value={String(grid.beatUnit)}
                options={([2, 4, 8, 16] as NoteDivision[]).map((value) => ({
                  value: String(value),
                  label: `/${value}`,
                }))}
                onCommit={(value) =>
                  writeGrid({ beatUnit: Number(value) as NoteDivision })
                }
                width="w-16"
              />
            </div>
          </FieldRow>
          <FieldRow label="Swing">
            <div
              data-timeline-selection-surface="1"
              className="flex min-w-0 flex-1 items-center gap-2"
              title="50% is straight; 66.7% is a triplet feel"
            >
              <input
                aria-label="Beat-grid swing"
                type="range"
                min={50}
                max={75}
                step={0.5}
                value={grid.swingPercent ?? 50}
                onDoubleClick={() => writeGrid({ swingPercent: 50 })}
                onChange={(event) =>
                  writeGrid({
                    swingPercent: Math.max(
                      50,
                      Math.min(75, Number(event.currentTarget.value)),
                    ),
                  })
                }
                className="min-w-0 flex-1 accent-[var(--color-accent)]"
              />
              <span className="w-10 shrink-0 text-right font-mono text-[10px] tabular-nums text-text">
                {(grid.swingPercent ?? 50).toFixed(
                  (grid.swingPercent ?? 50) % 1 === 0 ? 0 : 1,
                )}
                %
              </span>
            </div>
          </FieldRow>
          <div className="-mt-1 text-right text-[8px] text-text-dim">
            {(grid.swingPercent ?? 50) === 50
              ? 'Straight · affects off-beat subdivisions'
              : Math.abs((grid.swingPercent ?? 50) - 66.5) <= 0.5
                ? 'Triplet feel · affects off-beat subdivisions'
                : 'Beat-grid swing · affects off-beat subdivisions'}
          </div>
          <div>
            <FieldRow label="Lead-in">
              <div className="flex min-w-0 flex-1 items-center justify-end gap-1">
                <TimeField
                  value={leadInSeconds}
                  onCommit={(value) =>
                    writeGrid({
                      firstBeatTime:
                        clipInPoint + Math.max(0, value),
                    })
                  }
                  min={0}
                  step={0.01}
                  ariaLabel="Lead-in duration"
                />
                <button
                  type="button"
                  disabled={leadInSeconds <= 0.0005 && !anchorNeedsReset}
                  onClick={() =>
                    writeGrid({ firstBeatTime: clipInPoint })
                  }
                  className="h-7 shrink-0 rounded border border-border bg-panel px-2 text-[9px] font-semibold text-text-muted hover:border-border-strong hover:text-text disabled:cursor-default disabled:opacity-35"
                  title="Remove the lead-in and start Bar 1 with the audio on the timeline"
                >
                  Clear
                </button>
              </div>
            </FieldRow>
            {anchorNeedsReset && (
              <div className="mt-1 rounded border border-[oklch(0.82_0.15_80)]/35 bg-[oklch(0.82_0.15_80)]/8 px-2 py-1.5 text-[8px] leading-3 text-text-muted">
                Bar 1 is before the current Trim in. Apply the tempo again or
                clear the lead-in to anchor Bar 1 to the audible start.
              </div>
            )}
            {detectedLeadInSeconds > 0.0005 &&
              Math.abs(detectedLeadInSeconds - leadInSeconds) > 0.0005 && (
                <button
                  type="button"
                  onClick={() =>
                    writeGrid({
                      firstBeatTime: detectedStartAtClip ?? clipInPoint,
                    })
                  }
                  className="mt-1.5 h-7 w-full rounded border border-border bg-panel text-[9px] font-medium text-text-muted hover:border-border-strong hover:text-text"
                  title="Use the first beat position suggested by audio analysis"
                >
                  Use detected start · {detectedLeadInSeconds.toFixed(3)}s
                </button>
              )}
            <div className="mt-1 text-right text-[8px] leading-3 text-text-dim">
              0s removes the lead-in; enter a duration to add one.
            </div>
          </div>
        </>
      )}

      <div
        className={[
          'rounded-md border px-2.5 py-2 text-[10px] leading-4',
          status === 'no-pulse'
            ? 'border-[oklch(0.82_0.15_80)]/35 bg-[oklch(0.82_0.15_80)]/8 text-text-muted'
            : 'border-border/70 bg-panel-raised/35 text-text-dim',
        ].join(' ')}
      >
        {message ||
          (grid
            ? 'Select bars and keyframes in the timeline, then choose Snap to beats.'
            : 'Analyze the clip, enter a known BPM, or tap the tempo to create a grid.')}
      </div>
    </Section>
  )
}

function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0.00s'
  return `${seconds.toFixed(seconds < 10 ? 2 : 1)}s`
}

/**
 * Multi-line text input with the same commit-on-blur / cancel-on-Escape
 * pattern as TextField. Enter inserts a newline (matching every
 * multi-line editor people use); Cmd/Ctrl+Enter commits. Used only for
 * the Typography "Content" field today — inline because it's niche
 * enough that it doesn't need a shared fields/ export yet.
 */
function TextAreaField({
  value,
  onCommit,
}: {
  value: string
  onCommit: (next: string) => void
}) {
  const [draft, setDraft] = useState(value)
  const [focused, setFocused] = useState(false)
  const skipNextBlurCommitRef = useRef(false)

  const commit = () => {
    if (draft !== value) onCommit(draft)
  }

  return (
    <textarea
      value={focused ? draft : value}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => {
        setDraft(value)
        setFocused(true)
      }}
      onBlur={() => {
        setFocused(false)
        if (skipNextBlurCommitRef.current) {
          skipNextBlurCommitRef.current = false
          return
        }
        commit()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          skipNextBlurCommitRef.current = true
          setDraft(value)
          ;(e.currentTarget as HTMLTextAreaElement).blur()
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          commit()
          skipNextBlurCommitRef.current = true
          ;(e.currentTarget as HTMLTextAreaElement).blur()
        }
      }}
      rows={3}
      className="w-full min-w-0 resize-y rounded border border-transparent bg-transparent px-1.5 py-1 text-[12px] text-text outline-none hover:border-border focus:border-border-strong focus:bg-app-bg"
    />
  )
}

// ---------------------------------------------------------------------------
// Corner sub-field — uniform NumberField with a link toggle. When
// unlinked, four labeled inputs (TL TR BR BL) replace the single one.
//
// The component is dumb: it accepts a uniform value plus an optional
// `cornerRadii` per-corner override and emits one of three patches:
//
//   - onCommitUniform(n)        — uniform mode, the user typed a number
//   - onPromoteToPerCorner(r)   — toggled the link off, here is the
//                                  initial per-corner object (all four
//                                  pre-filled with the current uniform)
//   - onCommitPerCorner(r)      — per-corner mode, the user typed into
//                                  one of the four cells
//   - onClearPerCorner()        — toggled the link back on, drop the
//                                  override and fall back to uniform
//
// The owning patcher decides whether to also keyframe / record on
// these commits (uniform-mode commits run through the existing
// patchAppearance pipeline that already handles record-mode and live
// tracks).
// ---------------------------------------------------------------------------

function CornerField({
  uniformValue,
  cornerRadii,
  onCommitUniform,
  onPromoteToPerCorner,
  onCommitPerCorner,
  onClearPerCorner,
}: {
  uniformValue: number
  cornerRadii: CornerRadii | undefined
  onCommitUniform: (n: number) => void
  onPromoteToPerCorner: (initial: CornerRadii) => void
  onCommitPerCorner: (next: CornerRadii) => void
  onClearPerCorner: () => void
}) {
  const isPerCorner = !!cornerRadii
  const handleToggle = () => {
    if (isPerCorner) {
      onClearPerCorner()
    } else {
      onPromoteToPerCorner({
        tl: uniformValue,
        tr: uniformValue,
        br: uniformValue,
        bl: uniformValue,
      })
    }
  }
  if (!isPerCorner) {
    return (
      <div className="flex items-center gap-1">
        <NumberField
          value={uniformValue}
          onCommit={(v) => onCommitUniform(Math.max(0, v))}
          min={0}
        />
        <CornerLinkButton linked={true} onToggle={handleToggle} />
      </div>
    )
  }
  const cell = (
    label: string,
    v: number,
    onChange: (n: number) => void,
  ) => (
    <div className="flex flex-col items-center gap-0.5">
      <NumberField
        value={v}
        onCommit={(n) => onChange(Math.max(0, n))}
        min={0}
        width="w-10"
      />
      <span className="text-[9px] uppercase tracking-wider text-text-dim">
        {label}
      </span>
    </div>
  )
  return (
    <div className="flex items-start gap-1">
      {cell('TL', cornerRadii.tl, (n) =>
        onCommitPerCorner({ ...cornerRadii, tl: n }),
      )}
      {cell('TR', cornerRadii.tr, (n) =>
        onCommitPerCorner({ ...cornerRadii, tr: n }),
      )}
      {cell('BR', cornerRadii.br, (n) =>
        onCommitPerCorner({ ...cornerRadii, br: n }),
      )}
      {cell('BL', cornerRadii.bl, (n) =>
        onCommitPerCorner({ ...cornerRadii, bl: n }),
      )}
      <div className="flex flex-col items-center gap-0.5">
        <CornerLinkButton linked={false} onToggle={handleToggle} />
        <span className="text-[9px] uppercase tracking-wider text-text-dim">
          {' '}
        </span>
      </div>
    </div>
  )
}

/**
 * Tiny square button that flips between "linked" (uniform) and
 * "unlinked" (per-corner) modes. Sized to match the height of a
 * NumberField so it sits flush with the inputs.
 */
function CornerLinkButton({
  linked,
  onToggle,
}: {
  linked: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={linked ? 'Independent corners' : 'Link corners'}
      className={`flex h-7 w-7 flex-none items-center justify-center rounded-md transition-colors ${
        linked
          ? 'text-text-dim hover:bg-bg-elevated hover:text-text-default'
          : 'bg-bg-elevated text-accent'
      }`}
    >
      {linked ? (
        // Linked — chain icon
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <path
            d="M6.5 9.5L9.5 6.5M5 7l-.7.7a2.5 2.5 0 003.5 3.5L8.5 10.5M11 9l.7-.7a2.5 2.5 0 00-3.5-3.5L7.5 5.5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        // Unlinked — broken chain
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <path
            d="M5 7l-.7.7a2.5 2.5 0 003.5 3.5L8.5 10.5M11 9l.7-.7a2.5 2.5 0 00-3.5-3.5L7.5 5.5M3 3l1 1M12 12l1 1"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      )}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Layout section — shared between Scene and per-node inspectors.
// ---------------------------------------------------------------------------

/**
 * Layout editor for any container (frame / component / root).
 *
 * Top row is a three-way Mode toggle (None / Flex / Grid). The rest of
 * the panel swaps based on which mode is active:
 *
 *   - None: children keep transform.x / y; flow spacing is hidden.
 *   - Flex: direction, justify, align, gap, padding, wrap.
 *   - Grid: columns, rowGap, columnGap, padding, align.
 *
 * Mode buttons write through the same patcher the individual fields use,
 * so undo/redo groups a mode switch with its immediate edits (within the
 * Y.UndoManager captureTimeout).
 */
function LayoutSection({
  nodeId,
  layout,
  onPatch,
}: {
  nodeId: NodeId
  layout: Layout
  onPatch: (patch: Partial<Layout>) => void
}) {
  const previewLayout = (patch: NodeLayoutPreview) => {
    nodeLayoutPreviewStore.preview({ [nodeId]: patch })
  }
  const commitLayoutPreview = (patch: Partial<Layout>) => {
    onPatch(patch)
    nodeLayoutPreviewStore.finish()
  }

  return (
    <Section title="Layout">
      <FieldRow label="Mode">
        <LayoutModeControl
          value={layout.mode}
          onCommit={(m) => onPatch({ mode: m })}
        />
      </FieldRow>
      {layout.mode === 'flex' ? (
        <>
          <FieldRow
            label="Direction"
            keyframe={
              <KeyframeButton
                nodeId={nodeId}
                propertyId="layout.direction"
                currentValue={layout.direction}
              />
            }
          >
            <IconSegmented<FlexDirection>
              value={layout.direction}
              options={[
                { id: 'row', icon: <DirectionRowIcon />, title: 'Horizontal' },
                {
                  id: 'column',
                  icon: <DirectionColumnIcon />,
                  title: 'Vertical',
                },
              ]}
              onChange={(d) => onPatch({ direction: d })}
            />
          </FieldRow>
          <FieldRow label="Distribute">
            <SelectField<FlexJustify>
              value={layout.justify}
              options={
                ['start', 'center', 'end', 'space-between', 'space-around'] as const
              }
              width="w-full"
              onCommit={(j) => onPatch({ justify: j })}
            />
          </FieldRow>
          <FieldRow label="Align">
            <IconSegmented<FlexAlign>
              value={layout.align}
              options={
                layout.direction === 'row'
                  ? ([
                      { id: 'start', icon: <AlignTopIcon />, title: 'Top' },
                      { id: 'center', icon: <AlignMidYIcon />, title: 'Middle' },
                      { id: 'end', icon: <AlignBottomIcon />, title: 'Bottom' },
                      {
                        id: 'stretch',
                        icon: <AlignStretchIcon />,
                        title: 'Stretch',
                      },
                    ] as const)
                  : ([
                      { id: 'start', icon: <AlignLeftIcon />, title: 'Left' },
                      { id: 'center', icon: <AlignMidXIcon />, title: 'Center' },
                      { id: 'end', icon: <AlignRightIcon />, title: 'Right' },
                      {
                        id: 'stretch',
                        icon: <AlignStretchIcon />,
                        title: 'Stretch',
                      },
                    ] as const)
              }
              onChange={(a) => onPatch({ align: a })}
            />
          </FieldRow>
          <FieldRow label="Wrap">
            <LabeledSegmented<'true' | 'false'>
              value={layout.wrap ? 'true' : 'false'}
              options={[
                { id: 'true', label: 'Yes' },
                { id: 'false', label: 'No' },
              ]}
              onChange={(v) => onPatch({ wrap: v === 'true' })}
            />
          </FieldRow>
          {/* Gap is meaningless when justify=space-between/around: the
              parent computes the spacing automatically from the
              available room. Disable the slider rather than hide it so
              the user can see the value they had — flipping back to
              start/center re-enables it. */}
          {(() => {
            const autoSpacing =
              layout.justify === 'space-between' ||
              layout.justify === 'space-around'
            return (
              <>
                <KeyframeSliderRow
                  label="Gap"
                  value={layout.gap}
                  onCommit={(v) => onPatch({ gap: Math.max(0, v) })}
                  onScrubPreview={(v) =>
                    previewLayout({ gap: Math.max(0, v) })
                  }
                  onScrubCommit={(v) =>
                    commitLayoutPreview({ gap: Math.max(0, v) })
                  }
                  onScrubCancel={() => nodeLayoutPreviewStore.clear()}
                  min={0}
                  sliderMin={SPACING_SLIDER_MIN}
                  sliderMax={SPACING_SLIDER_MAX}
                  step={1}
                  suffix="px"
                  disabled={autoSpacing}
                  keyframe={
                    <KeyframeButton
                      nodeId={nodeId}
                      propertyId="layout.gap"
                      currentValue={layout.gap}
                    />
                  }
                />
                {/* Keep the reason discoverable when auto spacing owns the gap. */}
                {autoSpacing ? (
                  <div
                    className="-mt-1 pl-2 text-[10px] leading-4 text-text-dim"
                    title={`Gap is ignored when Distribute is ${layout.justify} — the layout fills the space automatically.`}
                  >
                    Controlled by {layout.justify}
                  </div>
                ) : null}
              </>
            )
          })()}
        </>
      ) : layout.mode === 'grid' ? (
        <>
          <FieldRow label="Columns">
            <NumberField
              value={layout.columns}
              onCommit={(v) => onPatch({ columns: Math.max(1, Math.round(v)) })}
              onScrubPreview={(v) =>
                previewLayout({ columns: Math.max(1, Math.round(v)) })
              }
              onScrubCommit={(v) =>
                commitLayoutPreview({ columns: Math.max(1, Math.round(v)) })
              }
              onScrubCancel={() => nodeLayoutPreviewStore.clear()}
              min={1}
              step={1}
            />
          </FieldRow>
          <FieldRow label="Gap">
            <div className="grid w-full min-w-0 grid-cols-2 gap-1.5">
              <NumberField
                value={layout.rowGap}
                onCommit={(v) => onPatch({ rowGap: Math.max(0, v) })}
                onScrubPreview={(v) =>
                  previewLayout({ rowGap: Math.max(0, v) })
                }
                onScrubCommit={(v) =>
                  commitLayoutPreview({ rowGap: Math.max(0, v) })
                }
                onScrubCancel={() => nodeLayoutPreviewStore.clear()}
                min={0}
                prefix="R"
                suffix="px"
                ariaLabel="Row gap"
                width="w-full"
              />
              <NumberField
                value={layout.columnGap}
                onCommit={(v) => onPatch({ columnGap: Math.max(0, v) })}
                onScrubPreview={(v) =>
                  previewLayout({ columnGap: Math.max(0, v) })
                }
                onScrubCommit={(v) =>
                  commitLayoutPreview({ columnGap: Math.max(0, v) })
                }
                onScrubCancel={() => nodeLayoutPreviewStore.clear()}
                min={0}
                prefix="C"
                suffix="px"
                ariaLabel="Column gap"
                width="w-full"
              />
            </div>
          </FieldRow>
          <FieldRow label="Align">
            <SelectField<FlexAlign>
              value={layout.align}
              options={['start', 'center', 'end', 'stretch'] as const}
              onCommit={(a) => onPatch({ align: a })}
            />
          </FieldRow>
        </>
      ) : null}
      {layout.mode !== 'none'
        ? (['top', 'right', 'bottom', 'left'] as const).map((side) => (
            <KeyframeSliderRow
              key={side}
              label={`Padding ${side.charAt(0).toUpperCase()}`}
              value={layout.padding[side]}
              onCommit={(v) =>
                onPatch({
                  padding: {
                    ...layout.padding,
                    [side]: Math.max(0, v),
                  },
                })
              }
              onScrubPreview={(v) =>
                previewLayout({ padding: { [side]: Math.max(0, v) } })
              }
              onScrubCommit={(v) =>
                commitLayoutPreview({
                  padding: {
                    ...layout.padding,
                    [side]: Math.max(0, v),
                  },
                })
              }
              onScrubCancel={() => nodeLayoutPreviewStore.clear()}
              min={0}
              sliderMin={SPACING_SLIDER_MIN}
              sliderMax={SPACING_SLIDER_MAX}
              step={1}
              suffix="px"
              keyframe={
                <KeyframeButton
                  nodeId={nodeId}
                  propertyId={PADDING_PROPERTY_IDS[side]}
                  currentValue={layout.padding[side]}
                />
              }
            />
          ))
        : null}
    </Section>
  )
}

/**
 * Value-only three-way layout mode control. Its owner supplies the shared
 * FieldRow so single- and multi-selection never accidentally nest grids.
 */
function LayoutModeControl({
  value,
  onCommit,
}: {
  value: LayoutMode
  onCommit: (next: LayoutMode) => void
}) {
  const modes: { id: LayoutMode; label: string; icon: ReactNode }[] = [
    {
      id: 'none',
      label: 'None',
      icon: <AppIcon name="frame" size={14} />,
    },
    {
      id: 'flex',
      label: 'Stack',
      icon: <AppIcon name="layers" size={14} />,
    },
    {
      id: 'grid',
      label: 'Grid',
      icon: <AppIcon name="grid" size={14} />,
    },
  ]
  return (
    <LabeledSegmented
      options={modes}
      value={value}
      onChange={(m) => onCommit(m as LayoutMode)}
    />
  )
}

/**
 * Compact text-segmented control shared by Layout's labeled choices.
 */
function LabeledSegmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<{ id: T; label: string; icon?: ReactNode }>
  value: T
  onChange: (next: T) => void
}) {
  return (
    <SquircleSurface
      radius={6}
      className="hm-control-surface hm-control-compact hm-inspector-segmented"
    >
      {options.map((o) => {
        const active = o.id === value
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            aria-pressed={active}
            data-active={active}
            className="hm-inspector-segment"
          >
            {o.icon}
            <span>{o.label}</span>
          </button>
        )
      })}
    </SquircleSurface>
  )
}

/**
 * IconSegmented — same shape as LabeledSegmented but every option is
 * an icon glyph. Used for Direction (row / column arrows), Align
 * (start / center / end / stretch bars), and any other perpendicular
 * picker where icons read faster than words.
 */
function IconSegmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<{ id: T; icon: ReactNode; title: string }>
  value: T
  onChange: (next: T) => void
}) {
  return (
    <SquircleSurface
      radius={6}
      className="hm-control-surface hm-control-compact hm-inspector-segmented"
    >
      {options.map((o) => {
        const active = o.id === value
        return (
          <button
            key={o.id}
            type="button"
            title={o.title}
            onClick={() => onChange(o.id)}
            aria-pressed={active}
            data-active={active}
            className="hm-inspector-segment"
          >
            {o.icon}
          </button>
        )
      })}
    </SquircleSurface>
  )
}

// ---------------------------------------------------------------------------
// Layout icon glyphs used by IconSegmented in the Layout section.
// 14×14 viewBox sized for the 28px hit slot inside the segmented track.
// All use `currentColor` so the segmented control's text color (active
// vs inactive) drives the stroke without each icon caring.
// ---------------------------------------------------------------------------

function svgIconProps(size = 14) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 14 14',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.4,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  } as const
}

// Direction — horizontal vs vertical arrow inside a frame outline.
function DirectionRowIcon() {
  return (
    <svg {...svgIconProps()}>
      <path d="M3 7h8M8 4l3 3-3 3" />
    </svg>
  )
}
function DirectionColumnIcon() {
  return (
    <svg {...svgIconProps()}>
      <path d="M7 3v8M4 8l3 3 3-3" />
    </svg>
  )
}

// Align — vertical-direction alignment (Top / Middle / Bottom / Stretch).
function AlignTopIcon() {
  return (
    <svg {...svgIconProps()}>
      <path d="M2 3h10" />
      <rect x="5" y="5" width="4" height="6" rx="0.6" fill="currentColor" />
    </svg>
  )
}
function AlignMidYIcon() {
  return (
    <svg {...svgIconProps()}>
      <path d="M2 7h10" />
      <rect x="5" y="4" width="4" height="6" rx="0.6" fill="currentColor" />
    </svg>
  )
}
function AlignBottomIcon() {
  return (
    <svg {...svgIconProps()}>
      <path d="M2 11h10" />
      <rect x="5" y="3" width="4" height="6" rx="0.6" fill="currentColor" />
    </svg>
  )
}
// Align — horizontal-direction alignment (Left / Center / Right / Stretch).
function AlignLeftIcon() {
  return (
    <svg {...svgIconProps()}>
      <path d="M3 2v10" />
      <rect x="5" y="5" width="6" height="4" rx="0.6" fill="currentColor" />
    </svg>
  )
}
function AlignMidXIcon() {
  return (
    <svg {...svgIconProps()}>
      <path d="M7 2v10" />
      <rect x="4" y="5" width="6" height="4" rx="0.6" fill="currentColor" />
    </svg>
  )
}
function AlignRightIcon() {
  return (
    <svg {...svgIconProps()}>
      <path d="M11 2v10" />
      <rect x="3" y="5" width="6" height="4" rx="0.6" fill="currentColor" />
    </svg>
  )
}
// Stretch — bar that fills the cross-axis (rendered the same regardless
// of direction; it's "fill the parent on this axis" semantically).
function AlignStretchIcon() {
  return (
    <svg {...svgIconProps()}>
      <rect x="3" y="3" width="8" height="8" rx="1" fill="currentColor" />
    </svg>
  )
}

/**
 * SliderField — Framer's "32 ─────●─" pattern. Numeric input on the
 * left (compact, ~64px), accent-filled range track on the right.
 *
 * Implementation note: we use a native <input type="range"> for
 * accessibility and free keyboard support, but skin it heavily so it
 * matches the rest of the dark inspector. The fill below the thumb
 * is painted via a CSS linear-gradient on the track background — no
 * custom SVG, no JS-driven width math.
 */
function SliderField({
  value,
  onCommit,
  min = 0,
  max = 100,
  step = 1,
  suffix,
  disabled,
}: {
  value: number
  onCommit: (next: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
  disabled?: boolean
}) {
  // Visual fill: percentage of the way from min to max. Capped to the
  // track range so a value > max (rare but possible from animated
  // properties) still paints the track 100%.
  const pct = Math.max(0, Math.min(1, (value - min) / Math.max(1, max - min)))
  const fillPercent = Math.round(pct * 100)
  return (
    <div
      className={[
        'flex w-full items-center gap-2',
        disabled ? 'pointer-events-none opacity-50' : '',
      ].join(' ')}
    >
      <NumberField
        value={value}
        onCommit={onCommit}
        min={min}
        max={max}
        step={step}
        suffix={suffix}
        width="w-16"
      />
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onCommit(Number(e.currentTarget.value))}
        className="hyper-slider h-1.5 flex-1 cursor-pointer appearance-none rounded-full"
        style={{
          background: `linear-gradient(to right, var(--color-accent) 0%, var(--color-accent) ${fillPercent}%, var(--color-border) ${fillPercent}%, var(--color-border) 100%)`,
        }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stroke controls — reused in Scene Background + per-node Appearance.
// ---------------------------------------------------------------------------

/** A sensible starting stroke when the user "turns stroke on" by picking a
 * color. Mid-grey, 1px, inside alignment, solid — matches Figma's default.
 * Dash length/gap get Figma-ish starting values so switching to "Dashed"
 * without touching anything else produces a visually obvious dash. */
const STROKE_DEFAULT: Stroke = {
  color: 'oklch(0.6 0 0)',
  width: 1,
  align: 'inside',
  style: 'solid',
  dashLength: 6,
  dashGap: 4,
}

/**
 * Normalize a possibly-old `Stroke` (missing `style` / dash fields on docs
 * saved before this field existed) so downstream UI can rely on every
 * field being present. Callers pass the potentially-partial object in
 * and receive a complete Stroke back without mutating the original.
 */
function normalizeStroke(s: Stroke): Stroke {
  return {
    ...s,
    style: s.style ?? 'solid',
    dashLength: s.dashLength ?? STROKE_DEFAULT.dashLength,
    dashGap: s.dashGap ?? STROKE_DEFAULT.dashGap,
  }
}

/**
 * Color + width + align rows for a stroke.
 *
 * Follows the Figma pattern where strokes are toggled *by presence of a
 * color*: picking a color on a null stroke promotes it to a real
 * {color, width, align} triple; clearing the color from an existing
 * stroke collapses it back to null. No separate "enable stroke"
 * checkbox — the swatch IS the toggle.
 *
 * Width / align rows only render when a stroke exists, so the section
 * doesn't show edit handles for a property that's been turned off.
 */
function StrokeControls({
  value,
  onCommit,
}: {
  value: Stroke | null
  onCommit: (next: Stroke | null) => void
}) {
  // Every path below that reads `value` shape needs the normalized form so
  // Style / Dash Length / Gap read the right defaults on old docs that
  // were saved before those fields existed.
  const v = value ? normalizeStroke(value) : null

  // Stroke paint surfaces through FillField, same control as the
  // appearance Fill. `fill` takes precedence over the flat `color` at
  // render time, so we treat it as authoritative here: the FillField
  // reads/writes `stroke.fill`, and selecting "None" in the picker
  // removes the whole stroke (matching the old behavior where clearing
  // the color removed the stroke). Solid fills still populate the
  // legacy `color` mirror so old code paths and exports that read
  // `color` keep working.
  const currentStrokeFill = v?.fill ?? (v ? { kind: 'solid' as const, color: v.color } : null)

  return (
    <>
      <FieldRow label="Stroke" reserveAction>
        <FillField
          label=""
          value={currentStrokeFill}
          onCommit={(fill) => {
            if (fill === null) {
              onCommit(null)
              return
            }
            // Mirror solid-fill color into the legacy `color` field so
            // code outside the renderer (exports, future migrations) still
            // sees a plausible flat color. Gradients keep the last known
            // solid color for fallback.
            const nextColor =
              fill.kind === 'solid'
                ? fill.color
                : (v?.color ?? STROKE_DEFAULT.color)
            onCommit({
              ...(v ?? STROKE_DEFAULT),
              color: nextColor,
              fill,
            })
          }}
        />
      </FieldRow>
      {v ? (
        <>
          <StrokeWidthField value={v} onCommit={onCommit} />
          <FieldRow label="Align">
            <SelectField<Stroke['align']>
              value={v.align}
              options={
                [
                  { value: 'inside', label: 'Inside' },
                  { value: 'center', label: 'Center' },
                  { value: 'outside', label: 'Outside' },
                ] as const
              }
              onCommit={(a) => onCommit({ ...v, align: a })}
              width="w-full"
            />
          </FieldRow>
          <FieldRow label="Style">
            <SelectField<Stroke['style']>
              value={v.style}
              options={
                [
                  { value: 'solid', label: 'Solid' },
                  { value: 'dashed', label: 'Dashed' },
                  { value: 'dotted', label: 'Dotted' },
                ] as const
              }
              onCommit={(s) => onCommit({ ...v, style: s })}
              width="w-full"
            />
          </FieldRow>
          {v.style === 'dashed' ? (
            <>
              <FieldRow label="Dash">
                <NumberField
                  value={v.dashLength}
                  onCommit={(n) =>
                    onCommit({ ...v, dashLength: Math.max(0, n) })
                  }
                  min={0}
                  step={0.5}
                  suffix="px"
                />
              </FieldRow>
              <FieldRow label="Gap">
                <NumberField
                  value={v.dashGap}
                  onCommit={(n) => onCommit({ ...v, dashGap: Math.max(0, n) })}
                  min={0}
                  step={0.5}
                  suffix="px"
                />
              </FieldRow>
            </>
          ) : null}
        </>
      ) : null}
    </>
  )
}

// ---------------------------------------------------------------------------
// Layout guides — Figma-style stacked overlays on a frame.
// ---------------------------------------------------------------------------

/**
 * Default per-kind shapes used when the user clicks "+ Add guide."
 * Mirrors the look of Figma's defaults so designers feel at home.
 */
const DEFAULT_GUIDES: Record<LayoutGuide['kind'], LayoutGuide> = {
  grid: {
    kind: 'grid',
    visible: true,
    size: 10,
    color: 'oklch(0.62 0.21 250)',
    opacity: 0.1,
  },
  columns: {
    kind: 'columns',
    visible: true,
    count: 12,
    color: 'oklch(0.62 0.21 250)',
    opacity: 0.1,
    type: 'stretch',
    width: 80,
    margin: 24,
    gutter: 20,
  },
  rows: {
    kind: 'rows',
    visible: true,
    count: 5,
    color: 'oklch(0.62 0.21 250)',
    opacity: 0.1,
    type: 'stretch',
    height: 80,
    margin: 24,
    gutter: 20,
  },
}

function LayoutGuidesSection({
  node,
  api,
}: {
  node: FrameNode
  api: SceneAPI
}) {
  // Defensive fallback — old docs that predate the field round-trip
  // through the read path with `?? []`, but that's at one boundary.
  // Use the same guard at the consumer level so a malformed shape
  // never bubbles up as a runtime error in the Inspector either.
  const guides = node.layoutGuides ?? []
  const setGuides = (next: LayoutGuide[]) => {
    api.setNodeProperty(node.id, 'layoutGuides', next)
  }
  const addGuide = (kind: LayoutGuide['kind']) => {
    setGuides([...guides, { ...DEFAULT_GUIDES[kind] }])
  }
  return (
    <section className="border-t border-border pt-4 first:border-t-0 first:pt-0">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[11px] font-semibold text-text-muted">
          Layout guide
        </div>
        <div className="relative">
          <AddGuideButton onAdd={addGuide} />
        </div>
      </div>
      {guides.length === 0 ? (
        <div className="rounded border border-dashed border-border bg-panel-raised/40 px-2.5 py-2 text-[11px] text-text-dim">
          Stack pixel grids, columns, and rows. Click + to add one.
        </div>
      ) : (
        <div className="space-y-1.5">
          {guides.map((g, i) => (
            <LayoutGuideRow
              key={i}
              guide={g}
              onChange={(next) => {
                const arr = guides.slice()
                arr[i] = next
                setGuides(arr)
              }}
              onToggleVisible={() => {
                const arr = guides.slice()
                arr[i] = { ...g, visible: !g.visible } as LayoutGuide
                setGuides(arr)
              }}
              onDelete={() => {
                setGuides(guides.filter((_, j) => j !== i))
              }}
            />
          ))}
        </div>
      )}
    </section>
  )
}

/**
 * Inline "+" with a tiny popover offering Grid / Columns / Rows. The
 * popover is uncontrolled — clicking outside closes it.
 */
function AddGuideButton({
  onAdd,
}: {
  onAdd: (kind: LayoutGuide['kind']) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as globalThis.Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-panel-raised hover:text-text"
        title="Add layout guide"
      >
        +
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-28 rounded border border-border bg-panel shadow-lg">
          {(['grid', 'columns', 'rows'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                onAdd(k)
                setOpen(false)
              }}
              className="block w-full px-2.5 py-1.5 text-left text-[11px] capitalize text-text hover:bg-panel-raised"
            >
              {k}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * One guide row in the list. Collapsed view shows the guide's name +
 * eye + remove. Click the chevron to expand to the full editor for
 * its kind.
 */
function LayoutGuideRow({
  guide,
  onChange,
  onToggleVisible,
  onDelete,
}: {
  guide: LayoutGuide
  onChange: (next: LayoutGuide) => void
  onToggleVisible: () => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const summary =
    guide.kind === 'grid'
      ? `Grid ${guide.size}px`
      : guide.kind === 'columns'
        ? `${guide.count} columns`
        : `${guide.count} rows`
  return (
    <div className="rounded border border-border bg-panel-raised/40">
      <div className="flex h-7 items-center gap-1.5 px-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-muted hover:bg-panel hover:text-text"
          title={open ? 'Collapse' : 'Expand'}
        >
          <span
            className={
              'inline-block transition-transform ' +
              (open ? 'rotate-90' : '')
            }
          >
            ▸
          </span>
        </button>
        <span
          className={
            'flex h-4 w-4 shrink-0 items-center justify-center rounded ' +
            (guide.visible ? 'text-accent' : 'text-text-dim')
          }
          aria-hidden
        >
          <GuideKindGlyph kind={guide.kind} />
        </span>
        <span className="flex-1 truncate font-mono text-[11px] text-text">
          {summary}
        </span>
        <button
          type="button"
          onClick={onToggleVisible}
          className={
            'flex h-5 w-5 items-center justify-center rounded ' +
            (guide.visible
              ? 'text-text-muted hover:bg-panel hover:text-text'
              : 'text-text-dim hover:bg-panel hover:text-text-muted')
          }
          title={guide.visible ? 'Hide guide' : 'Show guide'}
        >
          {guide.visible ? '◉' : '○'}
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="flex h-5 w-5 items-center justify-center rounded text-text-muted hover:bg-panel hover:text-text"
          title="Remove guide"
        >
          −
        </button>
      </div>
      {open && (
        <div className="space-y-1.5 border-t border-border px-2 py-2">
          {guide.kind === 'grid' ? (
            <GridGuideEditor guide={guide} onChange={onChange} />
          ) : guide.kind === 'columns' ? (
            <ColumnsGuideEditor guide={guide} onChange={onChange} />
          ) : (
            <RowsGuideEditor guide={guide} onChange={onChange} />
          )}
        </div>
      )}
    </div>
  )
}

function GridGuideEditor({
  guide,
  onChange,
}: {
  guide: Extract<LayoutGuide, { kind: 'grid' }>
  onChange: (next: LayoutGuide) => void
}) {
  return (
    <>
      <FieldRow label="Size">
        <NumberField
          value={guide.size}
          onCommit={(v) => onChange({ ...guide, size: Math.max(1, v) })}
          suffix="px"
        />
      </FieldRow>
      <FieldRow label="Color">
        <ColorField
          value={guide.color}
          onCommit={(c) => c && onChange({ ...guide, color: c })}
        />
      </FieldRow>
      <FieldRow label="Opacity">
        <NumberField
          value={Math.round(guide.opacity * 100)}
          onCommit={(v) =>
            onChange({ ...guide, opacity: clamp01(v / 100) })
          }
          suffix="%"
          min={0}
          max={100}
        />
      </FieldRow>
    </>
  )
}

function ColumnsGuideEditor({
  guide,
  onChange,
}: {
  guide: Extract<LayoutGuide, { kind: 'columns' }>
  onChange: (next: LayoutGuide) => void
}) {
  return (
    <>
      <FieldRow label="Count">
        <NumberField
          value={guide.count}
          onCommit={(v) => onChange({ ...guide, count: Math.max(1, v) })}
        />
      </FieldRow>
      <FieldRow label="Color">
        <ColorField
          value={guide.color}
          onCommit={(c) => c && onChange({ ...guide, color: c })}
        />
      </FieldRow>
      <FieldRow label="Opacity">
        <NumberField
          value={Math.round(guide.opacity * 100)}
          onCommit={(v) =>
            onChange({ ...guide, opacity: clamp01(v / 100) })
          }
          suffix="%"
          min={0}
          max={100}
        />
      </FieldRow>
      <FieldRow label="Type">
        <SelectField<'stretch' | 'fixed' | 'center'>
          value={guide.type}
          onCommit={(t) => onChange({ ...guide, type: t })}
          options={[
            { value: 'stretch', label: 'Stretch' },
            { value: 'fixed', label: 'Left' },
            { value: 'center', label: 'Center' },
          ]}
        />
      </FieldRow>
      <FieldRow label="Width">
        <div
          className={
            guide.type === 'stretch' ? 'pointer-events-none opacity-50' : ''
          }
        >
          <NumberField
            value={guide.width}
            onCommit={(v) => onChange({ ...guide, width: Math.max(0, v) })}
            suffix="px"
          />
        </div>
      </FieldRow>
      <FieldRow label="Margin">
        <NumberField
          value={guide.margin}
          onCommit={(v) => onChange({ ...guide, margin: Math.max(0, v) })}
          suffix="px"
        />
      </FieldRow>
      <FieldRow label="Gutter">
        <NumberField
          value={guide.gutter}
          onCommit={(v) => onChange({ ...guide, gutter: Math.max(0, v) })}
          suffix="px"
        />
      </FieldRow>
    </>
  )
}

function RowsGuideEditor({
  guide,
  onChange,
}: {
  guide: Extract<LayoutGuide, { kind: 'rows' }>
  onChange: (next: LayoutGuide) => void
}) {
  return (
    <>
      <FieldRow label="Count">
        <NumberField
          value={guide.count}
          onCommit={(v) => onChange({ ...guide, count: Math.max(1, v) })}
        />
      </FieldRow>
      <FieldRow label="Color">
        <ColorField
          value={guide.color}
          onCommit={(c) => c && onChange({ ...guide, color: c })}
        />
      </FieldRow>
      <FieldRow label="Opacity">
        <NumberField
          value={Math.round(guide.opacity * 100)}
          onCommit={(v) =>
            onChange({ ...guide, opacity: clamp01(v / 100) })
          }
          suffix="%"
          min={0}
          max={100}
        />
      </FieldRow>
      <FieldRow label="Type">
        <SelectField<'stretch' | 'fixed' | 'center'>
          value={guide.type}
          onCommit={(t) => onChange({ ...guide, type: t })}
          options={[
            { value: 'stretch', label: 'Stretch' },
            { value: 'fixed', label: 'Top' },
            { value: 'center', label: 'Center' },
          ]}
        />
      </FieldRow>
      <FieldRow label="Height">
        <div
          className={
            guide.type === 'stretch' ? 'pointer-events-none opacity-50' : ''
          }
        >
          <NumberField
            value={guide.height}
            onCommit={(v) => onChange({ ...guide, height: Math.max(0, v) })}
            suffix="px"
          />
        </div>
      </FieldRow>
      <FieldRow label="Margin">
        <NumberField
          value={guide.margin}
          onCommit={(v) => onChange({ ...guide, margin: Math.max(0, v) })}
          suffix="px"
        />
      </FieldRow>
      <FieldRow label="Gutter">
        <NumberField
          value={guide.gutter}
          onCommit={(v) => onChange({ ...guide, gutter: Math.max(0, v) })}
          suffix="px"
        />
      </FieldRow>
    </>
  )
}

function GuideKindGlyph({ kind }: { kind: LayoutGuide['kind'] }) {
  if (kind === 'grid') {
    return (
      <svg
        width={12}
        height={12}
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
      >
        <path d="M2 2 H 10 V 10 H 2 Z M 2 6 H 10 M 6 2 V 10" />
      </svg>
    )
  }
  if (kind === 'columns') {
    return (
      <svg
        width={12}
        height={12}
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
      >
        <path d="M2 2 V 10 M 6 2 V 10 M 10 2 V 10" />
      </svg>
    )
  }
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
    >
      <path d="M2 2 H 10 M 2 6 H 10 M 2 10 H 10" />
    </svg>
  )
}

// `clamp01` is defined earlier in this file and reused here.

// ---------------------------------------------------------------------------
// Section heading
// ---------------------------------------------------------------------------

function Section({
  title,
  children,
  action,
  preserveTimelineSelection = false,
}: {
  title: string
  children: ReactNode
  /**
   * Optional right-aligned action shown on the section header. Used
   * for the "+" / collapse glyph on Framer-style sections (e.g. a
   * chevron to expand / collapse, or a plus to add a new sub-entry).
   * Pass null / omit when the section is read-only.
   */
  action?: ReactNode
  preserveTimelineSelection?: boolean
}) {
  return (
    <section className="border-t border-border pt-4 first:border-t-0 first:pt-0">
      <div className="mb-2 flex h-6 items-center justify-between">
        <span className="text-[12px] font-bold text-text">{title}</span>
        {action ? (
          <span className="flex items-center text-text-muted">{action}</span>
        ) : null}
      </div>
      <div
        data-timeline-selection-surface={
          preserveTimelineSelection ? '1' : undefined
        }
        className="space-y-2.5"
      >
        {children}
      </div>
    </section>
  )
}

/**
 * Section-level boolean switches do not use the property value grid. Their
 * labels need the full row, while the native checkbox stays on the same
 * right-hand guide as other Inspector actions.
 */
function SectionToggleRow({
  label,
  value,
  onCommit,
  mixed = false,
  plain = false,
}: {
  label: string
  value: boolean
  onCommit: (next: boolean) => void
  mixed?: boolean
  /** Property rows align to the section edge without a hover well. */
  plain?: boolean
}) {
  return (
    <label
      data-inspector-toggle-row="1"
      className={[
        'flex min-h-7 w-full cursor-pointer items-center justify-between gap-3 text-[12px] text-text-muted transition-colors hover:text-text',
        plain ? '' : 'rounded-md pl-2 hover:bg-panel-raised/55',
      ].join(' ')}
    >
      <span className="min-w-0 flex-1">{label}</span>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center">
        <CheckboxField value={value} mixed={mixed} onCommit={onCommit} />
      </span>
    </label>
  )
}
