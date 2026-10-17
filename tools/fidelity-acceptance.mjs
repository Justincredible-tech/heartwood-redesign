// Pure acceptance primitives. The original capture defines every allowance;
// the candidate cannot enlarge its accepted paint region or edge band.
import assert from 'node:assert/strict';

export const FIDELITY_POLICY=Object.freeze({geometryEpsilonCSS:.01,jnd:2.3,treeMaxChannelDelta:90,treeMeanDeltaE:.5,edgeContrast:8,edgeRadiusCSS:2,edgeNeighborhoodDeltaE:2.3});
const within=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
export function imageScale({width,height,cssWidth,cssHeight}){
  assert([width,height,cssWidth,cssHeight].every(v=>Number.isFinite(v)&&v>0),'Positive image and CSS dimensions required');
  const scale={x:width/cssWidth,y:height/cssHeight,area:width*height/(cssWidth*cssHeight)};
  assert(Object.values(scale).every(v=>Number.isFinite(v)&&v>0),'Image scale must be finite and representable');return scale;
}
export function paintRects(bits,width,height,rects,bit,scale,marginCSS=0){
  for(const rect of rects){assert(rect.length===4&&rect.every(Number.isFinite),'Finite CSS rectangle required');
    const [l,t,r,b]=rect;
    const x0=within(Math.floor((l-marginCSS)*scale.x),0,width),x1=within(Math.ceil((r+marginCSS)*scale.x),0,width);
    const y0=within(Math.floor((t-marginCSS)*scale.y),0,height),y1=within(Math.ceil((b+marginCSS)*scale.y),0,height);
    for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)bits[y*width+x]|=bit;
  }
}
function dilate(source,width,height,rx,ry){
  // Separable sliding windows keep high-DPR captures linear in pixel count.
  // A radius beyond the image has the same result at its image boundary;
  // clamp traversal work even when a finite CSS scale produces a huge radius.
  rx=Math.min(width-1,Math.max(0,rx));ry=Math.min(height-1,Math.max(0,ry));
  const horizontal=new Uint8Array(source.length),out=new Uint8Array(source.length);
  for(let y=0;y<height;y++){let n=0;for(let x=0;x<width+rx;x++){if(x<width)n+=source[y*width+x];if(x>2*rx)n-=source[y*width+x-2*rx-1];if(x>=rx)horizontal[y*width+x-rx]=n?1:0;}}
  for(let x=0;x<width;x++){let n=0;for(let y=0;y<height+ry;y++){if(y<height)n+=horizontal[y*width+x];if(y>2*ry)n-=horizontal[(y-2*ry-1)*width+x];if(y>=ry)out[(y-ry)*width+x]=n?1:0;}}
  return out;
}
export function referenceEdges(png,scale,policy=FIDELITY_POLICY){
  const {width,height,data}=png,seeds=new Uint8Array(width*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const p=y*width+x,i=p*4;
    for(const q of [x+1<width?p+1:-1,y+1<height?p+width:-1])if(q>=0){let d=0;for(let c=0;c<3;c++)d=Math.max(d,Math.abs(data[i+c]-data[q*4+c]));if(d>=policy.edgeContrast){seeds[p]=1;seeds[q]=1;}}
  }
  return dilate(seeds,width,height,Math.ceil(policy.edgeRadiusCSS*scale.x),Math.ceil(policy.edgeRadiusCSS*scale.y));
}
// Shared original-only fallback for blur/shadow/grain edges: the existing
// canonical perceptual contrast must occur within the original2 CSS pixels.
export function referenceSoftEdge(original,p,scale,policy=FIDELITY_POLICY,labAt){
 const lab=labAt||((i)=>rgbLab(original.data[i],original.data[i+1],original.data[i+2]));
 const x=p%original.width,y=Math.floor(p/original.width),center=lab(p*4),rx=Math.ceil(policy.edgeRadiusCSS*scale.x),ry=Math.ceil(policy.edgeRadiusCSS*scale.y);
 for(let yy=Math.max(0,y-ry);yy<=Math.min(original.height-1,y+ry);yy++)for(let xx=Math.max(0,x-rx);xx<=Math.min(original.width-1,x+rx);xx++)if(deltaE2000(center,lab((yy*original.width+xx)*4))>=policy.edgeNeighborhoodDeltaE)return true;
 return false;
}
// A small promotion/raster AA allowance never permits a palette change across
// the capture. The canonical original-only edge mask and CSS radius apply;
// every raw pixel outside that band remains exact, as does every alpha byte.
export function compareRasterEdges(original,candidate,{cssWidth,cssHeight,maxChannelDelta=3}={}){
 assert(Number.isFinite(maxChannelDelta)&&maxChannelDelta>=0&&maxChannelDelta<=3,'Raw AA channel ceiling must be finite and no greater than3');
 for(const image of [original,candidate])assert(image&&Number.isSafeInteger(image.width)&&image.width>0&&Number.isSafeInteger(image.height)&&image.height>0&&Number.isSafeInteger(image.width*image.height*4)&&image.data instanceof Uint8Array&&image.data.length===image.width*image.height*4,'Nonempty complete RGBA image required');
 assert.equal(original.width,candidate.width,'Raster widths differ');assert.equal(original.height,candidate.height,'Raster heights differ');
 const scale=imageScale({width:original.width,height:original.height,cssWidth,cssHeight}),edges=referenceEdges(original,scale);
 const row={changedPixels:0,changedAwayFromEdges:0,softEdgePixels:0,changedAlpha:0,maxChannelDelta:0,edgeBandPixels:edges.filter(Boolean).length,protectedPixels:edges.filter(v=>!v).length,scale,allowance:'original-only canonical hard/soft raster edges; exact background/interiors/alpha; RGB max <=3'};
 for(let p=0;p<edges.length;p++){const i=p*4;let delta=0;for(let c=0;c<3;c++)delta=Math.max(delta,Math.abs(original.data[i+c]-candidate.data[i+c]));const alpha=original.data[i+3]!==candidate.data[i+3];
  if(!delta&&!alpha)continue;row.changedPixels++;row.maxChannelDelta=Math.max(row.maxChannelDelta,delta);if(!edges[p]){if(referenceSoftEdge(original,p,scale)){row.softEdgePixels++;row.protectedPixels--;}else row.changedAwayFromEdges++;}if(alpha)row.changedAlpha++;
 }
 row.issues=[];if(row.changedAwayFromEdges)row.issues.push('Raw pixels changed outside original raster edges');if(row.changedAlpha)row.issues.push('Alpha changed');if(row.maxChannelDelta>maxChannelDelta)row.issues.push('Raw RGB delta exceeds the three-level ceiling');if(row.changedPixels&&row.protectedPixels===0)row.issues.push('No independent stable background/interior pixels to bound the raster allowance');
 return {...row,passed:row.issues.length===0};
}

export function artworkMasks({png,cssWidth,cssHeight,leafRects=[],protectedRects=[],treePaint,treeMarginCSS=20,paintDilateCSS=2}){
  const {width,height}=png,scale=imageScale({width,height,cssWidth,cssHeight}),bits=new Uint8Array(width*height);
  paintRects(bits,width,height,leafRects,1,scale,treeMarginCSS);
  paintRects(bits,width,height,protectedRects,4,scale);
  if(treePaint){assert.equal(treePaint.length,bits.length,'Reference tree paint dimensions mismatch');const p=dilate(treePaint,width,height,Math.ceil(paintDilateCSS*scale.x),Math.ceil(paintDilateCSS*scale.y));for(let i=0;i<bits.length;i++)if(p[i])bits[i]|=2;}
  return {bits,edges:referenceEdges(png,scale),scale};
}
const channel=v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;};
export function rgbLab(r,g,b){
  [r,g,b]=[r,g,b].map(channel);const f=v=>v>216/24389?Math.cbrt(v):((24389/27)*v+16)/116;
  const x=f((.4124564*r+.3575761*g+.1804375*b)/.95047),y=f(.2126729*r+.7151522*g+.0721750*b),z=f((.0193339*r+.1191920*g+.9503041*b)/1.08883);
  return [116*y-16,500*(x-y),200*(y-z)];
}
export function deltaE2000([l1,a1,b1],[l2,a2,b2]){
  const rad=Math.PI/180,deg=180/Math.PI,c1=Math.hypot(a1,b1),c2=Math.hypot(a2,b2),cb=(c1+c2)/2,g=.5*(1-Math.sqrt(cb**7/(cb**7+25**7)));
  const ap1=(1+g)*a1,ap2=(1+g)*a2,cp1=Math.hypot(ap1,b1),cp2=Math.hypot(ap2,b2);
  const hue=(a,b)=>(Math.atan2(b,a)*deg+360)%360,h1=cp1?hue(ap1,b1):0,h2=cp2?hue(ap2,b2):0,dh=h2-h1;
  const dl=l2-l1,dc=cp2-cp1,dhp=cp1*cp2===0?0:Math.abs(dh)<=180?dh:dh>180?dh-360:dh+360,dH=2*Math.sqrt(cp1*cp2)*Math.sin(dhp*rad/2);
  const lb=(l1+l2)/2,cp=(cp1+cp2)/2,hb=cp1*cp2===0?h1+h2:Math.abs(dh)<=180?(h1+h2)/2:h1+h2<360?(h1+h2+360)/2:(h1+h2-360)/2;
  const t=1-.17*Math.cos((hb-30)*rad)+.24*Math.cos(2*hb*rad)+.32*Math.cos((3*hb+6)*rad)-.2*Math.cos((4*hb-63)*rad);
  const sl=1+.015*(lb-50)**2/Math.sqrt(20+(lb-50)**2),sc=1+.045*cp,sh=1+.015*cp*t,rt=-2*Math.sqrt(cp**7/(cp**7+25**7))*Math.sin(60*Math.exp(-(((hb-275)/25)**2))*rad);
  return Math.sqrt((dl/sl)**2+(dc/sc)**2+(dH/sh)**2+rt*(dc/sc)*(dH/sh));
}
export function compareFidelity(original,candidate,diff,masks,policy=FIDELITY_POLICY){
  assert.equal(original.width,candidate.width);assert.equal(original.height,candidate.height);assert.equal(diff.length,original.data.length);assert.equal(masks.bits.length,original.width*original.height);
  const result={pixels:0,pixelsInside:0,pixelsOutside:0,pixelsProtected:0,paintOnlyDiffs:0,pixelsAwayFromEdges:0,rawPixels:0,maxChannelDelta:0,maxDeltaInside:0,maxDeltaOutside:0,jndOutside:0,jndProtected:0,jndTreeAwayFromEdges:0,maxDeltaE:0,meanTreeDeltaE:0,zoneFraction:0,protectedFraction:0};
  const cache=new Map(),lab=(data,i)=>{const k=data[i]*65536+data[i+1]*256+data[i+2];let v=cache.get(k);if(!v){v=rgbLab(data[i],data[i+1],data[i+2]);cache.set(k,v);}return v;};let treeCount=0,protectedCount=0,treeDeltaSum=0;
  const softReferenceEdge=p=>referenceSoftEdge(original,p,masks.scale,policy,i=>lab(original.data,i));
  for(let p=0;p<masks.bits.length;p++){const i=p*4,bit=masks.bits[p],tree=bit&3,protectedUI=bit&4;let edge=masks.edges[p];if(tree)treeCount++;if(protectedUI)protectedCount++;
    const flagged=diff[i]===255&&diff[i+1]===0&&diff[i+2]===0;
    let d=0;for(let c=0;c<4;c++)d=Math.max(d,Math.abs(original.data[i+c]-candidate.data[i+c]));if(!d)continue;
    result.rawPixels++;result.maxChannelDelta=Math.max(result.maxChannelDelta,d);if(tree)result.maxDeltaInside=Math.max(result.maxDeltaInside,d);else result.maxDeltaOutside=Math.max(result.maxDeltaOutside,d);
    const de=deltaE2000(lab(original.data,i),lab(candidate.data,i));result.maxDeltaE=Math.max(result.maxDeltaE,de);if(tree)treeDeltaSum+=de;
    if(tree&&!edge&&(flagged||de>policy.jnd))edge=softReferenceEdge(p);
    if(flagged){result.pixels++;if(tree)result.pixelsInside++;else result.pixelsOutside++;if(protectedUI)result.pixelsProtected++;if(tree&&!edge)result.pixelsAwayFromEdges++;if((bit&2)&&!(bit&1))result.paintOnlyDiffs++;}
    if(de>policy.jnd){if(!tree)result.jndOutside++;if(protectedUI)result.jndProtected++;if(tree&&!edge)result.jndTreeAwayFromEdges++;}
  }
  result.meanTreeDeltaE=treeCount?treeDeltaSum/treeCount:0;result.zoneFraction=treeCount/masks.bits.length;result.protectedFraction=protectedCount/masks.bits.length;
  result.pixelsInsideCSS=result.pixelsInside/masks.scale.area;
  return result;
}
export function assertFidelity(row,{ceilingCSSPixels,strictZero=false,policy=FIDELITY_POLICY}={}){
  assert(Number.isFinite(ceilingCSSPixels)&&ceilingCSSPixels>=0,'Finite normalized tree ceiling required');
  if(strictZero){assert.equal(row.pixels,0,'Strict reference control differs');assert(row.maxDeltaE<=policy.jnd,'Reference control has perceptible color drift');return;}
  assert.equal(row.pixelsOutside,0,'Threshold differences outside original tree');assert.equal(row.pixelsProtected,0,'Threshold differences in protected UI');
  assert.equal(row.jndOutside,0,'Perceptible color difference outside original tree');assert.equal(row.jndProtected,0,'Perceptible color difference in protected UI');
  assert.equal(row.pixelsAwayFromEdges,0,'Threshold tree differences away from original raster edges');assert.equal(row.jndTreeAwayFromEdges,0,'Perceptible tree color difference away from original raster edges');
  assert(row.pixelsInsideCSS<=ceilingCSSPixels,'Original tree raster differences exceed finite normalized ceiling');
  assert(row.maxDeltaInside<=policy.treeMaxChannelDelta,'Original tree channel delta exceeds accepted raster limit');
  assert(row.meanTreeDeltaE<=policy.treeMeanDeltaE,'Broad tree palette drift exceeds mean perceptual limit');
}
export function assertHoverCoverage(row,{seconds,cpuRate=1}={}){
  assert.equal(row.errors.length,0,'Hover profiler recorded page errors');
  const f=row.frames;assert(f&&f.count>=Math.max(10,seconds*20),'Insufficient hover frame samples');
  assert(row.elapsedMs>=seconds*1000*.9,'Insufficient hover sampling duration');
  assert(Number.isFinite(f.sampleSpanMs)&&f.sampleSpanMs>=row.elapsedMs-50&&f.includesStartAndEndGaps===true,'Hover samples omit the sampling boundaries or span');
  assert(row.moves>=Math.max(10,seconds*10)&&row.hoverEvents>=Math.max(5,seconds*5)&&row.uniqueLeaves>=10,'Insufficient successful canopy sweep coverage');
  if(cpuRate===1){assert.equal(f.over50ms,0,'Hover frame exceeds50ms');assert(f.p95<25,'Hover frame p95 exceeds25ms');}
}

// Compare raw rectangles at the existing0.01 CSS-pixel measurement precision.
// Rounding first can turn a15-micro-pixel difference at a half-cent boundary
// into different displayed hundredths. This does not change pixel/JND limits.
export function compareGeometry(original,candidate,epsilonCSS=FIDELITY_POLICY.geometryEpsilonCSS){
  assert(Number.isFinite(epsilonCSS)&&epsilonCSS>=0,'Finite geometry precision required');
  assert(Array.isArray(original)&&Array.isArray(candidate)&&original.length>0,'Nonempty geometry observations required');
  for(const row of [...original,...candidate])assert(Array.isArray(row)&&row.length===4&&row.every(Number.isFinite),'Finite four-coordinate rectangles required');
  const differences=[];let maxDeltaCSS=0;
  for(let index=0;index<Math.max(original.length,candidate.length);index++){
    const a=original[index],b=candidate[index];if(!a||!b){differences.push({index,original:a||null,optimized:b||null,reason:'rectangle count differs'});continue;}
    const delta=a.map((n,i)=>b[i]-n),max=Math.max(...delta.map(Math.abs));maxDeltaCSS=Math.max(maxDeltaCSS,max);
    if(max>epsilonCSS)differences.push({index,original:a,optimized:b,delta,maxDeltaCSS:max});
  }
  return {equal:differences.length===0,maxDeltaCSS,epsilonCSS,differences};
}
