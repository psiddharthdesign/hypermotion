// SPDX-License-Identifier: Apache-2.0

export {
  IDENTITY_VECTOR_MATRIX,
  createVectorItem,
  defaultVectorStroke,
  emptyVectorDocument,
  emptyVectorGeometry,
  solidVectorPaint,
} from './model'
export type { CreateVectorItemOptions } from './model'
export {
  VectorPathBuilder,
  parseSvgPathData,
  vectorGeometryToPathData,
} from './path'
export type { ParseSvgPathOptions } from './path'
export {
  multiplyMatrices,
  parseSvgDocument,
  parseTransform,
  sanitizeSvgSource,
} from './svg'
export type {
  ParsedSvgDocument,
  SanitizedSvg,
  SanitizeSvgOptions,
} from './svg'
