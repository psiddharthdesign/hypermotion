// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID, type Hash } from 'node:crypto'

const extensions: Record<string, string> = {
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
  'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
  'audio/webm': 'webm', 'audio/ogg': 'ogg', 'video/ogg': 'ogv', 'audio/aac': 'aac',
}
export class MediaAssetImports {
  private pending = new Map<string, { owner: number; file: string; extension: string; size: number; written: number; hash: Hash }>()
  readonly directory: string
  constructor(directory: string) { this.directory = directory }
  begin(owner: number, mime: string, size: number): string {
    const extension = extensions[mime.toLowerCase()]
    if (!extension || !Number.isSafeInteger(size) || size <= 0) throw new Error('Unsupported or empty embedded media.')
    fs.mkdirSync(this.directory, { recursive: true })
    const id = randomUUID()
    const file = path.join(this.directory, `${id}.part`)
    fs.writeFileSync(file, '', { flag: 'wx' })
    this.pending.set(id, { owner, file, extension, size, written: 0, hash: createHash('sha256') })
    return id
  }
  append(owner: number, id: string, base64: string): void {
    const item = this.pending.get(id)
    if (!item || item.owner !== owner) throw new Error('Media import is unavailable.')
    if (base64.length > 4 * 1024 * 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4) throw new Error('Invalid media chunk.')
    const bytes = Buffer.from(base64, 'base64')
    if (item.written + bytes.length > item.size) throw new Error('Media import exceeds its expected size.')
    fs.appendFileSync(item.file, bytes)
    item.hash.update(bytes)
    item.written += bytes.length
  }
  finish(owner: number, id: string): string {
    const item = this.pending.get(id)
    if (!item || item.owner !== owner || item.written !== item.size) throw new Error('Media import is incomplete.')
    const name = `${item.hash.digest('hex')}.${item.extension}`
    const destination = path.join(this.directory, name)
    if (fs.existsSync(destination)) fs.unlinkSync(item.file)
    else fs.renameSync(item.file, destination)
    this.pending.delete(id)
    return `hm-media://asset/${name}`
  }
  cancel(owner: number, id: string): void {
    const item = this.pending.get(id)
    if (!item || item.owner !== owner) return
    fs.rmSync(item.file, { force: true })
    this.pending.delete(id)
  }
}
