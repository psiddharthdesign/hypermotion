// SPDX-License-Identifier: Apache-2.0

/**
 * Hyper Motion Import — UI iframe code.
 *
 * The plugin sandbox can't reach `navigator.clipboard`, so all clipboard
 * IO happens here. The sandbox's `code.ts` posts the assembled JSON
 * payload via `figma.ui.postMessage`; we receive it on `window.message`,
 * write it to the clipboard, and update the UI.
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
 *   The fix is to call `navigator.clipboard.write` IMMEDIATELY in the
 *   click handler with a `Promise<Blob>` that resolves later. Chromium
 *   preserves the activation context for the write() call since it was
 *   initiated during the activation tick — even if the Promise resolves
 *   seconds later. The user activation gate is on the *call*, not on
 *   the data arrival.
 *
 *   For environments where `ClipboardItem` is unavailable (older
 *   Electron / Figma desktop builds), we fall back to the classic
 *   `execCommand('copy')` path with a hidden textarea.
 *
 * Two messages flow back to the sandbox:
 *   - `{ kind: 'copy' }`  on Copy button click
 *   - `{ kind: 'close' }` if we ever add a Close affordance
 */

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

// Outstanding payload request — resolved when the sandbox posts back
// with `{ kind: 'payload' }`, rejected on `{ kind: 'error' }`. One in
// flight at a time; subsequent clicks while in-flight are ignored
// because copyBtn.disabled is set.
let pendingResolve: ((text: string) => void) | null = null
let pendingReject: ((err: Error) => void) | null = null

copyBtn.addEventListener('click', () => {
  // If a previous request is still pending, drop it before kicking off
  // a new one. This shouldn't happen because the button disables, but
  // is defensive against race conditions if the user double-clicks.
  if (pendingReject) {
    pendingReject(new Error('Cancelled by new copy request.'))
    pendingResolve = null
    pendingReject = null
  }

  setStatus('Capturing selection…')
  copyBtn.disabled = true

  // Create a Promise that will resolve when the sandbox posts back the
  // payload. This MUST be created synchronously in the click handler so
  // navigator.clipboard.write can reference it inside the same user-
  // activation tick.
  const payloadPromise = new Promise<string>((resolve, reject) => {
    pendingResolve = resolve
    pendingReject = reject
  })

  // Kick off the sandbox payload computation.
  parent.postMessage({ pluginMessage: { kind: 'copy' } }, '*')

  // Path A — modern Promise-based clipboard write. Available in
  // Chromium 85+ (Figma desktop ships a Chromium webview, so this
  // should work in every actively-supported version).
  const tryModernWrite = async (): Promise<boolean> => {
    if (typeof ClipboardItem === 'undefined') return false
    try {
      const blobPromise = payloadPromise.then(
        (text) => new Blob([text], { type: 'text/plain' }),
      )
      // ClipboardItem accepts a Promise<Blob> — the browser holds onto
      // the original user-activation context until the Promise
      // resolves and writes the bytes when ready.
      const item = new ClipboardItem({ 'text/plain': blobPromise })
      await navigator.clipboard.write([item])
      return true
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[hyper-motion] modern clipboard write failed', err)
      return false
    }
  }

  // Path B — fallback for environments without ClipboardItem (older
  // Electron, restricted permission policies). Waits for the payload,
  // then synthesizes a textarea + execCommand('copy'). execCommand
  // doesn't need the modern activation gate — it works as long as we
  // have a focused, selected text node in the same task. The pending
  // user activation from the click usually still qualifies.
  const tryFallbackWrite = async (): Promise<boolean> => {
    const text = await payloadPromise
    return copyViaExecCommand(text)
  }

  // Run modern first; on failure, await the fallback.
  void (async () => {
    const ok = await tryModernWrite()
    if (ok) {
      const text = await payloadPromise.catch(() => '')
      const effectCount = effectCountFromPayload(text)
      setStatus(
        `Copied. ${effectCount} effect${effectCount === 1 ? '' : 's'} included.`,
        'success',
      )
      copyBtn.disabled = false
      return
    }
    // Either ClipboardItem unavailable OR the modern write rejected.
    // Try execCommand as a last resort.
    let fallbackOk = false
    try {
      fallbackOk = await tryFallbackWrite()
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[hyper-motion] fallback clipboard write failed', err)
    }
    if (fallbackOk) {
      const text = await payloadPromise.catch(() => '')
      const effectCount = effectCountFromPayload(text)
      setStatus(
        `Copied. ${effectCount} effect${effectCount === 1 ? '' : 's'} included.`,
        'success',
      )
    } else {
      setStatus(
        'Copy blocked by browser. Make sure the plugin window has focus and try again.',
        'error',
      )
    }
    copyBtn.disabled = false
  })()
})

window.addEventListener('message', (event: MessageEvent) => {
  const msg = (event.data as { pluginMessage?: PluginMessage }).pluginMessage
  if (!msg) return
  if (msg.kind === 'selection') {
    const n = msg.count
    countEl.textContent =
      n === 0
        ? 'No selection'
        : n === 1
          ? '1 layer'
          : `${n} layers`
    copyBtn.disabled = n === 0
    setStatus('')
  }
  if (msg.kind === 'payload') {
    // Resolve the in-flight clipboard write with the actual JSON.
    // navigator.clipboard.write's Promise chain takes it from here.
    const resolve = pendingResolve
    pendingResolve = null
    pendingReject = null
    resolve?.(msg.json)
  }
  if (msg.kind === 'error') {
    const reject = pendingReject
    pendingResolve = null
    pendingReject = null
    reject?.(new Error(msg.message))
    setStatus(msg.message, 'error')
    copyBtn.disabled = false
  }
})

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
    // eslint-disable-next-line no-console
    console.warn('[hyper-motion] execCommand copy failed', err)
  } finally {
    document.body.removeChild(ta)
  }
  return ok
}

type PluginMessage =
  | { kind: 'selection'; count: number }
  | { kind: 'payload'; json: string }
  | { kind: 'error'; message: string }
