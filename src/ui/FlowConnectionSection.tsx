// SPDX-License-Identifier: Apache-2.0

import { ArrowRightLeft } from 'lucide-react'
import type { AnimatedValue } from '@/anim'
import type { SceneAPI, VectorNode } from '@/scene'
import { DEFAULT_FLOW_CONNECTION, normalizeFlowConnection, type FlowConnection } from '@/scene/flowConnection'
import { useUI } from '@/state/ui'
import { currentAnimationAuthorTime } from './animationPlayhead'
import { ColorField, FieldRow, KeyframeButton, NumberField, SelectField } from './fields'
import { commitFlowConnectionPatch, swapFlowConnectionEndpoints, type FlowConnectionPatch } from './flowConnectionAuthoring'
import { nodeTransformPreviewStore } from './nodeTransformPreviewStore'

const NUMERIC_FIELDS = {
  width: { propertyId: 'connection.width', preview: 'connectionWidth', min: 0.25, max: 128 },
  flowSpeed: { propertyId: 'connection.flowSpeed', preview: 'connectionFlowSpeed', min: -2000, max: 2000 },
  flowPhase: { propertyId: 'connection.flowPhase', preview: 'connectionFlowPhase', min: 0, max: 1 },
} as const

export function FlowConnectionSection({ api, node, anim }: {
  api: SceneAPI
  node: VectorNode
  anim?: AnimatedValue
}) {
  const connection = normalizeFlowConnection(node.connection && {
    ...node.connection,
    width: anim?.connectionWidth ?? node.connection.width,
    flowSpeed: anim?.connectionFlowSpeed ?? node.connection.flowSpeed,
    flowPhase: anim?.connectionFlowPhase ?? node.connection.flowPhase,
  })
  if (!connection) return null
  const commit = (patch: FlowConnectionPatch) => commitFlowConnectionPatch(
    api, node.id, patch, currentAnimationAuthorTime(), useUI.getState().recording,
  )
  const endpointLabel = (id: string) => api.getNode(id)?.name || 'Missing asset'
  const source = endpointLabel(connection.sourceId)
  const target = endpointLabel(connection.targetId)
  const animatedField = (field: keyof typeof NUMERIC_FIELDS, label: string, suffix: string, scale = 1) => {
    const definition = NUMERIC_FIELDS[field]
    const value = connection[field]
    const normalized = (next: number) => Math.max(definition.min, Math.min(definition.max, next / scale))
    return (
      <FieldRow label={label} keyframe={<KeyframeButton nodeId={node.id} propertyId={definition.propertyId} currentValue={value} />}>
        <NumberField value={value * scale} ariaLabel={label} min={definition.min * scale} max={definition.max * scale}
          step={field === 'width' ? 0.25 : 1} suffix={suffix}
          onCommit={next => commit({ [field]: normalized(next) })}
          onScrubPreview={next => nodeTransformPreviewStore.preview({ [node.id]: { [definition.preview]: normalized(next) } })}
          onScrubCommit={next => {
            commit({ [field]: normalized(next) })
            nodeTransformPreviewStore.finish()
          }}
          onScrubCancel={() => nodeTransformPreviewStore.clear()} />
      </FieldRow>
    )
  }
  return (
    <fieldset disabled={node.locked} className="min-w-0 space-y-3 border-t border-border pt-4" aria-label="Flow connection">
      <div className="text-xs font-semibold text-text">Connection</div>
      <div className="space-y-2 text-[11px] text-text-muted">
        <div className="flex min-w-0 justify-between gap-3"><span>Source</span><span className="truncate text-text" title={source}>{source}</span></div>
        <div className="flex min-w-0 justify-between gap-3"><span>Target</span><span className="truncate text-text" title={target}>{target}</span></div>
        <button type="button" onClick={() => swapFlowConnectionEndpoints(api, node.id)} className="hm-control-surface flex h-8 w-full items-center justify-center gap-2 rounded-md px-2 text-[11px] text-text hover:text-accent">
          <ArrowRightLeft size={14} aria-hidden /> Swap source and target
        </button>
      </div>
      <FieldRow label="Route" layout="compound">
        <SelectField<FlowConnection['routing']> value={connection.routing} ariaLabel="Connection route"
          options={[{ value: 'elbow', label: 'Elbow' }, { value: 'straight', label: 'Straight' }]}
          onCommit={routing => commit({ routing })} />
      </FieldRow>
      <FieldRow label="Line color">
        <ColorField value={connection.color} onCommit={color => commit({ color: color ?? DEFAULT_FLOW_CONNECTION.color })} />
      </FieldRow>
      {animatedField('width', 'Line width', 'px')}
      <label className="flex items-center justify-between gap-2 text-xs font-medium text-text">
        <span>Animated flow</span>
        <input type="checkbox" aria-label="Enable animated flow" checked={connection.flowEnabled}
          onChange={event => commit({ flowEnabled: event.target.checked })}
          className="h-4 w-4 cursor-pointer accent-accent disabled:cursor-not-allowed disabled:opacity-40" />
      </label>
      {connection.flowEnabled && <div className="space-y-3">
        <FieldRow label="Flow color">
          <ColorField value={connection.flowColor} onCommit={flowColor => commit({ flowColor: flowColor ?? DEFAULT_FLOW_CONNECTION.flowColor })} />
        </FieldRow>
        {animatedField('flowSpeed', 'Flow speed', 'px/s')}
        {animatedField('flowPhase', 'Flow phase', '%', 100)}
        <FieldRow label="Pulse spacing">
          <NumberField ariaLabel="Pulse spacing" value={connection.flowSpacing} min={8} max={4000} suffix="px" onCommit={flowSpacing => commit({ flowSpacing })} />
        </FieldRow>
        <FieldRow label="Pulse size">
          <NumberField ariaLabel="Pulse size" value={connection.flowSize} min={1} max={128} suffix="px" onCommit={flowSize => commit({ flowSize })} />
        </FieldRow>
        <p className="text-[11px] leading-4 text-text-muted">Flow follows the timeline. Negative speed reverses it; set speed to zero to animate only the phase.</p>
      </div>}
      <p className="text-[11px] leading-4 text-text-muted">The line stays attached as its assets move, resize, or animate.</p>
    </fieldset>
  )
}
