// SPDX-License-Identifier: Apache-2.0
import * as THREE from 'three'

/** Blend already tone-mapped camera buffers without applying color transforms twice. */
export class CameraDissolveRenderer {
  private incoming: THREE.FramebufferTexture
  private outgoing: THREE.FramebufferTexture
  private scene = new THREE.Scene()
  private camera = new THREE.Camera()
  private material: THREE.RawShaderMaterial
  private geometry = new THREE.PlaneGeometry(2, 2)
  private width: number
  private height: number
  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.incoming = new THREE.FramebufferTexture(width, height)
    this.outgoing = new THREE.FramebufferTexture(width, height)
    this.material = new THREE.RawShaderMaterial({
      uniforms: { incoming: { value: this.incoming }, outgoing: { value: this.outgoing }, progress: { value: 0 } },
      vertexShader: 'precision highp float; attribute vec3 position; varying vec2 vUv; void main(){vUv=position.xy*.5+.5;gl_Position=vec4(position,1.);}',
      fragmentShader: 'precision highp float; uniform sampler2D incoming; uniform sampler2D outgoing; uniform float progress; varying vec2 vUv; void main(){gl_FragColor=mix(texture2D(outgoing,vUv),texture2D(incoming,vUv),progress);}',
      depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    })
    this.scene.add(new THREE.Mesh(this.geometry, this.material))
  }
  matches(width: number, height: number) { return this.width === width && this.height === height }
  captureIncoming(renderer: THREE.WebGLRenderer) { renderer.copyFramebufferToTexture(this.incoming) }
  blend(renderer: THREE.WebGLRenderer, progress: number) {
    renderer.copyFramebufferToTexture(this.outgoing)
    this.material.uniforms.progress!.value = progress
    renderer.setRenderTarget(null)
    renderer.render(this.scene, this.camera)
  }
  dispose() { this.incoming.dispose(); this.outgoing.dispose(); this.geometry.dispose(); this.material.dispose() }
}
