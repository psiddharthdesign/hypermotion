#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Shim that launches the MCP server directly. Equivalent to
// `hypermotion serve --mcp` but is its own binary so AI agent configs can
// reference it without `serve --mcp` plumbing:
//
//   claude mcp add hypermotion -- hypermotion-mcp
//
// or in ~/.codex/config.toml:
//
//   [mcp_servers.hypermotion]
//   command = "hypermotion-mcp"

import('../dist/mcp/server.js')
  .then(({ startMcpServer }) => startMcpServer())
  .catch((err) => {
    console.error('[hypermotion-mcp] failed to start:', err)
    process.exit(1)
  })
