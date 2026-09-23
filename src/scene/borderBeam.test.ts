// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import { createSceneAPI } from './doc'
import { readScene, sceneToBytes } from './file'
import { BEAM_PALETTES, BEAM_STYLES, beamPadding, beamSpatialScale, beamTiming, normalizeBorderBeam } from './borderBeam'
import { expandRectForLayerEffects, nodeEffectsWrapSubtree, resolveAnimatedLayerEffects } from '@/render/layerEffects'
import { rebaseSceneNodes } from '@/project/splitScene'
import { beamColorTreatment, resolveBeamTheme } from '@/render/beam/paintBorderBeam'

describe('Beam layer effect', () => {
  it('round-trips every style and palette in a saved scene', async () => {
    const api = createSceneAPI()
    const root = api.createNode('frame', null)
    for (const size of BEAM_STYLES) for (const colorVariant of BEAM_PALETTES) {
      api.createNode('rect', root, { appearance: { opacity: 1, fill: null, stroke: null, cornerRadius: 16, effects: [{ kind: 'border-beam', size, colorVariant, nonUniform: true, variation: 2.5, spread: .6, seed: 42, animatePattern: false, colors: ['#fa3467', 'oklch(0.7 0.2 280)', '#2ad6ff'], edgeWidth: 12, duration: 300, speed: 2.5, strength: 8, glowSize: 12, theme: 'auto', staticColors: true, borderRadius: 8, brightness: 6, saturation: 8, hueRange: 60, startTime: 1, endTime: 5, fadeIn: .2, fadeOut: .4 }] } })
    }
    const bytes = await sceneToBytes(api.doc)
    const restored = await readScene(bytes)
    expect(restored.api.getChildren(root).map(n => n.appearance.effects)).toEqual(api.getChildren(root).map(n => n.appearance.effects))
    api.doc.destroy(); restored.api.doc.destroy()
  })
  it('bounds malformed inputs and preserves auto preset defaults', () => {
    const e = normalizeBorderBeam({kind:'border-beam', strength: 9, duration:0, glowSize:Infinity, hueRange:-4, brightness:NaN})
    expect(e).toMatchObject({strength:9,duration:.01,glowSize:1,hueRange:0,brightness:1.3})
    expect(normalizeBorderBeam({kind:'border-beam'}).brightness).toBeUndefined()
  })
  it('changes movement speed without retiming visibility or fades', () => {
    const effect = { kind: 'border-beam' as const, startTime: 1, endTime: 5, duration: 4, fadeIn: 1, fadeOut: 1 }
    for (const speed of [0, .5, 1, 2, 20]) {
      expect([0, 1, 1.5, 2, 4, 4.5, 5].map(t => beamTiming({ ...effect, speed }, t).opacity))
        .toEqual([0, 0, .5, 1, 1, .5, 0])
      const first = beamTiming({ ...effect, speed }, 2)
      expect(first.time).toBe(speed)
      expect(first.phase).toBe((speed / 4) % 1)
      beamTiming({ ...effect, speed }, 4.5)
      expect(beamTiming({ ...effect, speed }, 2)).toEqual(first)
    }
    expect(beamTiming({ ...effect, speed: 0 }, 4).time).toBe(0)
    expect(normalizeBorderBeam({ kind: 'border-beam' }).speed).toBe(1)
    for (const speed of [NaN, Infinity]) expect(normalizeBorderBeam({ ...effect, speed }).speed).toBe(1)
    expect(normalizeBorderBeam({ ...effect, speed: -1 }).speed).toBe(0)
    expect(normalizeBorderBeam({ ...effect, speed: 20 }).speed).toBe(20)
  })
  it('bounds custom palettes and scales the edge/glow with large layers', () => {
    const normalized = normalizeBorderBeam({kind:'border-beam',colors:['invalid','#f00','#00ff00','oklch(0.7 0.2 280)'],edgeWidth:20})
    expect(normalized).toMatchObject({colors:['#f00','#00ff00','oklch(0.7 0.2 280)'],edgeWidth:20,theme:'auto'})
    expect(normalizeBorderBeam({kind:'border-beam',colors:['#f00','invalid']}).colors).toBeUndefined()
    expect(normalizeBorderBeam({kind:'border-beam',colors:Array(20).fill('#abc')}).colors).toHaveLength(8)
    expect(beamSpatialScale(2400,1200)).toBe(5)
    expect(beamSpatialScale(120,48,'sm')).toBe(1)
    expect(beamPadding({kind:'border-beam',size:'pulse-outside',glowSize:4},2400,1200)).toBe(1360)
  })
  it('preserves intensity and all positive numeric values beyond the old UI caps', () => {
    const effect = {kind:'border-beam' as const,strength:20,glowSize:12,brightness:8,saturation:9,edgeWidth:16,duration:300,hueRange:720,borderRadius:20000,startTime:90000,endTime:100000,fadeIn:60,fadeOut:90}
    expect(normalizeBorderBeam(effect)).toMatchObject(effect)
    expect(beamTiming({...effect,startTime:0,endTime:10,fadeIn:2,fadeOut:0},1).opacity).toBe(.5)
    expect(beamTiming({...effect,startTime:0,endTime:10,fadeIn:0,fadeOut:0},1).opacity).toBe(1)
  })
  it('defaults to the existing distribution and normalizes non-uniform settings', () => {
    expect(normalizeBorderBeam({kind:'border-beam'})).toMatchObject({nonUniform:false,variation:1,spread:1,seed:1,animatePattern:true})
    expect(normalizeBorderBeam({kind:'border-beam',nonUniform:true,variation:-1,spread:Infinity,seed:2.7,animatePattern:false})).toMatchObject({nonUniform:true,variation:0,spread:1,seed:3,animatePattern:false})
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
  it('preserves custom swatches across themes, styles, palettes, and movement', () => {
    for (const size of BEAM_STYLES) for (const theme of ['light', 'dark'] as const) {
      for (const colorVariant of BEAM_PALETTES) for (const time of [0, 3, 6, 12]) {
        const effect = { kind: 'border-beam' as const, size, colorVariant, colors: ['#288cff', 'oklch(1.000 0.000 222)'], staticColors: false }
        expect(beamColorTreatment(effect, theme, time)).toEqual({ brightness: 1, saturation: 1, hue: 0 })
        expect(beamColorTreatment({ ...effect, brightness: .7, saturation: 1.5 }, theme, time))
          .toEqual({ brightness: .7, saturation: 1.5, hue: 0 })
      }
    }
    expect(beamColorTreatment({ kind: 'border-beam' }, 'light', 0))
      .toEqual({ brightness: .85, saturation: 1.35, hue: -30 })
    expect(beamColorTreatment({ kind: 'border-beam', staticColors: true }, 'dark', 0))
      .toEqual({ brightness: 1.25, saturation: 1.2, hue: 0 })
  })
})
