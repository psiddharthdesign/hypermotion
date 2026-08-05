// SPDX-License-Identifier: Apache-2.0

import { FIGMA_PAYLOAD_FORMAT } from '@/import/figma/types'

export interface InternalWorkspaceClipboardState {
  textAnimations: boolean
  keyframes: boolean
  layers: boolean
}

export type InternalWorkspaceClipboardKind =
  | 'text-animations'
  | 'keyframes'
  | 'layers'

export const INTERNAL_WORKSPACE_CLIPBOARD_FORMAT = 'hyper-motion/internal'

export type WorkspacePasteResult =
  | 'figma'
  | 'files'
  | 'text-animations'
  | 'keyframes'
  | 'layers'
  | 'none'

interface WorkspacePasteActions {
  readExternalText: () => Promise<string>
  importExternalFiles: () => Promise<boolean>
  pasteFigma: (text: string) => void
  pasteTextAnimations: () => boolean
  pasteKeyframes: () => boolean
  pasteLayers: () => boolean
  onExternalError?: (source: 'text' | 'files', error: unknown) => void
}

export function hasInternalWorkspaceClipboard(
  state: InternalWorkspaceClipboardState,
): boolean {
  return state.textAnimations || state.keyframes || state.layers
}

export function isFigmaClipboardText(text: string): boolean {
  return text.includes(FIGMA_PAYLOAD_FORMAT)
}

export function createInternalWorkspaceClipboardMarker(
  kind: InternalWorkspaceClipboardKind,
): string {
  return JSON.stringify({
    format: INTERNAL_WORKSPACE_CLIPBOARD_FORMAT,
    version: 1,
    kind,
  })
}

/**
 * Route an intercepted workspace paste.
 *
 * The system clipboard is newer than Hyper Motion's module-scoped clipboard,
 * so an external Figma payload must win over cached text animations,
 * keyframes, and layers. The internal order remains unchanged when the system
 * clipboard contains something else.
 */
export async function routeWorkspacePaste(
  actions: WorkspacePasteActions,
): Promise<WorkspacePasteResult> {
  let externalText = ''
  try {
    externalText = await actions.readExternalText()
  } catch (error) {
    actions.onExternalError?.('text', error)
  }

  if (isFigmaClipboardText(externalText)) {
    actions.pasteFigma(externalText)
    return 'figma'
  }

  try {
    if (await actions.importExternalFiles()) return 'files'
  } catch (error) {
    actions.onExternalError?.('files', error)
  }

  if (actions.pasteTextAnimations()) return 'text-animations'
  if (actions.pasteKeyframes()) return 'keyframes'
  if (actions.pasteLayers()) return 'layers'
  return 'none'
}
