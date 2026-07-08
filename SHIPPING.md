# Shipping v0.1.0 — what's left for you to do

Two GitHub repos. Everything in this checklist is **manual stuff that
needs your machine, your credentials, or your judgment**. Code is in
place; this is the execution layer.

```
psiddharthdesign/hypermotion          ← this folder (electron app, CLI, MCP)
psiddharthdesign/hypermotion-landing  ← hyper-motion-landing-site/
```

The web tree at `~/Github/hyper-motion/` is a **local sync mirror** —
not pushed publicly. It stays byte-identical to this tree's `src/` for
your own dev convenience.

---

## 1. Fix git auth (once, 60 seconds)

You hit "Password authentication is not supported" earlier. Pick one:

```sh
# Path A — gh CLI (recommended)
brew install gh
gh auth login                       # GitHub.com → HTTPS → web browser

# Path B — Personal Access Token
# https://github.com/settings/tokens/new → tick "repo" → generate
# Use the ghp_... token as your password when git prompts.
```

---

## 2. Push the two repos

### 2a. Push the desktop app + CLI → `hypermotion`

```sh
cd ~/Github/hyper-motion-electron
git init                                                   # if not already
git add .
git commit -m "chore: initial public commit (Apache 2.0)"
git branch -M main
git remote add origin https://github.com/psiddharthdesign/hypermotion.git
# If a previous failed attempt left a remote: replace `add` with `set-url`
git push -u origin main
```

What lands in this repo: the desktop app (src/, electron/), the CLI +
MCP server (cli/), all the Apache licensing (LICENSE, NOTICE,
CONTRIBUTING, CODE_OF_CONDUCT), the GitHub Actions release workflow,
RELEASES.md, README. Everything that's the actual product.

### 2b. Push the landing → `hypermotion-landing`

```sh
cd ~/Github/hyper-motion-landing-site
git init
git add .
git commit -m "chore: initial commit (Apache 2.0)"
git branch -M main
git remote add origin https://github.com/psiddharthdesign/hypermotion-landing.git
git push -u origin main
```

---

## 3. Build & test the DMG locally

GitHub Actions can build the DMG remotely once the repo is up, but you
should validate locally first.

```sh
cd ~/Github/hyper-motion-electron
pnpm install
pnpm build:dir                      # fastest path — unpacked .app
# Opens release/mac-arm64/hyper-motion.app — drag/launch to test
```

If the unpacked app launches cleanly:

```sh
pnpm build:mac                      # produces release/*.dmg
open release                        # finder window
# Open the .dmg, drag to Applications, launch.
# First open on a fresh Mac: right-click → Open (Gatekeeper warning — unsigned)
```

The console-on-load issue is fixed — `pnpm dev` no longer auto-opens
DevTools. To see DevTools: `OPEN_DEVTOOLS=1 pnpm dev`, or Cmd+Opt+I, or
View → Toggle Developer Tools.

---

## 4. Build & test the CLI

```sh
cd ~/Github/hyper-motion-electron/cli
pnpm install
pnpm build                          # tsc → dist/
```

Smoke test:

```sh
node ./bin/hypermotion.mjs --help
node ./bin/hypermotion.mjs --version           # → 0.1.0
node ./bin/hypermotion.mjs render --help
```

End-to-end render test (the headline feature):

```sh
# 1. Install hyper-motion to /Applications from step 3
# 2. Open it, design a quick scene, let it auto-save
# 3. Quit the app
# 4. From terminal:
cd ~/Github/hyper-motion-electron/cli
node ./bin/hypermotion.mjs render -o ~/Desktop/demo.mp4
# Watch for `[headless] ✓ rendered N bytes — shipping to main`
```

If it works → headline CLI feature is live.

If it fails, likely causes:
- App not at `/Applications/hyper-motion.app/...` → `export HYPERMOTION_APP_PATH=...`
- Off-screen window doesn't load → check stderr for the actual error; the
  renderer might be exiting before bootHeadlessExport runs
- Long export hangs → try a 1-second scene first to validate the wire,
  then scale up

---

## 5. Wire MCP into Claude Code

Only after step 4 validates render works:

```sh
cd ~/Github/hyper-motion-electron/cli
pnpm link --global                  # exposes hypermotion + hypermotion-mcp on PATH

claude mcp add hypermotion -- hypermotion-mcp
```

In Claude Code, the agent now has access to `render_scene` (works) and
`info_scene` (returns clean v0.1.1 stub). Ask the agent to render the
current scene to `~/Desktop/test.mp4`.

For Codex CLI, add to `~/.codex/config.toml`:

```toml
[mcp_servers.hypermotion]
command = "hypermotion-mcp"
```

---

## 6. Publish CLI to npm

After step 4 + 5 validate everything works:

```sh
cd ~/Github/hyper-motion-electron/cli
npm login                           # if not already
pnpm publish --access public        # scoped package needs --access public on first publish
```

Package name: `@psiddharthdesign/hypermotion`. After publish, anyone
installs with `npm i -g @psiddharthdesign/hypermotion`.

---

## 7. Tag v0.1.0 — trigger the release workflow

After step 2 (repo pushed) and step 3 (local DMG works):

```sh
cd ~/Github/hyper-motion-electron
git tag v0.1.0
git push origin v0.1.0
```

This triggers `.github/workflows/release.yml` on GitHub Actions:
- Builds DMG on `macos-latest` (15-20 min)
- Builds EXE on `windows-latest` (15-20 min)
- Creates Release at `psiddharthdesign/hypermotion/releases/tag/v0.1.0`
- Attaches both binaries

Watch progress at https://github.com/psiddharthdesign/hypermotion/actions.

If the workflow fails, likely cause: missing app icon (see backlog 9a).

---

## 8. Deploy the landing site

```sh
cd ~/Github/hyper-motion-landing-site
pnpm install
pnpm build                          # validate clean build
pnpm dev                            # http://localhost:3000 — visual sanity check
```

### 8a. Vercel (easiest path)

```sh
npm i -g vercel    # if not already
cd ~/Github/hyper-motion-landing-site
vercel             # interactive; pick "Link to GitHub repo" → hypermotion-landing
vercel --prod      # ships to production
```

Or skip CLI: connect the repo at vercel.com → New Project → Import.
Vercel auto-detects Next.js, no config needed.

### 8b. Cloudflare Pages (if you prefer)

Dashboard: Pages → Create application → Connect to Git → pick
`hypermotion-landing`. Build command: `pnpm build`. Output: `.next`.
Preset: Next.js.

For App Router on Cloudflare:
```sh
pnpm add -D @cloudflare/next-on-pages
```
And update the build command to `pnpm next-on-pages` with output dir
`.vercel/output/static`.

---

## 9. Wire `hypermotion.app` to the landing

After step 8 deployment is live:

**Vercel:** Project Settings → Domains → Add `hypermotion.app` → follow
DNS instructions. Apex usually needs an A record to `76.76.21.21`.

**Cloudflare Pages:** Custom Domains → Set up a custom domain →
`hypermotion.app`. If your DNS is also on Cloudflare, CNAME is auto-
provisioned.

Allow 10-30 min for DNS propagation. Both platforms auto-provision
Let's Encrypt SSL.

---

## 10. Backlog — deferred from v0.1.0

Tracked items for v0.1.1+:

### 10a. App icon
`build/icon.png` doesn't exist. electron-builder uses a default
(ugly) icon. Drop a 1024×1024 PNG at `build/icon.png` and
electron-builder auto-generates `.icns` and `.ico`.

### 10b. Code signing
Currently unsigned. Mac users see Gatekeeper warning on first open.
To sign:
1. Apple Developer cert ($99/yr)
2. Export to `.p12`, base64 encode
3. Add as GitHub secrets: `CSC_LINK` (base64) and `CSC_KEY_PASSWORD`
4. In `.github/workflows/release.yml`, flip `CSC_IDENTITY_AUTO_DISCOVERY: false` → `true`
5. Optional: notarize with `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD`

### 10c. `.arnimotion` file format
The CLI's `info` and the `info_scene` MCP tool return clean "not yet"
messages because there's no file format. To build it (~2-3 hours):
- Y.Doc serialize: `Y.encodeStateAsUpdate(doc)`
- Y.Doc deserialize: `Y.applyUpdate(doc, bytes)`
- File → Save / Open menu items in `electron/main.ts`
- `fs:readFile` + `fs:writeFile` IPC handles
- Honor `--scene <path>` in `parseHeadlessArgs`

### 10d. CLI `--scene <path>` support
Once 10c is done, `src/headlessExport.ts` reads the file via
`window.hypermotion.invoke('fs:readFile', req.scenePath)`, hydrates a
fresh Y.Doc via `Y.applyUpdate`, exports. The existing `onBlob` path
already handles the rest.

### 10e. info_scene MCP tool
Once 10c is done, trivial: read the file, run `snapshotScene(api)`,
return as JSON.

### 10f. Web tree mirror
`~/Github/hyper-motion/` stays as a local-only mirror of this tree's
`src/`. Optional convenience: a one-line `rsync` or git hook to auto-
mirror on every push. Skip until you actually need it.

---

## Quick verification checklist

When you're ready to declare v0.1.0 done:

- [ ] `psiddharthdesign/hypermotion` repo visible, README renders correctly
- [ ] `psiddharthdesign/hypermotion-landing` repo visible
- [ ] Both repos show "Apache-2.0" license badge
- [ ] DMG builds locally (`pnpm build:mac`)
- [ ] DMG launches, sample scene loads
- [ ] DevTools doesn't auto-open
- [ ] CLI builds clean (`cd cli && pnpm install && pnpm build`)
- [ ] `hypermotion render -o test.mp4` writes a valid MP4
- [ ] `claude mcp add hypermotion -- hypermotion-mcp` succeeds
- [ ] Agent renders a scene via `render_scene` tool
- [ ] Landing site deploys, `hypermotion.app` resolves with SSL
- [ ] Tag `v0.1.0` triggers Actions, Release shows DMG + EXE assets
- [ ] (Optional) CLI published to npm

---

## What's already done in this session (autonomous work)

**Apache 2.0 compliance (full):**
- LICENSE — full Apache 2.0 text (verbatim from apache.org)
- NOTICE — copyright + third-party attribution
- SPDX header on every TypeScript file (`// SPDX-License-Identifier: Apache-2.0`, 182 files)
- `"license": "Apache-2.0"` in package.json
- CONTRIBUTING.md
- CODE_OF_CONDUCT.md (Contributor Covenant 2.1)
- License section in READMEs

**Repo plumbing:**
- `.github/ISSUE_TEMPLATE/` (bug report, feature request, config)
- `.github/PULL_REQUEST_TEMPLATE.md`
- `.github/workflows/ci.yml` — tsc + lint on every PR
- `.github/workflows/release.yml` — DMG + EXE on tag push
- `RELEASES.md` — v0.1.0 release notes draft
- README rewritten for public

**Headless render integration (the heavy lift):**
- `electron/main.ts` — argv parser for `--render --out --format --quality --fps`
- IPC handlers (`export:headless-request`, `…-done`, `…-error`)
- Hidden window when `--render` is passed
- DevTools no longer auto-opens on `pnpm dev` (set `OPEN_DEVTOOLS=1` to enable)
- `src/scene/index.ts` — exposes `apiReady` for non-React callers
- `src/export/orchestrator.ts` — added `onBlob` interceptor on `ExportSceneContext`
- `src/export/recordTab.ts` — same `onBlob` hook for WebM tab capture
- `src/headlessExport.ts` — waits for `apiReady`, runs `exportScene()` with onBlob, ships bytes via IPC
- `src/main.tsx` — calls `bootHeadlessExport()` outside the React tree

**CLI + MCP server (`cli/`):**
- Complete TypeScript scaffold (package.json, tsconfig, .gitignore)
- `bin/hypermotion.mjs` + `bin/hypermotion-mcp.mjs`
- `src/cli.ts` — commander-based CLI entry
- `src/commands/render.ts` — renders current scene
- `src/commands/info.ts` — v0.1.1 stub with clear message
- `src/commands/serve.ts` — starts MCP server
- `src/mcp/server.ts` — MCP stdio server with `render_scene` + `info_scene` tools
- `src/electron/locator.ts` — finds installed desktop app cross-platform
- `cli/src/electron/driver.ts` — spawns it with headless flags
- README, LICENSE, NOTICE

**Landing site (`hyper-motion-landing-site/`):**
- Next.js 15 + Tailwind v4 scaffold
- `app/layout.tsx` with full SEO + Open Graph metadata
- `app/page.tsx` — single-page: nav, hero, problem, vision, features, AI section, status banner, footer
- `app/globals.css` — design tokens mirroring the desktop app palette
- `public/favicon.svg` — gradient monogram placeholder
- README, LICENSE, NOTICE

**Verification:**
- tsc clean at pre-existing baseline (49 errors in electron tree, no new errors introduced)
- All file writes succeeded

Total: ~30 files created / significantly modified, ~3500 lines added.
