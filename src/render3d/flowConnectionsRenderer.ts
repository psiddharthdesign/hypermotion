// SPDX-License-Identifier: Apache-2.0

import * as THREE from 'three'
import { parseCanvasSolidColor } from './canvasSolidColor'
import { ALWAYS_ON_TOP_RENDER_ORDER_BASE } from '@/render/layerCompositing'
import { flowPulseDistances, type ResolvedFlowConnection } from './flowConnections'

interface FlowRecord {
  signature: string
  group: THREE.Group
  line: THREE.Mesh<THREE.TubeGeometry, THREE.MeshBasicMaterial>
  pulses: THREE.InstancedMesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
}

/** Owns only procedural connection resources, leaving normal vector textures untouched. */
export class FlowConnectionsRenderer {
  private records = new Map<string, FlowRecord>()
  private matrix = new THREE.Matrix4()
  private scale = new THREE.Vector3()
  private rotation = new THREE.Quaternion()

  sync(scene: THREE.Scene, connections: readonly ResolvedFlowConnection[], time: number, hidden: readonly string[] = [], selected: readonly string[] = []): void {
    const active = new Set<string>()
    for (const connection of connections) {
      if (hidden.includes(connection.nodeId)) continue
      active.add(connection.nodeId)
      const s = connection.settings
      const signature = JSON.stringify([connection.points.map(p => p.toArray()), s.width])
      let record = this.records.get(connection.nodeId)
      if (record && record.signature !== signature) {
        this.disposeRecord(record)
        this.records.delete(connection.nodeId)
        record = undefined
      }
      if (!record) {
        const group = new THREE.Group()
        group.name = `Flow connection ${connection.nodeId}`
        const line = new THREE.Mesh(
          new THREE.TubeGeometry(connection.curve, Math.min(256, Math.max(12, Math.ceil(connection.length / 8))), s.width / 2, 8, false),
          new THREE.MeshBasicMaterial({ color: parseCanvasSolidColor(s.color) ?? '#2563eb', transparent: true, depthTest: true, depthWrite: true }),
        )
        const pulses = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 6), new THREE.MeshBasicMaterial({ color: parseCanvasSolidColor(s.flowColor) ?? '#93c5fd', transparent: true, depthTest: true, depthWrite: true }), 256)
        pulses.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
        // Animated positions are world-space and can leave the first frame's bounds.
        pulses.frustumCulled = false
        group.add(line, pulses)
        scene.add(group)
        record = { signature, group, line, pulses }
        this.records.set(connection.nodeId, record)
      }
      record.line.material.color.set(selected.includes(connection.nodeId) ? '#008fff' : parseCanvasSolidColor(s.color) ?? '#2563eb')
      record.pulses.material.color.set(parseCanvasSolidColor(s.flowColor) ?? '#93c5fd')
      const order = connection.paintOrder + (connection.alwaysOnTop ? ALWAYS_ON_TOP_RENDER_ORDER_BASE : 0)
      for (const mesh of [record.line, record.pulses]) {
        mesh.renderOrder = order
        mesh.material.opacity = connection.opacity
        mesh.material.depthTest = !connection.alwaysOnTop
        mesh.material.depthWrite = !connection.alwaysOnTop
      }
      const distances = flowPulseDistances(connection.length, s, time + connection.timeOffset, connection.travelDistance)
      record.pulses.count = distances.length
      this.scale.setScalar(Math.max(s.width / 2, s.flowSize / 2))
      for (let index = 0; index < distances.length; index++) {
        this.matrix.compose(connection.curve.getPointAt(distances[index]! / connection.length), this.rotation, this.scale)
        record.pulses.setMatrixAt(index, this.matrix)
      }
      record.pulses.instanceMatrix.needsUpdate = true
    }
    for (const [id, record] of this.records) {
      if (active.has(id)) continue
      this.disposeRecord(record)
      this.records.delete(id)
    }
  }

  private disposeRecord(record: FlowRecord): void {
    record.group.removeFromParent()
    record.line.geometry.dispose()
    record.line.material.dispose()
    record.pulses.geometry.dispose()
    record.pulses.material.dispose()
    record.pulses.dispose()
  }

  dispose(): void {
    for (const record of this.records.values()) this.disposeRecord(record)
    this.records.clear()
  }
}
