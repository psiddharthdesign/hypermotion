import { paintBorderBeam } from '../../src/render/beam/paintBorderBeam'
import { BEAM_STYLES, BEAM_PALETTES } from '../../src/scene/borderBeam'
let time=1
const host=document.querySelector('main')!
const output=document.querySelector('#result')!
function paint(){
 host.replaceChildren()
 const errors:string[]=[]
 for(const size of BEAM_STYLES) for(const theme of ['dark','light'] as const){
  const figure=document.createElement('figure'),label=document.createElement('figcaption'),canvas=document.createElement('canvas')
  canvas.width=640; canvas.height=440
  label.textContent=`${size} · ${theme}`;figure.append(canvas,label);host.append(figure)
  const ctx=canvas.getContext('2d')!;ctx.scale(2,2);ctx.translate(40,40)
  ctx.fillStyle=theme==='dark'?'#222228':'#eeeeee';ctx.beginPath();ctx.roundRect(0,0,240,140,16);ctx.fill()
  try {paintBorderBeam(ctx,{kind:'border-beam',size,theme},{width:240,height:140,radius:16},time)}catch(e){errors.push(String(e))}
 }
 let cases=0
 for(const size of BEAM_STYLES) for(const colorVariant of BEAM_PALETTES) for(const theme of ['dark','light'] as const){
  const canvas=document.createElement('canvas');canvas.width=400;canvas.height=300;const ctx=canvas.getContext('2d')!
  const effect={kind:'border-beam' as const,size,colorVariant,theme,fadeIn:0}
  ctx.translate(80,80)
  try {
   paintBorderBeam(ctx,effect,{width:240,height:140,radius:[4,16,32,8]},1.25)
   const a=canvas.toDataURL()
   const pixels=ctx.getImageData(0,0,400,300).data
   if(!pixels.some((v,i)=>i%4===3&&v>0)) errors.push(`${size}/${colorVariant}/${theme}: empty`)
   ctx.clearRect(-80,-80,400,300);paintBorderBeam(ctx,effect,{width:240,height:140,radius:[4,16,32,8]},2.75)
   if(canvas.toDataURL()===a)errors.push(`${size}: frozen`)
   ctx.clearRect(-80,-80,400,300);paintBorderBeam(ctx,effect,{width:240,height:140,radius:[4,16,32,8]},1.25)
   if(canvas.toDataURL()!==a)errors.push(`${size}: seek mismatch`)
   cases++
  }catch(e){errors.push(String(e))}
 }
 output.textContent=errors.length?errors.join('\n'):`PASS: ${cases} combinations render, animate, and reproduce exact pixels after seeking. Time: ${time}s`
}
paint();document.querySelector('#advance')!.addEventListener('click',()=>{time+=.5;paint()})
