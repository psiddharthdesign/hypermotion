// SPDX-License-Identifier: Apache-2.0

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import {
  ClipboardCheck,
  Download,
  FileJson,
  FolderOpen,
  Puzzle,
  X,
} from 'lucide-react'

const RELEASES_URL =
  'https://github.com/psiddharthdesign/hypermotion/releases/latest'

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

interface FigmaPluginStatus {
  ok: boolean
  path: string
  exists: boolean
  message?: string
  version?: string
}

export function FigmaPluginSetupButton() {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => {
    setOpen(false)
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }, [])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        title="Install the Figma import plugin"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium text-text-muted hover:bg-panel-raised hover:text-text"
      >
        <Puzzle size={15} />
        <span className="uppercase">Figma import</span>
      </button>
      {open && <FigmaPluginSetupModal onClose={close} />}
    </>
  )
}

function FigmaPluginSetupModal({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const primaryActionRef = useRef<HTMLButtonElement>(null)
  const isElectron = typeof window.hypermotion?.invoke === 'function'
  const [manifestStatus, setManifestStatus] = useState<FigmaPluginStatus | null>(
    null,
  )
  const [manifestBusy, setManifestBusy] = useState(isElectron)

  useEffect(() => {
    primaryActionRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!isElectron) return
    let cancelled = false
    void window.hypermotion
      ?.invoke('figma-plugin:get-manifest-status')
      .then((result) => {
        if (!cancelled && isFigmaPluginStatus(result)) {
          setManifestStatus(result)
        }
      })
      .finally(() => {
        if (!cancelled) setManifestBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [isElectron])

  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab') return

    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [],
    )
    if (focusable.length === 0) {
      event.preventDefault()
      dialogRef.current?.focus()
      return
    }

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    } else if (!focusable.includes(document.activeElement as HTMLElement)) {
      event.preventDefault()
      ;(event.shiftKey ? last : first).focus()
    }
  }

  const openReleases = () => {
    window.open(RELEASES_URL, '_blank', 'noopener,noreferrer')
  }

  const revealManifest = async () => {
    if (!window.hypermotion) return
    setManifestBusy(true)
    try {
      const result = await window.hypermotion.invoke(
        'figma-plugin:reveal-manifest',
      )
      if (isFigmaPluginStatus(result)) setManifestStatus(result)
    } finally {
      setManifestBusy(false)
    }
  }

  return createPortal(
    <div
      data-hm-editor-ui="1"
      data-hm-figma-plugin-modal="1"
      role="dialog"
      aria-modal="true"
      aria-labelledby="figma-plugin-setup-title"
      aria-describedby="figma-plugin-setup-description"
      tabIndex={-1}
      ref={dialogRef}
      onKeyDown={handleDialogKeyDown}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4 outline-none"
    >
      <div className="w-full max-w-[480px] overflow-hidden rounded-[10px] border border-border-strong bg-panel-raised uppercase shadow-[0_24px_70px_rgba(0,0,0,0.34)]">
        <header className="flex items-start justify-between gap-4 border-b border-border px-4 py-3.5">
          <div className="flex min-w-0 items-start gap-2.5">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-panel text-accent">
              <Puzzle size={15} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2
                  id="figma-plugin-setup-title"
                  className="hm-type-dialog-title font-semibold uppercase text-text"
                >
                  Figma import plugin
                </h2>
              </div>
              <p
                id="figma-plugin-setup-description"
                className="hm-type-support mt-0.5 text-text-muted"
              >
                Import this build's refreshed manifest in Figma Desktop.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Figma plugin setup"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted outline-none hover:bg-panel hover:text-text focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <X size={14} />
          </button>
        </header>

        <div className="grid min-w-0 gap-3 px-4 py-4">
          <ol className="grid gap-3">
            <SetupStep
              number="1"
              icon={isElectron ? <FolderOpen size={14} /> : <Download size={14} />}
              title={isElectron ? 'Reveal this build' : 'Download the plugin'}
              action={
                <button
                  ref={primaryActionRef}
                  type="button"
                  onClick={isElectron ? revealManifest : openReleases}
                  disabled={manifestBusy}
                  className="hm-primary-action mt-2 h-8 outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  {isElectron ? <FolderOpen size={14} /> : <Download size={14} />}
                  {isElectron
                    ? manifestBusy
                      ? 'Preparing plugin…'
                      : 'Reveal manifest.json'
                    : 'Download from releases'}
                </button>
              }
            >
              {isElectron ? (
                <>
                  Hyper Motion keeps the plugin at one stable path and refreshes
                  it whenever this app starts.
                  {manifestStatus?.message ? (
                    <span className="mt-1 block text-danger">
                      {manifestStatus.message}
                    </span>
                  ) : manifestStatus?.exists ? (
                    <span className="mt-1 block text-text-dim">
                      Current build ready{manifestStatus.version ? ` · v${manifestStatus.version}` : ''}.
                    </span>
                  ) : null}
                </>
              ) : (
                <>
                  Download the <strong>Figma plugin ZIP</strong> from the latest
                  Hyper Motion release, then unzip it.
                </>
              )}
            </SetupStep>
            <SetupStep
              number="2"
              icon={<FileJson size={14} />}
              title={isElectron ? 'Replace the old registration' : 'Import manifest.json'}
            >
              {isElectron && (
                <>
                  If Hyper Motion Import already appears under Development,
                  remove that old entry first. Then{' '}
                </>
              )}
              In Figma Desktop, choose{' '}
              <strong>
                Plugins → Development → Import new plugin from manifest…
              </strong>
              , then select the revealed <strong>manifest.json</strong>.
            </SetupStep>
            <SetupStep
              number="3"
              icon={<ClipboardCheck size={14} />}
              title="Copy into Hyper Motion"
            >
              Run <strong>Hyper Motion Import</strong>, choose{' '}
              <strong>Copy to Hyper Motion</strong>, return here, and press{' '}
              <strong>⌘V</strong>.
            </SetupStep>
          </ol>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function isFigmaPluginStatus(value: unknown): value is FigmaPluginStatus {
  if (!value || typeof value !== 'object') return false
  const status = value as Partial<FigmaPluginStatus>
  return (
    typeof status.ok === 'boolean' &&
    typeof status.path === 'string' &&
    typeof status.exists === 'boolean'
  )
}

function SetupStep({
  number,
  icon,
  title,
  children,
  action,
}: {
  number: string
  icon: ReactNode
  title: string
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <li className="grid grid-cols-[20px_24px_1fr] items-start gap-2">
      <span className="hm-type-micro pt-1 text-right tabular-nums text-text-dim">
        {number}
      </span>
      <span className="flex h-6 w-6 items-center justify-center rounded border border-border bg-panel text-text-muted">
        {icon}
      </span>
      <div className="min-w-0 pt-0.5">
        <h3 className="hm-type-body font-semibold uppercase text-text">{title}</h3>
        <p className="hm-type-support mt-0.5 text-text-muted">{children}</p>
        {action}
      </div>
    </li>
  )
}
