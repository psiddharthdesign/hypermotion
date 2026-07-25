// SPDX-License-Identifier: Apache-2.0

/**
 * Pixi-backed offscreen renderer for the export pipeline.
 *
 * Lives PARALLEL to the editor's DOM renderer (src/ui/Canvas.tsx).
 * The editor stays on DOM — clicks, drag, marquee, panels, all
 * unchanged. This module only runs during export: the orchestrator
 * seeks the engine, hands us (scene, layout, animated values), we
 * draw a frame into a hidden GPU canvas, and return that canvas to
 * WebCodecs.
 *
 * Why this exists: html-to-image walks the DOM and serializes it to
 * an SVG-as-data-URL string per frame. At video frame rates and 4K
 * resolutions, the string allocations alone hit V8's max-string limit
 * (~512MB). Pixi sidesteps that completely — frames are drawn by the
 * GPU directly into a canvas, no serialization, no decode round-trip.
 *
 * Architectural commitment: this renderer reads the scene + layout +
 * animated values as plain data structures. It does not touch React,
 * the DOM, the anim engine's tick loop, or any UI state. That makes
 * it safe to call from inside the export orchestrator's frame loop
 * without affecting the editor.
 *
 * Phase 1 scope: Frame, Rect, Ellipse with solid fills, solid strokes,
 * corner radii, opacity, and transforms. Text, images, gradients,
 * shadows, masks, and blurs are stubs — they render as plain rects of
 * the appearance fill, so the export still produces something visible
 * for scenes that use those features. Phases 2-3 fill them in.
 */

import {
  Application,
  BlurFilter,
  Container,
  type Filter,
  Graphics,
  Sprite,
  Text,
  Texture,
} from 'pixi.js'
import type { AnimatedValue } from '@/anim'
import type { Rect, SolvedLayout } from '@/layout'
import type {
  Appearance,
  Color,
  EllipseNode,
  Fill,
  ImageNode,
  Node,
  NodeId,
  SceneAPI,
  Stroke,
  TextNode,
  VectorNode,
} from '@/scene'
import { displayedText } from '@/scene'
import {
  paintVectorNodeToCanvas,
  vectorTrimState,
} from '@/render/vectorPaint'
import { getPreservedVectorSource } from '@/render/vectorSource'
import {
  alwaysOnTopRootsInPaintOrder,
  isAlwaysOnTopNode,
} from '@/render/layerCompositing'

interface VectorRasterEntry {
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
  texture: Texture
  width: number
  height: number
  paintedVector: VectorNode['vector'] | null
  paintedSource: VectorNode['source']
  paintedImportFidelity: VectorNode['importFidelity'] | null
  paintedViewBoxKey: string
  paintedTrimKey: string
}

/**
 * Public input for a frame render. The caller (the export orchestrator)
 * is responsible for seeking the anim engine to time t, snapshotting
 * its current animated values, and solving the layout against the
 * desired output canvas size before calling renderFrame.
 *
 * The canvas size and the artboard size can differ — the renderer
 * scales the artboard uniformly to fit. That's how 4K export works
 * from a 1920×1080 comp without distortion.
 */
export interface RenderFrameInput {
  /** Scene API — used to read the tree from the root down. */
  api: SceneAPI
  /** Computed rects per node. Output of solveLayout. */
  layout: SolvedLayout
  /** Animated values keyed by node id. Output of animEngine.getSnapshot. */
  animated: Record<NodeId, AnimatedValue>
  /** Output canvas dimensions in pixels. */
  width: number
  height: number
  /** Artboard / scene canvas dimensions. May differ from output (4K vs 1080p). */
  sceneWidth: number
  sceneHeight: number
  /** Optional background to clear with — defaults to transparent. */
  background?: Color | null
}

export class PixiExportRenderer {
  private app: Application | null = null
  private root: Container | null = null
  /** node id → Pixi container. Reused across frames so we don't allocate. */
  private nodeMap: Map<NodeId, Container> = new Map()
  /**
   * Texture cache keyed by image src URL. Populated by preloadAssets()
   * before the frame loop so renderFrame can stay synchronous (await
   * inside the per-frame loop would serialize work that should run in
   * parallel with encoding).
   */
  private imageTextures: Map<string, Texture> = new Map()
  /** Reusable Canvas2D surfaces for canonical editable vector artwork. */
  private vectorRasters: Map<NodeId, VectorRasterEntry> = new Map()
  /**
   * Set of font families we've asked the document to load. Pixi Text
   * draws to a 2D canvas which uses whatever fonts the document has
   * registered — if a web font isn't loaded yet, Pixi silently falls
   * back to the system default. preloadAssets() pumps document.fonts
   * for each unique family before the export starts so Pixi gets the
   * right glyphs on the first frame.
   */
  private fontsLoaded: Set<string> = new Set()
  private initialized = false
  /** Output dimensions the Pixi canvas was sized to. */
  private outputWidth = 0
  private outputHeight = 0

  /**
   * Allocate the Pixi Application + GPU canvas. Idempotent — calling
   * twice with the same dimensions is a no-op; calling with different
   * dimensions resizes the underlying canvas.
   *
   * Pixi v8's Application is async because it negotiates the renderer
   * (WebGL vs WebGPU). We prefer WebGL for now — Electron's WebGPU
   * support has historically been flakier than its WebGL stack, and
   * WebGL's H.264-friendly readback path is well-trodden.
   */
  async init(width: number, height: number): Promise<void> {
    if (this.initialized && this.app) {
      if (width !== this.outputWidth || height !== this.outputHeight) {
        this.app.renderer.resize(width, height)
        this.outputWidth = width
        this.outputHeight = height
      }
      return
    }
    const app = new Application()
    await app.init({
      width,
      height,
      // Transparent background so the export pipeline can composite
      // its own artboard fill on top via Pixi's stage children.
      backgroundAlpha: 0,
      antialias: true,
      // Force WebGL — see comment above. WebGPU can be opt-in later.
      preference: 'webgl',
      autoDensity: false,
      resolution: 1,
      // Pixi's default canvas creation works in any context that has
      // `document` available — we explicitly let it create one rather
      // than handing it an HTMLCanvasElement we own. This canvas is
      // never mounted in the DOM; it lives entirely in memory.
    })
    this.app = app
    this.root = new Container()
    app.stage.addChild(this.root)
    this.outputWidth = width
    this.outputHeight = height
    this.initialized = true
  }

  /**
   * Tear down GPU resources. Call when the export run finishes —
   * keeping a Pixi Application around between exports is fine and
   * actually faster than re-init on each, but we want a clean handle
   * for the case where the user closes the app or hot-reloads in dev.
   */
  destroy(): void {
    if (this.app) {
      this.app.destroy(true, { children: true })
      this.app = null
    }
    this.root = null
    this.nodeMap.clear()
    // Don't clear imageTextures — Pixi already destroyed them when we
    // destroyed the app. The Map references would be dangling; reset.
    this.imageTextures.clear()
    for (const raster of this.vectorRasters.values()) {
      raster.texture.destroy(true)
    }
    this.vectorRasters.clear()
    this.fontsLoaded.clear()
    this.initialized = false
    this.outputWidth = 0
    this.outputHeight = 0
  }

  /**
   * Walk the scene once before the export loop and load every image
   * texture + register every font family. Awaited by the orchestrator
   * BEFORE the first frame so renderFrame can stay synchronous.
   *
   * Why upfront and not on-demand: with 300 frames at 60fps, a per-
   * frame `await Assets.load()` would serialize image loads against
   * the encoder. Loading once at the start and then reusing is the
   * standard pattern for any frame-by-frame renderer.
   *
   * Errors on individual assets are swallowed (logged and skipped) —
   * a single broken image src shouldn't kill the whole export. The
   * affected nodes will render as the appearance fill rect instead.
   */
  async preloadAssets(api: SceneAPI): Promise<void> {
    const rootId = api.getRoot()
    if (!rootId) return
    const imgSrcs = new Set<string>()
    const fontFamilies = new Set<string>()
    const walk = (id: NodeId): void => {
      const node = api.getNode(id)
      if (!node) return
      if (node.kind === 'image' && node.src) {
        imgSrcs.add(node.src)
      } else if (node.kind === 'text' && node.fontFamily) {
        fontFamilies.add(node.fontFamily)
      } else if (node.kind === 'vector') {
        const preserved = getPreservedVectorSource(node, vectorTrimState(node))
        if (preserved) imgSrcs.add(preserved.dataUrl)
      }
      for (const childId of node.children) walk(childId)
    }
    walk(rootId)

    // Load all unique image textures in parallel. Each error is
    // swallowed to a console.warn rather than rejecting the whole
    // promise — partial asset failures shouldn't take down the
    // export.
    const imgPromises = Array.from(imgSrcs).map(async (src) => {
      if (this.imageTextures.has(src)) return
      try {
        // Manual image load — Pixi v8's Assets.load() can't reliably
        // detect format on data URLs (the project stores images as
        // `data:image/png;base64,...` per the scene model's MVP
        // strategy). Loading via HTMLImageElement and wrapping in a
        // Texture works for ANY URL Pixi will accept — http(s),
        // blob:, data:, file: — and gives us decode errors before
        // we hand the texture to the renderer.
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.src = src
        await img.decode()
        const tex = Texture.from(img)
        this.imageTextures.set(src, tex)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          '[PixiExportRenderer] failed to load image',
          src.slice(0, 80) + (src.length > 80 ? '…' : ''),
          err,
        )
      }
    })

    // Trigger document.fonts.load for each unique family so Pixi's
    // canvas-based text picks up the actual glyphs instead of falling
    // back to a system default. Skipped when document.fonts is missing
    // (non-browser env), in which case Pixi inherits whatever the
    // canvas DOM provides.
    const fontPromises = Array.from(fontFamilies).map(async (family) => {
      if (this.fontsLoaded.has(family)) return
      this.fontsLoaded.add(family)
      if (typeof document === 'undefined' || !document.fonts) return
      try {
        // Load a couple of common weights — most scenes use 400 / 600.
        // Pixi just calls into the document's font cache when it
        // rasterizes, so a successful document.fonts.load() is enough.
        await Promise.all([
          document.fonts.load(`400 16px "${family}"`),
          document.fonts.load(`600 16px "${family}"`),
        ])
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[PixiExportRenderer] failed to load font', family, err)
      }
    })

    await Promise.all([...imgPromises, ...fontPromises])

    // Belt-and-suspenders: even after our targeted document.fonts.load
    // calls resolve, Pixi Text's internal canvas2d sometimes still
    // measures text against an empty font cache, returning width=0 and
    // skipping the draw. Awaiting `document.fonts.ready` waits for ALL
    // font loads in the document — including the editor's own Inter
    // load via Tailwind / @font-face — which gives Pixi a fully warm
    // cache when we start the frame loop.
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      try {
        await document.fonts.ready
      } catch {
        /* ignore — fonts may still be partially missing; Pixi will fall
           back to the system sans-serif and we'll see in the bbox log */
      }
    }
  }

  /**
   * Render one frame and return the underlying canvas. The returned
   * canvas is owned by Pixi — caller should NOT mutate it; just hand
   * it to `new VideoFrame(canvas, ...)` and let WebCodecs read pixels.
   *
   * Walks the scene from the root, syncs each node into its Pixi
   * container, applies layout + transforms + animated values, then
   * triggers `app.render()`. The scene-graph reuse via nodeMap keeps
   * GC pressure low across a 300-frame export.
   */
  /**
   * Diagnostic stats accumulated during one frame's render. Logged
   * once per export (only on the first frame) to keep the console
   * usable — a 300-frame export with per-text logging dumps thousands
   * of lines otherwise.
   */
  private debugStats = {
    nodesVisited: 0,
    textsRendered: 0,
    textsSkipped: 0,
    imagesRendered: 0,
    imagesPlaceholder: 0,
    rectsPainted: 0,
    skipped0Size: 0,
  }
  private frameCount = 0

  async renderFrame(input: RenderFrameInput): Promise<HTMLCanvasElement> {
    const { width, height } = input
    await this.init(width, height)
    if (!this.app || !this.root) {
      throw new Error('PixiExportRenderer.renderFrame: init failed')
    }
    // Reset per-frame diagnostic stats.
    this.debugStats = {
      nodesVisited: 0,
      textsRendered: 0,
      textsSkipped: 0,
      imagesRendered: 0,
      imagesPlaceholder: 0,
      rectsPainted: 0,
      skipped0Size: 0,
    }

    // Wipe last frame's tree. We could diff and reuse, but a 300-frame
    // export creating a fresh tree each frame is well within budget at
    // <10ms per call for typical scenes. Optimize later if profiles
    // show this matters.
    this.root.removeChildren()
    this.nodeMap.clear()

    // Compute the artboard scale: how many output pixels per scene
    // pixel. Same logic the captureArtboardFrame letterbox uses, but
    // applied as a Pixi container scale instead of a canvas drawImage.
    const sceneAspect = input.sceneWidth / Math.max(1, input.sceneHeight)
    const targetAspect = width / Math.max(1, height)
    let drawW = width
    let drawH = height
    if (sceneAspect > targetAspect) {
      drawH = Math.round(width / sceneAspect)
    } else {
      drawW = Math.round(height * sceneAspect)
    }
    const dx = Math.floor((width - drawW) / 2)
    const dy = Math.floor((height - drawH) / 2)
    const scaleX = drawW / Math.max(1, input.sceneWidth)
    const scaleY = drawH / Math.max(1, input.sceneHeight)
    this.root.position.set(dx, dy)
    this.root.scale.set(scaleX, scaleY)

    // Background fill — paint the artboard's solid background under
    // the scene tree. Skipped when the caller passes null so partial
    // exports can stay transparent.
    if (input.background) {
      const bg = new Graphics()
      const bgColor = parseColor(input.background)
      bg.rect(0, 0, input.sceneWidth, input.sceneHeight).fill({
        color: bgColor.color,
        alpha: bgColor.alpha,
      })
      this.root.addChild(bg)
    }

    // Walk scene tree from root, building Pixi children.
    const rootId = input.api.getRoot()
    if (rootId) {
      this.renderNode(rootId, this.root, input)
      for (const overlayRootId of alwaysOnTopRootsInPaintOrder(input.api)) {
        this.renderNode(overlayRootId, this.root, input, true)
      }
    }

    // Canary text: a known-good Pixi Text at a known position. If
    // this one renders but the scene's texts don't, we know Pixi Text
    // works in general and the bug is in our scene→Text wiring. If
    // even THIS doesn't show, Pixi Text setup is broken at a deeper
    // level. Painted at the top-left of the artboard in red Arial so
    // it's impossible to miss in the export.
    if (this.frameCount === 0) {
      const canary = new Text({
        text: 'PIXI CANARY OK',
        style: {
          fontFamily: 'Arial',
          fontSize: 48,
          fontWeight: 'bold',
          fill: 0xff0044,
        },
      })
      canary.position.set(20, 20)
      this.root.addChild(canary)
      // eslint-disable-next-line no-console
      console.log('[PixiExport] canary bbox=', {
        w: canary.width,
        h: canary.height,
      })
    }

    // Trigger the actual GPU render. After this, app.canvas has the
    // rendered pixels and is ready to be sampled by WebCodecs.
    this.app.render()

    // Diagnostic summary — first frame only so a 300-frame export
    // doesn't flood the console.
    if (this.frameCount === 0) {
      // eslint-disable-next-line no-console
      console.log('[PixiExport] frame summary', this.debugStats, {
        preloadedImages: this.imageTextures.size,
        preloadedFonts: Array.from(this.fontsLoaded),
      })
    }
    this.frameCount++

    return this.app.canvas as HTMLCanvasElement
  }

  /** Direct access to the Pixi canvas — useful for `new VideoFrame()`. */
  getCanvas(): HTMLCanvasElement | null {
    return (this.app?.canvas as HTMLCanvasElement | undefined) ?? null
  }

  // -------------------------------------------------------------------------
  // Scene → Pixi sync.
  // -------------------------------------------------------------------------

  private renderNode(
    id: NodeId,
    parent: Container,
    input: RenderFrameInput,
    includeAlwaysOnTop = false,
  ): void {
    const node = input.api.getNode(id)
    if (!node) return
    if (!node.visible) return
    if (!includeAlwaysOnTop && isAlwaysOnTopNode(node)) return
    this.debugStats.nodesVisited++

    // The artboard root paints its own background (handled above) and
    // then composes children directly — no transform layer of its own
    // because the artboard never tilts/scales as a unit.
    const isRoot = id === input.api.getRoot()

    const rect = input.layout[id]
    const animated = input.animated[id] ?? {}

    // Build the per-node container. We always create a Container even
    // for shapes — it carries the transform, and the shape Graphics
    // sits as its child. This keeps the scale / rotation / position
    // composition obvious and lets us add masks/filters per node in
    // later phases without restructuring.
    const container = new Container()
    parent.addChild(container)
    this.nodeMap.set(id, container)

    if (!isRoot && rect) {
      // Position: layout puts the node at (rect.x, rect.y) in scene
      // space. Animated x/y compose ON TOP as a post-layout offset
      // (the load-bearing invariant from CLAUDE.md).
      const offsetX = animated.x ?? 0
      const offsetY = animated.y ?? 0
      container.position.set(rect.x + offsetX, rect.y + offsetY)

      // Scale + rotation. Animated values multiply / add to the
      // node's static transform. The pivot is the center of the
      // rect so rotation feels right (matches CSS transform-origin:
      // center).
      const staticScaleX = node.transform.scaleX ?? 1
      const staticScaleY = node.transform.scaleY ?? 1
      const animScaleX = animated.scaleX ?? 1
      const animScaleY = animated.scaleY ?? 1
      container.scale.set(
        staticScaleX * animScaleX,
        staticScaleY * animScaleY,
      )
      const staticRotation = node.transform.rotation ?? 0
      const animRotation = animated.rotation ?? 0
      const totalRotation = ((staticRotation + animRotation) * Math.PI) / 180
      container.rotation = totalRotation
      // Pivot at center so rotation/scale spin around the node's
      // visible center, not its top-left.
      container.pivot.set(rect.width / 2, rect.height / 2)
      container.position.set(
        rect.x + offsetX + rect.width / 2,
        rect.y + offsetY + rect.height / 2,
      )

      // Opacity: animated × static.
      const staticOpacity = node.appearance.opacity ?? 1
      const animOpacity = animated.opacity ?? 1
      container.alpha = staticOpacity * animOpacity
    }

    // Paint the shape itself, if this kind has a visual.
    this.paintShape(node, rect, animated, container)

    // Phase 3: per-node visual effects — drop shadows and blurs from
    // appearance.effects[]. Shadows insert BEHIND the shape; blurs
    // attach to the container's filter chain so they apply to the
    // shape and any later children of this container.
    if (rect) {
      this.applyEffects(node, rect, container)
    }

    // Recurse into children. Children's rects are already in scene
    // space (solveLayout returns absolute coordinates), so for Phase
    // 1 we attach each node directly to root rather than its scene
    // parent — keeps the position math straightforward.
    //
    // Phase 3 mask wiring: when a child has isMask=true, its silhouette
    // clips the immediate NEXT sibling's container (Figma's mask
    // convention). We track the pending mask in a local variable
    // through the iteration; once the next non-mask child is rendered,
    // we hook up `targetContainer.mask = maskContainer` and clear the
    // pending state. Pixi treats the mask container as an alpha mask
    // and doesn't paint it visibly when used this way.
    let pendingMask: Container | null = null
    for (const childId of node.children) {
      const childNode = input.api.getNode(childId)
      if (!childNode) continue
      this.renderNode(childId, this.root!, input, includeAlwaysOnTop)
      const childContainer = this.nodeMap.get(childId)
      if (!childContainer) continue
      if (pendingMask) {
        childContainer.mask = pendingMask
        pendingMask = null
      }
      if (childNode.isMask) {
        pendingMask = childContainer
      }
    }
  }

  /**
   * Draw the visible shape for this node onto its container. Each
   * `kind` paints differently — frames/rects/ellipses are Graphics
   * primitives, text/image/video/camera/component are stubbed in
   * Phase 1 (rendered as plain rects with the appearance fill so
   * something visible is in the output).
   */
  private paintShape(
    node: Node,
    rect: Rect | undefined,
    animated: AnimatedValue,
    container: Container,
  ): void {
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      this.debugStats.skipped0Size++
      // Loud about size-zero text/image — these are the most likely
      // missing-content sources, easy to track down once we know.
      if (node.kind === 'text' || node.kind === 'image' || node.kind === 'vector') {
        // eslint-disable-next-line no-console
        console.warn(
          '[PixiExport] skipped 0-size node',
          node.kind,
          node.id,
          'name=',
          node.name,
          'rect=',
          rect,
        )
      }
      return
    }

    // Local origin: container's pivot=(w/2, h/2) and position=(rect.x +
    // w/2, rect.y + h/2). The two offsets cancel, so local (0, 0) maps
    // to world (rect.x, rect.y) — i.e. the rect's top-left. Draw shapes
    // from (0, 0) to (w, h). The earlier (-w/2, -h/2) origin was wrong:
    // it shifted every shape by (-w/2, -h/2) from where it belonged,
    // scattering text and shapes across the canvas at incorrect spots.
    const localX = 0
    const localY = 0
    const w = rect.width
    const h = rect.height

    if (node.kind === 'vector') {
      this.paintVectorShape(node, w, h, container)
      return
    }

    const g = new Graphics()
    container.addChild(g)

    if (node.kind === 'frame' || node.kind === 'rect') {
      this.paintRectShape(g, localX, localY, w, h, node, animated)
    } else if (node.kind === 'ellipse') {
      this.paintEllipseShape(g, localX, localY, w, h, node, animated)
    } else if (node.kind === 'text') {
      // Text is rendered as a Pixi Text on top of the (optional)
      // appearance fill rect. Frame-style fills are rare on text
      // nodes but supported (e.g. text-on-pill effects). The Graphics
      // object g serves as the optional background; the Text is added
      // separately to the container.
      this.paintRectShape(g, localX, localY, w, h, node, animated)
      this.paintTextShape(node, w, h, animated, container)
    } else if (node.kind === 'image') {
      // Image renders the texture into the rect; we DO NOT paint the
      // appearance fill underneath because the texture covers the
      // entire rect for fit='fill'. For fit='contain' we'd want a
      // background to letterbox into — added in a later phase if
      // anyone uses it.
      this.paintImageShape(node, localX, localY, w, h, animated, container)
    } else if (
      node.kind === 'video' ||
      node.kind === 'component' ||
      node.kind === 'instance'
    ) {
      // Video frames need ImageBitmap-from-VideoFrame work that lands
      // post-MVP; component/instance need a recursive render of their
      // resolved tree. For now, paint the appearance fill rect so the
      // export still produces something visible.
      this.paintRectShape(g, localX, localY, w, h, node, animated)
    } else if (node.kind === 'camera' || node.kind === 'audio') {
      // Cameras and audio nodes don't paint anything. The camera's
      // transform is applied to the root in a later phase. Audio is invisible.
    }
  }

  private paintVectorShape(
    node: VectorNode,
    width: number,
    height: number,
    container: Container,
  ): void {
    const trim = vectorTrimState(node)
    const preserved = getPreservedVectorSource(node, trim)
    if (preserved) {
      const texture = this.imageTextures.get(preserved.dataUrl)
      if (texture) {
        const sprite = new Sprite(texture)
        sprite.width = width
        sprite.height = height
        container.addChild(sprite)
        return
      }
    }

    try {
      const rootScaleX = Math.abs(this.root?.scale.x ?? 1)
      const rootScaleY = Math.abs(this.root?.scale.y ?? 1)
      const nodeScaleX = Math.abs(container.scale.x || 1)
      const nodeScaleY = Math.abs(container.scale.y || 1)
      const pixelWidth = Math.max(
        1,
        Math.min(this.outputWidth, Math.ceil(width * rootScaleX * nodeScaleX)),
      )
      const pixelHeight = Math.max(
        1,
        Math.min(this.outputHeight, Math.ceil(height * rootScaleY * nodeScaleY)),
      )
      const raster = this.vectorRaster(node.id, pixelWidth, pixelHeight)
      const viewBoxKey = `${node.viewBox.x},${node.viewBox.y},${node.viewBox.width},${node.viewBox.height}`
      const trimKey = `${trim.start},${trim.end},${trim.offset}`
      const rasterIsCurrent =
        raster.paintedVector === node.vector &&
        raster.paintedSource === node.source &&
        raster.paintedImportFidelity === node.importFidelity &&
        raster.paintedViewBoxKey === viewBoxKey &&
        raster.paintedTrimKey === trimKey
      if (!rasterIsCurrent) {
        raster.context.setTransform(1, 0, 0, 1, 0, 0)
        raster.context.clearRect(0, 0, pixelWidth, pixelHeight)
        paintVectorNodeToCanvas(
          raster.context,
          node,
          pixelWidth,
          pixelHeight,
          trim,
        )
        raster.texture.source.update()
        raster.paintedVector = node.vector
        raster.paintedSource = node.source
        raster.paintedImportFidelity = node.importFidelity
        raster.paintedViewBoxKey = viewBoxKey
        raster.paintedTrimKey = trimKey
      }
      const sprite = new Sprite(raster.texture)
      sprite.width = width
      sprite.height = height
      container.addChild(sprite)
    } catch (error) {
      // One malformed imported contour must not abort the entire export.
      console.warn('[PixiExport] vector paint failed', node.id, error)
    }
  }

  private vectorRaster(
    nodeId: NodeId,
    width: number,
    height: number,
  ): VectorRasterEntry {
    const current = this.vectorRasters.get(nodeId)
    if (current && current.width === width && current.height === height) {
      return current
    }
    if (current) current.texture.destroy(true)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not create vector raster surface')
    const entry: VectorRasterEntry = {
      canvas,
      context,
      texture: Texture.from(canvas, true),
      width,
      height,
      paintedVector: null,
      paintedSource: undefined,
      paintedImportFidelity: null,
      paintedViewBoxKey: '',
      paintedTrimKey: '',
    }
    this.vectorRasters.set(nodeId, entry)
    return entry
  }

  /**
   * Paint a TextNode using Pixi's canvas-based Text. The text sits
   * inside the node's rect — `paintRectShape` already drew any
   * appearance fill on the same container, so the text composes on
   * top.
   *
   * Wrapping: when the size on either axis is fixed (numeric width),
   * we enable wordWrap and hand Pixi the available width. When width
   * is hug, no wrap — the text grows in one line (matching Figma's
   * "Auto width" mode).
   */
  private paintTextShape(
    node: TextNode,
    w: number,
    h: number,
    animated: AnimatedValue,
    container: Container,
  ): void {
    const textColor = animated.fill ?? node.color
    const c = parseColor(textColor)
    // Map our 'start' / 'center' / 'end' to Pixi's 'left' / 'center' / 'right'.
    const align: 'left' | 'center' | 'right' | 'justify' =
      node.textAlign === 'center'
        ? 'center'
        : node.textAlign === 'end'
          ? 'right'
          : node.textAlign === 'justify'
            ? 'justify'
            : 'left'
    // lineHeight is stored as a unitless multiplier (Figma convention,
    // matched by our text import); Pixi wants pixels.
    const lineHeightPx = Math.round(node.lineHeight * node.fontSize)
    // Width: hug nodes have a non-numeric `size.width` token; we treat
    // those as no-wrap. Numeric widths get wordWrap with that pixel
    // budget so multi-line text breaks at the box edge.
    const wrapWidth = typeof node.size.width === 'number' ? w : 0

    // Pixi v8 fontWeight accepts numeric strings ('100' through '900')
    // and the named weights ('normal', 'bold'). The data model stores
    // a number; map common weights to keep the type system happy and
    // fall back to a numeric string for in-betweens.
    const fontWeight = mapFontWeight(node.fontWeight)
    const renderedText = displayedText(node)

    let text: Text
    try {
      text = new Text({
        text: renderedText,
        style: {
          fontFamily: node.fontFamily || 'Inter',
          fontSize: node.fontSize,
          fontWeight,
          fontStyle: node.fontStyle,
          fontVariant:
            node.textCase === 'small-caps' ||
            node.textCase === 'small-caps-forced'
              ? 'small-caps'
              : 'normal',
          // Pixi accepts a hex number for fill — c.color is already
          // 0xRRGGBB. Alpha applied via Text.alpha below.
          fill: c.color,
          align,
          lineHeight: lineHeightPx,
          letterSpacing: node.letterSpacing,
          wordWrap: wrapWidth > 0,
          wordWrapWidth: wrapWidth || 0,
          trim: false,
        },
      })
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        '[PixiExportRenderer] Text construction failed',
        { text: renderedText, fontFamily: node.fontFamily, fontWeight },
        err,
      )
      return
    }
    text.alpha = c.alpha
    this.debugStats.textsRendered++
    if (this.frameCount === 0) {
      // bbox of the constructed Pixi Text. If width or height is 0,
      // the text won't draw — typically caused by font not being in
      // the canvas2d cache at construction time, or by an empty
      // wordWrapWidth interaction. Knowing this is the smoking-gun
      // signal we need.
      const bbox = { w: text.width, h: text.height }
      // eslint-disable-next-line no-console
      console.log(
        '[PixiExport] text',
        node.id,
        JSON.stringify(renderedText.slice(0, 40)),
        'family=',
        node.fontFamily,
        'size=',
        node.fontSize,
        'weight=',
        fontWeight,
        'bbox=',
        bbox,
        'fill=',
        `0x${c.color.toString(16).padStart(6, '0')}`,
      )
    }

    // Anchor + position so single-line text honors textAlign within
    // the node's rect. The container's pivot+position math cancels so
    // local (0, 0) is the rect's top-left and (w, h) is the bottom-
    // right (see paintShape's localX/localY comment). For start align,
    // text top-left sits at local (0, 0). For center, text top-center
    // at local (w/2, 0). For end, text top-right at local (w, 0).
    // Vertical alignment uses the same anchor/position pairing so the
    // export renderer matches the editor's top/center/bottom controls.
    const anchorX = align === 'center' ? 0.5 : align === 'right' ? 1 : 0
    const localX = align === 'center' ? w / 2 : align === 'right' ? w : 0
    const anchorY =
      node.textAlignVertical === 'center'
        ? 0.5
        : node.textAlignVertical === 'bottom'
          ? 1
          : 0
    const localY =
      node.textAlignVertical === 'center'
        ? h / 2
        : node.textAlignVertical === 'bottom'
          ? h
          : 0
    text.anchor.set(anchorX, anchorY)
    text.position.set(localX, localY)
    container.addChild(text)
  }

  /**
   * Paint an ImageNode as a Pixi Sprite scaled to the node's rect.
   * Texture must already be in `imageTextures` (loaded by preloadAssets).
   * If missing, falls back to the appearance fill rect so the export
   * doesn't have a hole.
   */
  private paintImageShape(
    node: ImageNode,
    localX: number,
    localY: number,
    w: number,
    h: number,
    animated: AnimatedValue,
    container: Container,
  ): void {
    const tex = this.imageTextures.get(node.src)
    if (!tex) {
      this.debugStats.imagesPlaceholder++
      // eslint-disable-next-line no-console
      console.warn(
        '[PixiExport] image texture missing — using placeholder',
        node.id,
        'name=',
        node.name,
        'src=',
        node.src.slice(0, 80) + (node.src.length > 80 ? '…' : ''),
        'cacheSize=',
        this.imageTextures.size,
      )
      // Texture didn't load — paint the appearance fill or a soft
      // gray placeholder rect so the user sees something marking the
      // missing asset rather than empty space.
      const placeholder = new Graphics()
      placeholder.rect(localX, localY, w, h).fill({
        color: 0x303035,
        alpha: 1,
      })
      container.addChild(placeholder)
      return
    }
    this.debugStats.imagesRendered++
    const sprite = new Sprite(tex)
    const texW = tex.width || 1
    const texH = tex.height || 1

    if (node.fit === 'fill') {
      // Stretch to box, ignoring aspect ratio.
      sprite.width = w
      sprite.height = h
      sprite.position.set(localX, localY)
    } else if (node.fit === 'cover') {
      // Scale uniformly to cover the whole rect, possibly cropping.
      const scale = Math.max(w / texW, h / texH)
      sprite.scale.set(scale)
      sprite.position.set(
        localX + (w - texW * scale) / 2,
        localY + (h - texH * scale) / 2,
      )
      // Mask the sprite to the node's rect so the overshoot doesn't
      // bleed into siblings.
      const mask = new Graphics()
      mask.rect(localX, localY, w, h).fill({ color: 0xffffff, alpha: 1 })
      container.addChild(mask)
      sprite.mask = mask
    } else if (node.fit === 'contain') {
      // Scale uniformly to fit inside, with letterbox space if aspects
      // differ. The empty space outside the texture stays transparent
      // (caller can paint the appearance fill underneath if they want
      // a background).
      const scale = Math.min(w / texW, h / texH)
      sprite.scale.set(scale)
      sprite.position.set(
        localX + (w - texW * scale) / 2,
        localY + (h - texH * scale) / 2,
      )
    } else {
      // 'none' — natural size, top-left aligned.
      sprite.position.set(localX, localY)
    }

    // Honor animated opacity overrides on the image (rare but used
    // for fade-in IN presets on image layers).
    if (animated.opacity !== undefined) {
      sprite.alpha = animated.opacity
    }
    container.addChild(sprite)
  }

  private paintRectShape(
    g: Graphics,
    x: number,
    y: number,
    w: number,
    h: number,
    node: { appearance: Appearance } & Node,
    animated: AnimatedValue,
  ): void {
    const radius = animated.cornerRadius ?? node.appearance.cornerRadius ?? 0
    const radii = node.appearance.cornerRadii
    if (radii) {
      // Per-corner radii — Pixi v8 doesn't have a built-in roundRect
      // with 4 different corners, so we draw the path manually.
      this.drawRoundedRectPath(g, x, y, w, h, radii)
    } else if (radius > 0) {
      g.roundRect(x, y, w, h, Math.min(radius, Math.min(w, h) / 2))
    } else {
      g.rect(x, y, w, h)
    }
    // Fill.
    const fill = resolveFill(node.appearance.fill, animated)
    if (fill) {
      g.fill({ color: fill.color, alpha: fill.alpha })
    }
    // Stroke.
    if (node.appearance.stroke) {
      const s = node.appearance.stroke
      const stroke = resolveStrokeColor(s)
      g.stroke({
        color: stroke.color,
        alpha: stroke.alpha,
        width: s.width,
        // Pixi's stroke alignment: 0=outer, 0.5=center, 1=inner.
        // Map our 'inside'/'center'/'outside' to those numbers.
        alignment: s.align === 'inside' ? 1 : s.align === 'outside' ? 0 : 0.5,
      })
    }
  }

  private paintEllipseShape(
    g: Graphics,
    x: number,
    y: number,
    w: number,
    h: number,
    node: EllipseNode,
    animated: AnimatedValue,
  ): void {
    const cx = x + w / 2
    const cy = y + h / 2
    g.ellipse(cx, cy, w / 2, h / 2)
    const fill = resolveFill(node.appearance.fill, animated)
    if (fill) {
      g.fill({ color: fill.color, alpha: fill.alpha })
    }
    if (node.appearance.stroke) {
      const s = node.appearance.stroke
      const stroke = resolveStrokeColor(s)
      g.stroke({
        color: stroke.color,
        alpha: stroke.alpha,
        width: s.width,
        alignment: s.align === 'inside' ? 1 : s.align === 'outside' ? 0 : 0.5,
      })
    }
  }

  /**
   * Apply visible effects (shadows + blurs) to the node's container.
   *
   *   - shadow:       draws a blurred silhouette underneath the shape
   *   - inner-shadow: not yet supported — needs an alpha-mask filter
   *                   that Pixi core doesn't ship with. Skipped silently
   *                   for now; the node renders without the effect.
   *   - blur:         core BlurFilter on the container, blurring the
   *                   shape and anything its container holds (useful
   *                   for "soft glass" / "out of focus" looks).
   *
   * Iterates effects in REVERSE so the visual stacking matches the
   * order users see in the Inspector — the top entry in the list paints
   * on top, the bottom entry sits behind. The reverse-iteration plus
   * `addChildAt(0)` ensures the first effect paints in front of the
   * second, and so on.
   */
  private applyEffects(node: Node, rect: Rect, container: Container): void {
    const effects = node.appearance.effects
    if (!effects || effects.length === 0) return

    const blurFilters: Filter[] = []
    for (let i = effects.length - 1; i >= 0; i--) {
      const e = effects[i]
      // Hidden effects render as if they weren't there. Default-true
      // for legacy rows that lack the explicit `visible` flag.
      if (e.visible === false) continue
      if (e.kind === 'shadow') {
        this.appendDropShadow(e, node, rect, container)
      } else if (e.kind === 'blur') {
        // Pixi v8 BlurFilter strength is roughly 1px ≈ 1 unit but
        // perceptually softer than CSS blur. Halving brings it closer
        // to what users sketched in the editor's CSS-blur preview.
        blurFilters.push(new BlurFilter({ strength: e.amount / 2 }))
      }
      // 'inner-shadow' is intentionally skipped — see method header.
    }

    if (blurFilters.length > 0) {
      // Compose with any existing filters on the container (none yet
      // in Phase 3, but defensive against future additions).
      const existing = container.filters
      const existingArr = Array.isArray(existing)
        ? existing
        : existing
          ? [existing]
          : []
      container.filters = [...existingArr, ...blurFilters]
    }
  }

  /**
   * Draw a drop shadow as a blurred silhouette behind the shape. We
   * draw the same primitive (rect / rounded rect / ellipse) as the
   * node, sized + offset per the effect, blurred via BlurFilter on
   * the shadow Graphics itself.
   *
   * Inserted at child index 0 so it always paints behind the node's
   * shape. For nodes with multiple shadows, the reverse-iteration in
   * applyEffects means later-prepended shadows sit further behind —
   * matching the visual stack users see in the Inspector list.
   */
  private appendDropShadow(
    effect: {
      color: Color
      offsetX: number
      offsetY: number
      blur: number
      spread?: number
    },
    node: Node,
    rect: Rect,
    container: Container,
  ): void {
    const shadowColor = parseColor(effect.color)
    const spread = effect.spread ?? 0
    const ox = effect.offsetX
    const oy = effect.offsetY
    // Local coordinates: shapes paint from (0, 0) to (rect.width,
    // rect.height) thanks to the container's pivot+position cancelling
    // out (see paintShape). Spread expands the shadow outward; offset
    // shifts it from the shape's top-left.
    const w = rect.width + 2 * spread
    const h = rect.height + 2 * spread
    const x = ox - spread
    const y = oy - spread

    const g = new Graphics()
    if (node.kind === 'ellipse') {
      g.ellipse(x + w / 2, y + h / 2, w / 2, h / 2)
    } else if (
      (node.kind === 'frame' || node.kind === 'rect') &&
      (node.appearance.cornerRadius > 0 || node.appearance.cornerRadii)
    ) {
      const radii = node.appearance.cornerRadii
      if (radii) {
        this.drawRoundedRectPath(g, x, y, w, h, {
          tl: radii.tl + spread,
          tr: radii.tr + spread,
          br: radii.br + spread,
          bl: radii.bl + spread,
        })
      } else {
        const r = Math.min(
          node.appearance.cornerRadius + spread,
          Math.min(w, h) / 2,
        )
        g.roundRect(x, y, w, h, r)
      }
    } else {
      // Frames without corner radii, plus text/image/etc., get a
      // plain rect shadow approximation. For text/image this misses
      // the per-glyph silhouette but matches CSS box-shadow behavior
      // and is what most designers expect from a layer drop shadow.
      g.rect(x, y, w, h)
    }
    g.fill({ color: shadowColor.color, alpha: shadowColor.alpha })

    if (effect.blur > 0) {
      g.filters = [new BlurFilter({ strength: effect.blur / 2 })]
    }

    // Index 0 keeps the shadow behind the shape regardless of how many
    // shapes/text/sprites have already been added to this container.
    container.addChildAt(g, 0)
  }

  /**
   * Draw a rounded-rect path with per-corner radii. Pixi v8 doesn't
   * expose this directly (its `roundRect` takes a single radius), so
   * we walk the path manually using arc segments.
   */
  private drawRoundedRectPath(
    g: Graphics,
    x: number,
    y: number,
    w: number,
    h: number,
    radii: { tl: number; tr: number; br: number; bl: number },
  ): void {
    const maxR = Math.min(w, h) / 2
    const tl = Math.min(radii.tl, maxR)
    const tr = Math.min(radii.tr, maxR)
    const br = Math.min(radii.br, maxR)
    const bl = Math.min(radii.bl, maxR)
    g.moveTo(x + tl, y)
    g.lineTo(x + w - tr, y)
    if (tr > 0) g.arcTo(x + w, y, x + w, y + tr, tr)
    g.lineTo(x + w, y + h - br)
    if (br > 0) g.arcTo(x + w, y + h, x + w - br, y + h, br)
    g.lineTo(x + bl, y + h)
    if (bl > 0) g.arcTo(x, y + h, x, y + h - bl, bl)
    g.lineTo(x, y + tl)
    if (tl > 0) g.arcTo(x, y, x + tl, y, tl)
    g.closePath()
  }
}

// ---------------------------------------------------------------------------
// Typography helpers.
// ---------------------------------------------------------------------------

/**
 * Map our numeric fontWeight (100..900) to a Pixi-accepted form. Pixi v8's
 * TextStyle.fontWeight expects either a named weight ('normal' / 'bold' /
 * 'bolder' / 'lighter') or a numeric string ('100'..'900'). We snap to
 * the nearest 100-step and emit the numeric string — covers every
 * common weight from CSS without naming things 'demi' or 'semibold'
 * inconsistently.
 */
function mapFontWeight(
  weight: number,
):
  | 'normal'
  | 'bold'
  | 'bolder'
  | 'lighter'
  | '100'
  | '200'
  | '300'
  | '400'
  | '500'
  | '600'
  | '700'
  | '800'
  | '900' {
  if (!Number.isFinite(weight)) return '400'
  const snapped = Math.round(weight / 100) * 100
  const clamped = Math.max(100, Math.min(900, snapped))
  return String(clamped) as
    | '100'
    | '200'
    | '300'
    | '400'
    | '500'
    | '600'
    | '700'
    | '800'
    | '900'
}

// ---------------------------------------------------------------------------
// Color + fill helpers.
// ---------------------------------------------------------------------------

interface ResolvedColor {
  color: number
  alpha: number
}

/**
 * Resolve a Fill into a Pixi-friendly { color, alpha } pair.
 *
 * Phase 1 only handles solid fills. Gradient + image fills return
 * undefined, which means "no fill" — the shape paints transparent.
 * Phase 2 wires up Pixi's gradient + texture fill APIs for full parity.
 */
function resolveFill(
  fill: Fill | null,
  animated: AnimatedValue,
): ResolvedColor | undefined {
  // Animated fill override beats static.
  if (animated.fill) return parseColor(animated.fill)
  if (!fill) return undefined
  if (fill.kind === 'solid') return parseColor(fill.color)
  // Gradients + images stub out for Phase 1.
  return undefined
}

function resolveStrokeColor(stroke: Stroke): ResolvedColor {
  // Stroke.fill (when set) overrides .color. For Phase 1 we only
  // honor solid stroke fills; gradients land in Phase 2.
  if (stroke.fill && stroke.fill.kind === 'solid') {
    return parseColor(stroke.fill.color)
  }
  return parseColor(stroke.color)
}

/**
 * Parse the color string into a Pixi-compatible { color, alpha }.
 *
 * Supports:
 *   - hex: #rgb, #rrggbb, #rrggbbaa
 *   - rgb()/rgba() with integer or percent components
 *   - oklch() — converted via a lightweight oklch→rgb shim so the
 *     export matches what the editor's CSS oklch() produced
 *   - named colors that the browser knows ('white', 'black', 'red', ...)
 *     by leaning on a temporary canvas as the parser
 *
 * Returns black on failure rather than throwing — better to render a
 * black rect than crash the export.
 */
function parseColor(color: Color): ResolvedColor {
  const trimmed = color.trim()
  // Fast paths.
  if (trimmed.startsWith('#')) {
    return parseHex(trimmed)
  }
  if (trimmed.startsWith('rgb')) {
    return parseRgb(trimmed)
  }
  if (trimmed.startsWith('oklch')) {
    return parseOklch(trimmed)
  }
  // Fallback: ask the browser via a one-off canvas. This handles
  // 'red' / 'transparent' / 'currentColor' / etc. without us having
  // to maintain a name table.
  return parseViaCanvas(trimmed)
}

function parseHex(hex: string): ResolvedColor {
  let h = hex.slice(1)
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('')
  }
  if (h.length === 6) {
    return { color: parseInt(h, 16), alpha: 1 }
  }
  if (h.length === 8) {
    const rgb = parseInt(h.slice(0, 6), 16)
    const a = parseInt(h.slice(6, 8), 16) / 255
    return { color: rgb, alpha: a }
  }
  return { color: 0x000000, alpha: 1 }
}

function parseRgb(s: string): ResolvedColor {
  const m = s.match(/rgba?\s*\(\s*([^)]+)\)/i)
  if (!m) return { color: 0x000000, alpha: 1 }
  const parts = m[1].split(',').map((p) => p.trim())
  const toByte = (p: string): number => {
    if (p.endsWith('%')) {
      return Math.round((parseFloat(p) / 100) * 255)
    }
    return Math.round(parseFloat(p))
  }
  const r = toByte(parts[0] ?? '0')
  const g = toByte(parts[1] ?? '0')
  const b = toByte(parts[2] ?? '0')
  const a = parts[3] !== undefined ? parseFloat(parts[3]) : 1
  return { color: (r << 16) | (g << 8) | b, alpha: a }
}

/**
 * Lightweight oklch → sRGB. Mirrors what Chromium does for oklch() in
 * CSS, so the export output matches the editor preview.
 */
function parseOklch(s: string): ResolvedColor {
  const m = s.match(/oklch\s*\(\s*([^)]+)\)/i)
  if (!m) return { color: 0x000000, alpha: 1 }
  // oklch() syntax: oklch(L C H [/ alpha])
  const body = m[1].split('/')
  const lch = body[0]
    .trim()
    .split(/\s+/)
    .map((p) => parseFloat(p.replace('%', '')) * (p.endsWith('%') ? 0.01 : 1))
  const alphaStr = body[1]?.trim()
  const alpha = alphaStr ? parseFloat(alphaStr) : 1
  const L = lch[0] ?? 0
  const C = lch[1] ?? 0
  const Hdeg = lch[2] ?? 0
  const Hrad = (Hdeg * Math.PI) / 180
  const a = C * Math.cos(Hrad)
  const b = C * Math.sin(Hrad)
  // OkLab → linear sRGB (approximation per the OKLab spec).
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const lc = l_ * l_ * l_
  const mc = m_ * m_ * m_
  const sc = s_ * s_ * s_
  const r = +4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc
  const g = -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc
  const bl = -0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc
  // Linear → gamma-corrected sRGB byte.
  const enc = (v: number): number => {
    const clamped = Math.max(0, Math.min(1, v))
    const gamma =
      clamped <= 0.0031308
        ? 12.92 * clamped
        : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055
    return Math.round(gamma * 255)
  }
  return { color: (enc(r) << 16) | (enc(g) << 8) | enc(bl), alpha }
}

/**
 * Last-resort color parse. Uses a 1×1 canvas to ask the browser to
 * resolve any CSS color string (named colors, system colors, etc.).
 * Cached so repeated lookups don't allocate a fresh canvas each time.
 */
const colorCanvas = (() => {
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas')
  c.width = 1
  c.height = 1
  return c
})()

function parseViaCanvas(s: string): ResolvedColor {
  if (!colorCanvas) return { color: 0x000000, alpha: 1 }
  const ctx = colorCanvas.getContext('2d')
  if (!ctx) return { color: 0x000000, alpha: 1 }
  ctx.clearRect(0, 0, 1, 1)
  ctx.fillStyle = '#000'
  ctx.fillStyle = s // browser parses; falls back to last-set on failure
  ctx.fillRect(0, 0, 1, 1)
  const data = ctx.getImageData(0, 0, 1, 1).data
  return {
    color: (data[0] << 16) | (data[1] << 8) | data[2],
    alpha: data[3] / 255,
  }
}
