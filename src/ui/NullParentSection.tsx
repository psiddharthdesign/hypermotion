// SPDX-License-Identifier: Apache-2.0
import { useState } from 'react'
import { Link2, Unlink } from 'lucide-react'
import type { Node, SceneAPI } from '@/scene'
import { getAnimEngine } from '@/anim'
import { canParentToNull, setNullParent } from '@/scene/nullObject'
import { useUI } from '@/state/ui'

export function NullParentSection({ node, api }: { node: Node; api: SceneAPI }) {
  const [error, setError] = useState('')
  if (node.id === api.getRoot() || node.kind === 'audio') return null
  const nulls = api.getAllNodeIds().flatMap((id) => {
    const candidate = api.getNode(id)
    return candidate?.kind === 'null' && (candidate.id === node.transformParent?.nodeId || canParentToNull(api, node.id, id)) ? [candidate] : []
  })
  const linked = api.getAllNodeIds().flatMap((id) => {
    const candidate = api.getNode(id)
    return candidate?.transformParent?.nodeId === node.id ? [candidate] : []
  })
  return (
    <section className="space-y-2 border-t border-border pt-3" aria-label="Null connection">
      <div className="flex items-center gap-2 text-[11px] font-medium text-text-muted"><Link2 size={13} />Parent to Null</div>
      <select aria-label="Parent to Null" disabled={node.locked}
        className="w-full rounded-md border border-border bg-panel-raised px-2 py-1.5 text-[12px] text-text"
        value={node.transformParent?.nodeId ?? ''}
        onChange={(event) => {
          const ok = setNullParent(api, node.id, event.target.value || null, getAnimEngine().getSnapshot())
          setError(ok ? '' : 'Cannot connect while the Null has zero scale.')
        }}>
        <option value="">None</option>
        {nulls.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
      {error && <p role="alert" className="text-[11px] text-red-400">{error}</p>}
      {node.kind === 'null' && <>
        <p className="text-[11px] text-text-dim">Invisible in exports. Animate this Null to move, rotate, or scale its connected layers and cameras.</p>
        <div className="text-[11px] text-text-muted">{linked.length} connected {linked.length === 1 ? 'object' : 'objects'}</div>
        {linked.map((item) => <div key={item.id} className="flex items-center gap-2 text-[12px]">
          <button className="min-w-0 flex-1 truncate text-left hover:text-accent" onClick={() => useUI.getState().setSelection([item.id])}>{item.name}</button>
          <button disabled={item.locked} aria-label={`Disconnect ${item.name}`} title={`Disconnect ${item.name}`} onClick={() => setNullParent(api, item.id, null, getAnimEngine().getSnapshot())}><Unlink size={13} /></button>
        </div>)}
      </>}
    </section>
  )
}
