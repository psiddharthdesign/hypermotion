// SPDX-License-Identifier: Apache-2.0

import { spawn } from 'node:child_process'
import path from 'node:path'
import { locateDesktopApp } from './locator.js'

export async function pushSceneToRunningApp(scenePath: string): Promise<boolean> {
  const appPath = await locateDesktopApp()
  if (!appPath) return false
  const child = spawn(appPath, [path.resolve(scenePath)], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
  return true
}
