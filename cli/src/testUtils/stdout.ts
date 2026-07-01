// SPDX-License-Identifier: Apache-2.0

type WritableStream = typeof process.stdout | typeof process.stderr
type CaptureCallback<T> = () => Promise<T> | T
type WritableChunk = Parameters<WritableStream['write']>[0]
type WritableEncodingOrCallback = Parameters<WritableStream['write']>[1]
type WritableCallback = Parameters<WritableStream['write']>[2]

function stringifyChunk(
  chunk: WritableChunk,
  encoding?: BufferEncoding,
): string {
  if (chunk instanceof Uint8Array) return Buffer.from(chunk).toString(encoding)
  if (encoding) return Buffer.from(chunk, encoding).toString()
  return chunk.toString()
}

async function captureStream(
  stream: WritableStream,
  run: CaptureCallback<unknown>,
): Promise<string> {
  let output = ''
  const write = stream.write
  stream.write = ((
    chunk: WritableChunk,
    encodingOrCallback?: WritableEncodingOrCallback,
    callback?: WritableCallback,
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
  run: CaptureCallback<unknown>,
): Promise<string> {
  return captureStream(process.stdout, run)
}

export async function captureStderr(
  run: CaptureCallback<unknown>,
): Promise<string> {
  return captureStream(process.stderr, run)
}
