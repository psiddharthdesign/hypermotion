// SPDX-License-Identifier: Apache-2.0

export type ClipboardWriteMethod = 'modern' | 'legacy'

export type ClipboardWriteOutcome =
  | { ok: true; method: ClipboardWriteMethod }
  | { ok: false; error: unknown }

export interface ClipboardWriteAttempt {
  /** Whether the synchronous legacy command claimed it accepted the copy. */
  legacyAccepted: boolean
  /** Settles after the trustworthy modern write, or its legacy fallback. */
  completion: Promise<ClipboardWriteOutcome>
}

/**
 * Start every available clipboard path before the click activation expires.
 *
 * Figma's plugin iframe can report `execCommand('copy') === true` without
 * putting anything on the macOS clipboard. That return value is only a
 * fallback signal; it must never prevent the modern write from starting.
 */
export function startClipboardWrite(
  text: string,
  modernWrite: ((value: string) => Promise<void>) | undefined,
  legacyWrite: (value: string) => boolean,
): ClipboardWriteAttempt {
  // Run the selection-based copy first. In Figma's iframe the modern API can
  // be rejected by Permissions Policy; invoking it first can also consume the
  // transient activation that execCommand needs in stricter Chromium hosts.
  let legacyAccepted = false
  let legacyError: unknown = null
  try {
    legacyAccepted = legacyWrite(text)
  } catch (error) {
    legacyError = error
  }

  let modernAttempt: Promise<void> | null = null
  let modernStartError: unknown = null

  if (modernWrite) {
    try {
      // Invocation must stay synchronous with the user's click. Wrapping the
      // returned promise is safe; deferring the invocation itself is not.
      modernAttempt = Promise.resolve(modernWrite(text))
    } catch (error) {
      modernStartError = error
    }
  }

  const legacyOutcome = (): ClipboardWriteOutcome =>
    legacyAccepted
      ? { ok: true, method: 'legacy' }
      : {
          ok: false,
          error:
            modernStartError ??
            legacyError ??
            new Error('No clipboard write method accepted the payload.'),
        }

  return {
    legacyAccepted,
    completion: modernAttempt
      ? modernAttempt.then<ClipboardWriteOutcome, ClipboardWriteOutcome>(
          () => ({ ok: true, method: 'modern' }),
          (error: unknown) =>
            legacyAccepted
              ? { ok: true, method: 'legacy' }
              : { ok: false, error },
        )
      : Promise.resolve(legacyOutcome()),
  }
}
