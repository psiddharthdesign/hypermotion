// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest'
import {
  isExportSingleFlightActive,
  runExportSingleFlight,
} from './singleFlight'

describe('export single-flight', () => {
  it('joins rapid duplicate starts without opening a second worker', async () => {
    let finish: (() => void) | undefined
    const start = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )

    const first = runExportSingleFlight(start)
    const second = runExportSingleFlight(start)

    expect(second).toBe(first)
    expect(start).toHaveBeenCalledOnce()
    expect(isExportSingleFlightActive()).toBe(true)

    finish?.()
    await first
    expect(isExportSingleFlightActive()).toBe(false)
  })

  it('releases the slot after failure so retry can start', async () => {
    await expect(
      runExportSingleFlight(async () => {
        throw new Error('worker failed')
      }),
    ).rejects.toThrow('worker failed')

    const retry = vi.fn(async () => {})
    await runExportSingleFlight(retry)
    expect(retry).toHaveBeenCalledOnce()
  })
})
