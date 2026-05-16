// SPDX-License-Identifier: Apache-2.0

/**
 * Electron main process for hyper-motion.
 *
 * Owns window lifecycle and points the renderer at the Vite dev server in
 * development or the bundled file:// build in production. Everything the
 * user actually interacts with — scene, layout, render, anim, timeline —
 * lives unchanged in src/, just wrapped in a Chromium window.
 *
 * Security posture: contextIsolation on, nodeIntegration off. We deliberately
 * do NOT enable `sandbox: true` because the renderer needs the standard
 * Web APIs (clipboard, fullscreen, getDisplayMedia for export, IndexedDB)
 * that the sandbox restricts. With contextIsolation + nodeIntegration off,
 * the renderer is still walled off from Node — exactly what we want.
 */
import {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  dialog,
  ipcMain,
  Menu,
  shell,
  type MenuItemConstructorOptions,
} from 'electron'
import path from 'node:path'
import fs from 'node:fs'

/**
 * Single-instance lock.
 *
 * Without this, every `hypermotion render` CLI invocation spawns a brand
 * new Electron process. If the user already has the editor open, the new
 * process tries to grab the IndexedDB LevelDB lock, can't, and hangs
 * forever in `apiReady`. Same problem for any second launch — duplicate
 * editor windows.
 *
 * With this, the OS hands our argv to the running instance via the
 * `second-instance` event below, and this process exits immediately. The
 * running instance reads the headless render flags from the forwarded
 * argv and runs the export against its currently-loaded scene, then
 * writes both the output file and a `<output>.done` sentinel that the
 * CLI driver polls for.
 *
 * If no instance is running yet, we become the first instance and the
 * original headless flow (off-screen window, render, exit) applies.
 */
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  // Argv has already been delivered to the running instance by the OS.
  // Exit immediately so we don't double-register IPC handlers or do
  // anything else duplicative.
  app.exit(0)
}

/**
 * Headless render mode — entry point for the CLI / MCP server.
 *
 * When the desktop binary is launched with `--render --out <out>` (plus
 * optional `--format`, `--quality`, `--fps`, `--scene <path>`), we skip
 * the normal editor window and instead:
 *
 *   1. Create an off-screen BrowserWindow
 *   2. Load the renderer (which hydrates the current scene from IndexedDB)
 *   3. Renderer reads our request via `export:headless-request`
 *   4. Renderer runs export, posts bytes via `export:headless-done`
 *   5. We write the bytes to <out>, exit 0
 *
 * v0.1.0: renders the user's CURRENT scene (whatever's in IndexedDB).
 * v0.1.1 picks up the `.arnimotion` file format and honors `--scene`.
 *
 * The CLI in `@psiddharthdesign/hypermotion` is what spawns this binary
 * with these flags. See `cli/src/electron/driver.ts` for the parent side.
 */
interface HeadlessRequest {
  /** Future-compat: path to a .arnimotion scene file. Ignored in v0.1.0. */
  scenePath?: string
  outputPath: string
  format: 'mp4' | 'webm' | 'gif'
  quality: 'comp' | '720p' | '2k' | '4k'
  fps: number
}

function parseHeadlessArgs(argv: string[]): HeadlessRequest | null {
  // `--render` is the trigger. Accept both bare (`--render`) and
  // `=true` (`--render=true`) for forward-compat with the
  // `--key=value`-only path discussed below.
  if (!argv.includes('--render') && !argv.some((a) => a.startsWith('--render='))) {
    return null
  }

  // Accept BOTH `--key=value` (single arg) and `--key value` (two args).
  //
  // The `=` form is what we now always emit from the CLI driver because
  // Electron's `second-instance` event delivers argv that's been
  // pre-processed by Chromium's CommandLine class — that processing
  // drops bare values between `--key` switches but preserves
  // `--key=value` intact. We keep the two-arg fallback so older CLI
  // versions and ad-hoc terminal invocations still work.
  function flag(name: string): string | undefined {
    const eqPrefix = `${name}=`
    const eqArg = argv.find((a) => a.startsWith(eqPrefix))
    if (eqArg) return eqArg.slice(eqPrefix.length)
    const i = argv.indexOf(name)
    if (i >= 0 && i + 1 < argv.length) {
      const next = argv[i + 1]
      // Guard against the same Chromium argv collapse: if the "value"
      // is actually the next flag, treat the value as missing rather
      // than misinterpreting `--out --format` as outputPath="--format".
      if (!next.startsWith('--')) return next
    }
    return undefined
  }

  const outputPath = flag('--out')
  if (!outputPath) return null

  const scenePath = flag('--scene')
  const format = (flag('--format') ?? inferFormat(outputPath)) as HeadlessRequest['format']
  const quality = (flag('--quality') ?? 'comp') as HeadlessRequest['quality']
  const fps = Number(flag('--fps') ?? '30')

  return {
    scenePath: scenePath ? path.resolve(scenePath) : undefined,
    outputPath: path.resolve(outputPath),
    format,
    quality,
    fps: Number.isFinite(fps) && fps > 0 ? fps : 30,
  }
}

function inferFormat(outPath: string): 'mp4' | 'webm' | 'gif' {
  const ext = path.extname(outPath).toLowerCase().slice(1)
  if (ext === 'mp4' || ext === 'webm' || ext === 'gif') return ext
  return 'mp4'
}

let headlessRequest: HeadlessRequest | null = null

/**
 * Mode flag — `true` when the binary was launched with `--render` at
 * boot (no GUI, off-screen, exit-when-done). `false` when we're the
 * persistent editor instance handling a render via `second-instance`
 * event forwarding.
 *
 * The headless-done IPC handler reads this to decide whether to call
 * app.exit(0) (headless mode) or just reset state (editor mode).
 */
let isHeadlessOnly = false

// `__dirname` is provided by the CJS module wrapper at runtime — Vite
// compiles this file to dist-electron/main.cjs in CJS format. If we
// ever flip Electron main to native ESM, swap this for a
// `fileURLToPath(import.meta.url)` shim.

// Two locations matter at runtime:
//   - DIST_ELECTRON: where the compiled main + preload sit (dist-electron/)
//   - DIST_RENDERER: where Vite emits the bundled web app  (dist/)
// In dev, the renderer is loaded over HTTP from the Vite dev server; the
// URL is injected by vite-plugin-electron as VITE_DEV_SERVER_URL.
process.env.DIST_ELECTRON = path.join(__dirname)
process.env.DIST_RENDERER = path.join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged
  ? process.env.DIST_RENDERER
  : path.join(process.env.DIST_ELECTRON, '../public')

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

let mainWindow: BrowserWindow | null = null

/**
 * Build a minimal app menu.
 *
 * The Edit menu's roles (cut/copy/paste/selectAll) are what dispatch
 * `paste`/`copy`/`cut` events into the focused webContents — without
 * them, Cmd+V never reaches the renderer's `useFigmaPaste` hook even
 * though the keystroke is detected. This is the gotcha that makes
 * "Copy from plugin" silently no-op under a wrapped Electron app.
 *
 * Single-letter shortcuts (R for Rectangle, V for Select, etc.) don't
 * need menu entries — they're plain `keydown` events that bubble to the
 * document listener in `useKeyboardShortcuts`. They DO need the
 * BrowserWindow to have keyboard focus, which is why we `.focus()` after
 * load below. DevTools-detach steals focus on launch, so the user
 * pressing R first sees nothing happen until they click into the canvas.
 */
function buildAppMenu() {
  const isMac = process.platform === 'darwin'

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: 'hyper-motion',
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Scene',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow?.webContents.send('file:new'),
        },
        {
          label: 'Open…',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send('file:open'),
        },
        { type: 'separator' as const },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow?.webContents.send('file:save'),
        },
        {
          label: 'Save As…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => mainWindow?.webContents.send('file:save-as'),
        },
        { type: 'separator' as const },
        isMac ? { role: 'close' as const } : { role: 'quit' as const },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        // Undo/Redo are handled inside the renderer via Y.UndoManager —
        // sending the menu role would call webContents.undo(), which is
        // a DOM-level undo that doesn't know about the scene graph.
        // Instead we forward the keystroke as a regular keydown.
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        // Cut / Copy / Paste use `registerAccelerator: false` so the
        // menu still shows the hint (and click-to-invoke still calls
        // webContents.cut / .copy / .paste for native text fields),
        // BUT the Cmd+X / C / V keystrokes are not intercepted at the
        // menu level. They pass through to the renderer's document
        // keydown listener, which routes:
        //   - text fields → browser-native cut/copy/paste (inputs +
        //     contentEditable handle these themselves)
        //   - canvas / non-input focus → our scene clipboard in
        //     useKeyboardShortcuts (cut a layer, paste it back)
        // Previously these were plain `{ role: 'cut' }` etc., which
        // ate the shortcut at the menu level — Cmd+X on a selected
        // layer silently no-op'd because our keydown never ran.
        { role: 'cut', registerAccelerator: false },
        { role: 'copy', registerAccelerator: false },
        { role: 'paste', registerAccelerator: false },
        ...(isMac
          ? [
              { role: 'pasteAndMatchStyle' as const },
              { role: 'delete' as const },
              { role: 'selectAll' as const, registerAccelerator: false },
            ]
          : [
              { role: 'delete' as const },
              { type: 'separator' as const },
              { role: 'selectAll' as const, registerAccelerator: false },
            ]),
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const },
              { type: 'separator' as const },
              { role: 'window' as const },
            ]
          : [{ role: 'close' as const }]),
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    title: 'hyper-motion',
    // Mirror the comp-editor proportions designers expect on first open.
    // Big enough that all four panels (layers / canvas / inspector /
    // timeline) breathe without forcing a resize.
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#1a1a1f',
    // MVP keeps the OS-default titlebar so the renderer (which carries
    // its own TopBar) doesn't have to reserve room for traffic lights or
    // window-controls overlay. We can switch to `hiddenInset` + a CSS
    // safe-inset on TopBar later when we want the frameless look without
    // remaking the layout.
    titleBarStyle: 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      // Renderer is walled off from Node via contextIsolation +
      // nodeIntegration:false. `sandbox` stays OFF because it ALSO
      // restricts standard Web APIs the editor depends on (clipboard
      // events, getDisplayMedia for export, IndexedDB partitioning,
      // WebCodecs). Sandbox + contextIsolation isn't free — the
      // renderer becomes a different security tier where Chromium
      // gates these behind permissions we'd have to manually grant.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      // Web app already uses requestAnimationFrame + WebCodecs/MediaRecorder
      // throttling-free behavior; keep the default page-visibility behavior
      // so the export pipeline doesn't stall when the window backgrounds.
      backgroundThrottling: false,
    },
  })

  // Auto-grant the permissions the editor genuinely needs. Without this,
  // requests for clipboard read, fullscreen, and media (tab capture for
  // the export pipeline) silently fail under Electron's default
  // permission policy.
  mainWindow.webContents.session.setPermissionRequestHandler(
    (_wc, permission, callback) => {
      const allowed: Set<string> = new Set([
        'clipboard-read',
        'clipboard-sanitized-write',
        'fullscreen',
        'media',
        'display-capture',
        'pointerLock',
      ])
      callback(allowed.has(permission))
    },
  )

  // Display-media request handler — REQUIRED in Electron 30+ for
  // navigator.mediaDevices.getDisplayMedia() to return a stream. Without
  // this, the renderer's call rejects silently and the export pipeline's
  // tab-capture path (Fast MP4, WebM) never sees a frame.
  //
  // We auto-pick the hyper-motion BrowserWindow itself as the source.
  // The user opted into recording when they hit Export — there's no
  // reason to make them go through an OS picker for what's obviously
  // their own app. We only ever expose the hyper-motion window; no
  // other windows or screens are listed.
  mainWindow.webContents.session.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ['window'],
          // Thumbnail isn't shown anywhere — pass a tiny one so we don't
          // waste cycles on a full-size capture for the picker that
          // never appears.
          thumbnailSize: { width: 0, height: 0 },
        })
        // Match by title — we set the BrowserWindow's title to
        // 'hyper-motion'. Falls back to the first window if title
        // changes upstream so we never strand the export.
        const targetTitle = mainWindow?.getTitle() ?? 'hyper-motion'
        const source =
          sources.find((s) => s.name === targetTitle) ?? sources[0]
        if (source) {
          callback({ video: source })
        } else {
          // No window source available — surface as an empty callback,
          // which rejects the renderer's getDisplayMedia promise. The
          // ExportMenu shows a friendly error.
          callback({})
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[main] desktopCapturer.getSources failed:', err)
        callback({})
      }
    },
    // useSystemPicker is false (the default) — we provide the source
    // directly. Set to true only if we ever want users to pick which
    // window/screen to record (e.g. to record an external preview).
  )

  if (VITE_DEV_SERVER_URL) {
    // Dev: hot-reload from the Vite server. DevTools is opt-in via
    // `OPEN_DEVTOOLS=1 pnpm dev` (or Cmd+Opt+I / View → Toggle Developer
    // Tools from the menu at any time). When it does auto-open it docks
    // BOTTOM (not detached) so the main window keeps keyboard focus on
    // launch — otherwise the first R / V shortcut goes to DevTools.
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
    if (process.env.OPEN_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools({ mode: 'bottom' })
    }
  } else {
    // Prod: load the bundled index.html. Note the relative paths — the
    // Vite config sets `base: './'` so file:// resolves assets without a
    // host. Without that, every chunk lookup 404s.
    mainWindow.loadFile(path.join(process.env.DIST_RENDERER!, 'index.html'))
  }

  // Force focus to the main window once the renderer reports it's ready.
  // Detached / docked DevTools can otherwise grab the focus ring and
  // single-letter shortcuts go nowhere.
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow?.focus()
  })

  // External links (export docs, font CDN, etc.) open in the OS browser
  // rather than hijacking the editor window.
  mainWindow.webContents.setWindowOpenHandler(({ url }: { url: string }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url)
    }
    return { action: 'deny' as const }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// IPC bridges. The renderer cannot read the OS clipboard reliably under
// Electron's sandbox/contextIsolation defaults — `navigator.clipboard.readText()`
// resolves with empty when called outside a fresh user-activation gesture
// even with the permission granted. The main process has unrestricted
// access via Electron's `clipboard` module, so we proxy through IPC.
ipcMain.handle('clipboard:readText', () => clipboard.readText())
ipcMain.handle('clipboard:writeText', (_e, text: string) => {
  clipboard.writeText(text)
})

/**
 * Export capture bridge.
 *
 * `webContents.capturePage(rect)` returns the rendered page region as a
 * NativeImage — bypasses getDisplayMedia entirely (no permission prompt,
 * no OS-level "REC" overlay, no chrome bleed) and captures only the
 * rectangle we care about (the artboard). The renderer drives the
 * timeline frame-by-frame and asks for one capture per frame; the
 * resulting PNG bytes are decoded back into a canvas in the renderer
 * and handed to the WebCodecs MP4 / GIF encoder.
 *
 * For HQ exports (2K / 4K from a 1080p artboard), the renderer calls
 * `export:set-zoom-factor` first. Page zoom re-rasterizes the scene
 * (text stays sharp) and `capturePage` then returns image data scaled
 * up by the same factor — real pixels, not upscale mush.
 */
ipcMain.handle(
  'export:capture-rect',
  async (
    _e,
    rect: { x: number; y: number; width: number; height: number },
  ): Promise<Uint8Array> => {
    const wc = mainWindow?.webContents
    if (!wc) throw new Error('export:capture-rect — no active webContents')
    // Electron requires whole numbers in the rect; clamp width/height to
    // ≥1 so a zero-sized rect doesn't reject the capture call.
    const r = {
      x: Math.max(0, Math.round(rect.x)),
      y: Math.max(0, Math.round(rect.y)),
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height)),
    }
    const image = await wc.capturePage(r)
    // toPNG() returns a Buffer; structured-cloning sends it across IPC
    // as Uint8Array on the renderer side.
    return image.toPNG()
  },
)

ipcMain.handle('export:set-zoom-factor', (_e, factor: number) => {
  const wc = mainWindow?.webContents
  if (!wc) return
  // Clamp to Electron's documented range. 0.25 to 5.0 is what Chromium
  // supports for page zoom; outside that the call silently fails.
  const f = Math.max(0.25, Math.min(5, factor))
  wc.setZoomFactor(f)
})

ipcMain.handle('export:get-zoom-factor', (): number => {
  const wc = mainWindow?.webContents
  return wc ? wc.getZoomFactor() : 1
})

/**
 * `.hype` file I/O bridge.
 *
 * The renderer holds the Y.Doc and produces / consumes the on-disk bytes
 * (see `src/scene/file.ts`). Main owns the file dialogs + raw fs reads
 * because contextIsolation walls renderer off from node's fs module.
 *
 * Flow:
 *   File → Save  → renderer serializes doc to bytes, calls `file:write`
 *                  with `{ path, bytes }`. Main writes, returns success.
 *                  If `path` is null, falls through to Save As.
 *   File → Save As → main shows save dialog, returns chosen path.
 *                    Renderer then calls `file:write` with the bytes.
 *   File → Open → main shows open dialog, reads bytes, returns
 *                 `{ path, bytes }`. Renderer applies to a fresh doc.
 *
 * Path tracking (which file the current scene is "saved as") lives in
 * the renderer; main is stateless.
 */
ipcMain.handle(
  'file:show-save-dialog',
  async (
    _e,
    opts?: { defaultPath?: string; suggestedName?: string },
  ): Promise<string | null> => {
    if (!mainWindow) return null
    const suggested = opts?.suggestedName ?? 'Untitled.hype'
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save scene',
      defaultPath: opts?.defaultPath ?? suggested,
      filters: [{ name: 'hyper-motion scene', extensions: ['hype'] }],
    })
    return result.canceled || !result.filePath ? null : result.filePath
  },
)

ipcMain.handle(
  'file:show-open-dialog',
  async (): Promise<{ path: string; bytes: Uint8Array } | null> => {
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Open scene',
      filters: [{ name: 'hyper-motion scene', extensions: ['hype'] }],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]
    try {
      const bytes = fs.readFileSync(filePath)
      // Buffer → Uint8Array marshals across IPC.
      return { path: filePath, bytes: new Uint8Array(bytes) }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[file] read failed: ${err instanceof Error ? err.message : err}`)
      return null
    }
  },
)

ipcMain.handle(
  'file:write',
  (_e, payload: { path: string; bytes: Uint8Array }): boolean => {
    try {
      fs.writeFileSync(payload.path, Buffer.from(payload.bytes))
      return true
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[file] write failed: ${err instanceof Error ? err.message : err}`,
      )
      return false
    }
  },
)

ipcMain.handle(
  'file:read',
  (_e, filePath: string): Uint8Array | null => {
    try {
      const bytes = fs.readFileSync(filePath)
      return new Uint8Array(bytes)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[file] read failed: ${err instanceof Error ? err.message : err}`,
      )
      return null
    }
  },
)

/**
 * Headless render IPC handlers.
 *
 * The renderer pulls the request via `export:headless-request`, kicks off
 * its export pipeline, and reports completion via `export:headless-done`
 * (with the rendered bytes) or `export:headless-error` (with a message).
 * On either, we write the file / log the error and exit.
 */
ipcMain.handle('export:headless-request', () => headlessRequest)

ipcMain.handle(
  'export:headless-done',
  async (_e, payload: { bytes: Uint8Array; outputPath: string }) => {
    try {
      fs.writeFileSync(payload.outputPath, Buffer.from(payload.bytes))
      // Sentinel — CLI driver polls `<output>.done` to know the render
      // is complete. Used in BOTH modes so the CLI doesn't need to know
      // whether we were headless-only or running in a live editor.
      const sentinel = `${payload.outputPath}.done`
      fs.writeFileSync(
        sentinel,
        JSON.stringify({ ts: Date.now(), bytes: payload.bytes.length }),
      )
      // eslint-disable-next-line no-console
      console.log(`[headless] wrote ${payload.outputPath}`)
      if (isHeadlessOnly) {
        app.exit(0)
      } else {
        // Editor mode — running instance handled a second-instance render.
        // Reset state, keep the user's editor session alive.
        headlessRequest = null
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[headless] failed to write output: ${err instanceof Error ? err.message : err}`,
      )
      if (isHeadlessOnly) app.exit(1)
      else headlessRequest = null
    }
  },
)

ipcMain.handle('export:headless-error', (_e, message: string) => {
  // eslint-disable-next-line no-console
  console.error(`[headless] renderer reported error: ${message}`)
  // Drop an error sentinel at `<output>.error` so the CLI driver
  // doesn't poll forever waiting for `<output>.done`. Without this,
  // the CLI hits its 5-minute timeout and the agent never gets a
  // proper rejection — observed as "the call is stuck."
  if (headlessRequest?.outputPath) {
    try {
      const errorPath = `${headlessRequest.outputPath}.error`
      fs.writeFileSync(
        errorPath,
        JSON.stringify({ ts: Date.now(), message }),
      )
    } catch {
      /* best effort — if even the error write fails, the CLI will
         eventually hit its timeout and surface that instead. */
    }
  }
  if (isHeadlessOnly) app.exit(1)
  else headlessRequest = null
})

// macOS: keep the app running with no windows so Cmd+N / dock click can
// reopen. Other platforms quit on last window close, matching native
// expectations.
app.whenReady().then(() => {
  // Headless render branch — when the binary was launched with --render,
  // skip the menu + visible window entirely. The renderer carries out the
  // export and signals completion via IPC; the app exits when done.
  const parsed = parseHeadlessArgs(process.argv)
  if (parsed) {
    isHeadlessOnly = true
    headlessRequest = parsed
    // eslint-disable-next-line no-console
    console.log(
      `[headless] rendering ${parsed.scenePath} → ${parsed.outputPath} ` +
        `(${parsed.format} · ${parsed.quality} · ${parsed.fps}fps)`,
    )
    createMainWindow()
    if (mainWindow) {
      // Off-screen, no chrome, no menus. Still a real BrowserWindow so
      // capturePage has a rendered surface to read from.
      mainWindow.hide()
    }
    return
  }

  buildAppMenu()
  createMainWindow()
})

/**
 * Second-instance handler. Fires when another hyper-motion process tries
 * to launch — either a normal re-launch (user double-clicks the dock
 * icon) or the CLI calling us with `--render` flags.
 *
 * Normal re-launch → focus our existing window.
 * --render flags    → dispatch a headless render in the renderer of our
 *                    existing window. After completion, the IPC handler
 *                    writes the file + sentinel; the editor stays open.
 */
app.on('second-instance', (_event, argv) => {
  const req = parseHeadlessArgs(argv)
  if (req) {
    // eslint-disable-next-line no-console
    console.log(
      `[main] received second-instance render request → ${req.outputPath} ` +
        `(${req.format} · ${req.quality} · ${req.fps}fps)`,
    )
    if (!mainWindow) return
    headlessRequest = req
    // Notify renderer to run a fresh export now. headlessExport.ts has a
    // listener on this channel that calls into runHeadlessRender(req).
    mainWindow.webContents.send('export:headless-trigger', req)
    return
  }
  // Plain re-launch — focus the existing window.
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
})