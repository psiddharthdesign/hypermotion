// SPDX-License-Identifier: Apache-2.0

type ProcessExitCallback<T> = () => Promise<T> | T
type ProcessExitCode = Parameters<typeof process.exit>[0]
type NormalizedProcessExitCode = Exclude<ProcessExitCode, null | undefined>

export interface ProcessExitError extends Error {
  readonly exitCode: NormalizedProcessExitCode
}

export async function withProcessExitThrow<T>(
  run: ProcessExitCallback<T>,
): Promise<T> {
  const previousExit = process.exit
  try {
    process.exit = ((code?: ProcessExitCode) => {
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
