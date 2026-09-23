import { useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BorderBeamFields } from '../../src/ui/BorderBeamFields'
import { normalizeBorderBeam, type BorderBeamEffect } from '../../src/scene/borderBeam'
import { paintBorderBeam } from '../../src/render/beam/paintBorderBeam'

export function BeamControlsCheck() {
  const [effect, setEffect] = useState<BorderBeamEffect>({ kind: 'border-beam', size: 'pulse-inner', theme: 'auto', brightness: 1, saturation: 1, fadeIn: 0 })
  const canvas = useRef<HTMLCanvasElement>(null)
  useLayoutEffect(() => {
    const ctx = canvas.current!.getContext('2d')!
    ctx.clearRect(0,0,640,440)
    ctx.save();ctx.translate(80,80)
    ctx.fillStyle='#fff';ctx.fillRect(0,0,480,240)
    paintBorderBeam(ctx,effect,{width:480,height:240,radius:0,fill:'#fff'},1.2)
    ctx.restore()
  },[effect])
  return <section style={{maxWidth:400,marginTop:32}}>
    <h2>Editable Beam controls</h2>
    <canvas ref={canvas} width={640} height={440}/>
    <BorderBeamFields effect={effect} onChange={patch=>setEffect(current=>normalizeBorderBeam({...current,...patch}))}/>
    <output aria-label="Authored Beam values">{JSON.stringify(effect)}</output>
  </section>
}
const host=document.createElement('div')
document.body.append(host)
createRoot(host).render(<BeamControlsCheck/> )
