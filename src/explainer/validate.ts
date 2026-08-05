// SPDX-License-Identifier: Apache-2.0

import type {
  ExplainerStoryboard,
  StoryboardCameraCut,
  StoryboardQcCode,
  StoryboardQcIssue,
  StoryboardQcSeverity,
  StoryboardScene,
  StoryboardValidationOptions,
  StoryboardValidationResult,
} from './types'

const DEFAULT_MIN_DURATION = 10
const DEFAULT_MAX_DURATION = 15
const DEFAULT_TIME_TOLERANCE = 0.0001

/**
 * Validate temporal, referential, camera, 3D-layer, and brand invariants.
 *
 * Warnings describe compilable fallbacks. Errors mean an execution adapter
 * should refuse to render until the storyboard is corrected.
 */
export function validateStoryboard(
  storyboard: ExplainerStoryboard,
  options: StoryboardValidationOptions = {},
): StoryboardValidationResult {
  const issues: StoryboardQcIssue[] = []
  const tolerance = finitePositive(options.timeTolerance)
    ? options.timeTolerance
    : DEFAULT_TIME_TOLERANCE
  const minDuration = finitePositive(options.minDurationSeconds)
    ? options.minDurationSeconds
    : DEFAULT_MIN_DURATION
  const maxDuration = finitePositive(options.maxDurationSeconds)
    ? Math.max(minDuration, options.maxDurationSeconds)
    : DEFAULT_MAX_DURATION
  const add = (
    code: StoryboardQcCode,
    severity: StoryboardQcSeverity,
    message: string,
    path: string,
    sceneId?: string,
  ): void => {
    issues.push({
      code,
      severity,
      message,
      path,
      ...(sceneId ? { sceneId } : {}),
    })
  }

  if (
    !Number.isFinite(storyboard.durationSeconds) ||
    storyboard.durationSeconds < minDuration - tolerance ||
    storyboard.durationSeconds > maxDuration + tolerance
  ) {
    add(
      'invalid-duration',
      'error',
      `Storyboard duration must be between ${minDuration} and ${maxDuration} seconds.`,
      'durationSeconds',
    )
  }
  if (
    !Number.isFinite(storyboard.frameRate) ||
    storyboard.frameRate < 1 ||
    storyboard.frameRate > 120 ||
    !Number.isInteger(storyboard.frameRate)
  ) {
    add(
      'invalid-frame-rate',
      'error',
      'Storyboard frameRate must be an integer from 1 to 120.',
      'frameRate',
    )
  }

  const globallySeenIds = new Map<string, string>()
  const recordId = (id: string, path: string): void => {
    const existingPath = globallySeenIds.get(id)
    if (existingPath) {
      add(
        'duplicate-id',
        'error',
        `ID "${id}" is already used at ${existingPath}.`,
        path,
      )
      return
    }
    globallySeenIds.set(id, path)
  }

  const sourceIds = new Set<string>()
  storyboard.sourceRefs.forEach((ref, index) => {
    const path = `sourceRefs[${index}].id`
    recordId(ref.id, path)
    sourceIds.add(ref.id)
  })
  if (
    storyboard.beatPlan.sourceRefId !== null &&
    !sourceIds.has(storyboard.beatPlan.sourceRefId)
  ) {
    add(
      'missing-source-ref',
      'error',
      `Beat plan references missing audio source "${storyboard.beatPlan.sourceRefId}".`,
      'beatPlan.sourceRefId',
    )
  }

  if (storyboard.scenes.length === 0) {
    add('no-scenes', 'error', 'Storyboard must contain at least one scene.', 'scenes')
  }

  const sceneById = new Map<string, StoryboardScene>()
  storyboard.scenes.forEach((scene, index) => {
    recordId(scene.id, `scenes[${index}].id`)
    sceneById.set(scene.id, scene)
    validateScene(
      storyboard,
      scene,
      index,
      sourceIds,
      tolerance,
      add,
      recordId,
    )
  })
  validateSceneContinuity(storyboard, tolerance, add)
  validateFinalLogo(storyboard, add)

  const cueById = new Map(
    storyboard.beatPlan.cues.map((cue) => [cue.id, cue]),
  )
  const cutById = new Map(
    storyboard.beatPlan.cameraCuts.map((cut) => [cut.id, cut]),
  )

  validateBeatEvidence(storyboard, tolerance, add)
  storyboard.beatPlan.cues.forEach((cue, index) => {
    recordId(cue.id, `beatPlan.cues[${index}].id`)
    const scene = sceneById.get(cue.sceneId)
    if (
      !scene ||
      !finiteTime(cue.time) ||
      cue.time < -tolerance ||
      cue.time > storyboard.durationSeconds + tolerance ||
      (scene &&
        (cue.time < scene.startTime - tolerance ||
          cue.time > scene.endTime + tolerance))
    ) {
      add(
        'invalid-cue',
        'error',
        `Cue "${cue.id}" has an invalid scene or time.`,
        `beatPlan.cues[${index}]`,
        cue.sceneId,
      )
    }
    if (scene && !scene.cueIds.includes(cue.id)) {
      add(
        'invalid-cue',
        'error',
        `Cue "${cue.id}" is not owned by scene "${scene.id}".`,
        `beatPlan.cues[${index}]`,
        cue.sceneId,
      )
    }
    if (!finiteTime(cue.requestedTime)) {
      add(
        'invalid-cue',
        'error',
        `Cue "${cue.id}" requestedTime must be finite.`,
        `beatPlan.cues[${index}].requestedTime`,
        cue.sceneId,
      )
    }
    if (cue.beatSnapped) {
      const beat =
        cue.beatIndex === null
          ? undefined
          : storyboard.beatPlan.beatTimes[cue.beatIndex]
      if (beat === undefined || !near(beat, cue.time, tolerance)) {
        add(
          'beat-snap-mismatch',
          'error',
          `Cue "${cue.id}" is marked beat-snapped but does not match its beat index.`,
          `beatPlan.cues[${index}]`,
          cue.sceneId,
        )
      }
    } else if (cue.beatIndex !== null) {
      add(
        'beat-snap-mismatch',
        'error',
        `Cue "${cue.id}" has a beat index without beatSnapped enabled.`,
        `beatPlan.cues[${index}]`,
        cue.sceneId,
      )
    }
  })
  validateTimedOrder(
    storyboard.beatPlan.cues,
    'beatPlan.cues',
    'invalid-cue',
    add,
  )

  storyboard.beatPlan.cameraCuts.forEach((cut, index) => {
    recordId(cut.id, `beatPlan.cameraCuts[${index}].id`)
    validateCameraCut(
      cut,
      index,
      sceneById,
      cueById,
      tolerance,
      add,
    )
  })
  validateTimedOrder(
    storyboard.beatPlan.cameraCuts,
    'beatPlan.cameraCuts',
    'invalid-camera-cut',
    add,
  )

  storyboard.transitions.forEach((transition, index) => {
    recordId(transition.id, `transitions[${index}].id`)
    const from = sceneById.get(transition.fromSceneId)
    const to = sceneById.get(transition.toSceneId)
    const cue = cueById.get(transition.cueId)
    const adjacencyValid =
      from !== undefined &&
      to !== undefined &&
      to.order === from.order + 1
    const timingValid =
      from !== undefined &&
      to !== undefined &&
      finiteTime(transition.startTime) &&
      finiteTime(transition.endTime) &&
      transition.startTime >= from.startTime - tolerance &&
      transition.startTime < transition.endTime - tolerance &&
      near(transition.endTime, from.endTime, tolerance) &&
      near(transition.endTime, to.startTime, tolerance)
    const cueValid =
      cue !== undefined &&
      cue.kind === 'transition' &&
      near(cue.time, transition.endTime, tolerance)
    if (!adjacencyValid || !timingValid || !cueValid) {
      add(
        'invalid-transition',
        'error',
        `Transition "${transition.id}" must connect adjacent scenes at their shared boundary.`,
        `transitions[${index}]`,
      )
    }
  })
  validateTransitionOwnership(storyboard, add)

  storyboard.scenes.forEach((scene, sceneIndex) => {
    scene.cueIds.forEach((cueId, cueIndex) => {
      const cue = cueById.get(cueId)
      if (!cue || cue.sceneId !== scene.id) {
        add(
          'invalid-cue',
          'error',
          `Scene "${scene.id}" references an invalid cue "${cueId}".`,
          `scenes[${sceneIndex}].cueIds[${cueIndex}]`,
          scene.id,
        )
      }
    })
    scene.cameraCutIds.forEach((cutId, cutIndex) => {
      const cut = cutById.get(cutId)
      if (!cut || cut.sceneId !== scene.id) {
        add(
          'invalid-camera-cut',
          'error',
          `Scene "${scene.id}" references an invalid camera cut "${cutId}".`,
          `scenes[${sceneIndex}].cameraCutIds[${cutIndex}]`,
          scene.id,
        )
      }
    })
    if (scene.kind === 'demo') {
      scene.steps.forEach((step, stepIndex) => {
        const cue = cueById.get(step.cueId)
        if (
          !cue ||
          cue.kind !== 'demo-action' ||
          cue.sceneId !== scene.id ||
          !scene.cueIds.includes(step.cueId)
        ) {
          add(
            'invalid-cue',
            'error',
            `Demo step "${step.id}" references an invalid action cue.`,
            `scenes[${sceneIndex}].steps[${stepIndex}].cueId`,
            scene.id,
          )
        }
      })
    }
  })

  const errors = issues.filter((issue) => issue.severity === 'error')
  return {
    ok: errors.length === 0,
    issues,
    errors,
    warnings: issues.filter((issue) => issue.severity === 'warning'),
  }
}

function validateScene(
  storyboard: ExplainerStoryboard,
  scene: StoryboardScene,
  index: number,
  sourceIds: Set<string>,
  tolerance: number,
  add: AddIssue,
  recordId: (id: string, path: string) => void,
): void {
  const path = `scenes[${index}]`
  if (scene.order !== index) {
    add(
      'invalid-scene-order',
      'error',
      `Scene "${scene.id}" order must be ${index}.`,
      `${path}.order`,
      scene.id,
    )
  }
  if (
    !finiteTime(scene.startTime) ||
    !finiteTime(scene.endTime) ||
    scene.startTime < -tolerance ||
    scene.endTime <= scene.startTime + tolerance ||
    scene.endTime > storyboard.durationSeconds + tolerance
  ) {
    add(
      'invalid-scene-range',
      'error',
      `Scene "${scene.id}" has an invalid time range.`,
      path,
      scene.id,
    )
  }

  scene.sourceRefIds.forEach((sourceRefId, sourceIndex) => {
    if (!sourceIds.has(sourceRefId)) {
      add(
        'missing-source-ref',
        'error',
        `Scene "${scene.id}" references missing source "${sourceRefId}".`,
        `${path}.sourceRefIds[${sourceIndex}]`,
        scene.id,
      )
    }
  })
  if (
    (scene.kind === 'design' || scene.kind === 'demo') &&
    scene.sourceRefIds.length === 0
  ) {
    add(
      'missing-design-source',
      'warning',
      `Scene "${scene.id}" will use generated placeholders until a design source is resolved.`,
      `${path}.sourceRefIds`,
      scene.id,
    )
  }
  if (
    (scene.kind === 'design' || scene.kind === 'demo') &&
    scene.layerDirections.length === 0
  ) {
    add(
      'invalid-layer-direction',
      'warning',
      `Scene "${scene.id}" has no 3D layer directions.`,
      `${path}.layerDirections`,
      scene.id,
    )
  }
  if (scene.kind === 'logo' && scene.logoSourceRefId === null) {
    add(
      'missing-logo-source',
      'warning',
      `Logo scene "${scene.id}" will animate the brand name as a text fallback.`,
      `${path}.logoSourceRefId`,
      scene.id,
    )
  } else if (
    scene.kind === 'logo' &&
    scene.logoSourceRefId !== null &&
    !sourceIds.has(scene.logoSourceRefId)
  ) {
    add(
      'missing-source-ref',
      'error',
      `Logo scene "${scene.id}" references missing source "${scene.logoSourceRefId}".`,
      `${path}.logoSourceRefId`,
      scene.id,
    )
  }

  scene.layerDirections.forEach((direction, directionIndex) => {
    recordId(
      direction.id,
      `${path}.layerDirections[${directionIndex}].id`,
    )
    const rangeValid =
      finiteTime(direction.startTime) &&
      finiteTime(direction.endTime) &&
      direction.startTime >= scene.startTime - tolerance &&
      direction.endTime <= scene.endTime + tolerance &&
      direction.endTime >= direction.startTime - tolerance
    const values = [
      direction.depth,
      direction.from.x,
      direction.from.y,
      direction.from.z,
      direction.from.rotationX,
      direction.from.rotationY,
      direction.from.opacity,
      direction.to.x,
      direction.to.y,
      direction.to.z,
      direction.to.rotationX,
      direction.to.rotationY,
      direction.to.opacity,
    ]
    if (!rangeValid || values.some((value) => !Number.isFinite(value))) {
      add(
        'invalid-layer-direction',
        'error',
        `Layer direction "${direction.id}" is outside its scene or contains non-finite values.`,
        `${path}.layerDirections[${directionIndex}]`,
        scene.id,
      )
    }
    if (direction.sourceRefId && !sourceIds.has(direction.sourceRefId)) {
      add(
        'missing-source-ref',
        'error',
        `Layer direction "${direction.id}" references missing source "${direction.sourceRefId}".`,
        `${path}.layerDirections[${directionIndex}].sourceRefId`,
        scene.id,
      )
    }
  })

  scene.cameraDirections.forEach((direction, directionIndex) => {
    recordId(
      direction.id,
      `${path}.cameraDirections[${directionIndex}].id`,
    )
    if (
      !nonBlank(direction.cameraId) ||
      !finiteTime(direction.startTime) ||
      !finiteTime(direction.endTime) ||
      direction.startTime < scene.startTime - tolerance ||
      direction.endTime > scene.endTime + tolerance ||
      direction.endTime < direction.startTime - tolerance ||
      !poseIsFinite(direction.from) ||
      !poseIsFinite(direction.to)
    ) {
      add(
        'invalid-camera-direction',
        'error',
        `Camera direction "${direction.id}" is invalid or outside its scene.`,
        `${path}.cameraDirections[${directionIndex}]`,
        scene.id,
      )
    }
  })

  if (scene.kind === 'design') {
    scene.components.forEach((component, componentIndex) => {
      recordId(
        component.id,
        `${path}.components[${componentIndex}].id`,
      )
      if (component.sourceRefId && !sourceIds.has(component.sourceRefId)) {
        add(
          'missing-source-ref',
          'error',
          `Component direction "${component.id}" references missing source "${component.sourceRefId}".`,
          `${path}.components[${componentIndex}].sourceRefId`,
          scene.id,
        )
      }
    })
  }
  if (scene.kind === 'demo') {
    scene.steps.forEach((step, stepIndex) => {
      recordId(step.id, `${path}.steps[${stepIndex}].id`)
      if (step.targetSourceRefId && !sourceIds.has(step.targetSourceRefId)) {
        add(
          'missing-source-ref',
          'error',
          `Demo step "${step.id}" references missing source "${step.targetSourceRefId}".`,
          `${path}.steps[${stepIndex}].targetSourceRefId`,
          scene.id,
        )
      }
    })
  }
}

function validateSceneContinuity(
  storyboard: ExplainerStoryboard,
  tolerance: number,
  add: AddIssue,
): void {
  const first = storyboard.scenes[0]
  if (first && !near(first.startTime, 0, tolerance)) {
    add(
      'scene-gap',
      'error',
      'The first scene must begin at 0 seconds.',
      'scenes[0].startTime',
      first.id,
    )
  }
  for (let index = 1; index < storyboard.scenes.length; index += 1) {
    const previous = storyboard.scenes[index - 1]
    const current = storyboard.scenes[index]
    if (!previous || !current) continue
    if (current.startTime > previous.endTime + tolerance) {
      add(
        'scene-gap',
        'error',
        `Gap between "${previous.id}" and "${current.id}".`,
        `scenes[${index}].startTime`,
        current.id,
      )
    } else if (current.startTime < previous.endTime - tolerance) {
      add(
        'scene-overlap',
        'error',
        `Overlap between "${previous.id}" and "${current.id}".`,
        `scenes[${index}].startTime`,
        current.id,
      )
    }
  }
  const finalScene = storyboard.scenes.at(-1)
  if (
    finalScene &&
    !near(finalScene.endTime, storyboard.durationSeconds, tolerance)
  ) {
    add(
      'scene-gap',
      'error',
      'The final scene must end at the storyboard duration.',
      `scenes[${storyboard.scenes.length - 1}].endTime`,
      finalScene.id,
    )
  }
}

function validateFinalLogo(
  storyboard: ExplainerStoryboard,
  add: AddIssue,
): void {
  const finalIndex = storyboard.scenes.length - 1
  const finalScene = storyboard.scenes[finalIndex]
  if (!finalScene || finalScene.kind !== 'logo') {
    add(
      'missing-final-logo',
      'error',
      'Storyboard must finish with a logo scene.',
      'scenes',
    )
  }
  storyboard.scenes.forEach((scene, index) => {
    if (scene.kind === 'logo' && index !== finalIndex) {
      add(
        'logo-not-final',
        'error',
        `Logo scene "${scene.id}" must be the final scene.`,
        `scenes[${index}]`,
        scene.id,
      )
    }
  })
}

function validateBeatEvidence(
  storyboard: ExplainerStoryboard,
  tolerance: number,
  add: AddIssue,
): void {
  const beatTimes = storyboard.beatPlan.beatTimes
  beatTimes.forEach((time, index) => {
    if (
      !finiteTime(time) ||
      time < -tolerance ||
      time > storyboard.durationSeconds + tolerance ||
      (index > 0 && time <= (beatTimes[index - 1] ?? time) + tolerance)
    ) {
      add(
        'invalid-cue',
        'error',
        'Beat times must be finite, unique, ordered, and inside the storyboard.',
        `beatPlan.beatTimes[${index}]`,
      )
    }
  })
  if (storyboard.beatPlan.source === 'none') {
    add(
      'audio-analysis-unavailable',
      'warning',
      'No beat evidence was available; cue times use deterministic unsnapped timing.',
      'beatPlan',
    )
  } else if (beatTimes.length === 0) {
    add(
      'invalid-cue',
      'error',
      'A detected or tempo beat plan must contain beat times.',
      'beatPlan.beatTimes',
    )
  }
}

function validateCameraCut(
  cut: StoryboardCameraCut,
  index: number,
  sceneById: Map<string, StoryboardScene>,
  cueById: Map<string, ExplainerStoryboard['beatPlan']['cues'][number]>,
  tolerance: number,
  add: AddIssue,
): void {
  const scene = sceneById.get(cut.sceneId)
  const cue = cueById.get(cut.cueId)
  const direction = scene?.cameraDirections.find(
    (item) =>
      item.cameraId === cut.cameraId &&
      cut.time >= item.startTime - tolerance &&
      cut.time <= item.endTime + tolerance,
  )
  if (
    !scene ||
    !nonBlank(cut.cameraId) ||
    !finiteTime(cut.time) ||
    cut.time < (scene?.startTime ?? 0) - tolerance ||
    cut.time > (scene?.endTime ?? 0) + tolerance ||
    !cue ||
    cue.kind !== 'camera-cut' ||
    cue.sceneId !== cut.sceneId ||
    !near(cue.time, cut.time, tolerance) ||
    cut.beatSnapped !== cue.beatSnapped ||
    !scene?.cameraCutIds.includes(cut.id) ||
    !direction
  ) {
    add(
      'invalid-camera-cut',
      'error',
      `Camera cut "${cut.id}" has an invalid target, cue, time, or camera direction.`,
      `beatPlan.cameraCuts[${index}]`,
      cut.sceneId,
    )
  }
}

function validateTransitionOwnership(
  storyboard: ExplainerStoryboard,
  add: AddIssue,
): void {
  const transitionById = new Map(
    storyboard.transitions.map((transition) => [transition.id, transition]),
  )
  storyboard.scenes.forEach((scene, index) => {
    const previous = storyboard.scenes[index - 1]
    const next = storyboard.scenes[index + 1]
    const incoming = scene.transitionInId
      ? transitionById.get(scene.transitionInId)
      : undefined
    const outgoing = scene.transitionOutId
      ? transitionById.get(scene.transitionOutId)
      : undefined
    const incomingValid =
      previous === undefined
        ? scene.transitionInId === null
        : incoming?.fromSceneId === previous.id &&
          incoming.toSceneId === scene.id
    const outgoingValid =
      next === undefined
        ? scene.transitionOutId === null
        : outgoing?.fromSceneId === scene.id &&
          outgoing.toSceneId === next.id
    if (!incomingValid) {
      add(
        'invalid-transition',
        'error',
        `Scene "${scene.id}" has an invalid incoming transition reference.`,
        `scenes[${index}].transitionInId`,
        scene.id,
      )
    }
    if (!outgoingValid) {
      add(
        'invalid-transition',
        'error',
        `Scene "${scene.id}" has an invalid outgoing transition reference.`,
        `scenes[${index}].transitionOutId`,
        scene.id,
      )
    }
  })
  if (
    storyboard.scenes.length > 0 &&
    storyboard.transitions.length !== storyboard.scenes.length - 1
  ) {
    add(
      'invalid-transition',
      'error',
      'Storyboard must contain exactly one transition between adjacent scenes.',
      'transitions',
    )
  }
}

function validateTimedOrder(
  values: Array<{ time: number; id: string }>,
  path: string,
  code: StoryboardQcCode,
  add: AddIssue,
): void {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1]
    const current = values[index]
    if (
      !previous ||
      !current ||
      current.time < previous.time ||
      (current.time === previous.time &&
        current.id.localeCompare(previous.id) < 0)
    ) {
      add(
        code,
        'error',
        'Timed entries must use deterministic (time, id) ordering.',
        `${path}[${index}]`,
      )
    }
  }
}

type AddIssue = (
  code: StoryboardQcCode,
  severity: StoryboardQcSeverity,
  message: string,
  path: string,
  sceneId?: string,
) => void

function finitePositive(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0
}

function finiteTime(value: number): boolean {
  return Number.isFinite(value)
}

function near(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance
}

function nonBlank(value: string): boolean {
  return value.trim().length > 0
}

function poseIsFinite(
  pose: StoryboardScene['cameraDirections'][number]['from'],
): boolean {
  if (!pose) return true
  return Object.values(pose).every(
    (value) => value === undefined || Number.isFinite(value),
  )
}
