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
  const downloadRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    downloadRef.current?.focus()
  }, [])

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
                Download the plugin, then import its manifest in Figma Desktop.
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
              icon={<Download size={14} />}
              title="Download the plugin"
              action={
                <button
                  ref={downloadRef}
                  type="button"
                  onClick={openReleases}
                  className="mt-2 flex h-8 items-center justify-center gap-1.5 rounded-md bg-accent px-3 hm-type-body font-semibold uppercase text-white outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  <Download size={14} />
                  Download from releases
                </button>
              }
            >
              Download the <strong>Figma plugin ZIP</strong> from the latest
              Hyper Motion release, then unzip it.
            </SetupStep>
            <SetupStep
              number="2"
              icon={<FileJson size={14} />}
              title="Import manifest.json"
            >
              In Figma Desktop, choose{' '}
              <strong>
                Plugins → Development → Import new plugin from manifest…
              </strong>
              , then select <strong>manifest.json</strong> from the unzipped
              folder.
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
