import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { prepareDesktopScene } from './desktopTransfer'
function document(source:string) {
 const doc=new Y.Doc();const nodes=new Y.Map();doc.getMap('scene').set('nodes',nodes)
 const node=new Y.Map();nodes.set('video',node);node.set('src',source);return doc
}
afterEach(()=>vi.unstubAllGlobals())
describe('desktop media transfer',()=>{
 it('sends bounded chunks with exact original length and reuses stored originals',async()=>{
  const payload='x'.repeat(4*1024*1024);const chunks:string[]=[]
  const invoke=vi.fn(async(channel:string,arg:unknown)=>{
   if(channel==='media:begin-import') {expect(arg).toEqual({mime:'video/mp4',size:payload.length});return 'import-id'}
   if(channel==='media:append-import') {chunks.push((arg as {base64:string}).base64);return}
   if(channel==='media:finish-import')return 'hm-media://asset/test.mp4'
  })
  vi.stubGlobal('window',{hypermotion:{invoke}})
  const doc=document(`data:video/mp4;base64,${btoa(payload)}`)
  await prepareDesktopScene(doc)
  expect(chunks.length).toBe(2)
  expect(Math.max(...chunks.map(s=>s.length))).toBeLessThanOrEqual(4*1024*1024)
  expect(chunks.map(s=>atob(s)).join('')===payload).toBe(true)
  invoke.mockClear();await prepareDesktopScene(doc);expect(invoke).not.toHaveBeenCalled()
 })
 it('cancels incomplete transfers and permits retry after a write error',async()=>{
  const invoke=vi.fn(async(channel:string)=>{
   if(channel==='media:begin-import')return 'retry-id'
   if(channel==='media:append-import')throw new Error('No space left')
  })
  vi.stubGlobal('window',{hypermotion:{invoke}})
  const doc=document('data:audio/wav;base64,AQIDBA==')
  await expect(prepareDesktopScene(doc)).rejects.toThrow('No space left')
  expect(invoke).toHaveBeenCalledWith('media:cancel-import','retry-id')
  invoke.mockClear();await expect(prepareDesktopScene(doc)).rejects.toThrow('No space left')
  expect(invoke).toHaveBeenCalledWith('media:begin-import',{mime:'audio/wav',size:4})
 })
})
