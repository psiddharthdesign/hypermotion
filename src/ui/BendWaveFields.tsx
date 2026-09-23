// SPDX-License-Identifier: Apache-2.0
import type { AnimatedValue } from '@/anim'
import type { BendDeformation } from '@/scene'
import { KeyframeSliderRow, MultiKeyframeButton } from './fields'

const controls = [
  { key: 'waveAmplitude', animated: 'bendWaveAmplitude', label: 'Amplitude', suffix: 'px', scale: 1, sliderMin: -400, sliderMax: 400, step: 1 },
  { key: 'waveFrequency', animated: 'bendWaveFrequency', label: 'Frequency', suffix: 'cycles', scale: 1, min: 0, max: 32, sliderMin: 0, sliderMax: 8, step: .1 },
  { key: 'wavePhase', animated: 'bendWavePhase', label: 'Phase', suffix: '°', scale: 1, sliderMin: -360, sliderMax: 360, step: 1 },
  { key: 'captureRotation', animated: 'bendCaptureRotation', label: 'Direction', suffix: '°', scale: 1, sliderMin: -180, sliderMax: 180, step: 1 },
  { key: 'waveStart', animated: 'bendWaveStart', label: 'Start point', suffix: '%', scale: 100, min: 0, max: 100, step: 1 },
  { key: 'waveEnd', animated: 'bendWaveEnd', label: 'End point', suffix: '%', scale: 100, min: 0, max: 100, step: 1 },
  { key: 'waveFalloff', animated: 'bendWaveFalloff', label: 'Edge falloff', suffix: '%', scale: 100, min: 0, max: 50, step: 1 },
] as const

export function BendWaveFields({ targets, onCommit, onPreview, onScrubCommit, onCancel }: {
  targets: { nodeId: string; bend: BendDeformation }[]
  onCommit: (patch: Partial<BendDeformation>, keys: Record<string, number>) => void
  onPreview: (patch: AnimatedValue) => void
  onScrubCommit: (patch: Partial<BendDeformation>, keys: Record<string, number>) => void
  onCancel: () => void
}) {
  return <>
    {controls.map(({ key, animated, scale, ...control }) => {
      const value = targets[0].bend[key]
      const patch = (v: number) => ({ [key]: v / scale })
      return <KeyframeSliderRow key={key} {...control} value={value * scale}
        mixed={targets.some(t => t.bend[key] !== value)}
        onCommit={v => onCommit(patch(v), patch(v))}
        onScrubPreview={v => onPreview({ [animated]: v / scale })}
        onScrubCommit={v => onScrubCommit(patch(v), patch(v))}
        onScrubCancel={onCancel}
        keyframe={<MultiKeyframeButton propertyId={`deformation.bend.${key}`} targets={targets.map(t => ({ nodeId: t.nodeId, currentValue: t.bend[key] }))} />}
      />
    })}
    <p className="text-[10px] text-text-muted">Amplitude sets wave height. Frequency sets the number of waves between the start and end points. Animate phase to move the wave. Edge falloff blends into the unchanged surface.</p>
  </>
}
