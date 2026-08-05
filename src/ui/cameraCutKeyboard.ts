// SPDX-License-Identifier: Apache-2.0

export type CameraCutDeleteKey = 'Delete' | 'Backspace'

export function isCameraCutDeleteKey(
  key: string,
): key is CameraCutDeleteKey {
  return key === 'Delete' || key === 'Backspace'
}

export interface CameraCutDeleteKeyGuard {
  /**
   * Claims a Delete/Backspace press that belongs to a focused camera-cut
   * marker. The claim survives the marker being removed until keyup.
   */
  claim(key: string): boolean
  /**
   * Returns true when this press belongs to a focused marker or is a repeat of
   * an already claimed press after that marker has unmounted.
   */
  shouldReserve(key: string, markerFocused: boolean): boolean
  release(key: string): void
  reset(): void
}

export function createCameraCutDeleteKeyGuard(): CameraCutDeleteKeyGuard {
  const claimedKeys = new Set<CameraCutDeleteKey>()

  return {
    claim(key) {
      if (!isCameraCutDeleteKey(key)) return false
      claimedKeys.add(key)
      return true
    },
    shouldReserve(key, markerFocused) {
      if (!isCameraCutDeleteKey(key)) return false
      if (markerFocused) claimedKeys.add(key)
      return markerFocused || claimedKeys.has(key)
    },
    release(key) {
      if (isCameraCutDeleteKey(key)) claimedKeys.delete(key)
    },
    reset() {
      claimedKeys.clear()
    },
  }
}

/**
 * One keyboard owns one held-key lifecycle. Both Timeline's capture listener
 * and the global shortcut listener share this guard so a held Delete cannot
 * retarget to the selected camera after its cut marker disappears.
 */
export const cameraCutDeleteKeyGuard =
  createCameraCutDeleteKeyGuard()
