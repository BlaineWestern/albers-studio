/* Layer 2 — yarns. Over-cluster in Oklab, keep the k most mutually distinct
   survivors. Population breaks ties; distinctness picks the team — this is
   what keeps a 6% orange fleck from being eaten by an 81% green ground. */
import { rgbToOklab, mulberry32 } from './core.js';

export function kmeansRaw(img, k, seed = 7){
  const rnd = mulberry32(seed);
  const N = img.w * img.h;
  const stride = Math.max(1, Math.floor(N / 24000));
  const pts = [];
  for (let i = 0; i < N; i += stride){
    const o = i*4;
    pts.push(rgbToOklab(img.data[o], img.data[o+1], img.data[o+2]));
  }
  if (!pts.length) return { cent:[[0,0,0]], pop:[1], n:1 };
  k = Math.max(1, Math.min(k, pts.length));
  const cent = [pts[Math.floor(rnd()*pts.length)].slice()];
  while (cent.length < k){
    const d2 = pts.map(p => Math.min(...cent.map(c =>
      (p[0]-c[0])**2 + (p[1]-c[1])**2 + (p[2]-c[2])**2)));
    const tot = d2.reduce((a,b) => a+b, 0);
    if (tot <= 0) break;
    let r = rnd() * tot, i = 0;
    while (i < d2.length-1 && (r -= d2[i]) > 0) i++;
    cent.push(pts[i].slice());
  }
  while (cent.length < k) cent.push(pts[Math.floor(rnd()*pts.length)].slice());
  const owner = new Int32Array(pts.length);
  for (let it = 0; it < 14; it++){
    let moved = 0;
    for (let i = 0; i < pts.length; i++){
      const p = pts[i]; let best = 0, bd = Infinity;
      for (let c = 0; c < cent.length; c++){
        const q = cent[c];
        const dd = (p[0]-q[0])**2 + (p[1]-q[1])**2 + (p[2]-q[2])**2;
        if (dd < bd){ bd = dd; best = c; }
      }
      if (owner[i] !== best){ owner[i] = best; moved++; }
    }
    const sum = cent.map(() => [0,0,0,0]);
    for (let i = 0; i < pts.length; i++){
      const s = sum[owner[i]], p = pts[i];
      s[0]+=p[0]; s[1]+=p[1]; s[2]+=p[2]; s[3]++;
    }
    for (let c = 0; c < cent.length; c++)
      if (sum[c][3]) cent[c] = [sum[c][0]/sum[c][3], sum[c][1]/sum[c][3], sum[c][2]/sum[c][3]];
    if (!moved) break;
  }
  const pop = cent.map(() => 0);
  for (let i = 0; i < pts.length; i++) pop[owner[i]]++;
  return { cent, pop, n: pts.length };
}

export function quantize(img, k, seed = 7){
  const raw = kmeansRaw(img, Math.max(k*3, 12), seed);
  const cand = raw.cent.map((c,i) => ({ c, share: raw.pop[i]/raw.n }))
                       .filter(x => x.share > 0.0015);
  if (!cand.length) return [[0.5,0,0]];
  cand.sort((a,b) => b.share - a.share);
  const chosen = [cand[0]];
  while (chosen.length < k && chosen.length < cand.length){
    let best = null, bd = -1;
    for (const x of cand){
      if (chosen.includes(x)) continue;
      const d = Math.min(...chosen.map(y =>
        (x.c[0]-y.c[0])**2 + (x.c[1]-y.c[1])**2 + (x.c[2]-y.c[2])**2));
      if (d > bd){ bd = d; best = x; }
    }
    if (!best) break;
    chosen.push(best);
  }
  const cent = chosen.map(x => x.c.slice());
  cent.sort((a,b) => a[0]-b[0]);
  return cent;
}
