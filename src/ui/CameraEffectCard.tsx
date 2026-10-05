import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Aperture, Blend, Film, Sun, Circle, X } from 'lucide-react'

const icons = { depth: Aperture, chromatic: Blend, bloom: Sun, vignette: Circle, vhs: Film }

/** Camera effect settings stay beside the inspector so the canvas remains usable. */
export function CameraEffectCard({ label, kind, enabled, open, onOpen, onClose, onEnabledChange, children }: {
  label: string
  kind: keyof typeof icons
  enabled: boolean
  open: boolean
  onOpen: () => void
  onClose: () => void
  onEnabledChange: (enabled: boolean) => void
  children: ReactNode
}) {
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: 0, top: 16 })
  const Icon = icons[kind]
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const sidebar = trigger.current?.closest('[data-inspector-root]')?.getBoundingClientRect()
      if (sidebar) setPosition({ left: Math.max(12, sidebar.left - 332), top: Math.max(12, sidebar.top + 8) })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open])
  useEffect(() => {
    if (!open) return
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); trigger.current?.focus() }
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [open, onClose])
  return <>
    <button ref={trigger} type="button" aria-expanded={open} aria-label={`Edit ${label}`}
      onClick={() => open ? onClose() : onOpen()}
      className={`flex min-h-9 w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-[11px] transition-colors ${open ? 'border-accent bg-accent/10 text-text' : 'border-border bg-panel hover:border-border-strong text-text'}`}>
      <Icon size={16} strokeWidth={1.5} /> <span className="flex-1">{label}</span>
      {enabled ? <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-label="Enabled" /> : null}
    </button>
    {open ? createPortal(
      <div ref={panel} role="dialog" aria-label={`${label} settings`} data-properties-inspector="1" data-camera-inspector="1"
        className="fixed z-[80] flex w-80 flex-col overflow-hidden rounded-2xl border border-border bg-panel text-text shadow-xl"
        style={{ ...position, maxWidth: 'calc(100vw - 24px)', maxHeight: `calc(100vh - ${position.top + 12}px)` }}>
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3 text-[11px] font-semibold">
          <Icon size={16} strokeWidth={1.5} /><span className="flex-1">{label}</span>
          <button type="button" aria-label={`Close ${label} settings`} onClick={onClose} className="rounded p-1 text-text-muted hover:bg-control"><X size={14} /></button>
        </div>
        <div className="space-y-3 overflow-y-auto p-4">
          <label className="flex items-center justify-between text-[11px] text-text-muted">
            Enable {label.toLowerCase()}
            <input type="checkbox" aria-label={`Enable ${label.toLowerCase()}`} checked={enabled} onChange={event => onEnabledChange(event.target.checked)} className="h-3.5 w-3.5 accent-accent" />
          </label>
          {children}
        </div>
      </div>, document.body
    ) : null}
  </>
}
