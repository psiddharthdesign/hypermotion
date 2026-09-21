// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as Y from 'yjs'
import { MediaStore } from './mediaStore'
import { MediaAssets, serveMediaAsset } from './mediaAssets'
const folders: string[] = []
afterEach(async () => { for (const folder of folders.splice(0)) await fs.rm(folder, { recursive: true, force: true }) })
async function fixture() {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'hm-media-test-'))
  folders.push(folder)
  return { folder, store: new MediaStore(path.join(folder, 'managed')) }
}
describe('managed media', () => {
  it('imports a 1 GiB file and serves only the requested bytes, including suffix seeks', async () => {
    const { folder, store } = await fixture()
    const source = path.join(folder, 'large.mp4')
    const file = await fs.open(source, 'w')
    await file.truncate(1024 ** 3)
    await file.write(Buffer.from('TAIL'), 0, 4, 1024 ** 3 - 4)
    await file.close()
    const src = await store.importFile(source)
    expect(src.length).toBeLessThan(100)
    await fs.unlink(source)
    const response = await serveMediaAsset(new MediaAssets(store.root), new Request(src, { headers: { Range: 'bytes=-4' } }))
    expect(response.status).toBe(206)
    expect(response.headers.get('Content-Range')).toBe(`bytes ${1024 ** 3 - 4}-${1024 ** 3 - 1}/${1024 ** 3}`)
    expect(await response.text()).toBe('TAIL')
    const head = await serveMediaAsset(new MediaAssets(store.root), new Request(src, { method: 'HEAD' }))
    expect(head.headers.get('Content-Length')).toBe(String(1024 ** 3))
    expect(await head.text()).toBe('')
    expect((await serveMediaAsset(new MediaAssets(store.root), new Request(src, { headers: { Range: 'bytes=2000000000-' } }))).status).toBe(416)
  })
  it('restores project assets into a fresh store without embedding media in Yjs', async () => {
    const { folder, store } = await fixture()
    const source = path.join(folder, 'clip.webm')
    await fs.writeFile(source, 'video-content')
    const src = await store.importFile(source)
    const doc = new Y.Doc()
    doc.getMap('scene').set('nodes', { clip: { src } })
    const bytes = Y.encodeStateAsUpdate(doc)
    doc.destroy()
    expect(bytes.byteLength).toBeLessThan(512)
    const project = path.join(folder, 'project.hype')
    new MediaAssets(store.root).copyToProject(project, [src])
    await fs.rm(store.root, { recursive: true })
    const other = new MediaAssets(path.join(folder, 'other-machine'))
    other.registerProject(project)
    expect(await fs.readFile(other.resolve(src)!, 'utf8')).toBe('video-content')
  })
  it('does not expose arbitrary disk paths or invalid references', async () => {
    const { store } = await fixture()
    expect(() => store.assetPath('hm-media://asset/../../secret')).toThrow()
    expect((await serveMediaAsset(new MediaAssets(store.root), new Request('hm-media://asset/not-an-id'))).status).toBe(404)
  })
})
