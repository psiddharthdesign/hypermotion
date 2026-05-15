// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from 'react'

/**
 * A numeric input that commits on blur or Enter, cancels on Escape.
 *
 * The field keeps its own "draft" string while focused so the user can
 * type freely (including partial input like "-" or "1.") without the
 * parent's latest value stomping the cursor position mid-type. On commit
 * we parseFloat the draft and only call onCommit if it's a finite number
 * AND different from the current prop value.
 *
 * Selecting all on focus matches Figma / After Effects behavior — you
 * click a number and start typing a replacement, you don't have to
 * backspace your way through the old one.
 */
export function NumberField({
  value,
  onCommit,
  min,
  max,
  step = 1,
  suffix,
  width = 'w-16',
}: {
  value: number
  onCommit: (next: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
  /** Tailwind width class. Fields in tight rows can shrink. */
  width?: string
}) {
  const [draft, setDraft] = useState(() => formatNumber(value))
  const [focused, setFocused] = useState(false)
  const ref = useRef<HTMLInputElement>(null)

  // Keep the draft in sync with the prop when the user is not typing.
  useEffect(() => {
    if (!focused) setDraft(formatNumber(value))
  }, [value, focused])

  const commit = () => {
    const parsed = evaluateExpression(draft)
    if (parsed == null) {
      setDraft(formatNumber(value))
      return
    }
    const clamped = clamp(parsed, min, max)
    if (clamped !== value) onCommit(clamped)
    setDraft(formatNumber(clamped))
  }

  // Framer-style filled input: solid dark fill (bg-app-bg, slightly
  // darker than the inspector panel), no border, 6px radius, accent
  // ring on focus. The label wrapper owns the chrome; the inner input
  // is transparent so the suffix can sit alongside the digits without
  // overlap.
  return (
    <label
      className={[
        'inline-flex h-7 items-center rounded-md bg-app-bg',
        'ring-1 ring-transparent transition-shadow',
        'hover:ring-border focus-within:ring-2 focus-within:ring-accent/45',
        width,
      ].join(' ')}
    >
      <input
        ref={ref}
        type="text"
        inputMode="decimal"
        value={draft}
        step={step}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => {
          setFocused(true)
          e.currentTarget.select()
        }}
        onBlur={() => {
          setFocused(false)
          commit()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
            ref.current?.blur()
          } else if (e.key === 'Escape') {
            setDraft(formatNumber(value))
            ref.current?.blur()
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            const delta = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : step)
            // Resolve the draft (which may be an expression like
            // `100*2`) before nudging — so ArrowUp on "50+50" jumps
            // to "101" rather than discarding the math.
            const current = evaluateExpression(draft) ?? 0
            const next = clamp(current + delta, min, max)
            setDraft(formatNumber(next))
            onCommit(next)
          }
        }}
        className={[
          'min-w-0 flex-1 bg-transparent py-0.5 text-left',
          'text-[12px] tabular-nums text-text outline-none',
          // Keep horizontal padding so the caret never kisses the
          // wrapper's edge. Left-aligned values match Framer's
          // inspector — the eye catches the START of the value
          // first, which reads as "this is the answer to the label".
          'pl-2',
          suffix ? '' : 'pr-2',
        ].join(' ')}
      />
      {suffix ? (
        <span
          className="pointer-events-none shrink-0 select-none pr-2 pl-0.5 text-[11px] text-text-dim"
          aria-hidden="true"
        >
          {suffix}
        </span>
      ) : null}
    </label>
  )
}

function formatNumber(n: number): string {
  // Trim trailing zeros on fractional numbers, keep integers clean.
  if (Number.isInteger(n)) return String(n)
  return n.toFixed(2).replace(/\.?0+$/, '')
}

function clamp(n: number, min?: number, max?: number): number {
  if (min !== undefined && n < min) return min
  if (max !== undefined && n > max) return max
  return n
}

/**
 * Resolve a NumberField draft to a finite number.
 *
 * Accepts plain numbers AND arithmetic expressions — typing `100*2`,
 * `200-50`, `(300+60)/2`, or `1920/16*9` evaluates on commit. This is
 * the Figma / Sketch / Framer affordance: designers reach for math
 * in their inputs constantly and shouldn't have to break flow to
 * open a calculator.
 *
 * Safety: we restrict the expression to digits, decimals, whitespace,
 * parentheses, and the operators `+ - * / %`. Anything else fails the
 * regex and we return null — so even though we use `new Function` for
 * evaluation, no identifier reference (e.g. `process`, `globalThis`,
 * `window.localStorage`) can survive the gate.
 *
 * Returns null when the draft isn't a finite number or a safe
 * expression — the caller falls back to the previous value.
 */
function evaluateExpression(text: string): number | null {
  const trimmed = text.trim()
  if (trimmed === '') return null

  // Fast path: a plain numeric literal (handles negative, decimal,
  // leading `+`). Avoids the cost of `new Function` for the common
  // case where the user just typed digits.
  const direct = Number(trimmed)
  if (Number.isFinite(direct)) return direct

  // Whitelist: digits, the four operators, modulo, decimal point,
  // parens, whitespace. Reject everything else — no letters, no
  // function calls, no semicolons. The trailing `+` is mandatory in
  // the character class because `-` and `+` are valid operators.
  if (!/^[\d+\-*/%().\s]+$/.test(trimmed)) return null

  try {
    // `new Function` is acceptable here because the regex above has
    // already proven the body contains nothing identifier-like. Wrap
    // in `"use strict"` and parens so the parser treats the body as
    // an expression statement.
    // eslint-disable-next-line no-new-func
    const fn = new Function(`"use strict"; return (${trimmed})`) as () => unknown
    const result = fn()
    return typeof result === 'number' && Number.isFinite(result) ? result : null
  } catch {
    // Syntax error (e.g. unbalanced parens, trailing operator) — fall
    // back to "invalid input".
    return null
  }
}