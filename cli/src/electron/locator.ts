// SPDX-License-Identifier: Apache-2.0

/**
 * Find the installed hyper-motion desktop app on the user's machine.
 *
 * Strategy by platform:
 *
 *   macOS   — Check `/Applications/hyper-motion.app/Contents/MacOS/hyper-motion`
 *             then `~/Applications/...`. Future: query `mdfind`.
 *   Windows — Check `%ProgramFiles%\hyper-motion\hyper-motion.exe` and
 *             `%LOCALAPPDATA%\Programs\hyper-motion\hyper-motion.exe`.
 *   Linux   — Walk `~/.local/share/applications` for `.desktop` entries
 *             and check `/opt/hyper-motion` and AppImage in
 *             `~/Applications` / `~/.local/bin`.
 *
 * Override path with `HYPERMOTION_APP_PATH` env var if installed somewhere
 * non-standard.
 *
 * Returns `null` if not found — callers surface a clean install hint.
 */

import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

export async function locateDesktopApp(): Promise<string | null> {
  const override = process.env.HYPERMOTION_APP_PATH
  if (override) {
    if (fs.existsSync(override)) {
      return override
    }
    // Loud failure — silently falling through when the user set an
    // explicit override usually means a typo or a build that hasn't
    // happened yet. Telling them is more helpful than searching elsewhere.
    console.error(
      `[locator] HYPERMOTION_APP_PATH is set but the file does not exist:\n` +
        `          ${override}\n` +
        `          Check the path, or unset the var to fall back to OS search.`,
    )
    return null
  }

  switch (os.platform()) {
    case 'darwin':
      return locateMac()
    case 'win32':
      return locateWindows()
    case 'linux':
      return locateLinux()
    default:
      return null
  }
}

function locateMac(): string | null {
  const candidates = [
    '/Applications/hyper-motion.app/Contents/MacOS/hyper-motion',
    path.join(os.homedir(), 'Applications/hyper-motion.app/Contents/MacOS/hyper-motion'),
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return null
}

function locateWindows(): string | null {
  const programFiles = process.env['ProgramFiles'] ?? 'C:\\Program Files'
  const localAppData = process.env['LOCALAPPDATA'] ?? path.join(os.homedir(), 'AppData', 'Local')
  const candidates = [
    path.join(programFiles, 'hyper-motion', 'hyper-motion.exe'),
    path.join(localAppData, 'Programs', 'hyper-motion', 'hyper-motion.exe'),
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return null
}

function locateLinux(): string | null {
  const candidates = [
    '/opt/hyper-motion/hyper-motion',
    '/usr/bin/hyper-motion',
    path.join(os.homedir(), 'Applications/hyper-motion.AppImage'),
    path.join(os.homedir(), '.local/bin/hyper-motion'),
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return null
}
