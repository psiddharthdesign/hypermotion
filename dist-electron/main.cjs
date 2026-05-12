//#region \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
//#endregion
let electron = require("electron");
let node_path = require("node:path");
node_path = __toESM(node_path, 1);
let node_fs = require("node:fs");
node_fs = __toESM(node_fs, 1);
//#region electron/main.ts
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
function parseHeadlessArgs(argv) {
	if (!argv.includes("--render")) return null;
	function flag(name) {
		const i = argv.indexOf(name);
		return i >= 0 && i + 1 < argv.length ? argv[i + 1] : void 0;
	}
	const outputPath = flag("--out");
	if (!outputPath) return null;
	const scenePath = flag("--scene");
	const format = flag("--format") ?? inferFormat(outputPath);
	const quality = flag("--quality") ?? "comp";
	const fps = Number(flag("--fps") ?? "30");
	return {
		scenePath: scenePath ? node_path.default.resolve(scenePath) : void 0,
		outputPath: node_path.default.resolve(outputPath),
		format,
		quality,
		fps: Number.isFinite(fps) && fps > 0 ? fps : 30
	};
}
function inferFormat(outPath) {
	const ext = node_path.default.extname(outPath).toLowerCase().slice(1);
	if (ext === "mp4" || ext === "webm" || ext === "gif") return ext;
	return "mp4";
}
var headlessRequest = null;
process.env.DIST_ELECTRON = node_path.default.join(__dirname);
process.env.DIST_RENDERER = node_path.default.join(__dirname, "../dist");
process.env.VITE_PUBLIC = electron.app.isPackaged ? process.env.DIST_RENDERER : node_path.default.join(process.env.DIST_ELECTRON, "../public");
var VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
var mainWindow = null;
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
	const isMac = process.platform === "darwin";
	const template = [
		...isMac ? [{
			label: "hyper-motion",
			submenu: [
				{ role: "about" },
				{ type: "separator" },
				{ role: "services" },
				{ type: "separator" },
				{ role: "hide" },
				{ role: "hideOthers" },
				{ role: "unhide" },
				{ type: "separator" },
				{ role: "quit" }
			]
		}] : [],
		{
			label: "File",
			submenu: [isMac ? { role: "close" } : { role: "quit" }]
		},
		{
			label: "Edit",
			submenu: [
				{ role: "undo" },
				{ role: "redo" },
				{ type: "separator" },
				{ role: "cut" },
				{ role: "copy" },
				{ role: "paste" },
				...isMac ? [
					{ role: "pasteAndMatchStyle" },
					{ role: "delete" },
					{ role: "selectAll" }
				] : [
					{ role: "delete" },
					{ type: "separator" },
					{ role: "selectAll" }
				]
			]
		},
		{
			label: "View",
			submenu: [
				{ role: "reload" },
				{ role: "forceReload" },
				{ role: "toggleDevTools" },
				{ type: "separator" },
				{ role: "resetZoom" },
				{ role: "zoomIn" },
				{ role: "zoomOut" },
				{ type: "separator" },
				{ role: "togglefullscreen" }
			]
		},
		{
			label: "Window",
			submenu: [
				{ role: "minimize" },
				{ role: "zoom" },
				...isMac ? [
					{ type: "separator" },
					{ role: "front" },
					{ type: "separator" },
					{ role: "window" }
				] : [{ role: "close" }]
			]
		}
	];
	electron.Menu.setApplicationMenu(electron.Menu.buildFromTemplate(template));
}
function createMainWindow() {
	mainWindow = new electron.BrowserWindow({
		title: "hyper-motion",
		width: 1440,
		height: 900,
		minWidth: 960,
		minHeight: 600,
		backgroundColor: "#1a1a1f",
		titleBarStyle: "default",
		webPreferences: {
			preload: node_path.default.join(__dirname, "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
			webSecurity: true,
			backgroundThrottling: false
		}
	});
	mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
		callback(new Set([
			"clipboard-read",
			"clipboard-sanitized-write",
			"fullscreen",
			"media",
			"display-capture",
			"pointerLock"
		]).has(permission));
	});
	mainWindow.webContents.session.setDisplayMediaRequestHandler(async (_request, callback) => {
		try {
			const sources = await electron.desktopCapturer.getSources({
				types: ["window"],
				thumbnailSize: {
					width: 0,
					height: 0
				}
			});
			const targetTitle = mainWindow?.getTitle() ?? "hyper-motion";
			const source = sources.find((s) => s.name === targetTitle) ?? sources[0];
			if (source) callback({ video: source });
			else callback({});
		} catch (err) {
			console.error("[main] desktopCapturer.getSources failed:", err);
			callback({});
		}
	});
	if (VITE_DEV_SERVER_URL) {
		mainWindow.loadURL(VITE_DEV_SERVER_URL);
		if (process.env.OPEN_DEVTOOLS === "1") mainWindow.webContents.openDevTools({ mode: "bottom" });
	} else mainWindow.loadFile(node_path.default.join(process.env.DIST_RENDERER, "index.html"));
	mainWindow.webContents.on("did-finish-load", () => {
		mainWindow?.focus();
	});
	mainWindow.webContents.setWindowOpenHandler(({ url }) => {
		if (url.startsWith("http:") || url.startsWith("https:")) electron.shell.openExternal(url);
		return { action: "deny" };
	});
	mainWindow.on("closed", () => {
		mainWindow = null;
	});
}
electron.ipcMain.handle("clipboard:readText", () => electron.clipboard.readText());
electron.ipcMain.handle("clipboard:writeText", (_e, text) => {
	electron.clipboard.writeText(text);
});
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
electron.ipcMain.handle("export:capture-rect", async (_e, rect) => {
	const wc = mainWindow?.webContents;
	if (!wc) throw new Error("export:capture-rect — no active webContents");
	const r = {
		x: Math.max(0, Math.round(rect.x)),
		y: Math.max(0, Math.round(rect.y)),
		width: Math.max(1, Math.round(rect.width)),
		height: Math.max(1, Math.round(rect.height))
	};
	return (await wc.capturePage(r)).toPNG();
});
electron.ipcMain.handle("export:set-zoom-factor", (_e, factor) => {
	const wc = mainWindow?.webContents;
	if (!wc) return;
	const f = Math.max(.25, Math.min(5, factor));
	wc.setZoomFactor(f);
});
electron.ipcMain.handle("export:get-zoom-factor", () => {
	const wc = mainWindow?.webContents;
	return wc ? wc.getZoomFactor() : 1;
});
/**
* Headless render IPC handlers.
*
* The renderer pulls the request via `export:headless-request`, kicks off
* its export pipeline, and reports completion via `export:headless-done`
* (with the rendered bytes) or `export:headless-error` (with a message).
* On either, we write the file / log the error and exit.
*/
electron.ipcMain.handle("export:headless-request", () => headlessRequest);
electron.ipcMain.handle("export:headless-done", async (_e, payload) => {
	try {
		node_fs.default.writeFileSync(payload.outputPath, Buffer.from(payload.bytes));
		console.log(`[headless] wrote ${payload.outputPath}`);
		electron.app.exit(0);
	} catch (err) {
		console.error(`[headless] failed to write output: ${err instanceof Error ? err.message : err}`);
		electron.app.exit(1);
	}
});
electron.ipcMain.handle("export:headless-error", (_e, message) => {
	console.error(`[headless] renderer reported error: ${message}`);
	electron.app.exit(1);
});
electron.app.whenReady().then(() => {
	headlessRequest = parseHeadlessArgs(process.argv);
	if (headlessRequest) {
		console.log(`[headless] rendering ${headlessRequest.scenePath} → ${headlessRequest.outputPath} (${headlessRequest.format} · ${headlessRequest.quality} · ${headlessRequest.fps}fps)`);
		createMainWindow();
		if (mainWindow) mainWindow.hide();
		return;
	}
	buildAppMenu();
	createMainWindow();
});
electron.app.on("window-all-closed", () => {
	if (process.platform !== "darwin") electron.app.quit();
});
electron.app.on("activate", () => {
	if (electron.BrowserWindow.getAllWindows().length === 0) createMainWindow();
});
//#endregion
