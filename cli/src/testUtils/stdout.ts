// SPDX-License-Identifier: Apache-2.0

export async function captureStdout(run: () => Promise<void>): Promise<string> {
  let stdout = ''
  const write = process.stdout.write
  process.stdout.write = ((
    value: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | ((err?: Error) => void),
    callback?: (err?: Error) => void,
  ) => {
    stdout += value.toString()
    const done =
      typeof encodingOrCallback === 'function' ? encodingOrCallback : callback
    done?.()
    return true
  }) as typeof process.stdout.write
  try {
    await run()
  } finally {
    process.stdout.write = write
  }
  return stdout
}
