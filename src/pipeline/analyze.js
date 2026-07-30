/* Layer 5 — measurement. Pitch estimation, fidelity, characteristics. */
import { rgbToOklab, labDist } from './core.js';

export function estimateWeave(img){
  const lum = (x,y) => { const o=(y*img.w+x)*4;
    return img.data[o]*0.299 + img.data[o+1]*0.587 + img.data[o+2]*0.114; };
  function axisPitch(along){
    const N = along === 'x' ? img.w : img.h;
    const M = along === 'x' ? img.h : img.w;
    const maxLag = Math.min(72, N >> 2);
    if (maxLag < 3) return { pitch:0, conf:0 };
    const lines = [];
    for (let t = 0.2; t <= 0.8; t += 0.06) lines.push(Math.floor(M * t));
    const scores = new Array(maxLag + 1).fill(0);
    let base = 0;
    for (const l of lines){
      const sig = new Array(N); let mu = 0;
      for (let i = 0; i < N; i++){ sig[i] = along === 'x' ? lum(i,l) : lum(l,i); mu += sig[i]; }
      mu /= N;
      for (let i = 0; i < N; i++) sig[i] -= mu;
      let varSum = 0;
      for (let i = 0; i < N; i++) varSum += sig[i]*sig[i];
      if (varSum < 1e-6) continue;
      base++;
      for (let lag = 2; lag <= maxLag; lag++){
        let s = 0;
        for (let i = 0; i + lag < N; i++) s += sig[i] * sig[i+lag];
        scores[lag] += s / varSum;
      }
    }
    if (!base) return { pitch:0, conf:0 };
    let best = 0, bestScore = -Infinity;
    for (let lag = 3; lag < maxLag; lag++){
      const v = scores[lag] / base;
      if (v > scores[lag-1]/base && v >= scores[lag+1]/base && v > bestScore){
        bestScore = v; best = lag;
        if (v > 0.25) break;
      }
    }
    return { pitch: best, conf: Math.max(0, bestScore) };
  }
  const x = axisPitch('x'), y = axisPitch('y');
  return { repeatX: x.pitch, repeatY: y.pitch,
           pitchX: x.pitch/2, confX: x.conf, pitchY: y.pitch/2, confY: y.conf };
}

export function downsample(img, n){
  const g = new Array(n*n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++){
    const x0 = Math.floor(i*img.w/n), x1 = Math.max(x0+1, Math.floor((i+1)*img.w/n));
    const y0 = Math.floor(j*img.h/n), y1 = Math.max(y0+1, Math.floor((j+1)*img.h/n));
    let r=0, gg=0, b=0, k=0;
    const sx = Math.max(1,(x1-x0)>>2), sy = Math.max(1,(y1-y0)>>2);
    for (let y = y0; y < y1 && y < img.h; y += sy)
      for (let x = x0; x < x1 && x < img.w; x += sx){
        const o = (y*img.w+x)*4; r += img.data[o]; gg += img.data[o+1]; b += img.data[o+2]; k++;
      }
    g[j*n+i] = k ? rgbToOklab(r/k, gg/k, b/k) : [0,0,0];
  }
  return g;
}
export function meanDelta(a, b, n){
  const A = downsample(a,n), B = downsample(b,n);
  let s = 0, mx = 0; const all = [];
  for (let i = 0; i < A.length; i++){ const d = labDist(A[i],B[i]); s += d; all.push(d); if (d>mx) mx=d; }
  all.sort((x,y)=>x-y);
  return { mean: s/A.length, max: mx, p90: all[Math.floor(all.length*0.9)] };
}
export function rowProfile(img, n){
  const g = downsample(img,n), out = [];
  for (let j = 0; j < n; j++){ let s = 0; for (let i = 0; i < n; i++) s += g[j*n+i][0]; out.push(s/n); }
  return out;
}
export function correlation(a, b){
  const n = a.length, ma = a.reduce((x,y)=>x+y,0)/n, mb = b.reduce((x,y)=>x+y,0)/n;
  let num=0, da=0, db=0;
  for (let i = 0; i < n; i++){ const p=a[i]-ma, q=b[i]-mb; num+=p*q; da+=p*p; db+=q*q; }
  return (da && db) ? num/Math.sqrt(da*db) : 1;
}
const stdev = a => { const m=a.reduce((x,y)=>x+y,0)/a.length;
  return Math.sqrt(a.reduce((s,v)=>s+(v-m)*(v-m),0)/a.length); };
export function weaveEnergy(img){
  let s = 0, n = 0;
  for (let y = 0; y < img.h; y += 2) for (let x = 1; x < img.w; x++){
    const a=(y*img.w+x)*4, b=(y*img.w+x-1)*4;
    s += Math.abs(img.data[a]-img.data[b]) + Math.abs(img.data[a+1]-img.data[b+1])
       + Math.abs(img.data[a+2]-img.data[b+2]);
    n++;
  }
  return n ? s/(n*3) : 0;
}
export function fidelity(source, facsimile){
  const d = meanDelta(source, facsimile, 28);
  const sp = rowProfile(source,28), fp = rowProfile(facsimile,28);
  return { ...d, rows: correlation(sp,fp), banding: stdev(sp), energy: weaveEnergy(facsimile) };
}
