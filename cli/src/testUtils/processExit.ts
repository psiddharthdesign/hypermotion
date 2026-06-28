// SPDX-License-Identifier: Apache-2.0

type ProcessExitCallback = () => Promise<void> | void

export async function withProcessExitThrow(
  run: ProcessExitCallback,
): Promise<void> {
  const previousExit = process.exit
  try {
    process.exit = ((code?: number) => {
      throw Object.assign(new Error(`process.exit ${code ?? 0}`), {
        exitCode: code,
      })
    }) as typeof process.exit

    await run()
  } finally {
    process.exit = previousExit
  }
}
