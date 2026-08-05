// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it, vi } from 'vitest'
import { startClipboardWrite } from '../src/clipboardWrite'

describe('startClipboardWrite', () => {
  it('starts both writes synchronously, with the activation-sensitive legacy path first', async () => {
    const calls: string[] = []
    const modernWrite = vi.fn(async () => {
      calls.push('modern')
    })
    const legacyWrite = vi.fn(() => {
      calls.push('legacy')
      return true
    })

    const attempt = startClipboardWrite(
      '{"format":"hyper-motion/figma"}',
      modernWrite,
      legacyWrite,
    )

    expect(calls).toEqual(['legacy', 'modern'])
    await expect(attempt.completion).resolves.toEqual({
      ok: true,
      method: 'modern',
    })
  })

  it('uses the legacy result only when the modern write rejects', async () => {
    const modernWrite = vi.fn(() => Promise.reject(new Error('blocked')))
    const legacyWrite = vi.fn(() => true)

    const attempt = startClipboardWrite('payload', modernWrite, legacyWrite)

    await expect(attempt.completion).resolves.toEqual({
      ok: true,
      method: 'legacy',
    })
  })

  it('reports failure when neither path accepts the payload', async () => {
    const attempt = startClipboardWrite('payload', undefined, () => false)

    const outcome = await attempt.completion
    expect(outcome.ok).toBe(false)
  })

  it('still starts the modern path when the legacy command throws', async () => {
    const modernWrite = vi.fn(async () => undefined)

    const attempt = startClipboardWrite(
      'payload',
      modernWrite,
      () => {
        throw new Error('legacy blocked')
      },
    )

    expect(modernWrite).toHaveBeenCalledWith('payload')
    await expect(attempt.completion).resolves.toEqual({
      ok: true,
      method: 'modern',
    })
  })

  it('passes the same payload to both clipboard paths', async () => {
    const modernWrite = vi.fn(async () => undefined)
    const legacyWrite = vi.fn(() => false)

    const attempt = startClipboardWrite(
      '{"format":"hyper-motion/figma"}',
      modernWrite,
      legacyWrite,
    )

    expect(legacyWrite).toHaveBeenCalledWith(
      '{"format":"hyper-motion/figma"}',
    )
    expect(modernWrite).toHaveBeenCalledWith(
      '{"format":"hyper-motion/figma"}',
    )
    await expect(attempt.completion).resolves.toMatchObject({ ok: true })
  })
})
