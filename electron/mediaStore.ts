// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import * as Y from 'yjs'

const PREFIX = 'hm-media://asset/'
const ID = /^[a-f0-9-]{36}\.[a-z0-9]{1,8}$/
const types: Record<string, string> = { mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg' }

/** Immutable media files keep large payloads out of IPC and the scene document. */
export class MediaStore {
  readonly root: string
  constructor(root: string) { this.root = root }
  assetPath(src: string): string {
    if (!src.startsWith(PREFIX) || !ID.test(src.slice(PREFIX.length))) throw new Error('Invalid media reference')
    return path.join(this.root, src.slice(PREFIX.length))
  }
  async allocate(name: string): Promise<string> {
    await fs.promises.mkdir(this.root, { recursive: true })
    const ext = path.extname(name).slice(1).toLowerCase()
    return PREFIX + randomUUID() + '.' + (/^[a-z0-9]{1,8}$/.test(ext) ? ext : 'bin')
  }
  async importFile(source: string): Promise<string> {
    if (!path.isAbsolute(source) || !(await fs.promises.stat(source)).isFile()) throw new Error('Select a media file')
    const src = await this.allocate(source)
    const target = this.assetPath(src)
    try { await fs.promises.copyFile(source, target, fs.constants.COPYFILE_EXCL) }
    catch (error) { await fs.promises.rm(target, { force: true }); throw error }
    return src
  }
  async serve(request: Request): Promise<Response> {
    const headers: Record<string, string> = { 'Access-Control-Allow-Origin': '*', 'Accept-Ranges': 'bytes' }
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405, headers })
    try {
      const file = this.assetPath(request.url)
      const { size } = await fs.promises.stat(file)
      headers['Content-Type'] = types[path.extname(file).slice(1)] ?? 'application/octet-stream'
      let start = 0, end = size - 1
      const range = request.headers.get('range')
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range)
        if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } })
        if (!match[1]) start = Math.max(0, size - Number(match[2]))
        else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])) }
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } })
        headers['Content-Range'] = `bytes ${start}-${end}/${size}`
      }
      headers['Content-Length'] = String(Math.max(0, end - start + 1))
      const body = request.method === 'HEAD' || size === 0 ? null : Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream<Uint8Array>
      return new Response(body, { status: range ? 206 : 200, headers })
    } catch { return new Response('Media file is unavailable', { status: 404, headers }) }
  }
  references(bytes: Uint8Array): string[] {
    const doc = new Y.Doc()
    try {
      Y.applyUpdate(doc, bytes)
      // Root types must be instantiated before their JSON can be traversed.
      const roots = [...doc.share.keys()].map(key => doc.getMap(key).toJSON())
      const refs = new Set<string>()
      const visit = (value: unknown) => {
        if (typeof value === 'string' && value.startsWith(PREFIX)) { this.assetPath(value); refs.add(value) }
        else if (value && typeof value === 'object') Object.values(value).forEach(visit)
      }
      roots.forEach(visit)
      return [...refs]
    } finally { doc.destroy() }
  }
  /** Keep this folder beside the .hype file when moving a project. */
  async saveAssets(project: string, bytes: Uint8Array): Promise<void> {
    const refs = this.references(bytes)
    if (!refs.length) return
    const folder = project + '.assets'
    await fs.promises.mkdir(folder, { recursive: true })
    for (const src of refs) {
      const dest = path.join(folder, path.basename(this.assetPath(src)))
      if (!fs.existsSync(dest)) await copyAtomic(this.assetPath(src), dest)
    }
  }
  async restoreAssets(project: string, bytes: Uint8Array): Promise<void> {
    for (const src of this.references(bytes)) {
      const target = this.assetPath(src)
      if (fs.existsSync(target)) continue
      await fs.promises.mkdir(this.root, { recursive: true })
      await copyAtomic(path.join(project + '.assets', path.basename(target)), target)
    }
  }
}

async function copyAtomic(source: string, target: string): Promise<void> {
  const temporary = target + '.' + randomUUID() + '.partial'
  try {
    await fs.promises.copyFile(source, temporary)
    await fs.promises.rename(temporary, target)
  } finally { await fs.promises.rm(temporary, { force: true }) }
}
