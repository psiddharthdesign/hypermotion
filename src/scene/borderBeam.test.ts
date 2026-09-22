// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { createSceneAPI } from './doc'
import { readScene, sceneToBytes } from './file'
import { BEAM_PALETTES, BEAM_STYLES, beamTiming, normalizeBorderBeam } from './borderBeam'
import { expandRectForLayerEffects, nodeEffectsWrapSubtree, resolveAnimatedLayerEffects } from '@/render/layerEffects'
import { rebaseSceneNodes } from '@/project/splitScene'
import { resolveBeamTheme } from '@/render/beam/paintBorderBeam'

describe('Beam layer effect', () => {
  it('round-trips every style and palette in a saved scene', async () => {
    const api = createSceneAPI()
    const root = api.createNode('frame', null)
    for (const size of BEAM_STYLES) for (const colorVariant of BEAM_PALETTES) {
      api.createNode('rect', root, { appearance: { opacity: 1, fill: null, stroke: null, cornerRadius: 16, effects: [{ kind: 'border-beam', size, colorVariant, duration: 3, strength: .6, glowSize: 2, theme: 'auto', staticColors: true, borderRadius: 8, brightness: 2, saturation: .8, hueRange: 60, startTime: 1, endTime: 5, fadeIn: .2, fadeOut: .4 }] } })
    }
    const bytes = await sceneToBytes(api.doc)
    const restored = await readScene(bytes)
    expect(restored.api.getChildren(root).map(n => n.appearance.effects)).toEqual(api.getChildren(root).map(n => n.appearance.effects))
    api.doc.destroy(); restored.api.doc.destroy()
  })
  it('bounds malformed inputs and preserves auto preset defaults', () => {
    const e = normalizeBorderBeam({kind:'border-beam', strength: 9, duration:0, glowSize:Infinity, hueRange:-4, brightness:NaN})
    expect(e).toMatchObject({strength:1,duration:.1,glowSize:1,hueRange:0,brightness:1.3})
    expect(normalizeBorderBeam({kind:'border-beam'}).brightness).toBeUndefined()
  })
  it('uses deterministic fades and handles disabled/zero-strength effects', () => {
    const e = {kind:'border-beam' as const, startTime:1, endTime:5, fadeIn:1, fadeOut:1}
    expect([0,1,1.5,2,4,4.5,5].map(t=>beamTiming(e,t).opacity)).toEqual([0,0,.5,1,1,.5,0])
    for(const patch of [{visible:false},{active:false},{strength:0}]) expect(beamTiming({...e,...patch},2).opacity).toBe(0)
    const first=beamTiming(e,2.7);beamTiming(e,4);expect(beamTiming(e,2.7)).toEqual(first)
  })
  it('pads only outward glow without turning a frame into an alpha-effect group', () => {
    const api=createSceneAPI(),root=api.createNode('frame',null)
    api.createNode('rect',root)
    const rect={x:100,y:100,width:200,height:100}
    const outer={kind:'border-beam' as const,size:'pulse-outside' as const}
    expect(expandRectForLayerEffects(rect,[outer])).toEqual({x:20,y:20,width:360,height:260})
    expect(expandRectForLayerEffects(rect,[{...outer,visible:false}])).toEqual(rect)
    expect(nodeEffectsWrapSubtree(api.getNode(root)!,[outer])).toBe(false)
    expect(resolveAnimatedLayerEffects([{...outer,id:'beam'}],{beam:30})).toEqual([{...outer,id:'beam'}])
    api.doc.destroy()
  })
  it('retains pulse phase and fade windows when splitting repeatedly', () => {
    const api=createSceneAPI(),root=api.createNode('frame',null)
    const id=api.createNode('rect',root,{appearance:{opacity:1,fill:null,stroke:null,cornerRadius:16,effects:[{kind:'border-beam',size:'pulse-inner',startTime:1,endTime:9}]}})
    const effect=api.getNode(id)!.appearance.effects[0]
    if(effect.kind!=='border-beam')throw new Error('Missing Beam')
    const before=beamTiming(effect,6.25)
    rebaseSceneNodes(api,new Set([id]),3);rebaseSceneNodes(api,new Set([id]),2)
    expect(beamTiming(effect,1.25+api.getNode(id)!.proceduralTimeOffset!)).toEqual(before)
    api.doc.destroy()
  })
  it('resolves Auto from scene colors, independent of machine theme', () => {
    expect(resolveBeamTheme({kind:'border-beam',theme:'auto'},'#fff')).toBe('light')
    expect(resolveBeamTheme({kind:'border-beam',theme:'auto'},'oklch(0.2 0 0)')).toBe('dark')
    expect(resolveBeamTheme({kind:'border-beam',theme:'light'},'#000')).toBe('light')
  })
})
