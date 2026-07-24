// SPDX-License-Identifier: Apache-2.0

import {
  Suspense,
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
  type Ref,
} from 'react'
import type { PaperShaderElement } from '@paper-design/shaders-react'
import type { SolvedLayout } from '@/layout'
import {
  useSceneAPI,
  useSceneVersion,
  type Node,
  type SceneAPI,
} from '@/scene'
import {
  notifyPaperShaderSourceChanged,
  paperShaderSourceBelongsTo,
  publishPaperShaderSource,
  removePaperShaderSource,
  resolvePaperShaderStatusMount,
} from '@/render/paperShaderSource'
import {
  getPaperShaderRenderer,
  paperShaderFrame,
  paperShaderNeedsImageSource,
  paperShaderRuntimeParams,
  resolvePaperShaderSource,
} from '@/render/paperShaderRegistry'
import { useUI } from '@/state/ui'
import { useAnimationPlaybackClock } from '@/ui/hooks/useAnimatedValues'

type ShaderNode = Extract<Node, { kind: 'shader' }>

type PaperShaderHost = HTMLDivElement

interface PaperShaderRenderQuality {
  minPixelRatio?: number
  maxPixelCount?: number
}

const PaperShaderRenderQualityContext =
  createContext<PaperShaderRenderQuality>({})

const PAPER_WEBGL_ATTRIBUTES: WebGLContextAttributes = {
  alpha: true,
  premultipliedAlpha: true,
  preserveDrawingBuffer: true,
}

function placeholderPixelRatio(
  width: number,
  height: number,
  minPixelRatio?: number,
  maxPixelCount?: number,
): number {
  let ratio = Math.max(
    1,
    minPixelRatio ??
      (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1),
  )
  if (
    maxPixelCount !== undefined &&
    Number.isFinite(maxPixelCount) &&
    maxPixelCount > 0
  ) {
    ratio = Math.min(ratio, Math.sqrt(maxPixelCount / (width * height)))
  }
  return Math.max(0.1, ratio)
}

function drawShaderStatusPlaceholder(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  ratio: number,
  message: string,
) {
  const pixelWidth = Math.max(1, Math.round(width * ratio))
  const pixelHeight = Math.max(1, Math.round(height * ratio))
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight

  const context = canvas.getContext('2d')
  if (!context) return
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, width, height)
  context.fillStyle = '#17181c'
  context.fillRect(0, 0, width, height)

  const grid = Math.max(12, Math.min(24, Math.round(Math.min(width, height) / 8)))
  context.strokeStyle = '#22242a'
  context.lineWidth = 1
  for (let x = -height; x < width + height; x += grid) {
    context.beginPath()
    context.moveTo(x, 0)
    context.lineTo(x + height, height)
    context.stroke()
  }

  const iconSize = Math.max(20, Math.min(40, Math.min(width, height) * 0.25))
  const iconX = width / 2 - iconSize / 2
  const textVisible = width >= 128 && height >= 76
  const iconY = height / 2 - iconSize / 2 - (textVisible ? 10 : 0)
  context.strokeStyle = '#727781'
  context.lineWidth = Math.max(1.5, iconSize / 16)
  context.setLineDash([])
  context.strokeRect(iconX, iconY, iconSize, iconSize * 0.78)
  context.beginPath()
  context.arc(
    iconX + iconSize * 0.72,
    iconY + iconSize * 0.22,
    iconSize * 0.08,
    0,
    Math.PI * 2,
  )
  context.stroke()
  context.beginPath()
  context.moveTo(iconX + iconSize * 0.08, iconY + iconSize * 0.68)
  context.lineTo(iconX + iconSize * 0.34, iconY + iconSize * 0.42)
  context.lineTo(iconX + iconSize * 0.52, iconY + iconSize * 0.58)
  context.lineTo(iconX + iconSize * 0.66, iconY + iconSize * 0.47)
  context.lineTo(iconX + iconSize * 0.92, iconY + iconSize * 0.68)
  context.stroke()

  if (textVisible) {
    context.fillStyle = '#a7abb3'
    context.font = '500 12px Inter, system-ui, sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(message, width / 2, iconY + iconSize + 14)
  }

  context.strokeStyle = '#40434a'
  context.lineWidth = 1
  context.setLineDash([6, 5])
  context.strokeRect(0.5, 0.5, Math.max(0, width - 1), Math.max(0, height - 1))
  context.setLineDash([])
}

function PaperShaderStatusCanvas({
  hostRef,
  registerSource,
  nodeId,
  message,
  processing,
  minPixelRatio,
  maxPixelCount,
  style,
}: {
  hostRef: MutableRefObject<PaperShaderHost | null>
  registerSource: boolean
  nodeId: string
  message: string
  processing: boolean
  minPixelRatio?: number
  maxPixelCount?: number
  style?: CSSProperties
}) {
  const statusRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useLayoutEffect(() => {
    const mount = resolvePaperShaderStatusMount(
      statusRef.current,
      hostRef.current,
    )
    const canvas = canvasRef.current
    if (!mount || !canvas) return

    const draw = () => {
      const bounds = mount.measureElement.getBoundingClientRect()
      const width = Math.max(1, bounds.width)
      const height = Math.max(1, bounds.height)
      const ratio = placeholderPixelRatio(
        width,
        height,
        minPixelRatio,
        maxPixelCount,
      )
      drawShaderStatusPlaceholder(canvas, width, height, ratio, message)
      if (
        registerSource &&
        publishPaperShaderSource(nodeId, mount.publishElement) &&
        paperShaderSourceBelongsTo(nodeId, mount.publishElement)
      ) {
        notifyPaperShaderSourceChanged()
      }
    }

    draw()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(draw)
    observer.observe(mount.measureElement)
    return () => observer.disconnect()
  }, [
    hostRef,
    maxPixelCount,
    message,
    minPixelRatio,
    nodeId,
    registerSource,
  ])

  return (
    <div
      ref={statusRef}
      data-paper-shader-missing-source={processing ? undefined : nodeId}
      data-paper-shader-processing={processing ? nodeId : undefined}
      role="img"
      aria-label={message}
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        borderRadius: 'inherit',
        ...style,
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ display: 'block', width: '100%', height: '100%' }}
      />
    </div>
  )
}

function PaperShaderCanvas({
  node,
  playhead,
  source,
  registerSource = false,
  minPixelRatio,
  maxPixelCount,
  style,
}: {
  node: ShaderNode
  playhead: number
  source?: string
  registerSource?: boolean
  minPixelRatio?: number
  maxPixelCount?: number
  style?: CSSProperties
}) {
  const hostRef = useRef<PaperShaderHost | null>(null)
  const shaderRef = useRef<PaperShaderElement | null>(null)
  const frame = paperShaderFrame(node, playhead)
  const missingRequiredSource = paperShaderNeedsImageSource(node, source)
  const renderer = getPaperShaderRenderer(node.shaderType)
  const ShaderComponent = renderer.component
  const runtimeParams = paperShaderRuntimeParams(node, playhead, source)
  const parameterSignature = useMemo(
    () =>
      JSON.stringify([
        node.shaderType,
        node.colors,
        node.params,
        node.scale,
        node.distortion,
        node.swirl,
        node.grain,
      ]),
    [
      node.colors,
      node.distortion,
      node.grain,
      node.params,
      node.scale,
      node.shaderType,
      node.swirl,
    ],
  )

  useLayoutEffect(() => {
    if (missingRequiredSource) return
    shaderRef.current?.paperShaderMount?.setFrame(frame)
  }, [frame, missingRequiredSource])

  useEffect(() => {
    if (!registerSource) return
    const host = hostRef.current
    if (!host) return

    let firstFrame = 0
    let settledFrame = 0
    const publish = () => {
      const canvas = publishPaperShaderSource(node.id, host)
      if (!canvas) return
      // ResizeObserver updates Paper's drawing buffer after the mount enters
      // layout. Publish again two paints later so Three replaces its fallback
      // gradient with the correctly sized source rather than the default
      // 300×150 WebGL canvas.
      firstFrame = requestAnimationFrame(() => {
        settledFrame = requestAnimationFrame(() => {
          if (paperShaderSourceBelongsTo(node.id, host)) {
            notifyPaperShaderSourceChanged()
          }
        })
      })
    }

    publish()
    const observer = new MutationObserver(publish)
    observer.observe(host, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      cancelAnimationFrame(firstFrame)
      cancelAnimationFrame(settledFrame)
      removePaperShaderSource(node.id, host)
    }
  }, [
    missingRequiredSource,
    node.id,
    node.shaderType,
    registerSource,
  ])

  useEffect(() => {
    if (!registerSource) return
    // The Paper React wrapper applies changed uniforms in a passive effect.
    // Notify Three on the following paint so its cached CanvasTexture is
    // refreshed only after those uniforms reach the source WebGL context.
    const id = requestAnimationFrame(() => {
      const host = hostRef.current
      if (!host || !publishPaperShaderSource(node.id, host)) return
      notifyPaperShaderSourceChanged()
    })
    return () => cancelAnimationFrame(id)
  }, [
    frame,
    node.id,
    parameterSignature,
    source,
    minPixelRatio,
    maxPixelCount,
    registerSource,
  ])

  useEffect(() => {
    if (!registerSource || !source || missingRequiredSource) return
    // Image effects may replace an asynchronously processed mask/texture after
    // their first paint. Refresh Three at a few bounded checkpoints so paused
    // previews and headless sources do not remain on Paper's transparent pixel.
    const delays = [50, 150, 350, 750, 1500, 3000]
    const timers = delays.map((delay) =>
      window.setTimeout(() => {
        const host = hostRef.current
        if (!host || !publishPaperShaderSource(node.id, host)) return
        notifyPaperShaderSourceChanged()
      }, delay),
    )
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [
    missingRequiredSource,
    node.id,
    node.shaderType,
    registerSource,
    source,
  ])

  return (
    <div
      ref={hostRef}
      data-paper-shader-host={node.id}
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        borderRadius: 'inherit',
        ...style,
      }}
    >
      {missingRequiredSource ? (
        <PaperShaderStatusCanvas
          hostRef={hostRef}
          registerSource={registerSource}
          nodeId={node.id}
          message="Add image source"
          processing={false}
          minPixelRatio={minPixelRatio}
          maxPixelCount={maxPixelCount}
        />
      ) : (
        <Suspense
          fallback={
            <PaperShaderStatusCanvas
              hostRef={hostRef}
              registerSource={registerSource}
              nodeId={node.id}
              message="Preparing image"
              processing
              minPixelRatio={minPixelRatio}
              maxPixelCount={maxPixelCount}
            />
          }
        >
          <ShaderComponent
            {...runtimeParams}
            ref={shaderRef as Ref<PaperShaderElement>}
            minPixelRatio={minPixelRatio}
            maxPixelCount={maxPixelCount}
            width="100%"
            height="100%"
            webGlContextAttributes={PAPER_WEBGL_ATTRIBUTES}
            style={{
              display: 'block',
              width: '100%',
              height: '100%',
              overflow: 'hidden',
              borderRadius: 'inherit',
            }}
          />
        </Suspense>
      )}
    </div>
  )
}

export function PaperShaderRenderQualityProvider({
  minPixelRatio,
  maxPixelCount,
  children,
}: PaperShaderRenderQuality & { children: ReactNode }) {
  const value = useMemo(
    () => ({ minPixelRatio, maxPixelCount }),
    [minPixelRatio, maxPixelCount],
  )
  return (
    <PaperShaderRenderQualityContext.Provider value={value}>
      {children}
    </PaperShaderRenderQualityContext.Provider>
  )
}

/** Live DOM/fallback renderer for a visible shader node. */
export function LivePaperShaderCanvas({ node }: { node: ShaderNode }) {
  const api = useSceneAPI()
  useSceneVersion()
  const quality = useContext(PaperShaderRenderQualityContext)
  const playing = useUI((state) => state.playing)
  const pausedPlayhead = useUI((state) => state.playhead)
  const playbackPlayhead = useAnimationPlaybackClock(
    playing && node.speed > 0.0001,
  )
  const source = resolvePaperShaderSource(node, api)
  return (
    <PaperShaderCanvas
      node={node}
      playhead={playing ? playbackPlayhead : pausedPlayhead}
      source={source}
      minPixelRatio={quality.minPixelRatio}
      maxPixelCount={quality.maxPixelCount}
      style={{ pointerEvents: 'none' }}
    />
  )
}

/**
 * Invisible source mounts used by the camera/Three path. The mounts remain in
 * layout (far outside the captured viewport) so Paper's ResizeObserver can
 * choose a real drawing-buffer size. `display:none` and `visibility:hidden`
 * are deliberately avoided because both collapse or suppress WebGL output.
 */
export function PaperShaderSourceLayer({
  api,
  layout,
  sceneVersion,
  minPixelRatio,
  maxPixelCount,
}: {
  api: SceneAPI
  layout: SolvedLayout
  sceneVersion: number
  minPixelRatio?: number
  maxPixelCount?: number
}) {
  const entries = useMemo(() => {
    void sceneVersion
    return api.getAllNodeIds().flatMap((id) => {
      const node = api.getNode(id)
      const rect = layout[id]
      return node?.kind === 'shader' && node.visible && rect
        ? [{ node, rect, source: resolvePaperShaderSource(node, api) }]
        : []
    })
  }, [api, layout, sceneVersion])
  const playing = useUI((state) => state.playing)
  const pausedPlayhead = useUI((state) => state.playhead)
  const hasMotion = entries.some(({ node }) => node.speed > 0.0001)
  const playbackPlayhead = useAnimationPlaybackClock(playing && hasMotion)
  const playhead = playing ? playbackPlayhead : pausedPlayhead

  if (entries.length === 0) return null
  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        left: -100000,
        top: 0,
        width: 1,
        height: 1,
        overflow: 'visible',
        opacity: 0,
        pointerEvents: 'none',
      }}
    >
      {entries.map(({ node, rect, source }) => (
        <div
          key={node.id}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: Math.max(1, rect.width),
            height: Math.max(1, rect.height),
          }}
        >
          <PaperShaderCanvas
            node={node}
            playhead={playhead}
            source={source}
            registerSource
            minPixelRatio={minPixelRatio}
            maxPixelCount={maxPixelCount}
          />
        </div>
      ))}
    </div>
  )
}
