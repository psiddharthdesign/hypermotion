// SPDX-License-Identifier: Apache-2.0

type ProcessExitCallback<T> = () => Promise<T> | T

export interface ProcessExitError extends Error {
  exitCode: number
}

export async function withProcessExitThrow<T>(
  run: ProcessExitCallback<T>,
): Promise<T> {
  const previousExit = process.exit
  try {
    process.exit = ((code?: number) => {
      const exitCode = code ?? 0
      const err: ProcessExitError = Object.assign(
        new Error(`process.exit ${exitCode}`),
        {
          exitCode,
        },
      )
      throw err
    }) as typeof process.exit

    return await run()
  } finally {
    process.exit = previousExit
  }
}
