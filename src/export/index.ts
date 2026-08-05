// SPDX-License-Identifier: Apache-2.0

/**
 * Export pipeline (Step 7).
 *
 * Three pipelines, dispatched by format:
 *
 *   - mp4  → native render: walk timeline frame-by-frame at the chosen
 *            quality, feed each canvas into WebCodecs VideoEncoder +
 *            mp4-muxer. No tab capture, no ffmpeg. Pixel-correct at the
 *            requested resolution including 4K.
 *   - webm → tab capture: getDisplayMedia + MediaRecorder records the
 *            rendered tab in real time. Bound to screen pixel ratio
 *            but real-time speed.
 *   - gif  → native render: capturePage → gifenc. 720p · 24fps
 *            default; quality picker still applies.
 *
 * Public surface:
 *  - The catalogues (`EXPORT_FORMATS`, `EXPORT_QUALITIES`)
 *  - `exportScene(ctx)` — kicks off a run; progress streams through
 *    `useExportProgress` for the status pill / popover to render.
 */

import { runExport, type ExportSceneContext } from './orchestrator'
import { runExportSingleFlight } from './singleFlight'

export type {
  ExportFormat,
  ExportFormatId,
  ExportQuality,
  ExportQualityId,
  ExportRange,
} from './formats'
export {
  EXPORT_FORMATS,
  EXPORT_QUALITIES,
  getExportFormat,
  getExportQuality,
  resolveDimensions,
  resolveFrameRange,
  resolveFrameSegments,
  buildExportFilename,
} from './formats'
export { useExportProgress, type ExportPhase } from './progressStore'
export type { ExportSceneContext } from './orchestrator'

/**
 * Kick off an export. The promise resolves when the run finishes
 * (success, error, or cancel) — callers don't need to await unless
 * they want to chain UI off completion.
 */
export async function exportScene(ctx: ExportSceneContext): Promise<void> {
  return runExportSingleFlight(() => runExport(ctx))
}
