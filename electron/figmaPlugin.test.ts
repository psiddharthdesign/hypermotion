// SPDX-License-Identifier: Apache-2.0

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareFigmaPlugin } from './figmaPlugin'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('prepareFigmaPlugin', () => {
  it('copies a complete plugin to a stable user-data manifest path', () => {
    const fixture = createFixture('first-build')

    const result = prepareFigmaPlugin({
      sourceDir: fixture.sourceDir,
      userDataDir: fixture.userDataDir,
      appVersion: '0.1.15',
    })

    expect(result).toMatchObject({
      ok: true,
      exists: true,
      version: '0.1.15',
      path: path.join(
        fixture.userDataDir,
        'figma-plugin',
        'manifest.json',
      ),
    })
    expect(
      fs.readFileSync(
        path.join(fixture.userDataDir, 'figma-plugin', 'dist', 'code.js'),
        'utf8',
      ),
    ).toBe('first-build')
    expect(
      fs.readFileSync(
        path.join(fixture.userDataDir, 'figma-plugin', 'dist', 'ui.html'),
        'utf8',
      ),
    ).toBe('<p>first-build</p>')
  })

  it('refreshes the same path when a newer app build starts', () => {
    const fixture = createFixture('version-one')
    const options = {
      sourceDir: fixture.sourceDir,
      userDataDir: fixture.userDataDir,
      appVersion: '1.0.0',
    }

    prepareFigmaPlugin(options)
    fs.writeFileSync(
      path.join(fixture.sourceDir, 'dist', 'code.js'),
      'version-two',
    )
    const result = prepareFigmaPlugin({ ...options, appVersion: '1.1.0' })

    expect(result.path).toBe(
      path.join(fixture.userDataDir, 'figma-plugin', 'manifest.json'),
    )
    expect(result.version).toBe('1.1.0')
    expect(
      fs.readFileSync(
        path.join(fixture.userDataDir, 'figma-plugin', 'dist', 'code.js'),
        'utf8',
      ),
    ).toBe('version-two')
  })

  it('keeps a previous good copy when the bundled source is incomplete', () => {
    const fixture = createFixture('working-copy')
    const options = {
      sourceDir: fixture.sourceDir,
      userDataDir: fixture.userDataDir,
      appVersion: '1.0.0',
    }

    prepareFigmaPlugin(options)
    fs.rmSync(path.join(fixture.sourceDir, 'dist', 'ui.html'))
    const result = prepareFigmaPlugin({ ...options, appVersion: '1.1.0' })

    expect(result.ok).toBe(false)
    expect(result.exists).toBe(true)
    expect(result.version).toBe('1.0.0')
    expect(
      fs.readFileSync(
        path.join(fixture.userDataDir, 'figma-plugin', 'dist', 'ui.html'),
        'utf8',
      ),
    ).toBe('<p>working-copy</p>')
  })
})

function createFixture(contents: string): {
  sourceDir: string
  userDataDir: string
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-figma-plugin-test-'))
  temporaryDirectories.push(root)
  const sourceDir = path.join(root, 'source')
  const userDataDir = path.join(root, 'user-data')
  fs.mkdirSync(path.join(sourceDir, 'dist'), { recursive: true })
  fs.writeFileSync(
    path.join(sourceDir, 'manifest.json'),
    JSON.stringify({ name: 'Hyper Motion Import', main: 'dist/code.js' }),
  )
  fs.writeFileSync(path.join(sourceDir, 'dist', 'code.js'), contents)
  fs.writeFileSync(
    path.join(sourceDir, 'dist', 'ui.html'),
    `<p>${contents}</p>`,
  )
  return { sourceDir, userDataDir }
}
