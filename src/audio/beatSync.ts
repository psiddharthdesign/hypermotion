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
  confidence: number
}

export interface BeatAnalysis {
  bpm: number
  /** Confidence in the selected tempo, 0..1. */
  confidence: number
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
}

const DEFAULT_MIN_BPM = 60
const DEFAULT_MAX_BPM = 200
const EPSILON = 1e-9

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
  const mono = mixToMono(audio.channels)
  const novelty = onsetNovelty(mono, hopSize)
  const noveltyRate = sampleRate / hopSize
  const transients = pickTransients(novelty, noveltyRate)
  const candidates = tempoCandidates(novelty, noveltyRate, minBpm, maxBpm)
  const winner = selectTempoCandidate(candidates) ?? {
    bpm: clamp(120, minBpm, maxBpm),
    confidence: 0,
  }
  const period = 60 / winner.bpm
  const firstBeatTime = inferBeatPhase(transients, period)
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
    confidence: round(winner.confidence, 4),
    firstBeatTime: round(firstBeatTime, 6),
    transients,
    beatTransients,
    candidates,
  }
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
  const markers: NoteMarker[] = []

  for (let bar = startBar; bar <= endBar; bar++) {
    for (let step = 0; step < stepsPerBar; step++) {
      const beatIndex = subdivisionsPerBeat >= 1
        ? Math.floor(step / subdivisionsPerBeat)
        : Math.round(step / subdivisionsPerBeat)
      markers.push({
        time: round(
          grid.firstBeatTime + ((bar - 1) * stepsPerBar + step) * stepSeconds,
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
 * Spread ordered keyframes over unique note boundaries in a musical region.
 * Relative values/easing are untouched; only returned times change.
 *
 * When there are more keyframes than note slots, the operation reports a
 * structured failure instead of silently stacking multiple keyframes at one
 * time. The UI can then ask the user for a finer division.
 */
export function alignKeyframesToNoteMarkers(
  keyframeTimes: readonly number[],
  markers: readonly NoteMarker[],
  options: KeyframeBeatAlignmentOptions = {},
): KeyframeBeatAlignment {
  if (keyframeTimes.length === 0) {
    return { ok: false, times: [], availableSlots: markers.length, reason: 'no-keyframes' }
  }
  const allSlots = [...new Set(markers.map((marker) => marker.time))]
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
  if (allSlots.length === 0) {
    return {
      ok: false,
      times: [...keyframeTimes],
      availableSlots: 0,
      reason: 'no-grid-slots',
    }
  }

  const tolerance = Math.max(
    0,
    Number.isFinite(options.coincidentTolerance)
      ? options.coincidentTolerance!
      : 1e-6,
  )
  const ordered = keyframeTimes
    .map((time, index) => ({ time, index }))
    .sort((a, b) => a.time - b.time || a.index - b.index)
  const clusters: Array<Array<{ time: number; index: number }>> = []
  for (const item of ordered) {
    const cluster = clusters.at(-1)
    const anchor = cluster?.[0]?.time
    if (cluster && anchor !== undefined && Math.abs(item.time - anchor) <= tolerance) {
      cluster.push(item)
    } else {
      clusters.push([item])
    }
  }

  // A bar contains N note attacks plus the next bar's boundary. When there
  // are exactly N musical events, map them one-to-one to those attacks rather
  // than stretching the last event onto the following bar and skipping a note.
  const slots =
    allSlots.length > 1 && clusters.length === allSlots.length - 1
      ? allSlots.slice(0, -1)
      : allSlots

  if (clusters.length > slots.length) {
    return {
      ok: false,
      times: [...keyframeTimes],
      availableSlots: slots.length,
      reason: 'insufficient-grid-slots',
    }
  }
  if (clusters.length === 1) {
    const source = clusters[0]![0]!.time
    const nearest = slots.reduce((best, slot) =>
      Math.abs(slot - source) < Math.abs(best - source) ? slot : best,
    )
    return {
      ok: true,
      times: keyframeTimes.map(() => nearest),
      availableSlots: slots.length,
    }
  }

  const lastSlot = slots.length - 1
  const lastCluster = clusters.length - 1
  const times = [...keyframeTimes]
  clusters.forEach((cluster, clusterIndex) => {
    const slotIndex = Math.round(clusterIndex * lastSlot / lastCluster)
    for (const item of cluster) times[item.index] = slots[slotIndex]!
  })
  return { ok: true, times, availableSlots: slots.length }
}

function mixToMono(channels: readonly Float32Array[]): Float32Array {
  const length = channels.reduce(
    (max, channel) => Math.max(max, channel.length),
    0,
  )
  const mono = new Float32Array(length)
  if (channels.length === 0) return mono
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i++) mono[i] += channel[i]!
  }
  const scale = 1 / channels.length
  for (let i = 0; i < mono.length; i++) mono[i] *= scale
  return mono
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
  noveltyRate: number,
  minBpm: number,
  maxBpm: number,
): TempoCandidate[] {
  const scored: Array<{ bpm: number; score: number }> = []
  for (let bpm = minBpm; bpm <= maxBpm; bpm += 0.25) {
    const lag = noveltyRate * 60 / bpm
    const score =
      correlationAtLag(novelty, lag) +
      correlationAtLag(novelty, lag * 2) * 0.35 +
      correlationAtLag(novelty, lag / 2) * 0.15
    // A gentle centre-tempo prior resolves common half/double-time ties while
    // remaining weak enough for a clear 70 or 180 BPM pulse to win.
    const prior = 0.92 + 0.08 * Math.exp(-Math.pow((bpm - 120) / 55, 2))
    scored.push({ bpm, score: score * prior })
  }
  scored.sort((a, b) => b.score - a.score)
  const winnerScore = Math.max(EPSILON, scored[0]?.score ?? 0)
  const separated: TempoCandidate[] = []
  for (const item of scored) {
    if (separated.some((candidate) => Math.abs(candidate.bpm - item.bpm) < 2)) {
      continue
    }
    separated.push({
      bpm: round(item.bpm, 3),
      confidence: round(clamp(item.score / winnerScore, 0, 1), 4),
    })
    if (separated.length === 4) break
  }
  const runnerUp = separated[1]?.confidence ?? 0
  if (separated[0]) {
    separated[0].confidence = round(clamp(1 - runnerUp * 0.65, 0, 1), 4)
  }
  return separated
}

/**
 * Resolve common low-tempo ambiguities when a musically useful quarter-note
 * interpretation is nearly as strong. Genuine slow material stays untouched,
 * while half-time and dotted-quarter accent patterns get a practical grid.
 */
function selectTempoCandidate(
  candidates: readonly TempoCandidate[],
): TempoCandidate | undefined {
  const primary = candidates[0]
  if (!primary) return undefined
  if (primary.bpm >= 85 || primary.confidence >= 0.65) return primary

  const doubled = candidates.find(
    (candidate, index) =>
      index > 0 &&
      Math.abs(candidate.bpm - primary.bpm * 2) <= 3 &&
      candidate.confidence >= 0.55,
  )
  if (doubled) {
    // Keep the ambiguity reflected in confidence even though we choose the
    // more useful double-time interpretation.
    return { bpm: doubled.bpm, confidence: primary.confidence }
  }

  // Syncopated material frequently emphasizes dotted quarter notes, making
  // the autocorrelation prefer two beats for every three quarter-note beats
  // (for example 76 instead of 114 BPM). When the underlying 3:2 candidate is
  // also strong, prefer it as the editable quarter-note grid.
  const threeOverTwo = candidates.find(
    (candidate, index) =>
      index > 0 &&
      Math.abs(candidate.bpm - primary.bpm * 1.5) <= 3 &&
      candidate.confidence >= 0.6,
  )
  if (threeOverTwo) {
    return { bpm: threeOverTwo.bpm, confidence: primary.confidence }
  }

  return primary
}

function correlationAtLag(values: Float32Array, lag: number): number {
  const whole = Math.floor(lag)
  const fraction = lag - whole
  if (whole < 1 || whole >= values.length - 1) return 0
  let score = 0
  let normA = 0
  let normB = 0
  for (let i = whole + 1; i < values.length; i++) {
    const shifted =
      values[i - whole]! * (1 - fraction) +
      values[i - whole - 1]! * fraction
    const current = values[i]!
    score += current * shifted
    normA += current * current
    normB += shifted * shifted
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
