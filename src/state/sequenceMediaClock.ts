// SPDX-License-Identifier: Apache-2.0
import { create } from 'zustand'
import { useUI } from '@/state/ui'

/** Program occurrence speed; zero denotes a trailing freeze-frame hold. */
export const useSequenceMediaClock = create<{ rate: number }>(() => ({ rate: 1 }))

export function programMediaRate(): number {
  return useUI.getState().previewScope === 'sequence'
    ? useSequenceMediaClock.getState().rate
    : 1
}
