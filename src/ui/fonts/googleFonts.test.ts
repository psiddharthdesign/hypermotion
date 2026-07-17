// SPDX-License-Identifier: Apache-2.0

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/scene', () => ({
  useSceneAPI: vi.fn(),
  useSceneVersion: vi.fn(),
}))

type LinkEvent = 'load' | 'error'

class FakeHead {
  readonly links: FakeLink[] = []

  appendChild(link: FakeLink): FakeLink {
    link.parentNode = this
    this.links.push(link)
    return link
  }

  remove(link: FakeLink): void {
    const index = this.links.indexOf(link)
    if (index >= 0) this.links.splice(index, 1)
    link.parentNode = null
  }
}

class FakeLink {
  rel = ''
  href = ''
  sheet: CSSStyleSheet | null = null
  parentNode: FakeHead | null = null
  private readonly attributes = new Map<string, string>()
  private readonly listeners = new Map<LinkEvent, Set<() => void>>()

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }

  addEventListener(type: LinkEvent, listener: () => void): void {
    const callbacks = this.listeners.get(type) ?? new Set<() => void>()
    callbacks.add(listener)
    this.listeners.set(type, callbacks)
  }

  removeEventListener(type: LinkEvent, listener: () => void): void {
    this.listeners.get(type)?.delete(listener)
  }

  dispatch(type: LinkEvent): void {
    if (type === 'load') this.sheet = {} as CSSStyleSheet
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener()
  }

  remove(): void {
    this.parentNode?.remove(this)
  }
}

class FakeDocument {
  readonly head = new FakeHead()
  readonly fontLoad = vi.fn<(font: string) => Promise<FontFace[]>>(
    async () => [{ family: 'Fake face' } as FontFace],
  )
  readonly fonts = { load: this.fontLoad }

  createElement(tagName: string): FakeLink {
    if (tagName !== 'link') throw new Error(`Unexpected element: ${tagName}`)
    return new FakeLink()
  }

  querySelector<T>(selector: string): T | null {
    const family = selector.match(/="([^"]+)"/)?.[1]
    const link = this.head.links.find(
      (candidate) => candidate.getAttribute('data-gf-family') === family,
    )
    return (link as T | undefined) ?? null
  }
}

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')

function installDocument(document: FakeDocument): void {
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: document,
  })
}

async function freshLoader(): Promise<typeof import('./googleFonts')> {
  vi.resetModules()
  return import('./googleFonts')
}

afterEach(() => {
  vi.restoreAllMocks()
  if (originalDocument) {
    Object.defineProperty(globalThis, 'document', originalDocument)
  } else {
    Reflect.deleteProperty(globalThis, 'document')
  }
})

describe('Google font loading', () => {
  it('waits for the stylesheet and shares one promise across callers', async () => {
    const document = new FakeDocument()
    installDocument(document)
    const { loadGoogleFont, subscribeFontLoaded } = await freshLoader()
    const notified = vi.fn()
    subscribeFontLoaded(notified)

    const first = loadGoogleFont('Geist')
    const concurrent = loadGoogleFont('Geist')

    expect(concurrent).toBe(first)
    expect(document.head.links).toHaveLength(1)
    expect(document.fontLoad).not.toHaveBeenCalled()

    document.head.links[0]!.dispatch('load')
    await first

    expect(document.fontLoad).toHaveBeenCalledTimes(9)
    expect(document.fontLoad.mock.calls.map(([font]) => font)).toEqual([
      '100 16px "Geist"',
      '200 16px "Geist"',
      '300 16px "Geist"',
      '400 16px "Geist"',
      '500 16px "Geist"',
      '600 16px "Geist"',
      '700 16px "Geist"',
      '800 16px "Geist"',
      '900 16px "Geist"',
    ])
    expect(notified).toHaveBeenCalledTimes(1)
  })

  it('does not cache empty face results and retries the family', async () => {
    const document = new FakeDocument()
    document.fontLoad.mockResolvedValue([])
    installDocument(document)
    const { loadGoogleFont, subscribeFontLoaded } = await freshLoader()
    const notified = vi.fn()
    subscribeFontLoaded(notified)

    const emptyAttempt = loadGoogleFont('Geist Mono')
    document.head.links[0]!.dispatch('load')
    await emptyAttempt

    expect(notified).not.toHaveBeenCalled()
    expect(document.fontLoad).toHaveBeenCalledTimes(9)

    document.fontLoad.mockResolvedValue([
      { family: 'Geist Mono' } as FontFace,
    ])
    const retry = loadGoogleFont('Geist Mono')
    expect(retry).not.toBe(emptyAttempt)
    await retry

    expect(document.fontLoad).toHaveBeenCalledTimes(18)
    expect(notified).toHaveBeenCalledTimes(1)

    await loadGoogleFont('Geist Mono')
    expect(document.fontLoad).toHaveBeenCalledTimes(18)
  })

  it('removes a failed stylesheet so the next call can retry', async () => {
    const document = new FakeDocument()
    installDocument(document)
    const { loadGoogleFont } = await freshLoader()

    const failed = loadGoogleFont('Geist')
    const failedLink = document.head.links[0]!
    failedLink.dispatch('error')
    await failed

    expect(document.head.links).toHaveLength(0)
    expect(document.fontLoad).not.toHaveBeenCalled()

    const retry = loadGoogleFont('Geist')
    const retryLink = document.head.links[0]!
    expect(retryLink).not.toBe(failedLink)
    retryLink.dispatch('load')
    await retry

    expect(document.fontLoad).toHaveBeenCalledTimes(9)
  })
})
