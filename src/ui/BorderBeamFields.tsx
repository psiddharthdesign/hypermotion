// SPDX-License-Identifier: Apache-2.0
import { useMemo } from 'react'
import { useSceneAPI } from '@/scene'
import { useUI } from '@/state/ui'
import { readBeamRange, setBeamRange, stampBeamEndpoint } from '@/anim/beamTimingTrack'
import { findTrack } from '@/anim/tracks'
import { effectBeamRangePropertyId } from '@/scene/props'
import { currentAnimationAuthorTime } from './animationPlayhead'
import { useInspectorAnimatedValues } from './hooks/useAnimatedValues'
import { SquircleSurface } from './fields/SquircleSurface'
import { X } from 'lucide-react'
import type { BorderBeamEffect } from '@/scene/borderBeam'
import { BEAM_PALETTES, DEFAULT_BEAM_COLORS, normalizeBorderBeam } from '@/scene/borderBeam'
import { FieldRow, SelectField, NumberField, CheckboxField, ColorField, TimeField } from '@/ui/fields'

export function BorderBeamFields({ nodeId, effectId, effect, onChange }: { nodeId: string; effectId: string; effect: BorderBeamEffect; onChange: (patch: Partial<BorderBeamEffect>) => void }) {
  const api = useSceneAPI()
  const ids = useMemo(() => [nodeId], [nodeId])
  const animated = useInspectorAnimatedValues(ids)
  useUI(state => state.playing ? null : state.playhead)
  const playhead = currentAnimationAuthorTime()
  const range = animated[nodeId]?.effectBeamRange?.[effectId] ?? readBeamRange(api, nodeId, effectId) ?? { start: 0, end: api.getMeta().duration }
  const hasTrack = !!findTrack(api, nodeId, effectBeamRangePropertyId(effectId))
  const locked = !!api.getNode(nodeId)?.locked
  const timingField = (endpoint: 'start' | 'end') => {
    const label = endpoint === 'start' ? 'Start' : 'End'
    const at = hasTrack && Math.abs(playhead - range[endpoint]) < .02
    const title = `Set Beam ${endpoint} at playhead`
    return <FieldRow label={label}><div className="flex items-center gap-2">
      <TimeField ariaLabel={`Beam ${endpoint}`} value={Math.round(range[endpoint] * 1000)} valueUnit="milliseconds" disabled={locked}
        onCommit={ms => setBeamRange(api, nodeId, effectId, endpoint === 'start' ? ms / 1000 : range.start, endpoint === 'end' ? ms / 1000 : range.end)} />
      <SquircleSurface as="button" radius={6} type="button" title={title} aria-label={title} aria-pressed={at} disabled={locked}
        data-keyframe-state={at ? 'at' : hasTrack ? 'track' : 'none'}
        onClick={() => stampBeamEndpoint(api, nodeId, effectId, endpoint, currentAnimationAuthorTime())}
        className="hm-keyframe-surface hm-control-surface hm-control-compact group flex h-7 w-7 shrink-0 items-center justify-center disabled:opacity-40">
        <span className={`block h-[9px] w-[9px] rotate-45 border ${at ? 'border-keyframe bg-keyframe' : hasTrack ? 'border-keyframe' : 'border-text-dim/50'}`} />
      </SquircleSurface>
    </div></FieldRow>
  }
  const e = normalizeBorderBeam(effect)
  const numeric = (label: string, key: keyof BorderBeamEffect, value: number, min: number, step = .1) => (
    <FieldRow label={label}><NumberField suffix={['speed', 'strength', 'edgeWidth', 'glowSize', 'brightness', 'saturation', 'variation', 'spread'].includes(key) ? '×' : undefined} ariaLabel={label} value={value} min={min} step={step} onCommit={v => onChange({ [key]: v })} /></FieldRow>
  )
  return <div className="space-y-1.5">
    <FieldRow label="Style"><SelectField value={e.size!} options={[
      { value: 'md', label: 'Border' }, { value: 'sm', label: 'Compact' }, { value: 'line', label: 'Bottom line' },
      { value: 'pulse-outside', label: 'Pulse outside' }, { value: 'pulse-inner', label: 'Pulse inside' },
    ]} onCommit={size => onChange({ size })} /></FieldRow>
    <FieldRow label="Colors"><SelectField value={e.colorVariant!} options={BEAM_PALETTES.map(value => ({ value, label: value[0].toUpperCase() + value.slice(1) }))} onCommit={colorVariant => onChange({ colorVariant, colors: undefined })} /></FieldRow>
    <label className="flex items-center justify-between text-[11px] text-text-muted">Custom colors<CheckboxField value={!!e.colors} onCommit={custom => onChange({ colors: custom ? [...DEFAULT_BEAM_COLORS] : undefined })} /></label>
    {e.colors && <div className="space-y-1.5">
      {e.colors.map((color, index) => <FieldRow key={index} label={`Color ${index + 1}`}>
        <ColorField value={color} onCommit={next => {
          if (!next) return
          onChange({ colors: e.colors!.map((c, i) => i === index ? next : c) })
        }} />
        <button type="button" aria-label={`Remove color ${index + 1}`} disabled={e.colors!.length <= 2}
          className="px-1 text-text-muted disabled:opacity-30" onClick={() => onChange({ colors: e.colors!.filter((_, i) => i !== index) })}><X size={12} /></button>
      </FieldRow>)}
      <button type="button" disabled={e.colors.length >= 8} className="text-[11px] text-text-muted disabled:opacity-30"
        onClick={() => onChange({ colors: [...e.colors!, '#ff9b32'] })}>Add color</button>
    </div>}
    <FieldRow label="Theme"><SelectField value={e.theme!} options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }, { value: 'auto', label: 'Auto · layer fill' }]} onCommit={theme => onChange({ theme })} /></FieldRow>
    <label className="flex items-center justify-between text-[11px] text-text-muted">Active<CheckboxField value={e.active!} onCommit={active => onChange({ active })} /></label>
    {numeric('Strength', 'strength', e.strength!, 0, .1)}
    {timingField('start')}
    {timingField('end')}
    {numeric('Speed', 'speed', e.speed!, 0, .1)}
    {numeric('Edge width', 'edgeWidth', e.edgeWidth!, 0, .25)}
    {numeric('Glow size', 'glowSize', e.glowSize!, 0)}
    <label className="flex items-center justify-between text-[11px] text-text-muted">Non-uniform<CheckboxField value={e.nonUniform!} onCommit={nonUniform => onChange({ nonUniform })} /></label>
    {e.nonUniform && <div className="space-y-1.5">
      {numeric('Variation', 'variation', e.variation!, 0)}
      {numeric('Spread', 'spread', e.spread!, 0)}
      {numeric('Pattern seed', 'seed', e.seed!, 0, 1)}
      <label className="flex items-center justify-between text-[11px] text-text-muted">Moving highlights<CheckboxField value={e.animatePattern!} onCommit={animatePattern => onChange({ animatePattern })} /></label>
      <p className="text-[10px] text-text-muted">Variation tapers the edge and glow. Spread widens the highlights. Change the seed for another arrangement.</p>
    </div>}
    {!e.colors && <label className="flex items-center justify-between text-[11px] text-text-muted">Static colors<CheckboxField value={e.staticColors!} onCommit={staticColors => onChange({ staticColors })} /></label>}
    <details className="text-[11px] text-text-muted"><summary className="cursor-pointer py-1">Color and timing</summary><div className="space-y-1.5 pt-1">
      <label className="flex items-center justify-between">{e.colors ? 'Original brightness' : 'Preset brightness'}<CheckboxField value={e.brightness === undefined} onCommit={auto => onChange({ brightness: auto ? undefined : e.colors ? 1 : 1.3 })} /></label>
      {e.brightness !== undefined && numeric('Brightness', 'brightness', e.brightness, 0)}
      <label className="flex items-center justify-between">{e.colors ? 'Original saturation' : 'Preset saturation'}<CheckboxField value={e.saturation === undefined} onCommit={auto => onChange({ saturation: auto ? undefined : e.colors ? 1 : 1.2 })} /></label>
      {e.saturation !== undefined && numeric('Saturation', 'saturation', e.saturation, 0)}
      {!e.colors && numeric('Hue range (°)', 'hueRange', e.hueRange!, 0, 1)}
      <label className="flex items-center justify-between">Follow layer corners<CheckboxField value={e.borderRadius === undefined} onCommit={auto => onChange({ borderRadius: auto ? undefined : 16 })} /></label>
      {e.borderRadius !== undefined && numeric('Radius (px)', 'borderRadius', e.borderRadius, 0, 1)}
      {numeric('Fade in (s)', 'fadeIn', e.fadeIn!, 0)}
      {numeric('Fade out (s)', 'fadeOut', e.fadeOut!, 0)}
    </div></details>
  </div>
}
