// SPDX-License-Identifier: Apache-2.0

import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { useSceneAPI, useSceneVersion } from '@/scene'
import type { Node, NodeId, NodeKind } from '@/scene'
import type { SceneAPI } from '@/scene/doc'
import { useUI } from '@/state/ui'
import { buildNodeContextMenu } from '@/ui/contextMenuActions'
import { setLockedRecursive } from '@/ui/actions'
import { getLastSolvedLayout } from '@/ui/hooks/lastSolvedLayout'

/**
 * Layers panel.
 *
 * Step 3.6 polish: each row shows an eye and a lock toggle, names are
 * editable inline (double-click), and rows can be drag-reordered within
 * their parent's children array using native HTML5 drag-and-drop.
 *
 * Drag behavior:
 *   - You can drag any non-root row.
 *   - Drop target: three vertical zones on the target row.
 *       Top 25%    → drop as a sibling *above* the target
 *       Middle 50% → drop *into* the target as a new child, but only
 *                    when the target is a container (frame / component
 *                    / instance). Leaves like rect / text / image skip
 *                    the middle zone — dropping on them falls through
 *                    to above/below.
 *       Bottom 25% → drop as a sibling *below* the target
 *   - Drop across parents is allowed (reparents), but we guard against
 *     dropping into your own descendant (would create a cycle).
 *
 * Kept on native HTML5 DnD instead of @dnd-kit to avoid an install. The
 * tree is shallow in practice and native DnD is fine at this size.
 */
export function LayersPanel() {
  useSceneVersion()
  const api = useSceneAPI()
  const rootId = api.getRoot()
  const root = rootId ? api.getNode(rootId) : null
  const camera = api.getActiveCamera()
  const selection = useUI((s) => s.selection)
  const layersCollapsed = useUI((s) => s.layersCollapsed)
  const toggleLayerCollapsed = useUI((s) => s.toggleLayerCollapsed)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const width = useUI((s) => s.layersWidth)
  const setWidth = useUI((s) => s.setLayersWidth)

  // When the canvas (or any other surface) commits a new selection,
  // make sure the Layers panel reveals the row:
  //   1. Walk up the ancestors and uncollapse each one — without this,
  //      the row's <div> isn't even in the DOM if a parent group is
  //      collapsed.
  //   2. Find the row's element via data-layer-row attribute and
  //      scroll it into view.
  // Only fires when the LATEST id in selection changes. Ignores
  // multi-select churn (the panel already handles displaying multiple
  // highlighted rows via CSS).
  const lastSelectedRef = useRef<string | null>(null)
  useEffect(() => {
    const id = selection[selection.length - 1] ?? null
    if (!id) {
      lastSelectedRef.current = null
      return
    }
    if (lastSelectedRef.current === id) return
    lastSelectedRef.current = id
    // Uncollapse every ancestor so the row is rendered.
    let cur: string | null = id
    while (cur) {
      const node = api.getNode(cur)
      if (!node) break
      const parent: string | null = node.parent
      if (parent && layersCollapsed.has(parent)) {
        toggleLayerCollapsed(parent)
      }
      cur = parent
    }
    // Defer scroll until React has committed the (potentially
    // newly-uncollapsed) tree to the DOM.
    requestAnimationFrame(() => {
      const el = scrollerRef.current
      if (!el) return
      const row = el.querySelector(
        `[data-layer-row="${cssEscape(id)}"]`,
      ) as HTMLElement | null
      if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    })
  }, [selection, api, layersCollapsed, toggleLayerCollapsed])

  // Resize: pointer drag on the right edge writes the new width.
  // Pointer capture survives leaving the handle so the user can drag
  // off-element without the resize stopping mid-stride.
  const onResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    const startX = e.clientX
    const startWidth = width
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const onMove = (ev: PointerEvent) => {
      setWidth(startWidth + (ev.clientX - startX))
    }
    const onUp = (ev: PointerEvent) => {
      try {
        ;(e.currentTarget as HTMLElement).releasePointerCapture(ev.pointerId)
      } catch {
        /* already released */
      }
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  return (
    <aside
      className="relative flex shrink-0 flex-col border-r border-border bg-panel"
      style={{ width }}
    >
      <div className="flex h-9 shrink-0 items-center border-b border-border px-4">
        {/* Apple HIG: section headers are title-style, not uppercase. */}
        <span className="text-[11px] font-medium text-text-muted">
          Layers
        </span>
      </div>
      <div ref={scrollerRef} className="flex-1 overflow-auto py-2">
        {/* Camera sits above the artboard tree as its own section. It's a
            scene-level node (parent: null, not a child of root) so it
            would otherwise not appear in the walk. Surfacing it here
            makes it selectable and keyframeable via the same flow as
            any other layer — click to select, then edit in Inspector,
            or animate via the Animate tab. */}
        {camera ? <CameraRow node={camera} /> : null}
        {root ? (
          <Row node={root} depth={0} />
        ) : (
          <p className="px-3 py-4 text-text-dim">
            Empty scene.
            <br />
            <span className="text-[11px]">Press R to draw a rectangle.</span>
          </p>
        )}
      </div>
      {/* Right-edge drag handle. 4px wide, sits half-outside the panel
          so the handle hit area straddles the border line — easier to
          grab than a 1px border. */}
      <div
        onPointerDown={onResizeDown}
        title="Drag to resize"
        className="absolute right-0 top-0 z-10 h-full w-1 -translate-x-1/2 cursor-col-resize hover:bg-accent/50"
      />
    </aside>
  )
}

/**
 * Dedicated, trimmed-down row for the scene-level camera.
 *
 * Intentionally lighter than the general {@link Row}: no children to
 * expand, no drag-to-reparent (the camera isn't part of the tree), no
 * visibility toggle (a camera is always "there" — disabling it is a
 * future feature on CameraNode.enabled). Lock still applies though, so
 * users can freeze the camera while editing content around it.
 */
function CameraRow({ node }: { node: Node }) {
  const api = useSceneAPI()
  const selection = useUI((s) => s.selection)
  const setSelection = useUI((s) => s.setSelection)
  const toggleInSelection = useUI((s) => s.toggleInSelection)
  const openContextMenu = useUI((s) => s.openContextMenu)
  const selected = selection.includes(node.id)
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(node.name)

  const commitName = () => {
    const name = draftName.trim()
    if (name && name !== node.name) api.setNodeProperty(node.id, 'name', name)
    setEditing(false)
  }

  return (
    <div
      data-layer-row={node.id}
      onClick={(e) => {
        if (e.shiftKey || e.metaKey || e.ctrlKey) {
          toggleInSelection(node.id)
        } else {
          setSelection([node.id])
        }
      }}
      onDoubleClick={() => {
        setDraftName(node.name)
        setEditing(true)
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        const ids = selection.includes(node.id) ? selection : [node.id]
        if (!selection.includes(node.id)) setSelection([node.id])
        openContextMenu({
          x: e.clientX,
          y: e.clientY,
          items: buildNodeContextMenu(api, ids),
        })
      }}
      className={[
        'group flex h-6 shrink-0 cursor-default items-center gap-1.5 px-2 font-mono text-[11px]',
        selected
          ? 'bg-accent-soft text-text'
          : 'text-text-muted hover:bg-app-bg hover:text-text',
      ].join(' ')}
    >
      <KindGlyph node={node} />
      {editing ? (
        <input
          autoFocus
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitName()
            if (e.key === 'Escape') setEditing(false)
          }}
          className="min-w-0 flex-1 bg-transparent outline-none"
        />
      ) : (
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
      )}
      <LockToggle
        locked={node.locked}
        onClick={(e) => {
          e.stopPropagation()
          api.setNodeProperty(node.id, 'locked', !node.locked)
        }}
      />
    </div>
  )
}

/** Tiny lock indicator for the camera row. Kept inline since the main
 *  Row has its own version that operates recursively on children —
 *  cameras have no children, so the simpler form is enough here. */
function LockToggle({
  locked,
  onClick,
}: {
  locked: boolean
  onClick: (e: ReactMouseEvent) => void
}) {
  return (
    <button
      onClick={onClick}
      title={locked ? 'Unlock' : 'Lock'}
      className={[
        'flex h-4 w-4 items-center justify-center rounded text-[10px] transition-colors',
        locked
          ? 'text-text opacity-100'
          : 'text-text-dim opacity-0 hover:text-text group-hover:opacity-100',
      ].join(' ')}
    >
      {locked ? '◈' : '◇'}
    </button>
  )
}

function Row({ node, depth }: { node: Node; depth: number }) {
  const api = useSceneAPI()
  const selection = useUI((s) => s.selection)
  const toggleInSelection = useUI((s) => s.toggleInSelection)
  const setSelection = useUI((s) => s.setSelection)
  const extendSelectionTo = useUI((s) => s.extendSelectionTo)
  const openContextMenu = useUI((s) => s.openContextMenu)
  const collapsed = useUI((s) => s.layersCollapsed.has(node.id))
  const layersCollapsed = useUI((s) => s.layersCollapsed)
  const toggleLayerCollapsed = useUI((s) => s.toggleLayerCollapsed)
  const selected = selection.includes(node.id)
  const children = api.getChildren(node.id)
  const hasChildren = children.length > 0
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(node.name)
  const [dropEdge, setDropEdge] = useState<'above' | 'into' | 'below' | null>(
    null,
  )
  const isRoot = node.parent === null
  // Which nodes accept "drop into" as a new child. Frames and components
  // are the real containers. Instances technically expose children
  // through their component definition — dropping a foreign node inside
  // would break the instance contract, so we skip them too. Root is a
  // frame so it qualifies automatically.
  const isContainer = node.kind === 'frame' || node.kind === 'component'

  const commitName = () => {
    const name = draftName.trim()
    if (name && name !== node.name) {
      api.setNodeProperty(node.id, 'name', name)
    }
    setEditing(false)
  }

  const onDragStart = (e: DragEvent) => {
    if (isRoot) {
      e.preventDefault()
      return
    }
    e.dataTransfer.setData('text/hyper-motion-node', node.id)
    e.dataTransfer.effectAllowed = 'move'
  }

  const onDragOver = (e: DragEvent) => {
    const draggingId = e.dataTransfer.types.includes('text/hyper-motion-node')
    if (!draggingId) return
    e.preventDefault()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const y = e.clientY - rect.top
    const ratio = y / rect.height
    // Three zones on containers, two on leaves. Root has a special case:
    // it's the artboard and only accepts drop-into (siblings of root
    // don't exist).
    if (isRoot) {
      setDropEdge('into')
    } else if (isContainer) {
      if (ratio < 0.25) setDropEdge('above')
      else if (ratio > 0.75) setDropEdge('below')
      else setDropEdge('into')
    } else {
      setDropEdge(ratio < 0.5 ? 'above' : 'below')
    }
  }

  const onDragLeave = () => setDropEdge(null)

  const onDrop = (e: DragEvent) => {
    const srcId = e.dataTransfer.getData('text/hyper-motion-node')
    const edge = dropEdge
    setDropEdge(null)
    if (!srcId || srcId === node.id) return
    // Guard against cycles — can't drop a node into its own descendant.
    if (isDescendant(api, node.id, srcId)) return

    if (edge === 'into') {
      // Drop as a new child of this node. appendChild reparents and
      // positions at the end of the children array, which matches the
      // visual reading order (bottom = frontmost).
      reparentPreservingVisualPosition(api, srcId, node.id)
      return
    }

    // Sibling drop (above / below). For this path we need the target to
    // have a parent — root is handled above via 'into' only.
    if (!node.parent) return
    const parentId = node.parent
    const siblings = api.getChildren(parentId).map((c) => c.id)
    const targetIdx = siblings.indexOf(node.id)
    if (targetIdx < 0) return
    const insertIdx = edge === 'above' ? targetIdx : targetIdx + 1
    // appendChild reparents; then moveChild positions within new parent.
    reparentPreservingVisualPosition(api, srcId, parentId)
    // After appendChild, srcId is at the end of siblings. Re-query to
    // account for the fact that it may already have been in this parent.
    const nextSiblings = api.getChildren(parentId).map((c) => c.id)
    const clampedIdx = Math.min(insertIdx, nextSiblings.length - 1)
    api.moveChild(parentId, srcId, clampedIdx)
  }

  return (
    <>
      <div
        data-layer-row={node.id}
        draggable={!isRoot}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onContextMenu={(e) => {
          if (isRoot) return // nothing to offer on the artboard row
          e.preventDefault()
          e.stopPropagation()
          // Keep behavior parallel to the Canvas: right-clicking a row
          // not currently selected snaps selection to it, so the menu
          // actions always match what's highlighted.
          const targetIds = selection.includes(node.id) ? selection : [node.id]
          if (!selection.includes(node.id)) setSelection([node.id])
          openContextMenu({
            x: e.clientX,
            y: e.clientY,
            items: buildNodeContextMenu(api, targetIds),
          })
        }}
        onClick={(e) => {
          // Figma conventions:
          //   plain click   → replace selection with just this row
          //   meta/ctrl+clk → toggle this row in/out of the selection
          //   shift+click   → extend selection from anchor to this row
          //                    along the currently-visible layer order
          if (e.shiftKey) {
            const order = collectVisibleIds(api, layersCollapsed)
            // When the range spans both a parent and its children,
            // drop the children — selecting a parent implies its whole
            // subtree. This matches what users mean when they lasso
            // across nested layers: they want to operate on the
            // outermost layers, not on the parents *and* every leaf.
            extendSelectionTo(node.id, order, (ids) =>
              filterDescendants(api, ids),
            )
          } else if (e.metaKey || e.ctrlKey) {
            toggleInSelection(node.id, true)
          } else {
            setSelection([node.id])
          }
        }}
        onDoubleClick={() => {
          setDraftName(node.name)
          setEditing(true)
        }}
        className={[
          'group relative flex w-full items-center gap-1 py-1 pr-2 text-left text-[12px] transition-colors',
          selected
            ? 'bg-accent-soft text-text'
            : 'text-text-muted hover:bg-panel-raised hover:text-text',
          dropEdge === 'above' ? 'border-t-2 border-t-accent' : '',
          dropEdge === 'below' ? 'border-b-2 border-b-accent' : '',
          // "Drop into" highlight — outline the whole row so the user
          // can see the target frame about to swallow the dragged layer.
          // Inset ring so it doesn't push siblings around.
          dropEdge === 'into'
            ? 'ring-2 ring-inset ring-accent bg-accent-soft/40'
            : '',
        ].join(' ')}
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation()
              toggleLayerCollapsed(node.id)
            }}
            title={collapsed ? 'Expand' : 'Collapse'}
            className="flex h-3 w-3 shrink-0 items-center justify-center text-[9px] text-text-dim hover:text-text"
          >
            {collapsed ? '▸' : '▾'}
          </button>
        ) : (
          <span className="h-3 w-3 shrink-0" />
        )}
        <KindGlyph node={node} />
        {/* Mask indicator. Tiny accent moon glyph next to the kind
            icon, only present when the node has been flagged via
            Cmd+Opt+M. Hovering shows "Used as mask" so users who
            don't recognize the glyph still get the affordance. */}
        {node.isMask ? (
          <span
            title="Used as mask (Cmd+Opt+M to release)"
            className="flex h-3 w-3 shrink-0 items-center justify-center text-accent"
            aria-label="mask"
          >
            <MaskGlyph />
          </span>
        ) : null}
        {editing ? (
          <input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName()
              if (e.key === 'Escape') setEditing(false)
            }}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 bg-transparent text-[12px] text-text outline-none ring-1 ring-accent/60 rounded px-1"
          />
        ) : (
          <span className="flex-1 truncate">{node.name}</span>
        )}
        <IconToggle
          active={node.visible}
          onClick={(e) => {
            e.stopPropagation()
            api.setNodeProperty(node.id, 'visible', !node.visible)
          }}
          title={
            node.visible
              ? 'Hide layer (and its children)'
              : 'Show layer'
          }
        >
          {node.visible ? <EyeIcon /> : <EyeOffIcon />}
        </IconToggle>
        <IconToggle
          active={!node.locked}
          onClick={(e) => {
            e.stopPropagation()
            // Cascade to descendants. A lock on a container implies its
            // children are locked too — otherwise the lock is meaningless
            // (you could still drag the inner badge of a "locked" card).
            setLockedRecursive(api, node.id, !node.locked)
          }}
          title={node.locked ? 'Unlock (cascades to children)' : 'Lock (cascades to children)'}
        >
          {node.locked ? <LockClosedIcon /> : <LockOpenIcon />}
        </IconToggle>
      </div>
      {!collapsed &&
        children.map((c) => (
          <Row key={c.id} node={c} depth={depth + 1} />
        ))}
    </>
  )
}

function IconToggle({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean
  onClick: (e: React.MouseEvent) => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={[
        'flex h-4 w-4 items-center justify-center rounded text-[10px] transition-colors',
        active
          ? 'text-text-dim opacity-0 hover:text-text group-hover:opacity-100'
          : 'text-text opacity-100',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Row-action SVG icons (eye, lock). Inline because they're tiny and only
// used here. currentColor stroke so the IconToggle's text-* class drives
// the color naturally.
// ---------------------------------------------------------------------------

function eyeProps() {
  return {
    width: 12,
    height: 12,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.4,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
}

function EyeIcon() {
  return (
    <svg {...eyeProps()}>
      <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="1.8" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg {...eyeProps()}>
      <path d="M2 3l12 10" />
      <path d="M3.5 5.4C2.4 6.4 1.5 8 1.5 8s2.5 4.5 6.5 4.5c1 0 1.9-.2 2.7-.6" />
      <path d="M6.5 4.1c.5-.1 1-.1 1.5-.1 4 0 6.5 4 6.5 4s-.6 1.1-1.7 2.2" />
    </svg>
  )
}

function LockClosedIcon() {
  return (
    <svg {...eyeProps()}>
      <rect x="3" y="7" width="10" height="7" rx="1.2" />
      <path d="M5 7V5a3 3 0 016 0v2" />
    </svg>
  )
}

function LockOpenIcon() {
  return (
    <svg {...eyeProps()}>
      <rect x="3" y="7" width="10" height="7" rx="1.2" />
      <path d="M5 7V5a3 3 0 015.5-1.7" />
    </svg>
  )
}

/**
 * MaskGlyph — Figma uses a half-moon shape for "Used as mask". This
 * is two overlapping circles where the right one carves out of the
 * left, producing the canonical crescent. 10×10 to fit the row icon
 * size (h-3 w-3 = 12px container with a ~10px glyph inside).
 */
function MaskGlyph() {
  return (
    <svg
      width={10}
      height={10}
      viewBox="0 0 10 10"
      aria-hidden="true"
    >
      <circle cx="4" cy="5" r="3.5" fill="currentColor" />
      <circle cx="6" cy="5" r="3.5" fill="var(--color-panel)" />
    </svg>
  )
}

const GLYPHS: Record<NodeKind, string> = {
  frame: '▢',
  rect: '▪',
  ellipse: '●',
  text: 'T',
  image: '▧',
  component: '◆',
  instance: '◇',
  camera: '◉',
}

/**
 * Frames get a mode-aware glyph so the Layers panel reflects whether
 * a frame is plain, flex, or grid at a glance — without having to open
 * the Inspector to check. Matches Figma's "Auto layout" indicator
 * (four-arrow icon) and a new "Grid" indicator for our grid mode.
 *   ▢ — frame, mode='none'
 *   ⇆ — frame, mode='flex'
 *   ⊞ — frame, mode='grid'
 */
function glyphFor(node: Node): string {
  if (node.kind === 'frame') {
    if (node.layout.mode === 'flex') return '⇆'
    if (node.layout.mode === 'grid') return '⊞'
    return GLYPHS.frame
  }
  return GLYPHS[node.kind]
}

function KindGlyph({ node }: { node: Node }) {
  return (
    <span className="w-3 shrink-0 text-center font-mono text-[10px] text-text-dim">
      {glyphFor(node)}
    </span>
  )
}

/**
 * Walk the scene from root depth-first in sibling order, returning the
 * ids that are currently visible in the Layers panel. Collapsed
 * subtrees are skipped so Shift+click ranges only cover what the user
 * can actually see — matching Figma's behavior.
 */
/**
 * Escape an arbitrary string for use as a CSS attribute-selector value.
 * Our node ids are nanoid-style (letters/digits/_/-) so they're already
 * safe, but if id-generation ever changes or a custom id slips in we
 * don't want a runtime SecurityError to take out the panel.
 */
function cssEscape(s: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(s)
  }
  return s.replace(/["\\\]]/g, '\\$&')
}

function collectVisibleIds(
  api: ReturnType<typeof useSceneAPI>,
  collapsed: Set<string>,
): string[] {
  const rootId = api.getRoot()
  if (!rootId) return []
  const out: string[] = []
  const walk = (id: string) => {
    out.push(id)
    if (collapsed.has(id)) return
    for (const child of api.getChildren(id)) walk(child.id)
  }
  walk(rootId)
  return out
}

/**
 * Reparent `srcId` under `newParentId`, keeping the node visually in place.
 *
 * The naïve `api.appendChild(newParent, src)` on its own preserves the
 * node's `transform.x/y`, but `transform` is an OFFSET on top of the
 * parent-relative layout origin — so the meaning of those numbers
 * changes the moment the parent changes. A node at world (200, 150) as
 * a child of root, dropped into a frame at world (400, 300), would
 * otherwise appear at world (600, 450) — "inside" the frame in the
 * tree, but visually still rendered in its old spot (or worse, jumped
 * clear outside the frame's visible bounds). Users see "my text didn't
 * move inside the frame," exactly the bug report here.
 *
 * Behavior by new-parent layout mode:
 *
 *   - mode 'none' (default free-positioning): compensate transform.x/y
 *     so the node's world position stays put across the reparent. The
 *     node then visually sits wherever it was before, but as a child of
 *     the new frame. Subsequent drags / keyboard moves behave as the
 *     user expects. This is Figma's reparenting semantics.
 *
 *   - mode 'flex' or 'grid': the parent's solver will arrange the child
 *     into a slot. Keeping an arbitrary transform offset on top would
 *     visually detach the child from its Yoga-assigned slot (it'd look
 *     like auto-layout is broken). Reset transform.x/y to (0, 0) so the
 *     child sits exactly where flex places it. Matches what Figma does
 *     when you drop a layer into an Auto-layout frame.
 *
 * If we can't read the last solved layout (first-paint race, scene
 * hasn't solved yet), we fall back to a plain `appendChild` rather than
 * leaving the node in a wrong spot — the user can still drag-correct.
 */
function reparentPreservingVisualPosition(
  api: SceneAPI,
  srcId: NodeId,
  newParentId: NodeId,
): void {
  const src = api.getNode(srcId)
  if (!src) return
  const newParent = api.getNode(newParentId)
  if (!newParent) return

  // Flex / grid parents arrange children into slots — don't carry a
  // pixel offset across the swap. Resetting transform here keeps the
  // layout visually consistent with Auto-layout expectations.
  const newParentMode =
    'layout' in newParent ? newParent.layout.mode : 'none'
  if (newParentMode === 'flex' || newParentMode === 'grid') {
    api.appendChild(newParentId, srcId)
    api.setNodeProperty(srcId, 'transform', {
      ...src.transform,
      x: 0,
      y: 0,
    })
    return
  }

  // mode 'none' — preserve visual world position by shifting transform
  // to counteract the new parent's content origin.
  const solved = getLastSolvedLayout()
  const srcRect = solved?.[srcId]
  const newParentRect = solved?.[newParentId]

  if (!solved || !srcRect || !newParentRect) {
    api.appendChild(newParentId, srcId)
    return
  }

  // Old visual world position (ignoring rotation/scale — an approximation
  // that matches the rendered result for the common translate-only case).
  // srcRect.x/y is Yoga's placement of the child; transform.x/y is the
  // CSS translate composed on top by NodeView.
  const oldWorldX = srcRect.x + src.transform.x
  const oldWorldY = srcRect.y + src.transform.y

  // After appendChild under newParent with mode='none', Yoga will place
  // the child at positionType=absolute at (0, 0) of newParent's content
  // box — so the child's new layout origin is approximately
  // newParentRect.x / newParentRect.y (ignoring newParent's padding; an
  // acceptable approximation since the padding is the user-specified
  // interior space, and snapping INTO that space is reasonable).
  const newTransformX = oldWorldX - newParentRect.x
  const newTransformY = oldWorldY - newParentRect.y

  api.appendChild(newParentId, srcId)
  api.setNodeProperty(srcId, 'transform', {
    ...src.transform,
    x: newTransformX,
    y: newTransformY,
  })
}

/** True if `maybeAncestor` is an ancestor of `id` (including when equal). */
function isDescendant(
  api: ReturnType<typeof useSceneAPI>,
  id: string,
  maybeAncestor: string,
): boolean {
  if (id === maybeAncestor) return true
  let n = api.getNode(id)
  while (n && n.parent) {
    if (n.parent === maybeAncestor) return true
    n = api.getNode(n.parent)
  }
  return false
}

/**
 * Remove any id that has another id from the set as an ancestor. Used to
 * collapse a shift-click range into its roots — if you shift-selected
 * from "A" down through a bunch of its children to "B", and A contains
 * B, we keep only A. O(n²) ancestor walk; the selection is small.
 */
function filterDescendants(
  api: ReturnType<typeof useSceneAPI>,
  ids: string[],
): string[] {
  const set = new Set(ids)
  return ids.filter((id) => {
    let n = api.getNode(id)
    while (n && n.parent) {
      if (set.has(n.parent)) return false
      n = api.getNode(n.parent)
    }
    return true
  })
}