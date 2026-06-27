// SPDX-License-Identifier: Apache-2.0

type WritableStream = typeof process.stdout | typeof process.stderr

async function captureStream(
  stream: WritableStream,
  run: () => Promise<void>,
): Promise<string> {
  let output = ''
  const write = stream.write
  stream.write = ((
    chunk: Parameters<typeof stream.write>[0],
    encodingOrCallback?: Parameters<typeof stream.write>[1],
    callback?: Parameters<typeof stream.write>[2],
  ) => {
    output += chunk.toString()
    const done =
      typeof encodingOrCallback === 'function' ? encodingOrCallback : callback
    done?.()
    return true
  }) as typeof stream.write
  try {
    await run()
  } finally {
    stream.write = write
  }
  return output
}

export async function captureStdout(run: () => Promise<void>): Promise<string> {
  return captureStream(process.stdout, run)
}

export async function captureStderr(run: () => Promise<void>): Promise<string> {
  return captureStream(process.stderr, run)
}
