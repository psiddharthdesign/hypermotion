// SPDX-License-Identifier: Apache-2.0

export interface FrameReadyIdentity {
  readonly token: number
  readonly pass: number
}

export interface FrameReadyRequest {
  readonly identity: FrameReadyIdentity
  readonly promise: Promise<FrameReadyIdentity>
  cancel: (reason?: unknown) => boolean
}

export interface FrameReadyBarrierOptions {
  timeoutMs?: number
}

export interface BeginFrameReadyOptions {
  /**
   * Render pass associated with this request. Passes must increase strictly so
   * an acknowledgement from an earlier React/GPU commit cannot satisfy a later
   * capture request. Omit this to let the barrier allocate the next pass.
   */
  pass?: number
  timeoutMs?: number
}

interface PendingFrameReadyRequest {
  identity: FrameReadyIdentity
  resolve: (identity: FrameReadyIdentity) => void
  reject: (reason: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

const DEFAULT_TIMEOUT_MS = 5_000

function identityLabel(identity: FrameReadyIdentity): string {
  return `token ${identity.token}, pass ${identity.pass}`
}

function validCounter(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

function validTimeout(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

export class FrameReadyTimeoutError extends Error {
  readonly identity: FrameReadyIdentity
  readonly timeoutMs: number

  constructor(identity: FrameReadyIdentity, timeoutMs: number) {
    super(
      `Frame readiness timed out after ${timeoutMs}ms (${identityLabel(identity)}).`,
    )
    this.name = 'FrameReadyTimeoutError'
    this.identity = identity
    this.timeoutMs = timeoutMs
  }
}

export class FrameReadyCancelledError extends Error {
  readonly identity: FrameReadyIdentity
  readonly reason: unknown

  constructor(identity: FrameReadyIdentity, reason?: unknown) {
    const detail =
      reason instanceof Error
        ? `: ${reason.message}`
        : typeof reason === 'string' && reason.length > 0
          ? `: ${reason}`
          : ''
    super(`Frame readiness was cancelled (${identityLabel(identity)})${detail}.`)
    this.name = 'FrameReadyCancelledError'
    this.identity = identity
    this.reason = reason
  }
}

export class FrameReadyDisposedError extends Error {
  readonly reason: unknown

  constructor(reason?: unknown) {
    const detail =
      reason instanceof Error
        ? `: ${reason.message}`
        : typeof reason === 'string' && reason.length > 0
          ? `: ${reason}`
          : ''
    super(`Frame-ready barrier was disposed${detail}.`)
    this.name = 'FrameReadyDisposedError'
    this.reason = reason
  }
}

/**
 * Coordinates deterministic frame requests with renderer acknowledgements.
 *
 * Tokens are allocated by the barrier and passes are strictly monotonic. An
 * acknowledgement must match both values exactly; stale or speculative
 * acknowledgements are ignored without disturbing pending requests.
 */
export class FrameReadyBarrier {
  private readonly defaultTimeoutMs: number
  private readonly pending = new Map<number, PendingFrameReadyRequest>()
  private nextToken = 1
  private nextPass = 1
  private disposedError: FrameReadyDisposedError | null = null

  constructor(options: FrameReadyBarrierOptions = {}) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    if (!validTimeout(timeoutMs)) {
      throw new RangeError('Frame-ready timeout must be a positive number.')
    }
    this.defaultTimeoutMs = timeoutMs
  }

  get pendingCount(): number {
    return this.pending.size
  }

  get isDisposed(): boolean {
    return this.disposedError !== null
  }

  begin(options: BeginFrameReadyOptions = {}): FrameReadyRequest {
    if (this.disposedError) throw this.disposedError

    const pass = options.pass ?? this.nextPass
    if (!validCounter(pass)) {
      throw new RangeError('Frame-ready pass must be a positive safe integer.')
    }
    if (pass < this.nextPass) {
      throw new RangeError(
        `Frame-ready pass ${pass} is stale; the next pass is ${this.nextPass}.`,
      )
    }

    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs
    if (!validTimeout(timeoutMs)) {
      throw new RangeError('Frame-ready timeout must be a positive number.')
    }

    const identity = Object.freeze({ token: this.nextToken, pass })
    this.nextToken += 1
    this.nextPass = pass + 1

    let resolvePromise!: (identity: FrameReadyIdentity) => void
    let rejectPromise!: (reason: unknown) => void
    const promise = new Promise<FrameReadyIdentity>((resolve, reject) => {
      resolvePromise = resolve
      rejectPromise = reject
    })

    const timer = setTimeout(() => {
      const pending = this.take(identity)
      if (!pending) return
      pending.reject(new FrameReadyTimeoutError(identity, timeoutMs))
    }, timeoutMs)

    this.pending.set(identity.token, {
      identity,
      resolve: resolvePromise,
      reject: rejectPromise,
      timer,
    })

    return {
      identity,
      promise,
      cancel: (reason?: unknown) => this.cancel(identity, reason),
    }
  }

  acknowledge(identity: FrameReadyIdentity): boolean {
    const pending = this.take(identity)
    if (!pending) return false
    pending.resolve(pending.identity)
    return true
  }

  cancel(identity: FrameReadyIdentity, reason?: unknown): boolean {
    const pending = this.take(identity)
    if (!pending) return false
    pending.reject(new FrameReadyCancelledError(pending.identity, reason))
    return true
  }

  cancelAll(reason?: unknown): number {
    const requests = [...this.pending.values()]
    this.pending.clear()
    for (const pending of requests) {
      clearTimeout(pending.timer)
      pending.reject(new FrameReadyCancelledError(pending.identity, reason))
    }
    return requests.length
  }

  dispose(reason?: unknown): number {
    if (this.disposedError) return 0
    this.disposedError = new FrameReadyDisposedError(reason)
    const requests = [...this.pending.values()]
    this.pending.clear()
    for (const pending of requests) {
      clearTimeout(pending.timer)
      pending.reject(this.disposedError)
    }
    return requests.length
  }

  private take(identity: FrameReadyIdentity): PendingFrameReadyRequest | null {
    const pending = this.pending.get(identity.token)
    if (!pending || pending.identity.pass !== identity.pass) return null
    this.pending.delete(identity.token)
    clearTimeout(pending.timer)
    return pending
  }
}
