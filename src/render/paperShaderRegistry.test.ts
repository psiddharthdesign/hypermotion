// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { createSceneAPI, type SceneAPI } from '@/scene/doc'
import type { Node } from '@/scene/types'
import { PAPER_SHADER_TYPES } from '@/scene/paperShaders'
import {
  PAPER_SHADER_RENDERERS,
  getPaperShaderRenderer,
  paperShaderFrame,
  paperShaderNeedsImageSource,
  paperShaderRuntimeParams,
  resolvePaperShaderSource,
} from './paperShaderRegistry'

type ShaderNode = Extract<Node, { kind: 'shader' }>

function createShader(
  api: SceneAPI,
  props: Partial<ShaderNode> = {},
): ShaderNode {
  const id = api.createNode('shader', null, props)
  const node = api.getNode(id)
  if (!node || node.kind !== 'shader') throw new Error('Expected shader node')
  return node
}

describe('Paper shader renderer registry', () => {
  it('maps all 29 stable scene ids to Paper components and Default presets', () => {
    expect(Object.keys(PAPER_SHADER_RENDERERS)).toEqual([
      ...PAPER_SHADER_TYPES,
    ])

    for (const type of PAPER_SHADER_TYPES) {
      const entry = getPaperShaderRenderer(type)
      expect(entry.component).toBeTruthy()
      expect(entry.defaultParams).toEqual(expect.any(Object))
    }

    expect(
      getPaperShaderRenderer('mesh-gradient').defaultParams,
    ).toMatchObject({
      colors: ['#e0eaff', '#241d9a', '#f75092', '#9f50d3'],
      distortion: 0.8,
      swirl: 0.1,
    })
  })

  it('freezes Paper wall-clock motion and derives every frame from scene time', () => {
    const api = createSceneAPI()

    for (const type of PAPER_SHADER_TYPES) {
      const node = createShader(api, {
        shaderType: type,
        speed: 1.25,
      })
      const params = paperShaderRuntimeParams(node, 2.5)
      expect(params.speed, type).toBe(0)
      expect(params.frame, type).toBe(3125)
      expect(params.scale, type).toBe(node.scale)
      expect(paperShaderFrame(node, -10), type).toBe(0)
    }

    const invalid = createShader(api)
    invalid.speed = Number.NaN
    expect(paperShaderFrame(invalid, Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('applies scene params over the official preset without forwarding unknown props', () => {
    const api = createSceneAPI()
    const node = createShader(api, {
      shaderType: 'mesh-gradient',
      colors: ['#001122', '#ddeeff'],
      scale: 1.75,
      params: {
        distortion: 0.35,
        swirl: 0.25,
        grainOverlay: 0.15,
        unsafeDomProp: 'do-not-forward',
      },
    })

    expect(paperShaderRuntimeParams(node, 1)).toMatchObject({
      colors: ['#001122', '#ddeeff'],
      distortion: 0.35,
      swirl: 0.25,
      grainOverlay: 0.15,
      scale: 1.75,
      speed: 0,
      frame: 600,
    })
    expect(
      paperShaderRuntimeParams(node, 1, 'data:image/png;base64,abc').image,
    ).toBeUndefined()
    expect(
      paperShaderRuntimeParams(node, 1).unsafeDomProp,
    ).toBeUndefined()
  })

  it('contains Paper image preprocessing in the renderer Suspense boundary', () => {
    const api = createSceneAPI()
    for (const type of ['liquid-metal', 'gem-smoke', 'heatmap'] as const) {
      const node = createShader(api, { shaderType: type })
      const params = paperShaderRuntimeParams(
        node,
        0,
        'data:image/png;base64,abc',
      )
      expect(params.suspendWhenProcessingImage, type).toBe(true)
      expect(params.image, type).toBe('data:image/png;base64,abc')
      expect(
        paperShaderRuntimeParams(node, 0).suspendWhenProcessingImage,
        type,
      ).toBe(false)
    }
  })
})

describe('Paper shader image sources', () => {
  it('prefers an embedded source, then resolves an image layer through SceneAPI', () => {
    const api = createSceneAPI()
    const imageId = api.createNode('image', null, {
      src: '  data:image/png;base64,layer  ',
    })

    const linked = createShader(api, {
      shaderType: 'halftone-dots',
      sourceNodeId: imageId,
    })
    expect(resolvePaperShaderSource(linked, api)).toBe(
      'data:image/png;base64,layer',
    )

    const embedded = createShader(api, {
      shaderType: 'halftone-dots',
      sourceNodeId: imageId,
      sourceImage: '  data:image/png;base64,embedded  ',
    })
    expect(resolvePaperShaderSource(embedded, api)).toBe(
      'data:image/png;base64,embedded',
    )
  })

  it('rejects missing and non-image source layers', () => {
    const api = createSceneAPI()
    const rectId = api.createNode('rect', null)
    expect(
      resolvePaperShaderSource(
        createShader(api, {
          shaderType: 'fluted-glass',
          sourceNodeId: rectId,
        }),
        api,
      ),
    ).toBeUndefined()
    expect(
      resolvePaperShaderSource(
        createShader(api, {
          shaderType: 'fluted-glass',
          sourceNodeId: 'missing-node',
        }),
        api,
      ),
    ).toBeUndefined()
  })

  it('requires sources for the five Paper image filters but not generated shapes', () => {
    const api = createSceneAPI()
    const required = [
      'fluted-glass',
      'image-dithering',
      'halftone-dots',
      'halftone-cmyk',
      'heatmap',
    ] as const

    for (const type of required) {
      const node = createShader(api, { shaderType: type })
      expect(paperShaderNeedsImageSource(node), type).toBe(true)
      expect(paperShaderNeedsImageSource(node, '   '), type).toBe(true)
      expect(
        paperShaderNeedsImageSource(node, 'data:image/png;base64,abc'),
        type,
      ).toBe(false)
    }

    expect(
      paperShaderNeedsImageSource(
        createShader(api, { shaderType: 'liquid-metal' }),
      ),
    ).toBe(false)
  })
})
