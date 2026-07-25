// SPDX-License-Identifier: Apache-2.0

import { beforeEach, describe, expect, it } from 'vitest'
import {
  mergeImportOutcomes,
  reportImportFailures,
  reportUnexpectedImportError,
  toImportFailure,
  type ImportOutcome,
} from '@/ui/importResult'
import { useToast } from '@/ui/toastStore'

const outcome = (
  ids: string[],
  failures: Array<[string, string]> = [],
): ImportOutcome => ({
  ids,
  failures: failures.map(([name, reason]) => ({ name, reason })),
})

describe('import failure reporting', () => {
  beforeEach(() => {
    useToast.getState().dismiss()
  })

  it('keeps ids and failures from every batch', () => {
    const merged = mergeImportOutcomes(
      outcome(['a'], [['bad.png', 'decode failed']]),
      outcome(['b', 'c']),
    )
    expect(merged.ids).toEqual(['a', 'b', 'c'])
    expect(merged.failures).toEqual([
      { name: 'bad.png', reason: 'decode failed' },
    ])
  })

  it('stays silent when every file imported', () => {
    reportImportFailures(outcome(['a', 'b']))
    expect(useToast.getState().toast).toBeNull()
  })

  it('names the single file that failed', () => {
    reportImportFailures(outcome([], [['bad.png', 'decode failed']]))
    const toast = useToast.getState().toast
    expect(toast?.tone).toBe('error')
    expect(toast?.title).toBe(`Couldn't import "bad.png"`)
    expect(toast?.description).toContain('decode failed')
  })

  it('says the rest went through on a partial failure', () => {
    reportImportFailures(outcome(['a'], [['bad.png', 'decode failed']]))
    expect(useToast.getState().toast?.title).toContain('the rest were added')
  })

  it('summarizes once past three failures', () => {
    reportImportFailures(
      outcome(
        [],
        [
          ['1.png', 'nope'],
          ['2.png', 'nope'],
          ['3.png', 'nope'],
          ['4.png', 'nope'],
          ['5.png', 'nope'],
        ],
      ),
    )
    const toast = useToast.getState().toast
    expect(toast?.title).toBe("Couldn't import 5 files")
    expect(toast?.description).toContain('…and 2 more')
    expect(toast?.description).not.toContain('4.png')
  })

  it('reports a non-Error rejection without losing its text', () => {
    reportUnexpectedImportError('clipboard bridge is gone')
    expect(useToast.getState().toast?.description).toBe(
      'clipboard bridge is gone',
    )
  })

  it('reads the message off a thrown Error', () => {
    expect(toImportFailure('a.mp4', new Error('unsupported codec'))).toEqual({
      name: 'a.mp4',
      reason: 'unsupported codec',
    })
  })
})
