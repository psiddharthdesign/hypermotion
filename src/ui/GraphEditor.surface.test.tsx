// SPDX-License-Identifier: Apache-2.0

import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '@/scene/types'
import { createSceneAPI, type SceneAPI } from '@/scene/doc'
import { SceneContext } from '@/scene/internals'
import { GraphEditor } from './GraphEditor'

// Keep this surface test isolated from the desktop's persistent default scene.
vi.mock('@/scene/internals', async () => {
  const { createContext } = await import('react')
  return { SceneContext: createContext(null), apiReady: Promise.resolve(null) }
})

const scenes: SceneAPI[] = []
afterEach(() => {
  for (const api of scenes.splice(0)) api.doc.destroy()
})

function fixture() {
  const api = createSceneAPI()
  scenes.push(api)
  const nodeId = api.createNode('frame', null, { name: 'Card' })
  const track: Track = {
    id: 'position', nodeId, propertyId: 'transform.x', defaultEasing: 'linear',
    keyframes: [0, 100, 20, 80].map((value, index) => ({ id: `key${index}`, time: index, value })),
  }
  api.setTrack(track)
  const render = (selectedKeys: string[], timeline = true) => renderToStaticMarkup(
    <SceneContext.Provider value={api}>
      <GraphEditor
        selectedKeys={selectedKeys}
        onSelectionChange={() => undefined}
        timeline={timeline ? { width: 800, pxPerSecond: 100, duration: 8, frameRate: 60, playhead: 1 } : undefined}
      />
    </SceneContext.Provider>,
  )
  return { api, nodeId, render }
}

const count = (html: string, value: string) => html.split(value).length - 1

describe('GraphEditor selection surface', () => {
  it('shows only a selected middle key’s adjoining curves and its own two handles', () => {
    const { render } = fixture()
    const html = render(['position:key1'])
    expect(html).toContain('data-graph-segment="key0:key1"')
    expect(html).toContain('data-graph-segment="key1:key2"')
    expect(html).not.toContain('data-graph-segment="key2:key3"')
    expect(count(html, 'data-graph-handle=')).toBe(2)
    expect(html).toContain('aria-label="Incoming easing handle at 1 seconds"')
    expect(html).toContain('aria-label="Outgoing easing handle at 1 seconds"')
    // Other keys remain available for selecting and dragging without curve clutter.
    expect(count(html, 'data-graph-key=')).toBe(4)
    expect(count(html, 'aria-pressed="true"')).toBe(1)
  })

  it('reveals each shared segment once when adjacent keys are selected', () => {
    const { render } = fixture()
    const html = render(['position:key1', 'position:key2'])
    expect(count(html, 'data-graph-segment=')).toBe(3)
    expect(count(html, 'data-graph-segment="key1:key2"')).toBe(1)
    expect(count(html, 'data-graph-handle=')).toBe(4)
    expect(html).not.toContain('aria-label="Outgoing easing handle at 0 seconds"')
    expect(html).not.toContain('aria-label="Incoming easing handle at 3 seconds"')
  })

  it('lets a selected final key expose and ease its incoming segment', () => {
    const { render } = fixture()
    const html = render(['position:key3'])
    expect(count(html, 'data-graph-segment=')).toBe(1)
    expect(html).toContain('data-graph-segment="key2:key3"')
    expect(html).toContain('aria-label="Incoming easing handle at 3 seconds"')
    expect(count(html, 'data-graph-handle=')).toBe(1)
    expect(html).not.toContain('disabled=""')
  })

  it('aligns key positions with the timeline origin and time scale', () => {
    const { render } = fixture()
    const html = render(['position:key1'])
    expect(html).toContain('viewBox="0 0 800 196"')
    expect(html).toContain('width:800px;height:196px')
    const firstKey = html.slice(html.indexOf('data-graph-key="key0"'))
    expect(firstKey).toMatch(/^data-graph-key="key0"[^>]*><circle cx="0"/)
    const secondKey = html.slice(html.indexOf('data-graph-key="key1"'))
    expect(secondKey).toMatch(/^data-graph-key="key1"[^>]*><circle cx="100"/)
    expect(html).toContain('data-timeline-selection-surface="1"')
    expect(html).toContain('touch-action:none')
  })

  it('keeps the standalone graph collapsed and disables actions without selected curves', () => {
    const { render } = fixture()
    const html = render([], false)
    expect(html).toMatch(/^<details\b/)
    expect(html).not.toMatch(/^<details[^>]*\bopen(?:=|\s|>)/)
    expect(html).toContain('Select numeric keyframes')
    expect(count(html, 'disabled=""')).toBe(2)
    expect(html).not.toContain('data-graph-handle=')
    expect(html).not.toContain('data-graph-segment=')
  })

  it('offers selected numeric properties without treating discrete numeric toggles as curves', () => {
    const { api, nodeId, render } = fixture()
    api.setTrack({ id: 'opacity', nodeId, propertyId: 'appearance.opacity', defaultEasing: 'linear', keyframes: [{ id: 'fade', time: 0, value: 0 }, { id: 'shown', time: 1, value: 1 }] })
    api.setTrack({ id: 'toggle', nodeId, propertyId: 'appearance.fullRadius', defaultEasing: 'linear', keyframes: [{ id: 'off', time: 0, value: 0 }, { id: 'on', time: 1, value: 1 }] })
    const html = render(['position:key1', 'opacity:fade', 'toggle:off'])
    expect(html).toContain('aria-label="Graph property"')
    expect(html).toContain('<option value="position"')
    expect(html).toContain('<option value="opacity"')
    expect(html).not.toContain('<option value="toggle"')
    expect(count(html, 'data-graph-handle=')).toBe(2)
  })
})
