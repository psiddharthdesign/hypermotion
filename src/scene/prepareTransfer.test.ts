import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { prepareSceneTransfer } from './prepareTransfer'

function fixture() {
 const doc = new Y.Doc({gc:false})
 const nodes = new Y.Map<Y.Map<unknown>>()
 doc.getMap('scene').set('nodes',nodes)
 for (const [id,source] of [['cut1','data:video/mp4;base64,AQID'],['cut2','data:video/mp4;base64,AQID'],['audio','data:audio/wav;base64,BAUG']]) {
  const node = new Y.Map<unknown>();nodes.set(id,node)
  node.set('src',source);node.set('trimStart',id==='cut2'?2:0)
 }
 doc.getMap('scene').set('sequence',new Y.Array())
 return {doc,nodes}
}
describe('scene transfer',()=>{
 it('stores one original per source and keeps cuts and live editing unchanged',async()=>{
  const {doc,nodes}=fixture();const before=doc.toJSON()
  const store=vi.fn(async(s:string)=>s.includes('video')?'hm-media://asset/video.mp4':'hm-media://asset/audio.wav')
  const result=await prepareSceneTransfer(doc,store)
  expect(store).toHaveBeenCalledTimes(2)
  expect(result.mediaSources.sort()).toEqual(['hm-media://asset/audio.wav','hm-media://asset/video.mp4'])
  const restored=new Y.Doc();Y.applyUpdate(restored,result.bytes)
  expect(restored.getMap('scene').toJSON().nodes.cut2).toEqual({src:'hm-media://asset/video.mp4',trimStart:2})
  expect(doc.toJSON()).toEqual(before)
  expect(nodes.get('cut1')!.get('src')).toContain('data:video')
 })
 it('drops deleted media history while preserving current state',async()=>{
  const {doc,nodes}=fixture()
  nodes.get('cut1')!.set('src','x'.repeat(1000000))
  nodes.get('cut1')!.set('src','hm-media://asset/video.mp4')
  for (const node of nodes.values()) node.set('src','hm-media://asset/video.mp4')
  const {bytes}=await prepareSceneTransfer(doc,async()=>{throw new Error('Already stored')})
  expect(bytes.length).toBeLessThan(2000)
  const restored=new Y.Doc();Y.applyUpdate(restored,bytes)
  expect(restored.getMap('scene').toJSON()).toEqual(doc.getMap('scene').toJSON())
 })
 it('propagates storage failure without changing the project',async()=>{
  const {doc}=fixture();const before=doc.toJSON()
  await expect(prepareSceneTransfer(doc,async()=>{throw new Error('Disk full')})).rejects.toThrow('Disk full')
  expect(doc.toJSON()).toEqual(before)
 })
})
