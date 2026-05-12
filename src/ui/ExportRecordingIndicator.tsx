// SPDX-License-Identifier: Apache-2.0

import { useExportProgress } from '@/export'

/**
 * Tiny floating REC pill shown only while a tab-capture export is
 * actively recording.
 *
 * Why this exists: getDisplayMedia + MediaRecorder captures the entire
 * tab, including any UI we leave on screen. The full export progress
 * modal would otherwise appear in the resulting WebM (it did, on the
 * first cut — visible recursively in the user's first export). The
 * modal is hidden via `data-export-hide` while recording. This tiny
 * indicator stays visible so the user still has a cancel button + a
 * confirmation that recording is running.
 *
 * The pill IS captured into the output (top-right corner). It's small
 * enough to crop in post if the user cares; for most use cases the
 * sub-100px indicator in the corner is fine. The proper fix (Region
 * Capture / CropTarget API) lands later — Chrome 104+ supports it but
 * needs more wiring than is worth right now.
 *
 * Renders nothing when the export isn't running or isn't using tab
 * capture (the GIF path doesn't share the tab; it can keep using the
 * full progress modal).
 */
export function ExportRecordingIndicator() {
  const phase = useExportProgress((s) => s.phase)
  const format = useExportProgress((s) => s.format)
  const frame = useExportProgress((s) => s.frame)
  const totalFrames = useExportProgress((s) => s.totalFrames)
  const requestCancel = useExportProgress((s) => s.requestCancel)

  // Only show during the active recording phase of a webm export.
  // Once `phase` flips to 'encoding' / 'done' / 'error', the status
  // pill in the TopBar takes over.
  const isRecording =
    (phase === 'rendering' || phase === 'encoding') &&
    format?.id === 'webm'
  if (!isRecording) return null

  return (
    <div
      // Stays visible during recording — explicitly NOT marked with
      // `data-export-hide`. The user needs SOME cancel surface; this
      // is it.
      role="status"
      aria-label="Recording in progress"
      className="fixed top-2 right-2 z-[200] flex items-center gap-2 rounded-md bg-[oklch(0.30_0.18_25)] px-2.5 py-1.5 font-mono text-[10px] text-white shadow-lg"
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 rounded-full bg-white"
        style={{ animation: 'recPulse 1s ease-in-out infinite' }}
      />
      <span>REC</span>
      <span className="text-white/80">
        {Math.min(frame, totalFrames)}/{totalFrames}
      </span>
      <button
        type="button"
        onClick={requestCancel}
        className="ml-1 rounded px-1 text-white/80 hover:bg-white/15 hover:text-white"
        title="Cancel recording (Esc)"
      >
        ×
      </button>
    </div>
  )
}