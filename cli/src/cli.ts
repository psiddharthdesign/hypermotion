// SPDX-License-Identifier: Apache-2.0

/**
 * Main CLI entry point.
 *
 * Two ways this binary is invoked:
 *
 *   `hypermotion <subcommand>` — interactive CLI for humans (render, info,
 *                                  serve).
 *   `hypermotion-mcp`          — alias that calls `hypermotion serve --mcp`,
 *                                  used by AI coding agents (Claude Code,
 *                                  Codex) over stdio.
 *
 * The renderer itself lives in the Electron desktop app. The CLI's `render`
 * command shells out to the installed hyper-motion app with the `--render`
 * flag, which the desktop app handles in `electron/main.ts`. See
 * `electron/driver.ts` for the spawn glue.
 */

import { Command } from 'commander'
import { renderCommand } from './commands/render.js'
import { infoCommand } from './commands/info.js'
import { createCommand } from './commands/create.js'
import { serveCommand } from './commands/serve.js'

const PKG_VERSION = '0.1.2'

const program = new Command()

program
  .name('hypermotion')
  .description(
    'CLI + MCP server for hyper-motion. Render scenes from the terminal, ' +
      'and let AI coding agents (Claude Code, Codex) drive motion sequences ' +
      'programmatically.',
  )
  .version(PKG_VERSION, '-v, --version', 'output the current version')

program.addCommand(renderCommand())
program.addCommand(infoCommand())
program.addCommand(createCommand())
program.addCommand(serveCommand())

// Surface unknown commands cleanly instead of a stack trace.
program.showHelpAfterError('(use --help for available commands)')

program.parseAsync().catch((err) => {
  console.error('\n[hypermotion] fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
