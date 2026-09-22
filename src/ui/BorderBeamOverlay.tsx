// SPDX-License-Identifier: Apache-2.0
import { useLayoutEffect, useRef } from 'react'
import type { Effect, Node } from '@/scene'
import { beamPadding, hasAnimatedBeam } from '@/scene/borderBeam'
import { beamRasterScale } from '@/render/beam/raster'
import { paintBorderBeam } from '@/render/beam/paintBorderBeam'
import { useAnimationPlaybackClock } from '@/ui/hooks/useAnimatedValues'

export function BorderBeamOverlay({ node, width, height, radius, cornerSmoothing = 0, effects }: {
  node: Node; width: number; height: number; radius: number | readonly number[]; cornerSmoothing?: number; effects: readonly Effect[]
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const time = useAnimationPlaybackClock(hasAnimatedBeam(effects))
  const beams = effects.filter(e => e.kind === 'border-beam')
  const padding = Math.max(0, ...beams.map(e => beamPadding(e, width, height)))
  useLayoutEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const scale = beamRasterScale(width + padding * 2, height + padding * 2, Math.min(2, window.devicePixelRatio || 1))
    canvas.width = Math.ceil((width + padding * 2) * scale)
    canvas.height = Math.ceil((height + padding * 2) * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(scale, scale); ctx.translate(padding, padding)
    const fill = node.appearance.fill
    for (const effect of beams) paintBorderBeam(ctx, effect, {
      width, height, radius, cornerSmoothing, ellipse: node.kind === 'ellipse', fill: fill?.kind === 'solid' ? fill.color : undefined,
    }, time + (node.proceduralTimeOffset ?? 0))
  }, [beams, width, height, radius, cornerSmoothing, padding, node, time])
  if (!beams.length) return null
  return <canvas ref={ref} aria-hidden data-border-beam style={{ position: 'absolute', pointerEvents: 'none', left: -padding, top: -padding, width: width + padding * 2, height: height + padding * 2 }} />
}
