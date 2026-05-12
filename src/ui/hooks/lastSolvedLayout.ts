// SPDX-License-Identifier: Apache-2.0

import type { SolvedLayout } from '@/layout'

/**
 * Module-scope side channel for the most recent solved layout.
 *
 * Several pieces of UI need to look up a node's solved rect outside the
 * normal render loop — for example, when the Inspector toggles a node's
 * `position` from 'flow' to 'absolute', it needs the rect that the
 * layout engine just produced so the element doesn't visually snap to
 * (0, 0) of the parent.
 *
 * Plumbing the rect through React props would force every parent on the
 * way down to re-render whenever the layout changed, which is wasteful
 * for components (Inspector, ContextMenu actions) that only need to
 * read it on a discrete user action. A module-scope cache hits the same
 * data the renderer just used and stays in sync because Canvas pushes
 * after every solve.
 *
 * Read it from event handlers — never from render bodies, because there
 * is no React subscription. If a component needs to react to the rect,
 * use the `solved` prop on SelectionOverlay or thread `useLayout`
 * through React the normal way.
 */

let last: SolvedLayout | null = null

export function setLastSolvedLayout(s: SolvedLayout | null): void {
  last = s
}

export function getLastSolvedLayout(): SolvedLayout | null {
  return last
}