// SPDX-License-Identifier: Apache-2.0
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAnimEngine } from '@/anim/engine'
import { createSceneAPI } from '@/scene/doc'
import { SceneContext } from '@/scene/internals'
import { useUI } from '@/state/ui'
import { Inspector } from './Inspector'

vi.mock('@/scene/internals', async () => {
  const { createContext } = await import('react')
  return { SceneContext: createContext(null), apiReady: Promise.resolve(null) }
})
// Server rendering otherwise reads Zustand's initial state, before selection.
vi.mock('@/state/ui', async importOriginal => {
  const module = await importOriginal<typeof import('@/state/ui')>()
  const useStore = Object.assign(
    (selector: (state: ReturnType<typeof module.useUI.getState>) => unknown) => selector(module.useUI.getState()),
    module.useUI,
  )
  return { ...module, useUI: useStore }
})

afterEach(() => {
  getAnimEngine().pause()
  useUI.setState({ selection: [], inspectorMode: 'properties' })
})

describe('camera focus-plane Inspector', () => {
  it.each(['perspective', 'orthographic'] as const)('retains camera rotation and independent focus controls for %s projection', projection => {
    const api = createSceneAPI()
    api.createNode('frame', null, { size: { width: 960, height: 540 } })
    const camera = api.getActiveCamera()!
    api.setNodeProperty(camera.id, 'projection', projection)
    api.setNodeProperty(camera.id, 'depthOfField', true)
    api.setNodeProperty(camera.id, 'focusMode', 'spatial')
    api.setNodeProperty(camera.id, 'focusPlaneRotationX', 25)
    api.setNodeProperty(camera.id, 'focusPlaneRotationY', -35)
    useUI.setState({ selection: [camera.id], inspectorMode: 'properties' })
    getAnimEngine().attach(api)
    const html = renderToStaticMarkup(<SceneContext.Provider value={api}><Inspector /></SceneContext.Provider>)
    for (const label of ['Camera Rotation', 'Rotate X', 'Rotate Y', 'Rotate Z', 'Tilt X', 'Tilt Y', 'Position X', 'Position Y', 'Position Z', 'Align plane with camera', 'Focus plane distance']) {
      expect(html.includes(label), label).toBe(true)
    }
    expect(/<option value="spatial"[^>]*selected=""/.test(html)).toBe(true)
    expect(html).toContain('value="25"')
    expect(html).toContain('value="-35"')
    expect(html).not.toContain('Sample surface depth')
    expect(api.getActiveCamera()!.focusPlaneRotationX).toBe(25)
    api.doc.destroy()
  })
})
