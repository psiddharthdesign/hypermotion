// SPDX-License-Identifier: Apache-2.0

const MAX_SLUG_LENGTH = 36

/**
 * Produce a stable, URL-safe identifier without relying on wall-clock time or
 * random state. The hash suffix prevents slug collisions.
 */
export function stableSourceId(
  namespace: string,
  label: string,
  canonicalLocator: string,
): string {
  const safeNamespace = slug(namespace) || 'source'
  const safeLabel = (slug(label) || 'item').slice(0, MAX_SLUG_LENGTH)
  return `${safeNamespace}-${safeLabel}-${fnv1a(canonicalLocator)}`
}

export function canonicalRecord(
  value: Readonly<Record<string, unknown>>,
): string {
  return JSON.stringify(sortJson(value))
}

export function shortHash(value: string): string {
  return fnv1a(value)
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortJson(value[key])]),
    )
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function slug(value: string): string {
  return value
    .normalize('NFKD')
    .toLocaleLowerCase('en-US')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36).padStart(7, '0')
}
