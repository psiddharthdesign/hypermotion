// SPDX-License-Identifier: Apache-2.0

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import { SolidPlacementSection } from './SolidPlacementSection'

function fixture() {
  const api = createSceneAPI()
  const root = api.createNode('frame', null)
  const group = api.createNode('frame', root, { name: 'Server' })
  const part = api.createNode('rect', group, { extrusion: { depth: 60, sideColor: '#00f' } })
  const render = (id: string) => renderToStaticMarkup(<SolidPlacementSection api={api} node={api.getNode(id)!} />)
  return { api, root, group, part, render }
}

describe('solid placement controls', () => {
  it('offers opt-in protection for a solid and its enclosing asset group', () => {
    const { api, group, part, render } = fixture()
    for (const id of [group, part]) {
      const html = render(id)
      expect(html).toContain('aria-label="Prevent overlap"')
      expect(html).not.toContain('checked=""')
      expect(html).not.toContain('disabled=""')
    }
    api.doc.destroy()
  })
  it('shows inherited protection checked and disabled, even when the child flag is off', () => {
    const { api, group, part, render } = fixture()
    api.setNodeProperty(group, 'preventOverlap', true)
    api.setNodeProperty(part, 'preventOverlap', false)
    expect(render(part)).toMatch(/<input[^>]*disabled=""[^>]*checked=""/)
    expect(render(part)).toContain('Protected by Server.')
    expect(render(group)).not.toContain('disabled=""')
    api.doc.destroy()
  })
  it('inherits any protected ancestor and keeps a directly enabled nested group editable when unprotected above', () => {
    const { api, group, part, render } = fixture()
    const nested = api.createNode('frame', group, { name: 'Module', preventOverlap: true })
    api.appendChild(nested, part)
    expect(render(part)).toContain('Protected by Module.')
    expect(render(nested)).not.toContain('disabled=""')
    api.setNodeProperty(group, 'preventOverlap', true)
    expect(render(nested)).toContain('Protected by Server.')
    expect(render(nested)).toContain('disabled=""')
    api.doc.destroy()
  })
  it('hides the control for scene root, cameras, flat shapes, connections and empty groups', () => {
    const { api, root, render } = fixture()
    const flat = api.createNode('rect', root)
    const zero = api.createNode('ellipse', root, { extrusion: { depth: 0, sideColor: '#00f' } })
    const group = api.createNode('frame', root)
    const wire = api.createNode('vector', root)
    for (const id of [root, api.getActiveCameraId()!, flat, zero, group, wire]) expect(render(id)).toBe('')
    api.doc.destroy()
  })
  it('leaves locked assets visible but disables editing their protection', () => {
    const { api, part, render } = fixture()
    api.setNodeProperty(part, 'locked', true)
    expect(render(part)).toMatch(/^<fieldset disabled=""/)
    api.doc.destroy()
  })
})
