# Hyper Motion Test Plan

This is the starting test map. The goal is to grow from fast, deterministic checks into full render coverage without making every pull request depend on the desktop app or video export stack.

## Phase 1: CLI Scene Data

- Build `.hype` bytes from agent-authored JSON.
- Read `.hype` summaries for `info` and MCP `info_scene`.
- Validate scene references: root, camera, parent-child links, track node IDs.
- Apply scene patches for create, delete, move, metadata, tracks, and sections.

These tests run in Node only and are safe for GitHub Actions.

## Phase 2: CLI Commands

- `create` accepts JSON from stdin and files, creates parent directories, and reports layer/track counts.
- `info --json` returns stable machine-readable output.
- `validate` exits non-zero for malformed scenes.
- `render` rejects invalid format, quality, FPS, and missing scene paths before launching Electron.

Command tests should stub app discovery/rendering rather than launching the desktop app.

## Phase 3: MCP Tools

- `create_scene`, `info_scene`, and `validate_scene` return structured MCP content.
- `render_scene` validates inputs and forwards the expected render options.
- Tool errors are useful to agents and do not expose stack traces for expected user mistakes.

## Phase 4: Desktop Integration

- Load `.hype` files created by the CLI into the editor without schema repair.
- Exercise headless render argument parsing, including `--key=value` second-instance argv.
- Smoke render a tiny scene on macOS once the runner can install or build the app.

## Phase 5: Render Correctness

- Golden-frame checks for layout, text, fills, masks, camera, and keyframed transforms.
- Export smoke tests for MP4, WebM, and GIF.
- Regression clips for known failures such as missing nested defaults, IndexedDB lock handling, and sentinel cleanup.
