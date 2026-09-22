import './beamControls'
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
 // Values above the old caps must visibly affect actual pixels. Opacity
 // alone cannot exercise this: Canvas silently ignores globalAlpha > 1.
 const intensityTotals:number[]=[]
 for(const strength of [1,2,8]) {
  const canvas=document.createElement('canvas');canvas.width=240;canvas.height=140
  const ctx=canvas.getContext('2d')!
  paintBorderBeam(ctx,{kind:'border-beam',size:'pulse-inner',strength,fadeIn:0,staticColors:true},{width:240,height:140,radius:16,fill:'#fff'},1.2)
  const data=ctx.getImageData(0,0,240,140).data
  intensityTotals.push(data.reduce((sum,value,i)=>sum+(i%4===3?value:0),0))
 }
 if(!(intensityTotals[0]<intensityTotals[1] && intensityTotals[1]<intensityTotals[2]))errors.push(`Strength gain not increasing: ${intensityTotals}`)
 const wide=document.createElement('canvas');wide.width=640;wide.height=480
 const wc=wide.getContext('2d')!;wc.translate(200,170)
 try {
  paintBorderBeam(wc,{kind:'border-beam',size:'pulse-outside',strength:8,glowSize:12,edgeWidth:8,brightness:6,saturation:8,fadeIn:0},{width:240,height:140,radius:16},1.2)
  if(!wc.getImageData(0,0,640,480).data.some((v,i)=>i%4===3&&v>0))errors.push('Expanded values rendered blank')
 } catch(e) {errors.push(`Expanded values: ${String(e)}`)}
 // All five styles support non-uniform color spans, widths, and glow. A
 // repeat seek must reconstruct the same pattern, including its random seed.
 for(const size of BEAM_STYLES) {
  const canvas=document.createElement('canvas');canvas.width=640;canvas.height=440
  const ctx=canvas.getContext('2d')!;ctx.translate(80,80)
  const effect={kind:'border-beam' as const,size,nonUniform:true,variation:1.5,spread:1,seed:7,fadeIn:0,staticColors:true}
  const shape={width:480,height:240,radius:32,fill:'#fff'}
  const render=(t:number,patch={})=>{ctx.clearRect(-80,-80,640,440);paintBorderBeam(ctx,{...effect,...patch},shape,t);return canvas.toDataURL()}
  const first=render(1.2)
  if(render(2.1)===first)errors.push(`${size}: uneven pattern frozen`)
  if(render(1.2)!==first)errors.push(`${size}: uneven seek mismatch`)
  if(render(1.2,{nonUniform:false})===first)errors.push(`${size}: uneven pattern not applied`)
  if(render(1.2,{seed:8})===first)errors.push(`${size}: pattern seed ignored`)
  if(render(1.2,{variation:0})!==render(1.2,{nonUniform:false}))errors.push(`${size}: zero variation does not restore even distribution`)
  if(render(1.2,{animatePattern:false,glowSize:0})!==render(2.1,{animatePattern:false,glowSize:0}))errors.push(`${size}: fixed highlights moved`)

  const figure=document.createElement('figure'),label=document.createElement('figcaption')
  label.textContent=`Non-uniform · ${size}`;figure.append(canvas,label);host.append(figure)
  ctx.clearRect(-80,-80,640,440);ctx.fillStyle='#fff';ctx.beginPath();ctx.roundRect(0,0,480,240,32);ctx.fill();paintBorderBeam(ctx,effect,shape,time)
 }
 output.textContent=errors.length?errors.join('\n'):`PASS: ${cases} combinations render, animate, and reproduce exact pixels after seeking; large-frame contrast, custom colors, canvas state, intensity above 1, and non-uniform styles pass. Time: ${time}s`
}
paint();document.querySelector('#advance')!.addEventListener('click',()=>{time+=.5;paint()})
