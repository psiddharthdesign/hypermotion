// SPDX-License-Identifier: Apache-2.0

import { useMemo, useRef } from 'react'
import type { Node } from '@/scene'
import type { NodeBaseMutable, SceneAPI } from '@/scene/doc'
import {
  getPaperShaderDefinition,
  PAPER_SHADER_CATALOG,
  type PaperShaderParamValue,
  type PaperShaderType,
} from '@/scene/paperShaders'
import { isImageFile } from '@/ui/importImage'
import {
  CheckboxField,
  ColorField,
  FieldRow,
  NumberField,
  SelectField,
  TextField,
} from '@/ui/fields'

type ShaderNode = Extract<Node, { kind: 'shader' }>

const CATEGORY_LABELS = {
  generated: 'Generated',
  'image-filter': 'Image filters',
  shape: 'Logo & shape',
} as const

const PARAM_OPTIONS: Partial<
  Record<`${PaperShaderType}:${string}`, readonly string[]>
> = {
  'dithering:shape': ['simplex', 'warp', 'dots', 'wave', 'ripple', 'swirl', 'sphere'],
  'dithering:type': ['random', '2x2', '4x4', '8x8'],
  'grain-gradient:shape': ['wave', 'dots', 'truchet', 'corners', 'ripple', 'blob', 'sphere'],
  'dot-grid:shape': ['circle', 'diamond', 'square', 'triangle'],
  'warp:shape': ['checks', 'stripes', 'edge'],
  'fluted-glass:shape': ['lines', 'linesIrregular', 'wave', 'zigzag', 'pattern'],
  'fluted-glass:distortionShape': ['prism', 'lens', 'contour', 'cascade', 'flat'],
  'image-dithering:type': ['random', '2x2', '4x4', '8x8'],
  'halftone-dots:grid': ['square', 'hex'],
  'halftone-dots:type': ['classic', 'gooey', 'holes', 'soft'],
  'halftone-cmyk:type': ['dots', 'ink', 'sharp'],
  'liquid-metal:shape': ['none', 'circle', 'daisy', 'diamond', 'metaballs'],
  'gem-smoke:shape': ['none', 'circle', 'daisy', 'diamond', 'metaballs'],
  'pulsing-border:aspectRatio': ['auto', 'square'],
}

const LABEL_OVERRIDES: Record<string, string> = {
  colorBack: 'Background',
  colorFront: 'Foreground',
  colorMid: 'Mid color',
  colorFill: 'Fill',
  colorStroke: 'Stroke',
  colorHighlight: 'Highlight',
  colorShadow: 'Shadow',
  colorBloom: 'Bloom color',
  colorInner: 'Inner color',
  colorTint: 'Tint',
  grainMixer: 'Grain mix',
  grainOverlay: 'Grain overlay',
  gapX: 'Gap X',
  gapY: 'Gap Y',
  waveX: 'Wave X',
  waveY: 'Wave Y',
  waveXShift: 'Wave X shift',
  waveYShift: 'Wave Y shift',
  offsetX: 'Offset X',
  offsetY: 'Offset Y',
  marginLeft: 'Margin left',
  marginRight: 'Margin right',
  marginTop: 'Margin top',
  marginBottom: 'Margin bottom',
  shiftRed: 'Red shift',
  shiftBlue: 'Blue shift',
  sizeRange: 'Size range',
  opacityRange: 'Opacity range',
  stepsPerColor: 'Color steps',
  focalDistance: 'Focal distance',
  focalAngle: 'Focal angle',
  distortionShape: 'Distortion shape',
  colorSteps: 'Color steps',
  originalColors: 'Original colors',
  innerDistortion: 'Inner distortion',
  outerDistortion: 'Outer distortion',
  innerGlow: 'Inner glow',
  outerGlow: 'Outer glow',
  octaveCount: 'Octaves',
  foldCount: 'Fold count',
  spotSize: 'Spot size',
  smokeSize: 'Smoke size',
  noiseScale: 'Noise scale',
  noiseIterations: 'Noise passes',
  swirlIterations: 'Swirl passes',
  bandCount: 'Band count',
  strokeWidth: 'Stroke width',
  strokeTaper: 'Stroke taper',
  strokeCap: 'Stroke cap',
  noiseFrequency: 'Noise frequency',
  midSize: 'Mid size',
  midIntensity: 'Mid intensity',
  aspectRatio: 'Aspect',
  gridNoise: 'Grid noise',
}

const INTEGER_PARAMS = new Set([
  'positions',
  'count',
  'stepsPerColor',
  'octaveCount',
  'foldCount',
  'spots',
  'noiseIterations',
  'swirlIterations',
  'bandCount',
])

const ANGLE_PARAMS = new Set(['angle', 'angle1', 'angle2', 'focalAngle', 'rotation'])

export function PaperShaderInspector({
  node,
  api,
}: {
  node: ShaderNode
  api: SceneAPI
}) {
  const uploadRef = useRef<HTMLInputElement>(null)
  const definition = getPaperShaderDefinition(node.shaderType)
  const params = useMemo(
    () => ({ ...definition.defaults.params, ...node.params }),
    [definition.defaults.params, node.params],
  )
  const imageNodes = api
    .getAllNodeIds()
    .map((id) => api.getNode(id))
    .filter((candidate): candidate is Extract<Node, { kind: 'image' }> =>
      Boolean(candidate?.kind === 'image' && candidate.id !== node.id),
    )
  const sourceNode =
    node.sourceNodeId != null ? api.getNode(node.sourceNodeId) : null
  const sourcePreview =
    node.sourceImage ??
    (sourceNode?.kind === 'image' ? sourceNode.src : '')
  const sourceValue = node.sourceImage
    ? '__embedded__'
    : sourceNode?.kind === 'image'
      ? sourceNode.id
      : ''

  const setProperty = <K extends keyof NodeBaseMutable>(
    key: K,
    value: NodeBaseMutable[K],
  ) => api.setNodeProperty(node.id, key, value)

  const applyType = (type: PaperShaderType) => {
    const next = getPaperShaderDefinition(type)
    api.doc.transact(() => {
      setProperty('shaderType', type)
      setProperty('colors', [...next.defaults.colors])
      setProperty('speed', next.defaults.speed)
      setProperty('scale', next.defaults.scale)
      setProperty('params', { ...next.defaults.params })
      if (type === 'mesh-gradient') {
        const distortion = numberParam(next.defaults.params.distortion, 0.8)
        const swirl = numberParam(next.defaults.params.swirl, 0.1)
        const grain = numberParam(next.defaults.params.grainOverlay, 0.08)
        setProperty('distortion', distortion)
        setProperty('swirl', swirl)
        setProperty('grain', grain)
      }
    })
  }

  const setColor = (index: number, color: string | null) => {
    if (!color) return
    const colors = [...node.colors]
    colors[index] = color
    setProperty('colors', colors)
  }

  const setParam = (key: string, value: PaperShaderParamValue) => {
    api.doc.transact(() => {
      setProperty('params', { ...node.params, [key]: value })
      // Keep the original Mesh Gradient fields synchronized so scenes made
      // earlier on this branch and current renderers read the same values.
      if (node.shaderType === 'mesh-gradient') {
        if (key === 'distortion' && typeof value === 'number') {
          setProperty('distortion', value)
        } else if (key === 'swirl' && typeof value === 'number') {
          setProperty('swirl', value)
        } else if (key === 'grainOverlay' && typeof value === 'number') {
          setProperty('grain', value)
        }
      }
    })
  }

  const chooseSourceNode = (value: string) => {
    api.doc.transact(() => {
      setProperty('sourceImage', '')
      setProperty('sourceNodeId', value)
    })
  }

  const embedSource = (files: FileList | null) => {
    const file = Array.from(files ?? []).find(isImageFile)
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== 'string') return
      api.doc.transact(() => {
        setProperty('sourceNodeId', '')
        setProperty('sourceImage', reader.result as string)
      })
    }
    reader.readAsDataURL(file)
  }

  const groupedTypes = (
    ['generated', 'image-filter', 'shape'] as const
  ).map((category) => ({
    label: CATEGORY_LABELS[category],
    options: PAPER_SHADER_CATALOG.filter(
      (candidate) => candidate.category === category,
    ).map((candidate) => ({ value: candidate.type, label: candidate.label })),
  }))

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[13px] font-semibold text-text">Paper Shader</span>
        <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[9px] font-medium text-accent">
          {CATEGORY_LABELS[definition.category]}
        </span>
      </div>
      <div className="space-y-2">
        <FieldRow label="Shader">
          <SelectField<PaperShaderType>
            value={node.shaderType}
            groups={groupedTypes}
            onCommit={applyType}
            width="w-full"
          />
        </FieldRow>

        {definition.acceptsImage ? (
          <>
            <FieldRow label="Source">
              <SelectField<string>
                value={sourceValue}
                options={[
                  { value: '', label: definition.requiresImage ? 'Choose an image…' : 'Generated texture' },
                  ...(node.sourceImage
                    ? [{ value: '__embedded__', label: 'Uploaded image' }]
                    : []),
                  ...imageNodes.map((image) => ({
                    value: image.id,
                    label: image.name || 'Image layer',
                  })),
                ]}
                onCommit={(value) => {
                  if (value === '__embedded__') return
                  chooseSourceNode(value)
                }}
                width="w-full"
              />
            </FieldRow>
            <div className="flex items-center gap-2 pl-[22px]">
              <div className="grid h-10 w-14 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-app-bg">
                {sourcePreview ? (
                  <img
                    src={sourcePreview}
                    alt=""
                    className="h-full w-full object-cover"
                    draggable={false}
                  />
                ) : (
                  <span className="text-[9px] text-text-dim">No source</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => uploadRef.current?.click()}
                className="h-7 rounded-md border border-border px-2 text-[10px] font-medium text-text-muted transition-colors hover:border-border-strong hover:text-text"
              >
                Upload…
              </button>
              {sourcePreview ? (
                <button
                  type="button"
                  onClick={() => chooseSourceNode('')}
                  className="h-7 rounded-md px-1.5 text-[10px] text-text-dim transition-colors hover:bg-white/[0.05] hover:text-text"
                >
                  Clear
                </button>
              ) : null}
              <input
                ref={uploadRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => {
                  embedSource(event.target.files)
                  event.target.value = ''
                }}
              />
            </div>
            {definition.requiresImage && !sourcePreview ? (
              <p className="ml-[22px] rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-1.5 text-[10px] leading-4 text-amber-200">
                Choose an image layer or upload an image to render this filter.
              </p>
            ) : null}
          </>
        ) : null}

        {node.colors.map((color, index) => (
          <FieldRow key={`${node.shaderType}-color-${index}`} label={`Color ${index + 1}`}>
            <ColorField value={color} onCommit={(next) => setColor(index, next)} />
          </FieldRow>
        ))}

        <FieldRow label="Speed">
          <NumberField
            value={node.speed}
            onCommit={(speed) => setProperty('speed', Math.max(0, Math.min(2, speed)))}
            min={0}
            max={2}
            step={0.05}
            suffix="×"
            ariaLabel="Paper shader speed"
          />
        </FieldRow>
        <FieldRow label="Scale">
          <NumberField
            value={node.scale * 100}
            onCommit={(scale) =>
              setProperty('scale', Math.max(0.1, Math.min(4, scale / 100)))
            }
            min={10}
            max={400}
            step={5}
            suffix="%"
            ariaLabel="Paper shader scale"
          />
        </FieldRow>

        {Object.entries(params)
          .filter(([key]) => !['colors', 'speed', 'scale', 'frame', 'image'].includes(key))
          .map(([key, value]) => (
            <ShaderParamField
              key={`${node.shaderType}-${key}`}
              shaderType={node.shaderType}
              name={key}
              value={value}
              onCommit={(next) => setParam(key, next)}
            />
          ))}

        <p className="pl-[22px] pt-1 text-[10px] leading-4 text-text-dim">
          Timeline-synced and deterministic. Speed 0 freezes the current frame;
          playback and export use the same shader time.
        </p>
      </div>
    </div>
  )
}

function ShaderParamField({
  shaderType,
  name,
  value,
  onCommit,
}: {
  shaderType: PaperShaderType
  name: string
  value: PaperShaderParamValue
  onCommit: (value: PaperShaderParamValue) => void
}) {
  const label = parameterLabel(name)
  if (Array.isArray(value)) return null
  if (typeof value === 'boolean') {
    return (
      <FieldRow label={label}>
        <CheckboxField value={value} onCommit={onCommit} />
      </FieldRow>
    )
  }
  if (typeof value === 'number') {
    return (
      <FieldRow label={label}>
        <NumberField
          value={value}
          onCommit={onCommit}
          step={INTEGER_PARAMS.has(name) || ANGLE_PARAMS.has(name) ? 1 : 0.05}
          suffix={ANGLE_PARAMS.has(name) ? '°' : undefined}
          ariaLabel={`${label} shader parameter`}
        />
      </FieldRow>
    )
  }
  if (typeof value === 'string') {
    if (name.startsWith('color')) {
      return (
        <FieldRow label={label}>
          <ColorField value={value} onCommit={(next) => next && onCommit(next)} />
        </FieldRow>
      )
    }
    const options =
      name === 'fit'
        ? (['none', 'contain', 'cover'] as const)
        : PARAM_OPTIONS[`${shaderType}:${name}`]
    return (
      <FieldRow label={label}>
        {options ? (
          <SelectField<string>
            value={value}
            options={options}
            onCommit={onCommit}
            width="w-full"
          />
        ) : (
          <TextField value={value} onCommit={onCommit} />
        )}
      </FieldRow>
    )
  }
  return null
}

function parameterLabel(name: string): string {
  const override = LABEL_OVERRIDES[name]
  if (override) return override
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (letter) => letter.toUpperCase())
}

function numberParam(value: PaperShaderParamValue | undefined, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
