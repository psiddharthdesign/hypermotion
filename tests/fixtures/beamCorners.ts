import { paintBorderBeam, type BeamShape } from '../../src/render/beam/paintBorderBeam'
import { cornerShapePath, traceQuadraticRoundedRect } from '../../src/render/cornerShape'

export function checkBeamCorners(host: HTMLElement): string[] {
  const errors:string[]=[]
  const shapes:BeamShape[]=[
    {width:400,height:240,radius:80},
    {width:400,height:240,radius:80,cornerSmoothing:.7},
    {width:400,height:240,radius:[100,8,64,0],cornerSmoothing:.6},
    {width:400,height:240,radius:1000},
    {width:400,height:240,radius:80,cornerCurve:'circular'},
  ]
  for (const [index,shape] of shapes.entries()) {
    // Construct the same fill boundary as the layer renderer, independently
    // from Beam's path builder. A bright inner ring must meet that boundary.
    const path=new Path2D()
    if(shape.cornerCurve==='circular')path.roundRect(0,0,400,240,Math.min(shape.radius as number,120))
    else if(shape.cornerSmoothing) {
      const r=shape.radius
      path.addPath(new Path2D(cornerShapePath({width:400,height:240,cornerRadius:typeof r==='number'?r:0,
        cornerRadii:typeof r==='number'?undefined:{tl:r[0],tr:r[1],br:r[2],bl:r[3]},cornerSmoothing:shape.cornerSmoothing})))
    } else traceQuadraticRoundedRect(path,0,0,400,240,shape.radius as number)
    const mask=document.createElement('canvas');mask.width=440;mask.height=280
    const ref=mask.getContext('2d')!;ref.translate(20,20)
    ref.save();ref.clip(path);ref.strokeStyle='#fff';ref.lineWidth=19.2;ref.stroke(path);ref.restore()
    const expected=ref.getImageData(0,0,440,280).data
    const canvas=document.createElement('canvas');canvas.width=440;canvas.height=280
    const ctx=canvas.getContext('2d')!;ctx.translate(20,20)
    paintBorderBeam(ctx,{kind:'border-beam',size:'pulse-inner',colors:['#f00','#f00'],glowSize:0,edgeWidth:6,strength:8,staticColors:true,fadeIn:0},shape,1.2)
    const actual=ctx.getImageData(0,0,440,280).data
    let gaps=0,leaks=0
    for(let i=3;i<actual.length;i+=4) {
      if(expected[i]>240&&actual[i]<100)gaps++
      if(expected[i]===0&&actual[i]>32)leaks++
    }
    if(gaps>8||leaks>8)errors.push(`Corner ${index}: ${gaps} gap pixels, ${leaks} leaked pixels`)
    const figure=document.createElement('figure'),label=document.createElement('figcaption')
    label.textContent=`Aligned corner · ${index+1}`;figure.append(canvas,label);host.append(figure)
    ctx.globalCompositeOperation='destination-over';ctx.fillStyle='#fff';ctx.fill(path);ctx.globalCompositeOperation='source-over'
  }
  return errors
}
