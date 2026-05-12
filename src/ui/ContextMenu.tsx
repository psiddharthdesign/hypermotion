// SPDX-License-Identifier: Apache-2.0

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useUI, type ContextMenuItem } from '@/state/ui'

/**
 * Right-click popover.
 *
 * Lives as a single instance in the App shell, driven by UI state
 * (`contextMenu`). Any code path can `openContextMenu({ x, y, items })`
 * and get a consistent menu. Dismiss on: click outside, Escape, any
 * wheel/scroll event (feels natural — scrolling kills context), or
 * after running an action.
 *
 * The menu flips to stay inside the viewport — if the click is near
 * the right edge it opens leftward, near the bottom it opens upward.
 * Without this the menu gets cut off on small windows.
 */
export function ContextMenu() {
  const menu = useUI((s) => s.contextMenu)
  const close = useUI((s) => s.closeContextMenu)
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  // Flip logic runs after layout so we know the rendered menu size.
  useLayoutEffect(() => {
    if (!menu) {
      setPos(null)
      return
    }
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const pad = 4
    let left = menu.x
    let top = menu.y
    if (left + rect.width + pad > vw) left = Math.max(pad, vw - rect.width - pad)
    if (top + rect.height + pad > vh) top = Math.max(pad, vh - rect.height - pad)
    setPos({ left, top })
  }, [menu])

  // Dismissal — attach only while the menu is open.
  useEffect(() => {
    if (!menu) return
    const onPointerDown = (e: PointerEvent) => {
      const el = menuRef.current
      if (el && el.contains(e.target as Node)) return
      close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      }
    }
    const onScroll = () => close()
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('wheel', onScroll, { passive: true })
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', onScroll)
    }
  }, [menu, close])

  if (!menu) return null

  const runItem = (item: ContextMenuItem) => {
    if (item.disabled || item.kind === 'separator') return
    close()
    item.onClick?.()
  }

  return (
    <div
      ref={menuRef}
      role="menu"
      // Invisible until position is computed — prevents a one-frame
      // flash in the wrong spot when the menu flips at the edge.
      style={{
        position: 'fixed',
        left: pos?.left ?? menu.x,
        top: pos?.top ?? menu.y,
        visibility: pos ? 'visible' : 'hidden',
        zIndex: 1000,
      }}
      className="min-w-[180px] rounded-md border border-border bg-panel py-1 shadow-2xl"
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.items.map((item, i) => {
        if (item.kind === 'separator') {
          return (
            <div key={`sep-${i}`} className="my-1 h-px bg-border/70" />
          )
        }
        return (
          <button
            key={item.label ?? i}
            type="button"
            disabled={item.disabled}
            onClick={() => runItem(item)}
            className={[
              'flex w-full items-center justify-between gap-6 px-3 py-1 text-left text-[12px] transition-colors',
              item.disabled
                ? 'cursor-not-allowed text-text-dim'
                : item.danger
                  ? 'text-text-muted hover:bg-red-950/40 hover:text-red-300'
                  : 'text-text hover:bg-accent-soft hover:text-text',
            ].join(' ')}
          >
            <span>{item.label}</span>
            {item.shortcut ? (
              <span className="font-mono text-[10px] text-text-dim">
                {item.shortcut}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}