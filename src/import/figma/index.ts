// SPDX-License-Identifier: Apache-2.0

/**
 * Figma plugin → Hyper Motion importer.
 *
 * Public surface: `parseFigmaPayload` + `importFigmaPayload`. The paste
 * handler in App.tsx uses both — first to detect/decode pasted text,
 * then to apply the design to the current scene.
 */

export {
  importFigmaPayload,
  parseFigmaPayload,
} from './walk'
export type {
  FigmaCapturedFill,
  FigmaCapturedFrame,
  FigmaCapturedNode,
  FigmaCapturedRect,
  FigmaCapturedEllipse,
  FigmaCapturedText,
  FigmaCapturedVector,
  FigmaPayload,
  FigmaPayloadVersion,
} from './types'
export {
  FIGMA_PAYLOAD_FORMAT,
  FIGMA_PAYLOAD_LEGACY_VERSION,
  FIGMA_PAYLOAD_VECTOR_VERSION,
  FIGMA_PAYLOAD_VERSION,
} from './types'
