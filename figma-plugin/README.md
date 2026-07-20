# Hyper Motion Import — Figma plugin

Copies the current Figma selection as a JSON payload that the Hyper
Motion editor recognizes when pasted. Auto layout, gradients, image
fills, and text styles round-trip; vector shapes get rasterized to
inline SVG.

## Install from the Hyper Motion desktop app

The packaged desktop app includes a built copy of this plugin. Open Hyper
Motion and choose **Figma import** in the top bar, then click **Reveal
manifest**. In the Figma desktop app choose **Plugins → Development → Import
new plugin from manifest…** and select the revealed `manifest.json`.

This is a one-time setup. Hyper Motion keeps the plugin at a stable path in
the user's Application Support data and refreshes those files whenever the
app starts, so application updates do not require importing the plugin again.
No repository checkout or terminal command is needed.

## Install while developing Hyper Motion

1. From this folder:
   ```
   pnpm install
   pnpm build
   ```
   Outputs `dist/code.js` and `dist/ui.html`.
2. In Figma desktop, open any file and choose
   **Plugins → Development → Import plugin from manifest…** then point
   at `figma-plugin/manifest.json`.
3. The plugin appears under **Plugins → Development → Hyper Motion Import**.

For watch mode during plugin work:
```
pnpm watch
```

## Workflow

1. Select one or more layers in Figma.
2. Run **Plugins → Development → Hyper Motion Import**.
3. Click **Copy to Hyper Motion**.
4. Switch to the Hyper Motion editor and press **⌘V**.

## Payload shape

The plugin emits a single JSON object on the clipboard:

```jsonc
{
  "format": "hyper-motion/figma",
  "version": 1,
  "nodes": [
    /* one entry per top-level selected node */
  ],
  "assets": {
    /* image-fill bytes, base64 PNG, keyed by Figma's imageHash */
  }
}
```

The schema is mirrored on the Hyper Motion side at
`src/import/figma/types.ts`. Both files declare the same
`format`/`version` constants — bumping one without the other will be
caught by the importer's version check, which logs a warning and
refuses the paste.

## Limits

- **Vectors** (VECTOR / STAR / POLYGON / BOOLEAN / LINE) round-trip as
  inline SVG image fills, not editable paths.
- **Components and variants**: instances flatten to plain frames in
  v1; the master/variant relationship isn't preserved.
- **Per-corner radii**: collapsed to the average until Hyper Motion's
  scene model carries per-corner values.
- **Stacked fills**: Figma can layer paints; we take the first visible
  fill. Stacked fills become a follow-up.
- **Mixed text runs**: the first run's font/size drive the imported
  text. Mixed-style text within a single layer hits its first style.

## Known sharp edges

- The clipboard write requires the Figma plugin window to be focused.
  If the OS dropped focus during the capture, click **Copy** again.
- Big image fills make the payload large; copies above ~5 MB sometimes
  get rejected by the clipboard. Compress images in Figma before
  copying for now — chunked transport via `chrome.storage.local`
  bridge is a planned follow-up.
