// SPDX-License-Identifier: Apache-2.0

/**
 * Scene data model — public surface.
 *
 * See types.ts for the shapes. See doc.ts for the Y.Doc-backed API.
 * Everything outside src/scene/ should import from here, not from
 * individual files, so internals can be refactored freely.
 */

export * from './types'
export { fillToCss, defaultFill, imageBackgroundStyle } from './fill'
export { displayedText, resolveTextCase } from './text'
export { PROPERTIES, LAYOUT_AFFECTING_PROPERTIES } from './props'
export type { PropertyDescriptor, PropertyGroup, Interpolation } from './props'
export { createSceneAPI, snapshotScene } from './doc'
export type { SceneAPI } from './doc'
export { persistScene } from './persistence'
export type { ScenePersistence } from './persistence'
export { createSampleScene } from './sample'
export { SceneProvider } from './context'
export { useSceneAPI, useSceneVersion } from './hooks'
export * from './vector'
// `apiReady` is the module-scope singleton — a Promise<SceneAPI> that
// resolves once IndexedDB has hydrated the doc. Exposed for non-React
// callers (the headless export driver) that need the API without going
// through SceneProvider context.
export { apiReady } from './internals'

// `.hype` file format primitives — Yjs bytes ↔ Y.Doc, plus the JSON
// view used by the CLI and the agent authoring API.
export {
  sceneToBytes,
  applyBytesToScene,
  loadSceneIntoDoc,
  readScene,
  sceneToJson,
  sceneToJsonString,
  applyJsonToScene,
} from './file'
