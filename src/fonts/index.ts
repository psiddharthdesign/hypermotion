// SPDX-License-Identifier: Apache-2.0

/**
 * Custom font system — public surface.
 *
 * Two storage tiers:
 *
 *   1. **Library** (IndexedDB, machine-local). Persistent across scenes.
 *      Open the app on another machine and the library is empty until
 *      you re-upload — fonts don't sync. Lives in `library.ts`.
 *
 *   2. **Scene-embedded** (in `.hype` file via Y.Doc.customFonts).
 *      Ships with the file. Open the scene on another machine and the
 *      fonts come with it. Lives in the scene API
 *      (`api.setCustomFont` / `api.getAllCustomFonts`).
 *
 * Adding a font: file picker → probe (format + family) → save to
 * library AND embed in current scene → register via FontFace API →
 * useFontLoadVersion bumps → text re-measures correctly.
 *
 * Reading a font: scene-embedded fonts always take priority — they're
 * the portable copy. Library fonts that don't appear in the scene are
 * just available in the picker for the user to drag in.
 */

export type { CustomFont } from '@/scene/types'
export {
  registerFont,
  unregisterFont,
  isFontRegistered,
  buildFontFaceUrl,
} from './registration'
export {
  libraryGetAll,
  libraryAdd,
  libraryRemove,
  libraryGet,
  subscribeLibrary,
} from './library'
export {
  probeFontFile,
  pickFontFiles,
  bytesToCustomFont,
  FONT_FILE_EXTENSIONS,
} from './loader'
