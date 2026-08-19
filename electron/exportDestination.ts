// SPDX-License-Identifier: Apache-2.0

import path from 'node:path'

const ALLOWED_EXPORT_EXTENSIONS = new Set(['.mp4', '.webm', '.gif'])

/** Resolve one renderer-supplied filename inside an approved directory. */
export function resolveExportDestinationPath(
  directory: string,
  fileName: string,
): string {
  const root = path.resolve(directory)
  if (!directory.trim()) throw new Error('Choose an export folder.')
  if (!fileName || path.basename(fileName) !== fileName) {
    throw new Error('The export title is not a valid filename.')
  }
  if (!ALLOWED_EXPORT_EXTENSIONS.has(path.extname(fileName).toLowerCase())) {
    throw new Error('The export format must be MP4, WebM, or GIF.')
  }

  const destination = path.resolve(root, fileName)
  if (path.dirname(destination) !== root) {
    throw new Error('The export path must stay inside the selected folder.')
  }
  return destination
}
