// SPDX-License-Identifier: Apache-2.0

import { useRef, useState, type ReactNode } from 'react'
import {
  Circle,
  Frame,
  Hand,
  ImageIcon,
  MousePointer2,
  Sparkles,
  Square,
  Type,
  Video,
} from 'lucide-react'
import { useUI, type Tool } from '@/state/ui'
import { useSceneAPI } from '@/scene'
import {
  getPaperShaderDefinition,
  type PaperShaderType,
} from '@/scene/paperShaders'
import { importImageFiles } from '@/ui/importImage'
import { importMediaFiles } from '@/ui/importMedia'
import {
  reportImportFailures,
  reportUnexpectedImportError,
} from '@/ui/importResult'
import { PaperShaderPicker } from '@/ui/PaperShaderPicker'

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
  { id: 'select', shortcut: 'V', hint: 'Select', icon: <MousePointer2 size={18} /> },
  { id: 'hand', shortcut: 'H', hint: 'Hand (pan)', icon: <Hand size={18} /> },
  { id: 'frame', shortcut: 'F', hint: 'Frame', icon: <Frame size={18} /> },
  { id: 'rect', shortcut: 'R', hint: 'Rectangle', icon: <Square size={18} /> },
  { id: 'ellipse', shortcut: 'O', hint: 'Ellipse', icon: <Circle size={18} /> },
  { id: 'text', shortcut: 'T', hint: 'Text', icon: <Type size={18} /> },
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
  const [shaderPickerAnchor, setShaderPickerAnchor] =
    useState<HTMLButtonElement | null>(null)
  const onImageFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const rootId = api.getRoot()
    if (!rootId) return
    const outcome = await importImageFiles(files, api, rootId)
    if (outcome.ids.length > 0) {
      setSelection(outcome.ids)
      setTool('select')
    }
    reportImportFailures(outcome)
  }
  const onMediaFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const rootId = api.getRoot()
    if (!rootId) return
    const outcome = await importMediaFiles(files, api, rootId)
    if (outcome.ids.length > 0) {
      setSelection(outcome.ids)
      setTool('select')
    }
    reportImportFailures(outcome)
  }
  const insertPaperShader = (shaderType: PaperShaderType) => {
    const rootId = api.getRoot()
    if (!rootId) return
    const meta = api.getMeta()
    const definition = getPaperShaderDefinition(shaderType)
    const width = Math.min(640, Math.max(1, meta.canvas.width))
    const height = Math.min(360, Math.max(1, meta.canvas.height))
    const id = api.createNode('shader', rootId, {
      name: `Paper ${definition.label}`,
      position: 'absolute',
      size: { width, height },
      shaderType,
      colors: [...definition.defaults.colors],
      speed: definition.defaults.speed,
      scale: definition.defaults.scale,
      params: { ...definition.defaults.params },
      transform: {
        x: (meta.canvas.width - width) / 2,
        y: (meta.canvas.height - height) / 2,
        z: 0,
        rotation: 0,
        rotationX: 0,
        rotationY: 0,
        scaleX: 1,
        scaleY: 1,
      },
    })
    setSelection([id])
    setTool('select')
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

      {/* Generator and media group. */}
      <span aria-hidden className="mx-1 h-[22px] w-px bg-border" />
      <button
        type="button"
        title="Add Paper shader…"
        aria-expanded={Boolean(shaderPickerAnchor)}
        aria-haspopup="dialog"
        onClick={(event) => {
          const button = event.currentTarget
          setShaderPickerAnchor((current) => (current ? null : button))
        }}
        className={[
          'flex h-[34px] w-[34px] items-center justify-center rounded-lg transition-colors',
          shaderPickerAnchor
            ? 'bg-accent text-white shadow-sm'
            : 'text-text-muted hover:bg-white/[0.07] hover:text-text',
        ].join(' ')}
      >
        <Sparkles size={18} />
      </button>
      {shaderPickerAnchor ? (
        <PaperShaderPicker
          anchor={shaderPickerAnchor}
          onSelect={insertPaperShader}
          onClose={() => setShaderPickerAnchor(null)}
        />
      ) : null}
      <button
        type="button"
        title="Place image…"
        onClick={() => imageInputRef.current?.click()}
        className="flex h-[34px] w-[34px] items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-white/[0.07] hover:text-text"
      >
        <ImageIcon size={18} />
      </button>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          void onImageFiles(e.target.files).catch(reportUnexpectedImportError)
          e.target.value = ''
        }}
      />
      <button
        type="button"
        title="Place video or audio…"
        onClick={() => mediaInputRef.current?.click()}
        className="flex h-[34px] w-[34px] items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-white/[0.07] hover:text-text"
      >
        <Video size={18} />
      </button>
      <input
        ref={mediaInputRef}
        type="file"
        accept="video/*,audio/*,.mp4,.webm,.mov,.m4v,.ogv,.ogg,.mp3,.wav,.m4a,.aac,.flac,.oga,.opus"
        multiple
        hidden
        onChange={(e) => {
          void onMediaFiles(e.target.files).catch(reportUnexpectedImportError)
          e.target.value = ''
        }}
      />
    </div>
  )
}
