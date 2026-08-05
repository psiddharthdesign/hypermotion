// SPDX-License-Identifier: Apache-2.0

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSceneAPI } from '@/scene'
import { useUI } from '@/state/ui'
import { NumberField } from '@/ui/fields'

/**
 * Multi-select rename modal.
 *
 * Modeled on Figma's "Rename N layers" dialog: pick an optional Match
 * substring, write a Rename-to template, and the dialog computes a
 * preview list of new names. Tokens in the template:
 *
 *   $&  →  the current name (or the matched portion of it, if Match
 *          is non-empty)
 *   ↑   →  ascending number (1, 2, 3 …, starting from `startFrom`)
 *   ↓   →  descending number — last item gets `startFrom`, going up
 *
 * If the user types a literal Rename-to and leaves Match empty, every
 * selected layer gets that exact name. If they fill both, only the
 * matched substring is replaced — useful for "Frame 1, Frame 2, Frame 3
 * → Card 1, Card 2, Card 3" style renames where the trailing index
 * needs to come along intact.
 *
 * The whole apply runs inside a single Y.Doc transaction so the renames
 * land as ONE undo step. Closing the dialog (Esc / Cancel / Done) resets
 * the form so a follow-up rename starts fresh.
 */
export function RenameDialog() {
  const open = useUI((s) => s.renameDialogOpen)
  const setOpen = useUI((s) => s.setRenameDialogOpen)
  const selection = useUI((s) => s.selection)
  const api = useSceneAPI()

  const [match, setMatch] = useState('')
  const [template, setTemplate] = useState('')
  const [startFrom, setStartFrom] = useState(1)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const close = useCallback(() => {
    setMatch('')
    setTemplate('')
    setStartFrom(1)
    setOpen(false)
  }, [setOpen])

  // Capture the names at open time. Selection ids are stable across
  // dialog use, but the names need to be live (the user might have just
  // edited one inline). Re-pull on every render — getNode is cheap.
  const targets = useMemo(() => {
    if (!open) return [] as Array<{ id: string; name: string }>
    return selection
      .map((id) => {
        const n = api.getNode(id)
        return n ? { id, name: n.name } : null
      })
      .filter((x): x is { id: string; name: string } => x !== null)
  }, [open, selection, api])

  const previews = useMemo(
    () => computePreviews({ targets, match, template, startFrom }),
    [targets, match, template, startFrom],
  )

  const apply = useCallback(() => {
    if (targets.length === 0) {
      close()
      return
    }
    api.doc.transact(() => {
      previews.forEach((p, i) => {
        const t = targets[i]
        if (!t) return
        if (p.newName !== t.name) {
          api.setNodeProperty(t.id, 'name', p.newName)
        }
      })
    })
    close()
  }, [api, close, previews, targets])

  // Focus the rename input after the dialog mounts. Form state is reset by
  // every close path, so reopening never inherits the previous operation.
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => renameInputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [open])

  // Esc closes; Enter applies.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      }
      if (e.key === 'Enter') {
        // Only apply when focus isn't in a control that handles Enter
        // itself — but our inputs all blur on Enter via their handlers,
        // so it's safe to fall through.
        const target = e.target as HTMLElement | null
        if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return
        e.preventDefault()
        apply()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [apply, close, open])

  if (!open) return null

  const insertToken = (token: string) => {
    const el = renameInputRef.current
    if (!el) {
      setTemplate(template + token)
      return
    }
    const start = el.selectionStart ?? template.length
    const end = el.selectionEnd ?? template.length
    const next = template.slice(0, start) + token + template.slice(end)
    setTemplate(next)
    // Restore caret after the inserted token on the next paint.
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + token.length
      el.setSelectionRange(pos, pos)
    })
  }

  return (
    <div
      // Backdrop captures clicks outside the dialog body to close.
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label={`Rename ${targets.length} layers`}
    >
      <div className="hm-dialog-surface w-[520px]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-[13px] font-medium text-text">
            Rename {targets.length} {targets.length === 1 ? 'layer' : 'layers'}
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="flex h-6 w-6 items-center justify-center rounded text-text-muted hover:bg-panel hover:text-text"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-3 px-4 py-4">
          {/* Preview list */}
          <div className="hm-support-label font-medium">
            Preview
          </div>
          <div className="flex max-h-40 min-h-[80px] flex-col gap-1 overflow-auto rounded border border-border bg-panel px-3 py-2 font-mono text-[12px] text-text">
            {previews.length === 0 ? (
              <span className="text-text-dim">Nothing to rename.</span>
            ) : (
              previews.map((p, i) => (
                <span
                  key={i}
                  className={
                    p.newName !== targets[i]?.name
                      ? 'text-text'
                      : 'text-text-dim'
                  }
                  title={
                    p.newName !== targets[i]?.name
                      ? `${targets[i]?.name} → ${p.newName}`
                      : 'unchanged'
                  }
                >
                  {p.newName}
                </span>
              ))
            )}
          </div>

          {/* Match input */}
          <label htmlFor="rename-match" className="self-center text-[12px] text-text-muted">
            Match (optional)
          </label>
          <input
            id="rename-match"
            type="text"
            value={match}
            onChange={(e) => setMatch(e.target.value)}
            placeholder="e.g. Frame"
            className="hm-control-surface h-8 px-3 text-[12px] text-text outline-none"
          />

          {/* Rename input */}
          <label htmlFor="rename-to" className="self-center text-[12px] text-text-muted">
            Rename to
          </label>
          <div className="flex flex-col gap-2">
            <input
              id="rename-to"
              ref={renameInputRef}
              type="text"
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              placeholder="Type a name, click chips to insert tokens"
              className="hm-control-surface h-8 px-3 text-[12px] text-text outline-none ring-1 ring-accent/50"
            />
            <div className="flex flex-wrap gap-1.5">
              <TokenChip
                label="Current name"
                onClick={() => insertToken('$&')}
                title="Insert the original name (or the matched portion if Match is set)"
              />
              <TokenChip
                label="Number ↑"
                onClick={() => insertToken('↑')}
                title="Insert an ascending number"
              />
              <TokenChip
                label="Number ↓"
                onClick={() => insertToken('↓')}
                title="Insert a descending number"
              />
            </div>
          </div>

          {/* Start ascending from */}
          <div />
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-text-muted">
              Start ascending from
            </span>
            <NumberField
              value={startFrom}
              onCommit={setStartFrom}
              step={1}
              ariaLabel="Start ascending from"
              width="w-20"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={close}
            className="hm-secondary-action"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={apply}
            className="hm-primary-action"
          >
            Rename
          </button>
        </div>
      </div>
    </div>
  )
}

function TokenChip({
  label,
  onClick,
  title,
}: {
  label: string
  onClick: () => void
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="hm-secondary-action min-h-7 px-2 font-medium"
    >
      {label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Preview computation — pure function, easy to unit-test later.
// ---------------------------------------------------------------------------

interface RenameTarget {
  id: string
  name: string
}

interface RenamePreview {
  newName: string
}

function computePreviews({
  targets,
  match,
  template,
  startFrom,
}: {
  targets: RenameTarget[]
  match: string
  template: string
  startFrom: number
}): RenamePreview[] {
  const total = targets.length
  return targets.map((t, i) => {
    const ascN = startFrom + i
    const descN = startFrom + (total - 1 - i)
    // Determine which portion of the original name gets replaced.
    // - Match empty → entire name is the "matched portion"; the new
    //   name is `template` (or original if template is empty).
    // - Match non-empty → find the literal substring in the name. If
    //   it doesn't match, leave the name alone (preview shows
    //   unchanged).
    let nameToken: string
    let prefix = ''
    let suffix = ''
    if (match.length > 0) {
      const idx = t.name.indexOf(match)
      if (idx === -1) {
        return { newName: t.name }
      }
      prefix = t.name.slice(0, idx)
      nameToken = t.name.slice(idx, idx + match.length)
      suffix = t.name.slice(idx + match.length)
    } else {
      nameToken = t.name
    }
    // If the user hasn't typed a template yet, fall back to the
    // original name so the preview list isn't a wall of empty strings.
    if (template.length === 0) {
      return { newName: t.name }
    }
    const replacement = template
      .replace(/\$&/g, nameToken)
      .replace(/↑/g, String(ascN))
      .replace(/↓/g, String(descN))
    return { newName: prefix + replacement + suffix }
  })
}
