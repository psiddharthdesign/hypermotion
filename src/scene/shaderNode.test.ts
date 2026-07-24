// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { createSceneAPI } from '@/scene/doc'
import { readScene, sceneToBytes } from '@/scene/file'
import {
  PAPER_SHADER_CATALOG,
  PAPER_SHADER_TYPES,
  getPaperShaderDefinition,
  normalizePaperShaderParams,
} from '@/scene/paperShaders'

const DEFAULT_COLORS = [
  '#e0eaff',
  '#241d9a',
  '#f75092',
  '#9f50d3',
]

describe('ShaderNode persistence', () => {
  it('creates a Mesh Gradient with renderer-safe defaults', () => {
    const api = createSceneAPI()
    const id = api.createNode('shader', null)
    const node = api.getNode(id)

    expect(node?.kind).toBe('shader')
    if (!node || node.kind !== 'shader') throw new Error('Expected shader')
    expect(node).toMatchObject({
      name: 'Mesh Gradient',
      size: { width: 640, height: 360 },
      shaderType: 'mesh-gradient',
      colors: DEFAULT_COLORS,
      speed: 0.6,
      scale: 1,
      distortion: 0.8,
      swirl: 0.1,
      grain: 0.08,
      params: {
        fit: 'contain',
        distortion: 0.8,
        swirl: 0.1,
        grainOverlay: 0.08,
      },
      appearance: {
        fill: null,
        stroke: null,
      },
    })
  })

  it('catalogs every Paper React shader with five required image sources', () => {
    expect(PAPER_SHADER_TYPES).toHaveLength(29)
    expect(PAPER_SHADER_CATALOG.map(({ type }) => type)).toEqual([
      ...PAPER_SHADER_TYPES,
    ])
    expect(
      PAPER_SHADER_CATALOG.filter(({ requiresImage }) => requiresImage).map(
        ({ type }) => type,
      ),
    ).toEqual([
      'fluted-glass',
      'image-dithering',
      'halftone-dots',
      'halftone-cmyk',
      'heatmap',
    ])
    expect(getPaperShaderDefinition('liquid-metal')).toMatchObject({
      label: 'Liquid Metal',
      category: 'shape',
      acceptsImage: true,
      requiresImage: false,
    })
  })

  it('round-trips a generic shader and its layer source', () => {
    const api = createSceneAPI()
    const sourceId = api.createNode('rect', null)
    const shaderId = api.createNode('shader', null, {
      shaderType: 'halftone-cmyk',
      sourceNodeId: sourceId,
      params: {
        size: 0.35,
        type: 'sharp',
        originalColors: false,
      },
    })

    const reopened = readScene(sceneToBytes(api.doc)).api.getNode(shaderId)
    expect(reopened?.kind).toBe('shader')
    if (!reopened || reopened.kind !== 'shader') throw new Error('Expected shader')
    expect(reopened).toMatchObject({
      name: 'Halftone CMYK',
      shaderType: 'halftone-cmyk',
      sourceNodeId: sourceId,
      speed: 0,
      scale: 1,
      params: {
        size: 0.35,
        type: 'sharp',
        originalColors: false,
      },
    })
  })

  it('bounds generic shader params to serializable values', () => {
    expect(
      normalizePaperShaderParams({
        good: 12,
        infinite: Number.POSITIVE_INFINITY,
        huge: 2_000_000,
        text: 'ok',
        nested: [true, undefined, null],
      }),
    ).toEqual({
      good: 12,
      huge: 1_000_000,
      text: 'ok',
      nested: [true, null],
    })
  })

  it('updates and round-trips authored shader parameters', () => {
    const api = createSceneAPI()
    const id = api.createNode('shader', null, {
      size: { width: 320, height: 180 },
      colors: ['#001122', '#aabbcc'],
      speed: 1.25,
      scale: 1.4,
      distortion: 0.45,
      swirl: 0.2,
      grain: 0.16,
    })

    api.setNodeProperty(id, 'grain', 0.24)
    api.setNodeProperty(id, 'colors', ['#ff0000', '#0000ff'])

    const reopened = readScene(sceneToBytes(api.doc)).api.getNode(id)
    expect(reopened?.kind).toBe('shader')
    if (!reopened || reopened.kind !== 'shader') {
      throw new Error('Expected reopened shader')
    }
    expect(reopened).toMatchObject({
      size: { width: 320, height: 180 },
      shaderType: 'mesh-gradient',
      colors: ['#ff0000', '#0000ff'],
      speed: 1.25,
      scale: 1.4,
      distortion: 0.45,
      swirl: 0.2,
      grain: 0.24,
      params: {
        distortion: 0.45,
        swirl: 0.2,
        grainOverlay: 0.24,
      },
    })
  })

  it('migrates legacy Mesh Gradient fields into missing params', () => {
    const api = createSceneAPI()
    const id = api.createNode('shader', null)
    const nodes = api.doc.getMap('scene').get('nodes') as Y.Map<Y.Map<unknown>>
    const stored = nodes.get(id)
    if (!stored) throw new Error('Expected stored shader')
    api.doc.transact(() => {
      stored.delete('params')
      stored.set('distortion', 0.31)
      stored.set('swirl', 0.22)
      stored.set('grain', 0.13)
    })

    const node = api.getNode(id)
    if (!node || node.kind !== 'shader') throw new Error('Expected shader')
    expect(node.params).toMatchObject({
      distortion: 0.31,
      swirl: 0.22,
      grainOverlay: 0.13,
    })
  })

  it('mirrors explicit Mesh Gradient params into legacy fields on create', () => {
    const api = createSceneAPI()
    const id = api.createNode('shader', null, {
      shaderType: 'mesh-gradient',
      params: {
        distortion: 0.42,
        swirl: 0.33,
        grainOverlay: 0.14,
      },
    })

    const node = api.getNode(id)
    if (!node || node.kind !== 'shader') throw new Error('Expected shader')
    expect(node).toMatchObject({
      distortion: 0.42,
      swirl: 0.33,
      grain: 0.14,
      params: {
        distortion: 0.42,
        swirl: 0.33,
        grainOverlay: 0.14,
      },
    })
  })

  it('normalizes missing and malformed fields from older documents', () => {
    const api = createSceneAPI()
    const id = api.createNode('shader', null)
    const nodes = api.doc.getMap('scene').get('nodes') as Y.Map<Y.Map<unknown>>
    const stored = nodes.get(id)
    if (!stored) throw new Error('Expected stored shader')

    api.doc.transact(() => {
      stored.delete('size')
      stored.set('shaderType', 'future-shader')
      stored.set('colors', [42, 'bogus', '#abcdef'])
      stored.set('speed', Number.NaN)
      stored.set('scale', 8)
      stored.set('distortion', -1)
      stored.set('swirl', 2)
      stored.set('grain', 1.5)
    })

    const node = api.getNode(id)
    if (!node || node.kind !== 'shader') throw new Error('Expected shader')
    expect(node).toMatchObject({
      size: { width: 640, height: 360 },
      shaderType: 'mesh-gradient',
      colors: ['#abcdef'],
      speed: 0.6,
      scale: 4,
      distortion: 0,
      swirl: 1,
      grain: 1,
    })
  })
})
