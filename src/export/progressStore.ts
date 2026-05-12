// SPDX-License-Identifier: Apache-2.0

import { create } from 'zustand'
import type { ExportFormat } from './formats'

/**
 * Transient export progress, surfaced to the modal.
 *
 * Lives in its own tiny store rather than the main UI slab because
 * it's process-state, not editor-state — refreshing the page or
 * navigating shouldn't preserve it. The modal subscribes here, the
 * orchestrator writes here, and that's the entire surface.
 */

export type ExportPhase = 'idle' | 'rendering' | 'encoding' | 'done' | 'error' | 'cancelled'

export interface ExportProgress {
  phase: ExportPhase
  format: ExportFormat | null
  /** Frames captured so far (0..totalFrames). */
  frame: number
  totalFrames: number
  /** Last error message, set when phase === 'error'. */
  error: string | null
  /** Output file URL once phase === 'done', for download retry. */
  blobUrl: string | null
  /** Suggested filename when downloading. */
  fileName: string | null
  /** Token bumped to signal cancel-requested; orchestrator polls this. */
  cancelToken: number
  /**
   * Smoothed estimate of milliseconds remaining until the render
   * loop finishes. Encoding tail (typically <1s) isn't included —
   * it's a separate phase and dominates only on long renders.
   */
  etaMs: number
  /**
   * Smoothed average milliseconds spent on the most recent frames.
   * Inverse gives the live "exporting at X fps" rate the modal can
   * surface so the user can compare it to the comp's frame rate.
   */
  msPerFrame: number
}

interface ExportProgressStore extends ExportProgress {
  start(format: ExportFormat, totalFrames: number, fileName: string): void
  setFrame(frame: number): void
  setPhase(phase: ExportPhase): void
  setError(message: string): void
  setDone(blobUrl: string): void
  setEta(etaMs: number, msPerFrame: number): void
  requestCancel(): void
  reset(): void
}

const INITIAL: ExportProgress = {
  phase: 'idle',
  format: null,
  frame: 0,
  totalFrames: 0,
  error: null,
  blobUrl: null,
  fileName: null,
  cancelToken: 0,
  etaMs: 0,
  msPerFrame: 0,
}

export const useExportProgress = create<ExportProgressStore>((set, get) => ({
  ...INITIAL,
  start(format, totalFrames, fileName) {
    set({
      phase: 'rendering',
      format,
      frame: 0,
      totalFrames,
      error: null,
      blobUrl: null,
      fileName,
      etaMs: 0,
      msPerFrame: 0,
    })
  },
  setFrame(frame) {
    set({ frame })
  },
  setPhase(phase) {
    set({ phase })
  },
  setError(message) {
    set({ phase: 'error', error: message })
  },
  setDone(blobUrl) {
    set({ phase: 'done', blobUrl, frame: get().totalFrames, etaMs: 0 })
  },
  setEta(etaMs, msPerFrame) {
    set({ etaMs, msPerFrame })
  },
  requestCancel() {
    // Bumping the token is the signal — orchestrator captures the
    // value at start() and bails when it observes a different one.
    set((s) => ({ cancelToken: s.cancelToken + 1, phase: 'cancelled' }))
  },
  reset() {
    const prev = get().blobUrl
    if (prev) {
      try {
        URL.revokeObjectURL(prev)
      } catch {
        /* ignore */
      }
    }
    set({ ...INITIAL })
  },
}))