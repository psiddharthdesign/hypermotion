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
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

const clipboard = {
  readText: (): Promise<string> =>
    ipcRenderer.invoke('clipboard:readText') as Promise<string>,
  writeText: (text: string): Promise<void> =>
    ipcRenderer.invoke('clipboard:writeText', text) as Promise<void>,
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
        readText: () => Promise<string>
        writeText: (text: string) => Promise<void>
      }
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
      on: (
        channel: string,
        listener: (...args: unknown[]) => void,
      ) => () => void
    }
  }
}
