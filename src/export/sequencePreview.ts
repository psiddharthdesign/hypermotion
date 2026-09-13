// SPDX-License-Identifier: Apache-2.0
import { create } from 'zustand'

/** Temporary selection used only while recording the live Master preview. */
export const useSequenceExportPreview = create<{ itemIds: string[] | undefined }>(() => ({
  itemIds: undefined,
}))
