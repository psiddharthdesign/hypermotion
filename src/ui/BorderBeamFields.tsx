// SPDX-License-Identifier: Apache-2.0
import type { BorderBeamEffect } from '@/scene/borderBeam'
import { BEAM_PALETTES, beamDuration, normalizeBorderBeam } from '@/scene/borderBeam'
import { FieldRow, SelectField, NumberField, CheckboxField } from '@/ui/fields'

export function BorderBeamFields({ effect, onChange }: { effect: BorderBeamEffect; onChange: (patch: Partial<BorderBeamEffect>) => void }) {
  const e = normalizeBorderBeam(effect)
  const numeric = (label: string, key: keyof BorderBeamEffect, value: number, min: number, max: number, step = .1) => (
    <FieldRow label={label}><NumberField ariaLabel={label} value={value} min={min} max={max} step={step} onCommit={v => onChange({ [key]: v })} /></FieldRow>
  )
  return <div className="space-y-1.5">
    <FieldRow label="Style"><SelectField value={e.size!} options={[
      { value: 'md', label: 'Border' }, { value: 'sm', label: 'Compact' }, { value: 'line', label: 'Bottom line' },
      { value: 'pulse-outside', label: 'Pulse outside' }, { value: 'pulse-inner', label: 'Pulse inside' },
    ]} onCommit={size => onChange({ size })} /></FieldRow>
    <FieldRow label="Colors"><SelectField value={e.colorVariant!} options={BEAM_PALETTES.map(value => ({ value, label: value[0].toUpperCase() + value.slice(1) }))} onCommit={colorVariant => onChange({ colorVariant })} /></FieldRow>
    <FieldRow label="Theme"><SelectField value={e.theme!} options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }, { value: 'auto', label: 'Auto · layer fill' }]} onCommit={theme => onChange({ theme })} /></FieldRow>
    <label className="flex items-center justify-between text-[11px] text-text-muted">Active<CheckboxField value={e.active!} onCommit={active => onChange({ active })} /></label>
    {numeric('Strength', 'strength', e.strength!, 0, 1, .01)}
    {numeric('Duration (s)', 'duration', e.duration ?? beamDuration(e.size!), .1, 120)}
    {numeric('Glow size', 'glowSize', e.glowSize!, 0, 4)}
    <label className="flex items-center justify-between text-[11px] text-text-muted">Static colors<CheckboxField value={e.staticColors!} onCommit={staticColors => onChange({ staticColors })} /></label>
    <details className="text-[11px] text-text-muted"><summary className="cursor-pointer py-1">Color and timing</summary><div className="space-y-1.5 pt-1">
      <label className="flex items-center justify-between">Preset brightness<CheckboxField value={e.brightness === undefined} onCommit={auto => onChange({ brightness: auto ? undefined : 1.3 })} /></label>
      {e.brightness !== undefined && numeric('Brightness', 'brightness', e.brightness, 0, 4)}
      <label className="flex items-center justify-between">Preset saturation<CheckboxField value={e.saturation === undefined} onCommit={auto => onChange({ saturation: auto ? undefined : 1.2 })} /></label>
      {e.saturation !== undefined && numeric('Saturation', 'saturation', e.saturation, 0, 4)}
      {numeric('Hue range (°)', 'hueRange', e.hueRange!, 0, 360, 1)}
      <label className="flex items-center justify-between">Follow layer corners<CheckboxField value={e.borderRadius === undefined} onCommit={auto => onChange({ borderRadius: auto ? undefined : 16 })} /></label>
      {e.borderRadius !== undefined && numeric('Radius (px)', 'borderRadius', e.borderRadius, 0, 10000, 1)}
      {numeric('Start (s)', 'startTime', e.startTime!, 0, 86400)}
      <label className="flex items-center justify-between">End with scene<CheckboxField value={e.endTime === undefined} onCommit={auto => onChange({ endTime: auto ? undefined : e.startTime! + 5 })} /></label>
      {e.endTime !== undefined && numeric('End (s)', 'endTime', e.endTime, 0, 86400)}
      {numeric('Fade in (s)', 'fadeIn', e.fadeIn!, 0, 30)}
      {numeric('Fade out (s)', 'fadeOut', e.fadeOut!, 0, 30)}
    </div></details>
  </div>
}
