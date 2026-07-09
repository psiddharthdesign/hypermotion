// SPDX-License-Identifier: Apache-2.0

/**
 * `hypermotion serve [--mcp]`
 *
 * Starts a long-lived server. Today there's one mode:
 *
 *   `--mcp` — Model Context Protocol server over stdio. This is the
 *             integration point for AI coding agents (Claude Code,
 *             Codex). Tool registration lives in `src/mcp/server.ts`.
 *
 * `hypermotion-mcp` is a separate bin that defaults to this mode, so
 * `claude mcp add hypermotion -- hypermotion-mcp` "just works".
 */

import { Command } from 'commander'
import { startMcpServer } from '../mcp/server.js'

interface ServeCommandDeps {
  readonly startServer?: () => Promise<void>
}

type ServeCommandOptions = {
  readonly mcp?: boolean
}

export function serveCommand(deps: ServeCommandDeps = {}): Command {
  const startServer = deps.startServer ?? startMcpServer

  return new Command('serve')
    .description('Start a server (MCP over stdio, for AI agents).')
    .option('--mcp', 'Run as a Model Context Protocol server over stdio')
    .action(async (opts: ServeCommandOptions) => {
      if (!opts.mcp) {
        console.error('[serve] no mode specified. Use --mcp to start the MCP server.')
        process.exit(1)
      }
      await startServer()
    })
}
