// SPDX-License-Identifier: Apache-2.0

import { getSvgPath } from 'figma-squircle'
import {
  createElement,
  useLayoutEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ComponentPropsWithoutRef,
  type ElementType,
  type ReactNode,
} from 'react'

type Size = { width: number; height: number }

type SquircleSurfaceProps<T extends ElementType> = {
  as?: T
  radius?: number
  smoothing?: number
  children: ReactNode
} & Omit<
  ComponentPropsWithoutRef<T>,
  'as' | 'children' | 'className' | 'style'
> & {
    className?: string
    style?: CSSProperties
  }

const pathCache = new Map<string, string>()
const resizeCallbacks = new WeakMap<Element, (size: Size) => void>()
let sharedResizeObserver: ResizeObserver | null = null

function observer(): ResizeObserver | null {
  if (typeof ResizeObserver === 'undefined') return null
  if (!sharedResizeObserver) {
    sharedResizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const callback = resizeCallbacks.get(entry.target)
        if (!callback) continue
        const box = entry.borderBoxSize?.[0]
        callback({
          width: box?.inlineSize ?? entry.contentRect.width,
          height: box?.blockSize ?? entry.contentRect.height,
        })
      }
    })
  }
  return sharedResizeObserver
}

function measuredSize(element: HTMLElement): Size {
  const rect = element.getBoundingClientRect()
  return { width: rect.width, height: rect.height }
}

function cachedPath(
  width: number,
  height: number,
  radius: number,
  smoothing: number,
): string {
  const safeWidth = Math.max(1, Math.round(width * 10) / 10)
  const safeHeight = Math.max(1, Math.round(height * 10) / 10)
  const safeRadius = Math.min(radius, safeWidth / 2, safeHeight / 2)
  const key = `${safeWidth}:${safeHeight}:${safeRadius}:${smoothing}`
  const cached = pathCache.get(key)
  if (cached) return cached
  const path = getSvgPath({
    width: safeWidth,
    height: safeHeight,
    cornerRadius: safeRadius,
    cornerSmoothing: smoothing,
    preserveSmoothing: true,
  })
  pathCache.set(key, path)
  return path
}

/**
 * Fixed editor-chrome geometry. This is deliberately not a property control:
 * it gives Inspector surfaces the continuous 60% corners defined by the
 * branding reference while preserving ordinary DOM semantics and focus.
 */
export function SquircleSurface<T extends ElementType = 'div'>({
  as,
  radius = 8,
  smoothing = 0.6,
  className = '',
  style,
  children,
  ...props
}: SquircleSurfaceProps<T>) {
  const [host, setHost] = useState<HTMLElement | null>(null)
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })

  useLayoutEffect(() => {
    const element = host
    if (!element) return
    const update = (next: Size) => {
      setSize((current) =>
        current.width === next.width && current.height === next.height
          ? current
          : next,
      )
    }
    update(measuredSize(element))
    const resizeObserver = observer()
    if (!resizeObserver) return
    resizeCallbacks.set(element, update)
    resizeObserver.observe(element)
    return () => {
      resizeObserver.unobserve(element)
      resizeCallbacks.delete(element)
    }
  }, [host])

  const path = useMemo(
    () =>
      size.width > 0 && size.height > 0
        ? cachedPath(size.width, size.height, radius, smoothing)
        : '',
    [radius, size.height, size.width, smoothing],
  )
  const squircleStyle: CSSProperties = path
    ? { ...style, clipPath: `path('${path}')` }
    : style ?? {}

  const Host = (as ?? 'div') as ElementType

  return createElement(
    Host,
    {
      ...props,
      ref: setHost,
      className: `hm-squircle-surface ${className}`.trim(),
      style: squircleStyle,
      'data-squircle-ready': path ? 'true' : 'false',
    },
    path
      ? createElement(
          'svg',
          {
            'aria-hidden': 'true',
            className: 'hm-squircle-surface-svg',
            viewBox: `0 0 ${size.width} ${size.height}`,
            preserveAspectRatio: 'none',
          },
          createElement('path', {
            className: 'hm-squircle-surface-shape',
            d: path,
            vectorEffect: 'non-scaling-stroke',
          }),
          createElement('path', {
            className: 'hm-squircle-surface-focus',
            d: path,
            vectorEffect: 'non-scaling-stroke',
          }),
        )
      : null,
    children,
  )
}
