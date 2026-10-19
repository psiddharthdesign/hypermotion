// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import type {
  ComponentNode,
  ComponentTimeline,
  Interaction,
  InstanceNode,
  NodeId,
  Track,
} from '@/scene/types'
import { createSceneAPI, type SceneAPI } from '@/scene/doc'
import {
  createComponentInteractionRuntime,
  resolveComponentInstance,
  resolveVariantOverrides,
} from './componentRuntime'

function track(nodeId: NodeId, from: number, to: number): Track {
  return {
    id: `track-${nodeId}`,
    nodeId,
    propertyId: 'appearance.opacity',
    defaultEasing: 'linear',
    keyframes: [
      { id: 'k0', time: 0, value: from },
      { id: 'k1', time: 1, value: to },
    ],
  }
}

const pressTimeline: ComponentTimeline = {
  id: 'press',
  name: 'Press',
  duration: 1,
  tracks: [track('inner', 0, 1)],
}

interface Fixture {
  api: SceneAPI
  componentId: NodeId
  instanceId: NodeId
}

function addInstance(
  api: SceneAPI,
  componentId: NodeId,
  props: Partial<InstanceNode> = {},
): NodeId {
  const instance: Partial<InstanceNode> = {
    name: 'Button instance',
    componentId,
    selection: {},
    overrides: {},
    interactions: [],
    ...props,
  }
  return api.createNode('instance', api.getRoot(), instance)
}

function makeScene(
  component: Partial<ComponentNode> = {},
  instance: Partial<InstanceNode> = {},
): Fixture {
  const api = createSceneAPI()
  const definition: Partial<ComponentNode> = {
    name: 'Button',
    defaultSelection: { state: 'off' },
    variantOverrides: [],
    timelines: { press: pressTimeline },
    interactions: [],
    ...component,
  }
  const componentId = api.createNode('component', api.getRoot(), definition)
  return { api, componentId, instanceId: addInstance(api, componentId, instance) }
}

const clickPlays: Interaction = {
  id: 'i-click',
  event: 'click',
  actions: [{ type: 'playTimeline', timelineId: 'press' }],
}

describe('component instance resolution', () => {
  it('layers the instance selection over the component default', () => {
    const { api, instanceId } = makeScene(
      { defaultSelection: { state: 'off', size: 'md' } },
      { selection: { state: 'on' } },
    )
    const resolved = resolveComponentInstance(api, instanceId)
    expect(resolved?.selection).toEqual({ state: 'on', size: 'md' })
  })

  it('concatenates component interactions with instance-local ones', () => {
    const instanceOnly: Interaction = {
      id: 'i-hover',
      event: 'hoverIn',
      actions: [{ type: 'setVariant', selection: { state: 'hover' } }],
    }
    const { api, instanceId } = makeScene(
      { interactions: [clickPlays] },
      { interactions: [instanceOnly] },
    )
    expect(resolveComponentInstance(api, instanceId)?.interactions).toEqual([
      clickPlays,
      instanceOnly,
    ])
  })

  it('returns null for nodes that are not instances of a component', () => {
    const { api, componentId } = makeScene()
    expect(resolveComponentInstance(api, componentId)).toBeNull()
    expect(resolveComponentInstance(api, 'missing')).toBeNull()

    const orphan = addInstance(api, 'nope')
    expect(resolveComponentInstance(api, orphan)).toBeNull()
  })
})

describe('variant override resolution', () => {
  const component = {
    variantOverrides: [
      {
        match: { state: 'on' },
        overrides: { inner: { fill: 'blue', opacity: 1 } },
      },
      {
        match: { state: 'on', size: 'lg' },
        overrides: { inner: { opacity: 0.5 }, label: { text: 'Large' } },
      },
      {
        match: { state: 'off' },
        overrides: { inner: { fill: 'grey' } },
      },
    ],
  } as unknown as ComponentNode

  it('merges every matching variant, with later entries winning', () => {
    expect(resolveVariantOverrides(component, { state: 'on', size: 'lg' })).toEqual({
      inner: { fill: 'blue', opacity: 0.5 },
      label: { text: 'Large' },
    })
  })

  it('skips variants whose match is not satisfied', () => {
    expect(resolveVariantOverrides(component, { state: 'on', size: 'sm' })).toEqual({
      inner: { fill: 'blue', opacity: 1 },
    })
    expect(resolveVariantOverrides(component, { state: 'off' })).toEqual({
      inner: { fill: 'grey' },
    })
  })
})

describe('interaction dispatch', () => {
  it('starts the named timeline on click', () => {
    const { api, instanceId } = makeScene({ interactions: [clickPlays] })
    const runtime = createComponentInteractionRuntime(api)
    runtime.dispatch({ type: 'click', targetInstanceId: instanceId, now: 10 })
    expect(runtime.getActiveTimelines(instanceId)).toEqual([
      { instanceId, timelineId: 'press', startedAt: 10 },
    ])
  })

  it('ignores events of a different kind and unknown timelines', () => {
    const { api, instanceId } = makeScene({
      interactions: [
        clickPlays,
        {
          id: 'i-ghost',
          event: 'hoverIn',
          actions: [{ type: 'playTimeline', timelineId: 'nope' }],
        },
      ],
    })
    const runtime = createComponentInteractionRuntime(api)
    runtime.dispatch({ type: 'pointerDown', targetInstanceId: instanceId, now: 0 })
    expect(runtime.getActiveTimelines(instanceId)).toEqual([])
    runtime.dispatch({ type: 'hoverIn', targetInstanceId: instanceId, now: 0 })
    expect(runtime.getActiveTimelines(instanceId)).toEqual([])
  })

  it('matches source-scoped interactions against the event source', () => {
    const { api, instanceId } = makeScene({
      interactions: [{ ...clickPlays, sourceNodeId: 'item-2' }],
    })
    const runtime = createComponentInteractionRuntime(api)
    runtime.dispatch({ type: 'click', targetInstanceId: instanceId, now: 0 })
    expect(runtime.getActiveTimelines(instanceId)).toEqual([])
    runtime.dispatch({
      type: 'click',
      targetInstanceId: instanceId,
      sourceNodeId: 'item-1',
      now: 0,
    })
    expect(runtime.getActiveTimelines(instanceId)).toEqual([])
    runtime.dispatch({
      type: 'click',
      targetInstanceId: instanceId,
      sourceNodeId: 'item-2',
      now: 0,
    })
    expect(runtime.getActiveTimelines(instanceId)).toHaveLength(1)
  })

  it('roots interactions handle only events without a source node', () => {
    const { api, instanceId } = makeScene({ interactions: [clickPlays] })
    const runtime = createComponentInteractionRuntime(api)
    runtime.dispatch({
      type: 'click',
      targetInstanceId: instanceId,
      sourceNodeId: 'item-1',
      now: 0,
    })
    expect(runtime.getActiveTimelines(instanceId)).toEqual([])
  })

  it('does nothing for an unresolvable target instance', () => {
    const { api } = makeScene({ interactions: [clickPlays] })
    const runtime = createComponentInteractionRuntime(api)
    runtime.dispatch({ type: 'click', targetInstanceId: 'missing', now: 0 })
    expect(runtime.getActiveTimelines('missing')).toEqual([])
    expect(runtime.resolveInstance('missing')).toBeNull()
  })
})

describe('variant actions', () => {
  it('seeds the selection from the component default and merges setVariant', () => {
    const { api, instanceId } = makeScene({
      defaultSelection: { state: 'off', size: 'md' },
      interactions: [
        {
          id: 'i-set',
          event: 'click',
          actions: [{ type: 'setVariant', selection: { state: 'on' } }],
        },
      ],
    })
    const runtime = createComponentInteractionRuntime(api)
    expect(runtime.getInstanceSelection(instanceId)).toEqual({
      state: 'off',
      size: 'md',
    })
    runtime.dispatch({ type: 'click', targetInstanceId: instanceId, now: 0 })
    expect(runtime.getInstanceSelection(instanceId)).toEqual({
      state: 'on',
      size: 'md',
    })
  })

  it('flips a two-value axis back and forth with toggleVariant', () => {
    const { api, instanceId } = makeScene({
      defaultSelection: { state: 'off' },
      interactions: [
        {
          id: 'i-toggle',
          event: 'click',
          actions: [{ type: 'toggleVariant', axis: 'state', values: ['on', 'off'] }],
        },
      ],
    })
    const runtime = createComponentInteractionRuntime(api)
    runtime.dispatch({ type: 'click', targetInstanceId: instanceId, now: 0 })
    expect(runtime.getInstanceSelection(instanceId).state).toBe('on')
    runtime.dispatch({ type: 'click', targetInstanceId: instanceId, now: 1 })
    expect(runtime.getInstanceSelection(instanceId).state).toBe('off')
  })

  it('returns an empty selection for an unknown instance', () => {
    const { api } = makeScene()
    const runtime = createComponentInteractionRuntime(api)
    expect(runtime.getInstanceSelection('missing')).toEqual({})
  })
})

describe('action targeting', () => {
  it('drives another instance by id', () => {
    const { api, componentId } = makeScene()
    const other = addInstance(api, componentId)
    const instanceId = addInstance(api, componentId, {
      interactions: [
        {
          id: 'i-remote',
          event: 'click',
          actions: [
            {
              type: 'playTimeline',
              timelineId: 'press',
              target: { kind: 'instance', instanceId: other },
            },
          ],
        },
      ],
    })
    const runtime = createComponentInteractionRuntime(api)
    runtime.dispatch({ type: 'click', targetInstanceId: instanceId, now: 4 })
    expect(runtime.getActiveTimelines(instanceId)).toEqual([])
    expect(runtime.getActiveTimelines(other)).toEqual([
      { instanceId: other, timelineId: 'press', startedAt: 4 },
    ])
  })

  it('resolves a node target only when that node is an instance', () => {
    const { api, componentId } = makeScene()
    const plain = api.createNode('rect', api.getRoot())
    const other = addInstance(api, componentId)
    const instanceId = addInstance(api, componentId, {
      interactions: [
        {
          id: 'i-node',
          event: 'click',
          actions: [
            {
              type: 'playTimeline',
              timelineId: 'press',
              target: { kind: 'node', nodeId: plain },
            },
            {
              type: 'playTimeline',
              timelineId: 'press',
              target: { kind: 'node', nodeId: other },
            },
          ],
        },
      ],
    })
    const runtime = createComponentInteractionRuntime(api)
    runtime.dispatch({ type: 'click', targetInstanceId: instanceId, now: 0 })
    expect(runtime.getActiveTimelines(plain)).toEqual([])
    expect(runtime.getActiveTimelines(other)).toHaveLength(1)
  })
})

describe('deferred actions', () => {
  const delayed: Interaction = {
    id: 'i-after',
    event: 'click',
    actions: [
      {
        type: 'after',
        delay: 0.25,
        action: { type: 'playTimeline', timelineId: 'press' },
      },
    ],
  }

  it('runs the wrapped action only once the delay has elapsed', () => {
    const { api, instanceId } = makeScene({ interactions: [delayed] })
    const runtime = createComponentInteractionRuntime(api)
    runtime.dispatch({ type: 'click', targetInstanceId: instanceId, now: 1 })
    runtime.tick(1.1)
    expect(runtime.getActiveTimelines(instanceId)).toEqual([])
    runtime.tick(1.3)
    expect(runtime.getActiveTimelines(instanceId)).toEqual([
      { instanceId, timelineId: 'press', startedAt: 1.25 },
    ])
  })

  it('treats a negative delay as immediate', () => {
    const { api, instanceId } = makeScene({
      interactions: [
        {
          id: 'i-now',
          event: 'click',
          actions: [
            {
              type: 'after',
              delay: -5,
              action: { type: 'playTimeline', timelineId: 'press' },
            },
          ],
        },
      ],
    })
    const runtime = createComponentInteractionRuntime(api)
    runtime.dispatch({ type: 'click', targetInstanceId: instanceId, now: 2 })
    runtime.tick(2)
    expect(runtime.getActiveTimelines(instanceId)).toEqual([
      { instanceId, timelineId: 'press', startedAt: 2 },
    ])
  })
})

describe('timeline lifetime', () => {
  it('restarts a running timeline by default and honors restart: false', () => {
    const noRestart: Interaction = {
      id: 'i-keep',
      event: 'click',
      actions: [{ type: 'playTimeline', timelineId: 'press', restart: false }],
    }
    const { api, instanceId } = makeScene({ interactions: [clickPlays] })
    const runtime = createComponentInteractionRuntime(api)
    runtime.dispatch({ type: 'click', targetInstanceId: instanceId, now: 0 })
    runtime.dispatch({ type: 'click', targetInstanceId: instanceId, now: 0.5 })
    expect(runtime.getActiveTimelines(instanceId)[0]?.startedAt).toBe(0.5)

    const kept = makeScene({ interactions: [noRestart] })
    const keptRuntime = createComponentInteractionRuntime(kept.api)
    keptRuntime.dispatch({ type: 'click', targetInstanceId: kept.instanceId, now: 0 })
    keptRuntime.dispatch({ type: 'click', targetInstanceId: kept.instanceId, now: 0.5 })
    expect(keptRuntime.getActiveTimelines(kept.instanceId)[0]?.startedAt).toBe(0)
  })

  it('retires a one-shot timeline once it runs past its duration', () => {
    const { api, instanceId } = makeScene({ interactions: [clickPlays] })
    const runtime = createComponentInteractionRuntime(api)
    runtime.dispatch({ type: 'click', targetInstanceId: instanceId, now: 0 })
    runtime.tick(1)
    expect(runtime.getActiveTimelines(instanceId)).toHaveLength(1)
    runtime.tick(1.01)
    expect(runtime.getActiveTimelines(instanceId)).toEqual([])
  })

  it('keeps a looping timeline running forever', () => {
    const { api, instanceId } = makeScene({
      timelines: { press: { ...pressTimeline, loop: true } },
      interactions: [clickPlays],
    })
    const runtime = createComponentInteractionRuntime(api)
    runtime.dispatch({ type: 'click', targetInstanceId: instanceId, now: 0 })
    runtime.tick(100)
    expect(runtime.getActiveTimelines(instanceId)).toHaveLength(1)
  })
})

describe('animated values from running timelines', () => {
  it('interpolates linearly between the timeline keyframes', () => {
    const { api, instanceId } = makeScene({ interactions: [clickPlays] })
    const runtime = createComponentInteractionRuntime(api)
    runtime.dispatch({ type: 'click', targetInstanceId: instanceId, now: 0 })
    expect(runtime.getAnimatedValues(instanceId, 0)).toEqual({ inner: { opacity: 0 } })
    expect(runtime.getAnimatedValues(instanceId, 0.25).inner?.opacity).toBeCloseTo(0.25)
    expect(runtime.getAnimatedValues(instanceId, 1)).toEqual({ inner: { opacity: 1 } })
  })

  it('clamps a one-shot timeline at its final value and wraps a looping one', () => {
    const { api, instanceId } = makeScene({ interactions: [clickPlays] })
    const runtime = createComponentInteractionRuntime(api)
    runtime.dispatch({ type: 'click', targetInstanceId: instanceId, now: 0 })
    expect(runtime.getAnimatedValues(instanceId, 0.9).inner?.opacity).toBeCloseTo(0.9)

    const looping = makeScene({
      timelines: { press: { ...pressTimeline, loop: true } },
      interactions: [clickPlays],
    })
    const loopRuntime = createComponentInteractionRuntime(looping.api)
    loopRuntime.dispatch({ type: 'click', targetInstanceId: looping.instanceId, now: 0 })
    expect(
      loopRuntime.getAnimatedValues(looping.instanceId, 2.25).inner?.opacity,
    ).toBeCloseTo(0.25)
  })

  it('merges tracks that target the same inner node', () => {
    const { api, instanceId } = makeScene({
      timelines: {
        press: {
          ...pressTimeline,
          tracks: [
            track('inner', 0, 1),
            {
              id: 'track-move',
              nodeId: 'inner',
              propertyId: 'transform.x',
              defaultEasing: 'linear',
              keyframes: [
                { id: 'a', time: 0, value: 0 },
                { id: 'b', time: 1, value: 40 },
              ],
            },
          ],
        },
      },
      interactions: [clickPlays],
    })
    const runtime = createComponentInteractionRuntime(api)
    runtime.dispatch({ type: 'click', targetInstanceId: instanceId, now: 0 })
    expect(runtime.getAnimatedValues(instanceId, 0.5)).toEqual({
      inner: { opacity: 0.5, x: 20 },
    })
  })

  it('holds a single-keyframe track at its only value', () => {
    const { api, instanceId } = makeScene({
      timelines: {
        press: {
          ...pressTimeline,
          tracks: [
            {
              id: 'track-hold',
              nodeId: 'inner',
              propertyId: 'appearance.opacity',
              defaultEasing: 'linear',
              keyframes: [{ id: 'only', time: 0.5, value: 0.3 }],
            },
          ],
        },
      },
      interactions: [clickPlays],
    })
    const runtime = createComponentInteractionRuntime(api)
    runtime.dispatch({ type: 'click', targetInstanceId: instanceId, now: 0 })
    expect(runtime.getAnimatedValues(instanceId, 0.9)).toEqual({
      inner: { opacity: 0.3 },
    })
  })

  it('steps non-numeric values instead of interpolating them', () => {
    const { api, instanceId } = makeScene({
      timelines: {
        press: {
          ...pressTimeline,
          tracks: [
            {
              id: 'track-fill',
              nodeId: 'inner',
              propertyId: 'appearance.fill',
              defaultEasing: 'linear',
              keyframes: [
                { id: 'a', time: 0, value: '#000000' },
                { id: 'b', time: 1, value: '#ffffff' },
              ],
            },
          ],
        },
      },
      interactions: [clickPlays],
    })
    const runtime = createComponentInteractionRuntime(api)
    runtime.dispatch({ type: 'click', targetInstanceId: instanceId, now: 0 })
    expect(runtime.getAnimatedValues(instanceId, 0.5)).toEqual({
      inner: { fill: '#000000' },
    })
    expect(runtime.getAnimatedValues(instanceId, 1)).toEqual({
      inner: { fill: '#ffffff' },
    })
  })

  it('returns nothing when no timeline is running or the instance is unknown', () => {
    const { api, instanceId } = makeScene({ interactions: [clickPlays] })
    const runtime = createComponentInteractionRuntime(api)
    expect(runtime.getAnimatedValues(instanceId, 0)).toEqual({})
    expect(runtime.getAnimatedValues('missing', 0)).toEqual({})
  })
})
