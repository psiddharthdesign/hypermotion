// SPDX-License-Identifier: Apache-2.0

import type { ComponentType, Ref } from 'react'
import {
  ColorPanels,
  Dithering,
  DotGrid,
  DotOrbit,
  FlutedGlass,
  GemSmoke,
  GodRays,
  GrainGradient,
  HalftoneCmyk,
  HalftoneDots,
  Heatmap,
  ImageDithering,
  LiquidMetal,
  MeshGradient,
  Metaballs,
  NeuroNoise,
  PaperTexture,
  PerlinNoise,
  PulsingBorder,
  SimplexNoise,
  SmokeRing,
  Spiral,
  StaticMeshGradient,
  StaticRadialGradient,
  Swirl,
  Voronoi,
  Warp,
  Water,
  Waves,
  colorPanelsPresets,
  ditheringPresets,
  dotGridPresets,
  dotOrbitPresets,
  flutedGlassPresets,
  gemSmokePresets,
  godRaysPresets,
  grainGradientPresets,
  halftoneCmykPresets,
  halftoneDotsPresets,
  heatmapPresets,
  imageDitheringPresets,
  liquidMetalPresets,
  meshGradientPresets,
  metaballsPresets,
  neuroNoisePresets,
  paperTexturePresets,
  perlinNoisePresets,
  pulsingBorderPresets,
  simplexNoisePresets,
  smokeRingPresets,
  spiralPresets,
  staticMeshGradientPresets,
  staticRadialGradientPresets,
  swirlPresets,
  voronoiPresets,
  warpPresets,
  waterPresets,
  wavesPresets,
  type PaperShaderElement,
} from '@paper-design/shaders-react'
import type { SceneAPI } from '@/scene'
import type { Node, PaperShaderType } from '@/scene'
import { getPaperShaderDefinition } from '@/scene/paperShaders'

type ShaderNode = Extract<Node, { kind: 'shader' }>

type PaperRuntimeProps = Record<string, unknown> & {
  ref?: Ref<PaperShaderElement>
}

export type PaperShaderRuntimeComponent = ComponentType<PaperRuntimeProps>

interface PaperPreset {
  params: Record<string, unknown>
}

export interface PaperShaderRendererDefinition {
  component: PaperShaderRuntimeComponent
  defaultParams: Readonly<Record<string, unknown>>
}

function renderer(
  component: unknown,
  presets: readonly unknown[],
): PaperShaderRendererDefinition {
  const firstPreset = presets[0] as PaperPreset | undefined
  return {
    component: component as PaperShaderRuntimeComponent,
    defaultParams: firstPreset?.params ?? {},
  }
}

/**
 * Exhaustive bridge from stable scene ids to the pinned Paper React exports.
 * The `satisfies` clause makes a newly-added scene id a compile error until
 * its renderer is deliberately wired up.
 */
export const PAPER_SHADER_RENDERERS = {
  'mesh-gradient': renderer(MeshGradient, meshGradientPresets),
  'smoke-ring': renderer(SmokeRing, smokeRingPresets),
  'neuro-noise': renderer(NeuroNoise, neuroNoisePresets),
  'dot-orbit': renderer(DotOrbit, dotOrbitPresets),
  'dot-grid': renderer(DotGrid, dotGridPresets),
  'simplex-noise': renderer(SimplexNoise, simplexNoisePresets),
  metaballs: renderer(Metaballs, metaballsPresets),
  waves: renderer(Waves, wavesPresets),
  'perlin-noise': renderer(PerlinNoise, perlinNoisePresets),
  voronoi: renderer(Voronoi, voronoiPresets),
  warp: renderer(Warp, warpPresets),
  'god-rays': renderer(GodRays, godRaysPresets),
  spiral: renderer(Spiral, spiralPresets),
  swirl: renderer(Swirl, swirlPresets),
  dithering: renderer(Dithering, ditheringPresets),
  'grain-gradient': renderer(GrainGradient, grainGradientPresets),
  'pulsing-border': renderer(PulsingBorder, pulsingBorderPresets),
  'color-panels': renderer(ColorPanels, colorPanelsPresets),
  'static-mesh-gradient': renderer(
    StaticMeshGradient,
    staticMeshGradientPresets,
  ),
  'static-radial-gradient': renderer(
    StaticRadialGradient,
    staticRadialGradientPresets,
  ),
  'paper-texture': renderer(PaperTexture, paperTexturePresets),
  'fluted-glass': renderer(FlutedGlass, flutedGlassPresets),
  water: renderer(Water, waterPresets),
  'image-dithering': renderer(ImageDithering, imageDitheringPresets),
  'halftone-dots': renderer(HalftoneDots, halftoneDotsPresets),
  'halftone-cmyk': renderer(HalftoneCmyk, halftoneCmykPresets),
  heatmap: renderer(Heatmap, heatmapPresets),
  'liquid-metal': renderer(LiquidMetal, liquidMetalPresets),
  'gem-smoke': renderer(GemSmoke, gemSmokePresets),
} satisfies Record<PaperShaderType, PaperShaderRendererDefinition>

export function getPaperShaderRenderer(
  shaderType: PaperShaderType,
): PaperShaderRendererDefinition {
  return PAPER_SHADER_RENDERERS[shaderType]
}

export function paperShaderFrame(node: ShaderNode, playhead: number): number {
  const safePlayhead = Number.isFinite(playhead) ? Math.max(0, playhead) : 0
  const safeSpeed = Number.isFinite(node.speed) ? Math.max(0, node.speed) : 0
  return safePlayhead * 1000 * safeSpeed
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Builds the Paper props from its official Default preset, then applies
 * persisted scene values. Only keys known to the pinned preset are forwarded;
 * renderer-owned props such as frame, image, ref, and WebGL attributes are
 * always assigned by the host layer.
 */
export function paperShaderRuntimeParams(
  node: ShaderNode,
  playhead: number,
  source?: string,
): Record<string, unknown> {
  const rendererDefinition = getPaperShaderRenderer(node.shaderType)
  const defaults = rendererDefinition.defaultParams
  const params: Record<string, unknown> = { ...defaults }
  const resolvedSource = source?.trim() || undefined

  for (const key of Object.keys(defaults)) {
    const value = node.params[key]
    if (value !== undefined) params[key] = value
  }

  if ('colors' in defaults && node.colors.length > 0) {
    params.colors = node.colors
  }
  if (finiteNumber(node.scale)) params.scale = node.scale

  // Original Mesh Gradient scenes predate the generic `params` bag. Preserve
  // those authored values unless a newer scene explicitly sets the same prop.
  if (node.shaderType === 'mesh-gradient') {
    if (node.params.distortion === undefined && finiteNumber(node.distortion)) {
      params.distortion = node.distortion
    }
    if (node.params.swirl === undefined && finiteNumber(node.swirl)) {
      params.swirl = node.swirl
    }
    if (node.params.grainOverlay === undefined && finiteNumber(node.grain)) {
      params.grainOverlay = node.grain
    }
  }

  // Paper normally advances from wall-clock time. Hyper Motion owns time, so
  // the shader is frozen internally and receives an exact timeline frame.
  params.speed = 0
  params.frame = paperShaderFrame(node, playhead)

  if (
    resolvedSource &&
    getPaperShaderDefinition(node.shaderType).acceptsImage
  ) {
    params.image = resolvedSource
  } else {
    delete params.image
  }

  if (paperShaderCanPreprocessImage(node)) {
    // Paper's preprocessing promise is contained by PaperShaderLayer's local
    // Suspense boundary. Without a source, Liquid Metal and Gem Smoke retain
    // their built-in procedural shapes and must not suspend.
    params.suspendWhenProcessingImage = Boolean(resolvedSource)
  }

  return params
}

export function paperShaderCanPreprocessImage(node: ShaderNode): boolean {
  return (
    node.shaderType === 'liquid-metal' ||
    node.shaderType === 'gem-smoke' ||
    node.shaderType === 'heatmap'
  )
}

export function resolvePaperShaderSource(
  node: ShaderNode,
  api?: Pick<SceneAPI, 'getNode'>,
): string | undefined {
  const embedded = node.sourceImage?.trim()
  if (embedded) return embedded

  const sourceId = node.sourceNodeId?.trim()
  if (!sourceId || !api) return undefined
  const sourceNode = api.getNode(sourceId)
  if (sourceNode?.kind !== 'image') return undefined
  const source = sourceNode.src.trim()
  return source || undefined
}

export function paperShaderNeedsImageSource(
  node: ShaderNode,
  source?: string,
): boolean {
  return (
    getPaperShaderDefinition(node.shaderType).requiresImage &&
    !source?.trim()
  )
}
