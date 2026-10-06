// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from 'vitest'
import { getExportFormat } from './formats'
import { useExportProgress } from './progressStore'

const mp4 = getExportFormat('mp4')

function store() {
  return useExportProgress.getState()
}

afterEach(() => {
  vi.unstubAllGlobals()
  useExportProgress.setState({
    phase: 'idle',
    format: null,
    frame: 0,
    totalFrames: 0,
    error: null,
    blobUrl: null,
    fileName: null,
    cancelToken: 0,
    etaMs: 0,
    msPerFrame: 0,
  })
})

describe('export progress store', () => {
  it('starts idle with nothing in flight', () => {
    expect(store()).toMatchObject({
      phase: 'idle',
      format: null,
      frame: 0,
      totalFrames: 0,
      error: null,
      blobUrl: null,
      fileName: null,
      cancelToken: 0,
    })
  })

  it('start() enters the rendering phase and clears the previous run', () => {
    useExportProgress.setState({ error: 'boom', blobUrl: 'blob:old', etaMs: 900, msPerFrame: 30 })
    store().start(mp4, 120, 'hero.mp4')
    expect(store()).toMatchObject({
      phase: 'rendering',
      format: mp4,
      frame: 0,
      totalFrames: 120,
      fileName: 'hero.mp4',
      error: null,
      blobUrl: null,
      etaMs: 0,
      msPerFrame: 0,
    })
  })

  it('tracks per-frame progress and the ETA estimate', () => {
    store().start(mp4, 120, 'hero.mp4')
    store().setFrame(48)
    store().setEta(2_400, 50)
    expect(store()).toMatchObject({ frame: 48, etaMs: 2_400, msPerFrame: 50 })
    store().setPhase('encoding')
    expect(store().phase).toBe('encoding')
  })

  it('setDone() completes the frame counter and drops the ETA', () => {
    store().start(mp4, 120, 'hero.mp4')
    store().setFrame(60)
    store().setEta(1_000, 20)
    store().setDone('blob:hero')
    expect(store()).toMatchObject({
      phase: 'done',
      blobUrl: 'blob:hero',
      frame: 120,
      etaMs: 0,
    })
  })

  it('setError() records the message without discarding the frame count', () => {
    store().start(mp4, 120, 'hero.mp4')
    store().setFrame(7)
    store().setError('encoder died')
    expect(store()).toMatchObject({ phase: 'error', error: 'encoder died', frame: 7 })
  })

  it('requestCancel() bumps the token the orchestrator polls', () => {
    store().start(mp4, 120, 'hero.mp4')
    store().requestCancel()
    expect(store()).toMatchObject({ phase: 'cancelled', cancelToken: 1 })
    store().requestCancel()
    expect(store().cancelToken).toBe(2)
  })

  it('reset() revokes the output url and restores the initial state', () => {
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { revokeObjectURL })
    store().start(mp4, 120, 'hero.mp4')
    store().setDone('blob:hero')
    store().reset()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:hero')
    expect(store()).toMatchObject({
      phase: 'idle',
      format: null,
      frame: 0,
      totalFrames: 0,
      blobUrl: null,
      fileName: null,
    })
  })

  it('reset() survives a revoke that throws and clears the cancel token', () => {
    vi.stubGlobal('URL', {
      revokeObjectURL: () => {
        throw new Error('detached')
      },
    })
    store().start(mp4, 120, 'hero.mp4')
    store().setDone('blob:hero')
    store().requestCancel()
    expect(() => store().reset()).not.toThrow()
    expect(store()).toMatchObject({ phase: 'idle', blobUrl: null, cancelToken: 0 })
  })
})
