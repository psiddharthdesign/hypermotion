// SPDX-License-Identifier: Apache-2.0

/**
 * `hypermotion info <scene>` — read a `.arnimotion` scene file and print
 * a summary.
 *
 * v0.1.0 status: the `.arnimotion` file format itself isn't shipped yet
 * (scenes are auto-persisted to IndexedDB inside the desktop app). This
 * command exits with a clean explanatory message; full support arrives
 * with the file format in v0.1.1.
 */

import { Command } from 'commander'

export function infoCommand(): Command {
  return new Command('info')
    .description(
      'Read a scene file and print a summary. (v0.1.1 — file format is ' +
        "in flight; in v0.1.0 this command isn't wired up yet.)",
    )
    .argument('[scene]', 'Path to a .arnimotion scene file (v0.1.1)')
    .action(() => {
      console.error(
        '[info] not yet implemented in v0.1.0.\n\n' +
          'The .arnimotion file format ships in v0.1.1 alongside File → Save / Open\n' +
          'in the desktop app. Once that lands, `hypermotion info <scene>` will print\n' +
          'canvas size, duration, layer count, animated-track count, and chapters.\n\n' +
          'For now, inspect scenes from the desktop app UI.',
      )
      process.exit(2)
    })
}
