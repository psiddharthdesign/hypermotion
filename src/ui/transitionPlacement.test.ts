import { describe, it, expect } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import { getProjectAPI } from '@/project/doc'
import { mediaClipRange } from '@/scene/mediaClip'
import { placeTransition } from './transitionPlacement'
function fixture() {
 const api=createSceneAPI(); const root=api.createNode('frame',null); const camera=api.createNode('camera',null)
 const project=getProjectAPI(api); project.ensureInitialized(); const scene=project.getActiveScene()!
 return {api,root,camera,project,scene}
}
describe('transition placement',()=>{
 it('targets the preceding Master occurrence when dropped on a scene start',()=>{
  const {api,project}=fixture()
  project.createScene({name:'Next',duration:5})
  const items=project.getSequenceTimeMap().items
  placeTransition(api,{type:'master',id:items[1]!.item.id,side:'in'},'dissolve',0.4)
  expect(project.getSequenceItems().find(i=>i.id===items[0]!.item.id)?.transitionOut).toEqual({kind:'crossfade',duration:0.4})
  expect(()=>placeTransition(api,{type:'master',id:items[0]!.item.id,side:'in'},'dissolve',0.4)).toThrow('between two scenes')
 })
 it('places and updates a camera dissolve without moving its cut',()=>{
  const {api,camera,project,scene}=fixture()
  project.upsertCameraCut(scene.id,{id:'cut',cameraId:camera,time:2})
  placeTransition(api,{type:'camera',id:'cut',side:'in'},'dissolve',0.6)
  expect(project.getScene(scene.id)?.cameraCuts.cut).toMatchObject({time:2,dissolveDuration:0.6})
 })
 it('blends adjacent video clips without shifting incoming content',()=>{
  const {api,root}=fixture()
  const left=api.createNode('video',root,{duration:20,trimStart:0,trimEnd:4,startTime:0})
  const right=api.createNode('video',root,{duration:20,trimStart:4,trimEnd:10,startTime:4})
  placeTransition(api,{type:'layer',id:right,side:'in'},'dissolve',0.5)
  const a=api.getNode(left)!;const b=api.getNode(right)!
  if(a.kind!=='video'||b.kind!=='video')throw Error('videos')
  expect(mediaClipRange(a).end).toBe(4.5)
  expect(b.startTime).toBe(4);expect(b.trimStart).toBe(4)
  expect(api.getTracksForNode(right)[0]!.keyframes.map(k=>[k.time,k.value])).toEqual([[4,0],[4.5,1]])
 })
 it('rejects unmatched clip joins without making changes',()=>{
  const {api,root}=fixture(); const id=api.createNode('video',root,{duration:10,trimEnd:4})
  expect(()=>placeTransition(api,{type:'layer',id,side:'out'},'dissolve',0.5)).toThrow('join')
  expect(api.getTracksForNode(id)).toHaveLength(0)
 })
})
