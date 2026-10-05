// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import { solveLayout, yogaReady } from '@/layout'
import { childrenInBackToFrontPaintOrder } from '@/render/layerCompositing'
import { siblingMask } from '@/render/maskShape'
import { buildWorldPlanes, resolveCamera3D } from '@/render3d/scene3d'
import { importFigmaPayload } from './walk'
import { FIGMA_PAYLOAD_FORMAT, FIGMA_PAYLOAD_VERSION, type FigmaCapturedFrame, type FigmaCapturedRect, type FigmaCapturedVector, type FigmaCapturedNode } from './types'
vi.mock('@/ui/fonts/googleFonts', () => ({ isGoogleFont: () => true }))

const white = { type: 'SOLID' as const, visible: true, opacity: 1, color: { r: 1, g: 1, b: 1 } }
const black = { ...white, color: { r: 0, g: 0, b: 0 } }
function rect(name: string, overrides: Partial<FigmaCapturedRect> = {}): FigmaCapturedRect {
  return { id: name, name, type: 'RECTANGLE', visible: true, locked: false,
    opacity: 1, x: 0, y: 0, width: 100, height: 80, rotation: 0,
    cornerRadius: [0, 0, 0, 0], fills: [black], strokes: [], strokeWeight: 0,
    strokeAlign: 'INSIDE', strokeDashes: [], ...overrides }
}
function vector(name: string, fill = black): FigmaCapturedVector {
  return { ...rect(name), type: 'VECTOR', sourceKind: 'VECTOR', fills: [fill],
    svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 80"><path d="M0 0H100L50 80Z"/></svg>',
    vectorPaths: [{ windingRule: 'NONZERO', data: 'M0 0H100L50 80Z' }], fidelity: 'editable' }
}
function frame(children: FigmaCapturedNode[], extra: Partial<FigmaCapturedFrame> = {}): FigmaCapturedFrame {
  return { ...rect('Logo'), type: 'GROUP', fills: [], layoutMode: 'NONE',
    primaryAxisSizingMode: 'FIXED', counterAxisSizingMode: 'FIXED',
    primaryAxisAlignItems: 'MIN', counterAxisAlignItems: 'MIN', itemSpacing: 0,
    paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
    layoutWrap: 'NO_WRAP', clipsContent: false, children, ...extra }
}
function setup(children: FigmaCapturedNode[]) {
  const api = createSceneAPI()
  const root = api.createNode('frame', null, { size: { width: 960, height: 540 } })
  const [group] = importFigmaPayload({ format: FIGMA_PAYLOAD_FORMAT, version: FIGMA_PAYLOAD_VERSION, nodes: [frame(children)], assets: {} }, api, root)
  return { api, root, group: group!, find: (name: string) => api.getAllNodeIds().map(id => api.getNode(id)!).find(node => node.name === name)! }
}

describe('Figma mask import', () => {
  it('keeps the black Notion detail in front of its white silhouette', () => {
    const { api, group } = setup([vector('White silhouette', white), vector('Black detail')])
    expect(api.getChildren(group).map(node => node.name)).toEqual(['White silhouette', 'Black detail'])
    expect(childrenInBackToFrontPaintOrder(api, group).map(node => node.name)).toEqual(['White silhouette', 'Black detail'])
    const detail = api.getChildren(group)[1]!
    if (detail.kind !== 'vector') throw new Error('Expected vector')
    expect(detail.vector.items[0]!.fills[0]!).toMatchObject({ color: '#000000' })
  })

  it('imports a clip rectangle as one invisible mask for all eight colored Slack paths', async () => {
    const paths = Array.from({ length: 8 }, (_, i) => vector(`Color ${i}`, { ...white, color: { r: i / 8, g: 0.4, b: 0.8 } }))
    const { api, root, group, find } = setup([rect('Clip', { isMask: true, maskType: 'VECTOR', opacity: 0.1, fills: [{ ...black, opacity: 0.1 }] }), ...paths])
    const scope = api.getChildren(group)[0]!
    const mask = find('Clip')
    expect(mask.isMask).toBe(true)
    expect(mask.maskMode).toBe('alpha')
    expect(mask.appearance.opacity).toBe(1)
    expect(mask.appearance.fill).toEqual({ kind: 'solid', color: '#ffffff' })
    expect(scope.children.at(-1)).toBe(mask.id)
    for (let index = 0; index < 8; index++) {
      const node = find(`Color ${index}`)
      expect(siblingMask(node, id => api.getNode(id))?.id).toBe(mask.id)
      if (node.kind !== 'vector') throw new Error('Expected vector')
      expect(node.vector.items[0]!.fills).toHaveLength(1)
    }
    const layout = solveLayout(await yogaReady, api, root, api.getMeta().canvas)
    const camera = resolveCamera3D(api.getActiveCamera()!, {}, api.getMeta().canvas)
    const planes = buildWorldPlanes(api, layout, {}, camera, { independentNodes: true })
    expect(planes.some(plane => plane.nodeId === mask.id)).toBe(false)
    expect(planes.find(plane => plane.nodeId === find('Color 7').id)!.clips![0]!.mask!.node.id).toBe(mask.id)
  })

  it('limits separate mask scopes and preserves parent-relative positions', () => {
    const { api, find } = setup([
      rect('Unmasked', { x: 10 }),
      rect('First mask', { x: 20, y: 30, isMask: true }), rect('First color', { x: 28, y: 38 }),
      rect('Second mask', { x: 200, isMask: true }), rect('Second color', { x: 208 }),
    ])
    expect(siblingMask(find('Unmasked'), id => api.getNode(id))).toBeNull()
    for (const prefix of ['First', 'Second']) {
      const content = find(`${prefix} color`), mask = find(`${prefix} mask`)
      expect(siblingMask(content, id => api.getNode(id))?.id).toBe(mask.id)
      expect(content.transform.x).toBe(8)
      expect(api.getNode(content.parent!)!.transform.x).toBe(prefix === 'First' ? 20 : 200)
    }
  })

  it('retains actual alpha and hidden-mask visibility without painting the mask', () => {
    const { api, find } = setup([rect('Alpha', { isMask: true, maskType: 'ALPHA', visible: false, opacity: 0.4 }), rect('Art')])
    expect(find('Alpha').appearance.opacity).toBe(0.4)
    expect(find('Alpha').visible).toBe(false)
    expect(find('Alpha').isMask).toBe(true)
    expect(siblingMask(find('Art'), id => api.getNode(id))).toBeNull()
  })

  it('converts luminance mask paint into alpha rather than using an opaque black rectangle', () => {
    const { find } = setup([rect('Luminance', { isMask: true, maskType: 'LUMINANCE', maskSvg: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><rect width="50" height="80" fill="white"/><rect x="50" width="50" height="80" fill="black"/></svg>' }), rect('Art')])
    const mask = find('Luminance')
    expect(mask.kind).toBe('image')
    expect(mask.isMask).toBe(true)
    if (mask.kind !== 'image') throw new Error('Expected image mask')
    const svg = decodeURIComponent(mask.src.split(',').slice(1).join(','))
    expect(svg).toContain('mask-type="luminance"')
    expect(svg).toContain('fill="white" mask="url(#hm-luminance)"')
  })

  it('keeps auto-layout child order while preserving its Figma paint order', () => {
    const api = createSceneAPI()
    const root = api.createNode('frame', null, { size: { width: 960, height: 540 } })
    const [group] = importFigmaPayload({ format: FIGMA_PAYLOAD_FORMAT, version: FIGMA_PAYLOAD_VERSION, nodes: [frame([rect('First'), rect('Second')], { type: 'FRAME', layoutMode: 'HORIZONTAL' })], assets: {} }, api, root)
    expect(api.getChildren(group!).map(node => node.name)).toEqual(['First', 'Second'])
    const imported = api.getNode(group!)!
    if (imported.kind !== 'frame') throw new Error('Expected frame')
    expect(imported.layout.mode).toBe('flex')
    expect(childrenInBackToFrontPaintOrder(api, group!).map(node => node.name)).toEqual(['First', 'Second'])
  })
  it('preserves transparent group-mask children as exact SVG alpha artwork', () => {
    const mask = frame([rect('Child shape')], { name: 'Container mask', isMask: true, maskType: 'ALPHA', opacity: 0.4,
      maskSvg: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80"><g opacity="0.4"><rect width="30" height="80" fill="black"/></g></svg>' })
    const { find } = setup([mask, rect('Art')])
    const imported = find('Container mask')
    expect(imported.kind).toBe('image')
    expect(imported.appearance.opacity).toBe(1)
    if (imported.kind !== 'image') throw new Error('Expected image mask')
    expect(decodeURIComponent(imported.src)).toContain('<g opacity="0.4"><rect')
  })

  it('removes baked vector-container opacity and effects while retaining empty fill and stroke geometry', () => {
    const mask = frame([], { name: 'Vector container', isMask: true, maskType: 'VECTOR',
      maskSvg: '<svg xmlns="http://www.w3.org/2000/svg"><g opacity="0.2" filter="url(#blur)"><path d="M0 0L20 20" fill="none" stroke="red" stroke-opacity="0.3" stroke-width="4"/><image width="10" height="20" href="data:image/png;base64,AAAA"></image></g></svg>' })
    const { find } = setup([mask, rect('Art')])
    const imported = find('Vector container')
    if (imported.kind !== 'image') throw new Error('Expected image mask')
    const svg = decodeURIComponent(imported.src)
    expect(svg).not.toContain('opacity=')
    expect(svg).not.toContain('filter=')
    expect(svg).toContain('fill="none" stroke="white"')
    expect(svg).toContain('stroke-width="4"')
    expect(svg).toContain('<rect width="10" height="20" fill="white"/>')
    expect(svg).not.toMatch(/<\/?image\b/)
  })

  it('does not add fill regions to unfilled or hidden-paint vector masks', () => {
    const { find } = setup([rect('Empty', { isMask: true, maskType: 'VECTOR', fills: [] }), rect('Art'),
      rect('Hidden paints', { isMask: true, maskType: 'VECTOR', fills: [{ ...black, visible: false }] }), rect('More art')])
    expect(find('Empty').appearance.fill).toBeNull()
    expect(find('Hidden paints').appearance.fill).toBeNull()
  })

  it('freezes captured FILL dimensions when mask scopes require absolute positions', async () => {
    const api = createSceneAPI()
    const root = api.createNode('frame', null, { size: { width: 960, height: 540 } })
    const source = frame([rect('Clip', { isMask: true, x: 0, width: 80 }), rect('Fill child', { x: 20, width: 60, layoutSizingHorizontal: 'FILL' })],
      { type: 'FRAME', layoutMode: 'HORIZONTAL', width: 400 })
    const [group] = importFigmaPayload({ format: FIGMA_PAYLOAD_FORMAT, version: FIGMA_PAYLOAD_VERSION, nodes: [source], assets: {} }, api, root)
    const content = api.getAllNodeIds().map(id => api.getNode(id)!).find(node => node.name === 'Fill child')!
    expect(content.position).toBe('absolute')
    if (!('size' in content)) throw new Error('Expected sized node')
    expect(content.size.width).toBe(60)
    const layout = solveLayout(await yogaReady, api, root, api.getMeta().canvas)
    expect(layout[content.id]!.width).toBe(60)
    expect(api.getNode(group!)!.children).toHaveLength(1)
  })

})
