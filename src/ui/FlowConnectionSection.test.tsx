// SPDX-License-Identifier: Apache-2.0

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { VectorNode } from '@/scene/types'
import { createSceneAPI } from '@/scene/doc'
import { SceneContext } from '@/scene/internals'
import { createFlowConnection } from './flowConnectionAuthoring'
import { FlowConnectionSection } from './FlowConnectionSection'
import { IsometricAssetsPanel } from './IsometricAssetsPanel'

// Exercise the real inspector fields without booting desktop persistence.
vi.mock('@/scene/internals', async () => {
  const { createContext } = await import('react')
  return { SceneContext: createContext(null), apiReady: Promise.resolve(null) }
})

function scene() {
  const api = createSceneAPI()
  api.createNode('frame', null)
  const source = api.createNode('rect', api.getRoot(), { name: 'Source block' })
  const target = api.createNode('ellipse', api.getRoot(), { name: 'Target platform' })
  const id = createFlowConnection(api, [source, target])
  const node = api.getNode(id) as VectorNode
  return { api, source, target, node }
}

describe('flow connection controls', () => {
  it('shows evaluated animation values, including phase as a percentage', () => {
    const { api, node } = scene()
    const html = renderToStaticMarkup(<SceneContext.Provider value={api}>
      <FlowConnectionSection api={api} node={node} anim={{ connectionWidth: 16, connectionFlowSpeed: -240, connectionFlowPhase: 0.75 }} />
    </SceneContext.Provider>)
    expect(html).toContain('Source block')
    expect(html).toContain('Target platform')
    expect(html).toMatch(/aria-label="Line width"[^>]*value="16"/)
    expect(html).toMatch(/aria-label="Flow speed"[^>]*value="-240"/)
    expect(html).toMatch(/aria-label="Flow phase"[^>]*value="75"/)
    expect(api.getNode(node.id)?.connection?.flowPhase).toBe(0)
    api.doc.destroy()
  })

  it('keeps locked connection controls disabled and hides disabled flow fields', () => {
    const { api, node } = scene()
    const html = renderToStaticMarkup(<SceneContext.Provider value={api}>
      <FlowConnectionSection api={api} node={{ ...node, locked: true, connection: { ...node.connection!, flowEnabled: false } }} />
    </SceneContext.Provider>)
    expect(html).toMatch(/^<fieldset disabled=""/)
    expect(html).toContain('Connection route')
    expect(html).not.toContain('aria-label="Flow speed"')
    expect(html).not.toContain('aria-label="Flow phase"')
    api.doc.destroy()
  })

  it('enables the asset-panel connection action only for an eligible pair', () => {
    const { api, source, target } = scene()
    const render = (selection: string[]) => renderToStaticMarkup(<IsometricAssetsPanel api={api} selection={selection}
      currentTime={0} onCreated={() => {}} onViewIsometric={() => {}} />)
    const invalid = render([source])
    expect(invalid).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Connect selected assets/)
    expect(invalid).toContain('Select two assets to connect')
    const valid = render([source, target])
    const button = valid.match(/<button[^>]*>[\s\S]*?<\/button>/g)?.find(markup => markup.includes('Connect selected assets'))
    expect(button).toBeDefined()
    expect(button).not.toContain('disabled=""')
    api.doc.destroy()
  })
})
