// SPDX-License-Identifier: Apache-2.0
import type { SceneAPI } from '@/scene/doc'
import type { TextNode } from '@/scene/types'
import type { TextAnimationConfig } from '@/anim/textAnimations'
import { readTextShimmer, setTextShimmer, setTextShimmerAnimatedValue, readTextShimmerRange, setTextShimmerRange, setTextShimmerEndpoint } from '@/anim/textShimmerEffect'
import { useMemo } from 'react'
import { useUI } from '@/state/ui'
import { useInspectorAnimatedValues } from './hooks/useAnimatedValues'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import { SquircleSurface } from './fields/SquircleSurface'
import { currentAnimationAuthorTime } from './animationPlayhead'
import { ColorField, FieldRow, KeyframeButton, MultiKeyframeButton, NumberField, TimeField } from './fields'

export function TextShimmerPanel({ api, nodes }: { api: SceneAPI; nodes: TextNode[] }) {
  const nodeIds = useMemo(() => nodes.map(node => node.id), [nodes])
  const animated = useInspectorAnimatedValues(nodeIds)
  useUI(state => state.playing ? null : state.playhead)
  const playhead = currentAnimationAuthorTime()
  const primary = nodes[0]
  if (!primary) return null
  const current = readTextShimmer(api, primary)
  const range = readTextShimmerRange(api, primary.id)
  const start = animated[primary.id]?.shimmerStartTime ?? range?.start ?? current?.startTime ?? 0
  const end = animated[primary.id]?.shimmerEndTime ?? range?.end ?? Math.min(api.getMeta().duration, start + (current?.duration ?? 2))
  const commitRange = (from: number, to: number) => {
    api.doc.transact(() => {
      for (const node of nodes) setTextShimmerRange(api, node.id, from, to)
    }, UNDOABLE_GESTURE_ORIGIN)
  }
  const stampEndpoint = (endpoint: 'start' | 'end') => {
    api.doc.transact(() => {
      for (const node of nodes) setTextShimmerEndpoint(api, node.id, endpoint, currentAnimationAuthorTime())
    }, UNDOABLE_GESTURE_ORIGIN)
  }
  const length = animated[primary.id]?.shimmerWidth ?? current?.shimmerWidth ?? 0.25
  const keyframeTargets = () => nodes.flatMap(node => {
    const config = readTextShimmer(api, node)
    if (node.locked || !config) return []
    return [{ nodeId: node.id, currentValue: animated[node.id]?.shimmerWidth ?? config.shimmerWidth ?? 0.25 }]
  })
  const commitAnimated = (value: number) => {
    const time = currentAnimationAuthorTime()
    api.doc.transact(() => {
      for (const node of nodes) setTextShimmerAnimatedValue(api, node.id, 'shimmerWidth', value, time, useUI.getState().recording)
    }, UNDOABLE_GESTURE_ORIGIN)
  }
  const patch = (value: Partial<TextAnimationConfig> | null) => {
    api.doc.transact(() => {
      for (const node of nodes) {
        setTextShimmer(api, node.id, value, currentAnimationAuthorTime())
        if (value && !readTextShimmerRange(api, node.id)) {
          const updated = api.getNode(node.id)
          const from = updated?.kind === 'text' ? readTextShimmer(api, updated)?.startTime ?? 0 : 0
          setTextShimmerRange(api, node.id, from, from + (updated?.kind === 'text' ? readTextShimmer(api, updated)?.duration ?? 2 : 2))
        }
      }
    }, UNDOABLE_GESTURE_ORIGIN)
  }
  return <section aria-label="Shimmer effect" className="space-y-3 rounded-md bg-app-bg p-2.5">
    <div className="flex items-center justify-between">
      <h3 className="text-xs font-semibold">Shimmer</h3>
      <input type="checkbox" aria-label="Enable Shimmer" checked={!!current} disabled={nodes.every(node => node.locked)} onChange={event => patch(event.target.checked ? {} : null)} />
    </div>
    <p className="text-xs text-text-muted">A color sweep that works alongside your text animation.</p>
    {current && <>
      <FieldRow label="Start"><div className="flex items-center gap-2">
        <TimeField ariaLabel="Shimmer start" value={Math.round(start * 1000)} valueUnit="milliseconds" disabled={nodes.every(node => node.locked)} onCommit={ms => commitRange(ms / 1000, end)} />
        <ShimmerEndpointButton endpoint="start" atPlayhead={!!range && Math.abs(playhead - start) < 0.02} hasRange={!!range} disabled={nodes.every(node => node.locked)} onClick={() => stampEndpoint('start')} />
      </div></FieldRow>
      <FieldRow label="End"><div className="flex items-center gap-2">
        <TimeField ariaLabel="Shimmer end" value={Math.round(end * 1000)} valueUnit="milliseconds" disabled={nodes.every(node => node.locked)} onCommit={ms => commitRange(start, ms / 1000)} />
        <ShimmerEndpointButton endpoint="end" atPlayhead={!!range && Math.abs(playhead - end) < 0.02} hasRange={!!range} disabled={nodes.every(node => node.locked)} onClick={() => stampEndpoint('end')} />
      </div></FieldRow>
            <FieldRow label="Base color">
              <ColorField
                value={primary?.appearance.fill?.kind === 'solid' ? primary.appearance.fill.color : primary?.color ?? '#111111'}
                onCommit={(color) => {
                  if (!color) return
                  api.doc.transact(() => {
                    for (const node of nodes) {
                      if (node.locked) continue
                      api.setNodeProperty(node.id, 'color', color)
                      if (node.appearance.fill?.kind === 'solid') {
                        api.setNodeProperty(node.id, 'appearance', {
                          ...node.appearance, fill: { kind: 'solid', color },
                        })
                      }
                    }
                  }, UNDOABLE_GESTURE_ORIGIN)
                }}
              />
            </FieldRow>
            <FieldRow label="Highlight color">
              <input type="color" aria-label="Shimmer highlight color" value={current.shimmerColor ?? '#ffffff'} onChange={(event) => patch({ shimmerColor: event.target.value })} />
            </FieldRow>
            <FieldRow label="Base text opacity">
              <NumberField value={Math.round((current.shimmerOpacity ?? 0.35) * 100)} onCommit={(value) => patch({ shimmerOpacity: value / 100 })} min={0} max={100} suffix="%" width="w-24" />
            </FieldRow>
            <FieldRow label="Sweep length">
              <div className="flex items-center gap-2">
                <NumberField ariaLabel="Shimmer sweep length" value={length * 100} onCommit={(value) => commitAnimated(value / 100)} min={2} max={100} suffix="%" width="w-24" disabled={nodes.every(node => node.locked)} />
                {nodes.length === 1 ? <KeyframeButton nodeId={primary.id} currentValue={length} propertyId="textShimmer.shimmerWidth" staggerable={false} /> : <MultiKeyframeButton targets={keyframeTargets()} propertyId="textShimmer.shimmerWidth" />}
              </div>
            </FieldRow>
            <FieldRow label="Highlight blur">
              <NumberField value={Math.round((current.shimmerBlur ?? 0.7) * 100)} onCommit={(value) => patch({ shimmerBlur: value / 100 })} min={0} max={100} suffix="%" width="w-24" />
            </FieldRow>
            <FieldRow label="Sweep direction">
              <select aria-label="Shimmer direction" value={current.direction === 'left' ? 'left' : 'right'} onChange={(event) => patch({ direction: event.target.value as 'left' | 'right' })}>
                <option value="right">Left to right</option><option value="left">Right to left</option>
              </select>
            </FieldRow>

    </>}
  </section>
}

function ShimmerEndpointButton({ endpoint, atPlayhead, hasRange, disabled, onClick }: {
  endpoint: 'start' | 'end'; atPlayhead: boolean; hasRange: boolean; disabled: boolean; onClick: () => void
}) {
  const label = `Set shimmer ${endpoint} at playhead`
  return <SquircleSurface as="button" radius={6} type="button" title={label} aria-label={label}
    aria-pressed={atPlayhead} disabled={disabled} onClick={onClick}
    data-keyframe-state={atPlayhead ? 'at' : hasRange ? 'track' : 'none'}
    className="hm-keyframe-surface hm-control-surface hm-control-compact group flex h-7 w-7 shrink-0 items-center justify-center active:scale-[0.96] transition-transform disabled:cursor-not-allowed disabled:opacity-40">
    <span className={`block h-[9px] w-[9px] rotate-45 border transition-colors ${atPlayhead
      ? 'border-keyframe bg-keyframe group-hover:brightness-125'
      : hasRange ? 'border-keyframe bg-transparent group-hover:bg-keyframe/40'
      : 'border-text-dim/50 bg-transparent group-hover:border-keyframe group-hover:bg-keyframe/20'}`} />
  </SquircleSurface>
}
