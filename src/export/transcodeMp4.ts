// SPDX-License-Identifier: Apache-2.0

/**
 * WebM → MP4 transcode via ffmpeg.wasm.
 *
 * The capture pipeline (`recordTab.ts`) always produces WebM because
 * browser MediaRecorder doesn't emit H.264. For MP4 export formats we
 * pipe the captured WebM through a single ffmpeg invocation that
 * decodes VP9 / VP8, re-encodes as H.264 with yuv420p pixel format,
 * and muxes into an MP4 container. Output plays cleanly in QuickTime
 * (the default Mac player), browser <video> tags, social uploads, and
 * professional editors.
 *
 * ffmpeg.wasm is ~25MB. We lazy-load both the JS API package
 * (`@ffmpeg/ffmpeg` — a few hundred KB, but still kept out of the
 * main bundle via dynamic import) and the wasm core (loaded from a
 * CDN via blob URL). First load takes a few seconds; subsequent
 * exports in the same session reuse the same FFmpeg instance.
 *
 * Encode settings: `libx264 -preset veryfast -crf 18 -pix_fmt yuv420p`.
 *  - Veryfast is the speed sweet spot for in-browser transcoding;
 *    slower presets buy ~5-10% file-size savings for 2-3× the time.
 *  - CRF 18 is visually-lossless for most motion-tool output. CRF 23
 *    (ffmpeg's default) is noticeably softer on gradients.
 *  - yuv420p is mandatory for QuickTime / Safari / social-platform
 *    compatibility. ffmpeg defaults to yuv444p when the source
 *    permits, which QuickTime refuses to play.
 */

import type { FFmpeg } from '@ffmpeg/ffmpeg'

/**
 * Module-scope singleton. The first MP4 export pays for the load;
 * every subsequent export reuses the same loaded ffmpeg core. The
 * core's wasm bytes are cached by the browser's HTTP cache (we load
 * via `toBlobURL` from a versioned CDN URL), so even reloads are
 * fast.
 */
let ffmpegInstance: FFmpeg | null = null
let ffmpegLoadPromise: Promise<FFmpeg> | null = null

/**
 * Lazy-load ffmpeg core. Returns an in-flight promise on concurrent
 * calls so two simultaneous exports don't both try to load the wasm
 * twice.
 */
async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance
  if (ffmpegLoadPromise) return ffmpegLoadPromise

  ffmpegLoadPromise = (async () => {
    // Dynamic imports keep the ~MB of ffmpeg API code out of the
    // main bundle until an MP4 export is actually requested.
    const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
      import('@ffmpeg/ffmpeg'),
      import('@ffmpeg/util'),
    ])

    const ffmpeg = new FFmpeg()
    // Pin the core version explicitly — `@ffmpeg/ffmpeg` is the JS
    // API and the core is independently versioned. Mismatched
    // versions throw on `load()`. 0.12.6 is the latest core
    // compatible with the 0.12.x JS API.
    const coreVersion = '0.12.6'
    const baseURL = `https://unpkg.com/@ffmpeg/core@${coreVersion}/dist/umd`
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    })
    ffmpegInstance = ffmpeg
    return ffmpeg
  })()

  try {
    return await ffmpegLoadPromise
  } catch (err) {
    // Reset on failure so a retry can re-attempt the load (e.g. CDN
    // hiccup, network blip). Without this the tab is stuck in a
    // permanent failure state.
    ffmpegLoadPromise = null
    ffmpegInstance = null
    throw err
  }
}

/**
 * Transcode a WebM blob to an MP4 blob.
 *
 * `onProgress` fires repeatedly with a 0..1 fraction so the export
 * progress modal can show a live ETA during the (slow) encode step.
 * The fraction is best-effort — ffmpeg's progress event doesn't
 * always reach 1.0 at completion, so callers should treat the final
 * resolved promise as "done" rather than waiting for `1`.
 */
export async function transcodeWebmToMp4(
  webmBlob: Blob,
  onProgress?: (fraction: number) => void,
): Promise<Blob> {
  const ffmpeg = await getFFmpeg()
  const { fetchFile } = await import('@ffmpeg/util')

  // Wire the progress event for the duration of this transcode.
  // ffmpeg's listener API takes `on`/`off`; we register and clean
  // up so back-to-back transcodes don't double-fire on each other's
  // listeners.
  const onFfmpegProgress = ({ progress }: { progress: number }) => {
    if (onProgress) onProgress(Math.min(1, Math.max(0, progress)))
  }
  ffmpeg.on('progress', onFfmpegProgress)

  try {
    await ffmpeg.writeFile('input.webm', await fetchFile(webmBlob))
    // Single-pass H.264 encode. -movflags +faststart writes the moov
    // atom to the beginning of the file so QuickTime / browsers can
    // start playback before the whole file downloads.
    const exitCode = await ffmpeg.exec([
      '-i',
      'input.webm',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      'output.mp4',
    ])
    if (exitCode !== 0) {
      throw new Error(`ffmpeg exited with code ${exitCode}`)
    }
    const data = await ffmpeg.readFile('output.mp4')
    // ffmpeg.readFile returns Uint8Array | string; for binary files
    // it's always Uint8Array. Wrap as a Blob with the right MIME so
    // the download anchor names it correctly.
    if (typeof data === 'string') {
      throw new Error('ffmpeg returned a string for a binary readFile')
    }
    const bytes = Uint8Array.from(data)
    return new Blob([bytes.buffer], { type: 'video/mp4' })
  } finally {
    ffmpeg.off('progress', onFfmpegProgress)
    // Clean up the in-FS files so back-to-back exports don't inherit
    // stale state. Safe to call even if a step above threw.
    try {
      await ffmpeg.deleteFile('input.webm')
    } catch {
      /* ignore */
    }
    try {
      await ffmpeg.deleteFile('output.mp4')
    } catch {
      /* ignore */
    }
  }
}
