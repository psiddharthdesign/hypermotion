import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Aperture, Blend, Film, Sun, Circle, Maximize2, Minus, X } from 'lucide-react'
import { useEffectWindow } from './useEffectWindow'

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
  const windowControls = useEffectWindow(open, trigger, panel, 'inspector-left')
  const Icon = icons[kind]
  const setMinimized = windowControls.setMinimized
  const close = useCallback(() => {
    setMinimized(false)
    onClose()
  }, [onClose, setMinimized])
  useEffect(() => {
    if (!open) return
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); close(); trigger.current?.focus() }
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [open, close])
  return <>
    <button ref={trigger} type="button" aria-expanded={open} aria-label={`Edit ${label}`}
      onClick={() => open ? close() : onOpen()}
      className={`flex min-h-9 w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-[11px] transition-colors ${open ? 'border-accent bg-accent/10 text-text' : 'border-border bg-panel hover:border-border-strong text-text'}`}>
      <Icon size={16} strokeWidth={1.5} /> <span className="flex-1">{label}</span>
      {enabled ? <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-label="Enabled" /> : null}
    </button>
    {open ? createPortal(
      <div ref={panel} role="dialog" aria-label={`${label} settings`} data-properties-inspector="1" data-camera-inspector="1"
        className="fixed z-[80] flex w-80 flex-col overflow-hidden rounded-2xl border border-border bg-panel text-text shadow-xl"
        style={{ maxWidth: 'calc(100vw - 24px)' }}>
        <div className="flex shrink-0 touch-none cursor-grab items-center gap-2 border-b border-border px-4 py-3 text-[11px] font-semibold active:cursor-grabbing"
          onPointerDown={windowControls.onPointerDown} onPointerMove={windowControls.onPointerMove} onPointerUp={windowControls.onPointerUp}>
          <Icon size={16} strokeWidth={1.5} /><span className="flex-1">{label}</span>
          <button type="button" aria-label={windowControls.minimized ? `Restore ${label} settings` : `Minimize ${label} settings`}
            onClick={() => windowControls.setMinimized(value => !value)} className="rounded p-1 text-text-muted hover:bg-control">
            {windowControls.minimized ? <Maximize2 size={13} /> : <Minus size={14} />}
          </button>
          <button type="button" aria-label={`Close ${label} settings`} onClick={close} className="rounded p-1 text-text-muted hover:bg-control"><X size={14} /></button>
        </div>
        {!windowControls.minimized && <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <label className="flex items-center justify-between text-[11px] text-text-muted">
            Enable {label.toLowerCase()}
            <input type="checkbox" aria-label={`Enable ${label.toLowerCase()}`} checked={enabled} onChange={event => onEnabledChange(event.target.checked)} className="h-3.5 w-3.5 accent-accent" />
          </label>
          {children}
        </div>}
      </div>, document.body
    ) : null}
  </>
}
