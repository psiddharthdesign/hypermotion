import { describe, it, expect } from 'vitest'
import { createSceneAPI } from '@/scene/doc'
import { createProjectAPI } from '@/project/doc'
import { cameraDissolveAt } from './cameraDissolve'

describe('camera dissolves', () => {
  it('blends after a cut and stops at the next camera cut', () => {
    const api = createSceneAPI()
    api.createNode('frame', null)
    const first = api.createNode('camera', null)
    const project = createProjectAPI(api)
    const scene = project.getActiveScene()!

    const second = api.createNode('camera', null)
    const sample = { ...scene, defaultCameraId: first, duration: 10, cameraIds: [first, second], cameraCuts: {
      a: { id: 'a', cameraId: second, time: 2, dissolveDuration: 4 },
      b: { id: 'b', cameraId: first, time: 3 },
    } }
    expect(cameraDissolveAt(sample, 1.9)).toBeNull()
    expect(cameraDissolveAt(sample, 2)).toEqual({ from: first, to: second, progress: 0 })
    expect(cameraDissolveAt(sample, 2.5)?.progress).toBe(0.5)
    expect(cameraDissolveAt(sample, 3)).toBeNull()
    expect(cameraDissolveAt({ ...sample, cameraCuts: { a: { ...sample.cameraCuts.a, dissolveDuration: 0 } } }, 2.5)).toBeNull()
  })
})
