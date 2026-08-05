// SPDX-License-Identifier: Apache-2.0

/**
 * Hyper Motion Import — UI iframe code.
 *
 * The plugin sandbox can't reach `navigator.clipboard`, so all clipboard
 * IO happens here. The sandbox's `code.ts` prepares the assembled JSON
 * payload as soon as the selection is available and posts it via
 * `figma.ui.postMessage`. The Copy button stays disabled until that payload
 * is ready, so clipboard IO can happen synchronously in the click handler.
 *
 * Clipboard activation — the long-standing bug:
 *
 *   Browsers grant `navigator.clipboard.writeText` only when there's a
 *   fresh user activation (the recent click). The old flow was:
 *
 *     click → postMessage(sandbox) → buildPayload (100ms–2s+) → reply →
 *     navigator.clipboard.writeText(reply)
 *
 *   By the time the reply landed, the activation window had expired
 *   and the browser rejected the write — surfacing as
 *   "Copy blocked by browser. Click again with the Figma window focused."
 *
 *   Promise-backed ClipboardItems are still rejected in browser-hosted
 *   Figma because the plugin iframe may not receive the host page's
 *   `clipboard-write` permission. The reliable flow is:
 *
 *     selection → buildPayload → reply → enable Copy → synchronous copy
 *
 *   `document.execCommand('copy')` is attempted first while the click still
 *   has user activation. The modern Clipboard API is started in the same
 *   click stack as well, because Figma can report a successful legacy copy
 *   without placing anything on the OS clipboard.
 *
 *   The classic `execCommand('copy')` path uses a hidden textarea and works
 *   in both Figma Desktop and browser-hosted plugin iframes. The modern API
 *   remains a fallback for hosts that explicitly grant clipboard access.
 *
 * The UI only needs to send `{ kind: 'close' }` if we add a Close affordance.
 */

import { startClipboardWrite } from './clipboardWrite'

const countEl = document.getElementById('count') as HTMLSpanElement
const copyBtn = document.getElementById('copy') as HTMLButtonElement
const statusEl = document.getElementById('status') as HTMLDivElement

function setStatus(text: string, kind: '' | 'success' | 'error' = ''): void {
  statusEl.textContent = text
  statusEl.className = 'status' + (kind ? ' ' + kind : '')
}

function effectCountFromPayload(text: string): number {
  try {
    const payload = JSON.parse(text) as {
      nodes?: Array<{ effects?: unknown[]; children?: unknown[] }>
    }
    let count = 0
    const walk = (node: { effects?: unknown[]; children?: unknown[] }) => {
      count += Array.isArray(node.effects) ? node.effects.length : 0
      if (!Array.isArray(node.children)) return
      for (const child of node.children) {
        if (child && typeof child === 'object') {
          walk(child as { effects?: unknown[]; children?: unknown[] })
        }
      }
    }
    for (const node of payload.nodes ?? []) walk(node)
    return count
  } catch {
    return 0
  }
}

let preparedPayload: string | null = null
let preparationStartedAt: number | null = null
let preparationTimer: number | null = null
let preparationProgress: {
  processedNodes: number
  totalNodes: number
  currentNode: string
} | null = null

copyBtn.addEventListener('click', () => {
  const text = preparedPayload
  if (!text) return

  copyBtn.disabled = true
  setStatus('Copying…')

  const clipboard = navigator.clipboard
  const attempt = startClipboardWrite(
    text,
    clipboard?.writeText
      ? (value) => clipboard.writeText(value)
      : undefined,
    copyViaExecCommand,
  )

  void attempt.completion.then((outcome) => {
    if (outcome.ok) {
      showCopiedStatus(text)
    } else {
      console.warn('[hyper-motion] clipboard write failed', outcome.error)
      showCopyError()
    }
    copyBtn.disabled = false
  })
})

window.addEventListener('message', (event: MessageEvent) => {
  const msg = (event.data as { pluginMessage?: PluginMessage }).pluginMessage
  if (!msg) return
  if (msg.kind === 'selection') {
    stopPreparationTimer()
    preparationProgress =
      msg.totalNodes > 0
        ? {
            processedNodes: 0,
            totalNodes: msg.totalNodes,
            currentNode: '',
          }
        : null
    preparedPayload = null
    const n = msg.count
    countEl.textContent =
      n === 0
        ? 'No selection'
        : n === 1
          ? '1 layer'
          : `${n} layers`
    copyBtn.disabled = true
    if (n === 0) {
      setStatus('')
    } else {
      startPreparationTimer()
    }
  }
  if (msg.kind === 'progress') {
    preparationProgress = {
      processedNodes: msg.processedNodes,
      totalNodes: msg.totalNodes,
      currentNode: msg.currentNode,
    }
    renderPreparationTime()
  }
  if (msg.kind === 'payload') {
    const elapsed = stopPreparationTimer()
    preparationProgress = null
    preparedPayload = msg.json
    copyBtn.disabled = false
    setStatus(
      elapsed === null ? 'Ready to copy.' : `Ready in ${formatElapsed(elapsed)}.`,
    )
  }
  if (msg.kind === 'error') {
    stopPreparationTimer()
    preparationProgress = null
    preparedPayload = null
    setStatus(msg.message, 'error')
    copyBtn.disabled = true
  }
})

function startPreparationTimer(): void {
  preparationStartedAt = performance.now()
  renderPreparationTime()
  preparationTimer = window.setInterval(renderPreparationTime, 250)
}

function renderPreparationTime(): void {
  if (preparationStartedAt === null) return
  const elapsed = performance.now() - preparationStartedAt
  const progress = preparationProgress
  const count =
    progress && progress.totalNodes > 0
      ? ` · layer ${progress.processedNodes}/${progress.totalNodes}`
      : ''
  const current =
    progress?.currentNode
      ? ` · ${shortNodeName(progress.currentNode)}`
      : ''
  setStatus(
    `Preparing selection… ${formatElapsed(elapsed)} elapsed${count}${current}`,
  )
}

function stopPreparationTimer(): number | null {
  if (preparationTimer !== null) {
    window.clearInterval(preparationTimer)
    preparationTimer = null
  }
  if (preparationStartedAt === null) return null
  const elapsed = performance.now() - preparationStartedAt
  preparationStartedAt = null
  return elapsed
}

function formatElapsed(milliseconds: number): string {
  const totalSeconds = Math.max(0, milliseconds / 1000)
  if (totalSeconds < 10) return `${totalSeconds.toFixed(1)}s`
  if (totalSeconds < 60) return `${Math.round(totalSeconds)}s`

  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.floor(totalSeconds % 60)
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`
}

function shortNodeName(name: string): string {
  const normalized = name.trim()
  return normalized.length <= 24 ? normalized : `${normalized.slice(0, 21)}…`
}

function showCopiedStatus(text: string): void {
  const effectCount = effectCountFromPayload(text)
  setStatus(
    `Copied. ${effectCount} effect${effectCount === 1 ? '' : 's'} included.`,
    'success',
  )
}

function showCopyError(): void {
  setStatus(
    'Figma blocked clipboard access. Reopen the plugin and try again.',
    'error',
  )
}

/**
 * Classic clipboard fallback. Stashes the text in a hidden textarea,
 * selects it, fires `document.execCommand('copy')`. Synchronous and
 * doesn't depend on the modern Permissions API — works in environments
 * where `navigator.clipboard.write` is missing or blocked. Returns
 * true on success.
 *
 * Note: execCommand is marked deprecated in MDN but every browser
 * still ships it. Safer than relying on the modern API alone in a
 * webview where permissions can be unpredictable.
 */
function copyViaExecCommand(text: string): boolean {
  const ta = document.createElement('textarea')
  ta.value = text
  // Position off-screen but inside the document so selection works.
  // `display: none` would prevent selection entirely.
  ta.style.position = 'fixed'
  ta.style.left = '-9999px'
  ta.style.top = '0'
  ta.setAttribute('readonly', '')
  document.body.appendChild(ta)
  ta.focus()
  ta.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch (err) {
    console.warn('[hyper-motion] execCommand copy failed', err)
  } finally {
    document.body.removeChild(ta)
  }
  return ok
}

type PluginMessage =
  | { kind: 'selection'; count: number; totalNodes: number }
  | {
      kind: 'progress'
      processedNodes: number
      totalNodes: number
      currentNode: string
    }
  | { kind: 'payload'; json: string }
  | { kind: 'error'; message: string }
