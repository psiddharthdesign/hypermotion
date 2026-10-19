// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { FONT_FILE_EXTENSIONS, bytesToCustomFont, probeFontFile } from './loader'

function fileOf(name: string, bytes: number[] | Uint8Array): File {
  return new File([new Uint8Array(bytes)], name)
}

function magic(tag: string): number[] {
  return [...tag].map((c) => c.charCodeAt(0))
}

interface NameRecord {
  platformId: number
  nameId: number
  value: string
}

/**
 * Minimal sfnt (ttf/otf) container holding just a `name` table, which
 * is the only table the loader parses.
 */
function sfntWithNames(records: NameRecord[], sfntVersion = [0x00, 0x01, 0x00, 0x00]): Uint8Array {
  const encoded = records.map((r) =>
    r.platformId === 1
      ? Uint8Array.from([...r.value].map((c) => c.charCodeAt(0)))
      : Uint8Array.from([...r.value].flatMap((c) => [c.charCodeAt(0) >> 8, c.charCodeAt(0) & 0xff])),
  )
  const stringOffset = 6 + records.length * 12
  const strings: number[] = []
  const nameTable: number[] = [0, 0, 0, records.length, stringOffset >> 8, stringOffset & 0xff]
  records.forEach((record, i) => {
    const bytes = encoded[i]!
    const offset = strings.length
    nameTable.push(
      0,
      record.platformId,
      0,
      record.platformId === 1 ? 0 : 1, // encodingId
      0,
      0, // languageId
      record.nameId >> 8,
      record.nameId & 0xff,
      bytes.length >> 8,
      bytes.length & 0xff,
      offset >> 8,
      offset & 0xff,
    )
    strings.push(...bytes)
  })
  nameTable.push(...strings)

  const nameOffset = 12 + 16 // one table record
  const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
  return Uint8Array.from([
    ...sfntVersion,
    0,
    1, // numTables
    0,
    0,
    0,
    0,
    0,
    0, // searchRange / entrySelector / rangeShift
    ...magic('name'),
    ...u32(0), // checksum
    ...u32(nameOffset),
    ...u32(nameTable.length),
    ...nameTable,
  ])
}

describe('font format detection', () => {
  it('reads the format off the file magic', async () => {
    expect((await probeFontFile(fileOf('a.bin', magic('wOF2')))).format).toBe('woff2')
    expect((await probeFontFile(fileOf('a.bin', magic('wOFF')))).format).toBe('woff')
    expect((await probeFontFile(fileOf('a.bin', magic('OTTO')))).format).toBe('opentype')
    expect((await probeFontFile(fileOf('a.bin', magic('true')))).format).toBe('truetype')
    expect((await probeFontFile(fileOf('a.bin', magic('typ1')))).format).toBe('truetype')
  })

  it('falls back to the extension when the magic is unrecognized', async () => {
    const junk = [0xde, 0xad, 0xbe, 0xef]
    expect((await probeFontFile(fileOf('Inter.WOFF2', junk))).format).toBe('woff2')
    expect((await probeFontFile(fileOf('Inter.woff', junk))).format).toBe('woff')
    expect((await probeFontFile(fileOf('Inter.otf', junk))).format).toBe('opentype')
    expect((await probeFontFile(fileOf('Inter.ttf', junk))).format).toBe('truetype')
  })

  it('rejects files that are neither recognizable nor font-named', async () => {
    await expect(probeFontFile(fileOf('notes.txt', [1, 2, 3, 4]))).rejects.toThrow(
      /doesn't look like a font file/,
    )
    await expect(probeFontFile(fileOf('short.ttx', [1, 2]))).rejects.toThrow(
      /doesn't look like a font file/,
    )
  })

  it('publishes the extensions the picker accepts', () => {
    expect([...FONT_FILE_EXTENSIONS]).toEqual(['woff2', 'woff', 'ttf', 'otf'])
  })
})

describe('family name extraction', () => {
  it('prefers the typographic family from the sfnt name table', async () => {
    const bytes = sfntWithNames([
      { platformId: 3, nameId: 1, value: 'Inter Display Bold' },
      { platformId: 3, nameId: 16, value: 'Inter Display' },
    ])
    expect(await probeFontFile(fileOf('whatever.ttf', bytes))).toEqual({
      format: 'truetype',
      family: 'Inter Display',
    })
  })

  it('falls back to the legacy family entry, decoding Mac records as ASCII', async () => {
    const bytes = sfntWithNames([{ platformId: 1, nameId: 1, value: 'Souvenir' }])
    expect((await probeFontFile(fileOf('whatever.ttf', bytes))).family).toBe('Souvenir')
  })

  it('falls back to the filename when the name table is unusable', async () => {
    const noNames = sfntWithNames([{ platformId: 3, nameId: 4, value: 'Full Name' }])
    expect((await probeFontFile(fileOf('Inter-SemiBold-Italic.ttf', noNames))).family).toBe(
      'Inter',
    )
  })

  it('uses the filename for compressed formats it cannot parse', async () => {
    const woff2 = fileOf('Space_Grotesk_ExtraBold.woff2', magic('wOF2'))
    expect((await probeFontFile(woff2)).family).toBe('Space Grotesk')
  })

  it('keeps the whole basename when stripping style words would empty it', async () => {
    expect((await probeFontFile(fileOf('Bold.woff2', magic('wOF2')))).family).toBe('Bold')
  })
})

describe('custom font construction', () => {
  const probe = { format: 'woff2', family: 'Inter' } as const

  it('guesses weight and style from the filename', () => {
    const cases: Array<[string, number, 'normal' | 'italic']> = [
      ['Inter-Regular.woff2', 400, 'normal'],
      ['Inter Thin.woff2', 100, 'normal'],
      ['Inter-ExtraLight.woff2', 200, 'normal'],
      ['Inter light.woff2', 300, 'normal'],
      ['Inter-Medium.woff2', 500, 'normal'],
      ['Inter-SemiBold.woff2', 600, 'normal'],
      ['Inter-ExtraBold.woff2', 800, 'normal'],
      ['Inter-Bold.woff2', 700, 'normal'],
      ['Inter-Black.woff2', 900, 'normal'],
      ['Inter-Heavy.woff2', 900, 'normal'],
      ['Inter-Bold-Italic.woff2', 700, 'italic'],
      ['Inter-Oblique.woff2', 400, 'italic'],
    ]
    for (const [name, weight, style] of cases) {
      const font = bytesToCustomFont(new Uint8Array([1]), name, probe)
      expect({ name, weight: font.weight, style: font.style }).toEqual({ name, weight, style })
    }
  })

  it('carries the bytes, probe result, and a unique id', () => {
    const bytes = new Uint8Array([1, 2, 3])
    const font = bytesToCustomFont(bytes, 'Inter-Bold.woff2', probe)
    expect(font).toMatchObject({
      name: 'Inter-Bold.woff2',
      family: 'Inter',
      format: 'woff2',
      bytes,
    })
    expect(font.id).toMatch(/^[a-z0-9]{8,}$/)
    expect(bytesToCustomFont(bytes, 'Inter-Bold.woff2', probe).id).not.toBe(font.id)
  })
})
