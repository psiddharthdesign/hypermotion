# Contributing to hyper-motion

Thanks for your interest. hyper-motion is open source under the Apache
License 2.0 and we welcome contributions of all sizes — bug reports,
feature ideas, doc fixes, and code.

## Quick start

```sh
pnpm install
pnpm dev      # Vite dev server, http://localhost:5173
pnpm build    # tsc + vite build
pnpm lint     # eslint
```

Node 20+ and pnpm 9+. If you don't have pnpm: `corepack enable && corepack prepare pnpm@latest --activate`.

## Architecture invariants

Read [CLAUDE.md](./CLAUDE.md) first — it documents the load-bearing
design rules. The two that matter most:

1. **Keyframes target semantic properties, not coordinates.** Animate
   `variant`, `opacity`, `scale`, `flex gap`, `padding` — never raw
   `x` / `y` on a child of an auto-layout parent.
2. **Imports flow one way:** `ui` → `state` → `anim` → `render` →
   `layout` → `scene`. Never reverse.

If your PR fights either of these, please open an issue first to
discuss the trade-off.

## How to submit a change

1. Fork the repo and create a branch off `main`:
   `git checkout -b your-name/short-description`
2. Make your changes. Keep PRs focused — one concern per PR.
3. Run `pnpm build` to confirm `tsc -b` is clean. We don't have a unit
   test suite yet (coming), so the type checker is the first gate.
4. Run `pnpm lint` and fix any warnings you introduced. Pre-existing
   warnings are fine to leave; don't churn unrelated files.
5. Commit with a clear message. Conventional Commits prefixes (`feat:`,
   `fix:`, `chore:`, etc.) are nice but not required.
6. Open a pull request against `main`. Reference any related issue.
7. CI runs tsc on every PR. A maintainer will review within a few days.

## Reporting bugs

Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md).
Include: what you did, what you expected, what happened, your OS +
browser, and a minimal repro (a `.arnimotion` file or short screen
recording works great).

## Proposing features

Use the [feature request template](.github/ISSUE_TEMPLATE/feature_request.md).
For anything larger than a small UX fix, please open an issue first
before writing code — the architecture has strong opinions and a quick
conversation saves rework.

## License & contributions

By contributing, you agree your contribution is licensed under the
Apache License 2.0 (the same license as the project). Apache 2.0
includes an automatic patent grant from contributors to users — see
LICENSE §3 for the full text. You retain copyright over your own
contributions; we don't require a CLA.

If your employer has policies about open-source contributions, please
make sure you're cleared to contribute before submitting code.

## Code of conduct

This project follows the [Contributor Covenant 2.1](./CODE_OF_CONDUCT.md).
Be kind, assume good faith, and we'll all build something great
together.
