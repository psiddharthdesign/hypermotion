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
  for (let index = 0; index < safeCount; index++) sortOrder[index] = index
  return {
    positions: new Float32Array(safeCount * 4 * 3),
    uvs: new Float32Array(safeCount * 4 * 2),
    opacity: new Float32Array(safeCount * 4),
    effectBlur: new Float32Array(safeCount * 4),
    dofBlur: new Float32Array(safeCount * 4),
    uvBounds: new Float32Array(safeCount * 4 * 4),
    indices:
      safeCount * 4 > 65_535
        ? new Uint32Array(safeCount * 6)
        : new Uint16Array(safeCount * 6),
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
  cameraDepth,
}: {
  buffers: TextSegmentBuffers
  entries: readonly TextSegmentAtlasEntry[]
  states: readonly TextSegmentGeometryState[]
  plane: Plane3D
  cameraDepth: (point: { x: number; y: number; z: number }) => number
}): void {
  if (entries.length !== states.length) {
    throw new Error('Text segment entries and states must have the same length')
  }
  if (buffers.segmentDepths.length !== entries.length) {
    throw new Error('Text segment buffers do not match the entry count')
  }

  const planeWidth = plane.rect.width
  const planeHeight = plane.rect.height
  const depthPoint = { x: 0, y: 0, z: 0 }
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
    const uvHeight = entry.uv.maxY - entry.uv.minY
    // Atlas coordinates and world geometry both use a visual top-left origin.
    // CanvasTexture keeps flipY=false, so the visual top maps to the lower V.
    const topV =
      entry.uv.minY + uvHeight * ((top - fullTop) / fullHeight)
    const bottomV =
      entry.uv.minY + uvHeight * ((bottom - fullTop) / fullHeight)
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

    let centerX = 0
    let centerY = 0
    let centerZ = 0
    for (let cornerIndex = 0; cornerIndex < 4; cornerIndex++) {
      const isRight = cornerIndex === 1 || cornerIndex === 3
      const isBottom = cornerIndex >= 2
      const cornerX = isRight ? right : left
      const cornerY = isBottom ? bottom : top
      const u = isRight ? entry.uv.maxX : entry.uv.minX
      const v = isBottom ? bottomV : topV
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
      buffers.positions[positionOffset] = worldX
      buffers.positions[positionOffset + 1] = worldY
      buffers.positions[positionOffset + 2] = worldZ
      const uvOffset = vertexIndex * 2
      buffers.uvs[uvOffset] = u
      buffers.uvs[uvOffset + 1] = v
      buffers.opacity[vertexIndex] = clamp01(state.opacity)
      buffers.effectBlur[vertexIndex] = Math.max(0, state.effectBlur)
      buffers.dofBlur[vertexIndex] = Math.max(0, state.dofBlur)
      const boundsOffset = vertexIndex * 4
      buffers.uvBounds[boundsOffset] = entry.uv.minX
      buffers.uvBounds[boundsOffset + 1] = topV
      buffers.uvBounds[boundsOffset + 2] = entry.uv.maxX
      buffers.uvBounds[boundsOffset + 3] = bottomV
      centerX += worldX
      centerY += worldY
      centerZ += worldZ
    }
    depthPoint.x = centerX / 4
    depthPoint.y = centerY / 4
    depthPoint.z = centerZ / 4
    buffers.segmentDepths[segmentIndex] = cameraDepth(depthPoint)
  }

  // Transparent quads share one draw call. Paint the farthest segment first
  // so crossing Z paths blend predictably without enabling a depth buffer.
  buffers.sortOrder.sort(
    (a, b) =>
      buffers.segmentDepths[b]! - buffers.segmentDepths[a]! || a - b,
  )
  buffers.sortOrder.forEach((segmentIndex, sortedIndex) => {
    const vertex = segmentIndex * 4
    const indexOffset = sortedIndex * 6
    buffers.indices[indexOffset] = vertex
    buffers.indices[indexOffset + 1] = vertex + 2
    buffers.indices[indexOffset + 2] = vertex + 1
    buffers.indices[indexOffset + 3] = vertex + 2
    buffers.indices[indexOffset + 4] = vertex + 3
    buffers.indices[indexOffset + 5] = vertex + 1
  })
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
}
