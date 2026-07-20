// SPDX-License-Identifier: Apache-2.0

import { create } from 'zustand'

export type ToastTone = 'loading' | 'success' | 'error'

export interface ToastMessage {
  id: number
  tone: ToastTone
  title: string
  description?: string
  durationMs?: number
}

interface ToastState {
  toast: ToastMessage | null
  show: (message: Omit<ToastMessage, 'id'>) => void
  dismiss: () => void
}

let nextToastId = 1

export const useToast = create<ToastState>((set) => ({
  toast: null,
  show: (message) => set({ toast: { ...message, id: nextToastId++ } }),
  dismiss: () => set({ toast: null }),
}))
