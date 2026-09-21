// SPDX-License-Identifier: Apache-2.0
import type * as Y from 'yjs'
import { prepareSceneTransfer } from './prepareTransfer'
import { sceneToBytes, projectMediaSources } from './file'

const storedSources = new Map<string, Promise<string>>()
export async function prepareDesktopScene(doc: Y.Doc) {
  const bridge = typeof window === 'undefined' ? undefined : window.hypermotion
  if (!bridge) return { bytes: sceneToBytes(doc), mediaSources: projectMediaSources(doc) }
  return prepareSceneTransfer(doc, (source) => {
    const cached = storedSources.get(source)
    if (cached) return cached
    const promise = (async () => {
      const comma = source.indexOf(',')
      const header = source.slice(0, comma)
      if (!header.endsWith(';base64')) throw new Error('The embedded media format is unsupported.')
      const mime = header.slice(5, header.indexOf(';'))
      const length = source.length - comma - 1
      const size = length * 3 / 4 - (source.endsWith('==') ? 2 : source.endsWith('=') ? 1 : 0)
      const id = await bridge.invoke('media:begin-import', { mime, size }) as string
      try {
        for (let offset = comma + 1; offset < source.length; offset += 4 * 1024 * 1024) {
          await bridge.invoke('media:append-import', { id, base64: source.slice(offset, offset + 4 * 1024 * 1024) })
        }
        return await bridge.invoke('media:finish-import', id) as string
      } catch (error) {
        await bridge.invoke('media:cancel-import', id).catch(() => {})
        throw error
      }
    })()
    storedSources.set(source, promise)
    void promise.catch(() => storedSources.delete(source))
    return promise
  })
}
