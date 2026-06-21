// SPDX-License-Identifier: Apache-2.0

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useSceneAPI, useSceneVersion } from '@/scene'
import type { ComponentNode, NodeId } from '@/scene'
import { useUI } from '@/state/ui'
import { useLayout } from '@/ui/hooks/useLayout'
import {
  SceneLayer,
  composeInheritedAnim,
  type InheritedAnim,
} from '@/ui/Canvas'
import { SelectionOverlay } from '@/ui/SelectionOverlay'
import { evaluator } from '@/anim/easing'
import type { AnimatedValue } from '@/ui/hooks/useAnimatedValues'
import {
  addComponentVariantInteraction,
  applyComponentVariantState,
  fitComponentToChildren,
  measureComponentChildBounds,
  upsertComponentVariant,
} from '@/ui/actions'

const EMPTY_INHERITED: Record<NodeId, InheritedAnim> = {}
const EMPTY_ANIMATED: Record<NodeId, AnimatedValue> = {}

type SurfacePoint = { x: number; y: number }
type ConnectorDraft = SurfacePoint & {
  fromState: string
  x1: number
  y1: number
}
type VariantDrag = {
  state: string
  startClientX: number
  startClientY: number
  originX: number
  originY: number
  moved: boolean
}

export function ComponentEditor() {
  const sceneVersion = useSceneVersion()
  const api = useSceneAPI()
  const componentEditId = useUI((s) => s.componentEditId)
  const setComponentEditId = useUI((s) => s.setComponentEditId)
  const setSelection = useUI((s) => s.setSelection)
  const view = useUI((s) => s.view)
  const setView = useUI((s) => s.setView)
  const zoomAt = useUI((s) => s.zoomAt)
  const workspaceRef = useRef<HTMLElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const suppressVariantClickRef = useRef(false)
  const [activeState, setActiveState] = useState<string | null>(null)
  const [editingVariant, setEditingVariant] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [previewing, setPreviewing] = useState(false)
  const [previewAnimated, setPreviewAnimated] = useState<Record<NodeId, AnimatedValue>>({})
  const [connectorDraft, setConnectorDraft] = useState<ConnectorDraft | null>(null)
  const [variantDrag, setVariantDrag] = useState<VariantDrag | null>(null)
  const [liveVariantPositions, setLiveVariantPositions] = useState<
    Record<string, SurfacePoint>
  >({})
  const seededDefaultRef = useRef<NodeId | null>(null)

  const component = componentEditId
    ? api.getNode(componentEditId)
    : null
  const master =
    component && component.kind === 'component'
      ? (component as ComponentNode)
      : null

  const container = useMemo(() => {
    const bounds = master ? measureComponentChildBounds(api, master.id) : null
    const hugWidth = bounds ? Math.ceil(bounds.maxX - bounds.minX) : 480
    const hugHeight = bounds ? Math.ceil(bounds.maxY - bounds.minY) : 240
    return {
      width: Math.max(1, numericSize(master?.size.width, hugWidth)),
      height: Math.max(1, numericSize(master?.size.height, hugHeight)),
    }
  }, [api, master, master?.id, master?.size.height, master?.size.width, sceneVersion])
  const solved = useLayout(master?.id ?? null, container)
  const order = useMemo<NodeId[]>(() => {
    void sceneVersion
    if (!master) return []
    const out: NodeId[] = []
    const visit = (id: NodeId) => {
      out.push(id)
      for (const child of api.getChildren(id)) visit(child.id)
    }
    visit(master.id)
    return out
  }, [api, master, sceneVersion])
  const animated = previewing ? previewAnimated : EMPTY_ANIMATED
  const inherited = useMemo(
    () => (master ? composeInheritedAnim(api, master.id, animated, solved) : EMPTY_INHERITED),
    [api, master, animated, solved],
  )

  const variants = master ? variantNames(master) : ['Default']
  const baseVariants = baseVariantNames(variants)
  const selectedState =
    activeState && variants.includes(activeState) ? activeState : variants[0]!
  const selectedParts = parseVariantState(selectedState)
  const selectedBase = baseVariants.includes(selectedParts.base)
    ? selectedParts.base
    : baseVariants[0]!
  const switchVariant = (nextState: string) => {
    if (!master || nextState === selectedState) return
    upsertComponentVariant(api, master.id, selectedState)
    applyComponentVariantState(api, master.id, nextState)
    setActiveState(nextState)
    setSelection([master.id])
  }
  const beginRenameVariant = (name: string) => {
    setEditingVariant(name)
    setEditingName(name)
  }
  const commitRenameVariant = () => {
    if (!master || !editingVariant) return
    const next = editingName.trim()
    if (!next || next === editingVariant || variants.includes(next)) {
      setEditingVariant(null)
      return
    }
    renameComponentVariant(api, master.id, editingVariant, next)
    if (selectedState === editingVariant) setActiveState(next)
    setEditingVariant(null)
  }
  const tileGap = 48
  const tileLabelHeight = 28
  const addTileWidth = Math.max(220, Math.min(320, container.width))
  const tileOuterHeight = tileLabelHeight + container.height
  const interactionSlotTop = tileOuterHeight + 54
  const interactionSlotHeight = Math.max(180, container.height)
  const variantPositions = useMemo(
    () =>
      resolveVariantPositions({
        stored: master?.variantPositions ?? {},
        live: liveVariantPositions,
        baseVariants,
        container,
        tileGap,
      }),
    [
      baseVariants,
      container.height,
      container.width,
      liveVariantPositions,
      master?.variantPositions,
      tileGap,
    ],
  )
  const selectedBasePosition = variantPositions[selectedBase] ?? { x: 0, y: 0 }
  const surfaceWidth = Math.max(
    620,
    boardMaxX(variantPositions, container.width) + tileGap + addTileWidth,
  )
  const surfaceHeight = Math.max(
    selectedBasePosition.y + interactionSlotTop + interactionSlotHeight,
    Math.max(260, container.height),
  )
  const addVariant = () => {
    if (!master) return
    const name = nextVariantName(variants)
    upsertComponentVariant(api, master.id, selectedState)
    upsertComponentVariant(api, master.id, name)
    applyComponentVariantState(api, master.id, name)
    setActiveState(name)
  }
  const addInteractionState = (state: 'Hover' | 'Pressed') => {
    if (!master) return
    const name = `${selectedBase} / ${state}`
    upsertComponentVariant(api, master.id, selectedState)
    if (!variants.includes(name)) {
      applyComponentVariantState(api, master.id, selectedBase)
      upsertComponentVariant(api, master.id, name)
      if (state === 'Hover') {
        addComponentVariantInteraction(api, master.id, {
          event: 'hoverIn',
          targetState: name,
        })
        addComponentVariantInteraction(api, master.id, {
          event: 'hoverOut',
          targetState: selectedBase,
        })
      } else {
        addComponentVariantInteraction(api, master.id, {
          event: 'pointerDown',
          targetState: name,
        })
        addComponentVariantInteraction(api, master.id, {
          event: 'pointerUp',
          targetState: selectedBase,
        })
      }
    }
    applyComponentVariantState(api, master.id, name)
    setActiveState(name)
    setSelection([master.id])
  }
  const screenToSurfacePoint = (clientX: number, clientY: number): SurfacePoint | null => {
    const rect = surfaceRef.current?.getBoundingClientRect()
    if (!rect) return null
    return {
      x: (clientX - rect.left) / view.zoom,
      y: (clientY - rect.top) / view.zoom,
    }
  }
  const startConnector = (
    event: ReactPointerEvent,
    fromState: string,
    x1: number,
    y1: number,
  ) => {
    event.preventDefault()
    event.stopPropagation()
    const point = screenToSurfacePoint(event.clientX, event.clientY) ?? { x: x1, y: y1 }
    setConnectorDraft({ fromState, x1, y1, x: point.x, y: point.y })
  }
  const startVariantDrag = (
    event: ReactPointerEvent,
    state: string,
    origin: SurfacePoint,
  ) => {
    if (editingVariant) return
    setVariantDrag({
      state,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originX: origin.x,
      originY: origin.y,
      moved: false,
    })
  }
  const finishConnector = (point: SurfacePoint) => {
    if (!master || !connectorDraft) return
    const target = findConnectorTarget(point, {
      variants,
      baseVariants,
      selectedBase,
      positions: variantPositions,
      container,
      tileGap,
      tileLabelHeight,
      interactionSlotTop,
      interactionSlotHeight,
      addTileWidth,
    })
    setConnectorDraft(null)
    if (!target) return
    if (target.kind === 'variant' && target.state === connectorDraft.fromState) return
    if (target.kind === 'variant') {
      addComponentVariantInteraction(api, master.id, {
        event: 'click',
        targetState: target.state,
      })
      return
    }
    addInteractionState(target.state)
  }
  const fitComponent = () => {
    const el = workspaceRef.current
    if (!el) {
      setView({ zoom: 1, panX: 0, panY: 0 })
      return
    }
    const rect = el.getBoundingClientRect()
    const targetZoom = Math.min(
      1.5,
      Math.max(
        0.25,
        Math.min(
          (rect.width - 160) / Math.max(surfaceWidth, 1),
          (rect.height - 180) / Math.max(surfaceHeight, 1),
        ),
      ),
    )
    setView({ zoom: targetZoom, panX: 0, panY: 0 })
  }

  useEffect(() => {
    if (!master) return
    if (seededDefaultRef.current !== master.id) {
      const hasDefaultSnapshot = master.variantOverrides.some(
        (entry) => entry.match.State === 'Default',
      )
      if (!hasDefaultSnapshot) upsertComponentVariant(api, master.id, 'Default')
      seededDefaultRef.current = master.id
    }
    if (fitComponentToChildren(api, master.id, { preserveHug: true })) return
    requestAnimationFrame(fitComponent)
  }, [api, master?.id, sceneVersion])

  useEffect(() => {
    const el = workspaceRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!el.contains(e.target as Node)) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const ox = e.clientX - rect.left - rect.width / 2
      const oy = e.clientY - rect.top - rect.height / 2
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * 0.01)
        zoomAt(view.zoom * factor, ox, oy)
      } else {
        setView({ panX: view.panX - e.deltaX, panY: view.panY - e.deltaY })
      }
    }
    el.addEventListener('wheel', onWheel, { capture: true, passive: false })
    return () => el.removeEventListener('wheel', onWheel, { capture: true })
  }, [setView, view.panX, view.panY, view.zoom, zoomAt])

  useEffect(() => {
    if (!connectorDraft) return
    const onMove = (event: PointerEvent) => {
      const point = screenToSurfacePoint(event.clientX, event.clientY)
      if (!point) return
      setConnectorDraft((draft) =>
        draft ? { ...draft, x: point.x, y: point.y } : draft,
      )
    }
    const onUp = (event: PointerEvent) => {
      const point = screenToSurfacePoint(event.clientX, event.clientY)
      if (point) finishConnector(point)
      else setConnectorDraft(null)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setConnectorDraft(null)
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [connectorDraft, variantPositions, view.zoom])

  useEffect(() => {
    if (!variantDrag || !master) return
    const onMove = (event: PointerEvent) => {
      const dx = (event.clientX - variantDrag.startClientX) / view.zoom
      const dy = (event.clientY - variantDrag.startClientY) / view.zoom
      const moved = variantDrag.moved || Math.hypot(dx, dy) > 3
      const next = {
        x: Math.round(variantDrag.originX + dx),
        y: Math.round(variantDrag.originY + dy),
      }
      setVariantDrag({ ...variantDrag, moved })
      setLiveVariantPositions((positions) => ({
        ...positions,
        [variantDrag.state]: next,
      }))
    }
    const onUp = () => {
      const latest =
        liveVariantPositions[variantDrag.state] ?? {
          x: variantDrag.originX,
          y: variantDrag.originY,
        }
      api.setNodeProperty(master.id, 'variantPositions', {
        ...(master.variantPositions ?? {}),
        [variantDrag.state]: latest,
      } as never)
      suppressVariantClickRef.current = variantDrag.moved
      setVariantDrag(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [api, liveVariantPositions, master, variantDrag, view.zoom])

  const playPrototype = () => {
    if (!master) return
    const variant = master.variantOverrides.find(
      (entry) => entry.match.State === selectedState,
    )
    if (!variant) {
      setPreviewing(false)
      setPreviewAnimated({})
      return
    }
    const duration = Math.max(0.01, master.variantTransition.duration || 0.3)
    const ease = evaluator(master.variantTransition.easing)
    const starts: Record<NodeId, AnimatedValue> = {}
    const targets: Record<NodeId, AnimatedValue> = {}
    for (const [nodeId, patch] of Object.entries(variant.overrides)) {
      const node = api.getNode(nodeId)
      if (!node) continue
      starts[nodeId] = {
        x: node.transform.x,
        y: node.transform.y,
        z: node.transform.z,
        rotation: node.transform.rotation,
        rotationX: node.transform.rotationX,
        rotationY: node.transform.rotationY,
        scaleX: node.transform.scaleX,
        scaleY: node.transform.scaleY,
        opacity: node.appearance.opacity,
        cornerRadius: node.appearance.cornerRadius,
      }
      targets[nodeId] = previewTargetForPatch(starts[nodeId]!, patch)
    }
    setPreviewing(true)
    const startedAt = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - startedAt) / (duration * 1000))
      const u = ease(t)
      const next: Record<NodeId, AnimatedValue> = {}
      for (const [nodeId, start] of Object.entries(starts)) {
        const target = targets[nodeId]
        if (!target) continue
        next[nodeId] = interpolatePreviewValue(start, target, u)
      }
      setPreviewAnimated(next)
      if (t < 1) {
        raf = requestAnimationFrame(tick)
      } else {
        window.setTimeout(() => {
          setPreviewing(false)
          setPreviewAnimated({})
        }, 180)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }

  if (!master) {
    return (
      <main className="flex min-w-0 flex-1 items-center justify-center bg-app-bg text-[13px] text-text-dim">
        <button
          type="button"
          onClick={() => setComponentEditId(null)}
          className="rounded-md border border-border px-3 py-2 text-text-muted hover:bg-panel-raised hover:text-text"
        >
          Back to canvas
        </button>
      </main>
    )
  }

  return (
    <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-app-bg">
      <div className="z-10 flex h-12 shrink-0 items-center justify-between gap-4 border-b border-border bg-panel px-4">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setComponentEditId(null)
              setSelection([master.id])
            }}
            className="rounded-md bg-panel-raised px-3 py-1.5 text-[12px] font-medium text-text-muted hover:text-text"
          >
            Home
          </button>
          <span className="text-text-dim">›</span>
          <div className="flex min-w-0 items-center gap-2 rounded-md bg-[oklch(0.64_0.24_300_/_0.18)] px-3 py-1.5 text-[12px] font-semibold text-[oklch(0.76_0.22_300)]">
            <span className="font-mono">◆</span>
            <span className="max-w-[220px] truncate">{master.name}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={playPrototype}
            className="h-8 rounded-md bg-[oklch(0.64_0.24_300)] px-3 text-[12px] font-semibold text-white shadow-sm"
          >
            {previewing ? 'Playing' : 'Play'}
          </button>
          <div className="flex items-center gap-1 rounded-md border border-border bg-app-bg p-1">
            <button
              type="button"
              onClick={fitComponent}
              className="h-7 rounded px-2 text-[11px] font-semibold text-text-muted hover:bg-panel-raised hover:text-text"
            >
              Fit
            </button>
            <button
              type="button"
              onClick={() => setView({ zoom: 1, panX: 0, panY: 0 })}
              className="h-7 rounded px-2 text-[11px] font-semibold text-text-muted hover:bg-panel-raised hover:text-text"
            >
              100%
            </button>
            <span className="px-2 font-mono text-[11px] text-text-dim">
              {Math.round(view.zoom * 100)}%
            </span>
          </div>
        </div>
      </div>

      <div
        ref={workspaceRef}
        className="relative min-h-0 flex-1 overflow-hidden bg-app-bg"
      >
        <div className="absolute inset-0">
          <div
            ref={surfaceRef}
            className="absolute left-1/2 top-1/2"
            style={{
              width: surfaceWidth,
              height: surfaceHeight,
              marginLeft: -surfaceWidth / 2,
              marginTop: -surfaceHeight / 2,
              transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`,
              transformOrigin: 'center center',
            }}
          >
            <ConnectorOverlay
              master={master}
              variants={variants}
              baseVariants={baseVariants}
              selectedBase={selectedBase}
              selectedState={selectedState}
              positions={variantPositions}
              container={container}
              tileGap={tileGap}
              tileLabelHeight={tileLabelHeight}
              interactionSlotTop={interactionSlotTop}
              interactionSlotHeight={interactionSlotHeight}
              surfaceWidth={surfaceWidth}
              surfaceHeight={surfaceHeight}
              draft={connectorDraft}
            />
            {baseVariants.map((name, index) => {
              const isActive = name === selectedState
              const isFamilyActive = name === selectedBase
              const tilePosition = variantPositions[name] ?? {
                x: index * (container.width + tileGap),
                y: 0,
              }
              const tileAnimated = isActive
                ? animated
                : variantPreviewAnimated(master, name)
              const tileInherited = isActive
                ? inherited
                : composeInheritedAnim(api, master.id, tileAnimated, solved)
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => {
                    if (suppressVariantClickRef.current) {
                      suppressVariantClickRef.current = false
                      return
                    }
                    switchVariant(name)
                  }}
                  onPointerDown={(event) =>
                    startVariantDrag(event, name, tilePosition)
                  }
                  onDoubleClick={(event) => {
                    event.stopPropagation()
                    beginRenameVariant(name)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      beginRenameVariant(name)
                    }
                  }}
                  className="absolute block text-left outline-none"
                  style={{
                    left: tilePosition.x,
                    top: tilePosition.y,
                    width: container.width,
                    height: tileOuterHeight,
                  }}
                >
                  <div
                    className={[
                      'mb-2 flex h-5 items-center gap-2 text-[11px] font-semibold',
                      isFamilyActive
                        ? 'text-[oklch(0.5_0.22_300)]'
                        : 'text-text-muted',
                    ].join(' ')}
                  >
                    <span
                      className={[
                        'grid h-4 w-4 place-items-center rounded',
                        isFamilyActive
                          ? 'bg-[oklch(0.64_0.24_300)] text-white'
                          : 'bg-panel-raised text-[oklch(0.64_0.24_300)]',
                      ].join(' ')}
                    >
                      {isFamilyActive ? '▶' : '◆'}
                    </span>
                    {editingVariant === name ? (
                      <input
                        value={editingName}
                        onChange={(event) => setEditingName(event.target.value)}
                        onBlur={commitRenameVariant}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') commitRenameVariant()
                          if (event.key === 'Escape') setEditingVariant(null)
                        }}
                        autoFocus
                        className="h-6 w-36 rounded border border-[oklch(0.64_0.24_300)] bg-panel px-1.5 text-[11px] text-text outline-none"
                      />
                    ) : (
                      <span className="max-w-full truncate">{name}</span>
                    )}
                  </div>
                  <div
                    className={[
                      'relative overflow-visible rounded-lg border bg-panel shadow-2xl',
                      isActive
                        ? 'border-[oklch(0.64_0.24_300)]'
                        : 'border-border hover:border-[oklch(0.64_0.24_300_/_0.45)]',
                    ].join(' ')}
                    style={{
                      width: container.width,
                      height: container.height,
                    }}
                  >
                    {!solved ? (
                      <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 font-mono text-[11px] text-text-dim">
                        preparing component…
                      </span>
                    ) : (
                      <div className={isActive || isFamilyActive ? '' : 'pointer-events-none'}>
                        <SceneLayer
                          rootId={master.id}
                          solved={solved}
                          order={order}
                          animated={tileAnimated}
                          inherited={tileInherited}
                        />
                        {isActive ? (
                          <div className="pointer-events-none absolute inset-0">
                            <SelectionOverlay
                              solved={solved}
                              animated={tileAnimated}
                              inherited={tileInherited}
                              zoom={view.zoom}
                              rootId={master.id}
                            />
                          </div>
                        ) : null}
                        {isFamilyActive ? (
                          <>
                            <span className="pointer-events-none absolute left-[-9px] top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-[oklch(0.64_0.24_300)] bg-panel" />
                            <span
                              role="button"
                              tabIndex={0}
                              onPointerDown={(event) =>
                                startConnector(
                                  event,
                                  name,
                                  tilePosition.x + container.width + 14,
                                  tilePosition.y + tileLabelHeight + container.height / 2,
                                )
                              }
                              className="absolute right-[-17px] top-1/2 z-20 grid h-8 w-8 -translate-y-1/2 cursor-crosshair place-items-center rounded-full border-2 border-[oklch(0.64_0.24_300)] bg-panel text-[oklch(0.64_0.24_300)] shadow-sm hover:bg-[oklch(0.64_0.24_300)] hover:text-white"
                              title="Drag to another variant"
                            >
                              ⚡
                            </span>
                          </>
                        ) : null}
                      </div>
                    )}
                  </div>
                </button>
              )
            })}
            <button
              type="button"
              onClick={addVariant}
              className="absolute grid place-items-center rounded-lg border border-dashed border-border bg-panel text-center text-text-dim hover:border-[oklch(0.64_0.24_300_/_0.55)] hover:text-[oklch(0.5_0.22_300)]"
              style={{
                left: boardMaxX(variantPositions, container.width) + tileGap,
                top: tileLabelHeight,
                width: addTileWidth,
                height: Math.max(140, container.height),
              }}
            >
              <span className="flex flex-col items-center gap-3">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-panel-raised text-lg font-semibold">
                  +
                </span>
                <span className="text-[13px] font-medium">
                  {nextVariantName(variants)}
                </span>
              </span>
            </button>
            <InteractionStateSlot
              master={master}
              baseName={selectedBase}
              selectedState={selectedState}
              variants={variants}
              left={selectedBasePosition.x}
              top={selectedBasePosition.y + interactionSlotTop}
              width={container.width}
              height={interactionSlotHeight}
              onSwitch={switchVariant}
              onAdd={addInteractionState}
            />
          </div>
        </div>
      </div>
    </main>
  )
}

function variantNames(component: ComponentNode): string[] {
  const axis = component.variants.find((variant) => variant.name === 'State')
  const values = axis?.values.length ? axis.values : ['Default']
  return values
}

function baseVariantNames(variants: string[]): string[] {
  const base = variants.filter((name) => parseVariantState(name).state === 'Primary')
  return base.length ? base : ['Default']
}

function parseVariantState(name: string): { base: string; state: string } {
  const [base, state] = name.split(' / ')
  return { base: base || name, state: state || 'Primary' }
}

function nextVariantName(variants: string[]): string {
  let index = baseVariantNames(variants).length + 1
  let name = `Variant ${index}`
  while (variants.includes(name)) {
    index += 1
    name = `Variant ${index}`
  }
  return name
}

function resolveVariantPositions({
  stored,
  live,
  baseVariants,
  container,
  tileGap,
}: {
  stored: Record<string, SurfacePoint>
  live: Record<string, SurfacePoint>
  baseVariants: string[]
  container: { width: number; height: number }
  tileGap: number
}): Record<string, SurfacePoint> {
  const out: Record<string, SurfacePoint> = {}
  baseVariants.forEach((name, index) => {
    out[name] = live[name] ?? stored[name] ?? {
      x: index * (container.width + tileGap),
      y: 0,
    }
  })
  return out
}

function boardMaxX(
  positions: Record<string, SurfacePoint>,
  tileWidth: number,
): number {
  return Math.max(
    tileWidth,
    ...Object.values(positions).map((point) => point.x + tileWidth),
  )
}

function renameComponentVariant(
  api: ReturnType<typeof useSceneAPI>,
  componentId: NodeId,
  oldName: string,
  newName: string,
): void {
  const component = api.getNode(componentId)
  if (!component || component.kind !== 'component') return
  api.doc.transact(() => {
    api.setNodeProperty(
      component.id,
      'variants',
      component.variants.map((axis) =>
        axis.name === 'State'
          ? {
              ...axis,
              values: axis.values.map((value) => (value === oldName ? newName : value)),
            }
          : axis,
      ) as never,
    )
    api.setNodeProperty(
      component.id,
      'defaultSelection',
      component.defaultSelection.State === oldName
        ? { ...component.defaultSelection, State: newName }
        : component.defaultSelection,
    )
    api.setNodeProperty(
      component.id,
      'variantOverrides',
      component.variantOverrides.map((variant) =>
        variant.match.State === oldName
          ? { ...variant, match: { ...variant.match, State: newName } }
          : variant,
      ) as never,
    )
    api.setNodeProperty(
      component.id,
      'interactions',
      component.interactions.map((interaction) => ({
        ...interaction,
        actions: renameVariantActions(interaction.actions, oldName, newName),
      })) as never,
    )
  })
}

function renameVariantActions(
  actions: ComponentNode['interactions'][number]['actions'],
  oldName: string,
  newName: string,
): ComponentNode['interactions'][number]['actions'] {
  return actions.map((action) => {
    if (action.type === 'setVariant' && action.selection.State === oldName) {
      return { ...action, selection: { ...action.selection, State: newName } }
    }
    if (action.type === 'after') {
      return {
        ...action,
        action:
          action.action.type === 'setVariant' && action.action.selection.State === oldName
            ? {
                ...action.action,
                selection: { ...action.action.selection, State: newName },
              }
            : action.action,
      }
    }
    return action
  })
}

function InteractionStateSlot({
  master,
  baseName,
  selectedState,
  variants,
  left,
  top,
  width,
  height,
  onSwitch,
  onAdd,
}: {
  master: ComponentNode
  baseName: string
  selectedState: string
  variants: string[]
  left: number
  top: number
  width: number
  height: number
  onSwitch: (state: string) => void
  onAdd: (state: 'Hover' | 'Pressed') => void
}) {
  const hoverName = `${baseName} / Hover`
  const pressedName = `${baseName} / Pressed`
  const hoverExists = variants.includes(hoverName)
  const pressedExists = variants.includes(pressedName)
  const existing = [
    hoverExists ? hoverName : null,
    pressedExists ? pressedName : null,
  ].filter(Boolean) as string[]
  const showEmpty = existing.length === 0

  return (
    <div
      className="absolute"
      style={{ left, top, width, height }}
    >
      {existing.map((name, index) => (
        <button
          key={name}
          type="button"
          onClick={() => onSwitch(name)}
          className={[
            'absolute inset-x-0 rounded-lg border bg-panel text-left shadow-2xl outline-none',
            selectedState === name
              ? 'border-[oklch(0.64_0.24_300)]'
              : 'border-border hover:border-[oklch(0.64_0.24_300_/_0.45)]',
          ].join(' ')}
          style={{
            top: index * 48,
            height: Math.max(44, height / 2 - 12),
          }}
        >
          <span className="absolute left-4 top-3 text-[11px] font-semibold text-[oklch(0.5_0.22_300)]">
            {parseVariantState(name).state}
          </span>
          <span className="absolute bottom-3 left-4 text-[11px] text-text-dim">
            {interactionSummary(master, name)}
          </span>
        </button>
      ))}
      {showEmpty ? (
        <div className="grid h-full place-items-center rounded-lg border border-dashed border-border bg-panel/70 text-center text-text-dim">
          <div className="space-y-3">
            <div className="mx-auto grid h-8 w-8 place-items-center rounded-full bg-panel-raised text-lg font-semibold">
              +
            </div>
            <div className="text-[14px] font-medium">Hover / Pressed</div>
            <div className="flex justify-center gap-2">
              <button
                type="button"
                onClick={() => onAdd('Hover')}
                className="h-8 rounded-md bg-[oklch(0.64_0.24_300)] px-3 text-[11px] font-semibold text-white"
              >
                Hover
              </button>
              <button
                type="button"
                onClick={() => onAdd('Pressed')}
                className="h-8 rounded-md border border-border bg-panel px-3 text-[11px] font-semibold text-text-muted hover:text-text"
              >
                Pressed
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onAdd(hoverExists ? 'Pressed' : 'Hover')}
          className="absolute bottom-0 grid h-10 w-full place-items-center rounded-md border border-dashed border-border bg-panel/70 text-[11px] font-semibold text-text-dim hover:border-[oklch(0.64_0.24_300_/_0.55)] hover:text-[oklch(0.5_0.22_300)]"
        >
          + {hoverExists ? 'Pressed' : 'Hover'}
        </button>
      )}
    </div>
  )
}

function interactionSummary(component: ComponentNode, stateName: string): string {
  const event = component.interactions.find((interaction) =>
    interaction.actions.some((action) =>
      action.type === 'setVariant'
        ? action.selection.State === stateName
        : action.type === 'after' &&
          action.action.type === 'setVariant' &&
          action.action.selection.State === stateName,
    ),
  )?.event
  switch (event) {
    case 'hoverIn':
      return 'Mouse enter connector'
    case 'pointerDown':
      return 'Pressed connector'
    case 'click':
      return 'Click connector'
    default:
      return 'Variant connector'
  }
}

function ConnectorOverlay({
  master,
  variants,
  baseVariants,
  selectedBase,
  selectedState,
  positions,
  container,
  tileGap,
  tileLabelHeight,
  interactionSlotTop,
  interactionSlotHeight,
  surfaceWidth,
  surfaceHeight,
  draft,
}: {
  master: ComponentNode
  variants: string[]
  baseVariants: string[]
  selectedBase: string
  selectedState: string
  positions: Record<string, SurfacePoint>
  container: { width: number; height: number }
  tileGap: number
  tileLabelHeight: number
  interactionSlotTop: number
  interactionSlotHeight: number
  surfaceWidth: number
  surfaceHeight: number
  draft: ConnectorDraft | null
}) {
  const lines = connectorLinesForComponent(master, {
    variants,
    baseVariants,
      selectedBase,
      positions,
      container,
    tileGap,
    tileLabelHeight,
    interactionSlotTop,
    interactionSlotHeight,
  })
  return (
    <svg
      className="pointer-events-none absolute inset-0 z-10 overflow-visible"
      width={surfaceWidth}
      height={surfaceHeight}
      viewBox={`0 0 ${surfaceWidth} ${surfaceHeight}`}
    >
      <defs>
        <marker
          id="component-connector-arrow"
          markerWidth="8"
          markerHeight="8"
          refX="6"
          refY="4"
          orient="auto"
        >
          <path d="M 0 0 L 8 4 L 0 8 z" fill="oklch(0.64 0.24 300)" />
        </marker>
      </defs>
      {lines.map((line) => (
        <ConnectorPath
          key={`${line.fromState}-${line.toState}-${line.event}`}
          line={line}
          active={line.fromState === selectedState || line.fromState === selectedBase}
        />
      ))}
      {draft ? (
        <ConnectorPath
          line={{
            fromState: draft.fromState,
            toState: 'draft',
            event: 'drag',
            x1: draft.x1,
            y1: draft.y1,
            x2: draft.x,
            y2: draft.y,
          }}
          active
          dashed
        />
      ) : null}
    </svg>
  )
}

function ConnectorPath({
  line,
  active,
  dashed = false,
}: {
  line: ConnectorLine
  active: boolean
  dashed?: boolean
}) {
  const dx = Math.max(56, Math.abs(line.x2 - line.x1) * 0.45)
  const path = `M ${line.x1} ${line.y1} C ${line.x1 + dx} ${line.y1}, ${line.x2 - dx} ${line.y2}, ${line.x2} ${line.y2}`
  return (
    <g opacity={active ? 1 : 0.45}>
      <path
        d={path}
        fill="none"
        stroke="oklch(0.64 0.24 300 / 0.18)"
        strokeWidth={7}
        strokeLinecap="round"
      />
      <path
        d={path}
        fill="none"
        stroke="oklch(0.64 0.24 300)"
        strokeWidth={2.25}
        strokeLinecap="round"
        strokeDasharray={dashed ? '8 7' : undefined}
        markerEnd="url(#component-connector-arrow)"
      />
      {!dashed ? (
        <text
          x={(line.x1 + line.x2) / 2}
          y={(line.y1 + line.y2) / 2 - 8}
          textAnchor="middle"
          className="fill-[oklch(0.5_0.22_300)] text-[10px] font-semibold"
        >
          {connectorEventLabel(line.event)}
        </text>
      ) : null}
    </g>
  )
}

type ConnectorLine = {
  fromState: string
  toState: string
  event: string
  x1: number
  y1: number
  x2: number
  y2: number
}

type ConnectorLayout = {
  variants: string[]
  baseVariants: string[]
  selectedBase: string
  positions: Record<string, SurfacePoint>
  container: { width: number; height: number }
  tileGap: number
  tileLabelHeight: number
  interactionSlotTop: number
  interactionSlotHeight: number
}

function connectorLinesForComponent(
  component: ComponentNode,
  layout: ConnectorLayout,
): ConnectorLine[] {
  const lines: ConnectorLine[] = []
  for (const interaction of component.interactions) {
    const targetState = interactionTargetState(interaction)
    if (!targetState || !layout.variants.includes(targetState)) continue
    const target = connectorPointForState(targetState, layout, 'in')
    const source = connectorPointForState(layout.selectedBase, layout, 'out')
    if (!target || !source) continue
    if (targetState === layout.selectedBase) continue
    lines.push({
      fromState: layout.selectedBase,
      toState: targetState,
      event: interaction.event,
      x1: source.x,
      y1: source.y,
      x2: target.x,
      y2: target.y,
    })
  }
  return lines
}

function interactionTargetState(
  interaction: ComponentNode['interactions'][number],
): string | null {
  const action = interaction.actions[0]
  if (!action) return null
  if (action.type === 'setVariant') return action.selection.State ?? null
  if (action.type === 'after' && action.action.type === 'setVariant') {
    return action.action.selection.State ?? null
  }
  return null
}

function connectorPointForState(
  stateName: string,
  layout: ConnectorLayout,
  side: 'in' | 'out',
): SurfacePoint | null {
  const parsed = parseVariantState(stateName)
  const baseIndex = layout.baseVariants.indexOf(parsed.base)
  if (baseIndex < 0) return null
  const position =
    layout.positions[parsed.base] ?? {
      x: baseIndex * (layout.container.width + layout.tileGap),
      y: 0,
    }
  const left = position.x
  const top = position.y
  if (parsed.state === 'Primary') {
    return {
      x: side === 'out' ? left + layout.container.width + 14 : left - 8,
      y: top + layout.tileLabelHeight + layout.container.height / 2,
    }
  }
  const stateIndex = parsed.state === 'Pressed' ? 1 : 0
  return {
    x: side === 'out' ? left + layout.container.width + 14 : left - 8,
    y:
      top +
      layout.interactionSlotTop +
      stateIndex * 48 +
      Math.max(44, layout.interactionSlotHeight / 2 - 12) / 2,
  }
}

function findConnectorTarget(
  point: SurfacePoint,
  layout: ConnectorLayout & { addTileWidth: number },
):
  | { kind: 'variant'; state: string }
  | { kind: 'interaction'; state: 'Hover' | 'Pressed' }
  | null {
  for (const [index, name] of layout.baseVariants.entries()) {
    const position =
      layout.positions[name] ?? {
        x: index * (layout.container.width + layout.tileGap),
        y: 0,
      }
    const left = position.x
    const top = position.y
    if (
      point.x >= left &&
      point.x <= left + layout.container.width &&
      point.y >= top + layout.tileLabelHeight &&
      point.y <= top + layout.tileLabelHeight + layout.container.height
    ) {
      return { kind: 'variant', state: name }
    }
  }
  const selectedIndex = layout.baseVariants.indexOf(layout.selectedBase)
  const selectedPosition =
    layout.positions[layout.selectedBase] ?? {
      x: selectedIndex * (layout.container.width + layout.tileGap),
      y: 0,
    }
  const selectedLeft = selectedPosition.x
  const selectedTop = selectedPosition.y
  if (
    point.x >= selectedLeft &&
    point.x <= selectedLeft + layout.container.width &&
    point.y >= selectedTop + layout.interactionSlotTop &&
    point.y <= selectedTop + layout.interactionSlotTop + layout.interactionSlotHeight
  ) {
    const midpoint =
      selectedTop + layout.interactionSlotTop + layout.interactionSlotHeight / 2
    return { kind: 'interaction', state: point.y < midpoint ? 'Hover' : 'Pressed' }
  }
  return null
}

function connectorEventLabel(event: string): string {
  switch (event) {
    case 'hoverIn':
      return 'Hover'
    case 'hoverOut':
      return 'Leave'
    case 'pointerDown':
      return 'Press'
    case 'pointerUp':
      return 'Release'
    default:
      return 'Click'
  }
}

function numericSize(value: ComponentNode['size']['width'], fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function variantPreviewAnimated(
  component: ComponentNode,
  stateName: string,
): Record<NodeId, AnimatedValue> {
  const variant = component.variantOverrides.find(
    (entry) => entry.match.State === stateName,
  )
  if (!variant) return EMPTY_ANIMATED
  const out: Record<NodeId, AnimatedValue> = {}
  for (const [nodeId, patch] of Object.entries(variant.overrides)) {
    const value: AnimatedValue = {}
    if (patch.transform && typeof patch.transform === 'object') {
      const transform = patch.transform as Record<string, unknown>
      for (const key of [
        'x',
        'y',
        'z',
        'rotation',
        'rotationX',
        'rotationY',
        'scaleX',
        'scaleY',
      ] as const) {
        if (typeof transform[key] === 'number') value[key] = transform[key]
      }
    }
    if (patch.appearance && typeof patch.appearance === 'object') {
      const appearance = patch.appearance as Record<string, unknown>
      if (typeof appearance.opacity === 'number') value.opacity = appearance.opacity
      if (typeof appearance.cornerRadius === 'number') {
        value.cornerRadius = appearance.cornerRadius
      }
    }
    out[nodeId as NodeId] = value
  }
  return out
}

function previewTargetForPatch(
  start: AnimatedValue,
  patch: Record<string, unknown>,
): AnimatedValue {
  const target: AnimatedValue = { ...start }
  if (patch.transform && typeof patch.transform === 'object') {
    const transform = patch.transform as Record<string, unknown>
    for (const key of [
      'x',
      'y',
      'z',
      'rotation',
      'rotationX',
      'rotationY',
      'scaleX',
      'scaleY',
    ] as const) {
      if (typeof transform[key] === 'number') target[key] = transform[key]
    }
  }
  if (patch.appearance && typeof patch.appearance === 'object') {
    const appearance = patch.appearance as Record<string, unknown>
    if (typeof appearance.opacity === 'number') target.opacity = appearance.opacity
    if (typeof appearance.cornerRadius === 'number') {
      target.cornerRadius = appearance.cornerRadius
    }
  }
  return target
}

function interpolatePreviewValue(
  start: AnimatedValue,
  target: AnimatedValue,
  u: number,
): AnimatedValue {
  const out: AnimatedValue = {}
  for (const key of [
    'x',
    'y',
    'z',
    'rotation',
    'rotationX',
    'rotationY',
    'scaleX',
    'scaleY',
    'opacity',
    'cornerRadius',
  ] as const) {
    const a = start[key]
    const b = target[key]
    if (typeof a === 'number' && typeof b === 'number') {
      out[key] = a + (b - a) * u
    }
  }
  return out
}
