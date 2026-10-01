// SPDX-License-Identifier: Apache-2.0

import { findKeyframeAt, findTrack } from '@/anim/tracks'
import { useSceneAPI } from '@/scene'
import { useUI } from '@/state/ui'
import { currentAnimationAuthorTime } from './animationPlayhead'
import { CAMERA_ZOOM_PROPERTY, toggleCameraZoomKeyframes } from './cameraViewPreset'
import { SquircleSurface } from './fields/SquircleSurface'

export function CameraZoomKeyframeButton({ nodeId, scale }: { nodeId: string; scale: number }) {
  const api = useSceneAPI()
  const pausedTime = useUI(state => state.playing ? null : state.playhead)
  void pausedTime
  const time = currentAnimationAuthorTime()
  const at = !!findKeyframeAt(api, nodeId, CAMERA_ZOOM_PROPERTY, time)
  const tracked = !!findTrack(api, nodeId, CAMERA_ZOOM_PROPERTY)
  const label = at ? 'Remove zoom keyframe' : 'Add zoom keyframe'
  return <SquircleSurface as="button" radius={6} type="button" aria-label={label} title={label} aria-pressed={at}
    data-keyframe-state={at ? 'at' : tracked ? 'track' : 'none'}
    onClick={() => toggleCameraZoomKeyframes(api, nodeId, currentAnimationAuthorTime(), scale)}
    className="hm-keyframe-surface hm-control-surface hm-control-compact group flex h-7 w-7 shrink-0 items-center justify-center">
    <span className={`block h-[9px] w-[9px] rotate-45 border transition-colors ${at ? 'border-keyframe bg-keyframe' : tracked ? 'border-keyframe bg-transparent' : 'border-text-dim/50 bg-transparent group-hover:border-keyframe'}`} />
  </SquircleSurface>
}
