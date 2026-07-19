// SPDX-License-Identifier: Apache-2.0

import type { Plane3D } from './scene3d'

export interface TextSegmentAtlasEntry {
  x: number
  y: number
  width: number
  height: number
  padding: number
  pivotX: number
  pivotY: number
  animate: boolean
  order: number
  trackingIndex: number
  lineCharacterCount: number
  trackingAlignment: 0 | 0.5 | 1
  visualLineIndex: number
  uv: { minX: number; minY: number; maxX: number; maxY: number }
}

export interface TextSegmentGeometryState {
  /** World-space translation. XYZ authoring is resolved before this step. */
  offset: { x: number; y: number; z: number }
  opacity: number
  effectBlur: number
  dofBlur: number
  scale: number
  skew: number
  rotationX: number
  /** Fractions removed from the visual top and bottom of the atlas cell. */
  cropTop: number
  cropBottom: number
}

export interface TextSegmentBuffers {
  positions: Float32Array
  uvs: Float32Array
  opacity: Float32Array
  effectBlur: Float32Array
  dofBlur: Float32Array
  uvBounds: Float32Array
  indices: Uint16Array | Uint32Array
  segmentDepths: Float32Array
  sortOrder: Uint32Array
}

/**
 * Bit flags returned by {@link writeTextSegmentBuffers}. Keeping this as a
 * number avoids allocating a per-frame change object for every animated text
 * node, while still letting the WebGL caller upload only the buffers whose
 * contents actually changed.
 */
export const TEXT_SEGMENT_BUFFER_CHANGE = {
  positions: 1 << 0,
  uvs: 1 << 1,
  opacity: 1 << 2,
  effectBlur: 1 << 3,
  dofBlur: 1 << 4,
  uvBounds: 1 << 5,
  indices: 1 << 6,
} as const

export type TextSegmentBufferChangeMask = number

export function cameraSpaceTextMotionOffset(
  motion: { x: number; y: number; z: number },
  basis: {
    right: { x: number; y: number; z: number }
    down: { x: number; y: number; z: number }
    forward: { x: number; y: number; z: number }
  },
): { x: number; y: number; z: number } {
  return {
    x:
      basis.right.x * motion.x +
      basis.down.x * motion.y -
      basis.forward.x * motion.z,
    y:
      basis.right.y * motion.x +
      basis.down.y * motion.y -
      basis.forward.y * motion.z,
    z:
      basis.right.z * motion.x +
      basis.down.z * motion.y -
      basis.forward.z * motion.z,
  }
}

/**
 * Convert a screen-space blur radius into conservative local text-plane units.
 * A glyph farther from the camera (or on a down-scaled plane) needs a larger
 * world-space quad for the same visible blur tail. Sampling all four plane
 * corners also covers tilted text without tying the atlas to its center depth.
 */
export function textSegmentWorldUnitsPerScreenPixel({
  plane,
  cameraDepth,
  focalLength,
  extraAwayDepth = 0,
}: {
  plane: Plane3D
  cameraDepth: (point: { x: number; y: number; z: number }) => number
  focalLength: number
  extraAwayDepth?: number
}): number {
  const halfWidth = Math.abs(plane.scaleX) * plane.rect.width / 2
  const halfHeight = Math.abs(plane.scaleY) * plane.rect.height / 2
  const point = { x: 0, y: 0, z: 0 }
  let farthestDepth = 1
  for (const horizontal of [-1, 1]) {
    for (const vertical of [-1, 1]) {
      point.x =
        plane.center.x +
        plane.right.x * halfWidth * horizontal +
        plane.down.x * halfHeight * vertical
      point.y =
        plane.center.y +
        plane.right.y * halfWidth * horizontal +
        plane.down.y * halfHeight * vertical
      point.z =
        plane.center.z +
        plane.right.z * halfWidth * horizontal +
        plane.down.z * halfHeight * vertical
      farthestDepth = Math.max(farthestDepth, cameraDepth(point))
    }
  }
  farthestDepth += Math.max(0, extraAwayDepth)
  const localScale = Math.max(
    0.05,
    Math.min(Math.abs(plane.scaleX), Math.abs(plane.scaleY)),
  )
  return Math.max(
    0.25,
    Math.min(8, farthestDepth / Math.max(1, focalLength) / localScale),
  )
}

export function createTextSegmentBuffers(count: number): TextSegmentBuffers {
  const safeCount = Math.max(0, Math.floor(count))
  const sortOrder = new Uint32Array(safeCount)
  const indices =
    safeCount * 4 > 65_535
      ? new Uint32Array(safeCount * 6)
      : new Uint16Array(safeCount * 6)
  for (let index = 0; index < safeCount; index++) {
    sortOrder[index] = index
    writeTextSegmentIndices(indices, index, index)
  }
  return {
    positions: new Float32Array(safeCount * 4 * 3),
    uvs: new Float32Array(safeCount * 4 * 2),
    opacity: new Float32Array(safeCount * 4),
    effectBlur: new Float32Array(safeCount * 4),
    dofBlur: new Float32Array(safeCount * 4),
    uvBounds: new Float32Array(safeCount * 4 * 4),
    indices,
    segmentDepths: new Float32Array(safeCount),
    sortOrder,
  }
}

/**
 * Update a spatial text node without allocating per glyph or per frame.
 *
 * The mesh itself stays at identity. Every vertex is written in world space,
 * which lets the authored text plane keep arbitrary 3D rotation while XYZ
 * segment motion remains camera-relative and therefore reads consistently.
 */
export function writeTextSegmentBuffers({
  buffers,
  entries,
  states,
  plane,
  cameraPosition,
  cameraForward,
  updateTextureCoordinates = true,
}: {
  buffers: TextSegmentBuffers
  entries: readonly TextSegmentAtlasEntry[]
  states: readonly TextSegmentGeometryState[]
  plane: Plane3D
  /** World-space camera origin used for transparent depth ordering. */
  cameraPosition: { x: number; y: number; z: number }
  /** Normalized world-space direction from the camera into the scene. */
  cameraForward: { x: number; y: number; z: number }
  /**
   * UVs only change when the atlas is repacked or a mask crops the quads.
   * Ordinary stagger motion can skip all texture-coordinate writes.
   */
  updateTextureCoordinates?: boolean
}): TextSegmentBufferChangeMask {
  if (entries.length !== states.length) {
    throw new Error('Text segment entries and states must have the same length')
  }
  if (buffers.segmentDepths.length !== entries.length) {
    throw new Error('Text segment buffers do not match the entry count')
  }

  const planeWidth = plane.rect.width
  const planeHeight = plane.rect.height
  let changes = 0
  for (let segmentIndex = 0; segmentIndex < entries.length; segmentIndex++) {
    const entry = entries[segmentIndex]!
    const state = states[segmentIndex]!
    const cropTop = clamp01(state.cropTop)
    const cropBottom = Math.min(1 - cropTop, clamp01(state.cropBottom))
    const fullLeft = entry.x - entry.padding
    const fullTop = entry.y - entry.padding
    const fullRight = entry.x + entry.width + entry.padding
    const fullBottom = entry.y + entry.height + entry.padding
    const fullHeight = Math.max(0.0001, fullBottom - fullTop)
    // Mask timing follows the semantic line/glyph box, not transparent blur
    // padding. Changing camera Max Blur must never speed up or delay the text
    // reveal. At the fully open endpoint we retain the padding for blur tails;
    // once masking begins, the semantic boundary clips those tails too.
    let top =
      cropTop > 0 ? entry.y + entry.height * cropTop : fullTop
    let bottom =
      cropBottom > 0
        ? entry.y + entry.height * (1 - cropBottom)
        : fullBottom
    if (cropTop >= 1 - 1e-6) bottom = top
    if (cropBottom >= 1 - 1e-6) top = bottom
    const uvHeight = updateTextureCoordinates
      ? entry.uv.maxY - entry.uv.minY
      : 0
    // Atlas coordinates and world geometry both use a visual top-left origin.
    // CanvasTexture keeps flipY=false, so the visual top maps to the lower V.
    const topV = updateTextureCoordinates
      ? entry.uv.minY + uvHeight * ((top - fullTop) / fullHeight)
      : 0
    const bottomV = updateTextureCoordinates
      ? entry.uv.minY + uvHeight * ((bottom - fullTop) / fullHeight)
      : 0
    const storedMinX = updateTextureCoordinates
      ? Math.fround(entry.uv.minX)
      : 0
    const storedMaxX = updateTextureCoordinates
      ? Math.fround(entry.uv.maxX)
      : 0
    const storedTopV = updateTextureCoordinates ? Math.fround(topV) : 0
    const storedBottomV = updateTextureCoordinates
      ? Math.fround(bottomV)
      : 0
    const left = fullLeft
    const right = fullRight
    const cosX = Math.cos(state.rotationX)
    const sinX = Math.sin(state.rotationX)
    const segmentScale = Number.isFinite(state.scale) ? state.scale : 1
    const segmentSkew = Number.isFinite(state.skew) ? state.skew : 0
    const pivotWorldX =
      plane.center.x +
      plane.right.x * (entry.pivotX - planeWidth / 2) * plane.scaleX +
      plane.down.x * (entry.pivotY - planeHeight / 2) * plane.scaleY
    const pivotWorldY =
      plane.center.y +
      plane.right.y * (entry.pivotX - planeWidth / 2) * plane.scaleX +
      plane.down.y * (entry.pivotY - planeHeight / 2) * plane.scaleY
    const pivotWorldZ =
      plane.center.z +
      plane.right.z * (entry.pivotX - planeWidth / 2) * plane.scaleX +
      plane.down.z * (entry.pivotY - planeHeight / 2) * plane.scaleY

    // Compare values at the precision actually stored by the GPU buffers.
    // Comparing a Float32Array value with its original double would report a
    // false change every frame for ordinary fractional animation values.
    const opacity = Math.fround(clamp01(state.opacity))
    const effectBlur = Math.fround(Math.max(0, state.effectBlur))
    const dofBlur = Math.fround(Math.max(0, state.dofBlur))

    let centerX = 0
    let centerY = 0
    let centerZ = 0
    for (let cornerIndex = 0; cornerIndex < 4; cornerIndex++) {
      const isRight = cornerIndex === 1 || cornerIndex === 3
      const isBottom = cornerIndex >= 2
      const cornerX = isRight ? right : left
      const cornerY = isBottom ? bottom : top
      let localX = (cornerX - entry.pivotX) * segmentScale
      const localY = (cornerY - entry.pivotY) * segmentScale
      localX += localY * segmentSkew
      const downDistance = localY * cosX * plane.scaleY
      // Local text Y points down, while THREE/CSS rotateX is defined from a
      // local-up axis. Negating the normal term keeps Flip's depth direction
      // identical to CSS rotateX() and ordinary PlaneGeometry.
      const normalDistance = -localY * sinX * plane.scaleY
      const rightDistance = localX * plane.scaleX
      const worldX =
        pivotWorldX +
        plane.right.x * rightDistance +
        plane.down.x * downDistance +
        plane.normal.x * normalDistance +
        state.offset.x
      const worldY =
        pivotWorldY +
        plane.right.y * rightDistance +
        plane.down.y * downDistance +
        plane.normal.y * normalDistance +
        state.offset.y
      const worldZ =
        pivotWorldZ +
        plane.right.z * rightDistance +
        plane.down.z * downDistance +
        plane.normal.z * normalDistance +
        state.offset.z
      const vertexIndex = segmentIndex * 4 + cornerIndex
      const positionOffset = vertexIndex * 3
      const storedWorldX = Math.fround(worldX)
      const storedWorldY = Math.fround(worldY)
      const storedWorldZ = Math.fround(worldZ)
      if (
        buffers.positions[positionOffset] !== storedWorldX ||
        buffers.positions[positionOffset + 1] !== storedWorldY ||
        buffers.positions[positionOffset + 2] !== storedWorldZ
      ) {
        buffers.positions[positionOffset] = storedWorldX
        buffers.positions[positionOffset + 1] = storedWorldY
        buffers.positions[positionOffset + 2] = storedWorldZ
        changes |= TEXT_SEGMENT_BUFFER_CHANGE.positions
      }
      if (updateTextureCoordinates) {
        const uvOffset = vertexIndex * 2
        const storedU = isRight ? storedMaxX : storedMinX
        const storedV = isBottom ? storedBottomV : storedTopV
        if (
          buffers.uvs[uvOffset] !== storedU ||
          buffers.uvs[uvOffset + 1] !== storedV
        ) {
          buffers.uvs[uvOffset] = storedU
          buffers.uvs[uvOffset + 1] = storedV
          changes |= TEXT_SEGMENT_BUFFER_CHANGE.uvs
        }
        const boundsOffset = vertexIndex * 4
        if (
          buffers.uvBounds[boundsOffset] !== storedMinX ||
          buffers.uvBounds[boundsOffset + 1] !== storedTopV ||
          buffers.uvBounds[boundsOffset + 2] !== storedMaxX ||
          buffers.uvBounds[boundsOffset + 3] !== storedBottomV
        ) {
          buffers.uvBounds[boundsOffset] = storedMinX
          buffers.uvBounds[boundsOffset + 1] = storedTopV
          buffers.uvBounds[boundsOffset + 2] = storedMaxX
          buffers.uvBounds[boundsOffset + 3] = storedBottomV
          changes |= TEXT_SEGMENT_BUFFER_CHANGE.uvBounds
        }
      }
      if (buffers.opacity[vertexIndex] !== opacity) {
        buffers.opacity[vertexIndex] = opacity
        changes |= TEXT_SEGMENT_BUFFER_CHANGE.opacity
      }
      if (buffers.effectBlur[vertexIndex] !== effectBlur) {
        buffers.effectBlur[vertexIndex] = effectBlur
        changes |= TEXT_SEGMENT_BUFFER_CHANGE.effectBlur
      }
      if (buffers.dofBlur[vertexIndex] !== dofBlur) {
        buffers.dofBlur[vertexIndex] = dofBlur
        changes |= TEXT_SEGMENT_BUFFER_CHANGE.dofBlur
      }
      centerX += worldX
      centerY += worldY
      centerZ += worldZ
    }
    const depthX = centerX / 4 - cameraPosition.x
    const depthY = centerY / 4 - cameraPosition.y
    const depthZ = centerZ / 4 - cameraPosition.z
    buffers.segmentDepths[segmentIndex] =
      depthX * cameraForward.x +
      depthY * cameraForward.y +
      depthZ * cameraForward.z
  }

  // Transparent quads share one draw call. Paint the farthest segment first
  // so crossing Z paths blend predictably without enabling a depth buffer.
  // Most stagger frames preserve the previous relative depth. Validate that
  // retained order first and invoke the typed-array sort only when segments
  // actually cross; this also avoids rebuilding/uploading the index buffer on
  // virtually every ordinary 2D text-animation frame.
  let orderChanged = false
  for (let index = 1; index < buffers.sortOrder.length; index++) {
    if (
      compareTextSegmentDepth(
        buffers.sortOrder[index - 1]!,
        buffers.sortOrder[index]!,
        buffers.segmentDepths,
      ) > 0
    ) {
      orderChanged = true
      break
    }
  }
  if (orderChanged) {
    buffers.sortOrder.sort((a, b) =>
      compareTextSegmentDepth(a, b, buffers.segmentDepths),
    )
    for (let sortedIndex = 0; sortedIndex < buffers.sortOrder.length; sortedIndex++) {
      writeTextSegmentIndices(
        buffers.indices,
        sortedIndex,
        buffers.sortOrder[sortedIndex]!,
      )
    }
    changes |= TEXT_SEGMENT_BUFFER_CHANGE.indices
  }
  return changes
}

function compareTextSegmentDepth(
  a: number,
  b: number,
  depths: Float32Array,
): number {
  const delta = depths[b]! - depths[a]!
  return Number.isFinite(delta) && delta !== 0 ? delta : a - b
}

function writeTextSegmentIndices(
  indices: Uint16Array | Uint32Array,
  sortedIndex: number,
  segmentIndex: number,
): void {
  const vertex = segmentIndex * 4
  const indexOffset = sortedIndex * 6
  indices[indexOffset] = vertex
  indices[indexOffset + 1] = vertex + 2
  indices[indexOffset + 2] = vertex + 1
  indices[indexOffset + 3] = vertex + 2
  indices[indexOffset + 4] = vertex + 3
  indices[indexOffset + 5] = vertex + 1
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
}
