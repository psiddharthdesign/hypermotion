// SPDX-License-Identifier: Apache-2.0

type WritableStream = typeof process.stdout | typeof process.stderr
type CaptureCallback<T> = () => Promise<T> | T

function stringifyChunk(
  chunk: Parameters<typeof process.stdout.write>[0],
  encoding?: BufferEncoding,
): string {
  if (chunk instanceof Uint8Array) return Buffer.from(chunk).toString(encoding)
  if (encoding) return Buffer.from(chunk, encoding).toString()
  return chunk.toString()
}

async function captureStream(
  stream: WritableStream,
  run: CaptureCallback<void>,
): Promise<string> {
  let output = ''
  const write = stream.write
  stream.write = ((
    chunk: Parameters<typeof stream.write>[0],
    encodingOrCallback?: Parameters<typeof stream.write>[1],
    callback?: Parameters<typeof stream.write>[2],
  ) => {
    const encoding =
      typeof encodingOrCallback === 'string' ? encodingOrCallback : undefined
    output += stringifyChunk(chunk, encoding)
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

export async function captureStdout(
  run: CaptureCallback<void>,
): Promise<string> {
  return captureStream(process.stdout, run)
}

export async function captureStderr(
  run: CaptureCallback<void>,
): Promise<string> {
  return captureStream(process.stderr, run)
}
