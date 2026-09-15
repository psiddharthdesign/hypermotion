// SPDX-License-Identifier: Apache-2.0

/** Compatibility conversion must not impose a preview resolution or frame rate. */
export function videoNormalizationArgs(inputPath: string, outputPath: string): string[] {
  return [
    '-y', '-i', inputPath,
    '-map', '0:v:0', '-map', '0:a?',
    '-c:v', 'libvpx-vp9',
    '-pix_fmt', 'yuv420p',
    '-deadline', 'good', '-cpu-used', '4',
    '-crf', '12', '-b:v', '0',
    '-c:a', 'libvorbis', '-b:a', '160k',
    outputPath,
  ]
}

export function avconvertNormalizationArgs(inputPath: string, outputPath: string): string[] {
  return [
    '--source', inputPath,
    '--preset', 'PresetHighestQuality',
    '--output', outputPath,
    '--replace',
  ]
}
