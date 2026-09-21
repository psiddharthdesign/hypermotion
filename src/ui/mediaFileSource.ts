// SPDX-License-Identifier: Apache-2.0
// Clipboard placeholders retain a native media reference without copying bytes.
const sources = new WeakMap<File, string>()
export function attachMediaSource(file: File, src: string): File {
  sources.set(file, src)
  return file
}
export function mediaSourceForFile(file: File): string | undefined {
  return sources.get(file)
}
