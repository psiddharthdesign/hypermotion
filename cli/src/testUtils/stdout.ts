// SPDX-License-Identifier: Apache-2.0

export async function captureStdout(run: () => Promise<void>): Promise<string> {
  let stdout = ''
  const write = process.stdout.write
  process.stdout.write = ((
    chunk: Parameters<typeof process.stdout.write>[0],
    encodingOrCallback?: Parameters<typeof process.stdout.write>[1],
    callback?: Parameters<typeof process.stdout.write>[2],
  ) => {
    stdout += chunk.toString()
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

export async function captureStderr(run: () => Promise<void>): Promise<string> {
  let stderr = ''
  const write = process.stderr.write
  process.stderr.write = ((
    chunk: Parameters<typeof process.stderr.write>[0],
    encodingOrCallback?: Parameters<typeof process.stderr.write>[1],
    callback?: Parameters<typeof process.stderr.write>[2],
  ) => {
    stderr += chunk.toString()
    const done =
      typeof encodingOrCallback === 'function' ? encodingOrCallback : callback
    done?.()
    return true
  }) as typeof process.stderr.write
  try {
    await run()
  } finally {
    process.stderr.write = write
  }
  return stderr
}
