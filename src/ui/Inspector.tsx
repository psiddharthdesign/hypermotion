// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useUI } from '@/state/ui'
import { useSceneAPI, useSceneVersion } from '@/scene'
import type {
  Appearance,
  CameraNode,
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
  PropertyId,
  Size,
  Stroke,
  TextNode,
  Transform,
} from '@/scene'
import { isImageFile } from '@/ui/importImage'
import { getLastSolvedLayout } from '@/ui/hooks/lastSolvedLayout'
import { useAnimatedValues } from '@/ui/hooks/useAnimatedValues'
import type { SceneAPI } from '@/scene/doc'
import {
  CheckboxField,
  ColorField,
  FieldRow,
  FillField,
  KeyframeButton,
  NumberField,
  ScalePairField,
  SelectField,
  SizeAxisField,
  StrokeWidthField,
  TextField,
} from '@/ui/fields'
import { PresetsPanel } from '@/ui/PresetsPanel'
import { AlignTools } from '@/ui/AlignTools'
import { setLockedRecursive, wrapInAutoLayout } from '@/ui/actions'
import {
  findKeyframeAt,
  findTrack,
  recordKeyframesForPatch,
  removeTrack,
  stampToActiveTracksForPatch,
  toggleKeyframe,
} from '@/anim'
import {
  GOOGLE_FONTS,
  isGoogleFont,
  loadGoogleFont,
  type GoogleFontSpec,
} from '@/ui/fonts/googleFonts'

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
      className="relative flex shrink-0 flex-col border-l border-border bg-panel"
      style={{ width }}
    >
      <div
        onPointerDown={onResizeDown}
        title="Drag to resize"
        className="absolute left-0 top-0 z-10 h-full w-1 -translate-x-1/2 cursor-col-resize hover:bg-accent/50"
      />
      <ModeTabs />
      <div className="flex-1 overflow-auto p-5 text-[12px]">
        {mode === 'animate' ? (
          <PresetsPanel />
        ) : showScene ? (
          <SceneDetails api={api} />
        ) : multiNodes && multiNodes.length > 1 ? (
          <MultiNodeDetails nodes={multiNodes} api={api} />
        ) : singleNode ? (
          <NodeDetails node={singleNode} api={api} />
        ) : null}
      </div>
    </aside>
  )
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

function ModeTabs() {
  const mode = useUI((s) => s.inspectorMode)
  const setMode = useUI((s) => s.setInspectorMode)
  // Apple HIG segmented pill — sits inside the panel padding instead of
  // claiming a full-width strip. Active tab is a raised inner pill with
  // shadow; inactive tabs read as transparent. Matches macOS System
  // Settings / Notion view-picker patterns. The whole control sits in
  // its own padded band so it integrates with the rest of the panel
  // chrome rather than reading like a top-of-viewport navigation bar.
  return (
    <div className="shrink-0 border-b border-border bg-panel-raised px-3 py-2.5">
      <div className="flex h-[30px] items-center gap-0.5 rounded-md border border-border bg-app-bg p-[2px]">
        {(['properties', 'animate'] as const).map((m) => {
          const active = mode === m
          return (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={[
                'flex h-[24px] flex-1 items-center justify-center gap-1.5 rounded-[5px] text-[12px] font-medium transition-colors',
                active
                  ? 'bg-panel-raised text-text shadow-sm'
                  : 'text-text-muted hover:text-text',
              ].join(' ')}
            >
              <span className="flex h-3 w-3 items-center justify-center">
                {m === 'properties' ? <PenTabIcon /> : <PlayTabIcon />}
              </span>
              {m === 'properties' ? 'Properties' : 'Animate'}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function PenTabIcon() {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M11 2l3 3-8.5 8.5L2 14l.5-3.5L11 2z" />
    </svg>
  )
}

function PlayTabIcon() {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden
    >
      <path d="M4 3l9 5-9 5V3z" />
    </svg>
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
function SceneDetails({ api }: { api: SceneAPI }) {
  const meta = api.getMeta()
  const rootId = api.getRoot()
  const root = rootId ? api.getNode(rootId) : null

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
    <div className="space-y-6">
      <Section title="Scene">
        <FieldRow label="Name">
          <TextField
            value={meta.name}
            onCommit={(n) => {
              api.setMeta({ name: n })
              // Keep the layers-panel label in sync. The root node's
              // name is what LayersPanel renders; without this they
              // drift (Inspector shows the new name, Layers still shows
              // the old one).
              if (root) api.setNodeProperty(root.id, 'name', n)
            }}
            allowEmpty={false}
          />
        </FieldRow>
        <FieldRow label="Width">
          <NumberField
            value={meta.canvas.width}
            onCommit={(v) => setCanvasSize(v, meta.canvas.height)}
            min={1}
          />
        </FieldRow>
        <FieldRow label="Height">
          <NumberField
            value={meta.canvas.height}
            onCommit={(v) => setCanvasSize(meta.canvas.width, v)}
            min={1}
          />
        </FieldRow>
        <FieldRow label="Duration">
          <NumberField
            value={meta.duration}
            onCommit={(v) => api.setMeta({ duration: Math.max(0.1, v) })}
            min={0.1}
            step={0.1}
            suffix="s"
          />
        </FieldRow>
        <FieldRow label="Frame rate">
          <NumberField
            value={meta.frameRate}
            onCommit={(v) => api.setMeta({ frameRate: Math.max(1, Math.round(v)) })}
            min={1}
            step={1}
          />
        </FieldRow>
      </Section>

      {root && root.kind === 'frame' ? (
        <>
          <Section title="Background">
            <FillField
              value={root.appearance.fill}
              onCommit={(fill) =>
                api.setNodeProperty(root.id, 'appearance', {
                  ...root.appearance,
                  fill,
                })
              }
            />
            <StrokeControls
              value={root.appearance.stroke}
              onCommit={(stroke) =>
                api.setNodeProperty(root.id, 'appearance', {
                  ...root.appearance,
                  stroke,
                })
              }
            />
            <FieldRow label="Corner">
              <CornerField
                uniformValue={root.appearance.cornerRadius}
                cornerRadii={root.appearance.cornerRadii}
                onCommitUniform={(v) =>
                  api.setNodeProperty(root.id, 'appearance', {
                    ...root.appearance,
                    cornerRadius: Math.max(0, v),
                  })
                }
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
            <FieldRow label="Clip">
              <CheckboxField
                value={root.clipsContent}
                onCommit={(v) => api.setNodeProperty(root.id, 'clipsContent', v)}
              />
            </FieldRow>
          </Section>

          <LayoutSection
            layout={root.layout}
            onPatch={(patch) => {
              api.setNodeProperty(root.id, 'layout', {
                ...root.layout,
                ...patch,
              })
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
  const playhead = useUI((s) => s.playhead)
  const count = nodes.length

  // Capability gates — skip whole sections that don't fit every node.
  const allHaveSize = nodes.every((n) => 'size' in n)
  const allHaveLayout = nodes.every((n) => 'layout' in n)
  const allFrames = nodes.every((n) => n.kind === 'frame')

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
  const patchTransformAll = (patch: Partial<Transform>) => {
    for (const n of nodes) {
      api.setNodeProperty(n.id, 'transform', { ...n.transform, ...patch })
      if (recording) {
        recordKeyframesForPatch(api, n.id, playhead, 'transform', patch)
      } else {
        stampToActiveTracksForPatch(api, n.id, playhead, 'transform', patch)
      }
    }
  }
  const patchAppearanceAll = (patch: Partial<Appearance>) => {
    for (const n of nodes) {
      api.setNodeProperty(n.id, 'appearance', { ...n.appearance, ...patch })
      if (recording) {
        recordKeyframesForPatch(api, n.id, playhead, 'appearance', patch)
      } else {
        stampToActiveTracksForPatch(api, n.id, playhead, 'appearance', patch)
      }
    }
  }
  const patchSizeAll = (patch: Partial<Size>) => {
    for (const n of nodes) {
      if ('size' in n) {
        api.setNodeProperty(n.id, 'size', { ...n.size, ...patch })
        if (recording) {
          recordKeyframesForPatch(api, n.id, playhead, 'size', patch)
        } else {
          stampToActiveTracksForPatch(api, n.id, playhead, 'size', patch)
        }
      }
    }
  }
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
          // Auto-clear stale transform.x/y on flow children when the
          // parent flips none → flex/grid. See the matching block in
          // NodeDetails.patchLayout for rationale.
          const isAutoLayout = patch.mode === 'flex' || patch.mode === 'grid'
          if (isAutoLayout && n.layout.mode === 'none') {
            for (const child of api.getChildren(n.id)) {
              if (child.position === 'absolute') continue
              if (child.transform.x === 0 && child.transform.y === 0) continue
              api.setNodeProperty(child.id, 'transform', {
                ...child.transform,
                x: 0,
                y: 0,
              })
            }
          }
        }
      }
    })
  }

  // Shared values across the selection — `mixed` means they disagree.
  const cVisible = common(nodes, (n) => n.visible)
  const cLocked = common(nodes, (n) => n.locked)

  const cX = common(nodes, (n) => n.transform.x)
  const cY = common(nodes, (n) => n.transform.y)
  const cRot = common(nodes, (n) => n.transform.rotation)
  const cSX = common(nodes, (n) => n.transform.scaleX)
  const cSY = common(nodes, (n) => n.transform.scaleY)

  const cW = allHaveSize
    ? common(nodes, (n) => ('size' in n ? n.size.width : 0))
    : null
  const cH = allHaveSize
    ? common(nodes, (n) => ('size' in n ? n.size.height : 0))
    : null

  const cOpacity = common(nodes, (n) => n.appearance.opacity)
  // Fill reads the full Fill shape — solid, linear, or radial. common()
  // does structural JSON equality so two nodes with the same gradient
  // stops + angle still resolve to a non-mixed value.
  const cFill = common(nodes, (n) => n.appearance.fill)

  // If EVERY selected node's parent has fill=null, disable the fill
  // control for the selection — matches the single-node behavior where
  // a child fill inside a fill-less parent has nowhere to paint. Root
  // nodes (parent: null) don't participate in this check — they are the
  // artboard and their fill-less-ness doesn't mean "no paintable
  // surface." If even one selected node has a parent with a real fill,
  // we leave the control enabled so editing the multi-selection still
  // works against the non-null-parent subset.
  const allParentsFillNull = nodes.every((n) => {
    if (!n.parent) return false
    const p = api.getNode(n.parent)
    return !!p && p.appearance.fill === null
  })
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
    <div className="space-y-6">
      <div className="rounded border border-border bg-panel-raised px-3 py-2 text-text-muted">
        <div className="text-[12px]">{count} layers selected</div>
        <div className="mt-0.5 text-[10px] text-text-dim">
          Edits apply to every selected layer. Fields showing{' '}
          <span className="font-medium text-text-muted">mixed</span> have
          differing values.
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
        <div className="mb-3">
          <AlignTools api={api} selection={selection} />
        </div>
        <FieldRow label="X">
          <MixedCell mixed={cX.mixed}>
            <NumberField
              value={cX.value}
              onCommit={(v) => patchTransformAll({ x: v })}
            />
          </MixedCell>
        </FieldRow>
        <FieldRow label="Y">
          <MixedCell mixed={cY.mixed}>
            <NumberField
              value={cY.value}
              onCommit={(v) => patchTransformAll({ y: v })}
            />
          </MixedCell>
        </FieldRow>
        <FieldRow label="Rotation">
          <MixedCell mixed={cRot.mixed}>
            <NumberField
              value={cRot.value}
              onCommit={(v) => patchTransformAll({ rotation: v })}
              suffix="°"
            />
          </MixedCell>
        </FieldRow>
        <FieldRow label="Scale">
          <ScalePairField
            scaleX={cSX.value}
            scaleY={cSY.value}
            mixedX={cSX.mixed}
            mixedY={cSY.mixed}
            onCommitX={(v) => patchTransformAll({ scaleX: v })}
            onCommitY={(v) => patchTransformAll({ scaleY: v })}
          />
        </FieldRow>
      </Section>

      {cW && cH ? (
        <Section title="Size">
          <FieldRow label="Width">
            {/* Don't wrap SizeAxisField in MixedCell — the badge used
             * to steal width from the Fixed/Hug/Fill pills on mixed
             * selections, forcing users to first pick Hug before Fill
             * became reachable. The field now owns its own mixed
             * indicator and the pills stay at full width. */}
            <SizeAxisField
              value={cW.value}
              mixed={cW.mixed}
              onCommit={(w) => patchSizeAll({ width: w })}
            />
          </FieldRow>
          <FieldRow label="Height">
            <SizeAxisField
              value={cH.value}
              mixed={cH.mixed}
              onCommit={(h) => patchSizeAll({ height: h })}
            />
          </FieldRow>
        </Section>
      ) : null}

      {cLayout && allHaveLayout ? (
        <MultiLayoutSection
          common={cLayout}
          onPatch={patchLayoutAll}
        />
      ) : null}

      <Section title="Appearance">
        <FieldRow label="Opacity">
          <MixedCell mixed={cOpacity.mixed}>
            <NumberField
              value={cOpacity.value}
              onCommit={(v) => patchAppearanceAll({ opacity: v })}
              min={0}
              max={1}
              step={0.05}
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
          onCommit={(fill) => patchAppearanceAll({ fill })}
          disabled={allParentsFillNull}
          disabledReason="Parent has no fill — child fill would be invisible"
        />
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
        <FieldRow label="Corner">
          <MixedCell mixed={cCorner.mixed}>
            <NumberField
              value={cCorner.value}
              onCommit={(v) => patchAppearanceAll({ cornerRadius: v })}
              min={0}
            />
          </MixedCell>
        </FieldRow>
        {cClip ? (
          <FieldRow label="Clip">
            <MixedCell mixed={cClip.mixed}>
              <CheckboxField
                value={cClip.value}
                onCommit={(v) => {
                  for (const n of nodes) {
                    if (n.kind === 'frame') {
                      api.setNodeProperty(n.id, 'clipsContent', v)
                    }
                  }
                }}
              />
            </MixedCell>
          </FieldRow>
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
}) {
  return (
    <Section title="Layout">
      <MixedCell mixed={c.mode.mixed}>
        <ModeToggle
          value={c.mode.value}
          onCommit={(m) => onPatch({ mode: m })}
        />
      </MixedCell>
      {c.mode.value === 'flex' && !c.mode.mixed ? (
        <>
          <FieldRow label="Direction">
            <MixedCell mixed={c.direction.mixed}>
              <SelectField<FlexDirection>
                value={c.direction.value}
                options={['row', 'column'] as const}
                onCommit={(d) => onPatch({ direction: d })}
              />
            </MixedCell>
          </FieldRow>
          <FieldRow label="Justify">
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
              <SelectField<FlexAlign>
                value={c.align.value}
                options={['start', 'center', 'end', 'stretch'] as const}
                onCommit={(a) => onPatch({ align: a })}
              />
            </MixedCell>
          </FieldRow>
          <FieldRow label="Gap">
            <MixedCell mixed={c.gap.mixed}>
              <NumberField
                value={c.gap.value}
                onCommit={(v) => onPatch({ gap: v })}
                min={0}
              />
            </MixedCell>
          </FieldRow>
          <FieldRow label="Wrap">
            <MixedCell mixed={c.wrap.mixed}>
              <CheckboxField
                value={c.wrap.value}
                onCommit={(w) => onPatch({ wrap: w })}
              />
            </MixedCell>
          </FieldRow>
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
                min={1}
                step={1}
              />
            </MixedCell>
          </FieldRow>
          <FieldRow label="Row gap">
            <MixedCell mixed={c.rowGap.mixed}>
              <NumberField
                value={c.rowGap.value}
                onCommit={(v) => onPatch({ rowGap: Math.max(0, v) })}
                min={0}
              />
            </MixedCell>
          </FieldRow>
          <FieldRow label="Column gap">
            <MixedCell mixed={c.columnGap.mixed}>
              <NumberField
                value={c.columnGap.value}
                onCommit={(v) => onPatch({ columnGap: Math.max(0, v) })}
                min={0}
              />
            </MixedCell>
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
      {/* Padding is meaningful in all three modes (none uses it to pad
          children when absolute). Skip only if modes disagree — the
          underlying property still has a sane merge if mode is uniform. */}
      {!c.mode.mixed ? (
        <FieldRow label="Padding">
          <MixedCell mixed={c.padding.mixed}>
            <PaddingField
              value={c.padding.value}
              onCommit={(p) => onPatch({ padding: p })}
            />
          </MixedCell>
        </FieldRow>
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
    <div className="relative flex w-full items-center gap-1">
      <div className="flex-1 min-w-0">{children}</div>
      {mixed ? (
        <span
          title="Values differ across the selection"
          className="pointer-events-none shrink-0 rounded bg-panel px-1 text-[9px] font-medium tracking-wider text-accent uppercase"
        >
          mixed
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

function NodeDetails({ node, api }: { node: Node; api: SceneAPI }) {
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
  const animMap = useAnimatedValues([node.id])
  const anim = animMap[node.id]
  const liveX = anim?.x ?? node.transform.x
  const liveY = anim?.y ?? node.transform.y
  const liveZ = anim?.z ?? node.transform.z
  const liveRot = anim?.rotation ?? node.transform.rotation
  const liveRotX = anim?.rotationX ?? node.transform.rotationX
  const liveRotY = anim?.rotationY ?? node.transform.rotationY
  const liveSX = anim?.scaleX ?? node.transform.scaleX
  const liveSY = anim?.scaleY ?? node.transform.scaleY
  const liveOpacity = anim?.opacity ?? node.appearance.opacity
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
    group: 'transform' | 'appearance' | 'size',
    patch: Record<string, unknown>,
  ) => {
    const ui = useUI.getState()
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
    api.setNodeProperty(node.id, 'transform', { ...current, ...patch })
    stampForPatch('transform', patch)
  }
  const patchAppearance = (patch: Partial<Appearance>) => {
    api.setNodeProperty(node.id, 'appearance', { ...node.appearance, ...patch })
    stampForPatch('appearance', patch)
  }
  const patchSize = (patch: Partial<Size>) => {
    if (!('size' in node)) return
    api.setNodeProperty(node.id, 'size', { ...node.size, ...patch })
    stampForPatch('size', patch)
  }
  const patchLayout = (patch: Partial<Layout>) => {
    if (!('layout' in node)) return
    api.setNodeProperty(node.id, 'layout', { ...node.layout, ...patch })
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
      // Auto-clear stale transform.x/y on `flow` children when the
      // parent flips into auto-layout. Reasoning: in flow under flex/
      // grid, those values shift the child OFF the slot the layout
      // assigns — usually unintentionally (left over from `none`
      // mode where the user dragged things around freely, or from a
      // Figma import). The user just chose "let auto-layout decide
      // positions," so reset the offsets to honor that intent.
      // `absolute` children keep their offsets — that's how they're
      // pinned in the first place.
      const isAutoLayout = patch.mode === 'flex' || patch.mode === 'grid'
      const wasNone = node.layout.mode === 'none'
      if (isAutoLayout && wasNone) {
        api.doc.transact(() => {
          for (const child of api.getChildren(node.id)) {
            if (child.position === 'absolute') continue
            if (child.transform.x === 0 && child.transform.y === 0) continue
            api.setNodeProperty(child.id, 'transform', {
              ...child.transform,
              x: 0,
              y: 0,
            })
          }
        })
      }
    }
  }

  return (
    <div className="space-y-6">
      <Section title="Node">
        <FieldRow label="Name">
          <TextField
            value={node.name}
            onCommit={(n) => api.setNodeProperty(node.id, 'name', n)}
            allowEmpty={false}
          />
        </FieldRow>
        <FieldRow label="Kind">
          <span className="pr-1.5 text-[12px] text-text">{node.kind}</span>
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
      </Section>

      <PositionSection node={node} api={api} />

      <Section title="Transform">
        {/* See multi-select branch above for rationale. */}
        <div className="mb-3">
          <AlignTools api={api} selection={[node.id]} />
        </div>
        <FieldRow
          label="X"
          keyframe={
            <KeyframeButton
              nodeId={node.id}
              propertyId="transform.x"
              currentValue={liveX}
            />
          }
        >
          <NumberField
            value={liveX}
            onCommit={(v) => patchTransform({ x: v })}
          />
        </FieldRow>
        <FieldRow
          label="Y"
          keyframe={
            <KeyframeButton
              nodeId={node.id}
              propertyId="transform.y"
              currentValue={liveY}
            />
          }
        >
          <NumberField
            value={liveY}
            onCommit={(v) => patchTransform({ y: v })}
          />
        </FieldRow>
        {/* Z lives on the camera only. Regular layers render in 2D
            space — exposing Z on every layer led to "negative Z hides
            the element entirely" surprises (no perspective context).
            The camera applies its own Z transform to the whole scene. */}
        {node.kind === 'camera' && (
          <FieldRow
            label="Z"
            keyframe={
              <KeyframeButton
                nodeId={node.id}
                propertyId="transform.z"
                currentValue={liveZ}
              />
            }
          >
            <NumberField
              value={liveZ}
              onCommit={(v) => patchTransform({ z: v })}
              step={1}
            />
          </FieldRow>
        )}
        {/* Rotation. Cameras get full 3D — pitch (X), yaw (Y), and roll
            (Z) — so the user can fly the view around in three axes
            instead of just spinning it. Other layers keep the original
            single-axis Rotation row to avoid bloating the inspector
            with controls most layers won't use. (Per-layer 3D rotation
            is in the data model and rendered, but exposed only on
            cameras for now — Step 4.5 will surface it on regular
            layers along with the gizmo work.) */}
        {node.kind === 'camera' ? (
          <>
            <FieldRow
              label="Rotate X"
              keyframe={
                <KeyframeButton
                  nodeId={node.id}
                  propertyId="transform.rotationX"
                  currentValue={liveRotX}
                />
              }
            >
              <NumberField
                value={liveRotX}
                onCommit={(v) => patchTransform({ rotationX: v })}
                suffix="°"
              />
            </FieldRow>
            <FieldRow
              label="Rotate Y"
              keyframe={
                <KeyframeButton
                  nodeId={node.id}
                  propertyId="transform.rotationY"
                  currentValue={liveRotY}
                />
              }
            >
              <NumberField
                value={liveRotY}
                onCommit={(v) => patchTransform({ rotationY: v })}
                suffix="°"
              />
            </FieldRow>
            <FieldRow
              label="Rotate Z"
              keyframe={
                <KeyframeButton
                  nodeId={node.id}
                  propertyId="transform.rotation"
                  currentValue={liveRot}
                />
              }
            >
              <NumberField
                value={liveRot}
                onCommit={(v) => patchTransform({ rotation: v })}
                suffix="°"
              />
            </FieldRow>
          </>
        ) : (
          <FieldRow
            label="Rotation"
            keyframe={
              <KeyframeButton
                nodeId={node.id}
                propertyId="transform.rotation"
                currentValue={liveRot}
              />
            }
          >
            <NumberField
              value={liveRot}
              onCommit={(v) => patchTransform({ rotation: v })}
              suffix="°"
            />
          </FieldRow>
        )}
        {/* Cameras don't expose Scale — they're 3D now, so Z position
            in the row above does the dolly job that Scale used to.
            Other layers still get the X/Y scale pair. Cameras *do*
            have scaleX/scaleY in the data model (used by the renderer
            for the camera transform), but those are computed from Z
            via perspective rather than user-edited. */}
        {node.kind !== 'camera' && (
          <FieldRow label="Scale">
            <ScalePairField
              nodeId={node.id}
              scaleX={liveSX}
              scaleY={liveSY}
              onCommitX={(v) => patchTransform({ scaleX: v })}
              onCommitY={(v) => patchTransform({ scaleY: v })}
            />
          </FieldRow>
        )}
      </Section>

      {'size' in node && (
        <Section title="Size">
          <FieldRow label="Width">
            <SizeAxisField
              value={node.size.width}
              onCommit={(w) => patchSize({ width: w })}
            />
          </FieldRow>
          <FieldRow label="Height">
            <SizeAxisField
              value={node.size.height}
              onCommit={(h) => patchSize({ height: h })}
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

      {'layout' in node && (
        <LayoutSection layout={node.layout} onPatch={patchLayout} />
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
      {node.kind !== 'camera' ? (
        <Section title="Appearance">
          <FieldRow
            label="Opacity"
            keyframe={
              <KeyframeButton
                nodeId={node.id}
                propertyId="appearance.opacity"
                currentValue={liveOpacity}
              />
            }
          >
            <NumberField
              value={liveOpacity}
              onCommit={(v) => patchAppearance({ opacity: v })}
              min={0}
              max={1}
              step={0.05}
            />
          </FieldRow>
          <FillField
            value={node.appearance.fill}
            onCommit={(fill) => patchAppearance({ fill })}
          />
          <StrokeControls
            value={node.appearance.stroke}
            onCommit={(stroke) => patchAppearance({ stroke })}
          />
          <FieldRow
            label="Corner"
            keyframe={
              <KeyframeButton
                nodeId={node.id}
                propertyId="appearance.cornerRadius"
                currentValue={node.appearance.cornerRadius}
              />
            }
          >
            <CornerField
              uniformValue={node.appearance.cornerRadius}
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
          {node.kind === 'frame' ? (
            <FieldRow label="Clip">
              <CheckboxField
                value={node.clipsContent}
                onCommit={(v) => api.setNodeProperty(node.id, 'clipsContent', v)}
              />
            </FieldRow>
          ) : null}
        </Section>
      ) : (
        <>{/* camera path emits its own sections below */}</>
      )}

      {node.kind !== 'camera' && (
        <EffectsSection
          value={node.appearance.effects ?? []}
          onCommit={(effects) => patchAppearance({ effects })}
        />
      )}

      {node.kind === 'camera' && (
        <>
          <Section title="Camera">
            <FieldRow label="Projection">
              <span className="pr-1.5 text-[12px] text-text-muted">2D</span>
            </FieldRow>
            <FieldRow label="Focal">
              {/* Drives both the Z-driven scale formula AND the CSS
                  perspective. Larger = telephoto (less distortion at
                  rotation). The suffix hints that this is the optical
                  focal length in canvas-pixel units. Range 50–10000
                  covers the practical span; clamp to 50 so the
                  scale singularity stays well clear of likely Z values. */}
              <NumberField
                value={node.focalLength ?? 1000}
                onCommit={(v) =>
                  api.setNodeProperty(node.id, 'focalLength', Math.max(50, v))
                }
                min={50}
                max={10000}
                step={50}
                suffix="px"
              />
            </FieldRow>
            <FieldRow label="Pivot">
              <SelectField<CameraNode['rotationOrigin']>
                value={node.rotationOrigin ?? 'center'}
                options={[
                  { value: 'center', label: 'Center' },
                  { value: 'top', label: 'Top' },
                  { value: 'right', label: 'Right' },
                  { value: 'bottom', label: 'Bottom' },
                  { value: 'left', label: 'Left' },
                ]}
                onCommit={(v) =>
                  api.setNodeProperty(node.id, 'rotationOrigin', v)
                }
              />
            </FieldRow>
            {node.kind === 'camera' && (
              <FillField
                label="Background"
                value={node.background ?? null}
                onCommit={(fill) => api.setNodeProperty(node.id, 'background', fill)}
              />
            )}
            <CameraResetActions node={node} api={api} />
          </Section>
        </>
      )}
    </div>
  )
}

/**
 * Camera-only reset actions. Two buttons:
 *   - "Reset transform" sets transform to (W/2, H/2, 0, 1, 1) — the
 *     identity-view pose where the rendered scene appears unmodified.
 *   - "Clear all animation" removes every track on the camera. Cameras
 *     used to be invisible in the Timeline, so users would unknowingly
 *     leave Record-mode tracks on the camera that overrode their
 *     manual transform edits. Even now that Timeline shows them, an
 *     escape hatch is useful when the picker is buried in a deep scene.
 */
function CameraResetActions({ node, api }: { node: Node; api: SceneAPI }) {
  const meta = api.getMeta()
  const targetTransform = {
    x: meta.canvas.width / 2,
    y: meta.canvas.height / 2,
    z: 0,
    rotation: 0,
    rotationX: 0,
    rotationY: 0,
    scaleX: 1,
    scaleY: 1,
  }
  const tracks = api.getTracksForNode(node.id)
  const hasNonIdentity =
    node.transform.x !== targetTransform.x ||
    node.transform.y !== targetTransform.y ||
    node.transform.z !== 0 ||
    node.transform.rotation !== 0 ||
    node.transform.rotationX !== 0 ||
    node.transform.rotationY !== 0 ||
    node.transform.scaleX !== 1 ||
    node.transform.scaleY !== 1
  return (
    <div className="mt-2 flex flex-col gap-1">
      <button
        type="button"
        disabled={!hasNonIdentity}
        onClick={() =>
          api.setNodeProperty(node.id, 'transform', targetTransform)
        }
        title="Reset position / rotation / scale to the identity-view pose. The scene will render unmodified."
        className="rounded border border-border bg-panel px-2 py-1.5 text-[11px] text-text-muted hover:border-border-strong hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
      >
        Reset transform
      </button>
      {tracks.length > 0 ? (
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
      ) : null}
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

function UniformScaleField({
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

  useEffect(() => {
    if (!focused) setDraft(formatPct(value))
  }, [value, focused])

  const commit = () => {
    const parsed = parseFloat(draft)
    if (!Number.isFinite(parsed)) {
      setDraft(formatPct(value))
      return
    }
    const nextScale = parsed / 100
    if (nextScale !== value) onCommit(nextScale)
    setDraft(formatPct(nextScale))
  }

  return (
    <label
      className={[
        'inline-flex h-6 min-w-0 flex-1 items-center rounded',
        'border border-transparent hover:border-border',
        'focus-within:border-border-strong focus-within:bg-app-bg',
      ].join(' ')}
      title="Uniform camera scale"
    >
      <input
        ref={ref}
        type="text"
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => {
          setFocused(true)
          e.currentTarget.select()
        }}
        onBlur={() => {
          setFocused(false)
          commit()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
            ref.current?.blur()
          } else if (e.key === 'Escape') {
            setDraft(formatPct(value))
            ref.current?.blur()
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            const delta = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1)
            const nextPct = (parseFloat(draft) || 0) + delta
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
  return formatPctNumber(Math.round(scale * 10000) / 100)
}
function formatPctNumber(p: number): string {
  // Defensive: agent-built scenes may land here with undefined scale
  // values — a single undefined.toFixed crashes the whole Inspector.
  if (p == null || !Number.isFinite(p)) return ''
  if (Number.isInteger(p)) return String(p)
  return p.toFixed(2).replace(/\.?0+$/, '')
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
  value,
  onCommit,
}: {
  value: Effect[]
  onCommit: (next: Effect[]) => void
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
    onCommit(value.filter((_, idx) => idx !== i))
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
          {value.map((effect, i) => (
            <EffectRow
              key={i}
              effect={effect}
              onChange={(patch) => updateAt(i, patch)}
              onRemove={() => removeAt(i)}
              onMoveUp={() => moveUp(i)}
              onMoveDown={() => moveDown(i)}
              canMoveUp={i > 0}
              canMoveDown={i < value.length - 1}
            />
          ))}
        </div>
      )}
    </Section>
  )
}

function EffectRow({
  effect,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: {
  effect: Effect
  onChange: (patch: Partial<Effect>) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  canMoveUp: boolean
  canMoveDown: boolean
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
        <FieldRow label="Amount">
          <NumberField
            value={effect.amount}
            onCommit={(v) => onChange({ amount: Math.max(0, v) } as Partial<Effect>)}
            min={0}
            suffix="px"
          />
        </FieldRow>
      ) : (
        <ShadowFields effect={effect} onChange={onChange} />
      )}
    </div>
  )
}

/**
 * Color + offset/blur/spread for drop and inner shadows. Inner is a
 * ShadowEffect with `kind: 'inner-shadow'`; the only difference between
 * the two paths is the kind tag — fields are identical.
 */
function ShadowFields({
  effect,
  onChange,
}: {
  effect: Extract<Effect, { kind: 'shadow' | 'inner-shadow' }>
  onChange: (patch: Partial<Effect>) => void
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
      <FieldRow label="Blur">
        <NumberField
          value={effect.blur}
          onCommit={(v) => onChange({ blur: Math.max(0, v) } as Partial<Effect>)}
          min={0}
          suffix="px"
        />
      </FieldRow>
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

// ---------------------------------------------------------------------------
// Position — flow vs absolute. Mirrors Figma's "Absolute position" toggle.
// Only meaningful inside an auto-layout (flex / grid) parent — for nodes
// whose parent is mode='none', every child is already free-positioned, so
// the toggle would be a no-op. We hide it in that case to keep the panel
// honest.
// ---------------------------------------------------------------------------

function PositionSection({ node, api }: { node: Node; api: SceneAPI }) {
  // Root is the artboard; it has no parent and the toggle would be
  // meaningless. Guard early so the section disappears for the Scene.
  if (!node.parent) return null
  const parent = api.getNode(node.parent)
  if (!parent || !('layout' in parent)) return null
  const parentMode = parent.layout.mode
  // Only show in flex / grid parents. mode='none' means every child is
  // already absolute-ish and the toggle has no effect.
  if (parentMode !== 'flex' && parentMode !== 'grid') return null

  const onChange = (next: Position) => {
    if (next === node.position) return
    if (next === 'absolute') {
      // Capture the rect Yoga just placed this node at, and write the
      // offset into transform.x / transform.y so the element doesn't
      // visually snap to (0, 0) of the parent's content box. The
      // renderer composes transform on top of the absolute origin, so
      // the post-toggle frame matches the pre-toggle frame to the pixel.
      const solved = getLastSolvedLayout()
      const childRect = solved?.[node.id]
      const parentRect = solved?.[parent.id]
      if (childRect && parentRect) {
        const ox =
          childRect.x - parentRect.x - parent.layout.padding.left
        const oy =
          childRect.y - parentRect.y - parent.layout.padding.top
        // Merge with existing transform so we don't clobber rotation /
        // scale / animated offsets.
        api.setNodeProperty(node.id, 'transform', {
          ...node.transform,
          x: Math.round(ox * 100) / 100,
          y: Math.round(oy * 100) / 100,
        })
      }
    }
    api.setNodeProperty(node.id, 'position', next)
  }

  return (
    <Section title="Position">
      <FieldRow label="Mode">
        <SelectField<Position>
          value={node.position}
          options={[
            { value: 'flow', label: 'In layout' },
            { value: 'absolute', label: 'Absolute' },
          ]}
          onCommit={onChange}
          width="w-full"
        />
      </FieldRow>
      <p className="px-2 pt-0.5 text-[10.5px] leading-snug text-text-dim">
        {node.position === 'flow'
          ? `Following parent ${parentMode === 'flex' ? 'auto layout' : 'grid'}.`
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

  // If the node's font-family isn't in the preset list (e.g. a custom
  // stack from elsewhere), fall back to the first system option for the
  // dropdown's displayed value — but keep the underlying value intact
  // until the user picks something new.
  const familyValue = FONT_GROUPS_FLAT.some((f) => f.value === node.fontFamily)
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

  return (
    <Section title="Typography">
      <FieldRow label="Content">
        <TextAreaField
          value={node.text}
          onCommit={(v) => api.setNodeProperty(node.id, 'text', v)}
        />
      </FieldRow>
      <FieldRow label="Font">
        <SelectField<string>
          value={familyValue}
          groups={FONT_GROUPS}
          onCommit={(v) => {
            // Kick off the network fetch before we mutate the scene so
            // the font file is en route by the time Yoga re-measures.
            // The measure function will use the fallback during the
            // in-flight window; useLayout re-solves on completion via
            // `useFontLoadVersion`.
            if (isGoogleFont(v)) void loadGoogleFont(v)
            api.setNodeProperty(node.id, 'fontFamily', v)
          }}
          width="w-full"
        />
      </FieldRow>
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
      <FieldRow label="Size">
        <NumberField
          value={node.fontSize}
          onCommit={(v) =>
            api.setNodeProperty(node.id, 'fontSize', Math.max(1, Math.round(v)))
          }
          min={1}
          step={1}
          suffix="px"
        />
      </FieldRow>
      <FieldRow label="Line height">
        <NumberField
          value={node.lineHeight}
          onCommit={(v) =>
            api.setNodeProperty(node.id, 'lineHeight', Math.max(0.5, v))
          }
          min={0.5}
          step={0.05}
        />
      </FieldRow>
      <FieldRow label="Letter spacing">
        <NumberField
          value={node.letterSpacing}
          onCommit={(v) => api.setNodeProperty(node.id, 'letterSpacing', v)}
          step={0.1}
        />
      </FieldRow>
      <FieldRow label="Align">
        <SelectField<'start' | 'center' | 'end'>
          value={node.textAlign}
          options={
            [
              { value: 'start', label: 'Left' },
              { value: 'center', label: 'Center' },
              { value: 'end', label: 'Right' },
            ] as const
          }
          onCommit={(a) => api.setNodeProperty(node.id, 'textAlign', a)}
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

  useEffect(() => {
    if (!focused) setDraft(value)
  }, [value, focused])

  const commit = () => {
    if (draft !== value) onCommit(draft)
  }

  return (
    <textarea
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false)
        commit()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          setDraft(value)
          ;(e.currentTarget as HTMLTextAreaElement).blur()
        } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          commit()
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
// Padding sub-field — four small inputs in a row (T R B L)
// ---------------------------------------------------------------------------

function PaddingField({
  value,
  onCommit,
}: {
  value: { top: number; right: number; bottom: number; left: number }
  onCommit: (next: { top: number; right: number; bottom: number; left: number }) => void
}) {
  // Four inputs labeled T / R / B / L. Designers unfamiliar with CSS
  // shorthand expect explicit sides; the bare-number layout we had
  // before made users assume "the second slot must be right, right?"
  // and treat it as a guessing game.
  const cell = (
    label: string,
    v: number,
    onChange: (n: number) => void,
  ) => (
    <div className="flex flex-col items-center gap-0.5">
      <NumberField value={v} onCommit={onChange} min={0} width="w-10" />
      <span className="text-[9px] uppercase tracking-wider text-text-dim">
        {label}
      </span>
    </div>
  )
  return (
    <div className="flex items-start gap-1">
      {cell('T', value.top, (n) => onCommit({ ...value, top: n }))}
      {cell('R', value.right, (n) => onCommit({ ...value, right: n }))}
      {cell('B', value.bottom, (n) => onCommit({ ...value, bottom: n }))}
      {cell('L', value.left, (n) => onCommit({ ...value, left: n }))}
    </div>
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
 *   - None: just padding. Children keep transform.x / y.
 *   - Flex: direction, justify, align, gap, padding, wrap.
 *   - Grid: columns, rowGap, columnGap, padding, align.
 *
 * Mode buttons write through the same patcher the individual fields use,
 * so undo/redo groups a mode switch with its immediate edits (within the
 * Y.UndoManager captureTimeout).
 */
function LayoutSection({
  layout,
  onPatch,
}: {
  layout: Layout
  onPatch: (patch: Partial<Layout>) => void
}) {
  return (
    <Section title="Layout">
      <ModeToggle value={layout.mode} onCommit={(m) => onPatch({ mode: m })} />
      {layout.mode === 'flex' ? (
        <>
          <FieldRow label="Direction">
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
              <FieldRow label="Gap">
                <div
                  className="w-full"
                  title={
                    autoSpacing
                      ? `Gap is ignored when Distribute is ${layout.justify} — the layout fills the space automatically.`
                      : undefined
                  }
                >
                  <SliderField
                    value={layout.gap}
                    onCommit={(v) => onPatch({ gap: Math.max(0, v) })}
                    min={0}
                    max={120}
                    disabled={autoSpacing}
                  />
                </div>
              </FieldRow>
            )
          })()}
        </>
      ) : layout.mode === 'grid' ? (
        <>
          <FieldRow label="Columns">
            <NumberField
              value={layout.columns}
              onCommit={(v) => onPatch({ columns: Math.max(1, Math.round(v)) })}
              min={1}
              step={1}
            />
          </FieldRow>
          <FieldRow label="Row gap">
            <NumberField
              value={layout.rowGap}
              onCommit={(v) => onPatch({ rowGap: Math.max(0, v) })}
              min={0}
            />
          </FieldRow>
          <FieldRow label="Column gap">
            <NumberField
              value={layout.columnGap}
              onCommit={(v) => onPatch({ columnGap: Math.max(0, v) })}
              min={0}
            />
          </FieldRow>
          <FieldRow label="Align">
            <SelectField<FlexAlign>
              value={layout.align}
              options={['start', 'center', 'end', 'stretch'] as const}
              onCommit={(a) => onPatch({ align: a })}
            />
          </FieldRow>
        </>
      ) : null /* mode === 'none' — only padding below */}
      <FieldRow label="Padding">
        <PaddingField
          value={layout.padding}
          onCommit={(p) => onPatch({ padding: p })}
        />
      </FieldRow>
    </Section>
  )
}

/**
 * Three-button pill for the layout mode switch. Framer-leaning: 36px
 * tall, active segment is a raised inner pill with shadow, inactive is
 * transparent. Bigger visual presence than a tiny chip — matches the
 * Framer reference where Stack/Grid commands the top of the section.
 */
function ModeToggle({
  value,
  onCommit,
}: {
  value: LayoutMode
  onCommit: (next: LayoutMode) => void
}) {
  const modes: { id: LayoutMode; label: string }[] = [
    { id: 'none', label: 'None' },
    { id: 'flex', label: 'Stack' },
    { id: 'grid', label: 'Grid' },
  ]
  return (
    <FieldRow label="Type">
      <LabeledSegmented
        options={modes}
        value={value}
        onChange={(m) => onCommit(m as LayoutMode)}
      />
    </FieldRow>
  )
}

/**
 * LabeledSegmented — Framer's tall text-segmented control.
 *
 * Used for binary / ternary picks where the labels are a couple words
 * long: Stack / Grid, Yes / No. Active segment is a darker pill on a
 * muted track; inactive segments are transparent text. The whole
 * control is `flex-1` so it fills the row's value column.
 */
function LabeledSegmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<{ id: T; label: string }>
  value: T
  onChange: (next: T) => void
}) {
  return (
    <div className="flex h-9 w-full items-stretch gap-1 rounded-md bg-app-bg p-1">
      {options.map((o) => {
        const active = o.id === value
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className={[
              'flex-1 rounded-[5px] text-[12px] font-medium transition-colors',
              active
                ? 'bg-panel-raised text-text shadow-sm'
                : 'text-text-muted hover:text-text',
            ].join(' ')}
          >
            {o.label}
          </button>
        )
      })}
    </div>
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
    <div className="flex h-9 w-full items-stretch gap-1 rounded-md bg-app-bg p-1">
      {options.map((o) => {
        const active = o.id === value
        return (
          <button
            key={o.id}
            type="button"
            title={o.title}
            onClick={() => onChange(o.id)}
            className={[
              'flex flex-1 items-center justify-center rounded-[5px] transition-colors',
              active
                ? 'bg-panel-raised text-text shadow-sm'
                : 'text-text-muted hover:text-text',
            ].join(' ')}
          >
            {o.icon}
          </button>
        )
      })}
    </div>
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
  disabled,
}: {
  value: number
  onCommit: (next: number) => void
  min?: number
  max?: number
  step?: number
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
      <div className="relative">
        <FillField
          label="Stroke"
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
        {v ? (
          // One-click clear. Sits absolutely-positioned over the
          // FillField row so it doesn't disturb the field's layout
          // (FillField owns its own swatch + summary at the right
          // edge). z-10 so the clear-button hit area beats the
          // FillField's swatch when they overlap.
          <button
            type="button"
            onClick={() => onCommit(null)}
            title="Remove stroke"
            aria-label="Remove stroke"
            className="absolute right-1 top-1/2 z-10 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-text-dim hover:bg-panel-raised hover:text-text"
          >
            ×
          </button>
        ) : null}
      </div>
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
    <div>
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
    </div>
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
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
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
          onCommit={(c) => onChange({ ...guide, color: c })}
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
          onCommit={(c) => onChange({ ...guide, color: c })}
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
          onCommit={(c) => onChange({ ...guide, color: c })}
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
}) {
  // Spacing tuned to the rad-spacing 40% rule:
  //   - inside a row (icon, label, value): tight (4-6px) — owned by
  //     the row primitive itself, not Section
  //   - between rows in a section: 8px (`space-y-2`)
  //   - title-to-first-row: 12px (`mb-3`)
  // The wrapping panel (Inspector body) provides the section-to-section
  // gap (16px) via `space-y-6` on the parent.
  return (
    <div>
      {/* Framer-leaning header: 13px semibold in the panel's main text
          color, with optional right-aligned action (collapse, add).
          Larger than the previous 11px-muted header so it reads as a
          proper section delimiter rather than a quiet label. */}
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[13px] font-semibold text-text">{title}</span>
        {action ? (
          <span className="flex items-center text-text-muted">{action}</span>
        ) : null}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}