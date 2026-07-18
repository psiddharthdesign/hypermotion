// SPDX-License-Identifier: Apache-2.0

export type DofRenderQuality = 'high' | 'ultra' | 'cinematic'

export interface ApertureBokehSample {
  /** Horizontal kernel offset, in output pixels. */
  x: number
  /** Vertical kernel offset, in output pixels. */
  y: number
}

export interface ApertureBokehPlan {
  quality: DofRenderQuality
  /** Effective lens blur, capped by the authored Max Blur value upstream. */
  blurPx: number
  /** Small prefilter that prevents visible gaps between aperture samples. */
  prefilterPx: number
  /** Edge-extension required to keep every shifted sample inside the image. */
  paddingPx: number
  samples: ApertureBokehSample[]
}

export interface ApertureBokehOptions {
  width: number
  height: number
  /** Already physically resolved and capped by the authored Max Blur. */
  blurPx: number
  /** Values below three (or omitted) use a circular aperture. */
  bladeCount?: number
  bladeRotation?: number
  /** 1 is round; values above one stretch horizontally. */
  bokehRatio?: number
  quality?: DofRenderQuality
  /** Backwards-compatible export quality hint used before named tiers existed. */
  legacyQuality?: number
}

const QUALITY_LIMITS: Record<
  DofRenderQuality,
  { minSamples: number; maxSamples: number; pixelBudget: number }
> = {
  // Pixel budgets cap the amount of full-frame compositing per exported frame.
  // They retain visibly distinct tiers without letting a 4K render allocate an
  // unbounded number of canvas passes.
  high: { minSamples: 8, maxSamples: 12, pixelBudget: 72_000_000 },
  ultra: { minSamples: 12, maxSamples: 24, pixelBudget: 168_000_000 },
  cinematic: { minSamples: 20, maxSamples: 40, pixelBudget: 336_000_000 },
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

export function resolveDofRenderQuality(
  quality: DofRenderQuality | string | null | undefined,
  legacyQuality = 24,
): DofRenderQuality {
  if (quality === 'high' || quality === 'ultra' || quality === 'cinematic') {
    return quality
  }
  // Numeric export samples default to the Balanced floor of 24. Lower values
  // are retained only for backwards compatibility with legacy scenes; the GPU
  // renderer independently clamps those scenes to the same effective floor.
  if (!Number.isFinite(legacyQuality) || legacyQuality <= 4) return 'high'
  if (legacyQuality <= 9) return 'ultra'
  return 'cinematic'
}

/**
 * Build a deterministic aperture convolution plan for a single export frame.
 * It performs no DOM work, making the expensive renderer predictable and the
 * quality/performance policy independently testable.
 */
export function buildApertureBokehPlan(
  options: ApertureBokehOptions,
): ApertureBokehPlan {
  const width = Math.max(1, Math.floor(finiteOr(options.width, 1)))
  const height = Math.max(1, Math.floor(finiteOr(options.height, 1)))
  const quality = resolveDofRenderQuality(
    options.quality,
    options.legacyQuality,
  )
  const limits = QUALITY_LIMITS[quality]
  const effectiveBlur = clamp(
    Math.max(0, finiteOr(options.blurPx, 0)),
    0,
    128,
  )
  const pixels = width * height
  const resolutionLimit = Math.max(
    limits.minSamples,
    Math.floor(limits.pixelBudget / Math.max(1, pixels)),
  )
  // Tiny blur kernels converge quickly. Large defocus receives the complete
  // tier budget, where extra samples most noticeably improve highlight shape.
  const blurLimit = Math.ceil(7 + Math.sqrt(effectiveBlur) * 3.25)
  const desiredSamples = clampInt(
    Math.min(limits.maxSamples, resolutionLimit, blurLimit),
    limits.minSamples,
    limits.maxSamples,
  )

  const bladeCount = clampInt(
    Math.round(finiteOr(options.bladeCount, 0)),
    0,
    16,
  )
  const rotation = degreesToRadians(finiteOr(options.bladeRotation, 0))
  const ratio = clamp(finiteOr(options.bokehRatio, 1), 0.25, 4)
  const normalizedSamples =
    bladeCount >= 3
      ? buildPolygonSamples(desiredSamples, bladeCount, rotation)
      : buildRoundSamples(desiredSamples, rotation)
  const ratioRoot = Math.sqrt(ratio)

  // A uniform aperture disk has roughly half the standard deviation of its
  // radius, so a 2x kernel radius retains the strength of the previous CSS
  // Gaussian while revealing actual blade shape around highlights.
  const kernelRadius = effectiveBlur * 2
  const samples = normalizedSamples.map((sample) => ({
    x: sample.x * kernelRadius * ratioRoot,
    y: sample.y * kernelRadius / ratioRoot,
  }))
  const maxOffset = samples.reduce(
    (max, sample) => Math.max(max, Math.abs(sample.x), Math.abs(sample.y)),
    0,
  )
  const prefilterPx =
    effectiveBlur <= 0.05
      ? 0
      : clamp(
          (kernelRadius / Math.sqrt(Math.max(1, samples.length))) *
            (quality === 'high' ? 0.42 : quality === 'ultra' ? 0.32 : 0.24),
          0.35,
          quality === 'high' ? 3.5 : quality === 'ultra' ? 2.75 : 2.25,
        )
  const paddingPx = Math.max(
    4,
    Math.ceil(maxOffset + prefilterPx * 3 + 2),
  )

  return {
    quality,
    blurPx: effectiveBlur,
    prefilterPx,
    paddingPx,
    samples,
  }
}

/**
 * Circular samples are emitted as mirrored Vogel pairs. Every plan therefore
 * has an exactly centred kernel instead of making the exported image drift.
 */
function buildRoundSamples(
  desiredSamples: number,
  rotation: number,
): ApertureBokehSample[] {
  const pairCount = Math.max(1, Math.floor((desiredSamples - 1) / 2))
  const samples: ApertureBokehSample[] = [{ x: 0, y: 0 }]
  for (let pair = 0; pair < pairCount; pair += 1) {
    const radius = Math.sqrt((pair + 0.5) / pairCount)
    const angle = rotation + pair * GOLDEN_ANGLE
    const x = Math.cos(angle) * radius
    const y = Math.sin(angle) * radius
    samples.push({ x, y }, { x: -x, y: -y })
  }
  return samples
}

/**
 * Sample a regular diaphragm as concentric triangle-fan orbits. Candidate
 * points cover complete blade orbits, then an evenly distributed subset is
 * selected and recentered. This preserves the aperture silhouette while
 * honouring the quality tier's exact sample budget.
 */
function buildPolygonSamples(
  desiredSamples: number,
  bladeCount: number,
  rotation: number,
): ApertureBokehSample[] {
  const requestedSamples = Math.max(1, Math.floor(desiredSamples))
  const apertureSamples = Math.max(0, requestedSamples - 1)
  if (apertureSamples === 0) return [{ x: 0, y: 0 }]

  const orbitCount = Math.max(1, Math.ceil(apertureSamples / bladeCount))
  const candidates: ApertureBokehSample[] = []
  const sector = (Math.PI * 2) / bladeCount

  for (let orbit = 0; orbit < orbitCount; orbit += 1) {
    // sqrt(area) uniformly distributes each orbit from centre to perimeter.
    const radiusMix = Math.sqrt((orbit + 0.5) / orbitCount)
    const edgeMix = radicalInverseBase2(orbit + 1)
    for (let blade = 0; blade < bladeCount; blade += 1) {
      const a = rotation + blade * sector
      const b = a + sector
      candidates.push({
        x:
          radiusMix *
          ((1 - edgeMix) * Math.cos(a) + edgeMix * Math.cos(b)),
        y:
          radiusMix *
          ((1 - edgeMix) * Math.sin(a) + edgeMix * Math.sin(b)),
      })
    }
  }

  const samples: ApertureBokehSample[] = [{ x: 0, y: 0 }]
  for (let index = 0; index < apertureSamples; index += 1) {
    const candidateIndex = Math.floor(
      (index * candidates.length) / apertureSamples,
    )
    samples.push(candidates[candidateIndex]!)
  }
  return recenterSamples(samples)
}

function recenterSamples(
  samples: ApertureBokehSample[],
): ApertureBokehSample[] {
  const centroid = samples.reduce(
    (sum, sample) => ({ x: sum.x + sample.x, y: sum.y + sample.y }),
    { x: 0, y: 0 },
  )
  centroid.x /= samples.length
  centroid.y /= samples.length
  return samples.map((sample) => ({
    x: sample.x - centroid.x,
    y: sample.y - centroid.y,
  }))
}

function radicalInverseBase2(value: number): number {
  let bits = Math.max(0, Math.floor(value))
  let inverse = 0
  let fraction = 0.5
  while (bits > 0) {
    inverse += (bits & 1) * fraction
    bits = Math.floor(bits / 2)
    fraction *= 0.5
  }
  return inverse
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180
}

function finiteOr(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? (value as number) : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function clampInt(value: number, min: number, max: number): number {
  return Math.round(clamp(value, min, max))
}
