// SPDX-License-Identifier: Apache-2.0

import type { NodeId } from '@/scene'

interface PaperShaderSource {
  canvas: HTMLCanvasElement
  host: HTMLElement
}

const PAPER_SHADER_SOURCE_EVENT = 'hypermotion:paper-shader-source'
export const PAPER_SHADER_PROCESSING_SELECTOR =
  '[data-paper-shader-processing]'
export const PAPER_SHADER_HOST_SELECTOR = '[data-paper-shader-host]'
const paperShaderSources = new Map<NodeId, PaperShaderSource>()

export interface PaperShaderStatusMount {
  /** The status wrapper always exists before its own layout effect runs. */
  measureElement: HTMLElement
  /** Prefer the stable shader host so Three's source ownership survives swaps. */
  publishElement: HTMLElement
}

export function resolvePaperShaderStatusMount(
  statusElement: HTMLElement | null,
  sharedHost: HTMLElement | null,
): PaperShaderStatusMount | null {
  if (!statusElement) return null
  return {
    measureElement: statusElement,
    publishElement:
      sharedHost ?? statusElement.parentElement ?? statusElement,
  }
}

export function getPaperShaderSourceCanvas(
  nodeId: NodeId,
): HTMLCanvasElement | null {
  return paperShaderSources.get(nodeId)?.canvas ?? null
}

export function paperShaderSourceEventName(): string {
  return PAPER_SHADER_SOURCE_EVENT
}

export function publishPaperShaderSource(
  nodeId: NodeId,
  host: HTMLElement,
): HTMLCanvasElement | null {
  const canvas = host.querySelector('canvas')
  if (!(canvas instanceof HTMLCanvasElement)) return null
  const previous = paperShaderSources.get(nodeId)
  paperShaderSources.set(nodeId, { canvas, host })
  if (previous?.canvas !== canvas) notifyPaperShaderSourceChanged()
  return canvas
}

export function paperShaderSourceBelongsTo(
  nodeId: NodeId,
  host: HTMLElement,
): boolean {
  return paperShaderSources.get(nodeId)?.host === host
}

export function removePaperShaderSource(
  nodeId: NodeId,
  host: HTMLElement,
): void {
  if (!paperShaderSourceBelongsTo(nodeId, host)) return
  paperShaderSources.delete(nodeId)
  notifyPaperShaderSourceChanged()
}

export function notifyPaperShaderSourceChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(PAPER_SHADER_SOURCE_EVENT))
}

export function paperShadersAreReady(
  root: ParentNode = document,
): boolean {
  if (root.querySelector(PAPER_SHADER_PROCESSING_SELECTOR)) return false
  return Array.from(root.querySelectorAll(PAPER_SHADER_HOST_SELECTOR)).every(
    (host) => host.querySelector('canvas') !== null,
  )
}

/**
 * Wait for Paper's async mask preprocessors to leave their local Suspense
 * fallbacks. Call after the render tree has mounted (the export window already
 * waits for initial animation frames before capture).
 *
 * Resolves `false` on timeout so callers can surface a useful export error
 * instead of hanging indefinitely on an invalid/CORS-blocked source.
 */
export function waitForPaperShadersReady(
  timeoutMs = 10_000,
  root: ParentNode = document,
): Promise<boolean> {
  if (paperShadersAreReady(root)) return Promise.resolve(true)

  return new Promise((resolve) => {
    let settled = false
    const finish = (ready: boolean) => {
      if (settled) return
      settled = true
      observer.disconnect()
      window.clearTimeout(timeout)
      resolve(ready)
    }
    const observer = new MutationObserver(() => {
      if (paperShadersAreReady(root)) finish(true)
    })
    observer.observe(root, { childList: true, subtree: true })
    const timeout = window.setTimeout(() => finish(false), timeoutMs)
  })
}
