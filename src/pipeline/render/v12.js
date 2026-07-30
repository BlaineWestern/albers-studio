/* V1.2 — archived, the look the user approved. Two scales: fine plain-weave
   ground (threads far smaller than cells) with supplementary yarns drawn as
   raised floats — highlight above, shadow beneath, dive-under notches. */
import { newImg, fillRect, clamp255, mulberry32, nz, oklabToRgb } from '../core.js';

export function renderV12(model, opt = {}){
  const { cols, rows } = model.geometry;
  const idx = model.cells.idx, ground = model.cells.ground;
  const rgb = model.palette.map(y => y.rgb);
  const roles = model.palette.map(y => y.role);
  const cw = opt.cellW ?? Math.max(2, (opt.targetW ?? 900) / cols);
  const ch = cw * (model.geometry.wefted ?? 0.86);
  const out = newImg(Math.max(1,Math.round(cols*cw)), Math.max(1,Math.round(rows*ch)));
  const rnd = mulberry32(opt.seed ?? 11);
  const seed = opt.seed ?? 11;
  const jitter = 12, lift = 1;

  const gl = model.palette[ground].lab;
  const warpC = oklabToRgb(gl[0] > 0.5 ? gl[0]-0.09 : gl[0]+0.09, gl[1]*0.8, gl[2]*0.8);
  const isMark = v => v >= 0 && roles[v] === 'supplementary';

  const TP = Math.max(2, Math.round(cw/3));
  const tw = cw/TP, th = ch/TP;
  for (let fy = 0; fy < rows*TP; fy++){
    const cy = (fy/TP)|0;
    const rowTone = (nz(seed,77,fy)-0.5)*8;
    for (let fx = 0; fx < cols*TP; fx++){
      const cx = (fx/TP)|0;
      const v = idx[cy*cols+cx];
      const base = isMark(v) ? rgb[ground] : rgb[v];
      const n = rowTone + (nz(seed,fx,fy)-0.5)*jitter;
      let c = [clamp255(base[0]+n), clamp255(base[1]+n), clamp255(base[2]+n)];
      if ((fx+fy)&1){
        const m = 0.42;
        c = [c[0]*(1-m)+warpC[0]*m, c[1]*(1-m)+warpC[1]*m, c[2]*(1-m)+warpC[2]*m]
            .map(q => clamp255(q+6));
      } else c = c.map(q => clamp255(q-4));
      fillRect(out, fx*tw, fy*th, tw+0.6, th+0.6, c);
    }
  }

  for (const r of model.structure.runs){
    const jn = (nz(seed, r.x0*31+r.y0, r.vert?1:2)-0.5)*jitter;
    const c = rgb[r.v].map(q => clamp255(q+jn));
    let px, py, pw, ph;
    if (r.vert){ pw = cw*0.62; px = r.x0*cw+(cw-pw)/2; py = r.y0*ch+ch*0.08; ph = (r.y1-r.y0+1)*ch-ch*0.16; }
    else { ph = ch*0.68; py = r.y0*ch+(ch-ph)/2; px = r.x0*cw+cw*0.08; pw = (r.x1-r.x0+1)*cw-cw*0.16; }
    fillRect(out, px, py, pw, ph, c);
    if (r.vert){
      fillRect(out, px, py, pw*0.34, ph, [255,255,255], 0.13);
      fillRect(out, px+pw*0.66, py, pw*0.34, ph, [0,0,0], 0.16);
      fillRect(out, px+pw, py, Math.max(1,tw*0.5), ph, [0,0,0], 0.12);
      fillRect(out, px, py-th*0.4, pw, th*0.4, [0,0,0], 0.10);
      fillRect(out, px, py+ph, pw, th*0.4, [0,0,0], 0.10);
      for (let yy = py+th; yy < py+ph-th*0.5; yy += th*2)
        fillRect(out, px, yy, pw, Math.max(1,th*0.30), [0,0,0], 0.05);
    } else {
      fillRect(out, px, py, pw, ph*0.34, [255,255,255], 0.13);
      fillRect(out, px, py+ph*0.66, pw, ph*0.34, [0,0,0], 0.16);
      fillRect(out, px, py+ph, pw, Math.max(1,th*0.5), [0,0,0], 0.12);
      fillRect(out, px-tw*0.4, py, tw*0.4, ph, [0,0,0], 0.10);
      fillRect(out, px+pw, py, tw*0.4, ph, [0,0,0], 0.10);
      for (let xx = px+tw; xx < px+pw-tw*0.5; xx += tw*2)
        fillRect(out, xx, py, Math.max(1,tw*0.30), ph, [0,0,0], 0.05);
    }
  }

  const d = out.data;
  for (let i = 0; i < d.length; i += 4){
    const n = (rnd()-0.5)*10;
    d[i]=clamp255(d[i]+n); d[i+1]=clamp255(d[i+1]+n); d[i+2]=clamp255(d[i+2]+n);
  }
  return out;
}
