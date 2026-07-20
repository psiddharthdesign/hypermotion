// SPDX-License-Identifier: Apache-2.0

import { useEffect } from 'react'
import { useToast } from '@/ui/toastStore'

/** A single, app-wide status surface that stays clear of editor controls. */
export function ToastViewport() {
  const toast = useToast((state) => state.toast)
  const dismiss = useToast((state) => state.dismiss)

  useEffect(() => {
    if (!toast || toast.tone === 'loading') return
    const timeout = window.setTimeout(
      dismiss,
      toast.durationMs ?? (toast.tone === 'error' ? 6000 : 3200),
    )
    return () => window.clearTimeout(timeout)
  }, [dismiss, toast])

  if (!toast) return null

  const accent =
    toast.tone === 'success'
      ? 'bg-[oklch(0.72_0.17_150)]'
      : toast.tone === 'error'
        ? 'bg-[oklch(0.67_0.20_28)]'
        : 'bg-accent'

  return (
    <div
      role={toast.tone === 'error' ? 'alert' : 'status'}
      aria-live={toast.tone === 'error' ? 'assertive' : 'polite'}
      className="pointer-events-none fixed inset-x-0 bottom-6 z-[400] flex justify-center px-4"
    >
      <div className="pointer-events-auto flex max-w-[440px] items-start gap-3 rounded-lg border border-border-strong bg-panel-raised px-3.5 py-3 text-text shadow-2xl">
        <span
          aria-hidden
          className={`mt-1 h-2 w-2 shrink-0 rounded-full ${accent} ${
            toast.tone === 'loading' ? 'animate-pulse' : ''
          }`}
        />
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold leading-4">{toast.title}</div>
          {toast.description ? (
            <div className="mt-0.5 text-[11px] leading-4 text-text-muted">
              {toast.description}
            </div>
          ) : null}
        </div>
        {toast.tone !== 'loading' ? (
          <button
            type="button"
            onClick={dismiss}
            className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-text-muted hover:bg-panel hover:text-text"
          >
            Dismiss
          </button>
        ) : null}
      </div>
    </div>
  )
}
