import { useCallback, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'

type Point = { left: number; top: number }
type Placement = 'inspector-left' | 'beside-trigger'

function clampPoint(point: Point, panel: HTMLElement | null): Point {
  const width = panel?.offsetWidth ?? 320
  const height = panel?.offsetHeight ?? 48
  return {
    left: Math.max(8, Math.min(point.left, window.innerWidth - width - 8)),
    top: Math.max(8, Math.min(point.top, window.innerHeight - height - 8)),
  }
}

function applyPoint(point: Point, panel: HTMLElement | null): Point {
  if (panel) panel.style.maxHeight = `${Math.max(80, window.innerHeight - point.top - 8)}px`
  const clamped = clampPoint(point, panel)
  if (panel) {
    panel.style.left = `${clamped.left}px`
    panel.style.top = `${clamped.top}px`
    panel.style.maxHeight = `${Math.max(80, window.innerHeight - clamped.top - 8)}px`
  }
  return clamped
}

/** Shared viewport positioning, drag, and minimize behavior for effect settings. */
export function useEffectWindow(
  open: boolean,
  trigger: RefObject<HTMLElement | null>,
  panel: RefObject<HTMLElement | null>,
  placement: Placement,
) {
  const [minimized, setMinimized] = useState(false)
  const position = useRef<Point>({ left: 8, top: 8 })
  const drag = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    if (!open) return
    const anchor = trigger.current?.getBoundingClientRect()
    const width = panel.current?.offsetWidth ?? 320
    let left = 8
    let top = 8
    if (anchor) {
      if (placement === 'inspector-left') {
        const sidebar = trigger.current?.closest('[data-inspector-root]')?.getBoundingClientRect()
        left = sidebar ? sidebar.left - width - 12 : anchor.left - width - 12
        top = sidebar?.top ?? anchor.top
      } else {
        left = anchor.left >= width + 20 ? anchor.left - width - 12 : anchor.right + 12
        top = anchor.top
      }
    }
    position.current = applyPoint({ left, top }, panel.current)
  }, [open, placement, trigger, panel])

  useLayoutEffect(() => {
    if (!open) return
    const keepInView = () => { position.current = applyPoint(position.current, panel.current) }
    const observer = panel.current ? new ResizeObserver(keepInView) : null
    if (panel.current && observer) observer.observe(panel.current)
    window.addEventListener('resize', keepInView)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', keepInView)
    }
  }, [open, panel])

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('button, input, select, textarea, a')) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, ...position.current }
  }, [])

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const active = drag.current
    if (!active || active.pointerId !== event.pointerId) return
    position.current = applyPoint({ left: active.left + event.clientX - active.x, top: active.top + event.clientY - active.y }, panel.current)
  }, [panel])

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }, [])

  return { minimized, setMinimized, onPointerDown, onPointerMove, onPointerUp }
}
