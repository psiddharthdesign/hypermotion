# hyper-motion — desktop wrapper

Electron wrapper around [hyper-motion](https://github.com/psiddharthdesign/hypermotion).
Ships the same web app as a Mac `.dmg` and Windows `.exe`. The renderer
in `src/` is byte-identical to the web tree — this repo only adds
`electron/main.ts` + `electron/preload.ts` and the build glue.

## Why a desktop wrapper at all

The web build runs everywhere via Chromium, but the desktop wrapper unlocks
two things the browser can't:

- **Pixel-correct HQ export.** `webContents.capturePage(rect)` reads the
  rendered artboard at device-pixel resolution. No `getDisplayMedia`
  picker, no tab-share confirmation, no screen-pixel-ratio constraints.
- **Native file I/O.** Save and open `.arnimotion` files through the
  system dialog instead of the browser's download/upload jail.

PWA build is still the primary distribution path for v0.x. The desktop
wrapper is for users who want the polish.

## Run

```sh
pnpm install
pnpm dev          # Vite + Electron, hot reload on renderer + main
```

## Build

```sh
pnpm build        # current OS
pnpm build:mac    # macOS arm64 + x64 dmg
pnpm build:win    # Windows x64 + arm64 nsis
pnpm build:dir    # unpacked, for fast local iteration
```

Outputs land in `release/`.

## Releases

Tag pushes to `v*` (e.g. `v0.1.0`) trigger
[`.github/workflows/release.yml`](.github/workflows/release.yml), which
builds the DMG and EXE on GitHub-hosted macOS / Windows runners and
publishes them to a GitHub Release. You don't need to build on your
laptop — just tag and push:

```sh
git tag v0.1.0
git push origin v0.1.0
```

The v0.1.x series ships **unsigned**. macOS users see a Gatekeeper
warning on first open; right-click the app → Open to bypass. Signing
+ notarization come once an Apple Developer cert is wired up (set
`CSC_LINK` + `CSC_KEY_PASSWORD` repo secrets, flip
`CSC_IDENTITY_AUTO_DISCOVERY` to true in the workflow).

## Layout

```
electron/
  main.ts         window lifecycle, dev/prod load, capturePage IPC
  preload.ts      window.hypermotion bridge — platform info + invoke
src/              the renderer — same as the upstream hyper-motion repo
public/
build/            app icon (icon.png is the source of truth)
.github/          CI + release workflows, issue + PR templates
```

The web app's invariants apply unchanged — keyframes target semantic
properties, scene → layout → render flows one way, no animation
library. See the upstream [CLAUDE.md](https://github.com/psiddharthdesign/hypermotion/blob/main/CLAUDE.md).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) and the upstream contribution
guide. Behavior is governed by the [Code of Conduct](./CODE_OF_CONDUCT.md).

## License

Licensed under the [Apache License, Version 2.0](./LICENSE). See
[NOTICE](./NOTICE) for the copyright statement and third-party
attribution.

Copyright 2026 Siddharth Ponnapalli.
