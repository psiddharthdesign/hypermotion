// SPDX-License-Identifier: Apache-2.0
import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Copy, GripVertical, Grid2X2, Unlink, X } from 'lucide-react'
import type { Node, SceneAPI, KeyframeValue } from '@/scene'
import { ARRANGEMENT_NUMBERS, animatedArrangement, type Arrangement, type ArrangementNumber, type ArrangementChoice } from '@/scene/arrangement'
import { addArrangementBlueSquares, arrangementMemberCandidates, addArrangementMembers, createArrangement, dissolveArrangement, duplicateArrangement, removeArrangementMember } from '@/scene/arrangementActions'
import { getLastSolvedLayout } from '@/ui/hooks/lastSolvedLayout'
import { getAnimEngine, addKeyframe, findTrack } from '@/anim'
import { useUI } from '@/state/ui'
import { useInspectorAnimatedValues } from '@/ui/hooks/useAnimatedValues'
import { KeyframeButton, KeyframeSliderRow } from '@/ui/fields'
import { currentAnimationAuthorTime } from '@/ui/animationPlayhead'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import { TextMotionPathEditor } from '@/ui/TextMotionPathEditor'
import { defaultLayerMotionPath, normalizeLayerMotionPath } from '@/anim/layerMotionPath'

const control = 'w-full rounded-md border border-border bg-panel-raised px-2 py-1.5 text-[12px] text-text'
export function CreateArrangementButton({ api }: { api: SceneAPI }) {
  return <button type="button" className="flex items-center gap-1 text-[11px] text-text-muted hover:text-text" title="Arrange selected layers in a grid, circle, path, or sphere" onClick={() => {
    const id = createArrangement(api, useUI.getState().selection, getLastSolvedLayout() ?? {}, getAnimEngine().getSnapshot())
    if (id) useUI.getState().setSelection([id])
  }}><Grid2X2 size={12} />Arrangement</button>
}
export function ArrangementSection({ node, api }: { node: Node; api: SceneAPI }) {
  const [candidate, setCandidate] = useState('')
  const [dragged, setDragged] = useState<string | null>(null)
  const [error, setError] = useState('')
  const ids = useMemo(() => [node.id], [node.id])
  const animated = useInspectorAnimatedValues(ids)
  const parent = node.transformParent ? api.getNode(node.transformParent.nodeId) : null
  if (node.kind !== 'arrangement') return parent?.kind === 'arrangement' ? <section className="border-t border-border py-3">
    <button className="flex items-center gap-2 text-[12px] text-accent" onClick={() => useUI.getState().setSelection([parent.id])}><Grid2X2 size={14} />{parent.name}</button>
    <p className="mt-1 text-[11px] text-text-muted">Edit this layer independently, or select its arrangement to change the pattern.</p>
    <button disabled={node.locked || parent.locked} className="mt-2 text-[11px] text-text-muted" onClick={() => removeArrangementMember(api, parent.id, node.id, getAnimEngine().getSnapshot(), getLastSolvedLayout() ?? undefined)}>Detach from arrangement</button>
  </section> : null
  const a = node.arrangement
  if (!a) return null
  const live = animatedArrangement(a, animated[node.id]?.arrangement)
  const commit = (key: ArrangementNumber | ArrangementChoice | 'path', value: KeyframeValue) => api.doc.transact(() => {
    const current = api.getNode(node.id)?.arrangement
    if (!current || node.locked) return
    api.setNodeProperty(node.id, 'arrangement', { ...current, [key]: value })
    const property = `arrangement.${key}` as const
    if (useUI.getState().recording || findTrack(api, node.id, property)) addKeyframe(api, node.id, property, currentAnimationAuthorTime(), value)
  }, UNDOABLE_GESTURE_ORIGIN)
  const patch = (p: Partial<Arrangement>) => api.doc.transact(() => api.setNodeProperty(node.id, 'arrangement', { ...a, ...p }), UNDOABLE_GESTURE_ORIGIN)
  const run = (fn: () => void) => { try { fn(); setError('') } catch (e) { setError(e instanceof Error ? e.message : 'Could not update arrangement.') } }
  const fields = (keys: ArrangementNumber[]) => keys.map((key) => {
    const spec = ARRANGEMENT_NUMBERS[key], property = `arrangement.${key}` as const
    // Multipliers and path progress need a useful authoring range, not degree-sized bounds.
    const pathScale = key === 'pathScaleX' || key === 'pathScaleY'
    const sliderMin = pathScale ? 0.1 : key === 'progress' ? 0 : spec.min < 0 ? -Math.max(360, Math.abs(live[key]) * 2) : spec.min
    const sliderMax = pathScale ? 3 : key === 'progress' ? 1 : Math.min(key === 'focusTarget' ? a.memberIds.length : spec.max, Math.max(1, spec.value * 3, Math.abs(live[key]) * 2, spec.max > 100 ? 360 : spec.max))
    return <KeyframeSliderRow key={key} label={spec.label} value={live[key]} min={spec.min} max={key === 'focusTarget' ? a.memberIds.length : spec.max}
      sliderMin={sliderMin} sliderMax={sliderMax} suffix={key === 'orbit' ? '°' : undefined}
      step={['columns', 'polygonPoints', 'shuffle', 'seed'].includes(key) ? 1 : 0.01} disabled={node.locked}
      onCommit={(value) => commit(key, value)}
      keyframe={<KeyframeButton nodeId={node.id} propertyId={property} currentValue={node.locked ? null : live[key]} staggerable={false} />} />
  })
  const select = <K extends ArrangementChoice>(key: K, label: string, options: [Arrangement[K], string][]) => <div className="space-y-1 text-[11px] text-text-muted">
    <div>{label}</div><div className="flex items-center gap-1">
      <select className={control} aria-label={label} value={live[key]} disabled={node.locked} onChange={(e) => commit(key, e.target.value)}>{options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select>
      <KeyframeButton nodeId={node.id} propertyId={`arrangement.${key}`} currentValue={node.locked ? null : live[key]} staggerable={false} />
    </div>
  </div>
  const candidates = arrangementMemberCandidates(api, a.memberIds)
  const reorder = (from: string, target: string) => {
    const order = [...a.memberIds], i = order.indexOf(from), j = order.indexOf(target)
    if (i < 0 || j < 0) return
    order.splice(i, 1); order.splice(j, 0, from); patch({ memberIds: order })
  }
  return <section className="space-y-3 border-t border-border py-3" aria-label="Arrangement">
    <div className="flex items-center gap-2 text-[12px] font-medium text-text"><Grid2X2 size={14} />Arrangement
      <button className="ml-auto" aria-label="Duplicate arrangement" title="Duplicate arrangement and its layers" onClick={() => { const id = duplicateArrangement(api, node.id); if (id) useUI.getState().setSelection([id]) }}><Copy size={14} /></button>
      <button disabled={node.locked || a.memberIds.some((id) => api.getNode(id)?.locked)} aria-label="Dissolve arrangement" title="Remove arrangement, retaining layers at their current positions" onClick={() => dissolveArrangement(api, node.id, getAnimEngine().getSnapshot(), getLastSolvedLayout() ?? undefined)}><Unlink size={14} /></button>
    </div>
    {select('mode', 'Pattern', [['rectangular', 'Rectangular'], ['radial', 'Radial'], ['path', 'Path'], ['spherical', 'Spherical']])}
    {live.mode === 'rectangular' && fields(['columns', 'spacingX', 'spacingY'])}
    {live.mode === 'radial' && <>{fields(['radius', 'spread', 'orbit'])}<p className="text-[11px] text-text-dim">Orbit moves cards along the ring without changing its tilt. Animate 0° to 360° for one lap.</p></>}
    {live.mode === 'spherical' && <>{fields(['radius', 'pitch', 'focusTarget'])}<p className="text-[11px] text-text-muted">Focus: 0 turns targeting off. 1 targets the first member; fractional values travel between members.</p></>}
    {live.mode === 'path' && <>
      {select('shape', 'Path shape', [['ellipse', 'Ellipse'], ['rectangle', 'Rectangle'], ['polygon', 'Polygon'], ['star', 'Star'], ['custom', 'Custom']])}
      {live.shape !== 'custom' && fields(['radius'])}
      {(live.shape === 'polygon' || live.shape === 'star') && fields(['polygonPoints'])}
      {fields(['pathScaleX', 'pathScaleY', 'trimStart', 'trimEnd', 'progress', 'pathSpread'])}
      <button type="button" className={control} disabled={node.locked} onClick={() => api.doc.transact(() => {
        const canvas = api.getMeta().canvas
        commit('radius', Math.max(16, Math.min(canvas.width, canvas.height) * 0.28))
        commit('pathScaleX', 1); commit('pathScaleY', 1)
        commit('trimStart', 0); commit('trimEnd', 1)
        commit('progress', 0); commit('pathSpread', 1)
      }, UNDOABLE_GESTURE_ORIGIN)}>Reset path layout</button>
      <p className="text-[11px] text-text-dim">Path scale: 1× is the original size. Reset restores size, trims, progress, and spread at the playhead.</p>
      {live.shape === 'custom' && !node.locked && <><div className="flex items-center justify-between text-[11px] text-text-muted">Path geometry<KeyframeButton nodeId={node.id} propertyId="arrangement.path" currentValue={live.path} staggerable={false} /></div><TextMotionPathEditor path={live.path} normalizePath={normalizeLayerMotionPath} unitLabel="pixels" startLabel="Start" endLabel="End" nudgeStep={4} maxPoints={64} helperText="Drag anchors and handles. Double-click the path to add a point. Use Z to shape the path in depth." onCommit={(path) => commit('path', normalizeLayerMotionPath({ ...live.path, ...path })!)} onReset={() => commit('path', defaultLayerMotionPath())} /></>}
    </>}
    <div className="space-y-2 border-t border-border pt-3">
      <div className="text-[11px] font-medium text-text-muted">3D arrangement rotation</div>
      {fields(['rotationX', 'rotationY', 'rotation'])}
      <p className="text-[11px] text-text-dim">Rotate the pattern around its center. Set the plane of the pattern. Use Orbit on radial arrangements to move cards around the ring.</p>
    </div>
    {select('orientation', 'Card facing', [['forward', 'Follow arrangement'], ['center', 'Face center'], ['outward', 'Face outward'], ['screen', 'Face camera'], ...(live.mode === 'path' ? [['path', 'Follow path'] as [Arrangement['orientation'], string]] : [])])}
    <p className="text-[11px] text-text-dim">{live.orientation === 'screen' ? 'Cards stay facing the active camera as the arrangement rotates.' : 'Choose how cards turn as they travel around the arrangement.'}</p>
    {fields(['opacity'])}
    <details className="space-y-2" open><summary className="cursor-pointer text-[11px] font-medium text-text-muted">Scale and depth</summary>
      {select('scaleMode', 'Scale by position', [['off', 'Off'], ['linear', 'Linear'], ['ripple', 'Ripple']])}
      {fields(['scaleFront', ...(live.scaleMode !== 'off' ? ['scaleBack', 'scaleFalloff'] as ArrangementNumber[] : []), ...(live.scaleMode === 'linear' && live.mode !== 'spherical' ? ['scaleDirection'] as ArrangementNumber[] : []), ...(live.scaleMode === 'ripple' ? ['rippleFocus'] as ArrangementNumber[] : []), ...(live.mode !== 'spherical' ? ['depth', 'depthAnchor'] as ArrangementNumber[] : [])])}
    </details>
    <details className="space-y-2"><summary className="cursor-pointer text-[11px] font-medium text-text-muted">Randomness</summary>{fields(['shuffle', 'randomOffset', 'seed'])}</details>
    <div className="space-y-2 border-t border-border pt-3">
      <div className="text-[11px] font-medium text-text-muted">Members · {a.memberIds.length}</div>
      {a.memberIds.length === 0 && <p className="text-[11px] text-text-muted">Add blue squares to try the pattern, or choose your own layers.</p>}
      {a.memberIds.length === 0 && <button disabled={node.locked} className={control} onClick={() => addArrangementBlueSquares(api, node.id)}>Add blue squares</button>}
      {a.memberIds.map((id, index) => { const item = api.getNode(id); return item && <div key={id} draggable={!node.locked} onDragStart={() => setDragged(id)} onDragEnd={() => setDragged(null)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (dragged && !node.locked) reorder(dragged, id); setDragged(null) }} className="flex items-center gap-1 rounded-md bg-panel-raised px-1 py-1.5 text-[11px]">
        <GripVertical size={12} className="shrink-0 text-text-dim" /><span className="text-text-dim">{index + 1}</span>
        <button className="min-w-0 flex-1 truncate text-left" onClick={() => useUI.getState().setSelection([id])}>{item.name}</button>
        <button disabled={node.locked || index === 0} title="Move earlier" aria-label={`Move ${item.name} earlier`} onClick={() => reorder(id, a.memberIds[index - 1]!)}><ArrowUp size={12} /></button>
        <button disabled={node.locked || index === a.memberIds.length - 1} title="Move later" aria-label={`Move ${item.name} later`} onClick={() => reorder(id, a.memberIds[index + 1]!)}><ArrowDown size={12} /></button>
        <button disabled={node.locked || item.locked || !candidate} title="Replace with chosen layer" aria-label={`Replace ${item.name}`} onClick={() => run(() => {
          const layout = getLastSolvedLayout(); if (!layout) return
          api.doc.transact(() => {
            addArrangementMembers(api, node.id, [candidate], layout, getAnimEngine().getSnapshot())
            if (!api.getNode(node.id)?.arrangement?.memberIds.includes(candidate)) return
            removeArrangementMember(api, node.id, id, getAnimEngine().getSnapshot(), getLastSolvedLayout() ?? undefined)
            api.setNodeProperty(node.id, 'arrangement', { ...api.getNode(node.id)!.arrangement!, memberIds: a.memberIds.map((key) => key === id ? candidate : key) })
          }, UNDOABLE_GESTURE_ORIGIN)
          setCandidate('')
        })}><Copy size={12} /></button>
        <button disabled={node.locked || item.locked} aria-label={`Detach ${item.name}`} onClick={() => removeArrangementMember(api, node.id, id, getAnimEngine().getSnapshot(), getLastSolvedLayout() ?? undefined)}><X size={12} /></button>
      </div> })}
      <select aria-label="Layer to add or replace" className={control} value={candidate} disabled={node.locked} onChange={(e) => setCandidate(e.target.value)}><option value="">Choose a layer…</option>{candidates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <button disabled={!candidate || node.locked} className={`${control} disabled:opacity-40`} onClick={() => run(() => { const layout = getLastSolvedLayout(); if (layout) addArrangementMembers(api, node.id, [candidate], layout, getAnimEngine().getSnapshot()); setCandidate('') })}>Add layer</button>
      <p className="text-[11px] text-text-dim">Drag to reorder without changing the layer stack. Choose a layer above to add it or replace an existing member.</p>
      {error && <p role="alert" className="text-[11px] text-red-400">{error}</p>}
    </div>
  </section>
}
