// SPDX-License-Identifier: Apache-2.0

import { useRef, useState } from 'react'
import { SquircleSurface } from './SquircleSurface'

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

  const commit = () => {
    if (!allowEmpty && draft.trim() === '') {
      setDraft(value)
      return
    }
    if (draft !== value) onCommit(draft)
  }

  return (
    <SquircleSurface
      as="label"
      radius={6}
      className={[
        width,
        'hm-control-surface hm-control-compact block min-w-0 h-7',
      ].join(' ')}
    >
      <input
        ref={ref}
        type="text"
        value={focused ? draft : value}
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
        className="h-full w-full min-w-0 bg-transparent px-3 text-left text-[12px] text-text outline-none"
      />
    </SquircleSurface>
  )
}
