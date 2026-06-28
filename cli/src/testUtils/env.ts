// SPDX-License-Identifier: Apache-2.0

export async function withEnvVar(
  name: string,
  value: string,
  run: () => Promise<void> | void,
): Promise<void> {
  const previous = process.env[name]
  process.env[name] = value
  try {
    await run()
  } finally {
    if (previous === undefined) {
      delete process.env[name]
    } else {
      process.env[name] = previous
    }
  }
}
