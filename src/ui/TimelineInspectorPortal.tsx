// SPDX-License-Identifier: Apache-2.0

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const TIMELINE_PROPERTIES_SELECTOR = '[data-timeline-properties-slot]'

/**
 * Keeps Timeline-owned controls in the right Properties panel without moving
 * their edit state out of Timeline. The Inspector can be hidden and restored,
 * so a small observer reconnects the portal whenever its stable slot returns.
 */
export function TimelineInspectorPortal({
  children,
}: {
  children: ReactNode
}) {
  const [target, setTarget] = useState<Element | null>(null)

  useEffect(() => {
    const resolveTarget = () => {
      const next = document.querySelector(TIMELINE_PROPERTIES_SELECTOR)
      setTarget((current) => (current === next ? current : next))
    }

    resolveTarget()
    const observer = new MutationObserver(resolveTarget)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  return target ? createPortal(children, target) : null
}
