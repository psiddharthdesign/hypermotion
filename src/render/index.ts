// SPDX-License-Identifier: Apache-2.0

/**
 * Render engine surface.
 *
 * History: an offscreen Pixi renderer (`PixiExportRenderer`) used to
 * live here, exclusively for export-time frame rendering. It mirrored
 * the DOM editor's output but kept drifting (text font cache, image
 * fills, position math), so the export pipeline pivoted to capturing
 * the editor's actual DOM via Electron's `webContents.capturePage`
 * (see src/export/captureRect.ts). Single source of truth, no parallel
 * scene renderer to keep in sync.
 *
 * The `PixiExportRenderer` source still sits next to this file in
 * case the web tree (no Electron, no capturePage) ever needs an
 * offscreen path again. It is no longer wired to anything that
 * runs by default — leaving the import out of this barrel makes
 * stale callers fail at compile time rather than silently regressing.
 */
export {}