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
  Notification,
  shell,
  webContents,
  type MenuItemConstructorOptions,
} from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { spawn, spawnSync } from 'node:child_process'
import {
  prepareFigmaPlugin,
  type FigmaPluginStatus,
} from './figmaPlugin'

// Hyper Motion is a desktop editor: pressing Play in our own timeline should
// always be allowed to start timeline audio, even if React applies the state
// change just after Chromium's narrow "user gesture" window.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

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
 * When the desktop binary is launched with `--render --out=<out>` (plus
 * optional `--format`, `--quality`, `--fps`, `--scene=<path>`), we skip
 * the normal editor window and instead:
 *
 *   1. Create an off-screen BrowserWindow
 *   2. Load the renderer (which hydrates the current scene from IndexedDB)
 *   3. Renderer reads our request via `export:headless-request`
 *   4. Renderer runs export, posts bytes via `export:headless-done`
 *   5. We write the bytes to <out>, exit 0
 *
 * If `--scene` points at a saved `.hype` file, the render window hydrates
 * that file; otherwise it renders the user's current IndexedDB scene.
 *
 * The CLI in `@psiddharthdesign/hypermotion` is what spawns this binary
 * with these flags. See `cli/src/electron/driver.ts` for the parent side.
 */
interface HeadlessRequest {
  /** Optional path to a saved .hype scene file. */
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
let pendingOpenScenePath: string | null = null

function parseOpenSceneArg(argv: string[]): string | null {
  if (argv.some((a) => a === '--render' || a.startsWith('--render='))) return null
  const candidate = argv.find((a) => {
    if (a.startsWith('--')) return false
    return path.extname(a).toLowerCase() === '.hype'
  })
  return candidate ? path.resolve(candidate) : null
}

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
let previewWindow: BrowserWindow | null = null
const RECENT_PROJECTS_LIMIT = 10
let recentProjects: string[] = []

interface LocalToolStatus {
  available: boolean
  path: string | null
}

function findExecutable(name: string): LocalToolStatus {
  const pathDirs = [
    ...new Set(
      [
        ...(process.env.PATH ?? '').split(path.delimiter),
        '/opt/homebrew/bin',
        '/usr/local/bin',
        '/usr/bin',
        '/bin',
      ].filter(Boolean),
    ),
  ]

  for (const dir of pathDirs) {
    const candidate = path.join(dir, name)
    try {
      fs.accessSync(candidate, fs.constants.X_OK)
      return { available: true, path: candidate }
    } catch {
      // Keep scanning PATH candidates.
    }
  }
  return { available: false, path: null }
}

function recentProjectsStorePath(): string {
  return path.join(app.getPath('userData'), 'recent-projects.json')
}

function loadRecentProjects(): void {
  try {
    const raw = fs.readFileSync(recentProjectsStorePath(), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return
    recentProjects = parsed
      .filter((item): item is string => typeof item === 'string')
      .map((item) => path.resolve(item))
      .filter((item, index, all) => all.indexOf(item) === index)
      .slice(0, RECENT_PROJECTS_LIMIT)
  } catch {
    recentProjects = []
  }
}

function saveRecentProjects(): void {
  try {
    fs.mkdirSync(path.dirname(recentProjectsStorePath()), { recursive: true })
    fs.writeFileSync(
      recentProjectsStorePath(),
      JSON.stringify(recentProjects, null, 2),
    )
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[recent] write failed: ${err instanceof Error ? err.message : err}`,
    )
  }
}

function refreshRecentProjectsMenu(): void {
  if (!app.isReady() || isHeadlessOnly) return
  buildAppMenu()
}

function addRecentProject(filePath: string): void {
  const resolved = path.resolve(filePath)
  recentProjects = [
    resolved,
    ...recentProjects.filter((item) => item !== resolved),
  ].slice(0, RECENT_PROJECTS_LIMIT)
  app.addRecentDocument(resolved)
  saveRecentProjects()
  refreshRecentProjectsMenu()
}

function removeRecentProject(filePath: string): void {
  const resolved = path.resolve(filePath)
  const next = recentProjects.filter((item) => item !== resolved)
  if (next.length === recentProjects.length) return
  recentProjects = next
  saveRecentProjects()
  refreshRecentProjectsMenu()
}

function clearRecentProjects(): void {
  recentProjects = []
  app.clearRecentDocuments()
  saveRecentProjects()
  refreshRecentProjectsMenu()
}

interface AppUpdateInfo {
  currentVersion: string
  latestVersion: string
  releaseName: string
  releaseUrl: string
  publishedAt: string | null
}

const UPDATE_CHECK_URL =
  'https://api.github.com/repos/psiddharthdesign/hypermotion/releases/latest'
const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000

let updateCheckTimer: NodeJS.Timeout | null = null
let lastUpdateInfo: AppUpdateInfo | null = null
let lastNativeNotifiedVersion: string | null = null

function normalizeVersion(v: string): string {
  return v.trim().replace(/^v/i, '')
}

function compareVersions(a: string, b: string): number {
  const pa = normalizeVersion(a).split('-')[0]!.split('.').map(Number)
  const pb = normalizeVersion(b).split('-')[0]!.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const da = Number.isFinite(pa[i]) ? pa[i]! : 0
    const db = Number.isFinite(pb[i]) ? pb[i]! : 0
    if (da !== db) return da > db ? 1 : -1
  }
  return 0
}

async function checkForUpdates(): Promise<AppUpdateInfo | null> {
  try {
    const res = await fetch(UPDATE_CHECK_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `hyper-motion/${app.getVersion()}`,
      },
    })
    if (!res.ok) return lastUpdateInfo

    const release = (await res.json()) as {
      tag_name?: string
      name?: string
      html_url?: string
      published_at?: string
      draft?: boolean
      prerelease?: boolean
    }
    if (!release.tag_name || !release.html_url || release.draft) {
      return lastUpdateInfo
    }

    const currentVersion = app.getVersion()
    const latestVersion = normalizeVersion(release.tag_name)
    if (compareVersions(latestVersion, currentVersion) <= 0) {
      lastUpdateInfo = null
      return null
    }

    lastUpdateInfo = {
      currentVersion,
      latestVersion,
      releaseName: release.name ?? release.tag_name,
      releaseUrl: release.html_url,
      publishedAt: release.published_at ?? null,
    }
    notifyRendererAboutUpdate(lastUpdateInfo)
    maybeShowNativeUpdateNotification(lastUpdateInfo)
    return lastUpdateInfo
  } catch (err) {
    // Update checks should never interrupt launch or editing.
    // eslint-disable-next-line no-console
    console.warn(
      `[updates] check failed: ${err instanceof Error ? err.message : err}`,
    )
    return lastUpdateInfo
  }
}

function notifyRendererAboutUpdate(info: AppUpdateInfo): void {
  if (!mainWindow || mainWindow.webContents.isDestroyed()) return
  mainWindow.webContents.send('updates:available', info)
}

function maybeShowNativeUpdateNotification(info: AppUpdateInfo): void {
  if (lastNativeNotifiedVersion === info.latestVersion) return
  if (!Notification.isSupported()) return
  lastNativeNotifiedVersion = info.latestVersion
  const notification = new Notification({
    title: 'Hyper Motion update available',
    body: `Version ${info.latestVersion} is ready to download.`,
    silent: false,
  })
  notification.on('click', () => {
    shell.openExternal(info.releaseUrl)
  })
  notification.show()
}

function startUpdateChecks(): void {
  if (updateCheckTimer) return
  setTimeout(() => {
    void checkForUpdates()
  }, 2500)
  updateCheckTimer = setInterval(() => {
    void checkForUpdates()
  }, UPDATE_CHECK_INTERVAL_MS)
}

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
  const recentProjectItems: MenuItemConstructorOptions[] =
    recentProjects.length === 0
      ? [{ label: 'No Recent Projects', enabled: false }]
      : [
          ...recentProjects.map((projectPath) => ({
            label: path.basename(projectPath),
            sublabel: path.dirname(projectPath),
            click: () => mainWindow?.webContents.send('file:open-path', projectPath),
          })),
          { type: 'separator' as const },
          {
            label: 'Clear Recent Projects',
            click: () => clearRecentProjects(),
          },
        ]

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
        {
          label: 'Recent Projects',
          submenu: recentProjectItems,
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

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const prefix = ['[renderer:log]', '[renderer:warn]', '[renderer:error]'][level] ?? '[renderer]'
    if (
      message.includes('[audio]') ||
      message.includes('[media]') ||
      message.includes('NotAllowedError') ||
      message.includes('NotSupportedError')
    ) {
      // eslint-disable-next-line no-console
      console.log(`${prefix} ${message} (${sourceId}:${line})`)
    }
  })

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
    if (lastUpdateInfo) notifyRendererAboutUpdate(lastUpdateInfo)
    flushPendingOpenScene()
  })

  // A reload replaces the editor-side listeners that own export progress and
  // cancellation. Stop its hidden workers immediately instead of leaving
  // unthrottled 4K render windows running with nobody able to control them.
  mainWindow.webContents.on(
    'did-start-navigation',
    (_event, _url, isInPlace, isMainFrame) => {
      if (!isMainFrame || isInPlace || !mainWindow) return
      cancelRenderWindowsForEditor(
        mainWindow.webContents.id,
        'Export cancelled because the editor reloaded.',
      )
    },
  )
  mainWindow.webContents.on('render-process-gone', () => {
    if (!mainWindow) return
    cancelRenderWindowsForEditor(
      mainWindow.webContents.id,
      'Export cancelled because the editor renderer restarted.',
    )
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
    if (previewWindow && !previewWindow.isDestroyed()) {
      previewWindow.destroy()
    }
    previewWindow = null
    mainWindow = null
  })
}

function flushPendingOpenScene(): void {
  if (!mainWindow || !pendingOpenScenePath) return
  const scenePath = pendingOpenScenePath
  pendingOpenScenePath = null
  mainWindow.webContents.send('scene:load-path', scenePath)
  mainWindow.webContents.send('file:open-path', scenePath)
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
ipcMain.handle('clipboard:readFiles', () => {
  const paths = readClipboardFilePaths()
  return paths
    .filter((filePath) => {
      try {
        return fs.statSync(filePath).isFile() && mimeForClipboardFile(filePath) !== ''
      } catch {
        return false
      }
    })
    .map((filePath) => ({
      name: path.basename(filePath),
      type: mimeForClipboardFile(filePath),
      bytes: fs.readFileSync(filePath),
    }))
})

ipcMain.handle(
  'media:normalize-video',
  async (
    _e,
    payload: { name: string; type: string; bytes: Uint8Array },
  ) => normalizeVideoForBrowser(payload),
)

async function normalizeVideoForBrowser(payload: {
  name: string
  type: string
  bytes: Uint8Array
}): Promise<{ name: string; type: string; bytes: Buffer; normalized: boolean }> {
  const ffmpeg = findFfmpegBinary()
  const avconvert = '/usr/bin/avconvert'
  if (!ffmpeg && (process.platform !== 'darwin' || !fs.existsSync(avconvert))) {
    return {
      ...payload,
      bytes: Buffer.from(payload.bytes),
      normalized: false,
    }
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-video-normalize-'))
  const inputExt = path.extname(payload.name) || '.mp4'
  const inputPath = path.join(dir, `input${inputExt}`)
  const outputPath = path.join(dir, ffmpeg ? 'output.webm' : 'output.mp4')
  try {
    fs.writeFileSync(inputPath, Buffer.from(payload.bytes))
    if (ffmpeg) {
      await runFfmpegNormalize(ffmpeg, inputPath, outputPath)
    } else {
      await runAvconvert(avconvert, inputPath, outputPath)
    }
    const bytes = fs.readFileSync(outputPath)
    console.log(
      `[media] normalized video ${payload.name} (${payload.bytes.byteLength} bytes) -> ${path.basename(outputPath)} (${bytes.byteLength} bytes)`,
    )
    const isWebm = path.extname(outputPath).toLowerCase() === '.webm'
    return {
      name: `${path.basename(payload.name, path.extname(payload.name))}-compatible.${isWebm ? 'webm' : 'mp4'}`,
      type: isWebm ? 'video/webm' : 'video/mp4',
      bytes,
      normalized: true,
    }
  } catch (err) {
    console.warn(
      '[media] video normalization failed, using original:',
      err instanceof Error ? err.message : err,
    )
    return {
      ...payload,
      bytes: Buffer.from(payload.bytes),
      normalized: false,
    }
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
}

function findFfmpegBinary(): string | null {
  const local = path.join(process.cwd(), '.hypermotion-bin', 'ffmpeg')
  if (fs.existsSync(local)) return local
  const system = findExecutable('ffmpeg')
  return system.available ? system.path : null
}

function runFfmpegNormalize(
  ffmpeg: string,
  inputPath: string,
  outputPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, [
      '-y',
      '-i',
      inputPath,
      '-map',
      '0:v:0',
      '-map',
      '0:a?',
      '-vf',
      "scale='min(1080,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30,format=yuv420p",
      '-c:v',
      'libvpx',
      '-deadline',
      'good',
      '-cpu-used',
      '4',
      '-crf',
      '10',
      '-b:v',
      '0',
      '-c:a',
      'libvorbis',
      '-b:a',
      '160k',
      outputPath,
    ])
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        resolve()
        return
      }
      reject(
        new Error(
          `ffmpeg exited with code ${code ?? 'unknown'}${stderr ? `: ${stderr.slice(-1600)}` : ''}`,
        ),
      )
    })
  })
}

function runAvconvert(
  avconvert: string,
  inputPath: string,
  outputPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(avconvert, [
      '--source',
      inputPath,
      '--preset',
      'PresetAppleM4V1080pHD',
      '--output',
      outputPath,
      '--replace',
    ])
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        resolve()
        return
      }
      reject(
        new Error(
          `avconvert exited with code ${code ?? 'unknown'}${stderr ? `: ${stderr.slice(-1000)}` : ''}`,
        ),
      )
    })
  })
}

function readClipboardFilePaths(): string[] {
  const paths = new Set<string>()

  for (const uri of [
    clipboard.read('public.file-url'),
    clipboard.read('text/uri-list'),
  ]) {
    for (const filePath of parseFileUris(uri)) paths.add(filePath)
  }

  const nsFilenames = clipboard.readBuffer('NSFilenamesPboardType')
  for (const filePath of parseMacFilenamesPboard(nsFilenames)) {
    paths.add(filePath)
  }

  return [...paths]
}

function parseFileUris(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('file://'))
    .map((line) => {
      try {
        return decodeURIComponent(new URL(line).pathname)
      } catch {
        return ''
      }
    })
    .filter(Boolean)
}

function parseMacFilenamesPboard(buffer: Buffer): string[] {
  if (buffer.length === 0) return []
  const text = buffer.toString('utf8')
  const xmlMatches = [...text.matchAll(/<string>(.*?)<\/string>/g)]
    .map((match) => decodeXml(match[1] ?? ''))
    .filter(Boolean)
  if (xmlMatches.length > 0) return xmlMatches

  const quotedMatches = [...text.matchAll(/"((?:\\"|[^"])*)"/g)]
    .map((match) => (match[1] ?? '').replace(/\\"/g, '"'))
    .filter((value) => value.startsWith('/'))
  if (quotedMatches.length > 0) return quotedMatches

  if (text.startsWith('bplist')) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-clipboard-'))
    const file = path.join(dir, 'files.plist')
    try {
      fs.writeFileSync(file, buffer)
      const result = spawnSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file], {
        encoding: 'utf8',
      })
      if (result.status === 0 && result.stdout) {
        const parsed = JSON.parse(result.stdout) as unknown
        if (Array.isArray(parsed)) {
          return parsed.filter((item): item is string => typeof item === 'string')
        }
      }
    } catch {
      return []
    } finally {
      try {
        fs.rmSync(dir, { recursive: true, force: true })
      } catch {
        /* best effort */
      }
    }
  }

  return []
}

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
}

function mimeForClipboardFile(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    case '.svg':
      return 'image/svg+xml'
    case '.avif':
      return 'image/avif'
    case '.bmp':
      return 'image/bmp'
    case '.mp4':
    case '.m4v':
      return 'video/mp4'
    case '.webm':
      return 'video/webm'
    case '.mov':
      return 'video/quicktime'
    case '.ogv':
      return 'video/ogg'
    case '.ogg':
      return 'video/ogg'
    case '.mp3':
      return 'audio/mpeg'
    case '.wav':
      return 'audio/wav'
    case '.m4a':
      return 'audio/mp4'
    case '.aac':
      return 'audio/aac'
    case '.flac':
      return 'audio/flac'
    case '.oga':
      return 'audio/ogg'
    case '.opus':
      return 'audio/opus'
    default:
      return ''
  }
}

ipcMain.handle('updates:check', () => checkForUpdates())
ipcMain.handle('updates:get-status', () => lastUpdateInfo)

function figmaPluginSourceDirectory(): string {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'figma-plugin')]
    : [
        path.join(app.getAppPath(), 'figma-plugin'),
        path.resolve(process.cwd(), 'figma-plugin'),
      ]

  return (
    candidates.find((candidate) =>
      fs.existsSync(path.join(candidate, 'manifest.json')),
    ) ?? candidates[0]!
  )
}

function prepareInstalledFigmaPlugin(): FigmaPluginStatus {
  return prepareFigmaPlugin({
    sourceDir: figmaPluginSourceDirectory(),
    userDataDir: app.getPath('userData'),
    appVersion: app.getVersion(),
  })
}

ipcMain.handle('figma-plugin:get-manifest-status', () =>
  prepareInstalledFigmaPlugin(),
)

ipcMain.handle('figma-plugin:reveal-manifest', () => {
  const status = prepareInstalledFigmaPlugin()
  if (status.exists) shell.showItemInFolder(status.path)
  return status
})

ipcMain.handle('preview:open-window', async () => {
  if (previewWindow && !previewWindow.isDestroyed()) {
    if (previewWindow.isMinimized()) previewWindow.restore()
    previewWindow.show()
    previewWindow.focus()
    return { ok: true }
  }

  previewWindow = new BrowserWindow({
    title: 'hyper-motion preview',
    width: 1280,
    height: 720,
    minWidth: 640,
    minHeight: 360,
    backgroundColor: '#000000',
    titleBarStyle: 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      backgroundThrottling: false,
    },
  })
  previewWindow.on('closed', () => {
    previewWindow = null
  })

  if (VITE_DEV_SERVER_URL) {
    await previewWindow.loadURL(`${VITE_DEV_SERVER_URL}?preview=1`)
  } else {
    await previewWindow.loadFile(
      path.join(process.env.DIST_RENDERER!, 'index.html'),
      { query: { preview: '1' } },
    )
  }

  previewWindow.focus()
  return { ok: true }
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
    e,
    rect: { x: number; y: number; width: number; height: number },
  ): Promise<Uint8Array> => {
    // Use the SENDER's webContents — not mainWindow's. The render-window
    // architecture (added below) spawns a separate BrowserWindow that
    // calls this IPC to capture itself, not the editor. Reading
    // `event.sender` is what makes the same handler work for both the
    // legacy in-editor capture path AND the new render-window flow.
    const wc = e.sender ?? mainWindow?.webContents
    if (!wc) throw new Error('export:capture-rect — no active webContents')
    // Whole numbers + ≥1 dims; Electron / CDP both reject odd inputs.
    const r = {
      x: Math.max(0, Math.round(rect.x)),
      y: Math.max(0, Math.round(rect.y)),
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height)),
    }

    // PRIMARY: Chrome DevTools Protocol `Page.captureScreenshot` with a
    // `clip` parameter. CDP captures regions of the rendered DOCUMENT,
    // NOT just the visible viewport — which is the whole point. An
    // artboard sized 3840×2880 on a 1920×1080 screen normally has the
    // off-viewport portion unrasterized by Chromium's compositor, so
    // `webContents.capturePage` only returns the visible center. CDP
    // rasterizes the requested clip rect even when it extends beyond
    // the visible area, giving us the full artboard at native pixels.
    //
    // We attach the debugger once per process and reuse it; reattaching
    // every frame would burn IPC time. If anything goes wrong we fall
    // through to the legacy capturePage path below, which still works
    // for artboards that fit in the viewport.
    try {
      if (!wc.debugger.isAttached()) {
        wc.debugger.attach('1.3')
      }
      const result = (await wc.debugger.sendCommand('Page.captureScreenshot', {
        format: 'png',
        clip: {
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          // `scale: 1` means "capture at the page's current device pixel
          // ratio." Use the WebContents zoom factor to influence
          // resolution; here we want native CSS pixels per unit.
          scale: 1,
        },
        // Force the capture beyond the viewport. Without this, CDP
        // still respects viewport bounds and we're back to square one.
        captureBeyondViewport: true,
        fromSurface: true,
      })) as { data: string }
      // CDP returns base64; decode to a buffer for IPC.
      return Buffer.from(result.data, 'base64')
    } catch (err) {
      console.warn(
        '[export] CDP captureScreenshot failed, falling back to capturePage:',
        err,
      )
      const image = await wc.capturePage(r)
      return image.toPNG()
    }
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

/**
 * Resize the WebContents (and window) so a target rectangle fits
 * entirely within the renderer's viewport.
 *
 * Why this exists: `webContents.capturePage(rect)` returns a snapshot of
 * the COMPOSITOR's current surface — pixels that aren't laid out within
 * the visible viewport simply aren't rasterized, so a 3840×2880 artboard
 * rendered on a 1800×1000 screen will only have its central 1800×1000
 * region in the snapshot. The rest crops out. Result: the export looks
 * "zoomed in" because only the middle of the artboard was capturable.
 *
 * Solution: bump the window's content area to at least the artboard's
 * pixel dimensions before the frame loop. macOS / Windows / Linux all
 * allow windows larger than the display — they extend off the visible
 * area but Chromium still rasterizes the full DOM at the new viewport.
 * capturePage then returns the full artboard at native resolution.
 *
 * The original bounds are stashed in `preExportBounds` and restored by
 * `export:restore-window-size`. Always pair the two; leaving the
 * window oversized is the worst possible UX.
 */
let preExportBounds: { x: number; y: number; width: number; height: number } | null =
  null

ipcMain.handle(
  'export:resize-for-capture',
  (_e, opts: { width: number; height: number }) => {
    if (!mainWindow) return
    // Snapshot the user's pre-export window so we can restore exactly.
    if (!preExportBounds) {
      const b = mainWindow.getBounds()
      preExportBounds = { x: b.x, y: b.y, width: b.width, height: b.height }
    }
    // Add a margin so the artboard isn't pressed up against the edge.
    // The chrome bars (top bar, layers, inspector, timeline) eat real
    // viewport space; without margin the artboard rect could end up
    // partially clipped behind them. 40px each side covers the worst
    // case for the current chrome thickness.
    const targetW = Math.max(800, Math.round(opts.width) + 40)
    const targetH = Math.max(600, Math.round(opts.height) + 100)
    // Use setContentSize so we set the WebContents area, not the
    // window's outer bounds (which would include title bar).
    mainWindow.setContentSize(targetW, targetH)
  },
)

ipcMain.handle('export:restore-window-size', () => {
  if (!mainWindow || !preExportBounds) return
  mainWindow.setBounds(preExportBounds)
  preExportBounds = null
})

ipcMain.handle('export:get-zoom-factor', (): number => {
  const wc = mainWindow?.webContents
  return wc ? wc.getZoomFactor() : 1
})

/**
 * Render-window export bridge.
 *
 * The proper "user keeps working during export" architecture. When the
 * editor hits Export, instead of CSS-juggling the editor itself, we spawn
 * a hidden BrowserWindow sized EXACTLY to the output dimensions, load the
 * renderer with `?render-window=1&requestId=…`, and let it carry out the
 * full export end-to-end:
 *
 *   1. Editor calls `export:open-render-window` with { params, seedBytes,
 *      editorWebContentsId } — main stashes the job, spawns the hidden
 *      window, returns the requestId.
 *   2. Render window boots `RenderWindowApp`, calls
 *      `export:fetch-render-job` to claim its job, hydrates a fresh Y.Doc
 *      from seedBytes, mounts a chrome-less canvas at body (0,0).
 *   3. Render window runs the same orchestrator + encoder, but uses ITS
 *      OWN webContents for capture (via `export:capture-rect` — handler
 *      reads `event.sender`).
 *   4. Render window fires `export:render-window-progress` periodically;
 *      main forwards to editor.
 *   5. Render window fires `export:render-window-done` with the final
 *      MP4 / GIF bytes; main forwards to editor, closes the render
 *      window. Editor triggers the download / onBlob callback.
 *   6. On cancel: editor calls `export:cancel-render-window` → main
 *      destroys the render window mid-flight.
 *
 * Why a separate window rather than a hidden iframe / WebContentsView:
 *   - A BrowserWindow has its own Chromium WebContents, its own viewport,
 *     and its own CDP debugger. The editor stays interactive because
 *     they're truly independent processes.
 *   - Sizing is OS-level — `BrowserWindow.setContentSize(W, H)` makes
 *     CDP's `captureBeyondViewport` reliably rasterize the whole DOM
 *     because the DOM fits within the viewport. No special "fitViewportTo"
 *     dance needed.
 *   - The render window can be hidden (`show: false`) the entire time;
 *     the OS still composites it for capture.
 */
interface RenderJob {
  params: {
    format: 'mp4' | 'webm' | 'gif'
    quality: 'comp' | '720p' | '2k' | '4k'
    sceneName: string
    durationSec: number
    frameRate: number
    exportFps: number
    // Output dimensions in CSS pixels. The render window is sized to
    // exactly these dims so the artboard fills the viewport with no
    // chrome and no padding.
    outputWidth: number
    outputHeight: number
    // Range serialized as the inclusive frame pair (single-segment) or
    // multi-segment array. The render window's orchestrator walks it.
    range:
      | { kind: 'full' }
      | { kind: 'time'; startSec: number; endSec: number }
      | { kind: 'frames'; startFrame: number; endFrame: number }
      | {
          kind: 'segments'
          segments: Array<{ startSec: number; endSec: number }>
        }
    filenameTag?: string
  }
  /** `.hype`-style bytes (Y.encodeStateAsUpdate) describing the scene. */
  seedBytes: Uint8Array
  /** WebContents id of the editor window. Used to route progress + done
   *  events back to the right window when multiple are open. */
  editorWebContentsId: number
}

const renderJobs = new Map<string, RenderJob>()
const renderWindows = new Map<string, BrowserWindow>()
const renderWindowWatchdogs = new Map<
  string,
  ReturnType<typeof setTimeout>
>()
const expectedRenderWindowClosures = new Set<string>()

// A healthy render window reports progress after every encoded frame. If it
// stops doing so, keeping an unthrottled 4K WebGL window alive in the
// background can consume an entire CPU/GPU indefinitely. Two minutes still
// leaves ample room for font boot and a very expensive first 4K frame.
const RENDER_WINDOW_STALL_TIMEOUT_MS = 120_000
const RENDER_WINDOW_ENCODING_TIMEOUT_MS = 300_000

function clearRenderWindowWatchdog(requestId: string): void {
  const timeout = renderWindowWatchdogs.get(requestId)
  if (timeout) clearTimeout(timeout)
  renderWindowWatchdogs.delete(requestId)
}

function closeRenderWindow(requestId: string): void {
  clearRenderWindowWatchdog(requestId)
  const win = renderWindows.get(requestId)
  renderWindows.delete(requestId)
  renderJobs.delete(requestId)
  if (win && !win.isDestroyed()) {
    expectedRenderWindowClosures.add(requestId)
    win.destroy()
  } else {
    expectedRenderWindowClosures.delete(requestId)
  }
}

function failRenderWindow(requestId: string, message: string): void {
  if (!renderJobs.has(requestId)) return
  forwardToEditor(requestId, 'export:render-window-error', {
    requestId,
    message,
  })
  closeRenderWindow(requestId)
}

function armRenderWindowWatchdog(
  requestId: string,
  timeoutMs = RENDER_WINDOW_STALL_TIMEOUT_MS,
): void {
  clearRenderWindowWatchdog(requestId)
  if (!renderJobs.has(requestId)) return
  const timeout = setTimeout(() => {
    failRenderWindow(
      requestId,
      'Export worker stopped reporting progress and was closed to restore app performance.',
    )
  }, timeoutMs)
  timeout.unref()
  renderWindowWatchdogs.set(requestId, timeout)
}

function cancelRenderWindowsForEditor(
  editorWebContentsId: number,
  message: string,
): void {
  for (const [requestId, job] of renderJobs) {
    if (job.editorWebContentsId === editorWebContentsId) {
      failRenderWindow(requestId, message)
    }
  }
}

function makeRequestId(): string {
  // Crypto-random short id is overkill for a per-export key. Use the
  // timestamp + small random suffix so logs are scannable.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

ipcMain.handle(
  'export:open-render-window',
  async (
    e,
    payload: {
      params: RenderJob['params']
      seedBytes: Uint8Array
    },
  ): Promise<{ requestId: string }> => {
    const requestId = makeRequestId()
    const editorWebContentsId = e.sender.id
    const existingRender = [...renderJobs.entries()].find(
      ([, job]) => job.editorWebContentsId === editorWebContentsId,
    )
    if (existingRender) {
      throw new Error(
        'An export is already running. Finish or cancel it before starting another.',
      )
    }
    renderJobs.set(requestId, {
      params: payload.params,
      seedBytes: payload.seedBytes,
      editorWebContentsId,
    })

    // Size to EXACTLY the output dimensions. No margin, no chrome — the
    // canvas-root fills the viewport. capturePage / CDP captures the
    // whole window with zero padding.
    const W = Math.max(2, Math.round(payload.params.outputWidth))
    const H = Math.max(2, Math.round(payload.params.outputHeight))

    const win = new BrowserWindow({
      width: W,
      height: H,
      // Hidden — capture works fine on offscreen windows because the
      // compositor still rasterizes them. macOS / Windows / Linux all
      // allow this.
      show: false,
      frame: false,
      // No titlebar, no menu — irrelevant on a hidden window but also
      // ensures setContentSize(W,H) lines up bit-for-bit with the
      // viewport dimensions (no traffic-light area to deduct).
      titleBarStyle: 'default',
      backgroundColor: '#00000000',
      // Allow the window to be larger than the visible display — required
      // when the user requests a 4K export on a 1080p screen.
      useContentSize: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        webSecurity: true,
        // Mandatory — without this, the hidden window's rAF clock
        // throttles to ~1Hz and the frame loop crawls.
        backgroundThrottling: false,
      },
    })
    // Belt-and-suspenders: force the inner content area to match.
    win.setContentSize(W, H)

    renderWindows.set(requestId, win)
    armRenderWindowWatchdog(requestId)

    win.on('closed', () => {
      const expected = expectedRenderWindowClosures.delete(requestId)
      if (!expected && renderJobs.has(requestId)) {
        forwardToEditor(requestId, 'export:render-window-error', {
          requestId,
          message: 'The export worker closed before rendering completed.',
        })
      }
      clearRenderWindowWatchdog(requestId)
      renderWindows.delete(requestId)
      renderJobs.delete(requestId)
    })

    win.on('unresponsive', () => {
      failRenderWindow(
        requestId,
        'The export worker became unresponsive and was closed.',
      )
    })
    win.webContents.on('render-process-gone', (_event, details) => {
      failRenderWindow(
        requestId,
        `The export worker stopped unexpectedly (${details.reason}).`,
      )
    })
    win.webContents.on(
      'did-fail-load',
      (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
        if (!isMainFrame || errorCode === -3) return
        failRenderWindow(
          requestId,
          `The export worker failed to load: ${errorDescription}`,
        )
      },
    )

    // Load the renderer with the render-window flag + requestId. The
    // renderer's main.tsx detects this and mounts <RenderWindowApp>
    // instead of <App>. URL params survive both dev and prod loads.
    try {
      if (VITE_DEV_SERVER_URL) {
        await win.loadURL(
          `${VITE_DEV_SERVER_URL}?render-window=1&requestId=${requestId}`,
        )
      } else {
        await win.loadFile(
          path.join(process.env.DIST_RENDERER!, 'index.html'),
          { query: { 'render-window': '1', requestId } },
        )
      }
      armRenderWindowWatchdog(requestId)
    } catch (error) {
      failRenderWindow(
        requestId,
        `Failed to open the export worker: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      throw error
    }

    return { requestId }
  },
)

ipcMain.handle(
  'export:fetch-render-job',
  (_e, requestId: string): RenderJob['params'] & { seedBytes: Uint8Array } | null => {
    const job = renderJobs.get(requestId)
    if (!job) return null
    // Return params + seedBytes inline so the render window has
    // everything to bootstrap in one round-trip.
    return { ...job.params, seedBytes: job.seedBytes }
  },
)

function forwardToEditor(
  requestId: string,
  channel: string,
  payload: unknown,
): void {
  const job = renderJobs.get(requestId)
  if (!job) return
  // `editorWebContentsId` is a WebContents id (from event.sender.id),
  // not a BrowserWindow id. Look it up via `webContents.fromId` and
  // ship the message there. Falls back to mainWindow's webContents
  // when the original editor window has been closed — keeps the
  // export pipeline functional even after a window swap.
  const editor =
    webContents.fromId(job.editorWebContentsId) ?? mainWindow?.webContents
  if (editor && !editor.isDestroyed()) {
    editor.send(channel, payload)
  }
}

ipcMain.handle(
  'export:render-window-progress',
  (
    _e,
    payload: {
      requestId: string
      phase: string
      frame?: number
      totalFrames?: number
      etaMs?: number
      perFrameMs?: number
    },
  ) => {
    forwardToEditor(payload.requestId, 'export:render-window-progress', payload)
    armRenderWindowWatchdog(
      payload.requestId,
      payload.phase === 'encoding'
        ? RENDER_WINDOW_ENCODING_TIMEOUT_MS
        : RENDER_WINDOW_STALL_TIMEOUT_MS,
    )
  },
)

ipcMain.handle(
  'export:render-window-done',
  (
    _e,
    payload: {
      requestId: string
      bytes: Uint8Array
      fileName: string
      mimeType: string
    },
  ) => {
    forwardToEditor(payload.requestId, 'export:render-window-done', payload)
    clearRenderWindowWatchdog(payload.requestId)
    // Close + clean up the render window. Defer one tick so the
    // forwarded message lands in the editor's queue before we tear
    // down the sender's frame.
    setTimeout(() => {
      closeRenderWindow(payload.requestId)
    }, 50)
  },
)

ipcMain.handle(
  'export:render-window-error',
  (_e, payload: { requestId: string; message: string }) => {
    forwardToEditor(payload.requestId, 'export:render-window-error', payload)
    clearRenderWindowWatchdog(payload.requestId)
    setTimeout(() => {
      closeRenderWindow(payload.requestId)
    }, 50)
  },
)

ipcMain.handle('export:cancel-render-window', (_e, requestId: string) => {
  closeRenderWindow(requestId)
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
 *
 * `file:read` / `file:write` answer with a discriminated result rather
 * than `null` / `false`. fs errors here are the ones users actually
 * hit (read-only volume, ejected drive, deleted recent project) and
 * the reason has to travel back to the renderer — main's console is
 * invisible in a packaged app, so a bare `false` turned a failed save
 * into a no-op the user only noticed after closing the window.
 */
type FileWriteResult = { ok: true } | { ok: false; error: string }
type FileReadResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; error: string }

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

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
  async (): Promise<
    { path: string; bytes: Uint8Array } | { error: string } | null
  > => {
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
      addRecentProject(filePath)
      // Buffer → Uint8Array marshals across IPC.
      return { path: filePath, bytes: new Uint8Array(bytes) }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[file] read failed: ${errorMessage(err)}`)
      return { error: errorMessage(err) }
    }
  },
)

ipcMain.handle(
  'file:write',
  (_e, payload: { path: string; bytes: Uint8Array }): FileWriteResult => {
    try {
      fs.writeFileSync(payload.path, Buffer.from(payload.bytes))
      addRecentProject(payload.path)
      return { ok: true }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[file] write failed: ${errorMessage(err)}`)
      return { ok: false, error: errorMessage(err) }
    }
  },
)

ipcMain.handle(
  'file:read',
  (_e, filePath: string): FileReadResult => {
    try {
      const bytes = fs.readFileSync(filePath)
      addRecentProject(filePath)
      return { ok: true, bytes: new Uint8Array(bytes) }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[file] read failed: ${errorMessage(err)}`)
      removeRecentProject(filePath)
      return { ok: false, error: errorMessage(err) }
    }
  },
)

ipcMain.handle('scene:load-path', (_e, scenePath: string): boolean => {
  if (!mainWindow || mainWindow.webContents.isDestroyed()) return false
  const resolved = path.resolve(scenePath)
  mainWindow.webContents.send('scene:load-path', resolved)
  mainWindow.webContents.send('file:open-path', resolved)
  return true
})

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
  // Keep the Figma development plugin at one stable user-owned path. Figma
  // remembers that path after the user's one-time manifest import, while app
  // updates simply refresh the files in place on the next launch.
  const figmaPluginStatus = prepareInstalledFigmaPlugin()
  if (!figmaPluginStatus.ok) {
    console.warn(`[figma-plugin] ${figmaPluginStatus.message}`)
  }

  // Headless render branch — when the binary was launched with --render,
  // skip the menu + visible window entirely. The renderer carries out the
  // export and signals completion via IPC; the app exits when done.
  const parsed = parseHeadlessArgs(process.argv)
  if (parsed) {
    isHeadlessOnly = true
    headlessRequest = parsed
    // eslint-disable-next-line no-console
    console.log(
      `[headless] rendering ${parsed.scenePath ?? 'current scene'} → ${parsed.outputPath} ` +
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

  loadRecentProjects()
  buildAppMenu()
  pendingOpenScenePath = parseOpenSceneArg(process.argv)
  createMainWindow()
  startUpdateChecks()
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
  const openPath = parseOpenSceneArg(argv)
  if (openPath) {
    pendingOpenScenePath = openPath
    flushPendingOpenScene()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow()
    startUpdateChecks()
  }
})

app.on('before-quit', () => {
  for (const requestId of [...renderJobs.keys()]) {
    closeRenderWindow(requestId)
  }
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer)
    updateCheckTimer = null
  }
})
