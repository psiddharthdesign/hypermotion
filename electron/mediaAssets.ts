// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'

const assetNamePattern = /^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/

export function mediaAssetName(source: string): string | null {
  const match = /^hm-media:\/\/asset\/([^/?#]+)$/.exec(source)
  return match && assetNamePattern.test(match[1]) ? match[1] : null
}

/** Legacy projects keep original media beside the .hype document. */
export class MediaAssets {
  private directories: string[] = []

  constructor(...cacheDirectories: string[]) {
    this.directories = cacheDirectories.map(directory => path.resolve(directory))
  }

  registerProject(projectPath: string): void {
    const directory = path.resolve(`${projectPath}.assets`)
    this.directories = [directory, ...this.directories.filter((item) => item !== directory)]
  }

  resolve(source: string): string | null {
    const name = mediaAssetName(source)
    if (!name) return null
    for (const directory of this.directories) {
      const candidate = path.join(directory, name)
      try {
        // Only direct files inside explicitly opened project asset folders.
        if (fs.lstatSync(candidate).isFile()) return candidate
      } catch { /* Try the next opened project. */ }
    }
    return null
  }

  /** Save As must carry referenced originals along with the document. */
  copyToProject(projectPath: string, sources: string[]): void {
    const directory = path.resolve(`${projectPath}.assets`)
    for (const source of new Set(sources)) {
      const name = mediaAssetName(source)
      if (!name) continue
      const original = this.resolve(source)
      if (!original) throw new Error(`Missing project media: ${name}`)
      const destination = path.join(directory, name)
      if (original === destination) continue
      fs.mkdirSync(directory, { recursive: true })
      if (fs.existsSync(destination)) {
        if (sameFileBytes(original, destination)) continue
        // Never silently overwrite another project's media with the same id.
        throw new Error(`Project media already exists: ${name}`)
      }
      fs.copyFileSync(original, destination, fs.constants.COPYFILE_EXCL)
    }
    this.registerProject(projectPath)
  }
}

function sameFileBytes(first: string, second: string): boolean {
  if (!fs.lstatSync(second).isFile() || fs.statSync(first).size !== fs.statSync(second).size) return false
  const left = fs.openSync(first, 'r')
  const right = fs.openSync(second, 'r')
  try {
    const a = Buffer.alloc(64 * 1024)
    const b = Buffer.alloc(a.length)
    let count: number
    while ((count = fs.readSync(left, a, 0, a.length, null)) > 0) {
      if (fs.readSync(right, b, 0, count, null) !== count || !a.subarray(0, count).equals(b.subarray(0, count))) return false
    }
    return true
  } finally { fs.closeSync(left); fs.closeSync(right) }
}

/** Byte ranges let Chromium seek trimmed clips without downloading the full file. */
export function serveMediaAsset(assets: MediaAssets, request: Request): Response {
  const file = assets.resolve(request.url)
  if (!file) return new Response('Project media not found', { status: 404 })
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405 })
  }
  const size = fs.statSync(file).size
  const mimeTypes: Record<string, string> = {
    '.m4v': 'video/mp4', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
    '.flac': 'audio/flac', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.ogg': 'audio/ogg', '.ogv': 'video/ogg', '.aac': 'audio/aac',
    '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  }
  const headers = new Headers({
    'Content-Type': mimeTypes[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Access-Control-Allow-Origin': '*',
    'Accept-Ranges': 'bytes',
    'Content-Length': String(size),
  })
  let start = 0
  let end = size - 1
  const range = request.method === 'GET' ? request.headers.get('range') : null
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range)
    if (match && (match[1] || match[2])) {
      start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]))
      end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
    }
    if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
      headers.set('Content-Range', `bytes */${size}`)
      headers.set('Content-Length', '0')
      return new Response(null, { status: 416, headers })
    }
    headers.set('Content-Range', `bytes ${start}-${end}/${size}`)
    headers.set('Content-Length', String(end - start + 1))
  }
  const body = request.method === 'HEAD' || size === 0
    ? null
    : Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream<Uint8Array>
  return new Response(body, { status: range ? 206 : 200, headers })
}
