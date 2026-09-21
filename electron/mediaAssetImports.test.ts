import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MediaAssetImports } from './mediaAssetImports'
import { MediaAssets } from './mediaAssets'
const directories:string[]=[]
afterEach(()=>directories.splice(0).forEach(p=>fs.rmSync(p,{recursive:true,force:true})))
function fixture(){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hm-import-'));directories.push(directory);return new MediaAssetImports(directory)}
describe('original media import',()=>{
 it('preserves exact bytes and deduplicates repeated imports across sessions',()=>{
  const imports=fixture();const bytes=Buffer.from([0,255,1,2,3,4,5])
  const save=()=>{const id=imports.begin(1,'video/mp4',bytes.length);imports.append(1,id,bytes.subarray(0,3).toString('base64'));imports.append(1,id,bytes.subarray(3).toString('base64'));return imports.finish(1,id)}
  const source=save();expect(save()).toBe(source)
  expect(fs.readdirSync(imports.directory)).toHaveLength(1)
  expect(fs.readFileSync(new MediaAssets(imports.directory).resolve(source)!)).toEqual(bytes)
 })
 it('rejects incomplete, oversized and malformed data and cleans up cancellation',()=>{
  const imports=fixture();const id=imports.begin(1,'audio/wav',2)
  expect(()=>imports.finish(1,id)).toThrow('incomplete')
  expect(()=>imports.append(1,id,'!!!!')).toThrow('Invalid')
  expect(()=>imports.append(1,id,'AQID')).toThrow('expected size')
  imports.cancel(1,id);expect(fs.readdirSync(imports.directory)).toEqual([])
 })
 it('isolates imports by sender and refuses unsupported MIME types',()=>{
  const imports=fixture();const id=imports.begin(1,'video/mp4',1)
  expect(()=>imports.append(2,id,'AQ==')).toThrow('unavailable')
  imports.cancel(2,id);imports.append(1,id,'AQ==')
  expect(()=>imports.finish(2,id)).toThrow('incomplete')
  expect(imports.finish(1,id)).toContain('hm-media://asset/')
  expect(()=>imports.begin(1,'text/html',20)).toThrow('Unsupported')
 })
})
