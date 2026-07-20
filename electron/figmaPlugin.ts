// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs'
import path from 'node:path'

export const FIGMA_PLUGIN_DIRECTORY = 'figma-plugin'

/**
 * Payload files required by Figma when it imports our development plugin.
 * The manifest is copied last so it only points at complete build outputs.
 */
export const FIGMA_PLUGIN_FILES = [
  'dist/code.js',
  'dist/ui.html',
  'LICENSE',
  'NOTICE',
  'README.md',
  'manifest.json',
] as const

const REQUIRED_FIGMA_PLUGIN_FILES = [
  'dist/code.js',
  'dist/ui.html',
  'manifest.json',
] as const

export interface FigmaPluginStatus {
  ok: boolean
  path: string
  exists: boolean
  message?: string
  version?: string
}

interface PrepareFigmaPluginOptions {
  sourceDir: string
  userDataDir: string
  appVersion: string
}

/**
 * Copy the plugin bundled with this app into a stable, user-owned location.
 *
 * Figma remembers the manifest path after a development plugin is imported.
 * App bundles move between downloads and updates, so exposing a manifest from
 * Contents/Resources would break that registration. This function keeps the
 * public path fixed under Electron's userData directory and refreshes its
 * contents whenever Hyper Motion starts.
 */
export function prepareFigmaPlugin({
  sourceDir,
  userDataDir,
  appVersion,
}: PrepareFigmaPluginOptions): FigmaPluginStatus {
  const destinationDir = path.join(userDataDir, FIGMA_PLUGIN_DIRECTORY)
  const manifestPath = path.join(destinationDir, 'manifest.json')
  const missing = REQUIRED_FIGMA_PLUGIN_FILES.filter(
    (relativePath) => !isFile(path.join(sourceDir, relativePath)),
  )

  if (missing.length > 0) {
    const exists = isFile(manifestPath)
    return {
      ok: false,
      path: manifestPath,
      exists,
      version: readInstalledVersion(destinationDir),
      message: exists
        ? `The bundled plugin could not be refreshed (${missing.join(', ')} is missing). The previously installed copy is still available.`
        : `The bundled Figma plugin is incomplete (${missing.join(', ')} is missing).`,
    }
  }

  try {
    fs.mkdirSync(destinationDir, { recursive: true })

    for (const relativePath of FIGMA_PLUGIN_FILES) {
      const sourcePath = path.join(sourceDir, relativePath)
      if (!isFile(sourcePath)) continue
      copyFileAtomically(sourcePath, path.join(destinationDir, relativePath))
    }

    writeFileAtomically(
      path.join(destinationDir, '.hypermotion-plugin.json'),
      `${JSON.stringify({ appVersion, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    )

    return {
      ok: true,
      path: manifestPath,
      exists: true,
      version: appVersion,
    }
  } catch (error) {
    const exists = isFile(manifestPath)
    return {
      ok: false,
      path: manifestPath,
      exists,
      version: readInstalledVersion(destinationDir),
      message:
        error instanceof Error
          ? `Could not prepare the Figma plugin: ${error.message}`
          : 'Could not prepare the Figma plugin.',
    }
  }
}

function isFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile()
  } catch {
    return false
  }
}

function copyFileAtomically(sourcePath: string, destinationPath: string): void {
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true })
  const tempPath = `${destinationPath}.tmp-${process.pid}-${Date.now()}`
  try {
    fs.copyFileSync(sourcePath, tempPath)
    replaceFile(tempPath, destinationPath)
  } finally {
    fs.rmSync(tempPath, { force: true })
  }
}

function writeFileAtomically(destinationPath: string, contents: string): void {
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true })
  const tempPath = `${destinationPath}.tmp-${process.pid}-${Date.now()}`
  try {
    fs.writeFileSync(tempPath, contents, 'utf8')
    replaceFile(tempPath, destinationPath)
  } finally {
    fs.rmSync(tempPath, { force: true })
  }
}

function replaceFile(tempPath: string, destinationPath: string): void {
  try {
    fs.renameSync(tempPath, destinationPath)
  } catch (error) {
    // POSIX rename replaces an existing file atomically. Windows can reject
    // that replacement, so retain a narrow fallback for packaged Windows
    // builds while still keeping the temp file on the same volume.
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EEXIST' && code !== 'EPERM') throw error
    fs.rmSync(destinationPath, { force: true })
    fs.renameSync(tempPath, destinationPath)
  }
}

function readInstalledVersion(destinationDir: string): string | undefined {
  try {
    const contents = fs.readFileSync(
      path.join(destinationDir, '.hypermotion-plugin.json'),
      'utf8',
    )
    const parsed = JSON.parse(contents) as { appVersion?: unknown }
    return typeof parsed.appVersion === 'string' ? parsed.appVersion : undefined
  } catch {
    return undefined
  }
}
