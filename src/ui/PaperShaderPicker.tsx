// SPDX-License-Identifier: Apache-2.0

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { ImageIcon, Search, Sparkles } from 'lucide-react'
import {
  PAPER_SHADER_CATALOG,
  type PaperShaderCategory,
  type PaperShaderType,
} from '@/scene/paperShaders'

type CategoryFilter = 'all' | PaperShaderCategory

const CATEGORY_TABS: Array<{ id: CategoryFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'generated', label: 'Generated' },
  { id: 'image-filter', label: 'Image' },
  { id: 'shape', label: 'Shape' },
]

/**
 * The catalog deliberately uses static swatches. Rendering 29 live Paper
 * canvases in a menu would allocate 29 WebGL contexts just to browse, which
 * crosses the context budget of several browsers before a shader is inserted.
 */
const SHADER_SWATCHES: Record<PaperShaderType, string> = {
  'mesh-gradient':
    'radial-gradient(circle at 24% 24%, #e0eaff 0 12%, transparent 36%), radial-gradient(circle at 76% 62%, #f75092 0 12%, transparent 42%), #241d9a',
  'static-mesh-gradient':
    'conic-gradient(from 220deg at 60% 45%, #ffad0a, #6200ff, #e2a3ff, #ff99fd, #ffad0a)',
  'static-radial-gradient':
    'radial-gradient(circle at 66% 32%, #fff 0 4%, #00ffe1 22%, #00bbff 42%, #000 76%)',
  dithering:
    'repeating-radial-gradient(circle at 25% 25%, #00b2ff 0 1px, #000 1.5px 4px)',
  'grain-gradient':
    'radial-gradient(ellipse at 30% 70%, #7300ff 0, transparent 52%), radial-gradient(ellipse at 70% 25%, #00bfff 0, #000 65%)',
  'dot-orbit':
    'radial-gradient(circle at 20% 30%, #ffc96b 0 8%, transparent 9%), radial-gradient(circle at 64% 30%, #ff6200 0 8%, transparent 9%), radial-gradient(circle at 42% 70%, #ff2f00 0 8%, #1a0000 9%)',
  'dot-grid':
    'radial-gradient(circle, #fff 0 10%, transparent 11%) 0 0 / 10px 10px, #000',
  warp:
    'repeating-linear-gradient(112deg, #121212 0 12%, #9470ff 14% 23%, #121212 25% 36%, #8838ff 38% 48%)',
  spiral:
    'repeating-radial-gradient(circle at 50% 50%, #79d1ff 0 4%, #001429 5% 12%)',
  swirl:
    'conic-gradient(from 35deg at 52% 52%, #ffd1d1, #660000 24%, #ff8a8a 50%, #330000 76%, #ffd1d1)',
  waves:
    'repeating-linear-gradient(165deg, #ffbb00 0 7%, #000 8% 17%)',
  'neuro-noise':
    'radial-gradient(ellipse at 35% 50%, #fff 0 3%, #47a6ff 18%, #000 55%), radial-gradient(ellipse at 75% 35%, #47a6ff, #000 64%)',
  'perlin-noise':
    'radial-gradient(ellipse at 22% 65%, #fccff7 0 18%, transparent 45%), radial-gradient(ellipse at 78% 35%, #fccff7 0 12%, #632ad5 55%)',
  'simplex-noise':
    'radial-gradient(circle at 25% 28%, #ffd1e0 0 13%, transparent 30%), radial-gradient(circle at 72% 62%, #ffd36b 0 14%, transparent 34%), #4449cf',
  voronoi:
    'radial-gradient(circle at 25% 30%, #ff8247 0 17%, #2e0000 19% 23%, transparent 25%), radial-gradient(circle at 72% 62%, #ffe53d 0 20%, #2e0000 22% 26%, transparent 28%), #2e0000',
  'pulsing-border':
    'radial-gradient(ellipse at center, #000 0 48%, transparent 51%), conic-gradient(#0dc1fd, #d915ef, #ff3f2e, #0dc1fd)',
  metaballs:
    'radial-gradient(circle at 28% 54%, #6e33cc 0 19%, transparent 21%), radial-gradient(circle at 62% 35%, #ff5500 0 21%, transparent 23%), radial-gradient(circle at 76% 72%, #ffc800 0 14%, #000 16%)',
  'color-panels':
    'linear-gradient(70deg, #000 0 20%, #ff9d0099 21% 38%, #809bffaa 39% 58%, #6d2effaa 59% 76%, #000 78%)',
  'smoke-ring':
    'radial-gradient(circle at center, transparent 0 24%, #fff 28% 36%, #8ba4c655 46%, #000 66%)',
  'god-rays':
    'conic-gradient(from 210deg at 50% 100%, #000 0 14%, #6200ff 15% 22%, #fff 23% 25%, #33fff5 27% 31%, #000 33% 100%)',
  'paper-texture':
    'repeating-linear-gradient(8deg, #ffffff 0 2px, #c5ccd4 3px 4px, #9fadbc 5px 6px)',
  water:
    'radial-gradient(ellipse at 35% 40%, #fff 0 3%, transparent 13%), radial-gradient(ellipse at 68% 58%, #d9f7ff 0 4%, transparent 18%), #477d93',
  'fluted-glass':
    'repeating-linear-gradient(90deg, #dce7f1 0 4px, #8499ad 5px 7px, #eef6fb 8px 11px)',
  'image-dithering':
    'repeating-radial-gradient(circle at 25% 25%, #94ffaf 0 1px, #000c38 1.5px 4px)',
  'halftone-dots':
    'radial-gradient(circle, #2b2b2b 0 24%, transparent 26%) 0 0 / 9px 9px, #f2f1e8',
  'halftone-cmyk':
    'radial-gradient(circle at 35% 40%, #00b4ffaa 0 17%, transparent 19%), radial-gradient(circle at 58% 50%, #fc519faa 0 18%, transparent 20%), radial-gradient(circle at 48% 68%, #ffd800aa 0 17%, #fbfaf5 19%)',
  'liquid-metal':
    'conic-gradient(from 105deg at 45% 48%, #323238, #fff 18%, #68686f 33%, #fafafa 49%, #3f4046 66%, #aaa 82%, #323238)',
  'gem-smoke':
    'radial-gradient(circle at 40% 38%, #fff 0 5%, #dcecff 18%, transparent 45%), radial-gradient(circle at 66% 66%, #333 0 11%, #e7e6df 38%, #f0efea 70%)',
  heatmap:
    'linear-gradient(135deg, #11206a, #2f63e7 28%, #6bd7ff 44%, #ffe679 60%, #ff991e 76%, #ff4c00)',
}
export function PaperShaderPicker({
  anchor,
  value,
  onSelect,
  onClose,
}: {
  anchor: HTMLElement
  value?: PaperShaderType
  onSelect: (type: PaperShaderType) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(
    null,
  )
  const [category, setCategory] = useState<CategoryFilter>('all')
  const [query, setQuery] = useState('')

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return PAPER_SHADER_CATALOG.filter(
      (shader) =>
        (category === 'all' || shader.category === category) &&
        (!needle ||
          shader.label.toLowerCase().includes(needle) ||
          shader.type.includes(needle)),
    )
  }, [category, query])

  useLayoutEffect(() => {
    const popover = ref.current
    if (!popover) return
    const trigger = anchor.getBoundingClientRect()
    const rect = popover.getBoundingClientRect()
    const gap = 8
    const edge = 8
    let left = trigger.left + trigger.width / 2 - rect.width / 2
    left = Math.min(window.innerWidth - rect.width - edge, Math.max(edge, left))
    let top = trigger.top - rect.height - gap
    if (top < edge) top = Math.min(window.innerHeight - rect.height - edge, trigger.bottom + gap)
    setPosition({ left, top })
  }, [anchor, category, query])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (ref.current?.contains(target) || anchor.contains(target)) return
      onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [anchor, onClose])

  return createPortal(
    <div
      ref={ref}
      data-export-hide="1"
      role="dialog"
      aria-label="Paper shader catalog"
      style={{
        position: 'fixed',
        left: position?.left ?? -9999,
        top: position?.top ?? -9999,
        visibility: position ? 'visible' : 'hidden',
        width: 380,
        maxHeight: 'min(520px, calc(100vh - 16px))',
      }}
      className="z-[120] flex flex-col overflow-hidden rounded-xl border border-border-strong bg-panel-raised shadow-[var(--shadow-dock)]"
    >
      <div className="border-b border-border px-3 pb-2.5 pt-3">
        <div className="mb-2.5 flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent-soft text-accent">
            <Sparkles size={15} />
          </span>
          <div className="min-w-0">
            <div className="text-[12px] font-semibold text-text">Paper shaders</div>
            <div className="text-[10px] text-text-dim">29 timeline-ready effects</div>
          </div>
        </div>
        <label className="flex h-8 items-center gap-2 rounded-lg bg-app-bg px-2.5 ring-1 ring-border focus-within:ring-accent/50">
          <Search size={13} className="shrink-0 text-text-dim" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a shader"
            className="min-w-0 flex-1 bg-transparent text-[11px] text-text outline-none placeholder:text-text-dim"
          />
        </label>
        <div className="mt-2 flex gap-1" role="tablist" aria-label="Shader category">
          {CATEGORY_TABS.map((tab) => {
            const active = tab.id === category
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setCategory(tab.id)}
                className={[
                  'h-6 rounded-md px-2 text-[10px] font-medium transition-colors',
                  active
                    ? 'bg-accent text-white'
                    : 'text-text-muted hover:bg-white/[0.06] hover:text-text',
                ].join(' ')}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>

      <div
        role="listbox"
        aria-label="Available Paper shaders"
        className="grid min-h-0 grid-cols-2 gap-1.5 overflow-y-auto p-2"
      >
        {visible.map((shader) => {
          const selected = shader.type === value
          return (
            <button
              key={shader.type}
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => {
                onSelect(shader.type)
                onClose()
              }}
              className={[
                'group flex min-w-0 items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors',
                selected
                  ? 'border-accent bg-accent-soft/55'
                  : 'border-transparent hover:border-border hover:bg-white/[0.045]',
              ].join(' ')}
            >
              <span
                aria-hidden
                style={{ background: SHADER_SWATCHES[shader.type] }}
                className="h-9 w-9 shrink-0 rounded-md border border-white/10 shadow-inner"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] font-medium text-text">
                  {shader.label}
                </span>
                <span className="mt-0.5 flex items-center gap-1 text-[9px] text-text-dim">
                  {shader.acceptsImage ? <ImageIcon size={9} /> : <Sparkles size={9} />}
                  {shader.requiresImage
                    ? 'Image required'
                    : shader.acceptsImage
                      ? 'Image optional'
                      : 'Generated'}
                </span>
              </span>
            </button>
          )
        })}
        {visible.length === 0 ? (
          <div className="col-span-2 px-3 py-8 text-center text-[11px] text-text-dim">
            No shaders match “{query.trim()}”.
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}
