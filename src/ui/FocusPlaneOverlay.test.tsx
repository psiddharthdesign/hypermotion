// SPDX-License-Identifier: Apache-2.0

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import { cameraSpaceDepth, projectWorldPoint, resolveCamera3D } from '@/render3d/scene3d'
import { FocusPlaneOverlay } from './FocusPlaneOverlay'
import { advanceFocusPlanePointerDrag, type FocusPlanePointerDrag } from './focusPlanePointerDrag'

const viewport = { width: 960, height: 540 }

function cameraFixture() {
  const camera = createSceneAPI().getActiveCamera()
  if (!camera) throw new Error('Missing default camera')
  return { ...camera, focusMode: 'spatial' as const, focusPlaneInitialized: true, focusPlaneX: 480, focusPlaneY: 270, focusPlaneZ: 0 }
}

describe('focus plane controls', () => {
  it('exposes keyboard movement and depth controls independently from scene layers', () => {
    const html = renderToStaticMarkup(<FocusPlaneOverlay camera={cameraFixture()} width={960} height={540} zoom={1} onCommit={() => undefined} />)
    expect(html).toContain('aria-label="Move focus plane"')
    expect(html).toContain('aria-label="Move focus plane depth"')
    expect(html).toContain('aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"')
    expect(html).toContain('Escape cancels a drag')
    expect(html).toContain('hold Shift to move 10× faster')
    expect(html).not.toContain('disabled=""')
  })

  it.each(['locked', 'playing'] as const)('makes both controls unavailable while %s', (state) => {
    const camera = { ...cameraFixture(), locked: state === 'locked' }
    const html = renderToStaticMarkup(<FocusPlaneOverlay camera={camera} playing={state === 'playing'} width={960} height={540} zoom={1} onCommit={() => undefined} />)
    expect(html.match(/disabled=""/g)).toHaveLength(2)
  })

  it('shows animated center depth rather than world Z or straight-line distance', () => {
    const camera = cameraFixture()
    const cameraAnim = { focusPlaneX: 900, focusPlaneZ: -200, focusPlaneRotationY: 30 }
    const resolved = resolveCamera3D(camera, cameraAnim, viewport)
    const distance = cameraSpaceDepth(resolved.focusWorld, resolved)
    const straightLine = Math.hypot(
      resolved.focusWorld.x - resolved.position.x,
      resolved.focusWorld.y - resolved.position.y,
      resolved.focusWorld.z - resolved.position.z,
    )
    expect(distance).not.toBeCloseTo(straightLine)
    const html = renderToStaticMarkup(<FocusPlaneOverlay camera={camera} cameraAnim={cameraAnim} {...viewport} zoom={1} onCommit={() => undefined} />)
    expect(html).toContain(`Focus plane · ${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(distance)} px`)
    expect(html).toContain('Distance from camera to plane center along the viewing direction')
    expect(html).toContain('A tilted plane spans different distances')
  })
})

function dragFixture(mode: 'view' | 'depth' = 'depth', zoom = 1): FocusPlanePointerDrag {
  const camera = resolveCamera3D(cameraFixture(), { rotationX: 12, rotationY: -18, rotation: 8 }, viewport)
  return {
    x: 100, y: 200, deltaX: 0, deltaY: 0, mode, camera, viewport, zoom,
    start: { ...camera.focusWorld },
  }
}

describe('focus plane drag speed', () => {
  it('accelerates only new motion when Shift changes and includes the final release packet', () => {
    const drag = dragFixture()
    const initialDepth = cameraSpaceDepth(drag.start, drag.camera)
    const unitsPerPixel = initialDepth / drag.camera.focalLength
    const regular = advanceFocusPlanePointerDrag(drag, 100, 190, false)
    expect(cameraSpaceDepth(regular, drag.camera)).toBeCloseTo(initialDepth + 10 * unitsPerPixel)
    expect(advanceFocusPlanePointerDrag(drag, 100, 190, true)).toEqual(regular)
    const accelerated = advanceFocusPlanePointerDrag(drag, 100, 180, true)
    expect(cameraSpaceDepth(accelerated, drag.camera)).toBeCloseTo(initialDepth + 110 * unitsPerPixel)
    expect(advanceFocusPlanePointerDrag(drag, 100, 180, false)).toEqual(accelerated)
    const release = advanceFocusPlanePointerDrag(drag, 100, 175, false)
    expect(cameraSpaceDepth(release, drag.camera)).toBeCloseTo(initialDepth + 115 * unitsPerPixel)
    expect(drag.start).toEqual(drag.camera.focusWorld)
  })

  it('keeps sensitivity independent of pointer event rate and accounts for workspace zoom', () => {
    const single = dragFixture('depth', 0.25)
    const split = dragFixture('depth', 0.25)
    const finalSingle = advanceFocusPlanePointerDrag(single, 100, 180, true)
    advanceFocusPlanePointerDrag(split, 100, 190, true)
    const finalSplit = advanceFocusPlanePointerDrag(split, 100, 180, true)
    expect(finalSingle).toEqual(finalSplit)
    const before = cameraSpaceDepth(single.start, single.camera)
    expect(cameraSpaceDepth(finalSingle, single.camera) - before).toBeCloseTo(800 * before / single.camera.focalLength)
  })

  it('accelerates view movement while preserving camera depth under an angled camera', () => {
    const drag = dragFixture('view', 0.5)
    const before = projectWorldPoint(drag.start, drag.camera, viewport)
    const moved = advanceFocusPlanePointerDrag(drag, 103, 198, true)
    const after = projectWorldPoint(moved, drag.camera, viewport)
    expect(after.x - before.x).toBeCloseTo(60)
    expect(after.y - before.y).toBeCloseTo(-40)
    expect(cameraSpaceDepth(moved, drag.camera)).toBeCloseTo(cameraSpaceDepth(drag.start, drag.camera))
  })
})

it('keeps orthographic Shift depth dragging consistent as the focus plane moves farther away', () => {
  const camera = resolveCamera3D({ ...cameraFixture(), projection: 'orthographic' as const }, { rotationX: -35.264, rotationY: 45, scaleX: 2, scaleY: 2 }, viewport)
  const drag: FocusPlanePointerDrag = {
    x: 100, y: 200, deltaX: 0, deltaY: 0, mode: 'depth', camera, viewport, zoom: 0.5,
    start: { ...camera.focusWorld },
  }
  const startDepth = cameraSpaceDepth(drag.start, camera)
  const first = advanceFocusPlanePointerDrag(drag, 100, 190, false)
  const next = advanceFocusPlanePointerDrag(drag, 100, 185, true)
  expect(cameraSpaceDepth(first, camera) - startDepth).toBeCloseTo(20 / camera.zoomY)
  expect(cameraSpaceDepth(next, camera) - startDepth).toBeCloseTo(120 / camera.zoomY)
})
