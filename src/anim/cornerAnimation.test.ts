// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import { readScene, sceneToBytes } from '@/scene/file'
import { getAnimEngine } from './engine'
import { recordKeyframesForPatch } from './recordKeyframes'
import { resolveCornerAppearance } from '@/render/cornerShape'

afterEach(() => getAnimEngine().pause())

describe('animated corner modes', () => {
  it('holds switches until their exact keyframes, interpolates smoothing, and survives save/load', () => {
    const source = createSceneAPI()
    const id = source.createNode('rect', source.getRoot(), {
      appearance: { opacity: 1, fill: null, stroke: null, effects: [], cornerRadius: 18, cornerSmoothing: 0.6, fullRadius: false, cornerSmoothingEnabled: true },
    })
    recordKeyframesForPatch(source, id, 0, 'appearance', { fullRadius: false, cornerSmoothingEnabled: true, cornerSmoothing: 0.2 })
    recordKeyframesForPatch(source, id, 1, 'appearance', { fullRadius: true, cornerSmoothingEnabled: false, cornerSmoothing: 0.8 })
    const restored = readScene(sceneToBytes(source.doc))
    const api = restored.api
    const appearance = api.getNode(id)!.appearance
    expect(appearance).toMatchObject({ fullRadius: false, cornerSmoothingEnabled: true, cornerSmoothing: 0.6 })
    const engine = getAnimEngine()
    engine.attach(api)
    engine.seek(0.5)
    const halfway = engine.getSnapshot()[id]
    expect(halfway.fullRadius).toBe(0)
    expect(halfway.cornerSmoothingEnabled).toBe(1)
    expect(halfway.cornerSmoothing).toBeGreaterThan(0.2)
    expect(halfway.cornerSmoothing).toBeLessThan(0.8)
    engine.seek(0.999)
    expect(engine.getSnapshot()[id].fullRadius).toBe(0)
    engine.seek(1)
    const final = engine.getSnapshot()[id]
    expect(resolveCornerAppearance(appearance, final, 200, 200)).toMatchObject({ cornerRadius: 100, cornerSmoothing: 0 })
    expect(resolveCornerAppearance(appearance, final, 400, 120).cornerRadius).toBe(60)
    // Seeking backwards restores the prior mode without mutating authored radii.
    engine.seek(0)
    expect(resolveCornerAppearance(appearance, engine.getSnapshot()[id], 200, 200)).toMatchObject({ cornerRadius: 18, cornerSmoothing: 0.2 })
    restored.doc.destroy()
    source.doc.destroy()
  })

  it('temporarily overrides independent corners without discarding them', () => {
    const appearance = { cornerRadius: 8, cornerRadii: { tl: 4, tr: 8, br: 12, bl: 16 }, fullRadius: true }
    expect(resolveCornerAppearance(appearance, undefined, 80, 120)).toMatchObject({ cornerRadius: 40, cornerRadii: undefined })
    expect(resolveCornerAppearance(appearance, { fullRadius: 0 }, 80, 120).cornerRadii).toEqual(appearance.cornerRadii)
  })
})
