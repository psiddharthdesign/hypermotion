// SPDX-License-Identifier: Apache-2.0

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import {
  NucleoClipboardCheckIcon,
  NucleoCloseIcon,
  NucleoFileContentIcon,
  NucleoPlugIcon,
  NucleoWindowPointerIcon,
} from '@/ui/icons/NucleoUiIcons'

interface ManifestStatus {
  ok: boolean
  path: string
  exists: boolean
  message?: string
  version?: string
}

function isManifestStatus(value: unknown): value is ManifestStatus {
  if (!value || typeof value !== 'object') return false
  const status = value as Partial<ManifestStatus>
  return (
    typeof status.ok === 'boolean' &&
    typeof status.path === 'string' &&
    typeof status.exists === 'boolean'
  )
}

export function FigmaPluginSetupButton() {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Set up the Figma import plugin"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium text-text-muted hover:bg-panel-raised hover:text-text"
      >
        <NucleoPlugIcon size={16} />
        <span>Figma import</span>
      </button>
      {open && <FigmaPluginSetupModal onClose={close} />}
    </>
  )
}

function FigmaPluginSetupModal({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const [manifest, setManifest] = useState<ManifestStatus | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    closeRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', onKeyDown)

    let cancelled = false
    const prepareManifest = async () => {
      if (!window.hypermotion) {
        if (!cancelled) {
          setFeedback('Open this screen in the Hyper Motion desktop app.')
        }
        return
      }
      try {
        const result = await window.hypermotion.invoke(
          'figma-plugin:get-manifest-status',
        )
        if (!cancelled && isManifestStatus(result)) {
          setManifest(result)
          if (!result.ok) setFeedback(result.message ?? 'Plugin setup failed.')
        }
      } catch {
        if (!cancelled) setFeedback('Could not prepare the Figma plugin.')
      }
    }
    void prepareManifest()

    return () => {
      cancelled = true
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  const copyManifestPath = async () => {
    if (!manifest?.path) return
    try {
      const desktopClipboard = window.hypermotion?.clipboard
      if (desktopClipboard) {
        await desktopClipboard.writeText(manifest.path)
      } else {
        await navigator.clipboard.writeText(manifest.path)
      }
      setFeedback('Manifest path copied.')
    } catch {
      setFeedback('Could not copy the path. Select it manually below.')
    }
  }

  const revealManifest = async () => {
    if (!window.hypermotion) {
      setFeedback('Reveal is available in the Hyper Motion desktop app.')
      return
    }
    setBusy(true)
    try {
      const result = await window.hypermotion.invoke(
        'figma-plugin:reveal-manifest',
      )
      if (isManifestStatus(result)) {
        setManifest(result)
        setFeedback(
          result.exists
            ? result.ok
              ? 'Manifest revealed in Finder.'
              : 'The previous plugin copy was revealed. Restart Hyper Motion to retry the update.'
            : result.message ?? 'The plugin manifest is unavailable.',
        )
      } else {
        setFeedback('Could not reveal the plugin manifest.')
      }
    } catch {
      setFeedback('Could not reveal the plugin manifest.')
    } finally {
      setBusy(false)
    }
  }

  const ready = manifest?.exists === true

  return createPortal(
    <div
      data-hm-editor-ui="1"
      role="dialog"
      aria-modal="true"
      aria-labelledby="figma-plugin-setup-title"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 px-6 backdrop-blur-[2px]"
    >
      <div className="w-full max-w-[600px] overflow-hidden rounded-lg border border-border-strong bg-panel-raised shadow-2xl">
        <div className="flex items-start justify-between border-b border-border px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
              <NucleoPlugIcon size={18} />
            </div>
            <div className="min-w-0">
              <div className="mb-1 flex items-center gap-2">
                <h2
                  id="figma-plugin-setup-title"
                  className="text-[14px] font-semibold text-text"
                >
                  Connect Figma to Hyper Motion
                </h2>
                <span className="rounded border border-border bg-panel px-1.5 py-0.5 text-[9px] font-medium tracking-wider text-text-dim">
                  Bundled plugin
                </span>
              </div>
              <p className="max-w-[460px] text-[11px] leading-5 text-text-muted">
                No download, source code, or terminal is required. Hyper Motion
                keeps this local plugin updated inside your Application Support
                folder.
              </p>
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close Figma plugin instructions"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-text-muted outline-none hover:bg-panel hover:text-text focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <NucleoCloseIcon size={16} />
          </button>
        </div>

        <div className="px-5 py-5">
          <div className="mb-4 rounded-md border border-border bg-panel px-3 py-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-[10px] font-medium tracking-wider text-text-dim">
                Plugin manifest
              </span>
              <span
                className={[
                  'rounded px-1.5 py-0.5 text-[9px] font-medium tracking-wide',
                  ready
                    ? 'bg-[oklch(0.7_0.14_145/0.14)] text-[oklch(0.62_0.14_145)]'
                    : 'bg-panel-raised text-text-dim',
                ].join(' ')}
              >
                {manifest ? (ready ? 'Ready' : 'Needs attention') : 'Preparing…'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <code
                title={manifest?.path}
                className="min-w-0 flex-1 truncate rounded border border-border bg-app-bg px-2.5 py-2 text-[11px] normal-case text-text"
              >
                {manifest?.path ?? 'Preparing your local plugin…'}
              </code>
              <button
                type="button"
                disabled={!manifest?.path}
                onClick={() => void copyManifestPath()}
                className="h-8 shrink-0 rounded-md border border-border px-2.5 text-[10px] font-medium text-text-muted hover:bg-panel-raised hover:text-text disabled:opacity-40"
              >
                Copy path
              </button>
              <button
                type="button"
                disabled={busy || !ready}
                onClick={() => void revealManifest()}
                className="h-8 shrink-0 rounded-md bg-accent px-3 text-[10px] font-medium text-white shadow-sm hover:brightness-110 disabled:cursor-wait disabled:opacity-40"
              >
                {busy ? 'Revealing…' : 'Reveal manifest'}
              </button>
            </div>
            {feedback && (
              <p
                aria-live="polite"
                className="mt-2 text-[10px] normal-case text-text-muted"
              >
                {feedback}
              </p>
            )}
          </div>

          <ol className="grid gap-3">
            <SetupStep
              number="1"
              icon={<NucleoWindowPointerIcon />}
              title="Keep your Figma design file open"
            >
              Use the Figma desktop app and stay in the file you want to
              import from.
            </SetupStep>
            <SetupStep
              number="2"
              icon={<NucleoFileContentIcon />}
              title="Reveal the manifest from Hyper Motion"
            >
              Click <strong>Reveal manifest</strong> above. Hyper Motion opens
              the exact user-specific file; its path stays the same after app
              updates.
            </SetupStep>
            <SetupStep
              number="3"
              icon={<NucleoPlugIcon />}
              title="Import the local plugin once"
            >
              In Figma, choose <strong>Plugins → Development → Import new
              plugin from manifest…</strong>, then select the revealed{' '}
              <strong>manifest.json</strong>.
            </SetupStep>
            <SetupStep
              number="4"
              icon={<NucleoClipboardCheckIcon />}
              title="Copy your selection into Hyper Motion"
            >
              Select layers, run <strong>Plugins → Development → Hyper Motion
              Import</strong>, choose <strong>Copy to Hyper Motion</strong>,
              then paste here with <strong>⌘ V</strong>.
            </SetupStep>
          </ol>

          <p className="mt-4 text-[10px] leading-4 text-text-dim">
            Setup is required once. Future Hyper Motion updates refresh the
            same plugin folder automatically; Figma keeps it under Plugins →
            Development.
          </p>
        </div>

        <div className="flex justify-end border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-md border border-border px-4 text-[11px] font-medium text-text-muted hover:bg-panel hover:text-text"
          >
            Done
          </button>
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
}: {
  number: string
  icon: ReactNode
  title: string
  children: ReactNode
}) {
  return (
    <li className="grid grid-cols-[32px_1fr] gap-3">
      <div className="relative flex h-8 w-8 items-center justify-center rounded-md border border-border bg-panel text-text-muted">
        {icon}
        <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[8px] font-semibold text-white">
          {number}
        </span>
      </div>
      <div className="pt-0.5">
        <h3 className="text-[11px] font-medium text-text">{title}</h3>
        <p className="mt-0.5 text-[10px] leading-4 text-text-muted">
          {children}
        </p>
      </div>
    </li>
  )
}
