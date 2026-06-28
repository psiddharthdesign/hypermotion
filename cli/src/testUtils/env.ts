// SPDX-License-Identifier: Apache-2.0

export async function withEnvVar<T>(
  name: string,
  value: string | undefined,
  run: () => Promise<T> | T,
): Promise<T> {
  const previous = process.env[name]
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
  try {
    return await run()
  } finally {
    if (previous === undefined) {
      delete process.env[name]
    } else {
      process.env[name] = previous
    }
  }
}
