// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { PROPERTY_IDS, readSceneSummary } from '../scene/build.js'
import { assertToolText } from '../testUtils/mcp.js'
import { createSceneTool, handleCreateScene } from './tools/createScene.js'

test('create_scene input schema marks output as absolute and non-empty', () => {
  assert.deepEqual(createSceneTool.inputSchema.properties?.output, {
    type: 'string',
    minLength: 1,
    pattern: '\\S',
    description:
      'Absolute, non-blank path to write the .hype file to. Parent dirs are created if missing.',
  })
})

test('create_scene input schema requires output and scene', () => {
  assert.deepEqual(createSceneTool.inputSchema.required, ['output', 'scene'])
  assert.equal(createSceneTool.inputSchema.additionalProperties, false)
})

test('create_scene description lists supported appearance property ids', () => {
  const description = createSceneTool.description
  if (typeof description !== 'string') {
    throw new Error('create_scene description is missing')
  }
  for (const propertyId of [
    'appearance.opacity',
    'appearance.cornerRadius',
    'appearance.cornerRadii',
    'appearance.cornerRadii.tl',
    'appearance.cornerRadii.tr',
    'appearance.cornerRadii.br',
    'appearance.cornerRadii.bl',
    'appearance.fill',
    'text.progress',
  ]) {
    const escapedPropertyId = propertyId.replaceAll('.', '\\.')
    assert.match(description, new RegExp(`${escapedPropertyId}(?:,|\\.)`))
  }
  assert.match(description, /default focalLength to 1000/)
})

test('create_scene description lists supported camera property ids', () => {
  const description = createSceneTool.description
  if (typeof description !== 'string') {
    throw new Error('create_scene description is missing')
  }
  for (const propertyId of [
    'camera.focusX',
    'camera.focusY',
    'camera.focusWorldX',
    'camera.focusWorldY',
    'camera.focusWorldZ',
    'camera.focusDistance',
    'camera.focusRadius',
    'camera.focusFalloff',
    'camera.pointOfInterestX',
    'camera.pointOfInterestY',
    'camera.pointOfInterestZ',
    'camera.focalLength',
    'camera.fieldOfView',
    'camera.nearClip',
    'camera.farClip',
    'camera.aperture',
    'camera.iso',
    'camera.blurLevel',
    'camera.blurQuality',
  ]) {
    const escapedPropertyId = propertyId.replaceAll('.', '\\.')
    assert.match(description, new RegExp(`${escapedPropertyId}(?:,|\\.)`))
  }
  assert.match(description, /focusMode/)
})

test('create_scene description keeps camera nodes optional', () => {
  const description = createSceneTool.description
  if (typeof description !== 'string') {
    throw new Error('create_scene description is missing')
  }

  assert.match(description, /'camera' kind node .* is optional/)
  assert.doesNotMatch(description, /Include exactly one 'camera' kind node/)
})

test('create_scene description lists supported transform property ids', () => {
  const description = createSceneTool.description
  if (typeof description !== 'string') {
    throw new Error('create_scene description is missing')
  }
  for (const propertyId of [
    'transform.x',
    'transform.y',
    'transform.z',
    'transform.rotation',
    'transform.rotationX',
    'transform.rotationY',
    'transform.scaleX',
    'transform.scaleY',
    'transform.anchorX',
    'transform.anchorY',
    'transform.anchorZ',
  ]) {
    const escapedPropertyId = propertyId.replaceAll('.', '\\.')
    assert.match(description, new RegExp(`${escapedPropertyId}(?:,|\\.)`))
  }
})

test('create_scene description lists supported layout property ids', () => {
  const description = createSceneTool.description
  if (typeof description !== 'string') {
    throw new Error('create_scene description is missing')
  }
  for (const propertyId of [
    'layout.gap',
    'layout.padding.top',
    'layout.padding.right',
    'layout.padding.bottom',
    'layout.padding.left',
    'layout.direction',
    'size.width',
    'size.height',
    'variant',
  ]) {
    const escapedPropertyId = propertyId.replaceAll('.', '\\.')
    assert.match(description, new RegExp(`${escapedPropertyId}(?:,|\\.)`))
  }
})

test('create_scene description mentions text animation track fields', () => {
  const description = createSceneTool.description
  if (typeof description !== 'string') {
    throw new Error('create_scene description is missing')
  }

  for (const field of [
    'textAnimation',
    'applyTo',
    'startTime',
    'easingPresetId',
    'travelDistance',
    'blurRadius',
  ]) {
    assert.match(description, new RegExp(field))
  }
})

test('create_scene description stays in sync with supported property ids', () => {
  const description = createSceneTool.description
  if (typeof description !== 'string') {
    throw new Error('create_scene description is missing')
  }
  for (const propertyId of PROPERTY_IDS) {
    const escapedPropertyId = propertyId.replaceAll('.', '\\.')
    assert.match(description, new RegExp(`${escapedPropertyId}(?:,|\\.)`))
  }
})

test('create_scene input schema exposes the open default', () => {
  const openProperty = createSceneTool.inputSchema.properties?.open as
    | Record<string, unknown>
    | undefined

  assert.equal(openProperty?.type, 'boolean')
  assert.equal(openProperty?.default, true)
})

test('create_scene input schema exposes string and object scene inputs', () => {
  const sceneProperty = createSceneTool.inputSchema.properties?.scene as
    | Record<string, unknown>
    | undefined

  assert.deepEqual(sceneProperty?.anyOf, [{ type: 'string' }, { type: 'object' }])
})

test('create_scene reports invalid arguments as MCP errors', async () => {
  const result = await handleCreateScene({
    output: 42,
    scene: {},
  })

  assert.equal(result.isError, true)
  assert.match(assertToolText(result), /^create_scene: invalid arguments/)
})

test('create_scene rejects unknown arguments as MCP errors', async () => {
  const result = await handleCreateScene({
    output: '/tmp/scene.hype',
    scene: {},
    unexpected: true,
  })

  assert.equal(result.isError, true)
  assert.match(assertToolText(result), /^create_scene: invalid arguments/)
})

test('create_scene rejects array scene JSON', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-array-scene-'))

  try {
    const result = await handleCreateScene({
      output: path.join(dir, 'array-scene.hype'),
      scene: '[]',
    })

    assert.equal(result.isError, true)
    assert.equal(
      assertToolText(result),
      'create_scene: scene must be an object (or a JSON-encoded object).',
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('create_scene rejects null scene JSON', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-null-scene-'))

  try {
    const result = await handleCreateScene({
      output: path.join(dir, 'null-scene.hype'),
      scene: 'null',
    })

    assert.equal(result.isError, true)
    assert.equal(
      assertToolText(result),
      'create_scene: scene must be an object (or a JSON-encoded object).',
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('create_scene reports malformed scene JSON strings as MCP errors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-malformed-scene-'))

  try {
    const result = await handleCreateScene({
      output: path.join(dir, 'malformed-scene.hype'),
      scene: '{"nodes":',
    })

    assert.equal(result.isError, true)
    assert.match(
      assertToolText(result),
      /^create_scene: 'scene' was a string but not valid JSON:/,
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('create_scene rejects relative output paths', async () => {
  const result = await handleCreateScene({
    output: 'relative-scene.hype',
    scene: { nodes: {} },
  })

  assert.equal(result.isError, true)
  assert.equal(assertToolText(result), 'create_scene: output must be an absolute path.')
})

test('create_scene rejects blank output paths at schema validation', async () => {
  const result = await handleCreateScene({
    output: '   ',
    scene: { nodes: {} },
  })

  assert.equal(result.isError, true)
  assert.match(assertToolText(result), /^create_scene: invalid arguments/)
  assert.match(assertToolText(result), /output path is required/)
})

test('create_scene rejects empty output paths at schema validation', async () => {
  const result = await handleCreateScene({
    output: '',
    scene: { nodes: {} },
  })

  assert.equal(result.isError, true)
  assert.match(assertToolText(result), /^create_scene: invalid arguments/)
})

test('create_scene validates output paths before building scene bytes', async () => {
  const result = await handleCreateScene({
    output: 'relative-scene.hype',
    scene: { nodes: null },
  })

  assert.equal(result.isError, true)
  assert.equal(assertToolText(result), 'create_scene: output must be an absolute path.')
})

test('create_scene trims output paths before writing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-mcp-create-trim-'))
  const scenePath = path.join(dir, 'trimmed-scene.hype')

  try {
    const result = await handleCreateScene({
      output: `  ${scenePath}  `,
      open: false,
      scene: { nodes: {} },
    })

    assert.equal(result.isError, undefined)
    assert.equal(fs.existsSync(scenePath), true)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('create_scene rejects directory output paths', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-mcp-create-dir-'))
  const outputPath = path.join(dir, 'existing-output')

  try {
    fs.mkdirSync(outputPath)

    const result = await handleCreateScene({
      output: outputPath,
      open: false,
      scene: { nodes: {} },
    })

    assert.equal(result.isError, true)
    assert.equal(
      assertToolText(result),
      `create_scene: output path is a directory: ${outputPath}`,
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('create_scene reports persisted layer and track counts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hypermotion-mcp-create-'))
  const scenePath = path.join(dir, 'scene.hype')
  try {
    const result = await handleCreateScene({
      output: scenePath,
      open: false,
      scene: {
        nodes: {
          aliasA: {
            id: 'root',
            kind: 'frame',
            parent: null,
            children: [],
            size: { width: 320, height: 180 },
            layout: { mode: 'none' },
          },
          aliasB: {
            id: 'root',
            kind: 'frame',
            parent: null,
            children: [],
            size: { width: 320, height: 180 },
            layout: { mode: 'none' },
          },
        },
        tracks: {
          aliasA: {
            id: 'fade-root',
            nodeId: 'root',
            propertyId: 'appearance.opacity',
            keyframes: [
              { id: 'fade-start', time: 0, value: 0 },
              { id: 'fade-end', time: 0.2, value: 1 },
            ],
          },
          aliasB: {
            id: 'fade-root',
            nodeId: 'root',
            propertyId: 'appearance.opacity',
            keyframes: [],
          },
        },
      },
    })

    const summary = readSceneSummary(fs.readFileSync(scenePath))

    assert.equal(result.isError, undefined)
    assert.match(assertToolText(result), /1 layer, 1 track/)
    assert.equal(summary.layerCount, 1)
    assert.equal(summary.trackCount, 1)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
