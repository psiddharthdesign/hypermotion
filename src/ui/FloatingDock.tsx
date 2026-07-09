// SPDX-License-Identifier: Apache-2.0

import { useRef, type ReactNode } from 'react'
import { useUI, type Tool } from '@/state/ui'
import { useSceneAPI } from '@/scene'
import { importImageFiles } from '@/ui/importImage'
import { importMediaFiles } from '@/ui/importMedia'

/**
 * FloatingDock — the tool palette as a floating pill at the bottom of
 * the canvas zone.
 *
 * Positioning: absolute, bottom: 16px, horizontally centered. Mounted
 * INSIDE the Canvas component so it's contained in the workspace. The
 * canvas's `relative` wrapper is the positioning context, which means
 * the dock never bleeds into the Timeline below or the Inspector to
 * the side — it's a child of the canvas viewport.
 *
 * Voice: Excalidraw / Figma's bottom toolbar / ElevenLabs Flows. Tools
 * group by purpose (Select+Hand, Frame+Rect+Ellipse+Text, Image), with
 * vertical hairline separators between groups. Active tool reads as a
 * filled accent (white-on-blue), not the soft chip — at this size the
 * filled state communicates "current mode" much more clearly.
 *
 * Shortcut letters live in a tiny mono badge at each button's
 * bottom-right corner — same affordance the old TopBar carried, just
 * scaled to dock proportions.
 */

const TOOLS: { id: Tool; shortcut: string; hint: string; icon: ReactNode }[] = [
  { id: 'select', shortcut: 'V', hint: 'Select', icon: <CursorIcon /> },
  { id: 'hand', shortcut: 'H', hint: 'Hand (pan)', icon: <HandIcon /> },
  { id: 'frame', shortcut: 'F', hint: 'Frame', icon: <FrameIcon /> },
  { id: 'rect', shortcut: 'R', hint: 'Rectangle', icon: <RectIcon /> },
  { id: 'ellipse', shortcut: 'O', hint: 'Ellipse', icon: <EllipseIcon /> },
  { id: 'text', shortcut: 'T', hint: 'Text', icon: <TextIcon /> },
]

// Dock groupings. Each entry is the index in TOOLS where that group
// starts; we render a vertical separator before every group except the
// first. Two cursor-y tools, then the four shape tools.
const GROUP_BOUNDARIES = [2]

export function FloatingDock() {
  const tool = useUI((s) => s.tool)
  const setTool = useUI((s) => s.setTool)
  const setSelection = useUI((s) => s.setSelection)
  const api = useSceneAPI()

  const imageInputRef = useRef<HTMLInputElement>(null)
  const mediaInputRef = useRef<HTMLInputElement>(null)
  const onImageFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const rootId = api.getRoot()
    if (!rootId) return
    const ids = await importImageFiles(files, api, rootId)
    if (ids.length > 0) {
      setSelection(ids)
      setTool('select')
    }
  }
  const onMediaFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const rootId = api.getRoot()
    if (!rootId) return
    const ids = await importMediaFiles(files, api, rootId)
    if (ids.length > 0) {
      setSelection(ids)
      setTool('select')
    }
  }

  return (
    <div
      // The dock excludes itself from `data-export-hide` because it's
      // already hidden by the body[data-export-recording] aside/header
      // rule indirectly — actually it's NOT hidden by that rule because
      // it lives inside <main>. Mark it explicitly so tab-capture
      // exports don't capture the dock floating over the artboard.
      data-export-hide="1"
      // pointer-events: auto so the dock receives clicks even though
      // the canvas's main has its own pointer handlers — the dock sits
      // ABOVE those via z-index and stops events from bubbling up to
      // the workspace background drag.
      onPointerDown={(e) => e.stopPropagation()}
      className={[
        'pointer-events-auto absolute bottom-4 left-1/2 z-20 -translate-x-1/2',
        'flex items-center gap-0.5 rounded-[13px] p-[5px]',
        // The 92% mix + heavy backdrop-blur gives the same "frosted
        // glass" feel as macOS native floaters (Spotlight, Control
        // Center). Soft inner highlight + drop shadow lift it off the
        // canvas without looking heavy.
        'border border-border-strong bg-panel-raised/95 backdrop-blur-xl',
        // Drop shadow lives in a CSS var so dark / light themes can
        // each carry their own tint and falloff. Dark = heavy two-
        // layer; light = three soft layers with cool tints — see
        // src/index.css.
        'shadow-[var(--shadow-dock)]',
      ].join(' ')}
    >
      {TOOLS.map((t, i) => {
        const renderSeparator = GROUP_BOUNDARIES.includes(i)
        const active = tool === t.id
        return (
          <span key={t.id} className="flex items-center">
            {renderSeparator && (
              <span
                aria-hidden
                className="mx-1 h-[22px] w-px bg-border"
              />
            )}
            <button
              type="button"
              title={`${t.hint} — ${t.shortcut}`}
              onClick={() => setTool(t.id)}
              className={[
                'group relative flex h-[34px] w-[34px] items-center justify-center rounded-lg transition-colors',
                active
                  ? 'bg-accent text-white shadow-sm'
                  : 'text-text-muted hover:bg-white/[0.07] hover:text-text',
              ].join(' ')}
            >
              {t.icon}
              <span
                className={[
                  'pointer-events-none absolute right-[3px] bottom-[2px] font-mono text-[8px] leading-none tabular-nums',
                  active ? 'text-white/70' : 'text-text-dim',
                ].join(' ')}
              >
                {t.shortcut}
              </span>
            </button>
          </span>
        )
      })}

      {/* Place-image group — separator + the image button. */}
      <span aria-hidden className="mx-1 h-[22px] w-px bg-border" />
      <button
        type="button"
        title="Place image…"
        onClick={() => imageInputRef.current?.click()}
        className="flex h-[34px] w-[34px] items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-white/[0.07] hover:text-text"
      >
        <ImageIcon />
      </button>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          void onImageFiles(e.target.files)
          e.target.value = ''
        }}
      />
      <button
        type="button"
        title="Place video or audio…"
        onClick={() => mediaInputRef.current?.click()}
        className="flex h-[34px] w-[34px] items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-white/[0.07] hover:text-text"
      >
        <VideoIcon />
      </button>
      <input
        ref={mediaInputRef}
        type="file"
        accept="video/*,audio/*,.mp4,.webm,.mov,.m4v,.ogv,.ogg,.mp3,.wav,.m4a,.aac,.flac,.oga,.opus"
        multiple
        hidden
        onChange={(e) => {
          void onMediaFiles(e.target.files)
          e.target.value = ''
        }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Icons — copied from TopBar (single file ownership, since the dock now
// owns these). Slightly larger viewBox-internal stroke sized for the
// 18×18 visual size so they don't look spindly at dock scale.
// ---------------------------------------------------------------------------

function svgProps() {
  return {
    width: 18,
    height: 18,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
}

function CursorIcon() {
  return (
    <svg {...svgProps()}>
      <path d="M3 2.5l7.5 11 1.7-4.4 4.4-1.7L3 2.5z" />
    </svg>
  )
}

function FrameIcon() {
  return (
    <svg {...svgProps()}>
      <path d="M5 1.5v13M11 1.5v13M1.5 5h13M1.5 11h13" />
    </svg>
  )
}

function RectIcon() {
  return (
    <svg {...svgProps()}>
      <rect x="2.5" y="3.5" width="11" height="9" rx="1" />
    </svg>
  )
}

function EllipseIcon() {
  return (
    <svg {...svgProps()}>
      <ellipse cx="8" cy="8" rx="5.5" ry="4.5" />
    </svg>
  )
}

function TextIcon() {
  return (
    <svg {...svgProps()}>
      <path d="M3 4V3h10v1M8 3v10M5.5 13h5" />
    </svg>
  )
}

function HandIcon() {
  return (
    <svg {...svgProps()}>
      <path d="M5.5 8V3.5a1 1 0 112 0V8M7.5 8V2.5a1 1 0 112 0V8M9.5 8V3.5a1 1 0 112 0V9M11.5 9V5.5a1 1 0 112 0V11.5c0 2.2-1.8 3-3.5 3h-2c-1 0-1.7-.4-2.3-1L3 10c-.6-.7-.3-1.6.5-1.6.4 0 .8.2 1 .5L5.5 10" />
    </svg>
  )
}

function ImageIcon() {
  return (
    <svg {...svgProps()}>
      <rect x="2" y="3" width="12" height="10" rx="1" />
      <circle cx="6" cy="6.5" r="1" />
      <path d="M2.5 11.5l3-3 2.5 2.5 2-2 3.5 3.5" />
    </svg>
  )
}

function VideoIcon() {
  return (
    <svg {...svgProps()}>
      <rect x="2" y="3.5" width="9" height="9" rx="1" />
      <path d="M11 6.2l3-1.7v7l-3-1.7z" />
      <path d="M5.5 6.3v3.4L8.4 8z" fill="currentColor" stroke="none" />
    </svg>
  )
}
