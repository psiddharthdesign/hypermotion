// SPDX-License-Identifier: Apache-2.0

/**
 * Stable scene identifiers for every shader exported by
 * `@paper-design/shaders-react@0.0.77`.
 *
 * These ids are persisted in `.hype` files, so they must not be renamed when
 * a UI label changes. Add aliases during migration instead of changing an id.
 */
export const PAPER_SHADER_TYPES = [
  'mesh-gradient',
  'smoke-ring',
  'neuro-noise',
  'dot-orbit',
  'dot-grid',
  'simplex-noise',
  'metaballs',
  'waves',
  'perlin-noise',
  'voronoi',
  'warp',
  'god-rays',
  'spiral',
  'swirl',
  'dithering',
  'grain-gradient',
  'pulsing-border',
  'color-panels',
  'static-mesh-gradient',
  'static-radial-gradient',
  'paper-texture',
  'fluted-glass',
  'water',
  'image-dithering',
  'halftone-dots',
  'halftone-cmyk',
  'heatmap',
  'liquid-metal',
  'gem-smoke',
] as const

export type PaperShaderType = (typeof PAPER_SHADER_TYPES)[number]
export type PaperShaderCategory = 'generated' | 'image-filter' | 'shape'

export type PaperShaderParamValue =
  | string
  | number
  | boolean
  | null
  | PaperShaderParamValue[]
  | { [key: string]: PaperShaderParamValue }

export type PaperShaderParams = Record<string, PaperShaderParamValue>

export interface PaperShaderDefaults {
  /** Empty when the shader uses named colors instead of a color array. */
  colors: readonly string[]
  /** Scene-time multiplier. Zero freezes the shader. */
  speed: number
  /** Paper's global graphic scale. */
  scale: number
  /** Shader-specific Paper props, excluding image/frame/colors/speed/scale. */
  params: Readonly<PaperShaderParams>
}

export interface PaperShaderDefinition {
  /** Stable persisted id. `type` is retained as a UI-friendly synonym. */
  id: PaperShaderType
  type: PaperShaderType
  label: string
  category: PaperShaderCategory
  /** The shader cannot produce its intended result without an image source. */
  requiresImage: boolean
  /** The shader accepts either `sourceNodeId` or `sourceImage`. */
  acceptsImage: boolean
  /** Maximum accepted length of the common `colors` array. */
  maxColors: number
  defaults: PaperShaderDefaults
}

export const DEFAULT_PAPER_SHADER_TYPE: PaperShaderType = 'mesh-gradient'
export const PAPER_SHADER_HEX_COLOR =
  /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i

const PAPER_SHADER_TYPE_SET: ReadonlySet<string> = new Set(PAPER_SHADER_TYPES)

const DEFAULT_SIZING_PARAMS = {
  fit: 'contain',
  rotation: 0,
  offsetX: 0,
  offsetY: 0,
  originX: 0.5,
  originY: 0.5,
} as const

function definition(
  id: PaperShaderType,
  label: string,
  category: PaperShaderCategory,
  options: {
    requiresImage?: boolean
    acceptsImage?: boolean
    maxColors?: number
    colors?: readonly string[]
    speed?: number
    scale?: number
    params?: PaperShaderParams
  } = {},
): PaperShaderDefinition {
  return {
    id,
    type: id,
    label,
    category,
    requiresImage: options.requiresImage ?? false,
    acceptsImage: options.acceptsImage ?? false,
    maxColors: options.maxColors ?? 10,
    defaults: {
      colors: options.colors ?? [],
      speed: options.speed ?? 0,
      scale: options.scale ?? 1,
      params: options.params ?? {},
    },
  }
}

/**
 * UI-ready catalog in the same order as Paper's React package: generated
 * shaders first, followed by image filters and image/shape effects.
 */
export const PAPER_SHADER_CATALOG: readonly PaperShaderDefinition[] = [
  definition('mesh-gradient', 'Mesh Gradient', 'generated', {
    colors: ['#e0eaff', '#241d9a', '#f75092', '#9f50d3'],
    speed: 0.6,
    params: {
      ...DEFAULT_SIZING_PARAMS,
      distortion: 0.8,
      swirl: 0.1,
      grainMixer: 0,
      grainOverlay: 0.08,
    },
  }),
  definition('smoke-ring', 'Smoke Ring', 'generated', {
    colors: ['#ffffff'],
    speed: 0.5,
    scale: 0.8,
    params: {
      ...DEFAULT_SIZING_PARAMS,
      colorBack: '#000000',
      noiseScale: 3,
      noiseIterations: 8,
      radius: 0.25,
      thickness: 0.65,
      innerShape: 0.7,
    },
  }),
  definition('neuro-noise', 'Neuro Noise', 'generated', {
    speed: 1,
    params: {
      ...DEFAULT_SIZING_PARAMS,
      fit: 'none',
      colorFront: '#ffffff',
      colorMid: '#47a6ff',
      colorBack: '#000000',
      brightness: 0.05,
      contrast: 0.3,
    },
  }),
  definition('dot-orbit', 'Dot Orbit', 'generated', {
    colors: ['#ffc96b', '#ff6200', '#ff2f00', '#421100', '#1a0000'],
    speed: 1.5,
    params: {
      ...DEFAULT_SIZING_PARAMS,
      fit: 'none',
      colorBack: '#000000',
      size: 1,
      sizeRange: 0,
      spreading: 1,
      stepsPerColor: 4,
    },
  }),
  definition('dot-grid', 'Dot Grid', 'generated', {
    params: {
      ...DEFAULT_SIZING_PARAMS,
      fit: 'none',
      colorBack: '#000000',
      colorFill: '#ffffff',
      colorStroke: '#ffaa00',
      size: 2,
      gapX: 32,
      gapY: 32,
      strokeWidth: 0,
      sizeRange: 0,
      opacityRange: 0,
      shape: 'circle',
    },
  }),
  definition('simplex-noise', 'Simplex Noise', 'generated', {
    colors: ['#4449cf', '#ffd1e0', '#f94446', '#ffd36b', '#ffffff'],
    speed: 0.5,
    scale: 0.6,
    params: {
      ...DEFAULT_SIZING_PARAMS,
      fit: 'none',
      stepsPerColor: 2,
      softness: 0,
    },
  }),
  definition('metaballs', 'Metaballs', 'generated', {
    colors: ['#6e33cc', '#ff5500', '#ffc105', '#ffc800', '#f585ff'],
    speed: 1,
    maxColors: 8,
    params: {
      ...DEFAULT_SIZING_PARAMS,
      colorBack: '#000000',
      count: 10,
      size: 0.83,
    },
  }),
  definition('waves', 'Waves', 'generated', {
    scale: 0.6,
    params: {
      ...DEFAULT_SIZING_PARAMS,
      fit: 'none',
      colorFront: '#ffbb00',
      colorBack: '#000000',
      shape: 0,
      frequency: 0.5,
      amplitude: 0.5,
      spacing: 1.2,
      proportion: 0.1,
      softness: 0,
    },
  }),
  definition('perlin-noise', 'Perlin Noise', 'generated', {
    speed: 0.5,
    params: {
      ...DEFAULT_SIZING_PARAMS,
      fit: 'none',
      colorBack: '#632ad5',
      colorFront: '#fccff7',
      proportion: 0.35,
      softness: 0.1,
      octaveCount: 1,
      persistence: 1,
      lacunarity: 1.5,
    },
  }),
  definition('voronoi', 'Voronoi', 'generated', {
    colors: ['#ff8247', '#ffe53d'],
    speed: 0.5,
    scale: 0.5,
    maxColors: 5,
    params: {
      ...DEFAULT_SIZING_PARAMS,
      fit: 'none',
      stepsPerColor: 3,
      colorGlow: '#ffffff',
      colorGap: '#2e0000',
      distortion: 0.4,
      gap: 0.04,
      glow: 0,
    },
  }),
  definition('warp', 'Warp', 'generated', {
    colors: ['#121212', '#9470ff', '#121212', '#8838ff'],
    speed: 1,
    params: {
      ...DEFAULT_SIZING_PARAMS,
      fit: 'none',
      proportion: 0.45,
      softness: 1,
      distortion: 0.25,
      swirl: 0.8,
      swirlIterations: 10,
      shapeScale: 0.1,
      shape: 'checks',
    },
  }),
  definition('god-rays', 'God Rays', 'generated', {
    colors: ['#a600ff6e', '#6200fff0', '#ffffff', '#33fff5'],
    speed: 0.75,
    maxColors: 5,
    params: {
      ...DEFAULT_SIZING_PARAMS,
      offsetY: -0.55,
      colorBack: '#000000',
      colorBloom: '#0000ff',
      density: 0.3,
      spotty: 0.3,
      midIntensity: 0.4,
      midSize: 0.2,
      intensity: 0.8,
      bloom: 0.4,
    },
  }),
  definition('spiral', 'Spiral', 'generated', {
    speed: 1,
    params: {
      ...DEFAULT_SIZING_PARAMS,
      fit: 'none',
      colorBack: '#001429',
      colorFront: '#79d1ff',
      density: 1,
      distortion: 0,
      strokeWidth: 0.5,
      strokeTaper: 0,
      strokeCap: 0,
      noise: 0,
      noiseFrequency: 0,
      softness: 0,
    },
  }),
  definition('swirl', 'Swirl', 'generated', {
    colors: ['#ffd1d1', '#ff8a8a', '#660000'],
    speed: 0.32,
    params: {
      ...DEFAULT_SIZING_PARAMS,
      colorBack: '#330000',
      bandCount: 4,
      twist: 0.1,
      center: 0.2,
      proportion: 0.5,
      softness: 0,
      noiseFrequency: 0.4,
      noise: 0.2,
    },
  }),
  definition('dithering', 'Dithering', 'generated', {
    speed: 1,
    scale: 0.6,
    params: {
      ...DEFAULT_SIZING_PARAMS,
      fit: 'none',
      colorBack: '#000000',
      colorFront: '#00b2ff',
      shape: 'sphere',
      type: '4x4',
      size: 2,
    },
  }),
  definition('grain-gradient', 'Grain Gradient', 'generated', {
    colors: ['#7300ff', '#eba8ff', '#00bfff', '#2a00ff'],
    speed: 1,
    maxColors: 7,
    params: {
      ...DEFAULT_SIZING_PARAMS,
      colorBack: '#000000',
      softness: 0.5,
      intensity: 0.5,
      noise: 0.25,
      shape: 'corners',
    },
  }),
  definition('pulsing-border', 'Pulsing Border', 'generated', {
    colors: ['#0dc1fd', '#d915ef', '#ff3f2ecc'],
    speed: 1,
    scale: 0.6,
    maxColors: 5,
    params: {
      ...DEFAULT_SIZING_PARAMS,
      colorBack: '#000000',
      roundness: 0.25,
      thickness: 0.1,
      margin: 0,
      aspectRatio: 'auto',
      softness: 0.75,
      intensity: 0.2,
      bloom: 0.25,
      spots: 4,
      spotSize: 0.5,
      pulse: 0.25,
      smoke: 0.3,
      smokeSize: 0.6,
    },
  }),
  definition('color-panels', 'Color Panels', 'generated', {
    colors: [
      '#ff9d00',
      '#fd4f30',
      '#809bff',
      '#6d2eff',
      '#333aff',
      '#f15cff',
      '#ffd557',
    ],
    speed: 0.5,
    scale: 0.8,
    maxColors: 7,
    params: {
      ...DEFAULT_SIZING_PARAMS,
      colorBack: '#000000',
      angle1: 0,
      angle2: 0,
      length: 1.1,
      edges: false,
      blur: 0,
      fadeIn: 1,
      fadeOut: 0.3,
      gradient: 0,
      density: 3,
    },
  }),
  definition('static-mesh-gradient', 'Static Mesh Gradient', 'generated', {
    colors: ['#ffad0a', '#6200ff', '#e2a3ff', '#ff99fd'],
    params: {
      ...DEFAULT_SIZING_PARAMS,
      rotation: 270,
      positions: 2,
      waveX: 1,
      waveXShift: 0.6,
      waveY: 1,
      waveYShift: 0.21,
      mixing: 0.93,
      grainMixer: 0,
      grainOverlay: 0,
    },
  }),
  definition('static-radial-gradient', 'Static Radial Gradient', 'generated', {
    colors: ['#00bbff', '#00ffe1', '#ffffff'],
    params: {
      ...DEFAULT_SIZING_PARAMS,
      colorBack: '#000000',
      radius: 0.8,
      focalDistance: 0.99,
      focalAngle: 0,
      falloff: 0.24,
      mixing: 0.5,
      distortion: 0,
      distortionShift: 0,
      distortionFreq: 12,
      grainMixer: 0,
      grainOverlay: 0,
    },
  }),
  definition('paper-texture', 'Paper Texture', 'image-filter', {
    acceptsImage: true,
    scale: 0.6,
    params: {
      ...DEFAULT_SIZING_PARAMS,
      fit: 'cover',
      colorFront: '#9fadbc',
      colorBack: '#ffffff',
      contrast: 0.3,
      roughness: 0.4,
      fiber: 0.3,
      fiberSize: 0.2,
      crumples: 0.3,
      crumpleSize: 0.35,
      folds: 0.65,
      foldCount: 5,
      fade: 0,
      drops: 0.2,
      seed: 5.8,
    },
  }),
  definition('fluted-glass', 'Fluted Glass', 'image-filter', {
    acceptsImage: true,
    requiresImage: true,
    params: {
      ...DEFAULT_SIZING_PARAMS,
      fit: 'cover',
      colorBack: '#00000000',
      colorShadow: '#000000',
      colorHighlight: '#ffffff',
      shadows: 0.25,
      size: 0.5,
      angle: 0,
      distortionShape: 'prism',
      highlights: 0.1,
      shape: 'lines',
      distortion: 0.5,
      shift: 0,
      blur: 0,
      edges: 0.25,
      stretch: 0,
      margin: 0,
      grainMixer: 0,
      grainOverlay: 0,
    },
  }),
  definition('water', 'Water', 'image-filter', {
    acceptsImage: true,
    speed: 1,
    scale: 0.8,
    params: {
      ...DEFAULT_SIZING_PARAMS,
      colorBack: '#909090',
      colorHighlight: '#ffffff',
      highlights: 0.07,
      layering: 0.5,
      edges: 0.8,
      waves: 0.3,
      caustic: 0.1,
      size: 1,
    },
  }),
  definition('image-dithering', 'Image Dithering', 'image-filter', {
    acceptsImage: true,
    requiresImage: true,
    params: {
      ...DEFAULT_SIZING_PARAMS,
      fit: 'cover',
      colorFront: '#94ffaf',
      colorBack: '#000c38',
      colorHighlight: '#eaff94',
      type: '8x8',
      size: 2,
      colorSteps: 2,
      originalColors: false,
      inverted: false,
    },
  }),
  definition('halftone-dots', 'Halftone Dots', 'image-filter', {
    acceptsImage: true,
    requiresImage: true,
    params: {
      ...DEFAULT_SIZING_PARAMS,
      fit: 'cover',
      colorBack: '#f2f1e8',
      colorFront: '#2b2b2b',
      size: 0.5,
      radius: 1.25,
      contrast: 0.4,
      originalColors: false,
      inverted: false,
      grainMixer: 0.2,
      grainOverlay: 0.2,
      grainSize: 0.5,
      grid: 'hex',
      type: 'gooey',
    },
  }),
  definition('halftone-cmyk', 'Halftone CMYK', 'image-filter', {
    acceptsImage: true,
    requiresImage: true,
    params: {
      ...DEFAULT_SIZING_PARAMS,
      fit: 'cover',
      colorBack: '#fbfaf5',
      colorC: '#00b4ff',
      colorM: '#fc519f',
      colorY: '#ffd800',
      colorK: '#231f20',
      size: 0.2,
      contrast: 1,
      softness: 1,
      grainSize: 0.5,
      grainMixer: 0,
      grainOverlay: 0,
      gridNoise: 0.2,
      floodC: 0.15,
      floodM: 0,
      floodY: 0,
      floodK: 0,
      gainC: 0.3,
      gainM: 0,
      gainY: 0.2,
      gainK: 0,
      type: 'ink',
    },
  }),
  definition('heatmap', 'Heatmap', 'shape', {
    acceptsImage: true,
    requiresImage: true,
    colors: [
      '#11206a',
      '#1f3ba2',
      '#2f63e7',
      '#6bd7ff',
      '#ffe679',
      '#ff991e',
      '#ff4c00',
    ],
    speed: 1,
    scale: 0.75,
    params: {
      ...DEFAULT_SIZING_PARAMS,
      colorBack: '#000000',
      contour: 0.5,
      angle: 0,
      noise: 0,
      innerGlow: 0.5,
      outerGlow: 0.5,
    },
  }),
  definition('liquid-metal', 'Liquid Metal', 'shape', {
    acceptsImage: true,
    speed: 1,
    scale: 0.6,
    params: {
      ...DEFAULT_SIZING_PARAMS,
      colorBack: '#aaaaac',
      colorTint: '#ffffff',
      distortion: 0.07,
      repetition: 2,
      shiftRed: 0.3,
      shiftBlue: 0.3,
      contour: 0.4,
      softness: 0.1,
      angle: 70,
      shape: 'diamond',
    },
  }),
  definition('gem-smoke', 'Gem Smoke', 'shape', {
    acceptsImage: true,
    colors: ['#333333', '#e7e6df'],
    speed: 1,
    scale: 0.6,
    maxColors: 6,
    params: {
      ...DEFAULT_SIZING_PARAMS,
      colorBack: '#f0efea',
      colorInner: '#fafaf5',
      outerGlow: 0.55,
      innerGlow: 1,
      innerDistortion: 0.8,
      outerDistortion: 0.6,
      offset: 0,
      angle: 0,
      size: 0.8,
      shape: 'diamond',
    },
  }),
]

const PAPER_SHADER_BY_TYPE = new Map(
  PAPER_SHADER_CATALOG.map((entry) => [entry.type, entry] as const),
)

export function isPaperShaderType(value: unknown): value is PaperShaderType {
  return typeof value === 'string' && PAPER_SHADER_TYPE_SET.has(value)
}

export function normalizePaperShaderType(value: unknown): PaperShaderType {
  return isPaperShaderType(value) ? value : DEFAULT_PAPER_SHADER_TYPE
}

export function getPaperShaderDefinition(
  type: PaperShaderType,
): PaperShaderDefinition {
  return (
    PAPER_SHADER_BY_TYPE.get(type) ??
    PAPER_SHADER_BY_TYPE.get(DEFAULT_PAPER_SHADER_TYPE)!
  )
}

export function normalizePaperShaderColors(
  value: unknown,
  type: PaperShaderType = DEFAULT_PAPER_SHADER_TYPE,
): string[] {
  const definition = getPaperShaderDefinition(type)
  if (!Array.isArray(value)) return [...definition.defaults.colors]
  const colors = value
    .filter(
      (color): color is string =>
        typeof color === 'string' && PAPER_SHADER_HEX_COLOR.test(color),
    )
    .slice(0, definition.maxColors)
  if (colors.length > 0 || definition.defaults.colors.length === 0) {
    return colors
  }
  return [...definition.defaults.colors]
}

const MAX_PARAM_DEPTH = 6
const MAX_PARAM_COLLECTION_LENGTH = 128
const MAX_PARAM_STRING_LENGTH = 32_768
const MAX_PARAM_NUMBER_MAGNITUDE = 1_000_000
const UNSAFE_PARAM_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function normalizeParamValue(
  value: unknown,
  depth: number,
): PaperShaderParamValue | undefined {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined
    return Math.max(
      -MAX_PARAM_NUMBER_MAGNITUDE,
      Math.min(MAX_PARAM_NUMBER_MAGNITUDE, value),
    )
  }
  if (typeof value === 'string') return value.slice(0, MAX_PARAM_STRING_LENGTH)
  if (depth >= MAX_PARAM_DEPTH) return undefined
  if (Array.isArray(value)) {
    const normalized: PaperShaderParamValue[] = []
    for (const item of value.slice(0, MAX_PARAM_COLLECTION_LENGTH)) {
      const next = normalizeParamValue(item, depth + 1)
      if (next !== undefined) normalized.push(next)
    }
    return normalized
  }
  if (typeof value !== 'object') return undefined
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return undefined
  const normalized: PaperShaderParams = {}
  for (const [key, item] of Object.entries(value).slice(
    0,
    MAX_PARAM_COLLECTION_LENGTH,
  )) {
    if (UNSAFE_PARAM_KEYS.has(key)) continue
    const next = normalizeParamValue(item, depth + 1)
    if (next !== undefined) normalized[key] = next
  }
  return normalized
}

export function normalizePaperShaderParams(
  value: unknown,
  defaults: Readonly<PaperShaderParams> = {},
): PaperShaderParams {
  const normalizedDefaults = normalizeParamValue(defaults, 0)
  const normalizedValue = normalizeParamValue(value, 0)
  return {
    ...(isParamRecord(normalizedDefaults) ? normalizedDefaults : {}),
    ...(isParamRecord(normalizedValue) ? normalizedValue : {}),
  }
}

export function normalizePaperShaderSourceImage(
  value: unknown,
): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

export function normalizePaperShaderSourceNodeId(
  value: unknown,
): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= 512 ? trimmed : undefined
}

function isParamRecord(
  value: PaperShaderParamValue | undefined,
): value is PaperShaderParams {
  return value !== undefined && !Array.isArray(value) && typeof value === 'object'
}
