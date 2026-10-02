// SPDX-License-Identifier: Apache-2.0

import type { AnimatedValue } from '@/anim'
import type { EllipseNode, RectNode, SceneAPI } from '@/scene'
import { DEFAULT_EXTRUSION_SIDE_COLOR, MAX_EXTRUSION_DEPTH, extrusionShapeLimitation, normalizeExtrusionDepth } from '@/scene/extrusion'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import { useUI } from '@/state/ui'
import { currentAnimationAuthorTime } from './animationPlayhead'
import { ColorField, FieldRow, KeyframeButton, NumberField } from './fields'
import { commitExtrusionDepth, setExtrusionEnabled } from './extrusionAuthoring'
import { nodeTransformPreviewStore } from './nodeTransformPreviewStore'

export function ExtrusionSection({ node, api, anim }: {
  node: RectNode | EllipseNode
  api: SceneAPI
  anim?: AnimatedValue
}) {
  const extrusion = node.extrusion
  const limitation = extrusionShapeLimitation(node, anim)
  const supported = limitation === undefined
  const depth = normalizeExtrusionDepth(anim?.extrusionDepth ?? extrusion?.depth)
  const commitDepth = (value: number) => commitExtrusionDepth(
    api, node.id, value, currentAnimationAuthorTime(), useUI.getState().recording,
  )
  return (
    <fieldset disabled={node.locked} className="min-w-0 space-y-3 border-t border-border pt-4">
      <label className="flex items-center justify-between gap-2 text-xs font-medium text-text">
        <span>3D depth</span>
        <input type="checkbox" aria-label="Enable 3D depth" checked={!!extrusion}
          disabled={!supported && !extrusion}
          onChange={event => {
            nodeTransformPreviewStore.clear()
            setExtrusionEnabled(api, node.id, event.target.checked, anim)
          }}
          className="h-4 w-4 cursor-pointer accent-accent disabled:cursor-not-allowed disabled:opacity-40" />
      </label>
      {!supported && (
        <p className="text-[11px] leading-4 text-text-muted">
          {limitation === 'ellipse-arc'
            ? '3D depth supports complete ellipses. Set Sweep to 100% and Inner radius to 0% to show the body.'
            : limitation === 'independent-corners'
              ? '3D depth supports a uniform corner radius. Link the corners or enable Full radius to show the body.'
              : 'Turn off Squircle or set Smoothing to 0 to show the 3D body. Circular rounded corners are supported.'}
        </p>
      )}
      {extrusion && (
        <fieldset disabled={!supported} className="min-w-0 space-y-3 border-0 p-0">
          <FieldRow label={node.kind === 'ellipse' ? "Height" : "Depth"} keyframe={<KeyframeButton nodeId={node.id} propertyId="extrusion.depth" currentValue={supported ? depth : null} />}>
            <NumberField value={depth} ariaLabel={node.kind === 'ellipse' ? "Cylinder height" : "3D depth"} min={0} max={MAX_EXTRUSION_DEPTH} suffix="px"
              onCommit={commitDepth}
              onScrubPreview={value => nodeTransformPreviewStore.preview({ [node.id]: { extrusionDepth: normalizeExtrusionDepth(value) } })}
              onScrubCommit={value => {
                commitDepth(value)
                nodeTransformPreviewStore.finish()
              }}
              onScrubCancel={() => nodeTransformPreviewStore.clear()} />
          </FieldRow>
          <FieldRow label="Side color">
            <ColorField value={extrusion.sideColor} onCommit={sideColor => {
              const current = api.getNode(node.id)
              if (!current?.extrusion || current.locked) return
              api.doc.transact(() => api.setNodeProperty(node.id, 'extrusion', {
                ...current.extrusion!, sideColor: sideColor ?? DEFAULT_EXTRUSION_SIDE_COLOR,
              }), UNDOABLE_GESTURE_ORIGIN)
            }} />
          </FieldRow>
          <p className="text-[11px] leading-4 text-text-muted">
            Extends the shape behind its front face. Rotate the layer or use an isometric camera to see its sides.
          </p>
        </fieldset>
      )}
    </fieldset>
  )
}
