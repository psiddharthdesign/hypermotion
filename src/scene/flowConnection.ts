// SPDX-License-Identifier: Apache-2.0

import type { SceneAPI } from './doc'

/** An attached world-space path, stored on an ordinary vector layer. */
export interface FlowConnection {
  version: 1
  sourceId: string
  targetId: string
  routing: 'elbow' | 'straight'
  color: string
  width: number
  flowEnabled: boolean
  flowColor: string
  flowSpeed: number
  flowSpacing: number
  flowSize: number
  flowPhase: number
}

export const DEFAULT_FLOW_CONNECTION = {
  version: 1 as const, routing: 'elbow' as const, color: '#2563eb', width: 4,
  flowEnabled: true, flowColor: '#93c5fd', flowSpeed: 120, flowSpacing: 120,
  flowSize: 12, flowPhase: 0,
}

export function finiteFlowNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback
}

export function normalizeFlowConnection(value: unknown): FlowConnection | undefined {
  if (!value || typeof value !== 'object') return undefined
  const v = value as Partial<FlowConnection>
  if (typeof v.sourceId !== 'string' || !v.sourceId || typeof v.targetId !== 'string' || !v.targetId || v.sourceId === v.targetId) return undefined
  const color = (value: unknown, fallback: string) => typeof value === 'string' && value.trim() && value.length <= 256 ? value : fallback
  return {
    version: 1, sourceId: v.sourceId, targetId: v.targetId,
    routing: v.routing === 'straight' ? 'straight' : 'elbow',
    color: color(v.color, DEFAULT_FLOW_CONNECTION.color),
    width: finiteFlowNumber(v.width, 4, 0.25, 128),
    flowEnabled: v.flowEnabled !== false,
    flowColor: color(v.flowColor, DEFAULT_FLOW_CONNECTION.flowColor),
    flowSpeed: finiteFlowNumber(v.flowSpeed, 120, -2000, 2000),
    flowSpacing: finiteFlowNumber(v.flowSpacing, 120, 8, 4000),
    flowSize: finiteFlowNumber(v.flowSize, 12, 1, 128),
    flowPhase: finiteFlowNumber(v.flowPhase, 0, 0, 1),
  }
}

/** Called after the complete copied subtree has fresh IDs. External links stay attached. */
export function remapFlowConnections(api: SceneAPI, nodeMap: ReadonlyMap<string, string>): void {
  for (const targetId of nodeMap.values()) {
    const node = api.getNode(targetId)
    if (node?.kind !== 'vector' || !node.connection) continue
    api.setNodeProperty(targetId, 'connection', {
      ...node.connection,
      sourceId: nodeMap.get(node.connection.sourceId) ?? node.connection.sourceId,
      targetId: nodeMap.get(node.connection.targetId) ?? node.connection.targetId,
    })
  }
}
