// SPDX-License-Identifier: Apache-2.0

type ProcessExitCallback<T> = () => Promise<T> | T

export async function withProcessExitThrow<T>(
  run: ProcessExitCallback<T>,
): Promise<T> {
  const previousExit = process.exit
  try {
    process.exit = ((code?: number) => {
      throw Object.assign(new Error(`process.exit ${code ?? 0}`), {
        exitCode: code,
      })
    }) as typeof process.exit

    return await run()
  } finally {
    process.exit = previousExit
  }
}
