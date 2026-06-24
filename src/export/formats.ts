// SPDX-License-Identifier: Apache-2.0

/**
 * Export format + quality catalogue.
 *
 * Pure data, no runtime dependencies — split out from index.ts so the
 * progress store and the export menu can import the types without
 * dragging in the WebCodecs / gifenc / mp4-muxer surface.
 *
 * Refactor (May 2026): collapsed the prior 9-row catalogue (4 WebM × 4
 * resolutions, 4 MP4 × 4 resolutions, GIF) into orthogonal Format ×
 * Quality dimensions. Same surface area; simpler picker; lets the UI
 * present this as a 2D matrix instead of a flat list.
 */

export type ExportFormatId = 'mp4' | 'webm' | 'gif'

export type ExportQualityId = 'comp' | '720p' | '2k' | '4k'

export interface ExportFormat {
  id: ExportFormatId
  /** Short human label shown on the format chip. */
  label: string
  /** One-line description shown under the label. */
  description: string
  /** File extension (no leading dot) — drives the suggested filename. */
  extension: 'mp4' | 'webm' | 'gif'
}

export interface ExportQuality {
  id: ExportQualityId
  /** Short label shown on the pill. */
  label: string
  /**
   * Dimensions. 'comp' means "match the scene's canvas size at runtime"
   * — fastest path because no upscaling happens.
   */
  width: number | 'comp'
  height: number | 'comp'
  /** Hint shown under the label, e.g. "1280 × 720". */
  hint: string
}

/**
 * Format catalogue. MP4 first because it's the share-ready default;
 * WebM is the quick-preview path (fastest pipeline); GIF last as the
 * social fallback.
 *
 * The pipeline a format runs through is decided in the orchestrator,
 * not on the format itself — keeps this file pure data:
 *
 *   - mp4  → native render path: walk frames offscreen at the chosen
 *            quality, pipe each canvas into createMp4Encoder. No tab
 *            capture, no ffmpeg transcode. Pixel-correct at 4K.
 *   - webm → tab-capture path: getDisplayMedia + MediaRecorder. Bound
 *            to screen pixel ratio but real-time speed.
 *   - gif  → native render path with gifenc. 720p · 24fps default;
 *            quality picker still applies if user wants to push it.
 */
export const EXPORT_FORMATS: ExportFormat[] = [
  {
    id: 'mp4',
    label: 'MP4',
    description: 'H.264 · share-ready',
    extension: 'mp4',
  },
  {
    id: 'webm',
    label: 'WebM',
    description: 'VP9 · quick preview',
    extension: 'webm',
  },
  {
    id: 'gif',
    label: 'GIF',
    description: 'Looping · social',
    extension: 'gif',
  },
]

/**
 * Quality catalogue. 'Match comp' is the default — no upscaling, fastest
 * to render, and what most designers actually want (the artboard size IS
 * the deliverable size for embeds and social).
 *
 * Higher-than-comp resolutions (2K, 4K) are useful for larger surface
 * area than the artboard or for archive masters.
 *
 * "2K" here is the QHD/cinema common label (2560×1440). True DCI 2K is
 * 2048×1080 — designers asking for "2K" almost always mean QHD; Jitter,
 * After Effects, and YouTube all use the same convention.
 */
export const EXPORT_QUALITIES: ExportQuality[] = [
  {
    id: 'comp',
    label: 'Match comp',
    width: 'comp',
    height: 'comp',
    hint: 'native size',
  },
  {
    id: '720p',
    label: '720p',
    width: 1280,
    height: 720,
    hint: '1280 × 720',
  },
  {
    id: '2k',
    label: '2K',
    width: 2560,
    height: 1440,
    hint: '2560 × 1440',
  },
  {
    id: '4k',
    label: '4K',
    width: 3840,
    height: 2160,
    hint: '3840 × 2160',
  },
]

export function getExportFormat(id: ExportFormatId): ExportFormat {
  const found = EXPORT_FORMATS.find((f) => f.id === id)
  if (!found) throw new Error(`Unknown export format: ${id}`)
  return found
}

export function getExportQuality(id: ExportQualityId): ExportQuality {
  const found = EXPORT_QUALITIES.find((q) => q.id === id)
  if (!found) throw new Error(`Unknown export quality: ${id}`)
  return found
}

/**
 * Resolve a quality's pixel dimensions against the active scene canvas.
 *
 *   - 'comp' qualities use the artboard size verbatim — fastest path,
 *     no scaling, captures pixels 1:1. Caller's responsibility to pick
 *     a canvas that the chosen encoder can handle (H.264 caps around
 *     4K @ 16:9 ≈ 8.3M pixels; OpenH264 software fallback caps at
 *     9.4M pixels). When the comp exceeds those limits the MP4 encoder
 *     surfaces a clear error suggesting WebM or a smaller quality.
 *
 *   - Named presets (720p / 2K / 4K) clamp the artboard into the
 *     preset's bounding box, preserving aspect ratio. The output is
 *     never larger than the preset's width OR height. The smaller of
 *     the two ratios wins, so:
 *
 *       16:9 canvas + 4K preset → 3840×2160 (fills exactly)
 *        4:3 canvas + 4K preset → 2880×2160 (height-limited)
 *       9:16 canvas + 4K preset → 1215×2160 (width-limited)
 *
 *     The old "longest-edge" behavior produced 3840×2880 for a 4:3
 *     canvas at 4K — exceeding H.264's pixel-count cap and getting
 *     rejected by every encoder, hardware and software. Bounding-box
 *     clamp guarantees every named preset fits within H.264 limits
 *     regardless of canvas aspect.
 *
 * Even widths/heights are guaranteed because H.264 encoders refuse odd
 * dimensions; round up to the nearest even pixel.
 */
export function resolveDimensions(
  quality: ExportQuality,
  sceneCanvas: { width: number; height: number },
  formatId?: ExportFormatId,
): { width: number; height: number } {
  const ev = (n: number) => (n % 2 === 0 ? n : n + 1)

  let width: number
  let height: number

  if (quality.width === 'comp' && quality.height === 'comp') {
    width = Math.round(sceneCanvas.width)
    height = Math.round(sceneCanvas.height)
  } else {
    const maxW = typeof quality.width === 'number' ? quality.width : 0
    const maxH = typeof quality.height === 'number' ? quality.height : 0
    if (maxW <= 0 || maxH <= 0 || sceneCanvas.width <= 0 || sceneCanvas.height <= 0) {
      return { width: ev(1), height: ev(1) }
    }
    // Bounding-box fit: scale so neither dimension exceeds the preset.
    // The smaller of (maxW / canvasW) and (maxH / canvasH) wins because
    // it's the one that keeps BOTH dimensions inside the box. Math.min
    // is also why 4K on a 4:3 canvas produces 2880×2160 instead of
    // 3840×2880 — height becomes the limiting factor.
    const scale = Math.min(maxW / sceneCanvas.width, maxH / sceneCanvas.height)
    width = Math.round(sceneCanvas.width * scale)
    height = Math.round(sceneCanvas.height * scale)
  }

  // H.264 / MP4 ceiling.
  //
  // OpenH264 (Chromium's software fallback) and most hardware H.264
  // encoders cap the coded area around 4K UHD = 8,294,400 pixels with
  // strict per-side limits at Level 5.2 (3840×2160 / 4096×2304). When
  // the resolved dims exceed that, the encoder rejects the configure
  // call and the user gets the "H.264 / MP4 can't encode N×M" error.
  //
  // Match comp on an oversized canvas is the common case — a user with
  // a 3840×2880 (4:3) canvas picks "Match comp" expecting it to "just
  // work." Without this clamp, every Match comp export on a >4K canvas
  // dies. With it, we silently fit into the 4K bounding box (3840×2160
  // → e.g. 2880×2160 for 4:3) and the export ships clean.
  //
  // WebM has no such limit (VP9 accepts arbitrary sizes) — skip the
  // clamp there so users can still get a literal Match comp export by
  // switching format.
  if (formatId === 'mp4') {
    const H264_MAX_W = 3840
    const H264_MAX_H = 2160
    if (width > H264_MAX_W || height > H264_MAX_H) {
      const scale = Math.min(H264_MAX_W / width, H264_MAX_H / height)
      width = Math.round(width * scale)
      height = Math.round(height * scale)
    }
  }

  return { width: ev(width), height: ev(height) }
}

/**
 * Range to export.
 *
 *   'full'     — whole comp, frames [0..duration*fps).
 *   'time'     — from `startSec` to `endSec` (clamped to comp duration).
 *   'frames'   — from `startFrame` to `endFrame` inclusive (clamped to
 *                [0..lastFrame]).
 *   'segments' — multiple non-contiguous spans concatenated in timeline
 *                order. The output is a single video file containing
 *                only the selected spans, glued back-to-back; the gaps
 *                between segments are simply not rendered. Used by the
 *                Chapter multi-select picker so a user can ship
 *                "chapters 1, 3, and 5" as one file. Segments are
 *                expected to be in timeline order (start ascending) and
 *                non-overlapping; the orchestrator does not reorder or
 *                merge them.
 *
 * Time and frames are two views of the same subrange — the menu offers
 * both because some users think in seconds (motion designers) and some
 * in frames (animators coming from After Effects). The orchestrator
 * resolves either into a concrete [firstFrame, lastFrame] pair (or
 * array of pairs for segments) before walking.
 */
export type ExportRange =
  | { kind: 'full' }
  | { kind: 'time'; startSec: number; endSec: number }
  | { kind: 'frames'; startFrame: number; endFrame: number }
  | { kind: 'segments'; segments: Array<{ startSec: number; endSec: number }> }

/**
 * Resolve an ExportRange into a concrete [firstFrame, lastFrame]
 * inclusive pair. Always returns at least one frame — a degenerate
 * range collapses to the start frame so the encoder still has
 * something to write.
 *
 * For `segments` ranges, returns the BOUNDING range (earliest segment's
 * first frame to latest segment's last frame). Use `resolveFrameSegments`
 * when you need to walk the segments individually; this helper is for
 * callers that want a single span (tab capture, range-based filename
 * derivation, etc.).
 */
export function resolveFrameRange(
  range: ExportRange,
  durationSec: number,
  fps: number,
): { firstFrame: number; lastFrame: number } {
  const lastSceneFrame = Math.max(0, Math.round(durationSec * fps) - 1)
  if (range.kind === 'full') {
    return { firstFrame: 0, lastFrame: lastSceneFrame }
  }
  if (range.kind === 'segments') {
    const segs = resolveFrameSegments(range, durationSec, fps)
    if (segs.length === 0) {
      return { firstFrame: 0, lastFrame: 0 }
    }
    const first = segs[0].firstFrame
    const last = segs[segs.length - 1].lastFrame
    return { firstFrame: first, lastFrame: last }
  }
  let first: number
  let last: number
  if (range.kind === 'time') {
    first = Math.round(range.startSec * fps)
    last = Math.round(range.endSec * fps) - 1
  } else {
    first = Math.round(range.startFrame)
    last = Math.round(range.endFrame)
  }
  first = Math.max(0, Math.min(lastSceneFrame, first))
  last = Math.max(0, Math.min(lastSceneFrame, last))
  if (last < first) last = first
  return { firstFrame: first, lastFrame: last }
}

/**
 * Resolve an ExportRange into one or more concrete [firstFrame,
 * lastFrame] inclusive pairs.
 *
 * For `full / time / frames` this returns a single-element array — the
 * orchestrator's "walk segments and concatenate" loop is the same code
 * path as the simple "walk one continuous range" case, so the loop is
 * always uniform and there's no need for a special-case branch.
 *
 * For `segments` this returns one pair per segment, in input order
 * (which the menu guarantees is timeline order).
 *
 * Empty / degenerate inputs collapse to a single one-frame segment
 * starting at frame 0 so the encoder always has something to write.
 */
export function resolveFrameSegments(
  range: ExportRange,
  durationSec: number,
  fps: number,
): Array<{ firstFrame: number; lastFrame: number }> {
  const lastSceneFrame = Math.max(0, Math.round(durationSec * fps) - 1)
  const clampPair = (a: number, b: number) => {
    const first = Math.max(0, Math.min(lastSceneFrame, Math.round(a)))
    let last = Math.max(0, Math.min(lastSceneFrame, Math.round(b)))
    if (last < first) last = first
    return { firstFrame: first, lastFrame: last }
  }
  if (range.kind === 'full') {
    return [{ firstFrame: 0, lastFrame: lastSceneFrame }]
  }
  if (range.kind === 'time') {
    return [clampPair(range.startSec * fps, range.endSec * fps - 1)]
  }
  if (range.kind === 'frames') {
    return [clampPair(range.startFrame, range.endFrame)]
  }
  // Segments. Drop any zero-length segments so the encoder doesn't see
  // an empty subrange (which mp4-muxer treats as an error).
  const out: Array<{ firstFrame: number; lastFrame: number }> = []
  for (const s of range.segments) {
    const pair = clampPair(s.startSec * fps, s.endSec * fps - 1)
    if (pair.lastFrame >= pair.firstFrame) out.push(pair)
  }
  if (out.length === 0) return [{ firstFrame: 0, lastFrame: 0 }]
  return out
}

/**
 * Suggested filename for an export.
 *
 * Plain comp        → `<scene>.mp4` (clean, what users expect when they
 *                     hit Export with no range).
 * Tagged subrange   → `<scene>_<tag>.mp4` (multi-chapter selection
 *                     uses this — tag is e.g. `intro-hold` so multiple
 *                     chapter combos don't clobber each other).
 * Untagged subrange → `<scene>_<startFrame>-<endFrame>.mp4` (custom
 *                     time / frame range falls back to this).
 */
export function buildExportFilename(
  sceneName: string,
  format: ExportFormat,
  options?: {
    firstFrame?: number
    lastFrame?: number
    lastSceneFrame?: number
    /**
     * Caller-provided tag inserted between the scene name and the
     * extension. Wins over the frame-range suffix when set. Stripped
     * of any characters that don't belong in a filename.
     */
    chapterTag?: string
  },
): string {
  const base = sceneName.replace(/[^a-zA-Z0-9-_ ]/g, '').trim() || 'export'
  const tag = options?.chapterTag
    ?.replace(/[^a-zA-Z0-9-_]/g, '')
    .trim()
  if (tag) {
    return `${base}_${tag}.${format.extension}`
  }
  const isPartial =
    options &&
    options.firstFrame !== undefined &&
    options.lastFrame !== undefined &&
    options.lastSceneFrame !== undefined &&
    !(options.firstFrame === 0 && options.lastFrame === options.lastSceneFrame)
  if (isPartial) {
    return `${base}_${options.firstFrame}-${options.lastFrame}.${format.extension}`
  }
  return `${base}.${format.extension}`
}
