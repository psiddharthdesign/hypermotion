// SPDX-License-Identifier: Apache-2.0

import type {
  ComponentNode,
  ComponentTimeline,
  Interaction,
  InteractionAction,
  InteractionTarget,
  InstanceNode,
  KeyframeValue,
  NodeId,
  PropertyId,
  Track,
  VariantSelection,
} from '@/scene'
import type { SceneAPI } from '@/scene/doc'
import type { AnimatedValue } from '@/anim'
import { evaluator, type EasingEvaluator } from '@/anim'

export interface ComponentInstanceResolution {
  instance: InstanceNode
  component: ComponentNode
  selection: VariantSelection
  variantOverrides: Record<NodeId, Record<string, unknown>>
  overrides: Record<NodeId, Record<string, unknown>>
  timelines: Record<string, ComponentTimeline>
  interactions: Interaction[]
}

export interface ComponentInteractionEvent {
  type: Interaction['event']
  /** Concrete instance receiving the event. */
  targetInstanceId: NodeId
  /**
   * Optional node id inside the component definition. Omit to target the
   * component root. A click on a dropdown item can pass that item id.
   */
  sourceNodeId?: NodeId
  /** Seconds. Defaults to the runtime clock. */
  now?: number
}

export interface RunningComponentTimeline {
  instanceId: NodeId
  timelineId: string
  startedAt: number
}

export interface ComponentInteractionRuntime {
  dispatch(event: ComponentInteractionEvent): void
  tick(now?: number): void
  getInstanceSelection(instanceId: NodeId): VariantSelection
  getActiveTimelines(instanceId: NodeId): RunningComponentTimeline[]
  getAnimatedValues(instanceId: NodeId, now?: number): Record<NodeId, AnimatedValue>
  resolveInstance(instanceId: NodeId): ComponentInstanceResolution | null
}

interface ScheduledAction {
  at: number
  instanceId: NodeId
  action: InteractionAction
}

export function createComponentInteractionRuntime(
  api: SceneAPI,
): ComponentInteractionRuntime {
  const selectionByInstance = new Map<NodeId, VariantSelection>()
  const running = new Map<string, RunningComponentTimeline>()
  const scheduled: ScheduledAction[] = []
  const easerCache = new Map<string, EasingEvaluator>()

  const nowSeconds = () => {
    if (typeof performance !== 'undefined') return performance.now() / 1000
    return Date.now() / 1000
  }

  const runtime: ComponentInteractionRuntime = {
    dispatch(event) {
      const at = event.now ?? nowSeconds()
      flushScheduled(at)
      const resolved = resolveComponentInstance(api, event.targetInstanceId)
      if (!resolved) return
      seedSelection(resolved)
      for (const interaction of resolved.interactions) {
        if (!interactionMatches(interaction, event)) continue
        for (const action of interaction.actions) {
          runAction(event.targetInstanceId, action, at)
        }
      }
    },
    tick(now = nowSeconds()) {
      flushScheduled(now)
      for (const [key, active] of running) {
        const resolved = resolveComponentInstance(api, active.instanceId)
        const timeline = resolved?.timelines[active.timelineId]
        if (!timeline) {
          running.delete(key)
          continue
        }
        if (!timeline.loop && now - active.startedAt > timeline.duration) {
          running.delete(key)
        }
      }
    },
    getInstanceSelection(instanceId) {
      const resolved = resolveComponentInstance(api, instanceId)
      if (!resolved) return {}
      seedSelection(resolved)
      return { ...(selectionByInstance.get(instanceId) ?? resolved.selection) }
    },
    getActiveTimelines(instanceId) {
      return Array.from(running.values()).filter((t) => t.instanceId === instanceId)
    },
    getAnimatedValues(instanceId, now = nowSeconds()) {
      flushScheduled(now)
      const resolved = resolveComponentInstance(api, instanceId)
      if (!resolved) return {}
      const out: Record<NodeId, AnimatedValue> = {}
      for (const active of runtime.getActiveTimelines(instanceId)) {
        const timeline = resolved.timelines[active.timelineId]
        if (!timeline) continue
        const localTime = timeline.loop
          ? positiveModulo(now - active.startedAt, Math.max(0.0001, timeline.duration))
          : Math.min(timeline.duration, Math.max(0, now - active.startedAt))
        for (const track of timeline.tracks) {
          const value = out[track.nodeId] ?? {}
          applyTrack(track, localTime, value, easerCache)
          out[track.nodeId] = value
        }
      }
      return out
    },
    resolveInstance(instanceId) {
      return resolveComponentInstance(api, instanceId)
    },
  }

  function seedSelection(resolved: ComponentInstanceResolution): void {
    if (selectionByInstance.has(resolved.instance.id)) return
    selectionByInstance.set(resolved.instance.id, { ...resolved.selection })
  }

  function flushScheduled(now: number): void {
    scheduled.sort((a, b) => a.at - b.at)
    while (scheduled.length > 0 && scheduled[0]!.at <= now) {
      const next = scheduled.shift()!
      runAction(next.instanceId, next.action, next.at)
    }
  }

  function runAction(instanceId: NodeId, action: InteractionAction, now: number): void {
    if (action.type === 'after') {
      scheduled.push({
        at: now + Math.max(0, action.delay),
        instanceId,
        action: action.action,
      })
      return
    }

    const targetInstanceId = resolveTargetInstanceId(api, instanceId, action.target)
    if (!targetInstanceId) return
    const resolved = resolveComponentInstance(api, targetInstanceId)
    if (!resolved) return
    seedSelection(resolved)

    if (action.type === 'playTimeline') {
      if (!resolved.timelines[action.timelineId]) return
      const key = `${targetInstanceId}:${action.timelineId}`
      if (action.restart !== false || !running.has(key)) {
        running.set(key, {
          instanceId: targetInstanceId,
          timelineId: action.timelineId,
          startedAt: now,
        })
      }
      return
    }

    if (action.type === 'setVariant') {
      selectionByInstance.set(targetInstanceId, {
        ...runtime.getInstanceSelection(targetInstanceId),
        ...action.selection,
      })
      return
    }

    if (action.type === 'toggleVariant') {
      const current = runtime.getInstanceSelection(targetInstanceId)
      const next =
        current[action.axis] === action.values[0]
          ? action.values[1]
          : action.values[0]
      selectionByInstance.set(targetInstanceId, {
        ...current,
        [action.axis]: next,
      })
    }
  }

  return runtime
}

export function resolveComponentInstance(
  api: SceneAPI,
  instanceId: NodeId,
): ComponentInstanceResolution | null {
  const instance = api.getNode(instanceId)
  if (!instance || instance.kind !== 'instance') return null
  const component = api.getNode(instance.componentId)
  if (!component || component.kind !== 'component') return null
  const selection = {
    ...component.defaultSelection,
    ...instance.selection,
  }
  return {
    instance,
    component,
    selection,
    variantOverrides: resolveVariantOverrides(component, selection),
    overrides: instance.overrides,
    timelines: component.timelines,
    interactions: [...component.interactions, ...instance.interactions],
  }
}

export function resolveVariantOverrides(
  component: ComponentNode,
  selection: VariantSelection,
): Record<NodeId, Record<string, unknown>> {
  const out: Record<NodeId, Record<string, unknown>> = {}
  for (const variant of component.variantOverrides) {
    if (!variantMatches(variant.match, selection)) continue
    for (const [nodeId, patch] of Object.entries(variant.overrides)) {
      out[nodeId] = { ...(out[nodeId] ?? {}), ...patch }
    }
  }
  return out
}

function interactionMatches(
  interaction: Interaction,
  event: ComponentInteractionEvent,
): boolean {
  if (interaction.event !== event.type) return false
  if (!interaction.sourceNodeId) return !event.sourceNodeId
  return interaction.sourceNodeId === event.sourceNodeId
}

function resolveTargetInstanceId(
  api: SceneAPI,
  currentInstanceId: NodeId,
  target: InteractionTarget | undefined,
): NodeId | null {
  if (!target || target.kind === 'self') return currentInstanceId
  if (target.kind === 'instance') return target.instanceId
  const node = api.getNode(target.nodeId)
  return node?.kind === 'instance' ? node.id : null
}

function variantMatches(
  match: VariantSelection,
  selection: VariantSelection,
): boolean {
  for (const [axis, value] of Object.entries(match)) {
    if (selection[axis] !== value) return false
  }
  return true
}

function applyTrack(
  track: Track,
  t: number,
  into: AnimatedValue,
  cache: Map<string, EasingEvaluator>,
): void {
  const kfs = track.keyframes
  if (kfs.length === 0) return
  let a = kfs[0]!
  let b = kfs[kfs.length - 1]!
  if (t <= a.time || kfs.length === 1) {
    writeProperty(track.propertyId, a.value, into)
    return
  }
  if (t >= b.time) {
    writeProperty(track.propertyId, b.value, into)
    return
  }
  for (let i = 0; i < kfs.length - 1; i++) {
    const k0 = kfs[i]!
    const k1 = kfs[i + 1]!
    if (t >= k0.time && t <= k1.time) {
      a = k0
      b = k1
      break
    }
  }
  const span = b.time - a.time
  const rawU = span <= 0 ? 0 : (t - a.time) / span
  const cacheKey = `${track.id}:${a.id}`
  let easer = cache.get(cacheKey)
  if (!easer) {
    easer = evaluator(a.easingOut ?? track.defaultEasing)
    cache.set(cacheKey, easer)
  }
  const value = interpolateValue(track.propertyId, a.value, b.value, easer(rawU))
  writeProperty(track.propertyId, value, into)
}

function interpolateValue(
  _propertyId: PropertyId,
  a: KeyframeValue,
  b: KeyframeValue,
  u: number,
): KeyframeValue {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * u
  return u < 1 ? a : b
}

function writeProperty(
  id: PropertyId,
  value: KeyframeValue,
  into: AnimatedValue,
): void {
  if (id === 'appearance.fill') {
    if (typeof value === 'string') into.fill = value
    return
  }
  if (typeof value !== 'number') return
  switch (id) {
    case 'transform.x': into.x = value; break
    case 'transform.y': into.y = value; break
    case 'transform.z': into.z = value; break
    case 'transform.rotation': into.rotation = value; break
    case 'transform.rotationX': into.rotationX = value; break
    case 'transform.rotationY': into.rotationY = value; break
    case 'transform.scaleX': into.scaleX = value; break
    case 'transform.scaleY': into.scaleY = value; break
    case 'transform.anchorX': into.anchorX = value; break
    case 'transform.anchorY': into.anchorY = value; break
    case 'transform.anchorZ': into.anchorZ = value; break
    case 'appearance.opacity': into.opacity = value; break
    case 'appearance.cornerRadius': into.cornerRadius = value; break
    case 'camera.focusDistance': into.focusDistance = value; break
    case 'camera.focusX': into.focusX = value; break
    case 'camera.focusY': into.focusY = value; break
    case 'camera.focusWorldX': into.focusWorldX = value; break
    case 'camera.focusWorldY': into.focusWorldY = value; break
    case 'camera.focusWorldZ': into.focusWorldZ = value; break
    case 'camera.focusRadius': into.focusRadius = value; break
    case 'camera.pointOfInterestX': into.pointOfInterestX = value; break
    case 'camera.pointOfInterestY': into.pointOfInterestY = value; break
    case 'camera.pointOfInterestZ': into.pointOfInterestZ = value; break
    case 'camera.focalLength': into.focalLength = value; break
    case 'camera.fieldOfView': into.fieldOfView = value; break
    case 'camera.nearClip': into.nearClip = value; break
    case 'camera.farClip': into.farClip = value; break
    case 'camera.aperture': into.aperture = value; break
    case 'camera.fStop': into.fStop = value; break
    case 'camera.bladeCount': into.bladeCount = value; break
    case 'camera.bladeRotation': into.bladeRotation = value; break
    case 'camera.bokehRatio': into.bokehRatio = value; break
    case 'camera.iso': into.iso = value; break
    case 'camera.blurLevel': into.blurLevel = value; break
    case 'camera.blurQuality': into.blurQuality = value; break
    default: break
  }
}

function positiveModulo(value: number, mod: number): number {
  return ((value % mod) + mod) % mod
}
