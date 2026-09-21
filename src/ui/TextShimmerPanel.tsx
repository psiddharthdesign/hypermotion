// SPDX-License-Identifier: Apache-2.0
import type { SceneAPI } from '@/scene/doc'
import type { TextNode } from '@/scene/types'
import type { TextAnimationConfig } from '@/anim/textAnimations'
import { readTextShimmer, setTextShimmer } from '@/anim/textShimmerEffect'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import { currentAnimationAuthorTime } from './animationPlayhead'
import { ColorField, FieldRow, NumberField, TimeField } from './fields'

export function TextShimmerPanel({ api, nodes }: { api: SceneAPI; nodes: TextNode[] }) {
  const primary = nodes[0]
  if (!primary) return null
  const current = readTextShimmer(api, primary)
  const patch = (value: Partial<TextAnimationConfig> | null) => {
    api.doc.transact(() => {
      for (const node of nodes) setTextShimmer(api, node.id, value, currentAnimationAuthorTime())
    }, UNDOABLE_GESTURE_ORIGIN)
  }
  return <section aria-label="Shimmer effect" className="space-y-3 rounded-md bg-app-bg p-2.5">
    <div className="flex items-center justify-between">
      <h3 className="text-xs font-semibold">Shimmer</h3>
      <input type="checkbox" aria-label="Enable Shimmer" checked={!!current} disabled={nodes.every(node => node.locked)} onChange={event => patch(event.target.checked ? {} : null)} />
    </div>
    <p className="text-xs text-text-muted">A color sweep that works alongside your text animation.</p>
    {current && <>
      <FieldRow label="Start"><TimeField value={current.startTime * 1000} valueUnit="milliseconds" onCommit={ms => patch({ startTime: ms / 1000 })} /></FieldRow>
      <FieldRow label="Sweep duration"><TimeField value={current.duration * 1000} valueUnit="milliseconds" min={50} onCommit={ms => patch({ duration: ms / 1000 })} /></FieldRow>
            <FieldRow label="Base color">
              <ColorField
                value={primary?.appearance.fill?.kind === 'solid' ? primary.appearance.fill.color : primary?.color ?? '#111111'}
                onCommit={(color) => {
                  if (!color) return
                  api.doc.transact(() => {
                    for (const node of nodes) {
                      if (node.locked) continue
                      api.setNodeProperty(node.id, 'color', color)
                      if (node.appearance.fill?.kind === 'solid') {
                        api.setNodeProperty(node.id, 'appearance', {
                          ...node.appearance, fill: { kind: 'solid', color },
                        })
                      }
                    }
                  }, UNDOABLE_GESTURE_ORIGIN)
                }}
              />
            </FieldRow>
            <FieldRow label="Highlight color">
              <input type="color" aria-label="Shimmer highlight color" value={current.shimmerColor ?? '#ffffff'} onChange={(event) => patch({ shimmerColor: event.target.value })} />
            </FieldRow>
            <FieldRow label="Base text opacity">
              <NumberField value={Math.round((current.shimmerOpacity ?? 0.35) * 100)} onCommit={(value) => patch({ shimmerOpacity: value / 100 })} min={0} max={100} suffix="%" width="w-24" />
            </FieldRow>
            <FieldRow label="Highlight width">
              <NumberField value={Math.round((current.shimmerWidth ?? 0.25) * 100)} onCommit={(value) => patch({ shimmerWidth: value / 100 })} min={2} max={100} suffix="%" width="w-24" />
            </FieldRow>
            <FieldRow label="Highlight blur">
              <NumberField value={Math.round((current.shimmerBlur ?? 0.7) * 100)} onCommit={(value) => patch({ shimmerBlur: value / 100 })} min={0} max={100} suffix="%" width="w-24" />
            </FieldRow>
            <FieldRow label="Sweep direction">
              <select aria-label="Shimmer direction" value={current.direction === 'left' ? 'left' : 'right'} onChange={(event) => patch({ direction: event.target.value as 'left' | 'right' })}>
                <option value="right">Left to right</option><option value="left">Right to left</option>
              </select>
            </FieldRow>
            <FieldRow label="Loop">
              <input type="checkbox" aria-label="Loop shimmer" checked={current.shimmerLoop !== false} onChange={(event) => patch({ shimmerLoop: event.target.checked })} />
            </FieldRow>
    </>}
  </section>
}
