// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest'
import { createProjectAPI } from '@/project/doc'
import { createSceneAPI } from '@/scene/doc'
import type { ExplainerBrief } from './types'
import { compileBriefToStoryboard } from './compiler'
import { materializeStoryboard } from './materialize'

function featureBrief(): ExplainerBrief {
  return {
    id: 'smart-form',
    title: 'Turn every submission into a clear next step',
    targetDurationSeconds: 12,
    direction: {
      summary: 'Cinematic but product-led, with restrained 3D depth.',
      tone: 'cinematic',
      pacing: 'fast',
      use3dLayers: true,
      cameraStyle: 'dynamic',
    },
    script:
      'Start with one clear promise. Reveal the dashboard as separate layers. Submit the form and show the success state. Close on the product mark.',
    brand: {
      name: 'Acme',
      tagline: 'Work moves forward',
      logoSourceRefId: 'acme-logo',
      primaryColor: '#5b5bf7',
      accentColor: '#a5b4fc',
      backgroundColor: '#09090b',
    },
    sourceRefs: [
      {
        id: 'dashboard-screen',
        kind: 'screen',
        label: 'Dashboard',
        route: '/dashboard',
      },
      {
        id: 'form-component',
        kind: 'component',
        label: 'Create form',
        component: 'CreateForm',
      },
      {
        id: 'acme-logo',
        kind: 'logo',
        label: 'Acme logo',
        uri: '/assets/acme.svg',
      },
      {
        id: 'soundtrack',
        kind: 'audio',
        uri: '/audio/feature.wav',
      },
    ],
    audioAnalysis: {
      sourceRefId: 'soundtrack',
      durationSeconds: 12,
      bpm: 120,
      firstBeatTime: 0,
      beats: Array.from({ length: 25 }, (_, index) => index * 0.5),
      downbeats: [0, 2, 4, 6, 8, 10, 12],
      energyPeaks: [3.5, 7.5, 10],
      confidence: 0.94,
    },
  }
}

describe('materializeStoryboard', () => {
  it('builds editable compositions, variants, 3D tracks, cameras, cuts, and audio', () => {
    const storyboard = compileBriefToStoryboard(featureBrief())
    const api = createSceneAPI()
    const project = createProjectAPI(api)

    const result = materializeStoryboard({
      storyboard,
      project,
      mode: 'replace-empty',
      audioSrc: '/audio/feature.wav',
    })

    expect(result.issues.filter((issue) => issue.severity === 'error')).toEqual(
      [],
    )
    expect(result.scenes).toHaveLength(storyboard.scenes.length)
    expect(project.getScenes()).toHaveLength(storyboard.scenes.length)
    expect(project.getSequenceItems()).toHaveLength(storyboard.scenes.length)
    expect(project.getSequenceTimeMap().duration).toBeCloseTo(
      storyboard.durationSeconds,
      6,
    )
    expect(api.getMeta()).toMatchObject({
      name: storyboard.title,
      frameRate: storyboard.frameRate,
      canvas: storyboard.canvas,
    })

    for (const sceneResult of result.scenes) {
      const composition = project.getScene(sceneResult.compositionSceneId)
      const root = api.getNode(sceneResult.rootNodeId)
      expect(composition).not.toBeNull()
      expect(root).toMatchObject({
        kind: 'frame',
        size: storyboard.canvas,
        layout: { mode: 'flex' },
      })
      expect(sceneResult.trackIds.length).toBeGreaterThan(0)
      const sceneTracks = sceneResult.trackIds
        .map((trackId) => api.getTrack(trackId))
        .filter((track) => track !== null)
      expect(
        sceneTracks.every((track) =>
          track.keyframes.every(
            (keyframe) =>
              keyframe.time >= 0 && keyframe.time <= sceneResult.duration,
          ),
        ),
      ).toBe(true)
    }

    const designStoryboard = storyboard.scenes.find(
      (scene) => scene.kind === 'design',
    )
    const demoStoryboard = storyboard.scenes.find(
      (scene) => scene.kind === 'demo',
    )
    const design = result.scenes.find(
      (scene) => scene.storyboardSceneId === designStoryboard?.id,
    )
    const demo = result.scenes.find(
      (scene) => scene.storyboardSceneId === demoStoryboard?.id,
    )
    if (!design || !demo) throw new Error('Expected design and demo scenes')

    expect(design.componentNodeIds.length).toBeGreaterThan(0)
    expect(design.instanceNodeIds.length).toBeGreaterThan(0)
    expect(demo.componentNodeIds).toHaveLength(1)
    expect(demo.instanceNodeIds).toHaveLength(1)
    for (const componentNodeId of [
      ...design.componentNodeIds,
      ...demo.componentNodeIds,
    ]) {
      const component = api.getNode(componentNodeId)
      expect(component).toMatchObject({
        kind: 'component',
        parent: null,
        workspaceOnly: true,
      })
      expect(component?.transform.x).toBeGreaterThan(storyboard.canvas.width)
    }
    expect(
      project.getScene(design.compositionSceneId)?.workspaceNodeIds,
    ).toEqual(design.componentNodeIds)
    expect(
      project.getScene(demo.compositionSceneId)?.workspaceNodeIds,
    ).toEqual(demo.componentNodeIds)
    const demoVariantTrack = api
      .getTracksForNode(demo.instanceNodeIds[0]!)
      .find((track) => track.propertyId === 'variant')
    expect(
      demoVariantTrack?.keyframes.map((keyframe) => keyframe.value),
    ).toContainEqual({ State: 'success' })

    const planeNodes = design.nodeIds
      .map((nodeId) => api.getNode(nodeId))
      .filter(
        (node) =>
          node?.kind !== 'camera' &&
          node?.transform.renderMode === 'plane',
      )
    expect(planeNodes.length).toBeGreaterThan(0)
    expect(
      api
        .getAllTracks()
        .some(
          (track) =>
            planeNodes.some((node) => node?.id === track.nodeId) &&
            (track.propertyId === 'transform.z' ||
              track.propertyId === 'transform.rotationX' ||
              track.propertyId === 'transform.rotationY'),
        ),
    ).toBe(true)

    for (const cinematic of [design, demo]) {
      const composition = project.getScene(cinematic.compositionSceneId)
      expect(cinematic.cameraIds.length).toBeGreaterThanOrEqual(2)
      expect(cinematic.cameraCutIds.length).toBeGreaterThanOrEqual(2)
      expect(Object.values(composition?.cameraCuts ?? {})).toHaveLength(
        cinematic.cameraCutIds.length,
      )
      expect(
        Object.values(composition?.cameraCuts ?? {}).every(
          (cut) => cut.time >= 0 && cut.time <= cinematic.duration,
        ),
      ).toBe(true)
    }

    const audioNodes = api
      .getAllNodeIds()
      .map((nodeId) => api.getNode(nodeId))
      .filter((node) => node?.kind === 'audio')
    expect(audioNodes).toHaveLength(1)
    expect(audioNodes[0]).toMatchObject({
      id: result.audioNodeId,
      parent: null,
      src: '/audio/feature.wav',
      workspaceOnly: true,
      beatGrid: { bpm: 120, beatsPerBar: 4 },
    })
  })

  it('only replaces the seeded scene when it is still empty', () => {
    const storyboard = compileBriefToStoryboard({
      title: 'Empty replacement',
      direction: { summary: 'Simple', sceneOrder: ['text'] },
      brand: { name: 'Hyper' },
    })
    const emptyApi = createSceneAPI()
    const emptyProject = createProjectAPI(emptyApi)
    emptyProject.ensureInitialized()

    const replaced = materializeStoryboard({
      storyboard,
      project: emptyProject,
      mode: 'replace-empty',
    })

    expect(replaced.removedPlaceholderSceneId).not.toBeNull()
    expect(emptyProject.getScenes()).toHaveLength(storyboard.scenes.length)
    expect(
      emptyProject
        .getScenes()
        .some((scene) => scene.id === replaced.removedPlaceholderSceneId),
    ).toBe(false)

    const authoredApi = createSceneAPI()
    const authoredProject = createProjectAPI(authoredApi)
    authoredApi.createNode('frame', null, { name: 'Authored scene' })
    authoredProject.ensureInitialized()
    const authoredRoot = authoredProject.getScenes()[0]?.rootNodeId
    if (!authoredRoot) throw new Error('Expected seeded root')
    authoredApi.createNode('text', authoredRoot, { text: 'Keep me' })
    const authoredId = authoredProject.getScenes()[0]?.id

    const appended = materializeStoryboard({
      storyboard,
      project: authoredProject,
      mode: 'replace-empty',
    })

    expect(appended.removedPlaceholderSceneId).toBeNull()
    expect(appended.issues.map((issue) => issue.code)).toContain(
      'replace-empty-skipped',
    )
    expect(authoredProject.getScene(authoredId ?? '')).not.toBeNull()
    expect(authoredProject.getScenes()).toHaveLength(
      storyboard.scenes.length + 1,
    )
  })

  it('keeps timing and camera cuts while honoring reduced motion', () => {
    const storyboard = compileBriefToStoryboard(featureBrief())
    const api = createSceneAPI()
    const project = createProjectAPI(api)

    const result = materializeStoryboard({
      storyboard,
      project,
      mode: 'replace-empty',
      reducedMotion: true,
    })

    const generatedNodes = new Set(result.nodeIds)
    const generatedTracks = api
      .getAllTracks()
      .filter((track) => generatedNodes.has(track.nodeId))
    expect(
      generatedTracks.every(
        (track) =>
          track.propertyId === 'appearance.opacity' ||
          track.propertyId === 'variant',
      ),
    ).toBe(true)
    expect(result.scenes.flatMap((scene) => scene.cameraCutIds).length)
      .toBeGreaterThan(0)
    expect(project.getSequenceTimeMap().duration).toBeCloseTo(
      storyboard.durationSeconds,
      6,
    )
  })

  it('cleans generated workspace masters when an explainer is replaced', () => {
    const storyboard = compileBriefToStoryboard(featureBrief())
    const api = createSceneAPI()
    const project = createProjectAPI(api)
    const first = materializeStoryboard({
      storyboard,
      project,
      mode: 'replace-empty',
    })
    const firstWorkspaceNodes = first.scenes.flatMap(
      (scene) => scene.componentNodeIds,
    )
    const second = materializeStoryboard({
      storyboard,
      project,
      mode: 'append',
    })

    for (const compositionSceneId of first.compositionSceneIds) {
      expect(project.deleteScene(compositionSceneId).deleted).toBe(true)
    }

    expect(firstWorkspaceNodes.length).toBeGreaterThan(0)
    expect(
      firstWorkspaceNodes.every((nodeId) => api.getNode(nodeId) === null),
    ).toBe(true)
    expect(
      second.scenes
        .flatMap((scene) => scene.componentNodeIds)
        .every((nodeId) => api.getNode(nodeId) !== null),
    ).toBe(true)
  })
})
