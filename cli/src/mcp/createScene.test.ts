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
    'appearance.blendMode',
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
    'camera.fStop',
    'camera.bladeCount',
    'camera.bladeRotation',
    'camera.bokehRatio',
    'camera.iso',
    'camera.blurLevel',
    'camera.blurQuality',
    'camera.chromaticAberrationAmount',
    'camera.chromaticAberrationAngle',
    'camera.bloomStrength',
    'camera.bloomRadius',
    'camera.bloomThreshold',
    'camera.vhsIntensity',
    'camera.vhsNoise',
    'camera.vhsScanlines',
    'camera.vhsColorBleed',
  ]) {
    const escapedPropertyId = propertyId.replaceAll('.', '\\.')
    assert.match(description, new RegExp(`${escapedPropertyId}(?:,|\\.)`))
  }
  assert.match(description, /focusMode/)
  assert.match(description, /dofPreviewQuality/)
})

test('create_scene description keeps camera nodes optional', () => {
  const description = createSceneTool.description
  if (typeof description !== 'string') {
    throw new Error('create_scene description is missing')
  }

  assert.match(description, /'camera' kind node .* is optional/)
  assert.doesNotMatch(description, /Include exactly one 'camera' kind node/)
})

test('create_scene description documents editable ellipse arcs', () => {
  const description = createSceneTool.description
  if (typeof description !== 'string') {
    throw new Error('create_scene description is missing')
  }

  assert.match(description, /arc: \{ startAngle, sweep, innerRadius \}/)
  assert.match(description, /startAngle is expressed in degrees/)
  assert.match(description, /sweep and innerRadius are ratios in 0\.\.1/)
  for (const propertyId of [
    'shape.arcStart',
    'shape.arcSweep',
    'shape.arcInnerRadius',
  ]) {
    assert.match(description, new RegExp(propertyId.replaceAll('.', '\\.')))
  }
})

test('create_scene description documents multi-camera ownership and timed cuts', () => {
  const description = createSceneTool.description
  if (typeof description !== 'string') {
    throw new Error('create_scene description is missing')
  }

  assert.match(description, /supports multiple camera nodes per scene/)
  assert.match(description, /cameraIds/)
  assert.match(description, /defaultCameraId/)
  assert.match(description, /cameraCuts/)
  assert.match(description, /\{ id, cameraId, time \}/)
  assert.match(description, /\(time, id\)/)
  assert.doesNotMatch(description, /supports only one camera node/)
})

test('create_scene description documents multi-scene sequence authoring', () => {
  const description = createSceneTool.description
  if (typeof description !== 'string') {
    throw new Error('create_scene description is missing')
  }

  for (const field of [
    'compositionScenes',
    'sequenceItems',
    'sequenceOrder',
    'activeCompositionId',
    'sequenceSchemaVersion',
    'rootNodeId',
    'workspaceNodeIds',
    'transitionOut',
    'masterAudioMuted',
    'holdDuration',
  ]) {
    assert.match(description, new RegExp(field))
  }
  assert.match(description, /project-global nodes\/tracks/)
  assert.match(description, /workspaceOnly: true/)
  assert.match(description, /preserved when a composition is deleted/)
  assert.match(description, /schema-v2 project/)
  assert.match(description, /list_scenes/)
  assert.match(description, /get_sequence/)
  assert.match(description, /Master-audio gain follows/)
  assert.match(description, /parentless audio node is a Master-owned soundtrack/)
  assert.match(description, /Scene-local overlay/)
  assert.match(description, /masterStart \+ sceneTime - sourceStart/)
  assert.match(description, /beat\/bar guides stay visible/)
  assert.match(description, /trailing freeze-frame/)
  assert.match(description, /without extending the local source range/)
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

test('create_scene description documents all Paper shader nodes', () => {
  const description = createSceneTool.description
  if (typeof description !== 'string') {
    throw new Error('create_scene description is missing')
  }

  assert.match(description, /'shader'/)
  assert.match(description, /all 29 Paper Shaders/)
  for (const field of [
    'shaderType',
    'colors',
    'params',
    'sourceNodeId',
    'sourceImage',
    'speed',
    'scale',
    'distortion',
    'swirl',
    'grain',
  ]) {
    assert.match(description, new RegExp(field))
  }
  for (const shaderType of [
    'mesh-gradient',
    'paper-texture',
    'halftone-cmyk',
    'liquid-metal',
    'gem-smoke',
  ]) {
    assert.match(description, new RegExp(shaderType))
  }
  assert.match(description, /require a source/)
  assert.match(description, /size 640x360/)
  assert.match(description, /Shader parameters are static node fields/)
  assert.doesNotMatch(description, /primitive3d/i)
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
    'motionVector',
    'motionPath',
    'staggerCurve',
    'blurRadius',
  ]) {
    assert.match(description, new RegExp(field))
  }
})

test('create_scene description defines text motion vector axes', () => {
  const description = createSceneTool.description
  if (typeof description !== 'string') {
    throw new Error('create_scene description is missing')
  }

  assert.match(
    description,
    /\+X right, \+Y down, \+Z toward the viewer/,
  )
})

test('create_scene description defines the editable text stagger curve', () => {
  const description = createSceneTool.description
  if (typeof description !== 'string') {
    throw new Error('create_scene description is missing')
  }

  assert.match(
    description,
    /staggerCurve \(\{ version: 1, points: \[\{ id, x, y, inX, inY, outX, outY \}\] \} defining a monotonic initial-to-final trail profile sampled by every segment as it travels across text\)/,
  )
})

test('create_scene description defines the editable text spatial path', () => {
  const description = createSceneTool.description
  if (typeof description !== 'string') {
    throw new Error('create_scene description is missing')
  }

  assert.match(
    description,
    /motionPath \(\{ version: 1, points: \[\{ id, t, x, y, z, inX, inY, inZ, outX, outY, outZ \}\] \} defining an editable cubic spatial route in line-height units/,
  )
  assert.match(description, /motionPath takes precedence over motionVector/)
})

test('create_scene description defines generic layer motion paths', () => {
  const description = createSceneTool.description
  if (typeof description !== 'string') {
    throw new Error('create_scene description is missing')
  }

  assert.match(description, /Coordinates are layer-local pixels/)
  assert.match(description, /progress is 0\.\.1/)
  assert.match(description, /autoOrient/)
  assert.match(description, /rotationOffset/)
  assert.match(description, /parameterization/)
  assert.match(description, /motionPath\.progress can be keyframed/)
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

test('create_scene description documents auto-layout authoring defaults', () => {
  const description = createSceneTool.description
  if (typeof description !== 'string') {
    throw new Error('create_scene description is missing')
  }

  assert.match(description, /Design scenes with auto-layout by default/)
  assert.match(description, /Prefer layout\.mode: 'flex'/)
  assert.match(description, /layout\.mode: 'grid'/)
  assert.match(description, /prefer height: 'hug'/)
  assert.match(description, /width: 'fill'/)
  assert.match(description, /4-point or 8-point grid/)
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
