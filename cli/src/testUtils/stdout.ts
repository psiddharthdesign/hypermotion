// SPDX-License-Identifier: Apache-2.0

export async function captureStdout(run: () => Promise<void>): Promise<string> {
  let stdout = ''
  const write = process.stdout.write
  process.stdout.write = ((value: string | Uint8Array) => {
    stdout += value.toString()
    return true
  }) as typeof process.stdout.write
  try {
    await run()
  } finally {
    process.stdout.write = write
  }
  return stdout
}
