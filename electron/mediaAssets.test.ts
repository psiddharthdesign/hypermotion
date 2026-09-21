// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MediaAssets, mediaAssetName, serveMediaAsset } from './mediaAssets'

const temporary: string[] = []
afterEach(() => { for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true, force: true }) })
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-assets-'))
  temporary.push(directory)
  const project = path.join(directory, 'old project.hype')
  fs.mkdirSync(`${project}.assets`)
  const video = path.join(`${project}.assets`, 'video-id.mp4')
  fs.writeFileSync(video, Buffer.from([0, 1, 2, 255]))
  return { directory, project, video, source: 'hm-media://asset/video-id.mp4' }
}

describe('legacy project media', () => {
  it('resolves originals only after opening their project', () => {
    const { project, video, source } = fixture()
    const assets = new MediaAssets()
    expect(assets.resolve(source)).toBeNull()
    assets.registerProject(project)
    expect(assets.resolve(source)).toBe(video)
  })
  it('rejects traversal, other hosts, and symbolic links', () => {
    const { project, video } = fixture()
    const assets = new MediaAssets()
    assets.registerProject(project)
    fs.symlinkSync(video, `${project}.assets/link.mp4`)
    for (const source of ['hm-media://asset/../secret.mp4', 'hm-media://asset/%2e%2e%2fsecret.mp4', 'hm-media://other/video-id.mp4', 'file:///secret.mp4', 'hm-media://asset/link.mp4']) {
      expect(assets.resolve(source)).toBeNull()
    }
    expect(mediaAssetName('hm-media://asset/video-id.mp4')).toBe('video-id.mp4')
  })
  it('keeps original bytes alongside Save As and reopens in a fresh app', () => {
    const { project, directory, video, source } = fixture()
    const assets = new MediaAssets()
    assets.registerProject(project)
    const saved = path.join(directory, 'saved.hype')
    assets.copyToProject(saved, [source, source])
    const reopened = new MediaAssets()
    reopened.registerProject(saved)
    expect(fs.readFileSync(reopened.resolve(source)!)).toEqual(fs.readFileSync(video))
    assets.copyToProject(saved, [source])
    // Another opened project/cache can become the first resolution location.
    assets.registerProject(project)
    assets.copyToProject(saved, [source])
  })
  it('fails a save when a referenced original is missing', () => {
    const { project, source } = fixture()
    expect(() => new MediaAssets().copyToProject(project, [source])).toThrow('Missing project media')
  })
  it('does not overwrite conflicting destination media', () => {
    const { project, directory, source } = fixture()
    const assets = new MediaAssets()
    assets.registerProject(project)
    const saved = path.join(directory, 'saved.hype')
    fs.mkdirSync(`${saved}.assets`)
    fs.writeFileSync(`${saved}.assets/video-id.mp4`, 'else')
    expect(() => assets.copyToProject(saved, [source])).toThrow('already exists')
    expect(fs.readFileSync(`${saved}.assets/video-id.mp4`, 'utf8')).toBe('else')
  })
})

describe('media byte streaming', () => {
  it('serves exact seek ranges, suffixes, and full original bytes', async () => {
    const { project, source } = fixture()
    const assets = new MediaAssets()
    assets.registerProject(project)
    for (const [range, expected, contentRange] of [
      ['bytes=1-2', [1, 2], 'bytes 1-2/4'],
      ['bytes=2-', [2, 255], 'bytes 2-3/4'],
      ['bytes=-2', [2, 255], 'bytes 2-3/4'],
    ] as const) {
      const result = serveMediaAsset(assets, new Request(source, { headers: { Range: range } }))
      expect(result.status).toBe(206)
      expect(result.headers.get('content-range')).toBe(contentRange)
      expect(result.headers.get('content-length')).toBe('2')
      expect([...new Uint8Array(await result.arrayBuffer())]).toEqual(expected)
    }
    const result = serveMediaAsset(assets, new Request(source))
    expect(result.headers.get('access-control-allow-origin')).toBe('*')
    expect(result.headers.get('content-type')).toBe('video/mp4')
    expect([...new Uint8Array(await result.arrayBuffer())]).toEqual([0, 1, 2, 255])
  })
  it('returns headers for HEAD and rejects unavailable ranges', async () => {
    const { project, source } = fixture()
    const assets = new MediaAssets()
    assets.registerProject(project)
    const head = serveMediaAsset(assets, new Request(source, { method: 'HEAD' }))
    expect(head.headers.get('content-length')).toBe('4')
    expect(await head.text()).toBe('')
    for (const range of ['bytes=5-', 'bytes=3-1', 'bytes=-0', 'bytes=-', 'bytes=nope']) {
      expect(serveMediaAsset(assets, new Request(source, { headers: { Range: range } })).status).toBe(416)
    }
    expect(serveMediaAsset(new MediaAssets(), new Request(source)).status).toBe(404)
  })
})
