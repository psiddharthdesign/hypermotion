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
  appendVectorPenPoint,
  applyVectorFill,
  applyVectorStroke,
  closeVectorPenPath,
  cloneVectorDocument,
  dragVectorPenAnchor,
  isEditableVectorNode,
  lerpVectorDocuments,
  lerpVectorPaint,
  lerpVectorStroke,
  listVectorEditHandles,
  moveVectorAnchor,
  moveVectorHandle,
  primaryVectorFill,
  primaryVectorFillColor,
  primaryVectorStroke,
  vectorDocumentsCompatible,
  vectorLocalToViewBox,
  vectorViewBoxToLocal,
} from './edit'
export type { VectorEditPart, VectorPenAppendResult, VectorPenDragResult } from './edit'
export {
  applyMorphTarget,
  fitGeometryToViewBox,
  lerpMorphedVectorDocuments,
  MorphPathError,
  parseMorphPathInput,
  remapVectorGeometry,
} from './morph'
export type { MorphPathInput } from './morph'
export { fillToVectorPaint, vectorPaintToFill } from './paintConvert'
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
