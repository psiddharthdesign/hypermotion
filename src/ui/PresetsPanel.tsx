// SPDX-License-Identifier: Apache-2.0

import { useState, type CSSProperties, type ReactNode } from 'react'
import { useUI } from '@/state/ui'
import { useSceneAPI, useSceneVersion } from '@/scene'
import type { EasingKind, Fill, NodeId } from '@/scene'
import type { SceneAPI } from '@/scene/doc'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import {
  PRESETS,
  applyPreset,
  listTracksForNode,
  removeTrack,
  findEasingPreset,
  bezierOf,
  TEXT_ANIMATION_PRESETS,
  applyTextAnimation,
  deriveTextAnimationTiming,
  planLayerPresetTargets,
  planTextPresetTargets,
  planTextStaggerStartTimes,
  normalizeTextAnimation,
  stampTextAnimationKeyframes,
  textAnimationDefaults,
  textAnimationUsesLegacyTranslation,
  defaultTextMotionPath,
  setTextMotionPathDistance,
  textStaggerCurveForPreset,
  textMotionPathDistance,
  updateTextAnimationEasing,
  updateTextAnimationTrackMetadata,
  applyEasingToSelection,
  inspectEasingSelection,
} from '@/anim'
import type {
  AnimPresetId,
  EasingPresetId,
  EasingSelectionSummary,
  TextAnimationApplyTo,
  TextAnimationConfig,
  TextAnimationDirection,
  TextAnimationId,
  TextAnimationMotionVector,
  NumberFlowTrend,
  TextAnimationOrder,
  TextAnimationSmoothing,
  TextStaggerCurve,
  TextMotionPath,
} from '@/anim'
import { EasingPicker } from '@/ui/EasingPicker'
import { GraphEditor } from '@/ui/GraphEditor'
import {
  FieldRow,
  NumberField,
  SquircleSurface,
  TimeField,
} from '@/ui/fields'
import {
  formatNumericDisplayValue,
  formatNumericValue,
  parseNumericExpression,
} from '@/ui/fields/numericExpression'
import {
  resolveCursorVariantKeyframeSelection,
  setSelectedCursorVariantKeyframeState,
} from '@/ui/cursorVariantKeyframeEditing'
import type { CursorVariantKeyframeSelection } from '@/ui/cursorVariantKeyframeEditing'
import {
  currentAnimationAuthorTime,
  pausedInspectorPlayhead,
} from '@/ui/animationPlayhead'
import { selectTextAnimationTrackForAuthoring } from '@/ui/textAnimationTrackSelection'
import {
  StaggerCurveEditor,
  StaggerCurveMini,
} from '@/ui/StaggerCurveEditor'
import { textStaggerCurvePreviewStore } from '@/ui/textStaggerCurvePreviewStore'
import { StaggerGroupPanel } from '@/ui/StaggerGroupPanel'
import {
  TextMotionPathEditor,
  TextMotionPathMini,
} from '@/ui/TextMotionPathEditor'
import {
  findStaggerSetMemberTrack,
  registerStaggerSetKeyframes,
  resolveStaggerTrackBundle,
  retimeStaggerSet,
  staggerLayerOffset,
} from '@/anim/staggerSets'
import {
  normalizeNumberFlowIncrementForTargets,
  numberFlowDisplayUnit,
  parseNumberFlowText,
} from '@/anim/numberFlow'

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
  const pausedPlayhead = useUI(pausedInspectorPlayhead)
  const playhead = pausedPlayhead ?? useUI.getState().playhead
  const easingPresetId = useUI((s) => s.easingPresetId)
  const easingStrength = useUI((s) => s.easingStrength)
  const setEasing = useUI((s) => s.setEasing)
  const staggerOn = useUI((s) => s.staggerOn)
  const staggerDelay = useUI((s) => s.staggerDelay)
  const setStaggerOn = useUI((s) => s.setStaggerOn)
  const setStaggerDelay = useUI((s) => s.setStaggerDelay)
  const activeStaggerSetId = useUI((s) => s.activeStaggerSetId)
  const selectedStaggerSetId = useUI((s) => s.selectedStaggerSetId)
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
  const updateStaggerOrder = (order: 'forward' | 'reverse') => {
    if (!activeStaggerSetId) return
    const set = api.getUiState().staggerSets[activeStaggerSetId]
    if (!set) return
    retimeStaggerSet(api, activeStaggerSetId, set.delay, order)
  }
  // Exact timeline selection remains intact all the way into the timing
  // mutation. `trackFilter` is still useful for resolving text-animation
  // panels, but timing itself consumes the full compound keyframe refs.
  const selectedTrackIds = useUI((s) => s.selectedTrackIds)
  const selectedKeyframes = useUI((s) => s.selectedKeyframes)
  const hasTimelineTimingSelection =
    selectedKeyframes.length > 0 || selectedTrackIds.length > 0
  const trackFilter = timelineTrackFilter(
    selectedTrackIds,
    selectedKeyframes,
  )

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

  if (
    selection.length === 0 &&
    selectedTextNodes.length === 0 &&
    !hasTimelineTimingSelection
  ) {
    if (selectedStaggerSetId) {
      return (
        <StaggerGroupPanel
          key={selectedStaggerSetId}
          setId={selectedStaggerSetId}
        />
      )
    }
    return (
      <div className="rounded-md bg-app-bg p-3 text-text-muted shadow-[var(--shadow-control)]">
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
    const authorTime = currentAnimationAuthorTime()
    const presetDirection = PRESETS.find((preset) => preset.id === id)?.direction
    for (const targetId of targets) {
      const startTime = isStaggerActive
        ? authorTime + staggerLayerOffset(
            targets,
            targetId,
            targetPlan.delay,
            targetPlan.order,
          )
        : authorTime
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
    applyEasingToSelection(
      api,
      { nodeIds: targets },
      easing,
      { presetId: easingPresetId, strength: easingStrength },
    )
  }

  // Update the easing preset + strength and push the resulting curve to
  // exactly the current timeline selection (or the layer fallback).
  // Continuous controls preview locally, then commit here once on release.
  const pickEasing = (next: {
    presetId: typeof easingPresetId
    strength: number
    easing: typeof easing
    source: 'preset' | 'strength' | 'custom'
  }) => {
    setEasing(next.presetId, next.strength)
    applyEasingToSelection(
      api,
      {
        keyframeKeys: selectedKeyframes,
        trackIds: selectedTrackIds,
        nodeIds: targets,
      },
      next.easing,
      { presetId: next.presetId, strength: next.strength },
    )
  }

  const timingSummary = inspectEasingSelection(api, {
    keyframeKeys: selectedKeyframes,
    trackIds: selectedTrackIds,
    nodeIds: targets,
  })
  const cursorVariantSelection = resolveCursorVariantKeyframeSelection(
    api,
    selectedKeyframes,
  )
  const savedTimingPreset = timingSummary.commonPreset
  const pickerPresetId =
    !timingSummary.mixed && savedTimingPreset
      ? savedTimingPreset.presetId
      : !timingSummary.mixed && timingSummary.commonEasing
        ? presetIdForLegacyEasing(timingSummary.commonEasing)
        : easingPresetId
  const pickerStrength =
    !timingSummary.mixed && savedTimingPreset
      ? savedTimingPreset.strength
      : easingStrength
  const cursorVariantCard = cursorVariantSelection ? (
    <CursorVariantKeyframeEditor
      selection={cursorVariantSelection}
      onChange={(state) =>
        setSelectedCursorVariantKeyframeState(api, selectedKeyframes, state)
      }
    />
  ) : null
  const timelineTimingCard =
    hasTimelineTimingSelection && !cursorVariantSelection ? (
    <EasingPicker
      title={
        timingSummary.scope === 'keyframes'
          ? 'Selected keyframe timing'
          : 'Selected track timing'
      }
      description={describeTimingSelection(timingSummary)}
      presetId={pickerPresetId}
      strength={pickerStrength}
      easingValue={timingSummary.commonEasing ?? undefined}
      mixed={timingSummary.mixed}
      disabled={timingSummary.eligibleSegmentCount === 0}
      onChange={pickEasing}
    />
  ) : null

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
      onToggle={() => toggleSection('layer')}
    >
      <div className="overflow-hidden rounded-md bg-app-bg shadow-[var(--shadow-control)]">
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
              order={activeStaggerSet?.order ?? 'forward'}
              orderEnabled={!!activeStaggerSet}
              onToggle={() => setStaggerOn(!staggerOn)}
              onDelayChange={updateStaggerDelay}
              onOrderChange={updateStaggerOrder}
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

      {!hasTimelineTimingSelection ? (
        <EasingPicker
          title="Layer timing"
          description={describeTimingSelection(timingSummary)}
          presetId={pickerPresetId}
          strength={pickerStrength}
          easingValue={timingSummary.commonEasing ?? undefined}
          mixed={timingSummary.mixed}
          onChange={pickEasing}
        />
      ) : null}

      {/* Per-segment bezier graph editor. Surfaces only when the
          live timeline keyframe selection narrows to a single
          numeric track — see GraphEditor for the discrimination
          logic. The placeholder it renders for "no target" is what
          guides the user to select keyframes if they haven't yet,
          so we always mount it (no conditional). */}
      {!hasTimelineTimingSelection ? <GraphEditor /> : null}

      <button
        onClick={clearAll}
        className="hm-control-surface h-7 w-full px-3 text-[11px] text-text-muted hover:text-text"
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
      onToggle={() => toggleSection('text')}
    >
      <TextAnimationPanel playhead={playhead} />
    </AnimationAccordion>
  ) : null

  return (
    <div className="space-y-4" data-timeline-selection-surface="1">
      {selectedStaggerSetId ? (
        <StaggerGroupPanel
          key={selectedStaggerSetId}
          setId={selectedStaggerSetId}
        />
      ) : null}
      {cursorVariantCard}
      {timelineTimingCard}
      {hasTextSelection ? (
        <>
          {textSection}
          {selection.length > 0 ? layerSection : null}
        </>
      ) : (
        <>
          {selection.length > 0 ? layerSection : null}
          {textSection}
        </>
      )}
    </div>
  )
}

function CursorVariantKeyframeEditor({
  selection,
  onChange,
}: {
  selection: CursorVariantKeyframeSelection
  onChange: (state: string) => void
}) {
  const count = selection.selectedKeyframeIds.length
  return (
    <div
      className="rounded-md bg-app-bg p-2.5 shadow-[var(--shadow-control)]"
      data-cursor-variant-keyframe-editor="1"
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold text-text">Cursor state</div>
          <div className="mt-0.5 text-[10px] text-text-dim">
            {count} selected {count === 1 ? 'keyframe' : 'keyframes'}
          </div>
        </div>
        <SquircleSurface
          as="label"
          radius={6}
          className="hm-control-surface hm-control-compact h-7 w-36"
        >
          <select
            value={selection.currentState ?? ''}
            onChange={(event) => onChange(event.target.value)}
            className="h-full w-full cursor-pointer bg-transparent pl-3 pr-2 text-[12px] text-text outline-none"
            aria-label="Selected cursor keyframe state"
          >
            {selection.currentState === null ? (
              <option value="" disabled className="bg-panel text-text-dim">
                Mixed states
              </option>
            ) : null}
            {selection.stateValues.map((state) => (
              <option key={state} value={state} className="bg-panel text-text">
                {state}
              </option>
            ))}
          </select>
        </SquircleSurface>
      </div>
    </div>
  )
}

function AnimationAccordion({
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  title: string
  summary: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <section className="border-t border-border pt-4 first:border-t-0 first:pt-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex h-7 w-full min-w-0 items-center gap-2 text-left text-text-muted hover:text-text"
      >
        <span
          className={[
            'text-[13px] font-semibold',
            open ? 'text-text' : 'text-text-muted',
          ].join(' ')}
        >
          {title}
        </span>
        <span className="min-w-0 flex-1 truncate text-right text-[11px] text-text-dim">
          {summary}
        </span>
        <span
          className={[
            'h-2 w-2 shrink-0 border-b border-r transition-transform duration-150 ease-[var(--ease-ui-out)]',
            open ? 'rotate-45 text-accent' : '-rotate-45 text-text-dim',
          ].join(' ')}
          aria-hidden="true"
        />
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
              'space-y-3 pt-2 transition-opacity duration-150 ease-[var(--ease-ui-out)]',
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

function TextAnimationPanel({ playhead }: { playhead: number }) {
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
  const [showPicker, setShowPicker] = useState(false)
  const [showEasing, setShowEasing] = useState(false)
  const [showStaggerCurve, setShowStaggerCurve] = useState(false)
  const [showMotionPath, setShowMotionPath] = useState(false)
  const [copiedEasing, setCopiedEasing] = useState(false)
  const [easingDraft, setEasingDraft] = useState({ source: '', value: '' })
  const updateStaggerDelay = (delay: number) => {
    if (activeStaggerSetId) {
      retimeStaggerSet(api, activeStaggerSetId, delay)
    }
    setStaggerDelay(delay)
  }
  const updateStaggerOrder = (order: 'forward' | 'reverse') => {
    if (!activeStaggerSetId) return
    const set = api.getUiState().staggerSets[activeStaggerSetId]
    if (!set) return
    retimeStaggerSet(api, activeStaggerSetId, set.delay, order)
  }
  const selectedTextTrackFilter = timelineTrackFilter(selectedTrackIds, selectedKeyframes)
  const selectedTextSources = textNodesFromSelectionOrTimeline(
    api,
    selection,
    selectedTextTrackFilter,
  )
  const activeStaggerSet = activeStaggerSetId
    ? api.getUiState().staggerSets[activeStaggerSetId]
    : undefined
  const textTargetPlan = planTextPresetTargets(
    selectedTextSources.map((node) => node.id),
    (id) => api.getNode(id)?.kind === 'text',
    staggerOn,
    staggerDelay,
    activeStaggerSet,
  )
  const selectedTextNodes = textTargetPlan.targets.flatMap((id) => {
    const node = api.getNode(id)
    return node?.kind === 'text' ? [node] : []
  })
  const isTextStaggerActive =
    textTargetPlan.staggerActive && selectedTextNodes.length > 0
  const activeTextStaggerHasMembers =
    isTextStaggerActive &&
    !!activeStaggerSet &&
    activeStaggerSet.layerIds.some(
      (nodeId) =>
        (activeStaggerSet.members[nodeId]?.['text.progress']?.length ?? 0) > 0,
    )
  const targetTextIds = new Set(selectedTextNodes.map((node) => node.id))
  const primary =
    selectedTextSources.find((node) => targetTextIds.has(node.id)) ??
    selectedTextNodes[0]
  const numberFlowTargets = selectedTextNodes.map((node) =>
    parseNumberFlowText(node.text),
  )
  const numberFlowEligible =
    numberFlowTargets.length > 0 &&
    numberFlowTargets.every((target) => target !== null)
  const primaryNumberFlowTarget = primary
    ? parseNumberFlowText(primary.text)
    : null
  const numberFlowIncrementUnit = Math.max(
    ...numberFlowTargets.map(numberFlowDisplayUnit),
  )
  const primarySelectedTimelineTrack = primary
    ? findSelectedTimelineTrack(api, primary.id, selectedTextTrackFilter)
    : null
  const primaryExplicitTextTrack =
    primary && selectedTextTrackFilter
      ? listTracksForNode(api, primary.id).find(
          (track) =>
            track.propertyId === 'text.progress' &&
            selectedTextTrackFilter.has(track.id),
        ) ?? null
      : null
  const primaryStaggerTextTrack =
    primary && staggerOn && activeStaggerSetId
      ? findStaggerSetMemberTrack(
          api,
          activeStaggerSetId,
          primary.id,
          'text.progress',
          playhead,
        )
      : null
  const primaryExplicitTrackIsOwned =
    !!primaryExplicitTextTrack &&
    !!primary &&
    !!activeStaggerSet?.members[primary.id]?.['text.progress']?.some((id) =>
      primaryExplicitTextTrack.keyframes.some(
        (keyframe) => keyframe.id === id,
      ),
    )
  const primaryGenericTextTrack = primary
    ? findTextAnimationTrack(
        api,
        primary.id,
        selectedTextTrackFilter,
        playhead,
      )
    : null
  const primaryTextAnimationTrack =
    (primaryExplicitTextTrack &&
    (!staggerOn || !activeStaggerSet || primaryExplicitTrackIsOwned)
      ? primaryExplicitTextTrack
      : null) ??
    primaryStaggerTextTrack ??
    (!activeTextStaggerHasMembers ? primaryGenericTextTrack : null)
  const primaryResolvedTextTrack =
    primaryTextAnimationTrack ??
    (!activeTextStaggerHasMembers && primary && primarySelectedTimelineTrack
      ? findTextAnimationTrackMatchingRange(api, primary.id, primarySelectedTimelineTrack)
      : null)
  const primaryTextAnimationConfig = normalizeTextAnimation(primary?.textAnimation)
  const staggerTextTrackBundle =
    activeStaggerSetId && primaryResolvedTextTrack
      ? resolveStaggerTrackBundle(
          api,
          activeStaggerSetId,
          primaryResolvedTextTrack.id,
        )
      : null
  const current = primaryResolvedTextTrack
    ? deriveTextAnimationTiming(
        normalizeTextAnimation(primaryResolvedTextTrack.textAnimation ?? primary?.textAnimation),
        primaryResolvedTextTrack,
        primary?.text ?? '',
      )
    : activeTextStaggerHasMembers
      ? null
      : deriveTextAnimationTiming(
          primaryTextAnimationConfig,
          primarySelectedTimelineTrack,
          primary?.text ?? '',
        )
  const freshTextStaggerStartTimesAt = (fallbackPlayhead: number) =>
    isTextStaggerActive &&
    !activeTextStaggerHasMembers &&
    primary
      ? planTextStaggerStartTimes(
          textTargetPlan,
          primary.id,
          primaryResolvedTextTrack
            ? trackStartTime(primaryResolvedTextTrack)
            : current?.startTime ?? fallbackPlayhead,
        )
      : null
  const currentEasingText = current ? easingToText(current) : ''
  const visibleEasingDraft =
    easingDraft.source === currentEasingText ? easingDraft.value : currentEasingText

  const patch = (next: Partial<TextAnimationConfig>) => {
    if (!current) return
    const authorTime = currentAnimationAuthorTime()
    const freshTextStaggerStartTimes =
      freshTextStaggerStartTimesAt(authorTime)
    const alignedTextStaggerStart = (
      nodeId: NodeId,
      fallback: number,
    ): number => freshTextStaggerStartTimes?.[nodeId] ?? fallback
    const staggerMembers: Array<{
      nodeId: NodeId
      propertyId: 'text.progress'
      keyframeIds: string[]
    }> = []
    api.doc.transact(() => {
      for (const node of selectedTextNodes) {
        const selectedTimelineTrack = findSelectedTimelineTrack(
          api,
          node.id,
          selectedTextTrackFilter,
        )
        const staggerTrackId =
          staggerTextTrackBundle?.trackIdsByNode[node.id]
        // A partial bundle means this layer's member was intentionally
        // detached or can no longer be resolved safely. Do not fall back to
        // another same-property track and silently reattach it.
        if (staggerTextTrackBundle && !staggerTrackId) continue
        const staggerTrack = staggerTrackId
          ? api.getTrack(staggerTrackId)
          : null
        const textTrack =
          staggerTrack ??
          (!activeTextStaggerHasMembers
            ? findTextAnimationTrack(
                api,
                node.id,
                selectedTextTrackFilter,
                authorTime,
              ) ??
              (selectedTimelineTrack
                ? findTextAnimationTrackMatchingRange(
                    api,
                    node.id,
                    selectedTimelineTrack,
                  )
                : null)
            : null)
        const base =
          normalizeTextAnimation(
            textTrack?.textAnimation ?? node.textAnimation,
          ) ?? current
        const timingTrack = textTrack ?? selectedTimelineTrack
        const timedBase =
          deriveTextAnimationTiming(base, timingTrack, node.text) ?? base
        const timedConfig = {
          ...timedBase,
          ...next,
          startTime: alignedTextStaggerStart(
            node.id,
            next.startTime ?? timedBase.startTime,
          ),
        }
        api.setNodeProperty(node.id, 'textAnimation', timedConfig)
        let authoredTrackId = textTrack?.id ?? null
        if (
          isTextProgressionOnlyPatch(next) &&
          freshTextStaggerStartTimes == null &&
          textTrack
        ) {
          // The across-segment curve is metadata on the existing semantic
          // progress track. Updating it must not retime or replace S members.
          updateTextAnimationTrackMetadata(
            api,
            node.id,
            timedConfig,
            textTrack.id,
          )
        } else if (
          isTextEasingOnlyPatch(next) &&
          freshTextStaggerStartTimes == null
        ) {
          updateTextAnimationEasing(
            api,
            node.id,
            timedConfig,
            textTrack?.id,
          )
        } else {
          authoredTrackId = stampTextAnimationKeyframes(
            api,
            node.id,
            timedConfig,
            node.text,
            { trackId: textTrack?.id },
          )
        }
        const authoredTrack = authoredTrackId
          ? api.getTrack(authoredTrackId)
          : null
        if (authoredTrack?.propertyId === 'text.progress') {
          staggerMembers.push({
            nodeId: node.id,
            propertyId: 'text.progress',
            keyframeIds: authoredTrack.keyframes.map(
              (keyframe) => keyframe.id,
            ),
          })
        }
      }
      if (
        isTextStaggerActive &&
        activeStaggerSetId &&
        staggerMembers.length > 0
      ) {
        registerStaggerSetKeyframes(
          api,
          {
            setId: activeStaggerSetId,
            layerIds: textTargetPlan.staggerLayerIds,
            delay: textTargetPlan.delay,
            order: textTargetPlan.order,
          },
          staggerMembers,
        )
      }
    }, UNDOABLE_GESTURE_ORIGIN)
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
    if (id === 'number-flow' && !numberFlowEligible) return
    const authorTime = currentAnimationAuthorTime()
    const freshTextStaggerStartTimes =
      freshTextStaggerStartTimesAt(authorTime)
    const alignedTextStaggerStart = (
      nodeId: NodeId,
      fallback: number,
    ): number => freshTextStaggerStartTimes?.[nodeId] ?? fallback
    const applied = new Set<NodeId>()
    const staggerMembers: Array<{
      nodeId: NodeId
      propertyId: 'text.progress'
      keyframeIds: string[]
    }> = []
    api.doc.transact(() => {
      for (const node of selectedTextNodes) {
        if (applied.has(node.id)) continue
        applied.add(node.id)
        const selectedTimelineTrack = findSelectedTimelineTrack(
          api,
          node.id,
          selectedTextTrackFilter,
        )
        const staggerTrackId =
          staggerTextTrackBundle?.trackIdsByNode[node.id]
        if (staggerTextTrackBundle && !staggerTrackId) continue
        const staggerTrack = staggerTrackId
          ? api.getTrack(staggerTrackId)
          : null
        const textTrack =
          staggerTrack ??
          (!activeTextStaggerHasMembers
            ? findTextAnimationTrack(
                api,
                node.id,
                selectedTextTrackFilter,
                authorTime,
              ) ??
              (selectedTimelineTrack
                ? findTextAnimationTrackMatchingRange(
                    api,
                    node.id,
                    selectedTimelineTrack,
                  )
                : null)
            : null)
        const timingTrack = textTrack ?? selectedTimelineTrack
        const fallbackStartTime = timingTrack
          ? trackStartTime(timingTrack)
          : authorTime +
            (isTextStaggerActive
              ? staggerLayerOffset(
                  textTargetPlan.staggerLayerIds,
                  node.id,
                  textTargetPlan.delay,
                  textTargetPlan.order,
                )
              : 0)
        const startTime = alignedTextStaggerStart(
          node.id,
          fallbackStartTime,
        )
        let authoredTrackId: string | null = textTrack?.id ?? null
        if (!textTrack && selectedTimelineTrack) {
          const previous = normalizeTextAnimation(node.textAnimation)
          const defaults = textAnimationDefaults(id)
          const next = normalizeTextAnimation({
            ...defaults,
            ...(previous
              ? {
                  mode: previous.mode,
                  applyTo: previous.applyTo,
                  order: previous.order,
                  delay: previous.delay,
                  smoothing: previous.smoothing,
                  staggerCurve: previous.staggerCurve,
                  easingPresetId: previous.easingPresetId,
                  easingStrength: previous.easingStrength,
                  customEasing: previous.customEasing,
                  motionVector: previous.motionVector,
                  motionPath: previous.motionPath ?? defaults.motionPath,
                }
              : {}),
            startTime,
          }) ?? { ...defaults, startTime }
          const timedConfig = {
            ...(deriveTextAnimationTiming(
              next,
              selectedTimelineTrack,
              node.text,
            ) ?? next),
            startTime,
          }
          api.setNodeProperty(node.id, 'textAnimation', timedConfig)
          authoredTrackId = stampTextAnimationKeyframes(
            api,
            node.id,
            timedConfig,
            node.text,
          )
        } else {
          const appliedConfig = applyTextAnimation(
            api,
            node.id,
            id,
            startTime,
            normalizeTextAnimation(
              textTrack?.textAnimation ?? node.textAnimation,
            ),
            { trackId: textTrack?.id },
          )
          authoredTrackId ??=
            api
              .getTracksForNode(node.id)
              .find(
                (track) =>
                  track.propertyId === 'text.progress' &&
                  Math.abs(
                    (track.textAnimation?.startTime ??
                      trackStartTime(track)) - appliedConfig.startTime,
                  ) <= 0.01,
              )?.id ?? null
        }
        const authoredTrack = authoredTrackId
          ? api.getTrack(authoredTrackId)
          : null
        if (authoredTrack?.propertyId === 'text.progress') {
          staggerMembers.push({
            nodeId: node.id,
            propertyId: 'text.progress',
            keyframeIds: authoredTrack.keyframes.map(
              (keyframe) => keyframe.id,
            ),
          })
        }
      }
      if (
        isTextStaggerActive &&
        activeStaggerSetId &&
        staggerMembers.length > 0
      ) {
        registerStaggerSetKeyframes(
          api,
          {
            setId: activeStaggerSetId,
            layerIds: textTargetPlan.staggerLayerIds,
            delay: textTargetPlan.delay,
            order: textTargetPlan.order,
          },
          staggerMembers,
        )
      }
    }, UNDOABLE_GESTURE_ORIGIN)
    setShowPicker(false)
  }

  if (!current) {
    return (
      <div className="space-y-3" data-timeline-selection-surface="1">
        <div className="rounded-md bg-app-bg p-2.5 shadow-[var(--shadow-control)]">
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
        {showPicker ? (
          <TextPresetPicker
            current={null}
            numberFlowEligible={numberFlowEligible}
            onPick={pickPreset}
          />
        ) : null}
        <div className="rounded-md bg-app-bg p-2.5 shadow-[var(--shadow-control)]">
          <StaggerControls
            on={staggerOn}
            delay={staggerDelay}
            order={activeStaggerSet?.order ?? 'forward'}
            orderEnabled={!!activeStaggerSet}
            onToggle={() => setStaggerOn(!staggerOn)}
            onDelayChange={updateStaggerDelay}
            onOrderChange={updateStaggerOrder}
          />
        </div>
      </div>
    )
  }

  const currentPreset =
    textPresetForConfig(current) ??
    TEXT_ANIMATION_PRESETS[0]!
  const isNumberFlow = current.id === 'number-flow'

  return (
    <div className="space-y-3" data-timeline-selection-surface="1">
      <div className="overflow-hidden rounded-md bg-app-bg shadow-[var(--shadow-control)]">
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
            className="h-7 rounded bg-accent/12 px-3 text-[11px] font-semibold text-accent hover:bg-accent/18"
          >
            Change
          </button>
        </div>
        <div className="border-t border-border p-2.5">
          <SquircleSurface
            radius={6}
            className="hm-control-surface hm-control-compact hm-inspector-segmented"
          >
            {(['in', 'out'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => patch({ mode })}
                className={[
                  'hm-inspector-segment text-[12px] font-semibold',
                  current.mode === mode ? '' : 'text-text-dim',
                ].join(' ')}
                data-active={current.mode === mode}
                aria-pressed={current.mode === mode}
              >
                {mode === 'in' ? 'In' : 'Out'}
              </button>
            ))}
          </SquircleSurface>
        </div>
      </div>

      {showPicker ? (
        <TextPresetPicker
          current={current.id}
          numberFlowEligible={numberFlowEligible}
          onPick={pickPreset}
        />
      ) : null}
      <div className="rounded-md bg-app-bg p-2.5 shadow-[var(--shadow-control)]">
        <StaggerControls
          on={staggerOn}
          delay={staggerDelay}
          order={activeStaggerSet?.order ?? 'forward'}
          orderEnabled={!!activeStaggerSet}
          onToggle={() => setStaggerOn(!staggerOn)}
          onDelayChange={updateStaggerDelay}
          onOrderChange={updateStaggerOrder}
        />
      </div>

      {isNumberFlow ? (
        <ControlCard title="Numbers">
          <ParamRow label="From">
            <NumberField
              value={current.numberFrom}
              onCommit={(numberFrom) => patch({ numberFrom })}
              ariaLabel="Number flow start value"
              width="w-24"
            />
          </ParamRow>
          <ParamRow label="To">
            <input
              aria-label="Number flow target value from Properties text"
              readOnly
              value={formatNumberFlowTarget(primaryNumberFlowTarget)}
              className="hm-control-surface h-7 w-24 px-2 text-right text-[12px] tabular-nums text-text-muted outline-none"
              title="Edit the primary layer's text in Properties to change this value"
            />
          </ParamRow>
          <ParamRow label="Roll direction">
            <SelectField<NumberFlowTrend>
              value={current.numberFlowTrend}
              options={[
                ['auto', 'Auto'],
                ['up', 'Up'],
                ['down', 'Down'],
                ['individual', 'Shortest roll'],
              ]}
              onChange={(numberFlowTrend) => patch({ numberFlowTrend })}
              ariaLabel="Number flow roll direction"
            />
          </ParamRow>
          <ParamRow label="Continuous">
            <CompactSwitch
              checked={current.numberFlowContinuous}
              onChange={(numberFlowContinuous) =>
                patch({ numberFlowContinuous })
              }
              ariaLabel="Pass through intermediate numbers"
            />
          </ParamRow>
          {current.numberFlowContinuous ? (
            <ParamRow label="Count by">
              <NumberField
                value={
                  normalizeNumberFlowIncrementForTargets(
                    current.numberFlowIncrement,
                    numberFlowTargets,
                  ) ?? 0
                }
                onCommit={(value) =>
                  patch({
                    numberFlowIncrement:
                      normalizeNumberFlowIncrementForTargets(
                        value,
                        numberFlowTargets,
                      ),
                  })
                }
                min={0}
                max={1_000_000_000_000_000}
                step={numberFlowIncrementUnit}
                ariaLabel="Number flow count increment"
                width="w-24"
                parseValue={parseNumberFlowIncrement}
                formatValue={formatNumberFlowIncrementEdit}
                formatDisplayValue={formatNumberFlowIncrementDisplay}
              />
            </ParamRow>
          ) : null}
          <p className="px-0.5 text-[10px] leading-4 text-text-dim">
            To and its formatting come from Properties. Auto counts by the
            smallest visible unit; set Count by to skip intermediate values.
          </p>
        </ControlCard>
      ) : null}

      {isNumberFlow ? (
        <ControlCard title="Number motion">
          <ParamRow label="Spin distance">
            <NumberField
              value={Math.round(current.numberFlowSpinDistance * 100)}
              onCommit={(value) =>
                patch({ numberFlowSpinDistance: value / 100 })
              }
              min={25}
              max={200}
              suffix="%"
              width="w-24"
            />
          </ParamRow>
          <ParamRow label="Digit fade">
            <NumberField
              value={Math.round(current.numberFlowFadeAmount * 100)}
              onCommit={(value) =>
                patch({ numberFlowFadeAmount: value / 100 })
              }
              min={0}
              max={100}
              suffix="%"
              width="w-24"
            />
          </ParamRow>
          <ParamRow label="Motion blur">
            <NumberField
              value={current.blurRadius}
              onCommit={(blurRadius) => patch({ blurRadius })}
              min={0}
              max={32}
              suffix="px"
              width="w-24"
            />
          </ParamRow>
          <ParamRow label="Edge mask">
            <NumberField
              value={Math.round(current.numberFlowMaskHeight * 100)}
              onCommit={(value) =>
                patch({ numberFlowMaskHeight: value / 100 })
              }
              min={0}
              max={100}
              suffix="%"
              width="w-24"
            />
          </ParamRow>
          <ParamRow label="Side mask">
            <NumberField
              value={Math.round(current.numberFlowMaskWidth * 100)}
              onCommit={(value) =>
                patch({ numberFlowMaskWidth: value / 100 })
              }
              min={0}
              max={200}
              suffix="%"
              width="w-24"
            />
          </ParamRow>
          <div className="my-2 border-t border-border" />
          <ParamRow label="Transform timing">
            <NumberField
              value={Math.round(
                current.numberFlowTransformTimingRatio * 100,
              )}
              onCommit={(value) =>
                patch({ numberFlowTransformTimingRatio: value / 100 })
              }
              min={5}
              max={100}
              suffix="%"
              width="w-24"
            />
          </ParamRow>
          <ParamRow label="Spin timing">
            <NumberField
              value={Math.round(current.numberFlowSpinTimingRatio * 100)}
              onCommit={(value) =>
                patch({ numberFlowSpinTimingRatio: value / 100 })
              }
              min={5}
              max={100}
              suffix="%"
              width="w-24"
            />
          </ParamRow>
          <ParamRow label="Fade timing">
            <NumberField
              value={Math.round(current.numberFlowOpacityTimingRatio * 100)}
              onCommit={(value) =>
                patch({ numberFlowOpacityTimingRatio: value / 100 })
              }
              min={5}
              max={100}
              suffix="%"
              width="w-24"
            />
          </ParamRow>
          <p className="px-0.5 text-[10px] leading-4 text-text-dim">
            Timing values set how much of the segment each channel uses.
          </p>
        </ControlCard>
      ) : null}

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
        {!isNumberFlow ? (
          <>
        {!current.motionPath ? (
          <ParamRow label="Motion">
            <TextMotionModeToggle
              mode={current.motionVector ? 'xyz' : '2d'}
              onChange={(mode) =>
                patch({
                  motionVector:
                    mode === 'xyz'
                      ? textAnimationUsesLegacyTranslation(current.id)
                        ? legacyTextMotionVector(current)
                        : { x: 0, y: 0, z: 0 }
                      : null,
                })
              }
            />
          </ParamRow>
        ) : null}
        <ParamRow label="Motion path">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                if (!current.motionPath) {
                  textStaggerCurvePreviewStore.cancel()
                  patch({ motionPath: defaultTextMotionPath() })
                  setShowMotionPath(true)
                  return
                }
                setShowMotionPath((open) => !open)
              }}
              aria-expanded={current.motionPath ? showMotionPath : false}
              className={[
                'hm-control-surface flex h-7 min-w-[116px] items-center justify-between gap-2 px-1.5 text-left ring-1 ring-transparent hover:ring-border',
                current.motionPath && showMotionPath ? 'ring-accent/55' : '',
              ].join(' ')}
              title={
                current.motionPath
                  ? 'Edit the shared spatial rail followed by the text'
                  : 'Add an editable spatial rail to this text animation'
              }
            >
              <TextMotionPathMini
                path={current.motionPath ?? defaultTextMotionPath()}
              />
              <span className="text-[10px] text-text-muted">
                {current.motionPath ? 'Edit path' : 'Add'}
              </span>
              <SlidersIcon />
            </button>
            {current.motionPath && current.id !== 'curve-drop' ? (
              <button
                type="button"
                onClick={() => {
                  textStaggerCurvePreviewStore.cancel()
                  patch({ motionPath: null })
                  setShowMotionPath(false)
                }}
                className="hm-control-surface grid h-7 w-7 place-items-center text-[14px] text-text-dim hover:text-text"
                aria-label="Remove text motion path"
                title="Remove path and restore straight motion"
              >
                ×
              </button>
            ) : null}
          </div>
        </ParamRow>
        {current.motionPath && showMotionPath ? (
          <>
            <TextMotionPathEditor
              path={current.motionPath}
              onCommit={(motionPath: TextMotionPath) =>
                patch({ motionPath })
              }
              onReset={() => {
                textStaggerCurvePreviewStore.cancel()
                patch({ motionPath: defaultTextMotionPath() })
              }}
              onPreview={(motionPath) =>
                textStaggerCurvePreviewStore.preview(
                  selectedTextNodes.map((node) => node.id),
                  { motionPath },
                )
              }
              onPreviewFinish={() =>
                textStaggerCurvePreviewStore.finish()
              }
              onPreviewCancel={() =>
                textStaggerCurvePreviewStore.cancel()
              }
            />
            <p className="px-0.5 text-[10px] leading-4 text-text-dim">
              Path shapes one shared rail for the text. Rail pace below
              controls how the complete strip advances along it.
              {current.id !== 'curve-drop'
                ? ' Removing it restores the previous 2D or XYZ motion.'
                : ''}
            </p>
          </>
        ) : null}
        {usesDirection(current.id) &&
        ((!current.motionVector && !current.motionPath) ||
          usesMaskDirection(current.id)) ? (
          <ParamRow
            label={
              usesMaskDirection(current.id)
                ? 'Mask direction'
                : 'Motion direction'
            }
          >
            <DirectionButtons
              value={current.direction}
              onChange={(direction) =>
                patch(textDirectionPatch(current, direction))
              }
            />
          </ParamRow>
        ) : null}
        {usesTravel(current.id) && !current.motionVector && !current.motionPath ? (
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
        {current.motionPath ? (
          <div
            className="space-y-1.5"
            title="Set the fully displaced XYZ position. Editing the distance preserves the path's authored curve."
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] text-text-dim">Travel distance</span>
              <span className="text-[9px] text-text-dim">
                XYZ · hidden endpoint
              </span>
            </div>
            <MotionVectorFields
              value={textMotionPathDistance(current.motionPath)}
              onChange={(distance) =>
                patch({
                  motionPath: setTextMotionPathDistance(
                    current.motionPath,
                    distance,
                  ),
                })
              }
            />
          </div>
        ) : current.motionVector ? (
          <MotionVectorFields
            value={current.motionVector}
            onChange={(motionVector) => patch({ motionVector })}
          />
        ) : null}
          </>
        ) : null}
        <ParamRow label="Segment duration">
          <TimeField
            value={Math.round(current.duration * 1000)}
            onCommit={(ms) => patch({ duration: ms / 1000 })}
            min={50}
            valueUnit="milliseconds"
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
        <ParamRow label="Time easing">
          <div className="grid max-w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-1">
            <input
              value={visibleEasingDraft}
              onChange={(e) => updateEasingText(e.currentTarget.value)}
              className="hm-control-surface h-7 min-w-0 px-2 font-mono text-[11px] text-text outline-none ring-1 ring-transparent hover:ring-border focus:ring-2 focus:ring-accent/45"
              title="Comma-separated cubic bezier values"
            />
            <button
              type="button"
              onClick={copyEasing}
              className="hm-control-surface h-7 px-2 text-[11px] text-text-muted hover:text-text"
              title="Copy easing values"
            >
              {copiedEasing ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              onClick={() => setShowEasing((v) => !v)}
              aria-pressed={showEasing}
              className={[
                'hm-control-surface grid h-7 w-7 place-items-center text-text-muted hover:text-text',
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
              easingValue={
                current.easingPresetId === 'custom'
                  ? current.customEasing
                  : undefined
              }
              onChange={({ presetId, strength, easing }) =>
                patch({
                  easingPresetId: presetId,
                  easingStrength: strength,
                  customEasing:
                    presetId === 'custom' ? easing : undefined,
                })
              }
            />
            <GraphEditor />
          </>
        ) : null}
      </ControlCard>

      {!isNumberFlow ? (
        <ControlCard title="Text">
        <ParamRow label="Apply effect to">
          <SelectField<TextAnimationApplyTo>
            ariaLabel="Apply text animation to"
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
        <ParamRow label={textOrderLabel(current.applyTo)}>
          <SelectField<TextAnimationOrder>
            ariaLabel={textOrderLabel(current.applyTo)}
            value={current.order}
            options={[
              ['forward', 'Forward'],
              ['backward', 'Reverse'],
            ]}
            onChange={(order) => patch({ order })}
          />
        </ParamRow>
        {current.applyTo !== 'layer' ? (
          <>
            <ParamRow label="Step delay">
              <TextSegmentDelayField
                value={current.delay}
                onChange={(delay) => patch({ delay })}
                unit={textSegmentUnit(current.applyTo)}
              />
            </ParamRow>
            <ParamRow label="Trail length">
              {current.delay > 0 ? (
                <TextTrailLengthField
                  duration={current.duration}
                  delay={current.delay}
                  unit={textSegmentUnit(current.applyTo)}
                  nodeIds={selectedTextNodes.map((node) => node.id)}
                  onChange={(duration) => patch({ duration })}
                />
              ) : (
                <span
                  className="text-[10px] text-text-dim"
                  title="Set Step delay above zero to create a traveling trail"
                >
                  Set delay
                </span>
              )}
            </ParamRow>
            <ParamRow label={current.motionPath ? 'Rail pace' : 'Trail profile'}>
              <button
                type="button"
                onClick={() => setShowStaggerCurve((open) => !open)}
                aria-expanded={showStaggerCurve}
                className={[
                  'hm-control-surface flex h-7 min-w-[116px] items-center justify-between gap-2 px-1.5 text-left ring-1 ring-transparent hover:ring-border',
                  showStaggerCurve ? 'ring-stagger-ring' : '',
                ].join(' ')}
                title={
                  current.motionPath
                    ? 'Shape how the complete text strip advances along its rail'
                    : 'Shape the bend shared by simultaneous text segments'
                }
              >
                <StaggerCurveMini
                  curve={
                    current.staggerCurve ?? textStaggerCurveForPreset('none')
                  }
                />
                <span className="text-[10px] text-text-muted">
                  {current.staggerCurve ? 'Custom' : 'Linear'}
                </span>
                <SlidersIcon />
              </button>
            </ParamRow>
            {showStaggerCurve ? (
              <>
                <StaggerCurveEditor
                  curve={
                    current.staggerCurve ?? textStaggerCurveForPreset('none')
                  }
                  onCommit={(staggerCurve: TextStaggerCurve) =>
                    patch({ staggerCurve })
                  }
                  onReset={() => {
                    textStaggerCurvePreviewStore.cancel()
                    patch({ staggerCurve: null })
                  }}
                  onPreview={(staggerCurve) =>
                    textStaggerCurvePreviewStore.preview(
                    selectedTextNodes.map((node) => node.id),
                    { curve: staggerCurve },
                  )
                  }
                  onPreviewFinish={() =>
                    textStaggerCurvePreviewStore.finish()
                  }
                  onPreviewCancel={() =>
                    textStaggerCurvePreviewStore.cancel()
                  }
                />
                <div className="mt-2 rounded bg-panel px-2 py-1.5">
                  <ParamRow label="Sample blending">
                    <SelectField<TextAnimationSmoothing>
                      ariaLabel="Trail profile sample blending"
                      value={current.smoothing}
                      options={[
                        ['none', 'None'],
                        ['soft', 'Soft'],
                        ['smooth', 'Wide'],
                      ]}
                      onChange={(smoothing) => patch({ smoothing })}
                    />
                  </ParamRow>
                </div>
              </>
            ) : null}
          </>
        ) : null}
        </ControlCard>
      ) : null}
    </div>
  )
}

function TextPresetPicker({
  current,
  numberFlowEligible,
  onPick,
}: {
  current: TextAnimationId | null
  numberFlowEligible: boolean
  onPick: (id: TextAnimationId) => void
}) {
  const categories = Array.from(new Set(TEXT_ANIMATION_PRESETS.map((p) => p.category)))
  return (
    <div className="max-h-[420px] overflow-auto border-b border-border bg-panel-raised p-3">
      {categories.map((category) => (
        <div key={category} className="mb-5 last:mb-0">
          <div className="mb-2 text-[15px] font-bold text-text">{category}</div>
          <div className="grid grid-cols-2 gap-2">
            {TEXT_ANIMATION_PRESETS.filter((p) => p.category === category).map(
              (preset) => {
                const unavailable =
                  preset.id === 'number-flow' && !numberFlowEligible
                return (
                  <button
                    key={preset.id}
                    type="button"
                    disabled={unavailable}
                    data-preview-on={unavailable ? undefined : '1'}
                    onClick={() => onPick(preset.id)}
                    className={[
                      'group flex flex-col gap-1.5 rounded-md border border-border-strong/60 bg-panel-raised p-1.5 text-left transition-colors',
                      unavailable
                        ? 'cursor-not-allowed opacity-45'
                        : 'hover:border-border-strong hover:bg-panel',
                    ].join(' ')}
                    title={
                      unavailable
                        ? 'Number Flow requires exactly one number in every selected text layer.'
                        : `Apply ${preset.label}`
                    }
                  >
                    <TextAnimationCardPreview
                      preset={preset}
                      selected={current === preset.id}
                      unavailable={unavailable}
                    />
                  </button>
                )
              },
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function TextAnimationCardPreview({
  preset,
  selected = false,
  unavailable = false,
}: {
  preset: (typeof TEXT_ANIMATION_PRESETS)[number]
  selected?: boolean
  unavailable?: boolean
}) {
  return (
    <>
      <div
        className={[
          'hm-text-preset-stage h-14 w-full rounded-[5px] bg-panel',
          selected ? 'ring-1 ring-accent/65' : '',
        ].join(' ')}
      >
        {preset.id === 'number-flow' ? (
          <span className="flex items-baseline gap-1.5 text-[18px] font-semibold tabular-nums text-text">
            <span className="text-text-dim">0</span>
            <span className="text-[10px] font-medium text-text-dim">→</span>
            <span>128</span>
          </span>
        ) : (
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
        )}
        {unavailable ? (
          <span className="absolute bottom-1 rounded bg-panel-raised/90 px-1.5 py-0.5 text-[8px] font-medium text-text-dim">
            One number per layer
          </span>
        ) : null}
      </div>
      <span className="block px-1 pt-1 pb-0.5 text-[11px] text-text">
        {preset.label}
      </span>
    </>
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
      {preset.id === 'number-flow' ? (
        <span className="flex items-baseline gap-1 text-[16px] font-semibold tabular-nums text-text">
          <span className="text-text-dim">0</span>
          <span className="text-[9px] font-medium text-text-dim">→</span>
          <span>128</span>
        </span>
      ) : (
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
      )}
    </div>
  )
}

function formatNumberFlowTarget(
  target: ReturnType<typeof parseNumberFlowText>,
): string {
  if (!target) return '—'
  return new Intl.NumberFormat('en-US', {
    useGrouping: target.useGrouping,
    minimumFractionDigits: target.decimals,
    maximumFractionDigits: target.decimals,
  }).format(target.value)
}

function parseNumberFlowIncrement(draft: string): number | null {
  const trimmed = draft.trim()
  if (trimmed === '' || trimmed.toLowerCase() === 'auto') return 0
  return parseNumericExpression(draft)
}

function formatNumberFlowIncrementEdit(value: number): string {
  return value <= 0 ? '' : formatNumericValue(value)
}

function formatNumberFlowIncrementDisplay(value: number): string {
  return value <= 0 ? 'Auto' : formatNumericDisplayValue(value)
}

function textApplyLabel(value: TextAnimationApplyTo): string {
  if (value === 'letters') return 'Letters'
  if (value === 'words') return 'Words'
  if (value === 'lines') return 'Lines'
  return 'Layer'
}

function textOrderLabel(value: TextAnimationApplyTo): string {
  if (value === 'letters') return 'Letter order'
  if (value === 'words') return 'Word order'
  if (value === 'lines') return 'Line order'
  return 'Layer order'
}

function textSegmentUnit(value: TextAnimationApplyTo): string {
  if (value === 'words') return 'words'
  if (value === 'lines') return 'lines'
  return 'letters'
}

function roundedTrailLength(duration: number, delay: number): number {
  if (delay <= 0) return 0
  return Math.round((duration / delay) * 10) / 10
}

function ControlCard({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="border-t border-border pt-4 first:border-t-0 first:pt-0">
      <div className="mb-2 flex h-6 items-center text-[13px] font-semibold text-text">
        {title}
      </div>
      <div className="space-y-1.5">{children}</div>
    </section>
  )
}

function ParamRow({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return <FieldRow label={label}>{children}</FieldRow>
}

function SelectField<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T
  options: Array<[T, string]>
  onChange: (next: T) => void
  ariaLabel: string
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.currentTarget.value as T)}
      className="hm-control-surface h-7 w-full px-2 text-[12px] text-text outline-none"
    >
      {options.map(([id, label]) => (
        <option key={id} value={id}>
          {label}
        </option>
      ))}
    </select>
  )
}

function CompactSwitch({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  ariaLabel: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={ariaLabel}
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={[
        'relative h-5 w-9 shrink-0 rounded-full border transition-colors',
        checked
          ? 'border-accent bg-accent'
          : 'border-border-strong bg-panel',
      ].join(' ')}
    >
      <span
        className={[
          'absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.25)] transition-[left]',
          checked ? 'left-[18px]' : 'left-[2px]',
        ].join(' ')}
      />
    </button>
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
    <SquircleSurface
      radius={6}
      className="hm-control-surface hm-control-compact hm-inspector-segmented"
    >
      {buttons.map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          aria-pressed={value === id}
          data-active={value === id}
          className="hm-inspector-segment text-[15px]"
        >
          {label}
        </button>
      ))}
    </SquircleSurface>
  )
}

function TextMotionModeToggle({
  mode,
  onChange,
}: {
  mode: '2d' | 'xyz'
  onChange: (next: '2d' | 'xyz') => void
}) {
  return (
    <SquircleSurface
      radius={6}
      role="group"
      className="hm-control-surface hm-control-compact hm-inspector-segmented"
      aria-label="Text motion dimensions"
      title="XYZ offsets: +X right, +Y down, +Z toward the viewer"
    >
      {(['2d', 'xyz'] as const).map((id) => (
        <button
          key={id}
          type="button"
          aria-pressed={mode === id}
          onClick={() => onChange(id)}
          data-active={mode === id}
          className="hm-inspector-segment"
        >
          {id === '2d' ? '2D' : 'XYZ'}
        </button>
      ))}
    </SquircleSurface>
  )
}

function MotionVectorFields({
  value,
  onChange,
}: {
  value: TextAnimationMotionVector
  onChange: (next: TextAnimationMotionVector) => void
}) {
  const axes = ['x', 'y', 'z'] as const
  const [scrubPreview, setScrubPreview] =
    useState<TextAnimationMotionVector | null>(null)
  const displayed = scrubPreview ?? value
  return (
    <div
      role="group"
      aria-label="Text motion vector"
      title="Offsets use line-height units: +X right, +Y down, +Z toward the viewer"
      className="grid grid-cols-3 gap-1.5"
    >
      {axes.map((axis) => (
        <div key={axis} className="grid min-w-0 gap-1">
          <span className="text-[10px] font-semibold text-text-dim uppercase">
            {axis}
          </span>
          <NumberField
            value={Math.round(displayed[axis] * 100)}
            onCommit={(percent) => {
              setScrubPreview(null)
              onChange({ ...value, [axis]: percent / 100 })
            }}
            onScrubPreview={(percent) =>
              setScrubPreview({ ...displayed, [axis]: percent / 100 })
            }
            onScrubCommit={(percent) => {
              const next = {
                ...(scrubPreview ?? value),
                [axis]: percent / 100,
              }
              setScrubPreview(null)
              onChange(next)
            }}
            onScrubCancel={() => setScrubPreview(null)}
            min={-1000}
            max={1000}
            suffix="%"
            ariaLabel={`Text motion ${axis.toUpperCase()}`}
            width="w-full"
          />
        </div>
      ))}
    </div>
  )
}

function TextSegmentDelayField({
  value,
  onChange,
  unit,
}: {
  value: number
  onChange: (next: number) => void
  unit: string
}) {
  const [scrubPreview, setScrubPreview] = useState<number | null>(null)
  const displayed = scrubPreview ?? value
  return (
    <div title={`Time for the moving bend to advance one of the ${unit}`}>
      <TimeField
        value={Math.round(displayed * 1000)}
        onCommit={(milliseconds) => {
          setScrubPreview(null)
          onChange(milliseconds / 1000)
        }}
        onScrubPreview={(milliseconds) =>
          setScrubPreview(milliseconds / 1000)
        }
        onScrubCommit={(milliseconds) => {
          setScrubPreview(null)
          onChange(milliseconds / 1000)
        }}
        onScrubCancel={() => setScrubPreview(null)}
        min={0}
        max={1000}
        step={10}
        valueUnit="milliseconds"
        ariaLabel={`Step delay between ${unit}`}
        width="w-24"
      />
    </div>
  )
}

function TextTrailLengthField({
  duration,
  delay,
  unit,
  nodeIds,
  onChange,
}: {
  duration: number
  delay: number
  unit: string
  nodeIds: NodeId[]
  onChange: (duration: number) => void
}) {
  const [scrubPreview, setScrubPreview] = useState<number | null>(null)
  const authoredLength = roundedTrailLength(duration, delay)
  const displayedLength = scrubPreview ?? authoredLength
  const durationForLength = (length: number) =>
    Math.max(0.05, delay * length)

  return (
    <div title={`How many ${unit} share the moving bend at once`}>
      <NumberField
        value={displayedLength}
        onCommit={(length) => {
          setScrubPreview(null)
          textStaggerCurvePreviewStore.cancel()
          onChange(durationForLength(length))
        }}
        onScrubPreview={(length) => {
          setScrubPreview(length)
          textStaggerCurvePreviewStore.preview(nodeIds, {
            duration: durationForLength(length),
          })
        }}
        onScrubCommit={(length) => {
          setScrubPreview(null)
          onChange(durationForLength(length))
          textStaggerCurvePreviewStore.finish()
        }}
        onScrubCancel={() => {
          setScrubPreview(null)
          textStaggerCurvePreviewStore.cancel()
        }}
        min={0.25}
        max={64}
        step={0.1}
        suffix={unit}
        ariaLabel="Number of text segments sharing the moving trail"
        width="w-28"
      />
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
      className="hm-control-surface h-7 w-48 max-w-full px-2 font-mono text-[11px] text-text outline-none ring-1 ring-transparent hover:ring-border focus:ring-2 focus:ring-accent/45"
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

function usesMaskDirection(id: TextAnimationId): boolean {
  return id === 'mask-up' || id === 'mask-down'
}

/** Preserve the legacy effect's visual offset when opting into XYZ mode. */
function legacyTextMotionVector(
  config: Pick<TextAnimationConfig, 'direction' | 'travelDistance'>,
): TextAnimationMotionVector {
  const distance = config.travelDistance
  switch (config.direction) {
    case 'down':
      return { x: 0, y: -distance, z: 0 }
    case 'left':
      return { x: distance, y: 0, z: 0 }
    case 'right':
      return { x: -distance, y: 0, z: 0 }
    case 'up':
    default:
      return { x: 0, y: distance, z: 0 }
  }
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

function isTextProgressionOnlyPatch(
  patch: Partial<TextAnimationConfig>,
): boolean {
  const keys = Object.keys(patch)
  return (
    keys.length > 0 &&
    keys.every(
      (key) =>
        key === 'smoothing' ||
        key === 'staggerCurve' ||
        key === 'motionPath',
    )
  )
}

function timelineTrackFilter(
  selectedTrackIds: string[],
  selectedKeyframes: string[],
): ReadonlySet<string> | undefined {
  const ids = new Set<string>()
  if (selectedKeyframes.length > 0) {
    for (const key of selectedKeyframes) {
      const colon = key.indexOf(':')
      if (colon > 0) ids.add(key.slice(0, colon))
    }
  } else {
    for (const id of selectedTrackIds) ids.add(id)
  }
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
  return selectTextAnimationTrackForAuthoring(
    listTracksForNode(api, nodeId),
    trackFilter,
    playhead,
  )
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
    <SquircleSurface
      radius={6}
      className="hm-control-surface hm-control-compact hm-inspector-segmented"
    >
      {([
        ['in', `In (${inCount})`],
        ['out', `Out (${outCount})`],
      ] as const).map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          aria-pressed={value === id}
          data-active={value === id}
          className="hm-inspector-segment"
        >
          {label}
        </button>
      ))}
    </SquircleSurface>
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
    <div className="rounded-md bg-app-bg p-2.5 shadow-[var(--shadow-control)]">
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
 * Whole-layer stagger toggle + delay input. This is deliberately named
 * separately from the within-text stagger curve shown in the Text card.
 */
function StaggerControls({
  on,
  delay,
  order,
  orderEnabled,
  onToggle,
  onDelayChange,
  onOrderChange,
}: {
  on: boolean
  delay: number
  order: 'forward' | 'reverse'
  orderEnabled: boolean
  onToggle: () => void
  onDelayChange: (next: number) => void
  onOrderChange: (next: 'forward' | 'reverse') => void
}) {
  const orderDisabled = !on || !orderEnabled
  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="text-[12px] font-medium text-text-muted">
          Layer stagger
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
          Layer delay
        </label>
        <div>
          <TimeField
            value={delay}
            onCommit={onDelayChange}
            onScrubPreview={() => {}}
            onScrubCommit={onDelayChange}
            min={0}
            step={0.05}
            ariaLabel="Layer stagger delay"
            disabled={!on}
            width="w-16"
          />
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span
          className={[
            'text-[11px]',
            orderDisabled ? 'text-text-dim' : 'text-text-muted',
          ].join(' ')}
        >
          Layer order
        </span>
        <SquircleSurface
          radius={6}
          role="group"
          aria-label="Layer stagger order"
          className={[
            'hm-control-surface hm-control-compact hm-inspector-segmented',
            orderDisabled ? 'opacity-50' : '',
          ].join(' ')}
          title={
            orderEnabled
              ? 'Choose which layer starts first'
              : 'Add a staggered animation before changing its order'
          }
        >
          {([
            ['forward', 'Forward'],
            ['reverse', 'Reverse'],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={order === value}
              disabled={orderDisabled}
              onClick={() => onOrderChange(value)}
              data-active={order === value}
              className={[
                'hm-inspector-segment',
                orderDisabled ? 'cursor-not-allowed' : '',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </SquircleSurface>
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

function describeTimingSelection(summary: EasingSelectionSummary): string {
  const transitions = `${summary.eligibleSegmentCount} outgoing ${
    summary.eligibleSegmentCount === 1 ? 'transition' : 'transitions'
  }`
  const skipped = [
    summary.skippedEndpointCount > 0
      ? `${summary.skippedEndpointCount} ${
          summary.skippedEndpointCount === 1 ? 'endpoint' : 'endpoints'
        } skipped`
      : '',
    summary.skippedDiscreteCount > 0
      ? `${summary.skippedDiscreteCount} step-only skipped`
      : '',
  ].filter(Boolean)
  const suffix = skipped.length > 0 ? ` · ${skipped.join(' · ')}` : ''

  if (summary.scope === 'keyframes') {
    return `${summary.requestedKeyframeCount} selected ${
      summary.requestedKeyframeCount === 1 ? 'keyframe' : 'keyframes'
    } · ${transitions}${suffix}`
  }
  if (summary.scope === 'tracks') {
    return `${summary.selectedTrackCount} selected ${
      summary.selectedTrackCount === 1 ? 'track' : 'tracks'
    } · ${transitions}${suffix}`
  }
  return `${summary.selectedLayerCount} ${
    summary.selectedLayerCount === 1 ? 'layer' : 'layers'
  } · ${transitions}${suffix}`
}

function presetIdForLegacyEasing(
  easing: EasingKind,
): EasingPresetId {
  if (easing === 'linear') return 'none'
  if (easing === 'ease-in') return 'accelerate'
  if (easing === 'ease-out') return 'slow-down'
  if (easing === 'ease-in-out') return 'smooth'
  return 'custom'
}
