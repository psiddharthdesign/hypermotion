// SPDX-License-Identifier: Apache-2.0

import type { SceneAPI } from '@/scene/doc'
import { addKeyframe } from '@/anim/tracks'

/**
 * Seed a fresh scene with a modal-style card and a simple staggered
 * fade-in. Shows the auto-layout model (vertical stack with padding and
 * gap, nested horizontal stack for the footer) and gives the timeline
 * something to play on first open.
 *
 * Generic placeholder content. Inter as the default typeface (set in
 * `doc.ts`). Background is a light neutral so the card pops.
 */
export function createSampleScene(api: SceneAPI): void {
  // Camera first — every scene needs one so the renderer has a
  // viewfinder + projection origin. `createSceneAPI` auto-seeds a
  // camera on first run, but File → New deletes all nodes (camera
  // included) before re-running this function, so without an explicit
  // create here the scene comes back camera-less and the canvas
  // disappears under the empty viewfinder.
  //
  // Position is the artboard center, matching what `centerCameraOnCanvas`
  // would set on the next render anyway — doing it inline keeps the
  // first paint correct without waiting for the recenter pass.
  const meta = api.getMeta()
  const canvasW = meta.canvas?.width ?? 960
  const canvasH = meta.canvas?.height ?? 540
  const camId = api.createNode('camera', null, {
    name: 'Camera',
    transform: {
      x: canvasW / 2,
      y: canvasH / 2,
      z: 0,
      rotation: 0,
      rotationX: 0,
      rotationY: 0,
      scaleX: 1,
      scaleY: 1,
    },
  })
  api.setActiveCameraId(camId)

  // Outer canvas — neutral light background that contrasts the card.
  const root = api.createNode('frame', null, {
    name: 'Scene',
    size: { width: 800, height: 500 },
    layout: {
      mode: 'flex',
      direction: 'column',
      justify: 'center',
      align: 'center',
      gap: 0,
      padding: { top: 24, right: 24, bottom: 24, left: 24 },
      wrap: false,
      columns: 1,
      rowGap: 0,
      columnGap: 0,
    },
    appearance: {
      opacity: 1,
      fill: { kind: 'solid', color: '#f4f4f5' },
      stroke: null,
      cornerRadius: 0,
      effects: [],
    },
    clipsContent: true,
  })

  // The card. White, rounded, hairline border.
  const card = api.createNode('frame', root, {
    name: 'Card',
    size: { width: 380, height: 'hug' },
    layout: {
      mode: 'flex',
      direction: 'column',
      justify: 'start',
      align: 'stretch',
      gap: 6,
      padding: { top: 24, right: 24, bottom: 24, left: 24 },
      wrap: false,
      columns: 1,
      rowGap: 0,
      columnGap: 0,
    },
    appearance: {
      opacity: 1,
      fill: { kind: 'solid', color: '#ffffff' },
      stroke: { color: '#e4e4e7', width: 1, align: 'inside', style: 'solid', dashLength: 0, dashGap: 0 },
      cornerRadius: 12,
      effects: [],
    },
    clipsContent: false,
  })

  const title = api.createNode('text', card, {
    name: 'Title',
    text: 'New project',
    fontFamily: 'Inter',
    fontSize: 18,
    fontWeight: 600,
    color: '#0a0a0c',
  })

  const description = api.createNode('text', card, {
    name: 'Description',
    text: 'Set up a workspace and invite your team.',
    fontFamily: 'Inter',
    fontSize: 14,
    fontWeight: 400,
    color: '#71717a',
  })

  // Body — a labeled field placeholder. Generic stand-in for a real input.
  const body = api.createNode('frame', card, {
    name: 'Body',
    size: { width: 'fill', height: 'hug' },
    layout: {
      mode: 'flex',
      direction: 'column',
      justify: 'start',
      align: 'stretch',
      gap: 8,
      padding: { top: 16, right: 0, bottom: 16, left: 0 },
      wrap: false,
      columns: 1,
      rowGap: 0,
      columnGap: 0,
    },
    appearance: {
      opacity: 1,
      fill: null,
      stroke: null,
      cornerRadius: 0,
      effects: [],
    },
    clipsContent: false,
  })

  api.createNode('text', body, {
    name: 'Field label',
    text: 'Name',
    fontFamily: 'Inter',
    fontSize: 13,
    fontWeight: 500,
    color: '#0a0a0c',
  })

  // Input-styled rect (visual placeholder; not an actual editable field).
  api.createNode('frame', body, {
    name: 'Input',
    size: { width: 'fill', height: 36 },
    layout: {
      mode: 'flex',
      direction: 'row',
      justify: 'start',
      align: 'center',
      gap: 0,
      padding: { top: 0, right: 12, bottom: 0, left: 12 },
      wrap: false,
      columns: 1,
      rowGap: 0,
      columnGap: 0,
    },
    appearance: {
      opacity: 1,
      fill: { kind: 'solid', color: '#ffffff' },
      stroke: { color: '#e4e4e7', width: 1, align: 'inside', style: 'solid', dashLength: 0, dashGap: 0 },
      cornerRadius: 6,
      effects: [],
    },
    clipsContent: true,
  })

  // Footer — horizontal stack, right-aligned, with two action buttons.
  const footer = api.createNode('frame', card, {
    name: 'Footer',
    size: { width: 'fill', height: 'hug' },
    layout: {
      mode: 'flex',
      direction: 'row',
      justify: 'end',
      align: 'center',
      gap: 8,
      padding: { top: 8, right: 0, bottom: 0, left: 0 },
      wrap: false,
      columns: 1,
      rowGap: 0,
      columnGap: 0,
    },
    appearance: {
      opacity: 1,
      fill: null,
      stroke: null,
      cornerRadius: 0,
      effects: [],
    },
    clipsContent: false,
  })

  // Cancel button — ghost style. Width hugs the label so the text
  // can't wrap mid-word (the earlier fixed 80px clipped "Cancel" into
  // "Canc/el" at 13px Inter).
  const cancelBtn = api.createNode('frame', footer, {
    name: 'Cancel',
    size: { width: 'hug', height: 36 },
    layout: {
      mode: 'flex',
      direction: 'row',
      justify: 'center',
      align: 'center',
      gap: 0,
      padding: { top: 0, right: 14, bottom: 0, left: 14 },
      wrap: false,
      columns: 1,
      rowGap: 0,
      columnGap: 0,
    },
    appearance: {
      opacity: 1,
      fill: { kind: 'solid', color: '#ffffff' },
      stroke: { color: '#e4e4e7', width: 1, align: 'inside', style: 'solid', dashLength: 0, dashGap: 0 },
      cornerRadius: 6,
      effects: [],
    },
    clipsContent: false,
  })
  api.createNode('text', cancelBtn, {
    name: 'Cancel label',
    text: 'Cancel',
    fontFamily: 'Inter',
    fontSize: 13,
    fontWeight: 500,
    color: '#0a0a0c',
  })

  // Deploy button — primary, dark fill, white text. Same hug-content
  // sizing as Cancel so the label has room.
  const deployBtn = api.createNode('frame', footer, {
    name: 'Deploy',
    size: { width: 'hug', height: 36 },
    layout: {
      mode: 'flex',
      direction: 'row',
      justify: 'center',
      align: 'center',
      gap: 0,
      padding: { top: 0, right: 14, bottom: 0, left: 14 },
      wrap: false,
      columns: 1,
      rowGap: 0,
      columnGap: 0,
    },
    appearance: {
      opacity: 1,
      fill: { kind: 'solid', color: '#0a0a0c' },
      stroke: null,
      cornerRadius: 6,
      effects: [],
    },
    clipsContent: false,
  })
  api.createNode('text', deployBtn, {
    name: 'Deploy label',
    text: 'Deploy',
    fontFamily: 'Inter',
    fontSize: 13,
    fontWeight: 500,
    color: '#ffffff',
  })

  // Stagger animation — each child fades in with a 100ms offset.
  // Total duration: card visible by ~600ms, then idle for the rest.
  // Animates opacity 0 → 1 with ease-out.
  const stagger: Array<{ id: string; start: number }> = [
    { id: title, start: 0.0 },
    { id: description, start: 0.1 },
    { id: body, start: 0.2 },
    { id: footer, start: 0.3 },
  ]
  for (const { id, start } of stagger) {
    addKeyframe(api, id, 'appearance.opacity', start, 0)
    addKeyframe(api, id, 'appearance.opacity', start + 0.4, 1)
  }
}
