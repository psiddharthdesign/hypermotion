/**
 * Hyper Motion Import — UI iframe code.
 *
 * The plugin sandbox can't reach `navigator.clipboard`, so all clipboard
 * IO happens here. The sandbox's `code.ts` posts the assembled JSON
 * payload via `figma.ui.postMessage`; we receive it on `window.message`,
 * write it to the clipboard, and update the UI.
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

copyBtn.addEventListener('click', () => {
  setStatus('Capturing selection…')
  copyBtn.disabled = true
  parent.postMessage({ pluginMessage: { kind: 'copy' } }, '*')
})

window.addEventListener('message', async (event: MessageEvent) => {
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
    try {
      await navigator.clipboard.writeText(msg.json)
      setStatus('Copied. Paste into Hyper Motion (⌘V).', 'success')
    } catch (err) {
      // Some clipboard rejections (focus issues, no-secure-context) need
      // the user to try the click again. The button stays enabled below.
      setStatus(
        'Copy blocked by browser. Click again with the Figma window focused.',
        'error',
      )
      console.warn('Clipboard write failed', err)
    } finally {
      // Re-enable so a single failed attempt doesn't strand the user.
      copyBtn.disabled = false
    }
  }
  if (msg.kind === 'error') {
    setStatus(msg.message, 'error')
    copyBtn.disabled = false
  }
})

type PluginMessage =
  | { kind: 'selection'; count: number }
  | { kind: 'payload'; json: string }
  | { kind: 'error'; message: string }
