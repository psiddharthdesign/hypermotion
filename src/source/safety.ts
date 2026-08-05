// SPDX-License-Identifier: Apache-2.0

const WINDOWS_ABSOLUTE = /^[a-zA-Z]:[\\/]/
const URI_SCHEME = /^[a-zA-Z][a-zA-Z\d+.-]*:/
const ENCODED_TRAVERSAL = /%(?:2e|2f|5c)/i
const SCRIPT_EXTENSION = /\.(?:c?js|mjs|jsx|tsx?)(?:$|[?#])/i
const SCRIPT_MIME = /(?:javascript|ecmascript|typescript)/i
const PRIVATE_HOST =
  /^(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|::1|\[::1\]|169\.254(?:\.\d{1,3}){2}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})$/i
const UNSAFE_URI_VALUE =
  /^\s*(?:javascript|vbscript|data\s*:\s*text\/html)/i
const UNSAFE_CSS =
  /(?:expression\s*\(|javascript\s*:|vbscript\s*:|@import\b|behavior\s*:|-moz-binding\s*:|url\s*\(\s*['"]?\s*data\s*:\s*text\/html)/i
const UNSAFE_SVG =
  /(?:<\s*script\b|<\s*(?:iframe|object|embed)\b|\son[a-z]+\s*=|(?:href|src)\s*=\s*['"]?\s*(?:javascript|vbscript)\s*:)/i

const BLOCKED_DOM_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'base',
])

export function isSafeProjectPath(
  value: string,
  allowDot = false,
): boolean {
  if (!value || value.includes('\0') || value.includes('\\')) return false
  if (
    value.startsWith('/') ||
    value.startsWith('~') ||
    WINDOWS_ABSOLUTE.test(value) ||
    URI_SCHEME.test(value) ||
    ENCODED_TRAVERSAL.test(value)
  ) {
    return false
  }
  if (value === '.') return allowDot
  const segments = value.split('/')
  return (
    segments.length > 0 &&
    segments.every(
      (segment) =>
        segment.length > 0 &&
        segment !== '.' &&
        segment !== '..',
    )
  )
}

export function normalizeProjectPath(value: string): string {
  if (value === '.') return value
  return value
    .split('/')
    .filter((segment) => segment.length > 0)
    .join('/')
}

export function remoteAssetUrlIssue(
  value: string,
  contentType?: string,
): 'unsafe-url' | 'remote-script' | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return 'unsafe-url'
  }
  if (
    url.protocol !== 'https:' ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    PRIVATE_HOST.test(url.hostname)
  ) {
    return 'unsafe-url'
  }
  if (
    SCRIPT_EXTENSION.test(url.pathname) ||
    (contentType !== undefined && SCRIPT_MIME.test(contentType))
  ) {
    return 'remote-script'
  }
  return null
}

export function domSafetyIssue(
  tag: string,
  attributes: Readonly<Record<string, string>>,
  text?: string,
): 'remote-script' | 'unsafe-dom' | 'unsafe-style' | null {
  const normalizedTag = tag.trim().toLocaleLowerCase('en-US')
  if (normalizedTag === 'script') return 'remote-script'
  if (BLOCKED_DOM_TAGS.has(normalizedTag)) return 'unsafe-dom'
  if (
    normalizedTag === 'link' &&
    (attributes.rel?.toLocaleLowerCase('en-US').includes('modulepreload') ||
      attributes.as?.toLocaleLowerCase('en-US') === 'script')
  ) {
    return 'remote-script'
  }

  for (const [name, value] of Object.entries(attributes)) {
    const normalizedName = name.trim().toLocaleLowerCase('en-US')
    if (
      normalizedName.startsWith('on') ||
      normalizedName === 'srcdoc'
    ) {
      return 'unsafe-dom'
    }
    if (UNSAFE_URI_VALUE.test(value)) return 'unsafe-dom'
    if (normalizedName === 'style' && UNSAFE_CSS.test(value)) {
      return 'unsafe-style'
    }
    if (
      (normalizedName === 'src' || normalizedName === 'href') &&
      SCRIPT_EXTENSION.test(value)
    ) {
      return 'remote-script'
    }
  }

  if (text && /<\s*script\b/i.test(text)) return 'remote-script'
  return null
}

export function styleSafetyIssue(
  property: string,
  value: string,
): 'unsafe-style' | null {
  if (
    property.trim().startsWith('@') ||
    UNSAFE_CSS.test(property) ||
    UNSAFE_CSS.test(value)
  ) {
    return 'unsafe-style'
  }
  return null
}

export function inlineAssetSafetyIssue(
  mediaType: string,
  text: string | undefined,
): 'remote-script' | 'unsafe-dom' | null {
  if (SCRIPT_MIME.test(mediaType)) return 'remote-script'
  if (text === undefined) return null
  if (mediaType.toLocaleLowerCase('en-US') !== 'image/svg+xml') {
    return 'unsafe-dom'
  }
  return UNSAFE_SVG.test(text) ? 'remote-script' : null
}

export function isSafeRoutePath(value: string): boolean {
  return (
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.includes('\\') &&
    !value.includes('\0') &&
    !value.includes('?') &&
    !value.includes('#') &&
    !ENCODED_TRAVERSAL.test(value) &&
    !value.split('/').includes('..')
  )
}

export function isSafeLocalKey(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(value)
}
