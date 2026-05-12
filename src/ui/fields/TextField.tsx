// SPDX-License-Identifier: Apache-2.0

import { useEffect, useRef, useState } from 'react'

/**
 * Text input that commits on blur or Enter, cancels on Escape.
 *
 * Same "draft-while-focused" pattern as NumberField so the parent prop
 * can't stomp the cursor mid-type. Empty strings are allowed by
 * default; callers that require non-empty can pass `allowEmpty={false}`.
 */
export function TextField({
  value,
  onCommit,
  placeholder,
  allowEmpty = true,
  width = 'w-full',
}: {
  value: string
  onCommit: (next: string) => void
  placeholder?: string
  allowEmpty?: boolean
  width?: string
}) {
  const [draft, setDraft] = useState(value)
  const [focused, setFocused] = useState(false)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!focused) setDraft(value)
  }, [value, focused])

  const commit = () => {
    if (!allowEmpty && draft.trim() === '') {
      setDraft(value)
      return
    }
    if (draft !== value) onCommit(draft)
  }

  return (
    <input
      ref={ref}
      type="text"
      value={draft}
      placeholder={placeholder}
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
          setDraft(value)
          ref.current?.blur()
        }
      }}
      className={[
        width,
        'min-w-0 h-7 rounded-md bg-app-bg px-2 text-left text-[12px] text-text outline-none',
        'ring-1 ring-transparent transition-shadow',
        'hover:ring-border focus:ring-2 focus:ring-accent/45',
      ].join(' ')}
    />
  )
}