import { paintBorderBeam, type BeamShape } from '../../src/render/beam/paintBorderBeam'
import { cornerShapePath, traceCircularRoundedRect, resolveCornerAppearance } from '../../src/render/cornerShape'

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
    } else traceCircularRoundedRect(path,0,0,400,240,shape.radius as number)
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
  // An oversized radius on a square must agree with a separately drawn circle,
  // rather than merely matching the same (possibly wrong) path in Beam.
  for (const size of [120, 400]) {
    const actual = document.createElement('canvas'), expected = document.createElement('canvas')
    actual.width = expected.width = size
    actual.height = expected.height = size
    const ctx = actual.getContext('2d')!, ref = expected.getContext('2d')!
    traceCircularRoundedRect(ctx, 0, 0, size, size, 9999); ctx.fill()
    ref.beginPath(); ref.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); ref.fill()
    const a = ctx.getImageData(0, 0, size, size).data, b = ref.getImageData(0, 0, size, size).data
    let different = 0
    // The browser antialiases arc() and ellipse() through different paths.
    // Compare definite interior/exterior pixels, allowing a one-pixel edge.
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2)
      if (Math.abs(distance - size / 2) <= 1) continue
      const i = (y * size + x) * 4 + 3
      if (Math.abs(a[i] - b[i]) > 32) different++
    }
    if (different > 0) errors.push(`Full radius ${size}: ${different} pixels differ from circle`)
  }
  for (const [width, height] of [[240, 240], [400, 160]]) {
    const shape = resolveCornerAppearance({ cornerRadius: 0, fullRadius: true }, undefined, width, height)
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
    const ctx = canvas.getContext('2d')!
    traceCircularRoundedRect(ctx, 0, 0, width, height, shape.cornerRadius)
    ctx.fillStyle = '#fff'; ctx.fill()
    paintBorderBeam(ctx, { kind: 'border-beam', size: 'pulse-inner', colorVariant: 'ocean', fadeIn: 0 }, { width, height, radius: shape.cornerRadius, fill: '#fff' }, 1)
    const figure = document.createElement('figure'), label = document.createElement('figcaption')
    label.textContent = `Full radius · ${width} × ${height}`; figure.append(canvas, label); host.append(figure)
  }
  return errors
}
