// SPDX-License-Identifier: Apache-2.0

import type { NodeId } from '@/scene'
import { useToast } from '@/ui/toastStore'

/**
 * Shared result shape for the batch import helpers (images, media,
 * clipboard).
 *
 * Batch imports deliberately keep going when a single file fails — one
 * corrupt PNG in a ten-file drop shouldn't cost the user the other
 * nine. That decision only works if the failures still reach the user,
 * so every batch helper returns what it could NOT import alongside the
 * ids it created, and the caller surfaces them through the toast.
 */
export interface ImportFailure {
  name: string
  reason: string
}

export interface ImportOutcome {
  ids: NodeId[]
  failures: ImportFailure[]
}

export function toImportFailure(name: string, err: unknown): ImportFailure {
  return {
    name,
    reason: err instanceof Error ? err.message : String(err),
  }
}

/** Merge the outcomes of several batch helpers into one. */
export function mergeImportOutcomes(...outcomes: ImportOutcome[]): ImportOutcome {
  return {
    ids: outcomes.flatMap((outcome) => outcome.ids),
    failures: outcomes.flatMap((outcome) => outcome.failures),
  }
}

/** How many failed files we name individually before summarizing. */
const MAX_LISTED_FAILURES = 3

/**
 * Surface import failures on the app-wide toast. No-ops when nothing
 * failed, so callers can pipe every outcome through it unconditionally.
 */
export function reportImportFailures(outcome: ImportOutcome): void {
  const { failures } = outcome
  if (failures.length === 0) return

  const listed = failures
    .slice(0, MAX_LISTED_FAILURES)
    .map((failure) => `${failure.name} — ${failure.reason}`)
  const remaining = failures.length - listed.length
  if (remaining > 0) {
    listed.push(`…and ${remaining} more`)
  }

  const title =
    failures.length === 1
      ? `Couldn't import "${failures[0]!.name}"`
      : `Couldn't import ${failures.length} files`

  useToast.getState().show({
    tone: 'error',
    title: outcome.ids.length > 0 ? `${title} (the rest were added)` : title,
    description: listed.join('\n'),
  })
}

/**
 * Last-resort reporter for an import that blew up outside the per-file
 * loop (a rejected clipboard bridge call, a scene transaction that
 * threw). Those used to end up as an unhandled rejection in the
 * console, which reads to the user as "the drop did nothing".
 */
export function reportUnexpectedImportError(err: unknown): void {
  useToast.getState().show({
    tone: 'error',
    title: "Couldn't import the dropped files",
    description: err instanceof Error ? err.message : String(err),
  })
}
