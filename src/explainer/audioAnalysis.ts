// SPDX-License-Identifier: Apache-2.0

import type { BeatAnalysis, BeatTransient } from '@/audio/beatSync'
import type { ExplainerAudioAnalysis } from './types'

const DEFAULT_BEATS_PER_BAR = 4
const MAX_ENERGY_PEAKS = 12
const TIME_PRECISION = 1_000_000

export interface ExplainerAudioAnalysisOptions {
  sourceRefId?: string
  beatsPerBar?: number
}

/**
 * Convert Hyper Motion's PCM beat-detector result into the small,
 * JSON-compatible shape consumed by the explainer compiler.
 *
 * Beat times come from the inferred recurring grid rather than the transient
 * list. That keeps camera cuts and scene boundaries stable when a song contains
 * fills or syncopation. Strong transients are retained separately as optional
 * energy peaks.
 */
export function toExplainerAudioAnalysis(
  analysis: BeatAnalysis,
  durationSeconds: number,
  options: ExplainerAudioAnalysisOptions = {},
): ExplainerAudioAnalysis {
  const duration = finiteNonNegative(durationSeconds)
  const sourceRefId = nonBlank(options.sourceRefId)
  const result: ExplainerAudioAnalysis = {
    ...(sourceRefId ? { sourceRefId } : {}),
    durationSeconds: duration,
    confidence: clamp01(analysis.confidence),
  }

  if (
    analysis.status === 'no-pulse' ||
    !Number.isFinite(analysis.bpm) ||
    analysis.bpm <= 0 ||
    duration <= 0
  ) {
    return result
  }

  const bpm = analysis.bpm
  const period = 60 / bpm
  const beatsPerBar = Math.max(
    1,
    Math.round(
      Number.isFinite(options.beatsPerBar)
        ? options.beatsPerBar!
        : DEFAULT_BEATS_PER_BAR,
    ),
  )
  const firstBeatTime = normalizeFirstBeat(analysis.firstBeatTime, period)
  const beats = recurringTimes(firstBeatTime, period, duration)
  const downbeats = beats.filter((_, index) => index % beatsPerBar === 0)

  return {
    ...result,
    bpm: round(bpm),
    firstBeatTime: round(firstBeatTime),
    beats,
    downbeats,
    energyPeaks: strongestTransientTimes(
      analysis.transients,
      duration,
      MAX_ENERGY_PEAKS,
    ),
  }
}

function recurringTimes(
  firstBeatTime: number,
  period: number,
  duration: number,
): number[] {
  if (!Number.isFinite(period) || period <= 0) return []

  const times: number[] = []
  // A detector can report a phase one or more periods after zero. Walk back to
  // the earliest equivalent non-negative phase so the exported beat plan spans
  // the complete source.
  let cursor = firstBeatTime
  while (cursor - period >= 0) cursor -= period
  while (cursor < 0) cursor += period

  const maxCount = Math.ceil(duration / period) + 2
  for (let index = 0; index < maxCount; index += 1) {
    const time = cursor + index * period
    if (time > duration + 1 / TIME_PRECISION) break
    times.push(round(Math.max(0, time)))
  }
  return times
}

function strongestTransientTimes(
  transients: readonly BeatTransient[],
  duration: number,
  limit: number,
): number[] {
  return [...transients]
    .filter(
      (transient) =>
        Number.isFinite(transient.time) &&
        transient.time >= 0 &&
        transient.time <= duration &&
        Number.isFinite(transient.strength),
    )
    .sort(
      (a, b) =>
        b.strength - a.strength ||
        a.time - b.time,
    )
    .slice(0, limit)
    .map((transient) => round(transient.time))
    .sort((a, b) => a - b)
}

function normalizeFirstBeat(value: number, period: number): number {
  if (!Number.isFinite(value)) return 0
  if (value >= 0) return value
  return ((value % period) + period) % period
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value >= 0 ? round(value) : 0
}

function nonBlank(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return round(Math.max(0, Math.min(1, value)))
}

function round(value: number): number {
  return Math.round(value * TIME_PRECISION) / TIME_PRECISION
}
