#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import('../dist/cli.js').catch((err) => {
  console.error('[hypermotion] failed to load CLI:', err)
  process.exit(1)
})
