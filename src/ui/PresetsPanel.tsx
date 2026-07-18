// SPDX-License-Identifier: Apache-2.0

import { useState, type CSSProperties, type ReactNode } from 'react'
import { useUI } from '@/state/ui'
import { useSceneAPI, useSceneVersion } from '@/scene'
import type { EasingKind, Fill, NodeId } from '@/scene'
import type { SceneAPI } from '@/scene/doc'
import {
  PRESETS,
  applyPreset,
  listTracksForNode,
  removeTrack,
  findEasingPreset,
  bezierOf,
  TEXT_ANIMATION_PRESETS,
  applyTextAnimation,
  planLayerPresetTargets,
  normalizeTextAnimation,
  stampTextAnimationKeyframes,
  textAnimationDefaults,
  updateTextAnimationEasing,
} from '@/anim'
import type {
  AnimPresetId,
  TextAnimationApplyTo,
  TextAnimationConfig,
  TextAnimationDirection,
  TextAnimationId,
  TextAnimationOrder,
  TextAnimationSmoothing,
} from '@/anim'
import { EasingPicker } from '@/ui/EasingPicker'
import { GraphEditor } from '@/ui/GraphEditor'
import { NumberField } from '@/ui/fields'
import {
  registerStaggerSetKeyframes,
  resolveStaggerKeyframeBundle,
  retimeStaggerSet,
  staggerLayerOffset,
} from '@/anim/staggerSets'

const TEXT_EASING_PRESETS = [
  'smooth',
  'natural',
  'slow-down',
  'accelerate',
  'impulse',
  'swing',
  'none',
  'custom',
] as const
const TEXT_ANIMATION_PREVIEW_WORD = 'HYPER'

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
 * Stagger: when the toggle is on, the preset spreads across the explicitly
 * selected layers with a per-target time offset. Editing an existing stagger
 * uses that relationship's saved members. A selected container is never
 * silently replaced by its children; users select those children explicitly
 * when they want a child stagger.
 * Each target starts at the playhead plus its configured stagger offset.
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
  const activeStaggerSetId = useUI((s) => s.activeStaggerSetId)
  const [showLayerOptions, setShowLayerOptions] = useState(false)
  const [layerPresetTab, setLayerPresetTab] = useState<'in' | 'out'>('in')
  const [openSectionState, setOpenSectionState] = useState({
    selectionKey: '',
    sections: {
      layer: true,
      text: false,
    },
  })
  const updateStaggerDelay = (delay: number) => {
    if (activeStaggerSetId) {
      retimeStaggerSet(api, activeStaggerSetId, delay)
    }
    setStaggerDelay(delay)
  }
  // Timeline selection sources, in order of precedence:
  //   1. selectedKeyframes — individual diamonds the user marquee'd or
  //      shift-clicked. Compound keys "trackId:kfId" — we derive track
  //      IDs to scope the easing to whatever tracks own those kfs.
  //   2. selectedTrackIds  — whole-track selection (clicked the row
  //      header / track name). Less common.
  // Either populated → easing changes scope to those tracks. Both
  // empty → fall back to "every track on every selected layer."
  const selectedTrackIds = useUI((s) => s.selectedTrackIds)
  const selectedKeyframes = useUI((s) => s.selectedKeyframes)
  const trackFilter = (() => {
    const set = new Set<string>()
    for (const k of selectedKeyframes) {
      const colon = k.indexOf(':')
      if (colon > 0) set.add(k.slice(0, colon))
    }
    for (const id of selectedTrackIds) set.add(id)
    return set.size > 0 ? set : undefined
  })()

  const selectedTextNodes = textNodesFromSelectionOrTimeline(
    api,
    selection,
    trackFilter,
  )
  const hasTextSelection = selectedTextNodes.length > 0
  const timelineSelectionKey = trackFilter ? [...trackFilter].sort().join('|') : ''
  const selectionKey = `${selection.join('|')}::${timelineSelectionKey}`
  const defaultOpenSections = {
    layer: !hasTextSelection,
    text: hasTextSelection,
  }
  const openSections =
    openSectionState.selectionKey === selectionKey
      ? openSectionState.sections
      : defaultOpenSections
  const toggleSection = (section: 'layer' | 'text') => {
    setOpenSectionState((current) => {
      const activeSections =
        current.selectionKey === selectionKey
          ? current.sections
          : defaultOpenSections
      const nextOpen = !activeSections[section]
      return {
        selectionKey,
        sections: {
          layer: section === 'layer' ? nextOpen : false,
          text: section === 'text' ? nextOpen : false,
        },
      }
    })
  }

  if (selection.length === 0 && selectedTextNodes.length === 0) {
    return (
      <div className="rounded border border-border bg-panel-raised p-3 text-text-muted">
        <div className="text-[12px]">Nothing selected</div>
        <div className="mt-1 text-[11px] text-text-dim">
          Select one or more layers or keyframe sets to add animation presets.
        </div>
      </div>
    )
  }

  const easing = findEasingPreset(easingPresetId).build(easingStrength)

  const activeStaggerSet = activeStaggerSetId
    ? api.getUiState().staggerSets[activeStaggerSetId]
    : undefined
  const targetPlan = planLayerPresetTargets(
    selection,
    staggerOn,
    staggerDelay,
    activeStaggerSet,
  )
  const { targets, staggerActive: isStaggerActive } = targetPlan

  const clearAll = () => {
    for (const id of selection) {
      const tracks = listTracksForNode(api, id)
      for (const t of tracks) {
        if (t.propertyId === 'text.progress') continue
        removeTrack(api, t.id)
      }
    }
  }

  // Stamp a preset across `targets`, offsetting each target by
  // `i * staggerDelay` when stagger is on. The same target list drives
  // the easing sweep so "click preset, slide easing" feels coherent.
  const stampPreset = (id: AnimPresetId) => {
    const presetDirection = PRESETS.find((preset) => preset.id === id)?.direction
    for (const targetId of targets) {
      const startTime = isStaggerActive
        ? playhead + staggerLayerOffset(
            targets,
            targetId,
            targetPlan.delay,
            targetPlan.order,
          )
        : playhead
      applyPreset(api, targetId, id, startTime)
    }
    if (isStaggerActive && activeStaggerSetId && presetDirection) {
      registerStaggerSetKeyframes(
        api,
        {
          setId: activeStaggerSetId,
          layerIds: targets,
          delay: targetPlan.delay,
          order: targetPlan.order,
        },
        targets.flatMap((nodeId) =>
          api.getTracksForNode(nodeId).flatMap((track) => {
            const keyframeIds = track.keyframes
              .filter((keyframe) => keyframe.presetOrigin === presetDirection)
              .map((keyframe) => keyframe.id)
            return keyframeIds.length > 0
              ? [{ nodeId, propertyId: track.propertyId, keyframeIds }]
              : []
          }),
        ),
      )
    }
    rewriteEasing(api, targets, easing, trackFilter)
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
    rewriteEasing(api, targets, next.easing, trackFilter)
  }

  const ins = PRESETS.filter((p) => p.direction === 'in')
  const outs = PRESETS.filter((p) => p.direction === 'out')
  const visibleLayerPresets = layerPresetTab === 'in' ? ins : outs
  const primaryTextNode = selectedTextNodes[0]
  const primaryTextTrack = primaryTextNode
    ? findTextAnimationTrack(api, primaryTextNode.id, trackFilter, playhead)
    : null
  const primaryTextConfig =
    normalizeTextAnimation(primaryTextTrack?.textAnimation ?? primaryTextNode?.textAnimation)
  const primaryTextPreset = primaryTextConfig
    ? textPresetForConfig(primaryTextConfig)
    : null
  const layerSummary = `${playhead.toFixed(2)}s · ${
    selection.length === 1 ? '1 layer' : `${selection.length} layers`
  }`
  const textSummary = primaryTextConfig
    ? `${primaryTextPreset?.label ?? 'Text effect'} · ${textApplyLabel(primaryTextConfig.applyTo)} · ${
        primaryTextConfig.mode === 'in' ? 'In' : 'Out'
      }`
    : 'No text animation'
  const layerSection = (
    <AnimationAccordion
      title="Layer animation"
      summary={layerSummary}
      open={openSections.layer}
      primary={!hasTextSelection}
      onToggle={() => toggleSection('layer')}
    >
      <div className="rounded-md border border-border bg-panel-raised">
        <div className="flex items-center gap-2 p-2.5">
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[13px] text-text tabular-nums">
              {playhead.toFixed(2)}s
            </div>
            <div className="mt-0.5 truncate text-[11px] text-text-dim">
              {describeTargets(selection, targets, isStaggerActive)}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowLayerOptions((v) => !v)}
            className={[
              'rounded px-2.5 py-1.5 text-[11px] font-semibold',
              showLayerOptions || staggerOn
                ? 'bg-accent/12 text-accent hover:bg-accent/18'
                : 'bg-panel text-text-muted hover:text-text',
            ].join(' ')}
          >
            Timing
          </button>
        </div>
        {showLayerOptions ? (
          <div className="border-t border-border p-2.5">
            <StaggerControls
              on={staggerOn}
              delay={staggerDelay}
              onToggle={() => setStaggerOn(!staggerOn)}
              onDelayChange={updateStaggerDelay}
            />
          </div>
        ) : null}
      </div>

      <PresetTabs
        value={layerPresetTab}
        onChange={setLayerPresetTab}
        inCount={ins.length}
        outCount={outs.length}
      />
      <PresetGrid presets={visibleLayerPresets} onPick={stampPreset} />

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
          ? 'Clear layer animation on selected layers'
          : 'Clear layer animation on this layer'}
      </button>
    </AnimationAccordion>
  )
  const textSection = hasTextSelection ? (
    <AnimationAccordion
      title="Text animation"
      summary={textSummary}
      open={openSections.text}
      primary={hasTextSelection}
      onToggle={() => toggleSection('text')}
    >
      <TextAnimationPanel />
    </AnimationAccordion>
  ) : null

  return (
    <div className="space-y-2">
      {hasTextSelection ? (
        <>
          {textSection}
          {layerSection}
        </>
      ) : (
        <>
          {layerSection}
          {textSection}
        </>
      )}
    </div>
  )
}

function AnimationAccordion({
  title,
  summary,
  open,
  primary,
  onToggle,
  children,
}: {
  title: string
  summary: string
  open: boolean
  primary?: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <section
      className={[
        'overflow-hidden rounded-md border bg-panel-raised',
        primary ? 'border-border-strong shadow-sm' : 'border-border',
      ].join(' ')}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full min-w-0 items-center gap-2 px-2.5 py-2.5 text-left hover:bg-panel"
      >
        <span
          className={[
            'text-[11px] font-semibold tracking-wider uppercase',
            open || primary ? 'text-text' : 'text-text-muted',
          ].join(' ')}
        >
          {title}
        </span>
        <span className="min-w-0 flex-1 truncate text-right text-[10px] text-text-dim">
          {summary}
        </span>
        <span
          className={[
            'grid h-5 w-5 shrink-0 place-items-center rounded text-[12px]',
            open ? 'text-accent' : 'text-text-dim',
          ].join(' ')}
          aria-hidden="true"
        >
          {open ? '−' : '+'}
        </span>
      </button>
      <div
        className={[
          'grid transition-[grid-template-rows] duration-200 ease-out',
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        ].join(' ')}
        aria-hidden={!open}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            className={[
              'space-y-3 border-t border-border p-2.5 transition-opacity duration-150',
              open ? 'opacity-100' : 'pointer-events-none opacity-0',
            ].join(' ')}
          >
            {children}
          </div>
        </div>
      </div>
    </section>
  )
}

function TextAnimationPanel() {
  useSceneVersion()
  const api = useSceneAPI()
  const selection = useUI((s) => s.selection)
  const selectedTrackIds = useUI((s) => s.selectedTrackIds)
  const selectedKeyframes = useUI((s) => s.selectedKeyframes)
  const staggerOn = useUI((s) => s.staggerOn)
  const staggerDelay = useUI((s) => s.staggerDelay)
  const setStaggerOn = useUI((s) => s.setStaggerOn)
  const setStaggerDelay = useUI((s) => s.setStaggerDelay)
  const activeStaggerSetId = useUI((s) => s.activeStaggerSetId)
  const playhead = useUI((s) => s.playhead)
  const [showPicker, setShowPicker] = useState(false)
  const [showEasing, setShowEasing] = useState(false)
  const [copiedEasing, setCopiedEasing] = useState(false)
  const [easingDraft, setEasingDraft] = useState({ source: '', value: '' })
  const updateStaggerDelay = (delay: number) => {
    if (activeStaggerSetId) {
      retimeStaggerSet(api, activeStaggerSetId, delay)
    }
    setStaggerDelay(delay)
  }
  const selectedTextTrackFilter = timelineTrackFilter(selectedTrackIds, selectedKeyframes)
  const selectedTextNodes = textNodesFromSelectionOrTimeline(
    api,
    selection,
    selectedTextTrackFilter,
  )
  const primary = selectedTextNodes[0]
  const primaryTextAnimationTrack = primary
    ? findTextAnimationTrack(api, primary.id, selectedTextTrackFilter, playhead)
    : null
  const primarySelectedTimelineTrack = primary
    ? findSelectedTimelineTrack(api, primary.id, selectedTextTrackFilter)
    : null
  const primaryResolvedTextTrack =
    primaryTextAnimationTrack ??
    (primary && primarySelectedTimelineTrack
      ? findTextAnimationTrackMatchingRange(api, primary.id, primarySelectedTimelineTrack)
      : null)
  const primaryTextAnimationConfig = normalizeTextAnimation(primary?.textAnimation)
  const current = primaryResolvedTextTrack
    ? withTextTrackTiming(
        normalizeTextAnimation(primaryResolvedTextTrack.textAnimation ?? primary?.textAnimation),
        primaryResolvedTextTrack,
        primary?.text ?? '',
      )
    : withTextTrackTiming(
        primaryTextAnimationConfig,
        primarySelectedTimelineTrack,
        primary?.text ?? '',
      )
  const currentEasingText = current ? easingToText(current) : ''
  const visibleEasingDraft =
    easingDraft.source === currentEasingText ? easingDraft.value : currentEasingText

  const patch = (next: Partial<TextAnimationConfig>) => {
    if (!current) return
    for (const node of selectedTextNodes) {
      const selectedTimelineTrack = findSelectedTimelineTrack(api, node.id, selectedTextTrackFilter)
      const textTrack =
        findTextAnimationTrack(api, node.id, selectedTextTrackFilter, playhead) ??
        (selectedTimelineTrack
          ? findTextAnimationTrackMatchingRange(api, node.id, selectedTimelineTrack)
          : null)
      const base = normalizeTextAnimation(textTrack?.textAnimation ?? node.textAnimation) ?? current
      const config = {
        ...base,
        ...next,
      }
      const timingTrack = textTrack ?? selectedTimelineTrack
      const timedConfig = withTextTrackTiming(config, timingTrack, node.text, next) ?? config
      api.setNodeProperty(node.id, 'textAnimation', timedConfig)
      if (isTextEasingOnlyPatch(next)) {
        updateTextAnimationEasing(api, node.id, timedConfig, textTrack?.id)
      } else {
        stampTextAnimationKeyframes(api, node.id, timedConfig, node.text, {
          trackId: textTrack?.id,
        })
      }
    }
  }
  const updateEasingText = (value: string) => {
    setEasingDraft({ source: currentEasingText, value })
    const parsed = parseEasingText(value)
    if (!parsed) return
    patch(parsed)
  }
  const copyEasing = async () => {
    try {
      await navigator.clipboard?.writeText(visibleEasingDraft)
      setCopiedEasing(true)
      window.setTimeout(() => setCopiedEasing(false), 1200)
    } catch {
      setCopiedEasing(false)
    }
  }

  const pickPreset = (id: TextAnimationId) => {
    const applied = new Set<NodeId>()
    const staggerMembers: Array<{
      nodeId: NodeId
      propertyId: 'text.progress'
      keyframeIds: string[]
    }> = []
    for (let i = 0; i < selectedTextNodes.length; i++) {
      const node = selectedTextNodes[i]!
      if (applied.has(node.id)) continue
      applied.add(node.id)
      const priorTextTrackIds = new Set(
        api
          .getTracksForNode(node.id)
          .filter((track) => track.propertyId === 'text.progress')
          .map((track) => track.id),
      )
      const selectedTimelineTrack = findSelectedTimelineTrack(api, node.id, selectedTextTrackFilter)
      const textTrack =
        findTextAnimationTrack(api, node.id, selectedTextTrackFilter, playhead) ??
        (selectedTimelineTrack
          ? findTextAnimationTrackMatchingRange(api, node.id, selectedTimelineTrack)
          : null)
      const timingTrack = textTrack ?? selectedTimelineTrack
      const startTime = timingTrack
        ? trackStartTime(timingTrack)
        : playhead + (staggerOn && selectedTextNodes.length > 1 ? i * staggerDelay : 0)
      if (!textTrack && selectedTimelineTrack) {
        const previous = normalizeTextAnimation(node.textAnimation)
        const defaults = textAnimationDefaults(id)
        const next: TextAnimationConfig = {
          ...defaults,
          ...(previous
            ? {
                mode: previous.mode,
                applyTo: previous.applyTo,
                order: previous.order,
                delay: previous.delay,
                smoothing: previous.smoothing,
                easingPresetId: previous.easingPresetId,
                easingStrength: previous.easingStrength,
                customEasing: previous.customEasing,
              }
            : {}),
          startTime,
        }
        const timedConfig = withTextTrackTiming(
          next,
          selectedTimelineTrack,
          node.text,
        ) ?? next
        api.setNodeProperty(node.id, 'textAnimation', timedConfig)
        stampTextAnimationKeyframes(api, node.id, timedConfig, node.text)
      } else {
        applyTextAnimation(
          api,
          node.id,
          id,
          startTime,
          normalizeTextAnimation(textTrack?.textAnimation ?? node.textAnimation),
          { trackId: textTrack?.id },
        )
      }
      const authoredTrack = textTrack
        ? api.getTrack(textTrack.id)
        : api
            .getTracksForNode(node.id)
            .find(
              (track) =>
                track.propertyId === 'text.progress' &&
                !priorTextTrackIds.has(track.id),
            )
      if (authoredTrack?.propertyId === 'text.progress') {
        staggerMembers.push({
          nodeId: node.id,
          propertyId: 'text.progress',
          keyframeIds: authoredTrack.keyframes.map((keyframe) => keyframe.id),
        })
      }
    }
    if (
      staggerOn &&
      activeStaggerSetId &&
      selectedTextNodes.length > 1 &&
      staggerMembers.length > 0
    ) {
      registerStaggerSetKeyframes(
        api,
        {
          setId: activeStaggerSetId,
          layerIds: selectedTextNodes.map((node) => node.id),
          delay: staggerDelay,
          order: 'forward',
        },
        staggerMembers,
      )
    }
    setShowPicker(false)
  }

  if (!current) {
    return (
      <div className="space-y-3" data-timeline-selection-surface="1">
        <div className="rounded-md border border-border-strong/60 bg-panel-raised p-2">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold text-text">
                No text animation
              </div>
              <div className="mt-0.5 text-[10px] text-text-dim">
                Apply at {playhead.toFixed(2)}s
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowPicker((v) => !v)}
              className="rounded bg-accent/12 px-3 py-1.5 text-[12px] font-semibold text-accent hover:bg-accent/18"
            >
              Add
            </button>
          </div>
        </div>
        {showPicker ? <TextPresetPicker current={null} onPick={pickPreset} /> : null}
        <TextStaggerControls
          enabled={staggerOn}
          delay={staggerDelay}
          disabled={selectedTextNodes.length < 2}
          onEnabledChange={setStaggerOn}
          onDelayChange={updateStaggerDelay}
        />
      </div>
    )
  }

  const currentPreset =
    textPresetForConfig(current) ??
    TEXT_ANIMATION_PRESETS[0]!

  return (
    <div className="space-y-3" data-timeline-selection-surface="1">
      <div className="rounded-md border border-border bg-panel-raised">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 p-2.5">
          <div className="grid min-w-0 grid-cols-[minmax(72px,96px)_minmax(0,1fr)] items-center gap-2">
            <TextAnimationThumb preset={currentPreset} active />
            <div className="min-w-0">
              <div className="truncate text-[12px] font-semibold text-text">
                {currentPreset.label}
              </div>
              <div className="mt-0.5 truncate text-[10px] text-text-dim">
                {textApplyLabel(current.applyTo)} · {current.mode === 'in' ? 'In' : 'Out'}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowPicker((v) => !v)}
            className="h-8 rounded bg-accent/12 px-3 text-[11px] font-semibold text-accent hover:bg-accent/18"
          >
            Change
          </button>
        </div>
        <div className="border-t border-border p-2.5">
          <div className="grid grid-cols-2 rounded bg-panel p-0.5">
            {(['in', 'out'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => patch({ mode })}
                className={[
                  'h-8 rounded text-[12px] font-semibold',
                  current.mode === mode
                    ? 'bg-panel-raised text-text shadow-sm'
                    : 'text-text-dim hover:text-text-muted',
                ].join(' ')}
              >
                {mode === 'in' ? 'In' : 'Out'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {showPicker ? <TextPresetPicker current={current.id} onPick={pickPreset} /> : null}
      <TextStaggerControls
        enabled={staggerOn}
        delay={staggerDelay}
        disabled={selectedTextNodes.length < 2 || Boolean(primaryTextAnimationTrack)}
        onEnabledChange={setStaggerOn}
        onDelayChange={updateStaggerDelay}
      />

      <ControlCard title="Effect">
        {(current.id === 'blur' || current.id === 'blur-slide') ? (
          <ParamRow label="Blur radius">
            <NumberField
              value={current.blurRadius}
              onCommit={(blurRadius) => patch({ blurRadius })}
              min={0}
              max={128}
              width="w-24"
            />
          </ParamRow>
        ) : null}
        {usesDirection(current.id) ? (
          <ParamRow label="Direction">
            <DirectionButtons
              value={current.direction}
              onChange={(direction) =>
                patch(textDirectionPatch(current, direction))
              }
            />
          </ParamRow>
        ) : null}
        {usesTravel(current.id) ? (
          <ParamRow label="Travel distance">
            <NumberField
              value={Math.round(current.travelDistance * 100)}
              onCommit={(pct) => patch({ travelDistance: pct / 100 })}
              min={0}
              max={300}
              suffix="%"
              width="w-24"
            />
          </ParamRow>
        ) : null}
        <ParamRow label="Duration">
          <NumberField
            value={Math.round(current.duration * 1000)}
            onCommit={(ms) => patch({ duration: ms / 1000 })}
            min={50}
            suffix="ms"
            width="w-24"
          />
        </ParamRow>
        {current.id === 'gradient-reveal' ? (
          <>
            <ParamRow label="Start gradient">
              <GradientTextField
                key={`start-${gradientToText(current.startGradient)}`}
                value={gradientToText(current.startGradient)}
                onCommit={(value) => {
                  const fill = parseGradientText(value)
                  if (fill) patch({ startGradient: fill })
                }}
              />
            </ParamRow>
            <ParamRow label="End gradient">
              <GradientTextField
                key={`end-${gradientToText(current.endGradient)}`}
                value={gradientToText(current.endGradient)}
                onCommit={(value) => {
                  const fill = parseGradientText(value)
                  if (fill) patch({ endGradient: fill })
                }}
              />
            </ParamRow>
          </>
        ) : null}
        <ParamRow label="Acceleration">
          <div className="grid max-w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1">
            <input
              value={visibleEasingDraft}
              onChange={(e) => updateEasingText(e.currentTarget.value)}
              className="h-8 min-w-0 rounded bg-panel px-2 font-mono text-[11px] text-text outline-none ring-1 ring-transparent hover:ring-border focus:ring-2 focus:ring-accent/45"
              title="Comma-separated cubic bezier values"
            />
            <button
              type="button"
              onClick={copyEasing}
              className="h-8 rounded bg-panel px-2 text-[11px] text-text-muted hover:text-text"
              title="Copy easing values"
            >
              {copiedEasing ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              onClick={() => setShowEasing((v) => !v)}
              aria-pressed={showEasing}
              className={[
                'grid h-8 w-8 place-items-center rounded bg-panel text-text-muted hover:text-text',
                showEasing ? 'bg-accent/14 text-accent' : '',
              ].join(' ')}
              title="Show curve presets and graph editor"
            >
              <SlidersIcon />
            </button>
          </div>
        </ParamRow>
        {showEasing ? (
          <>
            <EasingPicker
              title={null}
              allowedPresetIds={[...TEXT_EASING_PRESETS]}
              presetId={current.easingPresetId}
              strength={current.easingStrength}
              onChange={({ presetId, strength }) =>
                patch({
                  easingPresetId: presetId,
                  easingStrength: strength,
                  customEasing: undefined,
                })
              }
            />
            <GraphEditor />
          </>
        ) : null}
      </ControlCard>

      <ControlCard title="Text">
        <ParamRow label="Apply effect to">
          <SelectField<TextAnimationApplyTo>
            value={current.applyTo}
            options={[
              ['letters', 'Letters'],
              ['words', 'Words'],
              ['lines', 'Lines'],
              ['layer', 'Layer'],
            ]}
            onChange={(applyTo) => patch({ applyTo })}
          />
        </ParamRow>
        <ParamRow label="Order">
          <SelectField<TextAnimationOrder>
            value={current.order}
            options={[
              ['forward', 'Forward'],
              ['backward', 'Backward'],
            ]}
            onChange={(order) => patch({ order })}
          />
        </ParamRow>
        <ParamRow label="Smoothing">
          <SelectField<TextAnimationSmoothing>
            value={current.smoothing}
            options={[
              ['none', 'None'],
              ['soft', 'Soft'],
              ['smooth', 'Smooth'],
            ]}
            onChange={(smoothing) => patch({ smoothing })}
          />
        </ParamRow>
      </ControlCard>
    </div>
  )
}

function TextPresetPicker({
  current,
  onPick,
}: {
  current: TextAnimationId | null
  onPick: (id: TextAnimationId) => void
}) {
  const categories = Array.from(new Set(TEXT_ANIMATION_PRESETS.map((p) => p.category)))
  return (
    <div className="max-h-[420px] overflow-auto border-b border-border bg-panel-raised p-3">
      {categories.map((category) => (
        <div key={category} className="mb-5 last:mb-0">
          <div className="mb-2 text-[15px] font-bold text-text">{category}</div>
          <div className="grid grid-cols-2 gap-2">
            {TEXT_ANIMATION_PRESETS.filter((p) => p.category === category).map((preset) => (
              <button
                key={preset.id}
                type="button"
                data-preview-on="1"
                onClick={() => onPick(preset.id)}
                className="group flex flex-col gap-1.5 rounded-md border border-border-strong/60 bg-panel-raised p-1.5 text-left transition-colors hover:border-border-strong hover:bg-panel"
              >
                <TextAnimationCardPreview preset={preset} selected={current === preset.id} />
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function TextAnimationCardPreview({
  preset,
  selected = false,
}: {
  preset: (typeof TEXT_ANIMATION_PRESETS)[number]
  selected?: boolean
}) {
  return (
    <>
      <div
        className={[
          'hm-text-preset-stage h-14 w-full rounded-[5px] bg-panel',
          selected ? 'ring-1 ring-accent/65' : '',
        ].join(' ')}
      >
        <span className={`hm-text-preset-subject hm-text-preset-${preset.id}`}>
          {Array.from(TEXT_ANIMATION_PREVIEW_WORD).map((char, index) => (
            <span
              key={`${preset.id}-${index}`}
              className="hm-text-preview-letter"
              style={{ '--i': index } as CSSProperties}
            >
              {char}
            </span>
          ))}
        </span>
      </div>
      <span className="block px-1 pt-1 pb-0.5 text-[11px] text-text">
        {preset.label}
      </span>
    </>
  )
}

function TextStaggerControls({
  enabled,
  delay,
  disabled,
  onEnabledChange,
  onDelayChange,
}: {
  enabled: boolean
  delay: number
  disabled: boolean
  onEnabledChange: (enabled: boolean) => void
  onDelayChange: (delay: number) => void
}) {
  return (
    <div className="rounded-md border border-border bg-panel-raised p-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold text-text">Stagger</div>
          <div className="mt-0.5 text-[10px] text-text-dim">
            Offset newly added text animations across selected layers.
          </div>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onEnabledChange(!enabled)}
          className={[
            'h-6 w-10 rounded-full border p-0.5 transition',
            enabled && !disabled
              ? 'border-accent bg-accent/20'
              : 'border-border-strong bg-panel',
            disabled ? 'cursor-not-allowed opacity-45' : '',
          ].join(' ')}
          aria-pressed={enabled}
        >
          <span
            className={[
              'block h-4 w-4 rounded-full bg-text-dim transition-transform',
              enabled && !disabled ? 'translate-x-4 bg-accent' : '',
            ].join(' ')}
          />
        </button>
      </div>
      {enabled && !disabled ? (
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-[10px] uppercase tracking-wide text-text-dim">Delay</span>
          <NumberField
            value={delay}
            onCommit={(next) => onDelayChange(Math.max(0, next))}
            onScrubPreview={() => {}}
            onScrubCommit={(next) => onDelayChange(Math.max(0, next))}
            min={0}
            step={0.05}
            suffix="s"
            width="w-24"
          />
        </div>
      ) : null}
    </div>
  )
}

function TextAnimationThumb({
  preset,
  active = false,
}: {
  preset: (typeof TEXT_ANIMATION_PRESETS)[number]
  active?: boolean
}) {
  return (
    <div
      className={[
        'hm-text-preset-stage h-12 min-w-0 rounded-[5px] bg-panel',
        active ? 'ring-1 ring-accent/55' : '',
      ].join(' ')}
    >
      <span className={`hm-text-preset-subject hm-text-preset-${preset.id}`}>
        {Array.from(TEXT_ANIMATION_PREVIEW_WORD).map((char, index) => (
          <span
            key={`${preset.id}-thumb-${index}`}
            className="hm-text-preview-letter"
            style={{ '--i': index } as CSSProperties}
          >
            {char}
          </span>
        ))}
      </span>
    </div>
  )
}

function textApplyLabel(value: TextAnimationApplyTo): string {
  if (value === 'letters') return 'Letters'
  if (value === 'words') return 'Words'
  if (value === 'lines') return 'Lines'
  return 'Layer'
}

function ControlCard({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <div className="rounded-md border border-border bg-panel-raised">
      <div className="border-b border-border px-2.5 py-2 text-[10px] font-semibold tracking-wider text-text-muted uppercase">
        {title}
      </div>
      <div className="space-y-2.5 p-2.5">{children}</div>
    </div>
  )
}

function ParamRow({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,auto)] items-center gap-3">
      <div className="min-w-0 truncate text-[12px] text-text-dim">{label}</div>
      <div className="min-w-0 justify-self-end">{children}</div>
    </div>
  )
}

function SelectField<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: Array<[T, string]>
  onChange: (next: T) => void
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.currentTarget.value as T)}
      className="h-8 max-w-full rounded bg-panel px-2 text-[12px] text-text outline-none ring-1 ring-transparent hover:ring-border focus:ring-2 focus:ring-accent/45"
    >
      {options.map(([id, label]) => (
        <option key={id} value={id}>
          {label}
        </option>
      ))}
    </select>
  )
}

function DirectionButtons({
  value,
  onChange,
}: {
  value: TextAnimationDirection
  onChange: (next: TextAnimationDirection) => void
}) {
  const buttons: Array<[TextAnimationDirection, string]> = [
    ['up', '↑'],
    ['down', '↓'],
    ['left', '←'],
    ['right', '→'],
  ]
  return (
    <div className="grid grid-cols-4 rounded bg-panel p-0.5">
      {buttons.map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={[
            'h-8 w-8 rounded text-[17px]',
            value === id ? 'bg-accent/14 text-accent' : 'text-text-dim hover:text-text',
          ].join(' ')}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function GradientTextField({
  value,
  onCommit,
}: {
  value: string
  onCommit: (next: string) => void
}) {
  const [draft, setDraft] = useState(value)
  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.currentTarget.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          onCommit(draft)
          e.currentTarget.blur()
        }
      }}
      className="h-8 w-48 max-w-full rounded bg-panel px-2 font-mono text-[11px] text-text outline-none ring-1 ring-transparent hover:ring-border focus:ring-2 focus:ring-accent/45"
      title="Comma-separated gradient colors"
    />
  )
}

function SlidersIcon() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    >
      <path d="M2 4h3" />
      <path d="M9 4h5" />
      <path d="M7 2.5v3" />
      <path d="M2 8h7" />
      <path d="M13 8h1" />
      <path d="M11 6.5v3" />
      <path d="M2 12h2" />
      <path d="M8 12h6" />
      <path d="M6 10.5v3" />
    </svg>
  )
}

function usesDirection(id: TextAnimationId): boolean {
  return (
    id === 'slide-up' ||
    id === 'slide-down' ||
    id === 'slide-left' ||
    id === 'slide-right' ||
    id === 'mask-up' ||
    id === 'mask-down' ||
    id === 'blur-slide' ||
    id === 'character-wave' ||
    id === 'skew'
  )
}

function usesTravel(id: TextAnimationId): boolean {
  return (
    id === 'slide-up' ||
    id === 'slide-down' ||
    id === 'slide-left' ||
    id === 'slide-right' ||
    id === 'mask-up' ||
    id === 'mask-down' ||
    id === 'blur-slide' ||
    id === 'character-wave' ||
    id === 'skew'
  )
}

function textPresetForConfig(config: TextAnimationConfig) {
  return (
    TEXT_ANIMATION_PRESETS.find(
      (preset) => preset.id === directionalTextAnimationId(config),
    ) ?? TEXT_ANIMATION_PRESETS.find((preset) => preset.id === config.id)
  )
}

function textDirectionPatch(
  config: TextAnimationConfig,
  direction: TextAnimationDirection,
): Partial<TextAnimationConfig> {
  const nextId = directionalTextAnimationId({ ...config, direction })
  return nextId === config.id ? { direction } : { id: nextId, direction }
}

function directionalTextAnimationId(
  config: Pick<TextAnimationConfig, 'id' | 'direction'>,
): TextAnimationId {
  if (
    config.id === 'slide-up' ||
    config.id === 'slide-down' ||
    config.id === 'slide-left' ||
    config.id === 'slide-right'
  ) {
    return `slide-${config.direction}` as TextAnimationId
  }
  if (config.id === 'mask-up' || config.id === 'mask-down') {
    return config.direction === 'down' ? 'mask-down' : 'mask-up'
  }
  return config.id
}

function easingToText(config: TextAnimationConfig): string {
  const curve = bezierOf(
    config.easingPresetId === 'custom' && config.customEasing
      ? config.customEasing
      : findEasingPreset(config.easingPresetId).build(config.easingStrength),
  )
  return curve.map((n) => formatCurveNumber(n)).join(', ')
}

function gradientToText(fill: Fill | null | undefined): string {
  if (!fill || fill.kind !== 'linear') return '#7c3aed, #06b6d4'
  return fill.stops.map((stop) => stop.color).join(', ')
}

function parseGradientText(value: string): Fill | null {
  const colors = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  if (colors.length < 2) return null
  const max = Math.max(1, colors.length - 1)
  return {
    kind: 'linear',
    angle: 90,
    stops: colors.map((color, index) => ({
      color,
      at: index / max,
    })),
  }
}

function isTextEasingOnlyPatch(patch: Partial<TextAnimationConfig>): boolean {
  const keys = Object.keys(patch)
  return (
    keys.length > 0 &&
    keys.every((key) =>
      key === 'easingPresetId' ||
      key === 'easingStrength' ||
      key === 'customEasing' ||
      key === 'acceleration'
    )
  )
}

function timelineTrackFilter(
  selectedTrackIds: string[],
  selectedKeyframes: string[],
): ReadonlySet<string> | undefined {
  const ids = new Set<string>()
  for (const key of selectedKeyframes) {
    const colon = key.indexOf(':')
    if (colon > 0) ids.add(key.slice(0, colon))
  }
  for (const id of selectedTrackIds) ids.add(id)
  return ids.size > 0 ? ids : undefined
}

function textNodesFromSelectionOrTimeline(
  api: SceneAPI,
  selection: NodeId[],
  trackFilter?: ReadonlySet<string>,
): Array<NonNullable<ReturnType<SceneAPI['getNode']>> & { kind: 'text' }> {
  const byId = new Map<NodeId, NonNullable<ReturnType<SceneAPI['getNode']>> & { kind: 'text' }>()
  for (const id of selection) {
    const node = api.getNode(id)
    if (node?.kind === 'text') byId.set(node.id, node)
  }
  if (byId.size > 0 || !trackFilter) return [...byId.values()]
  for (const id of api.getAllNodeIds()) {
    const node = api.getNode(id)
    if (node?.kind !== 'text') continue
    const hasSelectedTextTrack = listTracksForNode(api, id).some(
      (track) => trackFilter.has(track.id),
    )
    if (hasSelectedTextTrack) byId.set(node.id, node)
  }
  return [...byId.values()]
}

function findTextAnimationTrack(
  api: SceneAPI,
  nodeId: NodeId,
  trackFilter?: ReadonlySet<string>,
  playhead?: number,
): ReturnType<typeof listTracksForNode>[number] | null {
  const tracks = listTracksForNode(api, nodeId).filter(
    (track) => track.propertyId === 'text.progress' && track.keyframes.length >= 2,
  )
  if (trackFilter) {
    const selected = tracks.find((track) => trackFilter.has(track.id))
    if (selected) return selected
  }
  if (playhead !== undefined) {
    return tracks.find((track) => trackContainsTime(track, playhead)) ?? null
  }
  return tracks[0] ?? null
}

function findSelectedTimelineTrack(
  api: SceneAPI,
  nodeId: NodeId,
  trackFilter?: ReadonlySet<string>,
): ReturnType<typeof listTracksForNode>[number] | null {
  if (!trackFilter) return null
  return (
    listTracksForNode(api, nodeId).find((track) => trackFilter.has(track.id)) ??
    null
  )
}

function findTextAnimationTrackMatchingRange(
  api: SceneAPI,
  nodeId: NodeId,
  reference: ReturnType<typeof listTracksForNode>[number],
): ReturnType<typeof listTracksForNode>[number] | null {
  const referenceRange = trackRange(reference)
  if (!referenceRange) return null
  return (
    listTracksForNode(api, nodeId)
      .filter((track) => track.propertyId === 'text.progress' && track.keyframes.length >= 2)
      .find((track) => {
        const range = trackRange(track)
        return (
          !!range &&
          Math.abs(range.start - referenceRange.start) <= 0.02 &&
          Math.abs(range.end - referenceRange.end) <= 0.02
        )
      }) ?? null
  )
}

function trackContainsTime(
  track: ReturnType<typeof listTracksForNode>[number],
  time: number,
): boolean {
  const range = trackRange(track)
  if (!range) return false
  const { start, end } = range
  return time >= start - 0.01 && time <= end + 0.01
}

function trackStartTime(track: ReturnType<typeof listTracksForNode>[number]): number {
  return trackRange(track)?.start ?? 0
}

function trackRange(
  track: ReturnType<typeof listTracksForNode>[number],
): { start: number; end: number } | null {
  if (track.keyframes.length === 0) return null
  const times = track.keyframes.map((keyframe) => keyframe.time)
  return {
    start: Math.min(...times),
    end: Math.max(...times),
  }
}

function withTextTrackTiming(
  config: TextAnimationConfig | null,
  track: ReturnType<typeof listTracksForNode>[number] | null,
  text: string,
  patch: Partial<TextAnimationConfig> = {},
): TextAnimationConfig | null {
  if (!config || !track || track.keyframes.length < 2) return config
  const sorted = [...track.keyframes].sort((a, b) => a.time - b.time)
  const start = sorted[0]!.time
  const end = sorted[sorted.length - 1]!.time
  const delaySpan =
    Math.max(0, textTimingSegmentCount(text, config.applyTo) - 1) *
    config.delay
  const duration =
    patch.duration !== undefined
      ? Math.max(0.05, patch.duration)
      : Math.max(0.05, end - start - delaySpan)
  return {
    ...config,
    startTime: patch.startTime ?? start,
    duration,
  }
}

function textTimingSegmentCount(
  text: string,
  applyTo: TextAnimationApplyTo,
): number {
  if (applyTo === 'layer') return 1
  if (applyTo === 'lines') {
    return Math.max(1, text.split(/\n/).filter((line) => line.length > 0).length)
  }
  if (applyTo === 'words') {
    return Math.max(1, text.trim().split(/\s+/).filter(Boolean).length)
  }
  return Math.max(1, Array.from(text).filter((char) => char !== '\n' && char !== ' ').length)
}

function parseEasingText(
  value: string,
): Pick<TextAnimationConfig, 'easingPresetId' | 'easingStrength' | 'customEasing'> | null {
  const parts = value
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isFinite(n))
  if (parts.length !== 4) return null
  const [x1, y1, x2, y2] = parts
  const clampedX1 = Math.max(0, Math.min(1, x1!))
  const clampedX2 = Math.max(0, Math.min(1, x2!))
  return {
    easingPresetId: 'custom',
    easingStrength: 50,
    customEasing: { bezier: [clampedX1, y1!, clampedX2, y2!] },
  }
}

function formatCurveNumber(n: number): string {
  const rounded = Math.round(n * 1000) / 1000
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

function PresetTabs({
  value,
  onChange,
  inCount,
  outCount,
}: {
  value: 'in' | 'out'
  onChange: (next: 'in' | 'out') => void
  inCount: number
  outCount: number
}) {
  return (
    <div className="grid grid-cols-2 rounded-md border border-border bg-panel p-0.5">
      {([
        ['in', `In (${inCount})`],
        ['out', `Out (${outCount})`],
      ] as const).map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={[
            'h-8 rounded text-[12px] font-semibold',
            value === id
              ? 'bg-panel-raised text-text shadow-sm'
              : 'text-text-dim hover:text-text-muted',
          ].join(' ')}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function PresetGrid({
  presets,
  onPick,
}: {
  presets: { id: AnimPresetId; label: string }[]
  onPick: (id: AnimPresetId) => void
}) {
  return (
    <div className="rounded-md border border-border bg-panel-raised p-2.5">
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
    <div>
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
            onScrubPreview={() => {}}
            onScrubCommit={onDelayChange}
            min={0}
            step={0.05}
            suffix="s"
            width="w-16"
          />
        </div>
      </div>
    </div>
  )
}

function describeTargets(
  selection: NodeId[],
  targets: NodeId[],
  staggerActive: boolean,
): string {
  if (staggerActive) {
    return `Staggering ${targets.length} layers`
  }
  if (selection.length > 1) {
    return `Applies to ${selection.length} layers`
  }
  return 'Applies to 1 layer'
}

/**
 * Rewrite track/keyframe easing.
 *
 *   - With `trackIdFilter` set (timeline has a track selection): apply
 *     ONLY to those tracks, regardless of whose layer they belong to.
 *     This is the path that solves "I selected a sequence of tracks in
 *     the timeline and want them all to share an easing curve."
 *   - Without a filter: apply to every track on every `target` layer.
 *     Same behavior as before — preset stamps still drive this path.
 */
function rewriteEasing(
  api: SceneAPI,
  targets: NodeId[],
  easing: EasingKind,
  trackIdFilter?: ReadonlySet<string>,
): void {
  const selectedTracks: ReturnType<typeof listTracksForNode> = []
  if (trackIdFilter && trackIdFilter.size > 0) {
    // Walk every node in the scene; cheap because the filter membership
    // check short-circuits anything that doesn't match.
    for (const id of api.getAllNodeIds()) {
      for (const t of listTracksForNode(api, id)) {
        if (trackIdFilter.has(t.id)) selectedTracks.push(t)
      }
    }
  } else {
    for (const id of targets) selectedTracks.push(...listTracksForNode(api, id))
  }
  if (selectedTracks.length === 0) return

  // Expand every selected keyframe through its persistent stagger bundle.
  // This keeps the right-panel easing control and graph-editor curve handles
  // consistent: editing any member applies the exact curve to its peers.
  const keyframeIdsByTrack = new Map<string, Set<string>>()
  const add = (trackId: string, keyframeId: string) => {
    const ids = keyframeIdsByTrack.get(trackId) ?? new Set<string>()
    ids.add(keyframeId)
    keyframeIdsByTrack.set(trackId, ids)
  }
  for (const track of selectedTracks) {
    for (const keyframe of track.keyframes) {
      const bundle = resolveStaggerKeyframeBundle(api, track.id, keyframe.id)
      if (bundle) {
        for (const member of bundle.members) {
          add(member.trackId, member.keyframeId)
        }
      } else {
        add(track.id, keyframe.id)
      }
    }
  }

  api.doc.transact(() => {
    for (const [trackId, keyframeIds] of keyframeIdsByTrack) {
      const track = api.getTrack(trackId)
      if (!track) continue
      api.setTrack({
        ...track,
        defaultEasing: easing,
        // Rewrite per-keyframe easingOut too — otherwise curves baked in by
        // presets win over the chosen easing and make the control feel inert.
        keyframes: track.keyframes.map((keyframe) =>
          keyframeIds.has(keyframe.id)
            ? { ...keyframe, easingOut: easing }
            : keyframe,
        ),
      })
    }
  })
}
