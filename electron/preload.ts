// SPDX-License-Identifier: Apache-2.0

/**
 * Preload bridge.
 *
 * The renderer is the unmodified hyper-motion web app — it doesn't import
 * any Electron APIs directly. We expose a tiny, opt-in surface on
 * `window.hypermotion` that future native integrations (file save,
 * notarized H.264 export, system tray) can build on without weakening
 * the renderer's sandbox.
 *
 * Today this exposes:
 *  - platform / version info (so UI can branch on Mac vs Win for
 *    keyboard hints, traffic-light insets, etc.)
 *  - a clipboard bridge (so paste flows like Figma payload import can
 *    read the OS clipboard reliably — `navigator.clipboard.readText` in
 *    the Electron renderer returns empty under default permissions)
 *  - a generic invoke pinhole for registered IPC channels
 *  - an event subscription helper for headless export triggers
 */
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'

const clipboard = {
  readTextSync: (): string =>
    ipcRenderer.sendSync('clipboard:readTextSync') as string,
  writeTextSync: (text: string): boolean =>
    ipcRenderer.sendSync('clipboard:writeTextSync', text) as boolean,
  readText: (): Promise<string> =>
    ipcRenderer.invoke('clipboard:readText') as Promise<string>,
  writeText: (text: string): Promise<void> =>
    ipcRenderer.invoke('clipboard:writeText', text) as Promise<void>,
  readFiles: (): Promise<Array<{ name: string; type: string; bytes?: Uint8Array; src?: string }>> =>
    ipcRenderer.invoke('clipboard:readFiles') as Promise<
      Array<{ name: string; type: string; bytes?: Uint8Array; src?: string }>
    >,
}

const media = {
  importFile: async (file: File): Promise<string> => {
    const nativePath = webUtils.getPathForFile(file)
    if (nativePath) return ipcRenderer.invoke('media:import-file', nativePath)
    const src = await ipcRenderer.invoke('media:begin-upload', { name: file.name, size: file.size }) as string
    try {
      for (let offset = 0; offset < file.size; offset += 8 * 1024 * 1024) {
        const bytes = new Uint8Array(await file.slice(offset, offset + 8 * 1024 * 1024).arrayBuffer())
        await ipcRenderer.invoke('media:upload-chunk', { src, bytes })
      }
      await ipcRenderer.invoke('media:end-upload', { src })
      return src
    } catch (error) {
      await ipcRenderer.invoke('media:end-upload', { src, abort: true }).catch(() => {})
      throw error
    }
  },
  normalizeFile: (src: string): Promise<string> => ipcRenderer.invoke('media:normalize-file', src),
  normalizeVideo: (payload: {
    name: string
    type: string
    bytes: Uint8Array
  }): Promise<{ name: string; type: string; bytes: Uint8Array; normalized: boolean }> =>
    ipcRenderer.invoke('media:normalize-video', payload) as Promise<{
      name: string
      type: string
      bytes: Uint8Array
      normalized: boolean
    }>,
}

contextBridge.exposeInMainWorld('hypermotion', {
  platform: process.platform as NodeJS.Platform,
  isElectron: true,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  clipboard,
  media,
  // Generic IPC pinhole. Renderer code calls
  // `window.hypermotion.invoke('channel', payload)` and main can register
  // a single ipcMain.handle. Keeps preload from growing one method per
  // future feature.
  invoke: (channel: string, ...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args),
  // Event subscription. Returns an unsubscribe function. Used by export
  // flows to receive headless triggers and render-window progress events.
  on: (
    channel: string,
    listener: (...args: unknown[]) => void,
  ): (() => void) => {
    const wrapped = (_event: IpcRendererEvent, ...args: unknown[]) =>
      listener(...args)
    ipcRenderer.on(channel, wrapped)
    return () => {
      ipcRenderer.removeListener(channel, wrapped)
    }
  },
})

declare global {
  interface Window {
    hypermotion?: {
      platform: NodeJS.Platform
      isElectron: true
      versions: {
        electron: string
        chrome: string
        node: string
      }
      clipboard: {
        readTextSync?: () => string
        writeTextSync?: (text: string) => boolean
        readText: () => Promise<string>
        writeText: (text: string) => Promise<void>
        readFiles: () => Promise<Array<{ name: string; type: string; bytes?: Uint8Array; src?: string }>>
      }
      media: {
        importFile?: (file: File) => Promise<string>
        normalizeFile?: (src: string) => Promise<string>
        normalizeVideo: (payload: {
          name: string
          type: string
          bytes: Uint8Array
        }) => Promise<{ name: string; type: string; bytes: Uint8Array; normalized: boolean }>
      }
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
      on: (
        channel: string,
        listener: (...args: unknown[]) => void,
      ) => () => void
    }
  }
}
