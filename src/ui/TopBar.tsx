// SPDX-License-Identifier: Apache-2.0

import { useUI, type PanelKey, type ThemePreference } from '@/state/ui'
import { useSceneAPI, useSceneVersion } from '@/scene'
import { ExportMenu } from '@/ui/ExportMenu'
import { ExportStatusPill } from '@/ui/ExportStatusPill'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Top bar — two-zone layout, Apple HIG / Linear voice.
 *
 *   +---------------------------------------------------------------+
 *   |  brand · filename · saved                          controls   |
 *   +---------------------------------------------------------------+
 *
 * LEFT zone — identity. Brand pill (project switcher placeholder),
 * filename breadcrumb (click to rename), save status with green dot.
 *
 * RIGHT zone — controls. Zoom (segmented control), theme toggle, panel
 * visibility popover, and the primary Export CTA in filled accent.
 *
 * Edit / Animate mode tabs live on the right Inspector sidebar (where
 * they're closer to the panel they actually control). Putting a mirror
 * in the top bar duplicated the affordance and made the bar feel
 * crowded — dropped on Siddharth's call.
 *
 * Tools deliberately moved OUT of the top bar to a `<FloatingDock />`
 * mounted inside <Canvas>. The canvas zone is the right place for
 * tools — they're an action you take ON the canvas, not on the
 * project — and the dock affords more comfortable hit areas (34px)
 * than a top-bar row (28px).
 */
export function TopBar() {
  const panels = useUI((s) => s.panels)
  const togglePanel = useUI((s) => s.togglePanel)
  const zoom = useUI((s) => s.view.zoom)
  const zoomAt = useUI((s) => s.zoomAt)
  const resetView = useUI((s) => s.resetView)
  const api = useSceneAPI()
  // Subscribe to scene version so the displayed project name re-renders
  // after `setMeta({ name })`. Without this, renaming the project
  // updates the Y.Doc but the breadcrumb shows stale text until some
  // other state change forces a rerender.
  useSceneVersion()
  const projectName = api.getMeta().name
  const currentFilePath = useUI((s) => s.currentFilePath)
  const lastSavedAt = useUI((s) => s.lastSavedAt)
  // Prefer the on-disk filename when the user has saved or opened a
  // `.hype` — that's what they care about. Fall back to the scene's
  // display name, then "Untitled" as a last resort. We strip the
  // `.hype` extension so the breadcrumb stays compact.
  const displayName = (() => {
    if (currentFilePath) {
      const base = currentFilePath.replace(/^.*[\\/]/, '')
      return base.replace(/\.hype$/i, '')
    }
    return projectName || 'Untitled'
  })()

  const centerZoom = (next: number) =>
    zoomAt(next, window.innerWidth / 2, window.innerHeight / 2)

  // Export popover anchor — captured from the trigger's bounding rect
  // when the user opens the menu, so ExportMenu can position itself
  // relative to where the user clicked. Null = closed.
  const exportBtnRef = useRef<HTMLButtonElement>(null)
  const [exportAnchor, setExportAnchor] = useState<DOMRect | null>(null)

  const renameProject = () => {
    const next = window.prompt('Project name', projectName)
    if (next != null && next.trim() !== '') {
      api.setMeta({ name: next.trim() })
    }
  }

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-panel/85 px-3 backdrop-blur-md">
      {/* ============================================================
          LEFT ZONE — identity
          ============================================================ */}
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          title="Workspace"
          className="flex h-8 items-center gap-2 rounded-md px-2 text-text hover:bg-panel-raised"
        >
          <span className="flex h-[18px] w-[18px] items-center justify-center rounded-[5px] bg-gradient-to-br from-accent to-[oklch(0.55_0.18_290)] text-white">
            <BrandGlyph />
          </span>
          <span className="text-[13px] font-semibold tracking-tight">
            Hyper Motion
          </span>
        </button>
        <span className="text-text-dim text-[12px]">/</span>
        <button
          type="button"
          onClick={renameProject}
          title="Click to rename"
          className="flex h-7 items-center gap-2 rounded-md px-2 text-[12px] text-text hover:bg-panel-raised"
        >
          <span className="font-medium">{displayName}</span>
        </button>
        <SaveStatus savedAt={lastSavedAt} />
      </div>

      {/* Spacer pushes the right cluster to the trailing edge. */}
      <div className="flex-1" />

      {/* ============================================================
          RIGHT ZONE — controls
          ============================================================ */}
      <div className="flex shrink-0 items-center gap-1">
        {/* Zoom — segmented control. Compact, single shape. */}
        <div className="flex h-[30px] items-center overflow-hidden rounded-md border border-border bg-panel-raised">
          <button
            title="Zoom out (Cmd −)"
            onClick={() => centerZoom(zoom / 1.25)}
            className="flex h-[28px] w-7 items-center justify-center text-text-muted hover:text-text"
          >
            −
          </button>
          <button
            title="Reset view (Cmd 0)"
            onClick={() => resetView()}
            className="flex h-[28px] min-w-[44px] items-center justify-center px-1 font-mono text-[10px] tabular-nums text-text-muted hover:text-text"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            title="Zoom in (Cmd +)"
            onClick={() => centerZoom(zoom * 1.25)}
            className="flex h-[28px] w-7 items-center justify-center text-text-muted hover:text-text"
          >
            +
          </button>
        </div>

        <span className="mx-1 h-4 w-px bg-border" />

        <ThemeToggle />
        <PanelTogglePopover panels={panels} togglePanel={togglePanel} />

        <span className="mx-1 h-4 w-px bg-border" />

        {/* Persistent export status pill — shows whenever an export is
            running (or just finished). Click to expand a popover with
            frame stats + cancel. Renders nothing when phase === 'idle'
            so it doesn't reserve space. Sits left of the Export CTA so
            users can glance from one to the other. */}
        <ExportStatusPill />

        <button
          ref={exportBtnRef}
          type="button"
          title="Export"
          aria-haspopup="menu"
          aria-expanded={exportAnchor !== null}
          onClick={() => {
            // Toggle: re-clicking the trigger while the menu is open
            // closes it, matching native menu behavior.
            if (exportAnchor) {
              setExportAnchor(null)
              return
            }
            const rect = exportBtnRef.current?.getBoundingClientRect()
            if (rect) setExportAnchor(rect)
          }}
          className="flex h-[30px] items-center rounded-md bg-accent px-3 text-[12px] font-medium text-white shadow-sm hover:brightness-110"
        >
          Export
        </button>
      </div>
      {exportAnchor && (
        <ExportMenu
          anchorRect={exportAnchor}
          onClose={() => setExportAnchor(null)}
        />
      )}
    </header>
  )
}

// ---------------------------------------------------------------------------
// Save status — green dot + muted text. Read-only for now; a future
// scene-saving plumbing pass can promote this to a live "saving / saved
// 12s ago" readout fed by Yjs persistence. For now it just communicates
// "your edits are persisted to IndexedDB" which is always true once the
// scene has loaded.
// ---------------------------------------------------------------------------

function SaveStatus({ savedAt }: { savedAt: number | null }) {
  // Re-render once a minute so "Saved 2m ago" advances to 3m without
  // a user action. 60s is the smallest granularity we display past
  // the "just now" window, so a higher tick rate wastes work.
  const [, tick] = useState(0)
  useEffect(() => {
    if (savedAt == null) return
    const id = setInterval(() => tick((n) => n + 1), 60_000)
    return () => clearInterval(id)
  }, [savedAt])

  const unsaved = savedAt == null
  return (
    <span
      className="ml-2 flex items-center gap-1.5 text-[11px] text-text-dim"
      title={
        savedAt == null
          ? 'Not yet saved to disk'
          : `Last saved ${new Date(savedAt).toLocaleString()}`
      }
    >
      <span
        aria-hidden
        className={[
          'block h-1.5 w-1.5 rounded-full',
          unsaved
            ? 'bg-[oklch(0.70_0.14_60)]' // amber-ish: needs attention
            : 'bg-[oklch(0.70_0.14_145)]', // green: safe
        ].join(' ')}
      />
      {unsaved ? 'Unsaved' : `Saved ${formatRelativeTime(savedAt)}`}
    </span>
  )
}

/**
 * Format an epoch-ms timestamp as a short relative phrase: "just now",
 * "12s ago", "5m ago", "2h ago", or "3d ago". Designed for the TopBar's
 * save indicator — tight horizontal budget, frequent re-evaluation. We
 * floor on the smaller side at each threshold so freshly-saved files
 * say "just now" rather than "0s ago".
 */
function formatRelativeTime(epochMs: number): string {
  const diff = Math.max(0, Date.now() - epochMs)
  if (diff < 5_000) return 'just now'
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

// ---------------------------------------------------------------------------
// Panel-toggle popover — collapses three text labels (Layers / Inspector
// / Timeline) into a single icon button that opens a popover with
// checkbox rows. Cuts ~3 slots off the right side of the bar without
// losing functionality.
// ---------------------------------------------------------------------------

function PanelTogglePopover({
  panels,
  togglePanel,
}: {
  panels: Record<PanelKey, boolean>
  togglePanel: (key: PanelKey) => void
}) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  // Anchor rect captured when the popover opens. Drives the portal's
  // fixed-position placement. The TopBar's backdrop-blur establishes a
  // containing block that clips absolute-positioned descendants — same
  // bug as the Export menu — so we render the popover in a portal and
  // place it via getBoundingClientRect on the button.
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  // Click-outside to close. Listener watches BOTH the trigger button
  // and the portaled popover; clicks inside either are kept.
  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node
      if (buttonRef.current?.contains(t)) return
      if (popoverRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Reposition the popover under the trigger after open. useLayoutEffect
  // so we measure before paint and the popover never flashes at (0,0).
  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const btn = buttonRef.current
    const pop = popoverRef.current
    if (!btn || !pop) return
    const btnRect = btn.getBoundingClientRect()
    const popRect = pop.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const pad = 6
    let left = btnRect.right - popRect.width
    let top = btnRect.bottom + 4
    if (left + popRect.width + pad > vw) left = vw - popRect.width - pad
    if (left < pad) left = pad
    if (top + popRect.height + pad > vh) {
      top = Math.max(pad, btnRect.top - popRect.height - 4)
    }
    setPos({ left, top })
  }, [open])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        title="Toggle panels"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        className={[
          'flex h-8 w-8 items-center justify-center rounded-md transition-colors',
          open
            ? 'bg-panel-raised text-text'
            : 'text-text-muted hover:bg-panel-raised hover:text-text',
        ].join(' ')}
      >
        <PanelsIcon />
      </button>
      {open &&
        createPortal(
          <div
            ref={popoverRef}
            role="menu"
            style={{
              position: 'fixed',
              left: pos?.left ?? -9999,
              top: pos?.top ?? -9999,
              visibility: pos ? 'visible' : 'hidden',
            }}
            className="z-[100] min-w-[180px] rounded-md border border-border bg-panel-raised p-1 shadow-lg backdrop-blur"
          >
          {(['layers', 'inspector', 'timeline'] as const).map((key) => (
            <button
              key={key}
              role="menuitemcheckbox"
              aria-checked={panels[key]}
              onClick={() => togglePanel(key)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-text hover:bg-panel"
            >
              <span
                className={[
                  'flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border',
                  panels[key]
                    ? 'border-accent bg-accent text-white'
                    : 'border-border bg-app-bg',
                ].join(' ')}
              >
                {panels[key] && <CheckGlyph />}
              </span>
              <span className="capitalize">{key}</span>
            </button>
          ))}
          </div>,
          document.body,
        )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Theme toggle — same three-state cycle (Dark → Light → System) the
// previous TopBar carried. Lives here so the right-zone cluster keeps
// it adjacent to the panel popover, both icon-only.
// ---------------------------------------------------------------------------

function ThemeToggle() {
  const theme = useUI((s) => s.theme)
  const setTheme = useUI((s) => s.setTheme)
  const next: Record<ThemePreference, ThemePreference> = {
    dark: 'light',
    light: 'system',
    system: 'dark',
  }
  const label =
    theme === 'dark'
      ? 'Theme: Dark (click for Light)'
      : theme === 'light'
        ? 'Theme: Light (click for System)'
        : 'Theme: System (click for Dark)'
  return (
    <button
      type="button"
      onClick={() => setTheme(next[theme])}
      title={label}
      aria-label={label}
      className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-panel-raised hover:text-text"
    >
      {theme === 'dark' ? (
        <MoonIcon />
      ) : theme === 'light' ? (
        <SunIcon />
      ) : (
        <SystemIcon />
      )}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Icon glyphs. 16×16 base, currentColor stroke, hand-drawn so they fit
// the rest of the app's icon language. Mode tabs use slightly smaller
// glyphs (12×12) so they sit centered next to text labels.
// ---------------------------------------------------------------------------

function svgProps(size = 16) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  } as const
}

function BrandGlyph() {
  return (
    <svg {...svgProps(10)} strokeWidth={1.8}>
      <path d="M3 12V4M3 4l5 8 5-8M13 4v8" />
    </svg>
  )
}

function PanelsIcon() {
  return (
    <svg {...svgProps()}>
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <path d="M6 2.5v11M10 2.5v11" />
    </svg>
  )
}

function CheckGlyph() {
  return (
    <svg width={9} height={9} viewBox="0 0 9 9" fill="none" aria-hidden>
      <path
        d="M2 4.5l1.7 1.7L7.2 2.7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg {...svgProps()}>
      <path d="M13.5 9.5A5.5 5.5 0 016.5 2.5a6 6 0 107 7z" />
    </svg>
  )
}

function SunIcon() {
  return (
    <svg {...svgProps()}>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
    </svg>
  )
}

function SystemIcon() {
  return (
    <svg {...svgProps()}>
      <rect x="2" y="3" width="12" height="9" rx="1" />
      <path d="M5.5 14.5h5M8 12.5v2" />
    </svg>
  )
}
