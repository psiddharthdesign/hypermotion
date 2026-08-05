// SPDX-License-Identifier: Apache-2.0

export interface RenderWindowLeaseState {
  hasWindow: boolean
  windowDestroyed: boolean
  webContentsDestroyed: boolean
  lastActivityAt: number
  phase?: string
}

export function isRenderWindowLeaseStale(
  state: RenderWindowLeaseState,
  now: number,
  stallTimeoutMs: number,
  encodingTimeoutMs: number,
): boolean {
  if (
    !state.hasWindow ||
    state.windowDestroyed ||
    state.webContentsDestroyed
  ) {
    return true
  }
  const timeout =
    state.phase === 'encoding' ? encodingTimeoutMs : stallTimeoutMs
  return now - state.lastActivityAt >= timeout
}
