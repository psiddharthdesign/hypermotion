// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from 'react'
import { Blend, ArrowRightToLine, ArrowLeftFromLine, GripVertical, MousePointer2 } from 'lucide-react'
import { useSceneAPI } from '@/scene'
import { getProjectAPI } from '@/project/doc'
import { UNDOABLE_GESTURE_ORIGIN } from '@/scene/undo'
import { useUI } from '@/state/ui'
import { placeTransition, TRANSITION_MIME, type TransitionKind, type TransitionTarget } from './transitionPlacement'
import './transitions.css'
const tiles = [
  { kind: 'dissolve' as const, name: 'Cross dissolve', detail: 'Between clips or cameras', Icon: Blend },
  { kind: 'in' as const, name: 'Fade in', detail: 'Beginning of a layer', Icon: ArrowRightToLine },
  { kind: 'out' as const, name: 'Fade out', detail: 'End of a layer', Icon: ArrowLeftFromLine },
]
export function TransitionsPanel() {
  const api = useSceneAPI()
  const selection = useUI(s => s.selection)
  const [picked, setPicked] = useState<TransitionKind | null>(null)
  const [duration, setDuration] = useState(0.35)
  const [message, setMessage] = useState('')
  const [placed, setPlaced] = useState<{target: TransitionTarget; kind: TransitionKind} | null>(null)
  useEffect(() => {
    let highlighted: HTMLElement | null = null
    const clear = () => { highlighted?.removeAttribute('data-transition-hover'); highlighted = null }
    const targetFor = (event: MouseEvent | DragEvent): TransitionTarget | null => {
      const element = (event.target as HTMLElement)?.closest<HTMLElement>('[data-transition-camera],[data-transition-layer],[data-transition-scene],[data-transition-master]')
      if (!element) { clear(); return null }
      clear(); highlighted = element
      const side = event.clientX < element.getBoundingClientRect().left + element.getBoundingClientRect().width / 2 ? 'in' : 'out'
      element.setAttribute('data-transition-hover', side)
      if (element.dataset.transitionMaster) return {type: 'master', id: element.dataset.transitionMaster, side}
      if (element.dataset.transitionCamera) return {type: 'camera', id: element.dataset.transitionCamera, side}
      if (element.dataset.transitionScene) return {type: 'scene', id: element.dataset.transitionScene, side}
      return {type: 'layer', id: element.dataset.transitionLayer!, side}
    }
    const apply = (target: TransitionTarget, kind: TransitionKind) => {
      try { setMessage(placeTransition(api, target, kind, duration)); setPlaced({target, kind}); setPicked(null) }
      catch (error) { setMessage(error instanceof Error ? error.message : 'Could not place transition.') }
      clear()
    }
    const over = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes(TRANSITION_MIME)) return
      if (targetFor(event)) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'copy' }
    }
    const drop = (event: DragEvent) => {
      const value = event.dataTransfer?.getData(TRANSITION_MIME)
      if (value !== 'dissolve' && value !== 'in' && value !== 'out') return
      const target = targetFor(event)
      event.preventDefault(); event.stopPropagation()
      if (target) apply(target, value)
      else { clear(); setMessage('Drop onto a camera cut or a layer edge.') }
    }
    const move = (event: MouseEvent) => { if (picked) targetFor(event) }
    const click = (event: MouseEvent) => {
      if (!picked) return
      const target = targetFor(event)
      if (target) { event.preventDefault(); event.stopPropagation(); apply(target, picked) }
    }
    const down = (event: PointerEvent) => { if (picked && targetFor(event)) { event.preventDefault(); event.stopPropagation() } }
    const edit = (event: Event) => { const detail = (event as CustomEvent).detail; setPlaced({ target: detail.target, kind: 'dissolve' }); setDuration(detail.duration); setMessage('Selected dissolve. Change duration, then update it below.') }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { setPicked(null); clear() } }
    document.addEventListener('pointerdown', down, true)
    const removed = () => { setPlaced(null); setMessage('Transition removed.') }
    document.addEventListener('hm-transition-removed', removed)
    document.addEventListener('hm-edit-transition', edit)
    document.addEventListener('dragover', over, true)
    document.addEventListener('drop', drop, true)
    document.addEventListener('mousemove', move, true)
    document.addEventListener('click', click, true)
    document.addEventListener('dragend', clear, true)
    document.addEventListener('keydown', key)
    return () => {
      clear()
      document.removeEventListener('pointerdown', down, true)
      document.removeEventListener('hm-transition-removed', removed)
      document.removeEventListener('hm-edit-transition', edit)
      document.removeEventListener('dragover', over, true); document.removeEventListener('drop', drop, true)
      document.removeEventListener('mousemove', move, true); document.removeEventListener('click', click, true)
      document.removeEventListener('dragend', clear, true); document.removeEventListener('keydown', key)
    }
  }, [api, picked, duration])
  return <div className="space-y-5">
    <div><h3 className="text-sm font-semibold">Transitions</h3><p className="mt-1 text-xs text-text-muted">Drag an effect onto a cut or layer edge.</p></div>
    <div className="grid grid-cols-2 gap-3">{tiles.map(({kind,name,detail,Icon}) => <button
      key={kind} type="button" draggable aria-pressed={picked === kind}
      className={`hm-transition-tile ${picked === kind ? 'is-picked' : ''}`}
      onClick={() => { setPicked(picked === kind ? null : kind); setMessage('Click a camera cut or layer edge to place the effect. Escape cancels.') }}
      onDragStart={event => { event.dataTransfer.setData(TRANSITION_MIME,kind); event.dataTransfer.effectAllowed='copy'; setPicked(null); setMessage('Drop on a highlighted cut or layer edge.') }}>
      <div className={`hm-transition-preview hm-transition-${kind}`}><span/><span/><Icon size={24}/><GripVertical size={12} className="hm-transition-grip"/></div>
      <span className="block px-2 pt-2 text-xs font-medium">{name}</span><span className="block px-2 pb-3 pt-1 text-[10px] text-text-muted">{detail}</span>
    </button>)}</div>
    <label className="flex items-center justify-between gap-3 text-xs"><span>Duration</span><span className="flex items-center gap-2"><input aria-label="Transition duration" className="w-20 rounded border border-border bg-panel px-2 py-1.5" type="number" min="0.05" step="0.05" value={duration} onChange={event => { const value = event.target.valueAsNumber; if(Number.isFinite(value) && value > 0) setDuration(value) }}/><span className="text-text-muted">s</span></span></label>
    {picked && <button className="w-full rounded border border-border px-3 py-2 text-xs" disabled={!selection.length || picked === 'dissolve'} onClick={() => {
      try { for(const id of selection) setMessage(placeTransition(api,{type:'layer',id,side:picked === 'in' ? 'in' : 'out'},picked,duration)); setPicked(null) }
      catch(error){setMessage(error instanceof Error ? error.message : 'Could not apply fade.')}
    }}><MousePointer2 size={12} className="mr-2 inline"/>Apply to selected layers</button>}
    {placed && placed.target.type !== 'layer' && <button className="w-full rounded border border-border px-3 py-2 text-xs" onClick={() => { try {setMessage(placeTransition(api,placed.target,placed.kind,duration))} catch(error){setMessage(String(error))} }}>Update placed transition duration</button>}
    {placed?.target.type === 'master' && <button className="w-full rounded border border-border px-3 py-2 text-xs" onClick={() => {
      const project = getProjectAPI(api)
      const items = project.getSequenceTimeMap().items
      const hit = items.findIndex(item => item.item.id === placed.target.id)
      const index = placed.target.side === 'in' ? hit - 1 : hit
      const item = hit >= 0 ? items[index] : undefined
      if (!item) { setPlaced(null); return }
      api.doc.transact(() => project.setTransition(item.item.id, {kind: 'cut', duration: 0}), UNDOABLE_GESTURE_ORIGIN)
      setPlaced(null)
      setMessage('Scene transition removed.')
    }}>Remove transition</button>}
    <p role="status" className="text-xs leading-relaxed text-text-muted">{message || 'Cross dissolve blends neighboring videos, camera views, or scenes. Fade tiles work on a single visual layer.'}</p>
  </div>
}
