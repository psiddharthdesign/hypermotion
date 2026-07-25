// SPDX-License-Identifier: Apache-2.0

export interface GlobalPointerDragHandlers {
  /** Called on each pointer move for the active pointer. Marks the drag moved. */
  onMove: (event: PointerEvent) => void
  /** Called on pointer up, only if the pointer actually moved. */
  onCommit: () => void
  /** Called when the gesture is cancelled (pointercancel, blur, or Escape). */
  onCancel: () => void
  /** Called once when listeners are torn down, on both the commit and cancel paths. */
  onCleanup?: () => void
}

/**
 * Run a window-level pointer drag until pointer up, cancel, blur, or Escape.
 *
 * The SVG curve editors (trail profile, motion path) share this lifecycle:
 * they capture a single `pointerId`, then track moves globally so the drag
 * keeps following the cursor outside the small editor viewBox. Escape is
 * captured (`capture: true`) so it cancels the drag before the app-wide
 * shortcut handler can clear the scene selection mid-gesture.
 *
 * Returns the cancel function, which callers typically stash so an unmount or
 * an external interruption can abort an in-flight drag.
 */
export function startGlobalPointerDrag(
  pointerId: number,
  handlers: GlobalPointerDragHandlers,
): () => void {
  let moved = false

  const cleanup = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
    window.removeEventListener('blur', onCancel)
    window.removeEventListener('keydown', onKeyDown, true)
    handlers.onCleanup?.()
  }

  const onMove = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return
    event.preventDefault()
    moved = true
    handlers.onMove(event)
  }

  const onUp = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return
    cleanup()
    if (moved) handlers.onCommit()
  }

  const onCancel = (event?: PointerEvent | Event) => {
    if (event instanceof PointerEvent && event.pointerId !== pointerId) return
    cleanup()
    handlers.onCancel()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()
    onCancel()
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onCancel)
  window.addEventListener('blur', onCancel)
  window.addEventListener('keydown', onKeyDown, true)
  return onCancel
}
