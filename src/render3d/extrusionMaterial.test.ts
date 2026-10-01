// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { syncAlphaMasks } from './alphaMaskShader'
import { installDepthOfFieldShader } from './depthOfFieldShader'
import { syncExtrusionMaterial } from './extrusionMaterial'
import { createSceneAPI } from '@/scene/doc'
import { buildWorldPlanes, hitTestPlanes, resolveCamera3D } from './scene3d'

describe('solid body compositing', () => {
  it('copies resolved blend and clip settings without replacing the body color', () => {
    const source = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.4, blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor, depthTest: true, depthWrite: true })
    source.blendEquationAlpha = THREE.AddEquation
    source.blendSrcAlpha = THREE.OneFactor
    source.blendDstAlpha = THREE.OneMinusSrcAlphaFactor
    source.clippingPlanes = [new THREE.Plane(new THREE.Vector3(1, 0, 0), 8)]
    const body = new THREE.MeshBasicMaterial({ color: '#123456', alphaTest: 1 / 255 })
    syncExtrusionMaterial(source, body)
    expect(body.color.getHexString()).toBe('123456')
    expect(body).toMatchObject({ opacity: 0.4, transparent: true, blending: THREE.CustomBlending, blendDst: THREE.OneFactor, depthTest: true, depthWrite: true, alphaTest: 1 / 255 })
    expect(body.clippingPlanes).toBe(source.clippingPlanes)
    source.depthTest = false
    source.depthWrite = false
    source.blending = THREE.MultiplyBlending
    source.clippingPlanes = null
    const version = body.version
    syncExtrusionMaterial(source, body)
    expect(body).toMatchObject({ blending: THREE.MultiplyBlending, depthTest: false, depthWrite: false, clippingPlanes: null })
    expect(body.version).toBeGreaterThan(version)
  })

  it('binds shared world-space mask uniforms through the body shader and clears them when removed', () => {
    const source = new THREE.MeshBasicMaterial()
    const body = new THREE.MeshBasicMaterial()
    installDepthOfFieldShader(body)
    const texture = new THREE.Texture()
    const matrix = new THREE.Matrix4().makeTranslation(10, 20, 0)
    syncAlphaMasks(source, [{ texture, matrix, opacity: 0.7 }])
    syncExtrusionMaterial(source, body)
    expect(body.customProgramCacheKey()).toContain('alpha-masks-1')
    const shader = {
      uniforms: {}, vertexShader: THREE.ShaderLib.basic.vertexShader,
      fragmentShader: THREE.ShaderLib.basic.fragmentShader,
    } as THREE.WebGLProgramParametersWithUniforms
    body.onBeforeCompile(shader, {} as THREE.WebGLRenderer)
    expect(shader.uniforms.hmMaskTexture0?.value).toBe(texture)
    expect(shader.uniforms.hmMaskMatrix0?.value).toBe(matrix)
    expect(shader.uniforms.hmMaskOpacity0?.value).toBe(0.7)
    expect(shader.vertexShader).toContain('hmMaskWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;')
    expect(shader.fragmentShader).toContain('hmMaskMatrix0 * vec4(hmMaskWorld, 1.0)')
    syncAlphaMasks(source, [])
    syncExtrusionMaterial(source, body)
    expect(body.customProgramCacheKey()).toContain('alpha-masks-0')
    texture.dispose()
  })

  it('picks the top painted solid in the always-on-top band regardless of scene depth', () => {
    const api = createSceneAPI()
    const viewport = { width: 400, height: 300 }
    const root = api.createNode('frame', null, { size: viewport })
    const near = api.createNode('rect', root, { size: { width: 100, height: 100 }, extrusion: { depth: 40, sideColor: '#123456' } })
    const far = api.createNode('rect', root, { size: { width: 100, height: 100 }, extrusion: { depth: 40, sideColor: '#123456' }, zIndex: 10 })
    api.setNodeProperty(far, 'transform', { ...api.getNode(far)!.transform, z: 200 })
    const layout = { [root]: { x: 0, y: 0, ...viewport }, [near]: { x: 0, y: 0, width: 100, height: 100 }, [far]: { x: 0, y: 0, width: 100, height: 100 } }
    const camera = resolveCamera3D(api.getActiveCamera()!, undefined, viewport)
    const planes = buildWorldPlanes(api, layout, {}, camera)
    const ray = { origin: { x: 50, y: 50, z: -500 }, direction: { x: 0, y: 0, z: 1 } }
    expect(hitTestPlanes(planes, ray, camera, viewport)?.nodeId).toBe(near)
    expect(hitTestPlanes(planes.map(plane => ({ ...plane, alwaysOnTop: true })), ray, camera, viewport)?.nodeId).toBe(far)
  })
})
