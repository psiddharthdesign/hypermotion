let electron = require("electron");
//#region electron/preload.ts
/**
* Preload bridge.
*
* The renderer is the unmodified hyper-motion web app — it doesn't import
* any Electron APIs directly. We expose a tiny, opt-in surface on
* `window.hypermotion` that future native integrations (file save,
* notarized H.264 export, system tray) can build on without weakening
* the renderer's sandbox.
*
* Today this exposes:
*  - platform / version info (so UI can branch on Mac vs Win for
*    keyboard hints, traffic-light insets, etc.)
*  - a clipboard read bridge (so paste flows like Figma payload import
*    can read the OS clipboard reliably — `navigator.clipboard.readText`
*    in the Electron renderer returns empty under default permissions)
*  - a generic invoke pinhole for future channels
*/
electron.contextBridge.exposeInMainWorld("hypermotion", {
	platform: process.platform,
	isElectron: true,
	versions: {
		electron: process.versions.electron,
		chrome: process.versions.chrome,
		node: process.versions.node
	},
	clipboard: {
		readText: () => electron.ipcRenderer.invoke("clipboard:readText"),
		writeText: (text) => electron.ipcRenderer.invoke("clipboard:writeText", text)
	},
	invoke: (channel, ...args) => electron.ipcRenderer.invoke(channel, ...args)
});
//#endregion
