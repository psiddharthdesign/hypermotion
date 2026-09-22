import { paintBorderBeam } from '../../src/render/beam/paintBorderBeam'
import { BEAM_STYLES, BEAM_PALETTES } from '../../src/scene/borderBeam'
let time=1
const host=document.querySelector('main')!
const output=document.querySelector('#result')!
function paint(){
 host.replaceChildren()
 const errors:string[]=[]
 for(const size of BEAM_STYLES) for(const fill of ['#ffffff','#202020','#f4c84b']){
  const figure=document.createElement('figure'),label=document.createElement('figcaption'),canvas=document.createElement('canvas')
  canvas.width=640; canvas.height=440
  label.textContent=`${size} · ${fill} · 2400px at 10%`;figure.append(canvas,label);host.append(figure)
  const ctx=canvas.getContext('2d')!;ctx.scale(.2,.2);ctx.translate(400,400)
  ctx.fillStyle=fill;ctx.beginPath();ctx.roundRect(0,0,2400,1200,160);ctx.fill()
  try {paintBorderBeam(ctx,{kind:'border-beam',size,theme:'auto'},{width:2400,height:1200,radius:160,fill},time)}catch(e){errors.push(String(e))}
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
 // A large white frame must have actual color along its edge, including with
 // the user's maximum glow and frozen Ocean palette. Merely nonzero alpha is
 // insufficient: the original renderer passed that check with faint blobs.
 for(const fill of ['#fff','#202020','#f4c84b']) {
  const canvas=document.createElement('canvas');canvas.width=520;canvas.height=280
  const ctx=canvas.getContext('2d')!;ctx.translate(20,20);ctx.scale(.2,.2)
  ctx.fillStyle=fill;ctx.fillRect(0,0,2400,1200)
  paintBorderBeam(ctx,{kind:'border-beam',size:'pulse-inner',colorVariant:'ocean',theme:'auto',glowSize:4,staticColors:true,fadeIn:0},{width:2400,height:1200,radius:0,fill},1.2)
  const pixels=ctx.getImageData(0,0,520,280).data
  let covered=0
  for(let x=25;x<495;x++) {
   const i=(20*520+x)*4
   if(Math.max(pixels[i],pixels[i+1],pixels[i+2])-Math.min(pixels[i],pixels[i+1],pixels[i+2])>35)covered++
  }
  if(covered<350)errors.push(`${fill}: only ${covered}/470 colored edge pixels`)
 }
 // Custom palettes must render as authored and malformed imported CSS must
 // fall back safely rather than aborting a frame. Painting must retain the
 // caller's transform, alpha, and filter for subsequent layers.
 for(const colors of [['#f00','#f00'],['#00f','#00f'],['rgb(1)','#00f']]) {
  const canvas=document.createElement('canvas');canvas.width=240;canvas.height=140
  const ctx=canvas.getContext('2d')!;ctx.globalAlpha=.75;ctx.filter='none'
  const matrix=ctx.getTransform().toString()
  try {
   paintBorderBeam(ctx,{kind:'border-beam',size:'pulse-inner',colors,staticColors:true,fadeIn:0,glowSize:1},{width:240,height:140,radius:0,fill:'#fff'},1.2)
   const data=ctx.getImageData(0,0,240,140).data
   const i=(20*240)*4
   if(colors[0]==='#f00' && !(data[i]>data[i+2]+100))errors.push('Custom red palette lost')
   if(colors[0]==='#00f' && !(data[i+2]>data[i]+100))errors.push('Custom blue palette lost')
   if(ctx.globalAlpha!==.75 || ctx.filter!=='none' || ctx.getTransform().toString()!==matrix)errors.push('Canvas state leaked')
  } catch(e) {errors.push(`Custom palette: ${String(e)}`)}
 }
 output.textContent=errors.length?errors.join('\n'):`PASS: ${cases} combinations render, animate, and reproduce exact pixels after seeking; large-frame contrast, custom colors, and canvas state pass. Time: ${time}s`
}
paint();document.querySelector('#advance')!.addEventListener('click',()=>{time+=.5;paint()})
