// SPDX-License-Identifier: Apache-2.0
import { useSceneAPI, type Appearance, type Node } from '@/scene'
import type { AnimatedValue } from '@/anim'
import { recordKeyframesForPatch, stampToActiveTracksForPatch } from '@/anim/recordKeyframes'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import { useUI } from '@/state/ui'
import { currentAnimationAuthorTime } from './animationPlayhead'
import { FieldRow } from './fields/FieldRow'
import { KeyframeButton } from './fields/KeyframeButton'
import { KeyframeSliderRow } from './fields/KeyframeSliderRow'

export function CornerShapeFields({ node, animated }: { node: Node; animated?: AnimatedValue }) {
  const api = useSceneAPI()
  const smoothing = animated?.cornerSmoothing ?? node.appearance.cornerSmoothing ?? 0
  const enabled = animated?.cornerSmoothingEnabled !== undefined
    ? animated.cornerSmoothingEnabled >= 0.5 : (node.appearance.cornerSmoothingEnabled ?? smoothing > 0)
  const full = animated?.fullRadius !== undefined
    ? animated.fullRadius >= 0.5 : node.appearance.fullRadius === true
  const commit = (patch: Partial<Appearance>) => {
    const current = api.getNode(node.id)
    if (!current) return
    api.doc.transact(() => {
      api.setNodeProperty(node.id, 'appearance', { ...current.appearance, ...patch })
      const stamp = useUI.getState().recording ? recordKeyframesForPatch : stampToActiveTracksForPatch
      stamp(api, node.id, currentAnimationAuthorTime(), 'appearance', patch)
    }, UNDOABLE_GESTURE_ORIGIN)
  }
  return <>
    <FieldRow label="Full radius" keyframe={<KeyframeButton nodeId={node.id} propertyId="appearance.fullRadius" currentValue={Number(full)} />}>
      <input type="checkbox" aria-label="Full radius" checked={full} onChange={e => commit({ fullRadius: e.target.checked })} className="h-4 w-4 accent-accent" />
    </FieldRow>
    <FieldRow label="Squircle" keyframe={<KeyframeButton nodeId={node.id} propertyId="appearance.cornerSmoothingEnabled" currentValue={Number(enabled)} />}>
      <input type="checkbox" aria-label="Squircle" checked={enabled} onChange={e => commit({ cornerSmoothingEnabled: e.target.checked, ...(e.target.checked && smoothing === 0 ? { cornerSmoothing: 0.6 } : {}) })} className="h-4 w-4 accent-accent" />
    </FieldRow>
    <KeyframeSliderRow label="Smoothing" value={smoothing} min={0} max={1} step={0.01} onCommit={value => commit({ cornerSmoothing: value })}
      keyframe={<KeyframeButton nodeId={node.id} propertyId="appearance.cornerSmoothing" currentValue={smoothing} />} />
  </>
}
