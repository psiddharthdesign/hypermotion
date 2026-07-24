// SPDX-License-Identifier: Apache-2.0

/**
 * Beat-sync domain primitives.
 *
 * This module deliberately has no Web Audio or React dependencies. Callers can
 * decode a file with AudioContext, then pass channel PCM here; the timeline,
 * future worker, and MCP bridge can therefore share exactly the same analysis
 * and quantisation rules.
 */

export const NOTE_DIVISIONS = [1, 2, 4, 8, 16, 32] as const
export type NoteDivision = (typeof NOTE_DIVISIONS)[number]

export interface PcmAudioData {
  sampleRate: number
  channels: readonly Float32Array[]
}

export interface BeatTransient {
  /** Source-relative time in seconds. */
  time: number
  /** Normalized onset strength, 0..1. */
  strength: number
}

export interface TempoCandidate {
  bpm: number
  /**
   * How this suggestion relates to the strongest directly observed pulse.
   * Ratio alternatives are surfaced even when accent periodicity hides them
   * from the ordinary local-peak list.
   */
  relationship?: 'direct' | '3:2' | '2:3'
  /**
   * Beat phase inferred specifically for this tempo, in source-relative
   * seconds. Older persisted analyses may not have this field.
   */
  firstBeatTime?: number
  /**
   * Strength of the periodic evidence for this tempo, 0..1. This is not a
   * probability and intentionally remains low when the signal has no stable
   * pulse.
   */
  confidence: number
}

export type BeatAnalysisStatus = 'ok' | 'ambiguous' | 'no-pulse'

export interface BeatAnalysis {
  bpm: number
  /** Confidence in the selected tempo, 0..1. */
  confidence: number
  /** Whether the estimate is safe to apply without asking the user to review. */
  status?: BeatAnalysisStatus
  /** Lets persisted analyses be invalidated when the detector changes. */
  algorithmVersion?: 2 | 3
  /** First recurring beat phase in source-relative seconds. */
  firstBeatTime: number
  transients: BeatTransient[]
  /**
   * Transients close enough to the inferred beat grid to be useful as musical
   * markers. Off-grid fills and noise remain in `transients` for inspection.
   */
  beatTransients: BeatTransient[]
  candidates: TempoCandidate[]
}

export interface BeatAnalysisOptions {
  minBpm?: number
  maxBpm?: number
  /** Analysis hop length in milliseconds. Default 10ms. */
  hopMs?: number
  /** Maximum distance from an inferred beat for a transient to count. */
  beatToleranceMs?: number
}

export interface MusicalGrid {
  bpm: number
  firstBeatTime: number
  beatsPerBar: number
  /** Denominator of the beat unit, normally 4 for quarter-note BPM. */
  beatUnit: NoteDivision
  /** 50 is straight; 66.7 approximates triplet swing. */
  swingPercent?: number
}

export interface BarSubdivision {
  id?: string
  /** Inclusive, one-based bar number. */
  startBar: number
  /** Inclusive, one-based bar number. */
  endBar: number
  division: NoteDivision
}

export interface AudioBeatGrid extends MusicalGrid {
  version: 1
  subdivisions: BarSubdivision[]
}

export function normalizeSwingPercent(value: unknown): number {
  return clamp(
    typeof value === 'number' && Number.isFinite(value) ? value : 50,
    50,
    75,
  )
}

export function divisionForBar(
  grid: Pick<AudioBeatGrid, 'beatUnit' | 'subdivisions'>,
  bar: number,
): NoteDivision {
  let division = grid.beatUnit
  for (const region of grid.subdivisions) {
    if (bar >= region.startBar && bar <= region.endBar) {
      division = region.division
    }
  }
  return division
}

export function createNoteMarkersForBars(
  grid: AudioBeatGrid,
  startBar: number,
  endBar: number,
): NoteMarker[] {
  const markers: NoteMarker[] = []
  for (let bar = startBar; bar <= endBar; bar++) {
    const division = divisionForBar(grid, bar)
    const barMarkers = createNoteMarkers(grid, {
      startBar: bar,
      endBar: bar,
      division,
    })
    if (markers.length > 0) barMarkers.shift()
    markers.push(...barMarkers)
  }
  return markers
}

export interface NoteMarker {
  time: number
  bar: number
  beat: number
  subdivision: number
  division: NoteDivision
  isBarStart: boolean
}

export interface KeyframeBeatAlignment {
  ok: boolean
  times: number[]
  availableSlots: number
  reason?: 'no-keyframes' | 'no-grid-slots' | 'insufficient-grid-slots'
}

export interface KeyframeBeatAlignmentOptions {
  /**
   * Keyframes this close together are one musical event and stay concurrent.
   * The timeline passes half a composition frame; domain callers default to
   * exact-time grouping.
   */
  coincidentTolerance?: number
  /**
   * Optional owner key per input time. Coincident values with the same owner
   * remain separate events so one animation track never receives overlapping
   * keyframes.
   */
  coincidenceKeys?: readonly (string | number | null | undefined)[]
  /** Optional per-event reservation check for an otherwise valid grid slot. */
  isSlotAvailable?: (
    memberIndices: readonly number[],
    slotTime: number,
  ) => boolean
}

export interface KeyframeBeatSpreadOptions
  extends KeyframeBeatAlignmentOptions {
  /**
   * Last note point in the requested musical range. Extra supplied markers
   * remain available for collision overflow, but do not widen the intended
   * spacing unless an occupied point forces the cascade forward.
   */
  preferredEndTime?: number
}

const DEFAULT_MIN_BPM = 60
const DEFAULT_MAX_BPM = 200
const EPSILON = 1e-9

export interface MusicalBarSegment {
  /**
   * The measured bar represented by this segment. A lead-in is labelled with
   * the upcoming Bar 1 for display only; it stays outside selectable musical
   * ranges and never stretches the first measured bar.
   */
  bar: number
  startTime: number
  endTime: number
  isLeadIn: boolean
}

/**
 * Split a source-time range into the musical bars it intersects.
 *
 * The analyzed beat phase can sit after the clip in-point. That interval is a
 * separate lead-in associated with Bar 1; Bar 1 itself still begins on the
 * chosen anchor and therefore remains the same width as every later bar. When a
 * clip is trimmed into the middle of a later bar, the first returned segment
 * keeps that containing bar's number.
 */
export function musicalBarSegmentsForRange(
  grid: MusicalGrid,
  rangeStart: number,
  rangeEnd: number,
): MusicalBarSegment[] {
  if (
    !Number.isFinite(rangeStart) ||
    !Number.isFinite(rangeEnd) ||
    rangeEnd <= rangeStart + EPSILON
  ) {
    return []
  }

  const bpm = finitePositive(grid.bpm, 120)
  const beatsPerBar = Math.max(
    1,
    Math.round(finitePositive(grid.beatsPerBar, 4)),
  )
  const secondsPerBar = 60 / bpm * beatsPerBar
  const firstBeatTime = Number.isFinite(grid.firstBeatTime)
    ? grid.firstBeatTime
    : 0
  const segments: MusicalBarSegment[] = []
  let cursor = rangeStart

  if (cursor < firstBeatTime - EPSILON) {
    const leadInEnd = Math.min(rangeEnd, firstBeatTime)
    segments.push({
      bar: 1,
      startTime: cursor,
      endTime: leadInEnd,
      isLeadIn: true,
    })
    cursor = leadInEnd
  }

  if (cursor >= rangeEnd - EPSILON) return segments

  let bar =
    cursor < firstBeatTime
      ? 1
      : Math.max(
          1,
          Math.floor(
            (cursor - firstBeatTime) / secondsPerBar + EPSILON,
          ) + 1,
        )

  while (cursor < rangeEnd - EPSILON) {
    const nextBarStart = firstBeatTime + bar * secondsPerBar
    const endTime = Math.min(rangeEnd, nextBarStart)
    if (endTime <= cursor + EPSILON) {
      bar++
      continue
    }
    segments.push({
      bar,
      startTime: cursor,
      endTime,
      isLeadIn: false,
    })
    cursor = endTime
    bar++
  }

  return segments
}

export function analyzeBeatPcm(
  audio: PcmAudioData,
  options: BeatAnalysisOptions = {},
): BeatAnalysis {
  const sampleRate = finitePositive(audio.sampleRate, 44_100)
  const minBpm = clamp(finitePositive(options.minBpm, DEFAULT_MIN_BPM), 30, 300)
  const maxBpm = clamp(
    finitePositive(options.maxBpm, DEFAULT_MAX_BPM),
    minBpm + 1,
    360,
  )
  const hopSize = Math.max(
    32,
    Math.round(sampleRate * finitePositive(options.hopMs, 10) / 1_000),
  )
  const mono = mixToMonoEnergySafe(audio.channels)
  const novelty = onsetNovelty(mono, hopSize)
  const bass = mixToMonoEnergySafe(
    audio.channels.map((channel) => lowPassSamples(channel, sampleRate, 180)),
  )
  const bassNovelty = onsetNovelty(bass, hopSize)
  const noveltyRate = sampleRate / hopSize
  const transients = pickTransients(novelty, noveltyRate)
  const bassTransients = pickTransients(bassNovelty, noveltyRate)
  const signalLevel = rootMeanSquare(mono)
  const tempoSearch = tempoCandidates(
    novelty,
    bassNovelty,
    transients,
    bassTransients,
    noveltyRate,
    minBpm,
    maxBpm,
  )
  const pulseEvidence = tempoSearch.pulseEvidence
  const bestEvidence = tempoSearch.selectedEvidence
  const hasPulse =
    signalLevel >= 1e-5 &&
    transients.length >= 4 &&
    (pulseEvidence?.periodicity ?? 0) >= 0.11 &&
    (pulseEvidence?.score ?? 0) >= 0.16
  const confidence = hasPulse
    ? tempoConfidence(
        bestEvidence,
        tempoSearch.suggestions,
        tempoSearch.compoundPromoted,
      )
    : 0
  const status: BeatAnalysisStatus = !hasPulse
    ? 'no-pulse'
    : confidence >= 0.58
      ? 'ok'
      : 'ambiguous'
  const winner = bestEvidence ?? {
    bpm: clamp(120, minBpm, maxBpm),
    score: 0,
    periodicity: 0,
  }
  const period = 60 / winner.bpm
  const firstBeatTime = hasPulse
    ? inferBeatPhaseAtBpm(transients, winner.bpm)
    : 0
  const candidates = hasPulse
    ? tempoSearch.suggestions.slice(0, 4).map((candidate) => ({
        bpm: round(candidate.bpm, 3),
        relationship: candidate.relationship,
        firstBeatTime: round(inferBeatPhaseAtBpm(transients, candidate.bpm), 6),
        confidence: round(candidateEvidenceConfidence(candidate), 4),
      }))
    : []
  const tolerance = Math.min(
    period * 0.24,
    finitePositive(options.beatToleranceMs, 90) / 1_000,
  )
  const beatTransients = transients.filter(
    (transient) =>
      distanceToRecurringGrid(transient.time, firstBeatTime, period) <= tolerance,
  )
  return {
    bpm: round(winner.bpm, 3),
    confidence: round(confidence, 4),
    status,
    algorithmVersion: 3,
    firstBeatTime: round(firstBeatTime, 6),
    transients,
    beatTransients: hasPulse ? beatTransients : [],
    candidates,
  }
}

/**
 * Infer the recurring source-relative phase for a known tempo.
 *
 * Candidate-specific phase evidence lets the UI offer an optional detected
 * start without baking it into a manually applied tempo. A manual grid can
 * deliberately anchor Bar 1 to the clip start instead.
 */
export function inferBeatPhaseAtBpm(
  transients: readonly BeatTransient[],
  bpm: number,
): number {
  if (!Number.isFinite(bpm) || bpm <= 0) return 0
  return inferBeatPhase(transients, 60 / bpm)
}

/**
 * Advance a recurring beat phase to its first occurrence at or after a source
 * in-point. Beat analysis stores phase within one beat period, so trimmed
 * clips need this conversion before offering an analyzed lead-in.
 */
export function recurringBeatAtOrAfter(
  firstBeatTime: number,
  bpm: number,
  minimumTime: number,
): number {
  const minimum = Number.isFinite(minimumTime) ? minimumTime : 0
  if (!Number.isFinite(firstBeatTime) || !Number.isFinite(bpm) || bpm <= 0) {
    return minimum
  }
  if (firstBeatTime >= minimum - EPSILON) return firstBeatTime
  const period = 60 / bpm
  const occurrences = Math.max(
    0,
    Math.ceil((minimum - firstBeatTime) / period - EPSILON),
  )
  return round(firstBeatTime + occurrences * period, 9)
}

/**
 * Keep an explicitly authored lead-in stable when the clip in-point changes.
 * A stale anchor before the old in-point is treated as a zero-length lead.
 */
export function beatAnchorAfterTrimChange(
  firstBeatTime: number,
  currentTrimStart: number,
  nextTrimStart: number,
): number {
  const currentTrim = Number.isFinite(currentTrimStart)
    ? Math.max(0, currentTrimStart)
    : 0
  const nextTrim = Number.isFinite(nextTrimStart)
    ? Math.max(0, nextTrimStart)
    : 0
  const leadIn =
    Number.isFinite(firstBeatTime)
      ? Math.max(0, firstBeatTime - currentTrim)
      : 0
  return round(nextTrim + leadIn, 9)
}

/**
 * Create the editable note grid for a bar range. The final boundary is included
 * so an animation can span exactly one or more complete bars.
 */
export function createNoteMarkers(
  grid: MusicalGrid,
  region: BarSubdivision,
): NoteMarker[] {
  const bpm = finitePositive(grid.bpm, 120)
  const beatsPerBar = Math.max(1, Math.round(finitePositive(grid.beatsPerBar, 4)))
  const beatUnit = normalizeDivision(grid.beatUnit, 4)
  const division = normalizeDivision(region.division, beatUnit)
  const startBar = Math.max(1, Math.round(finitePositive(region.startBar, 1)))
  const endBar = Math.max(
    startBar,
    Math.round(finitePositive(region.endBar, startBar)),
  )
  const subdivisionsPerBeat = division / beatUnit
  const beatSeconds = 60 / bpm
  const stepSeconds = beatSeconds / subdivisionsPerBeat
  const stepsPerBar = Math.max(1, Math.round(beatsPerBar * subdivisionsPerBeat))
  const swingPercent = normalizeSwingPercent(grid.swingPercent)
  const markers: NoteMarker[] = []

  for (let bar = startBar; bar <= endBar; bar++) {
    for (let step = 0; step < stepsPerBar; step++) {
      const beatIndex = subdivisionsPerBeat >= 1
        ? Math.floor(step / subdivisionsPerBeat)
        : Math.round(step / subdivisionsPerBeat)
      markers.push({
        time: round(
          grid.firstBeatTime +
            ((bar - 1) * stepsPerBar + step) * stepSeconds +
            (
              subdivisionsPerBeat >= 2 && step % 2 === 1
                ? stepSeconds * (2 * swingPercent / 100 - 1)
                : 0
            ),
          9,
        ),
        bar,
        beat: beatIndex + 1,
        subdivision: subdivisionsPerBeat >= 1
          ? (step % subdivisionsPerBeat) + 1
          : 1,
        division,
        isBarStart: step === 0,
      })
    }
  }

  const finalBar = endBar + 1
  markers.push({
    time: round(
      grid.firstBeatTime + endBar * stepsPerBar * stepSeconds,
      9,
    ),
    bar: finalBar,
    beat: 1,
    subdivision: 1,
    division,
    isBarStart: true,
  })
  return markers
}

/**
 * Snap ordered keyframe events to their nearest unique note boundaries.
 * Relative values/easing are untouched; only returned times change.
 *
 * Coincident keyframes remain one event. Distinct events never overlap: when
 * two events prefer the same point, the later event cascades to the next note
 * boundary. The caller may append markers from following bars and retry when
 * the supplied marker range ends.
 */
export function alignKeyframesToNoteMarkers(
  keyframeTimes: readonly number[],
  markers: readonly { time: number }[],
  options: KeyframeBeatAlignmentOptions = {},
): KeyframeBeatAlignment {
  if (keyframeTimes.length === 0) {
    return { ok: false, times: [], availableSlots: markers.length, reason: 'no-keyframes' }
  }
  const allSlots = sortedUniqueNoteSlots(markers)
  if (allSlots.length === 0) {
    return {
      ok: false,
      times: [...keyframeTimes],
      availableSlots: 0,
      reason: 'no-grid-slots',
    }
  }

  const clusters = clusterKeyframeTimes(keyframeTimes, options)

  if (clusters.length > allSlots.length) {
    return {
      ok: false,
      times: [...keyframeTimes],
      availableSlots: allSlots.length,
      reason: 'insufficient-grid-slots',
    }
  }

  const times = [...keyframeTimes]
  let previousSlotIndex = -1
  for (const cluster of clusters) {
    const source = cluster[0]!.time
    const nearestIndex = nearestSortedValueIndex(allSlots, source)
    let slotIndex = Math.max(nearestIndex, previousSlotIndex + 1)
    while (
      slotIndex < allSlots.length &&
      options.isSlotAvailable &&
      !options.isSlotAvailable(
        cluster.map((item) => item.index),
        allSlots[slotIndex]!,
      )
    ) {
      slotIndex++
    }
    if (slotIndex >= allSlots.length) {
      return {
        ok: false,
        times: [...keyframeTimes],
        availableSlots: allSlots.length,
        reason: 'insufficient-grid-slots',
      }
    }
    for (const item of cluster) times[item.index] = allSlots[slotIndex]!
    previousSlotIndex = slotIndex
  }
  return { ok: true, times, availableSlots: allSlots.length }
}

/**
 * Re-space already aligned musical events across a requested note range.
 *
 * Unlike nearest-note snapping, this deliberately changes spacing. Events are
 * distributed by note-slot ordinal (so mixed subdivisions stay musical), then
 * collision rules cascade occupied events into later supplied markers.
 */
export function spreadKeyframesAcrossNoteMarkers(
  keyframeTimes: readonly number[],
  markers: readonly { time: number }[],
  options: KeyframeBeatSpreadOptions = {},
): KeyframeBeatAlignment {
  if (keyframeTimes.length === 0) {
    return {
      ok: false,
      times: [],
      availableSlots: markers.length,
      reason: 'no-keyframes',
    }
  }
  const allSlots = sortedUniqueNoteSlots(markers)
  if (allSlots.length === 0) {
    return {
      ok: false,
      times: [...keyframeTimes],
      availableSlots: 0,
      reason: 'no-grid-slots',
    }
  }
  const clusters = clusterKeyframeTimes(keyframeTimes, options)
  if (clusters.length > allSlots.length) {
    return {
      ok: false,
      times: [...keyframeTimes],
      availableSlots: allSlots.length,
      reason: 'insufficient-grid-slots',
    }
  }

  const preferredEndIndex = Number.isFinite(options.preferredEndTime)
    ? lastSortedValueIndexAtOrBefore(allSlots, options.preferredEndTime!)
    : allSlots.length - 1
  const targetEndIndex = Math.max(0, preferredEndIndex)
  const times = [...keyframeTimes]
  let previousSlotIndex = -1
  for (let eventIndex = 0; eventIndex < clusters.length; eventIndex++) {
    const cluster = clusters[eventIndex]!
    const idealIndex =
      clusters.length === 1
        ? 0
        : Math.round(
            eventIndex * targetEndIndex / (clusters.length - 1),
          )
    let slotIndex = Math.max(idealIndex, previousSlotIndex + 1)
    while (
      slotIndex < allSlots.length &&
      options.isSlotAvailable &&
      !options.isSlotAvailable(
        cluster.map((item) => item.index),
        allSlots[slotIndex]!,
      )
    ) {
      slotIndex++
    }
    if (slotIndex >= allSlots.length) {
      return {
        ok: false,
        times: [...keyframeTimes],
        availableSlots: allSlots.length,
        reason: 'insufficient-grid-slots',
      }
    }
    for (const item of cluster) times[item.index] = allSlots[slotIndex]!
    previousSlotIndex = slotIndex
  }
  return { ok: true, times, availableSlots: allSlots.length }
}

type ClusteredKeyframeTime = {
  time: number
  index: number
  coincidenceKey: string | number | null | undefined
}

function sortedUniqueNoteSlots(markers: readonly { time: number }[]): number[] {
  return [...new Set(markers.map((marker) => marker.time))]
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
}

function clusterKeyframeTimes(
  keyframeTimes: readonly number[],
  options: KeyframeBeatAlignmentOptions,
): ClusteredKeyframeTime[][] {
  const tolerance = Math.max(
    0,
    Number.isFinite(options.coincidentTolerance)
      ? options.coincidentTolerance!
      : 1e-6,
  )
  const ordered = keyframeTimes
    .map((time, index) => ({
      time,
      index,
      coincidenceKey: options.coincidenceKeys?.[index],
    }))
    .sort((a, b) => a.time - b.time || a.index - b.index)
  const clusters: ClusteredKeyframeTime[][] = []
  for (const item of ordered) {
    const cluster = clusters.at(-1)
    const anchor = cluster?.[0]?.time
    const repeatsOwner =
      item.coincidenceKey !== null &&
      item.coincidenceKey !== undefined &&
      cluster?.some(
        (member) => member.coincidenceKey === item.coincidenceKey,
      )
    if (
      cluster &&
      anchor !== undefined &&
      Math.abs(item.time - anchor) <= tolerance &&
      !repeatsOwner
    ) {
      cluster.push(item)
    } else {
      clusters.push([item])
    }
  }
  return clusters
}

function nearestSortedValueIndex(
  values: readonly number[],
  target: number,
): number {
  let low = 0
  let high = values.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (values[middle]! < target) low = middle + 1
    else high = middle
  }
  if (low === 0) return 0
  if (low >= values.length) return values.length - 1
  const before = values[low - 1]!
  const after = values[low]!
  return target - before <= after - target ? low - 1 : low
}

function lastSortedValueIndexAtOrBefore(
  values: readonly number[],
  target: number,
): number {
  let low = 0
  let high = values.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (values[middle]! <= target + EPSILON) low = middle + 1
    else high = middle
  }
  return low - 1
}

/**
 * Produce an energy envelope without summing channel polarity. A conventional
 * `(left + right) / 2` mono fold-down erases antiphase material and used to
 * turn a valid stereo click track into silence.
 */
function mixToMonoEnergySafe(channels: readonly Float32Array[]): Float32Array {
  const length = channels.reduce(
    (max, channel) => Math.max(max, channel.length),
    0,
  )
  const mono = new Float32Array(length)
  if (channels.length === 0) return mono
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i++) {
      mono[i] += channel[i]! * channel[i]!
    }
  }
  for (let i = 0; i < mono.length; i++) {
    mono[i] = Math.sqrt(mono[i]! / channels.length)
  }
  return mono
}

/**
 * A lightweight one-pole low-pass used to give kick/bass recurrence a voice
 * alongside the full-band onset envelope. Dense hats and melodic attacks can
 * otherwise look like a convincing but unrelated tempo.
 */
function lowPassSamples(
  samples: Float32Array,
  sampleRate: number,
  cutoffHz: number,
): Float32Array {
  const filtered = new Float32Array(samples.length)
  const alpha = 1 - Math.exp(-2 * Math.PI * cutoffHz / sampleRate)
  let value = 0
  for (let i = 0; i < samples.length; i++) {
    value += alpha * (samples[i]! - value)
    filtered[i] = value
  }
  return filtered
}

function onsetNovelty(samples: Float32Array, hopSize: number): Float32Array {
  const frameCount = Math.ceil(samples.length / hopSize)
  const energy = new Float32Array(frameCount)
  for (let frame = 0; frame < frameCount; frame++) {
    const start = frame * hopSize
    const end = Math.min(samples.length, start + hopSize)
    let sum = 0
    for (let i = start; i < end; i++) sum += samples[i]! * samples[i]!
    energy[frame] = Math.sqrt(sum / Math.max(1, end - start))
  }

  const novelty = new Float32Array(frameCount)
  for (let i = 1; i < frameCount; i++) {
    const localStart = Math.max(0, i - 8)
    let baseline = 0
    for (let j = localStart; j < i; j++) baseline += energy[j]!
    baseline /= Math.max(1, i - localStart)
    novelty[i] = Math.max(0, energy[i]! - baseline)
  }
  return normalizeArray(novelty)
}

function pickTransients(
  novelty: Float32Array,
  noveltyRate: number,
): BeatTransient[] {
  if (novelty.length < 3) return []
  const values = Array.from(novelty)
  const median = percentile(values, 0.5)
  const deviations = values.map((value) => Math.abs(value - median))
  const threshold = Math.max(0.08, median + percentile(deviations, 0.75) * 2.5)
  const minGapFrames = Math.max(1, Math.round(noveltyRate * 0.055))
  const peaks: BeatTransient[] = []
  let lastPeakFrame = -minGapFrames

  for (let i = 1; i < novelty.length - 1; i++) {
    const value = novelty[i]!
    if (value < threshold || value < novelty[i - 1]! || value < novelty[i + 1]!) {
      continue
    }
    if (i - lastPeakFrame < minGapFrames) {
      const previous = peaks[peaks.length - 1]
      if (previous && value > previous.strength) {
        previous.time = round(i / noveltyRate, 6)
        previous.strength = round(value, 4)
        lastPeakFrame = i
      }
      continue
    }
    peaks.push({
      time: round(i / noveltyRate, 6),
      strength: round(value, 4),
    })
    lastPeakFrame = i
  }
  return peaks
}

function tempoCandidates(
  novelty: Float32Array,
  bassNovelty: Float32Array,
  transients: readonly BeatTransient[],
  bassTransients: readonly BeatTransient[],
  noveltyRate: number,
  minBpm: number,
  maxBpm: number,
): TempoSearchResult {
  const scored: TempoEvidence[] = []
  for (let bpm = minBpm; bpm <= maxBpm; bpm += 0.25) {
    const lag = noveltyRate * 60 / bpm
    const broadbandPeriodicity = robustCorrelationAtLag(
      novelty,
      lag,
      noveltyRate,
    )
    const bassPeriodicity = robustCorrelationAtLag(
      bassNovelty,
      lag,
      noveltyRate,
    )
    const broadbandFit = gridFitAtTempo(transients, 60 / bpm)
    const bassFit = gridFitAtTempo(bassTransients, 60 / bpm)
    const periodicity =
      broadbandPeriodicity * 0.62 +
      bassPeriodicity * 0.38
    const fit = broadbandFit * 0.58 + bassFit * 0.42
    // The prior only breaks true octave ties. It cannot rescue a tempo without
    // matching onsets; compound alternatives are evaluated separately below.
    const prior = 0.96 + 0.04 * Math.exp(-Math.pow((bpm - 120) / 58, 2))
    scored.push({
      bpm,
      periodicity,
      score: (periodicity * 0.72 + fit * 0.28) * prior,
      relationship: 'direct',
    })
  }

  // Candidates are genuine peaks in the tempo curve, then non-max suppressed.
  // Reporting adjacent samples from one broad peak made the old confidence
  // margin meaningless.
  const peaks = scored.filter((item, index) => {
    const left = scored[index - 1]?.score ?? -Infinity
    const right = scored[index + 1]?.score ?? -Infinity
    return item.score >= left && item.score >= right
  })
  peaks.sort((a, b) => b.score - a.score)
  const separated: TempoEvidence[] = []
  for (const item of peaks) {
    if (separated.some((candidate) => Math.abs(candidate.bpm - item.bpm) < 3)) {
      continue
    }
    separated.push(item)
    if (separated.length === 8) break
  }

  const pulseEvidence = separated[0]
  if (!pulseEvidence) {
    return {
      pulseEvidence: undefined,
      selectedEvidence: undefined,
      suggestions: [],
      compoundPromoted: false,
    }
  }

  const compounds = [
    compoundTempoEvidence(
      scored,
      transients,
      pulseEvidence,
      pulseEvidence.bpm * 1.5,
      '3:2',
      minBpm,
      maxBpm,
    ),
    compoundTempoEvidence(
      scored,
      transients,
      pulseEvidence,
      pulseEvidence.bpm / 1.5,
      '2:3',
      minBpm,
      maxBpm,
    ),
  ].filter((candidate): candidate is TempoEvidence => !!candidate)

  const promotable = [...compounds]
    .filter(
      (candidate) =>
        (candidate.exclusiveCoverage ?? 0) >= 0.55 &&
        (candidate.alignedStrengthShare ?? 0) >= 0.68 &&
        (candidate.alignedStrengthShare ?? 0) >=
          (candidate.primaryAlignedStrengthShare ?? 1) &&
        (candidate.rawScore ?? candidate.score) >= 0.08 &&
        (candidate.promotionScore ?? candidate.score) >=
          pulseEvidence.score * 0.96,
    )
    .sort(
      (a, b) =>
        (b.promotionScore ?? b.score) - (a.promotionScore ?? a.score),
    )[0]
  const selectedEvidence = promotable ?? pulseEvidence
  const compoundPromoted = !!promotable

  // A useful metrical alternative must not disappear behind unrelated local
  // peaks. Keep the selected tempo first, the strongest observed pulse next
  // when it differs, then ratio alternatives before filling with direct peaks.
  const suggestions: TempoEvidence[] = []
  const append = (candidate: TempoEvidence | undefined) => {
    if (
      !candidate ||
      suggestions.some((item) => Math.abs(item.bpm - candidate.bpm) < 1)
    ) {
      return
    }
    suggestions.push(candidate)
  }
  append(selectedEvidence)
  if (selectedEvidence !== pulseEvidence) append(pulseEvidence)
  for (const candidate of compounds.sort(
    (a, b) =>
      (b.exclusiveCoverage ?? 0) - (a.exclusiveCoverage ?? 0) ||
      b.score - a.score,
  )) {
    append(candidate)
  }
  for (const candidate of separated) append(candidate)

  return {
    pulseEvidence,
    selectedEvidence,
    suggestions,
    compoundPromoted,
  }
}

interface TempoEvidence {
  bpm: number
  score: number
  periodicity: number
  relationship: NonNullable<TempoCandidate['relationship']>
  rawScore?: number
  exclusiveCoverage?: number
  alignedStrengthShare?: number
  primaryAlignedStrengthShare?: number
  promotionScore?: number
}

interface TempoSearchResult {
  pulseEvidence: TempoEvidence | undefined
  selectedEvidence: TempoEvidence | undefined
  suggestions: TempoEvidence[]
  compoundPromoted: boolean
}

function compoundTempoEvidence(
  scored: readonly TempoEvidence[],
  transients: readonly BeatTransient[],
  pulseEvidence: TempoEvidence,
  targetBpm: number,
  relationship: '3:2' | '2:3',
  minBpm: number,
  maxBpm: number,
): TempoEvidence | null {
  if (
    !Number.isFinite(targetBpm) ||
    targetBpm < minBpm ||
    targetBpm > maxBpm ||
    Math.abs(targetBpm - pulseEvidence.bpm) < 3
  ) {
    return null
  }

  // The direct score can have a broad trough at the musical quarter-note
  // tempo when a dotted-quarter accent dominates. Search a narrow ratio-local
  // window and let persistent, exclusive beat coverage refine the exact BPM.
  const radius = Math.max(1.5, targetBpm * 0.018)
  const nearby = scored.filter(
    (candidate) => Math.abs(candidate.bpm - targetBpm) <= radius,
  )
  if (nearby.length === 0) return null
  const primaryAlignedStrengthShare = gridAlignedStrengthShare(
    transients,
    pulseEvidence.bpm,
  )
  const candidates = nearby.map((candidate) => {
    const exclusiveCoverage = exclusiveGridCoverage(
      transients,
      candidate.bpm,
      pulseEvidence.bpm,
    )
    const alignedStrengthShare = gridAlignedStrengthShare(
      transients,
      candidate.bpm,
    )
    const rawScore = candidate.score
    return {
      ...candidate,
      relationship,
      rawScore,
      exclusiveCoverage,
      alignedStrengthShare,
      primaryAlignedStrengthShare,
      // Coverage is deliberately much stronger than accent autocorrelation:
      // it represents recurring beats that the dominant pulse cannot explain.
      promotionScore: rawScore + exclusiveCoverage * 0.5,
      // Candidate confidence remains conservative; the larger promotion bonus
      // is only used for choosing the musical interpretation.
      score: rawScore + exclusiveCoverage * 0.2,
    }
  })
  return candidates.sort(
    (a, b) =>
      (b.promotionScore ?? b.score) - (a.promotionScore ?? a.score) ||
      Math.abs(a.bpm - targetBpm) - Math.abs(b.bpm - targetBpm),
  )[0] ?? null
}

/**
 * Fraction of detected transient strength explained by a tempo grid.
 *
 * Persistent eighths or triplets can fill every "exclusive" ratio slot while
 * still belonging to a slower/faster direct pulse. A genuine compound tempo
 * interpretation must explain most of the track's onset strength, not merely
 * find a recurring low-level subdivision.
 */
function gridAlignedStrengthShare(
  transients: readonly BeatTransient[],
  bpm: number,
): number {
  if (
    transients.length === 0 ||
    !Number.isFinite(bpm) ||
    bpm <= 0
  ) {
    return 0
  }
  const period = 60 / bpm
  const phase = inferBeatPhase(transients, period)
  const tolerance = Math.min(0.08, period * 0.14)
  let alignedStrength = 0
  let totalStrength = 0
  for (const transient of transients) {
    const strength =
      Number.isFinite(transient.strength) && transient.strength > 0
        ? transient.strength
        : 0
    totalStrength += strength
    if (
      distanceToRecurringGrid(transient.time, phase, period) <= tolerance
    ) {
      alignedStrength += strength
    }
  }
  return alignedStrength / Math.max(EPSILON, totalStrength)
}

/**
 * Measure target-grid beats that cannot be explained by the dominant pulse.
 *
 * A true 135 BPM quarter-note pulse underneath a 90 BPM dotted-quarter accent
 * repeatedly fills the 135-only positions. A straight 90 BPM track does not.
 * Taking the median across six-second windows prevents one triplet fill from
 * reinterpreting an otherwise stable track.
 */
function exclusiveGridCoverage(
  transients: readonly BeatTransient[],
  targetBpm: number,
  primaryBpm: number,
): number {
  if (
    transients.length < 4 ||
    !Number.isFinite(targetBpm) ||
    !Number.isFinite(primaryBpm) ||
    targetBpm <= 0 ||
    primaryBpm <= 0
  ) {
    return 0
  }
  const targetPeriod = 60 / targetBpm
  const primaryPeriod = 60 / primaryBpm
  const targetPhase = inferBeatPhase(transients, targetPeriod)
  const primaryPhase = inferBeatPhase(transients, primaryPeriod)
  const firstTime = transients[0]!.time
  const lastTime = transients.at(-1)!.time
  if (lastTime - firstTime < targetPeriod * 4) return 0

  const firstBeat = Math.ceil((firstTime - targetPhase) / targetPeriod)
  const lastBeat = Math.floor((lastTime - targetPhase) / targetPeriod)
  const hitTolerance = Math.min(0.08, targetPeriod * 0.14)
  const sharedTolerance = Math.min(0.08, targetPeriod * 0.12)
  const windowSeconds = 6
  const windows = new Map<number, { expected: number; matched: number }>()
  let transientIndex = 0

  for (let beat = firstBeat; beat <= lastBeat; beat++) {
    const time = targetPhase + beat * targetPeriod
    if (
      distanceToRecurringGrid(time, primaryPhase, primaryPeriod) <=
      sharedTolerance
    ) {
      continue
    }
    const window = Math.floor((time - firstTime) / windowSeconds)
    const bucket = windows.get(window) ?? { expected: 0, matched: 0 }
    bucket.expected++
    while (
      transientIndex < transients.length &&
      transients[transientIndex]!.time < time - hitTolerance
    ) {
      transientIndex++
    }
    let bestStrength = 0
    for (
      let index = transientIndex;
      index < transients.length &&
      transients[index]!.time <= time + hitTolerance;
      index++
    ) {
      bestStrength = Math.max(bestStrength, transients[index]!.strength)
    }
    if (bestStrength >= 0.08) bucket.matched++
    windows.set(window, bucket)
  }

  const coverage = [...windows.values()]
    .filter((window) => window.expected >= 3)
    .map((window) => window.matched / window.expected)
  return coverage.length > 0 ? percentile(coverage, 0.5) : 0
}

function candidateEvidenceConfidence(candidate: TempoEvidence): number {
  return clamp((candidate.score - 0.08) / 0.62, 0, 1)
}

function tempoConfidence(
  winner: TempoEvidence | undefined,
  candidates: readonly TempoEvidence[],
  compoundPromoted: boolean,
): number {
  if (!winner) return 0
  const runnerUp = candidates
    .filter((candidate) => Math.abs(candidate.bpm - winner.bpm) >= 1)
    .sort((a, b) => b.score - a.score)[0]
  const evidence = candidateEvidenceConfidence(winner)
  const margin = runnerUp
    ? clamp((winner.score - runnerUp.score) / Math.max(winner.score, EPSILON), 0, 1)
    : 1
  // Tempo ambiguity matters at least as much as absolute periodic strength.
  // A loud repeating polyrhythm can have two individually strong candidates;
  // calling that 90% confident is actively misleading.
  const confidence = clamp(evidence * (0.35 + margin * 0.65), 0, 1)
  return compoundPromoted ? Math.min(0.57, confidence) : confidence
}

function robustCorrelationAtLag(
  values: Float32Array,
  lag: number,
  valuesPerSecond: number,
): number {
  const global = correlationAtLag(values, lag)
  const windowSize = Math.max(Math.ceil(lag * 4), Math.round(valuesPerSecond * 6))
  if (values.length <= windowSize * 1.5) return global
  const segmentScores: number[] = []
  for (let start = 0; start + Math.ceil(lag) + 4 < values.length; start += windowSize) {
    const end = Math.min(values.length, start + windowSize)
    const segment = values.slice(start, end)
    if (segment.length > lag + 4) segmentScores.push(correlationAtLag(segment, lag))
  }
  if (segmentScores.length < 2) return global
  // Median segment evidence prevents one loud intro or fill from deciding the
  // tempo for an otherwise steady track.
  return global * 0.58 + percentile(segmentScores, 0.5) * 0.42
}

function gridFitAtTempo(
  transients: readonly BeatTransient[],
  period: number,
): number {
  if (transients.length < 3 || !Number.isFinite(period) || period <= 0) return 0
  const phase = inferBeatPhase(transients, period)
  let alignedStrength = 0
  let totalStrength = 0
  for (const transient of transients) {
    const distance = distanceToRecurringGrid(transient.time, phase, period)
    const weight = Math.exp(-Math.pow(distance / (period * 0.085), 2))
    alignedStrength += transient.strength * weight
    totalStrength += transient.strength
  }
  return alignedStrength / Math.max(EPSILON, totalStrength)
}

function correlationAtLag(values: Float32Array, lag: number): number {
  const whole = Math.floor(lag)
  const fraction = lag - whole
  if (whole < 1 || whole >= values.length - 1) return 0
  let meanCurrent = 0
  let meanShifted = 0
  let count = 0
  for (let i = whole + 1; i < values.length; i++) {
    const shifted =
      values[i - whole]! * (1 - fraction) +
      values[i - whole - 1]! * fraction
    meanCurrent += values[i]!
    meanShifted += shifted
    count++
  }
  if (count === 0) return 0
  meanCurrent /= count
  meanShifted /= count
  let score = 0
  let normA = 0
  let normB = 0
  for (let i = whole + 1; i < values.length; i++) {
    const shifted =
      values[i - whole]! * (1 - fraction) +
      values[i - whole - 1]! * fraction
    const current = values[i]! - meanCurrent
    const centeredShifted = shifted - meanShifted
    score += current * centeredShifted
    normA += current * current
    normB += centeredShifted * centeredShifted
  }
  return score / Math.sqrt(Math.max(EPSILON, normA * normB))
}

function inferBeatPhase(
  transients: readonly BeatTransient[],
  period: number,
): number {
  if (transients.length === 0 || !Number.isFinite(period) || period <= 0) return 0
  const phaseBins = 96
  let bestPhase = positiveModulo(transients[0]!.time, period)
  let bestScore = -Infinity
  for (let bin = 0; bin < phaseBins; bin++) {
    const phase = bin * period / phaseBins
    let score = 0
    for (const transient of transients) {
      const distance = distanceToRecurringGrid(transient.time, phase, period)
      const weight = Math.exp(-Math.pow(distance / (period * 0.09), 2))
      score += transient.strength * weight
    }
    if (score > bestScore) {
      bestScore = score
      bestPhase = phase
    }
  }
  return bestPhase
}

function distanceToRecurringGrid(
  time: number,
  phase: number,
  period: number,
): number {
  const wrapped = positiveModulo(time - phase, period)
  return Math.min(wrapped, period - wrapped)
}

function normalizeArray(values: Float32Array): Float32Array {
  let max = 0
  for (const value of values) max = Math.max(max, value)
  if (max <= EPSILON) return values
  for (let i = 0; i < values.length; i++) values[i] /= max
  return values
}

function rootMeanSquare(values: Float32Array): number {
  if (values.length === 0) return 0
  let sum = 0
  for (const value of values) sum += value * value
  return Math.sqrt(sum / values.length)
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(clamp(fraction, 0, 1) * (sorted.length - 1))] ?? 0
}

function normalizeDivision(value: unknown, fallback: NoteDivision): NoteDivision {
  return NOTE_DIVISIONS.includes(value as NoteDivision)
    ? value as NoteDivision
    : fallback
}

function finitePositive(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}
