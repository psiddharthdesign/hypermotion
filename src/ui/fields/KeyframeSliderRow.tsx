// SPDX-License-Identifier: Apache-2.0

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { NumberField } from './NumberField'
import { FieldRow } from './FieldRow'
import { SquircleSurface } from './SquircleSurface'
import {
  createSliderFrameQueue,
  hasBoundedSliderDomain,
  resolveSliderDomain,
  sliderFillPercent,
  sliderValueFromPointer,
  type SliderFrameQueue,
  type SliderDomain,
} from './keyframeSlider'

const SLIDER_TICKS = Array.from({ length: 9 }, (_, index) => index + 1)

/**
 * A bounded numeric property presented as one compact authoring strip:
 * slider + editable value + keyframe action. It intentionally owns its
 * full row instead of nesting inside FieldRow because the label belongs in
 * the slider well for this alternate, range-specific grammar. Properties
 * without both hard bounds fall back to the Inspector's ordinary FieldRow +
 * NumberField grammar unless the caller supplies a separate, non-validating
 * interaction range for a spatial adjustment such as padding or gap.
 */
export function KeyframeSliderRow({
  label,
  value,
  onCommit,
  min,
  max,
  sliderMin,
  sliderMax,
  step = 1,
  suffix,
  keyframe,
  adaptiveSpan,
  mixed = false,
  disabled = false,
  labelAccessory,
  onScrubPreview,
  onScrubCommit,
  onScrubCancel,
}: {
  label: string
  value: number
  onCommit: (next: number) => void
  /** Hard numeric constraints. Both also define the track when no soft range is supplied. */
  min?: number
  max?: number
  /**
   * Optional display-only track bounds for values such as spacing. These
   * create a useful slider range without turning the track maximum into a
   * validation limit for the editable numeric value.
   */
  sliderMin?: number
  sliderMax?: number
  step?: number
  suffix?: string
  keyframe?: ReactNode
  /** Legacy call-site hint. Unbounded properties now render NumberField. */
  adaptiveSpan?: number
  /** Multi-selection values differ. Dragging normalizes the selection. */
  mixed?: boolean
  disabled?: boolean
  /** Small in-track action such as the scale-link toggle. */
  labelAccessory?: ReactNode
  onScrubPreview?: (next: number) => void
  onScrubCommit?: (next: number) => void
  onScrubCancel?: () => void
}) {
  const rangeMin = sliderMin ?? min
  const rangeMax = sliderMax ?? max
  const bounded = hasBoundedSliderDomain(rangeMin, rangeMax)
  const initialDomain = resolveSliderDomain({
    value,
    min: rangeMin,
    max: rangeMax,
    step,
    adaptiveSpan,
  })
  const [domain, setDomain] = useState<SliderDomain>(initialDomain)
  const [sliderValue, setSliderValue] = useState(value)
  const [pointerActive, setPointerActive] = useState(false)
  const [pointerHovered, setPointerHovered] = useState(false)
  const [mixedEditing, setMixedEditing] = useState(false)
  const pointerActiveRef = useRef(false)
  const latestSliderValueRef = useRef(value)
  const frameQueueRef = useRef<SliderFrameQueue | null>(null)
  const scrubCancelRef = useRef(onScrubCancel)
  const gestureRef = useRef<{
    pointerId: number
    rect: { left: number; width: number }
    startValue: number
    changed: boolean
    deferredCommit: boolean
  } | null>(null)
  const sliderInputRef = useRef<HTMLInputElement>(null)
  const valueSlotRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (pointerActiveRef.current) return
    setDomain(
      resolveSliderDomain({
        value,
        min: rangeMin,
        max: rangeMax,
        step,
        adaptiveSpan,
      }),
    )
  }, [adaptiveSpan, rangeMax, rangeMin, step, value])

  useEffect(() => {
    scrubCancelRef.current = onScrubCancel
  }, [onScrubCancel])

  useEffect(
    () => () => {
      frameQueueRef.current?.cancel()
      frameQueueRef.current = null
      if (pointerActiveRef.current) scrubCancelRef.current?.()
      pointerActiveRef.current = false
      gestureRef.current = null
    },
    [],
  )

  const queueSliderValue = (next: number) => {
    if (Object.is(next, latestSliderValueRef.current)) return
    latestSliderValueRef.current = next
    if (gestureRef.current) gestureRef.current.changed = true
    frameQueueRef.current?.queue(next)
  }

  const valueAtClientX = (
    clientX: number,
    rect: { left: number; width: number },
  ): number => {
    return sliderValueFromPointer({
      clientX,
      left: rect.left,
      width: rect.width,
      min: domain.min,
      max: domain.max,
    })
  }

  const beginSliderGesture = (event: React.PointerEvent<HTMLDivElement>) => {
    if (
      disabled ||
      event.button !== 0 ||
      (event.target as HTMLElement).closest(
        '[data-keyframe-slider-accessory="1"]',
      )
    ) {
      return
    }
    event.preventDefault()
    if (pointerActiveRef.current) return
    if (mixed) setMixedEditing(true)
    const hostRect = event.currentTarget.getBoundingClientRect()
    const rect = { left: hostRect.left, width: hostRect.width }
    pointerActiveRef.current = true
    setPointerActive(true)
    latestSliderValueRef.current = value
    setSliderValue(value)
    gestureRef.current = {
      pointerId: event.pointerId,
      rect,
      startValue: value,
      changed: false,
      deferredCommit: Boolean(onScrubPreview),
    }
    frameQueueRef.current?.cancel()
    frameQueueRef.current = createSliderFrameQueue(
      (next) => {
        setSliderValue(next)
        // Specialized transient lanes avoid scene-document writes. Callers
        // without one still update live at display cadence instead of only
        // after pointer-up (or at raw hardware packet frequency).
        ;(onScrubPreview ?? onCommit)(next)
      },
      window.requestAnimationFrame.bind(window),
      window.cancelAnimationFrame.bind(window),
    )
    sliderInputRef.current?.focus({ preventScroll: true })
    event.currentTarget.setPointerCapture(event.pointerId)
    queueSliderValue(valueAtClientX(event.clientX, rect))
  }

  const finishSliderGesture = (cancelled: boolean) => {
    const gesture = gestureRef.current
    if (!pointerActiveRef.current || !gesture) return
    pointerActiveRef.current = false
    gestureRef.current = null
    setPointerActive(false)
    if (cancelled) {
      frameQueueRef.current?.cancel()
      frameQueueRef.current = null
      onScrubCancel?.()
      latestSliderValueRef.current = gesture.startValue
      setSliderValue(gesture.startValue)
      setDomain(
        resolveSliderDomain({
          value: gesture.startValue,
          min: rangeMin,
          max: rangeMax,
          step,
          adaptiveSpan,
        }),
      )
      if (mixed) setMixedEditing(false)
      return
    }

    // Release must include the newest hardware packet even when it arrived
    // after the last animation frame. Transient-preview callers then persist
    // exactly once; the generic live fallback has already persisted the flush.
    frameQueueRef.current?.flush()
    frameQueueRef.current = null
    const finalValue = latestSliderValueRef.current
    if ((gesture.changed || mixed) && gesture.deferredCommit) {
      ;(onScrubCommit ?? onCommit)(finalValue)
    }
    setSliderValue(finalValue)
    setDomain(
      resolveSliderDomain({
        value: finalValue,
        min: rangeMin,
        max: rangeMax,
        step,
        adaptiveSpan,
      }),
    )
    if (mixed) setMixedEditing(false)
  }

  const onSliderPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current
    if (!gesture || event.pointerId !== gesture.pointerId) return
    finishSliderGesture(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const visibleSliderValue = Math.max(
    domain.min,
    Math.min(domain.max, pointerActive ? sliderValue : value),
  )
  const fillPercent = sliderFillPercent(
    visibleSliderValue,
    domain.min,
    domain.max,
  )
  const rulerVisible = !disabled && (pointerHovered || pointerActive)

  const commitKeyboardSliderValue = (next: number) => {
    const clamped = Math.max(domain.min, Math.min(domain.max, next))
    const stable = Number(clamped.toFixed(10))
    latestSliderValueRef.current = stable
    setSliderValue(stable)
    onCommit(stable)
    if (mixed) setMixedEditing(false)
  }

  if (!bounded) {
    return (
      <FieldRow label={label} keyframe={keyframe}>
        <div
          ref={valueSlotRef}
          className="flex min-w-0 flex-1 items-center gap-1.5"
        >
          <div className="min-w-0 flex-1">
            {mixed && !mixedEditing ? (
              <SquircleSurface
                as="button"
                radius={6}
                type="button"
                title={`Values differ. Set one ${label.toLowerCase()} value.`}
                className="hm-control-surface hm-control-compact h-7 w-full px-2 text-[10px] font-medium text-accent"
                onClick={() => {
                  setMixedEditing(true)
                  window.requestAnimationFrame(() => {
                    valueSlotRef.current?.querySelector('input')?.focus()
                  })
                }}
              >
                Mixed
              </SquircleSurface>
            ) : (
              <NumberField
                value={value}
                onCommit={(next) => {
                  onCommit(next)
                  if (mixed) setMixedEditing(false)
                }}
                onScrubPreview={onScrubPreview}
                onScrubCommit={onScrubCommit}
                onScrubCancel={onScrubCancel}
                min={min}
                max={max}
                step={step}
                suffix={suffix}
                ariaLabel={label}
                disabled={disabled}
                width="w-full"
              />
            )}
          </div>
          {labelAccessory ? (
            <div
              data-keyframe-number-accessory="1"
              className="flex h-7 w-7 shrink-0 items-center justify-center"
            >
              {labelAccessory}
            </div>
          ) : null}
        </div>
      </FieldRow>
    )
  }

  return (
    <div
      data-inspector-slider-row="1"
      className={[
        'grid h-7 min-w-0 items-center',
        keyframe
          ? 'grid-cols-[minmax(0,1fr)_56px_28px] gap-x-1.5'
          : 'grid-cols-[minmax(0,1fr)_63px] gap-x-2.5',
      ].join(' ')}
    >
      <SquircleSurface
        radius={8}
        data-keyframe-slider-surface="1"
        className={[
          'hm-control-surface relative h-7 min-w-0 touch-none select-none overflow-hidden',
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-ew-resize',
        ].join(' ')}
        onPointerEnter={() => setPointerHovered(true)}
        onPointerLeave={() => setPointerHovered(false)}
        onPointerDown={beginSliderGesture}
        onPointerMove={(event) => {
          const gesture = gestureRef.current
          if (
            !pointerActiveRef.current ||
            !gesture ||
            event.pointerId !== gesture.pointerId
          ) {
            return
          }
          event.preventDefault()
          queueSliderValue(valueAtClientX(event.clientX, gesture.rect))
        }}
        onPointerUp={onSliderPointerUp}
        onPointerCancel={(event) => {
          if (gestureRef.current?.pointerId !== event.pointerId) return
          finishSliderGesture(true)
        }}
        onLostPointerCapture={(event) => {
          if (gestureRef.current?.pointerId !== event.pointerId) return
          finishSliderGesture(true)
        }}
      >
        <span
          aria-hidden="true"
          data-active={pointerActive ? 'true' : 'false'}
          className="hm-keyframe-slider-fill pointer-events-none absolute inset-y-0 left-0 right-0 origin-left"
          style={{ transform: `scaleX(${fillPercent / 100})` }}
        />
        <span
          aria-hidden="true"
          data-keyframe-slider-ruler="1"
          data-visible={rulerVisible ? 'true' : 'false'}
          className={[
            'pointer-events-none absolute inset-0 z-10 transition-opacity duration-75',
            rulerVisible ? 'opacity-100' : 'opacity-0',
          ].join(' ')}
        >
          {SLIDER_TICKS.map((tick) => (
            <span
              key={tick}
              className="absolute top-2 h-3 w-px rounded-full bg-border-strong/70"
              style={{ left: `${tick * 10}%` }}
            />
          ))}
          <span
            data-keyframe-slider-indicator="1"
            className="absolute top-[5px] h-[18px] w-[3px] -translate-x-1/2 rounded-full bg-text-dim"
            style={{ left: `${fillPercent}%` }}
          />
        </span>
        <span
          className={[
            'pointer-events-none relative z-20 flex h-full items-center truncate pl-3 text-[11.5px] font-medium text-text-muted',
            labelAccessory ? 'pr-8' : 'pr-2',
          ].join(' ')}
        >
          {label}
        </span>
        <input
          ref={sliderInputRef}
          type="range"
          min={domain.min}
          max={domain.max}
          step="any"
          value={visibleSliderValue}
          aria-label={`${label} slider`}
          disabled={disabled}
          className="pointer-events-none absolute inset-0 z-20 h-full w-full appearance-none opacity-0"
          onKeyDown={(event) => {
            const direction =
              event.key === 'ArrowRight' || event.key === 'ArrowUp'
                ? 1
                : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
                  ? -1
                  : 0
            if (direction !== 0) {
              event.preventDefault()
              const multiplier = event.shiftKey ? 10 : event.altKey ? 0.1 : 1
              const keyboardStep = Math.max(Math.abs(step), 0.0001)
              commitKeyboardSliderValue(
                visibleSliderValue + direction * keyboardStep * multiplier,
              )
            } else if (event.key === 'Home') {
              event.preventDefault()
              commitKeyboardSliderValue(domain.min)
            } else if (event.key === 'End') {
              event.preventDefault()
              commitKeyboardSliderValue(domain.max)
            }
          }}
          onChange={(event) => {
            const next = Number(event.currentTarget.value)
            setSliderValue(next)
            latestSliderValueRef.current = next
            if (!pointerActiveRef.current) {
              onCommit(next)
              if (mixed) setMixedEditing(false)
            }
          }}
        />
        {labelAccessory ? (
          <div
            data-keyframe-slider-accessory="1"
            className="absolute inset-y-0 right-1 z-30 flex items-center"
          >
            {labelAccessory}
          </div>
        ) : null}
      </SquircleSurface>
      <div ref={valueSlotRef} className="relative min-w-0">
        {mixed && !mixedEditing ? (
          <SquircleSurface
            as="button"
            radius={6}
            type="button"
            title={`Values differ. Set one ${label.toLowerCase()} value.`}
            className="hm-control-surface hm-control-compact h-7 w-full px-1 text-[10px] font-medium text-accent"
            onClick={() => {
              setMixedEditing(true)
              window.requestAnimationFrame(() => {
                valueSlotRef.current?.querySelector('input')?.focus()
              })
            }}
          >
            Mixed
          </SquircleSurface>
        ) : (
          <NumberField
            value={pointerActive ? sliderValue : value}
            onCommit={(next) => {
              onCommit(next)
              if (mixed) setMixedEditing(false)
            }}
            onScrubPreview={onScrubPreview}
            onScrubCommit={onScrubCommit}
            onScrubCancel={onScrubCancel}
            min={min}
            max={max}
            step={step}
            suffix={suffix}
            ariaLabel={label}
            disabled={disabled}
            showScrubHandle={false}
            width="w-full"
          />
        )}
      </div>
      {keyframe ? (
        <div className="flex h-7 w-7 items-center justify-center">
          {keyframe}
        </div>
      ) : null}
    </div>
  )
}
