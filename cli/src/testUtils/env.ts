// SPDX-License-Identifier: Apache-2.0

type EnvVarCallback<T> = () => Promise<T> | T
type EnvVarValue = NodeJS.ProcessEnv[string]

export async function withEnvVar<T>(
  name: string,
  value: EnvVarValue,
  run: EnvVarCallback<T>,
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
