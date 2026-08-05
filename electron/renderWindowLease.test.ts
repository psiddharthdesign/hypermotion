// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { isRenderWindowLeaseStale } from './renderWindowLease'

const now = 1_000_000
const stall = 120_000
const encoding = 300_000

describe('render-window lease', () => {
  it('treats missing and destroyed workers as stale', () => {
    expect(
      isRenderWindowLeaseStale(
        {
          hasWindow: false,
          windowDestroyed: false,
          webContentsDestroyed: false,
          lastActivityAt: now,
        },
        now,
        stall,
        encoding,
      ),
    ).toBe(true)
    expect(
      isRenderWindowLeaseStale(
        {
          hasWindow: true,
          windowDestroyed: false,
          webContentsDestroyed: true,
          lastActivityAt: now,
        },
        now,
        stall,
        encoding,
      ),
    ).toBe(true)
  })

  it('keeps a healthy worker and expires a silent one', () => {
    expect(
      isRenderWindowLeaseStale(
        {
          hasWindow: true,
          windowDestroyed: false,
          webContentsDestroyed: false,
          lastActivityAt: now - stall + 1,
        },
        now,
        stall,
        encoding,
      ),
    ).toBe(false)
    expect(
      isRenderWindowLeaseStale(
        {
          hasWindow: true,
          windowDestroyed: false,
          webContentsDestroyed: false,
          lastActivityAt: now - stall,
        },
        now,
        stall,
        encoding,
      ),
    ).toBe(true)
  })

  it('allows the longer encoding tail timeout', () => {
    expect(
      isRenderWindowLeaseStale(
        {
          hasWindow: true,
          windowDestroyed: false,
          webContentsDestroyed: false,
          lastActivityAt: now - stall,
          phase: 'encoding',
        },
        now,
        stall,
        encoding,
      ),
    ).toBe(false)
  })
})
