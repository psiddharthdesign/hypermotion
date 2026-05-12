// SPDX-License-Identifier: Apache-2.0

import { useUI } from '@/state/ui'
import { useSceneAPI, useSceneVersion } from '@/scene'
import type { EasingKind, NodeId } from '@/scene'
import type { SceneAPI } from '@/scene/doc'
import {
  PRESETS,
  applyPreset,
  listTracksForNode,
  removeTrack,
  findEasingPreset,
} from '@/anim'
import type { AnimPresetId } from '@/anim'
import { EasingPicker } from '@/ui/EasingPicker'
import { GraphEditor } from '@/ui/GraphEditor'
import { NumberField } from '@/ui/fields'

/**
 * Animate-mode right panel.
 *
 * The Jitter mental model: click a preset, keyframes get stamped onto
 * the selected layer(s) starting at the current playhead. Our version
 * does the same, but the generated keyframes are first-class citizens
 * on the scene's track store — editable in the timeline just like
 * anything hand-authored.
 *
 * Multi-select: clicking a preset applies it to every selected layer.
 *
 * Stagger: when the toggle is on, the preset spreads across multiple
 * targets with a per-target time offset. Targets are chosen "smartly":
 *   - If exactly one node is selected AND it has direct children → use
 *     those children in layer order. This is the "select a parent, let
 *     its children animate in sequence" flow the user described.
 *   - Otherwise → use the selection itself. This lets the user lasso a
 *     few siblings directly and still get a stagger.
 * Each target `i` starts at `playhead + i * staggerDelay`.
 *
 * Sections:
 *   IN  — the layer enters (fade in, slide up, pop, etc.)
 *   OUT — the layer exits
 *
 * "Clear all animation" removes every track on every selected node.
 */
export function PresetsPanel() {
  useSceneVersion()
  const api = useSceneAPI()
  const selection = useUI((s) => s.selection)
  const playhead = useUI((s) => s.playhead)
  const easingPresetId = useUI((s) => s.easingPresetId)
  const easingStrength = useUI((s) => s.easingStrength)
  const setEasing = useUI((s) => s.setEasing)
  const staggerOn = useUI((s) => s.staggerOn)
  const staggerDelay = useUI((s) => s.staggerDelay)
  const setStaggerOn = useUI((s) => s.setStaggerOn)
  const setStaggerDelay = useUI((s) => s.setStaggerDelay)

  if (selection.length === 0) {
    return (
      <div className="rounded border border-border bg-panel-raised p-3 text-text-muted">
        <div className="text-[12px]">Nothing selected</div>
        <div className="mt-1 text-[11px] text-text-dim">
          Select one or more layers to add animation presets.
        </div>
      </div>
    )
  }

  const easing = findEasingPreset(easingPresetId).build(easingStrength)

  // Resolve the current stagger target set. Leaves of the tree in the
  // "smart single-parent" branch fall through to the selection itself —
  // no children means no stagger, but the preset still applies.
  const targets = resolveTargets(api, selection, staggerOn)
  const isStaggerActive = staggerOn && targets.length > 1

  const clearAll = () => {
    for (const id of selection) {
      const tracks = listTracksForNode(api, id)
      for (const t of tracks) removeTrack(api, t.id)
    }
  }

  // Stamp a preset across `targets`, offsetting each target by
  // `i * staggerDelay` when stagger is on. The same target list drives
  // the easing sweep so "click preset, slide easing" feels coherent.
  const stampPreset = (id: AnimPresetId) => {
    for (let i = 0; i < targets.length; i++) {
      const targetId = targets[i]!
      const startTime = isStaggerActive
        ? playhead + i * staggerDelay
        : playhead
      applyPreset(api, targetId, id, startTime)
    }
    rewriteEasing(api, targets, easing)
  }

  // Update the easing preset + strength AND push the resulting easing
  // onto every existing track/keyframe on every target. This is what
  // makes the easing slider feel "live" on the canvas — drag it, see
  // every staggered child re-tune together.
  const pickEasing = (next: {
    presetId: typeof easingPresetId
    strength: number
    easing: typeof easing
  }) => {
    setEasing(next.presetId, next.strength)
    rewriteEasing(api, targets, next.easing)
  }

  const ins = PRESETS.filter((p) => p.direction === 'in')
  const outs = PRESETS.filter((p) => p.direction === 'out')

  return (
    <div className="space-y-5">
      <div className="rounded border border-border bg-panel-raised p-2.5">
        <div className="text-[10px] font-medium tracking-wider text-text-dim uppercase">
          Applies at playhead
        </div>
        <div className="mt-0.5 font-mono text-[11px] text-text tabular-nums">
          {playhead.toFixed(2)}s
        </div>
        <div className="mt-1 text-[11px] text-text-dim">
          {describeTargets(selection, targets, isStaggerActive)}
        </div>
      </div>

      <StaggerControls
        on={staggerOn}
        delay={staggerDelay}
        onToggle={() => setStaggerOn(!staggerOn)}
        onDelayChange={setStaggerDelay}
      />

      <PresetGroup title="In" presets={ins} onPick={stampPreset} />

      <PresetGroup title="Out" presets={outs} onPick={stampPreset} />

      <EasingPicker
        presetId={easingPresetId}
        strength={easingStrength}
        onChange={pickEasing}
      />

      {/* Per-segment bezier graph editor. Surfaces only when the
          live timeline keyframe selection narrows to a single
          numeric track — see GraphEditor for the discrimination
          logic. The placeholder it renders for "no target" is what
          guides the user to select keyframes if they haven't yet,
          so we always mount it (no conditional). */}
      <GraphEditor />

      <button
        onClick={clearAll}
        className="w-full rounded border border-border bg-panel px-3 py-2 text-[11px] text-text-muted hover:border-border-strong hover:text-text"
      >
        {selection.length > 1
          ? 'Clear all animation on selected layers'
          : 'Clear all animation on this layer'}
      </button>
    </div>
  )
}

function PresetGroup({
  title,
  presets,
  onPick,
}: {
  title: string
  presets: { id: AnimPresetId; label: string }[]
  onPick: (id: AnimPresetId) => void
}) {
  return (
    <div>
      <div className="mb-2 text-[10px] font-medium tracking-wider text-text-dim uppercase">
        {title}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {presets.map((p) => (
          <PresetButton key={p.id} preset={p} onPick={onPick} />
        ))}
      </div>
    </div>
  )
}

/**
 * One preset button. Renders a stage area that hosts a small accent-
 * colored shape — that shape animates the preset's actual effect on
 * hover (Jitter mental model: "show me what this does"). Animations
 * are paused by default and switched on via `data-preview-on` so the
 * panel sits still until the user is shopping for an effect.
 *
 * `data-preview-on` is also flipped via focus so keyboard users get
 * the preview when tabbing through the grid.
 *
 * The label sits below the stage. Whole button is the click target
 * for stamping the preset.
 */
function PresetButton({
  preset,
  onPick,
}: {
  preset: { id: AnimPresetId; label: string }
  onPick: (id: AnimPresetId) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(preset.id)}
      onPointerEnter={(e) => e.currentTarget.setAttribute('data-preview-on', '1')}
      onPointerLeave={(e) => e.currentTarget.removeAttribute('data-preview-on')}
      onFocus={(e) => e.currentTarget.setAttribute('data-preview-on', '1')}
      onBlur={(e) => e.currentTarget.removeAttribute('data-preview-on')}
      // Light-mode-safe card: 0.5px border + slightly cooler stage
      // bg so the card reads clearly against a near-white panel.
      // Dark mode keeps its existing panel-raised fill (the border
      // disappears against the same-tone backdrop, harmless).
      className="group flex flex-col gap-1.5 rounded-md border border-border-strong/60 bg-panel-raised p-1.5 text-left transition-colors hover:border-border-strong hover:bg-panel"
    >
      <div className="hm-preset-stage h-14 w-full rounded-[5px] bg-panel">
        <span
          aria-hidden
          className={`hm-preset-subject hm-preset-${preset.id}`}
        />
      </div>
      <span className="px-1 pb-0.5 text-[11px] text-text">{preset.label}</span>
    </button>
  )
}

/**
 * Stagger toggle + delay input. The delay field greys out when stagger
 * is off — matches the user's ask that "delay should be on" exactly
 * when stagger is on, and keeps the Animate panel from looking like
 * two independent controls with ambiguous interaction.
 */
function StaggerControls({
  on,
  delay,
  onToggle,
  onDelayChange,
}: {
  on: boolean
  delay: number
  onToggle: () => void
  onDelayChange: (next: number) => void
}) {
  return (
    <div className="rounded border border-border bg-panel-raised p-2.5">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-medium tracking-wider text-text-dim uppercase">
          Stagger
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          onClick={onToggle}
          className={[
            // Slightly bigger track so the thumb has obvious clearance
            // on both sides at any zoom level — the previous 16×28 box
            // had the thumb visually clipping its container at the
            // edges in some browsers.
            'relative h-5 w-9 shrink-0 rounded-full border transition-colors',
            on
              ? 'bg-accent border-accent'
              : 'bg-panel border-border-strong',
          ].join(' ')}
          title={on ? 'Turn stagger off' : 'Turn stagger on'}
        >
          <span
            // Explicit left + top inset (instead of relying on a
            // bare `translate-x-*` against an unanchored absolute
            // origin) — matters because some browsers default an
            // absolute child of an empty button to `left: auto`
            // rather than 0, which made the thumb appear on the
            // wrong side at rest.
            className={[
              'absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition-[left]',
              on ? 'left-[18px]' : 'left-[2px]',
            ].join(' ')}
          />
        </button>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <label
          className={[
            'text-[11px]',
            on ? 'text-text-muted' : 'text-text-dim',
          ].join(' ')}
        >
          Delay
        </label>
        <div className={on ? '' : 'pointer-events-none opacity-50'}>
          <NumberField
            value={delay}
            onCommit={onDelayChange}
            min={0}
            step={0.05}
            suffix="s"
            width="w-16"
          />
        </div>
      </div>
      {on ? (
        <div className="mt-2 text-[10px] leading-snug text-text-dim">
          Presets apply to children when a single parent is selected,
          otherwise to the selection itself. First layer first.
        </div>
      ) : null}
    </div>
  )
}

/**
 * Figure out which nodes a preset click should stamp onto.
 *
 * - Stagger off → always the selection verbatim.
 * - Stagger on + single selection with children → the children, in
 *   layer order. The selected parent gets nothing, which matches the
 *   mental model of "parent orchestrates, children dance".
 * - Stagger on + any other selection → the selection itself, in the
 *   order it was supplied (which, for layer-panel selections, is
 *   already layer order).
 */
function resolveTargets(
  api: SceneAPI,
  selection: NodeId[],
  staggerOn: boolean,
): NodeId[] {
  if (!staggerOn) return selection
  if (selection.length === 1) {
    const only = selection[0]!
    const kids = api.getChildren(only).map((c) => c.id)
    if (kids.length > 0) return kids
  }
  return selection
}

function describeTargets(
  selection: NodeId[],
  targets: NodeId[],
  staggerActive: boolean,
): string {
  if (staggerActive && selection.length === 1 && targets !== selection) {
    // Children-of-parent branch.
    return `Staggering ${targets.length} children`
  }
  if (staggerActive) {
    return `Staggering ${targets.length} layers`
  }
  if (selection.length > 1) {
    return `Applies to ${selection.length} layers`
  }
  return 'Applies to 1 layer'
}

/**
 * Rewrite every track/keyframe easing on every target. Kept out of the
 * component body because both the preset stamp and the easing picker
 * call it, and the loop shape is identical.
 */
function rewriteEasing(
  api: SceneAPI,
  targets: NodeId[],
  easing: EasingKind,
): void {
  for (const id of targets) {
    const tracks = listTracksForNode(api, id)
    for (const t of tracks) {
      api.setTrack({
        ...t,
        defaultEasing: easing,
        // Rewrite per-keyframe easingOut too — otherwise the curves
        // baked in by applyPreset would win over the new
        // defaultEasing and the user's slider would feel inert.
        keyframes: t.keyframes.map((k) => ({ ...k, easingOut: easing })),
      })
    }
  }
}