// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import { createProjectAPI } from '@/project/doc'
import { getSequenceTabCaptureError } from './recordTab'

describe('sequence tab-capture compatibility', () => {
  it('allows active-scene export and cut-only master sequences', () => {
    const api = createSceneAPI()
    api.createNode('frame', null, { name: 'Opening' })
    const project = createProjectAPI(api)
    project.ensureInitialized()
    project.createScene({ name: 'Following' })

    expect(getSequenceTabCaptureError({ api, scope: 'scene' })).toBeNull()
    expect(getSequenceTabCaptureError({ api, scope: 'sequence' })).toBeNull()
  })

  it('rejects a master WebM that would flatten a crossfade to a hard switch', () => {
    const api = createSceneAPI()
    api.createNode('frame', null, { name: 'Opening' })
    const project = createProjectAPI(api)
    project.ensureInitialized()
    const firstItem = project.getSequenceItems()[0]!
    project.createScene({ name: 'Following' })
    project.setTransition(firstItem.id, {
      kind: 'crossfade',
      duration: 0.5,
    })

    expect(
      getSequenceTabCaptureError({ api, scope: 'sequence' }),
    ).toContain('cannot render crossfades')
  })
})
