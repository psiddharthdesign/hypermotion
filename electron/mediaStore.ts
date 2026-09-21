// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const PREFIX = 'hm-media://asset/'
const ID = /^[a-f0-9-]{36}\.[a-z0-9]{1,8}$/

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
}
