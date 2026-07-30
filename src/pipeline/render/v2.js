/* V2 — draft-based, the robust one. The jacquard principle: colour and
   structure are separate layers, and the render is DERIVED from a binary
   draft at thread resolution — the same object a TC2 loom reads. Where the
   draft says warp-up you see warp; where weft-up you see the cell's yarn.
   Nothing is painted that the draft does not dictate, which means the draft
   itself is exportable, editable, and honest about what could be woven.    */
import { newImg, fillRect, clamp255, mulberry32, nz, oklabToRgb } from '../core.js';

export function renderV2(model, opt = {}){
  const { cols, rows } = model.geometry;
  const idx = model.cells.idx, ground = model.cells.ground;
  const rgb = model.palette.map(y => y.rgb);
  const { draft, W, H, tp } = model.draft ? model.draft() : opt.draft;
  const cw = opt.cellW ?? Math.max(2, (opt.targetW ?? 900) / cols);
  const ch = cw * (model.geometry.wefted ?? 0.86);
  const tw = cw/tp, th = ch/tp;
  const out = newImg(Math.max(1,Math.round(W*tw)), Math.max(1,Math.round(H*th)));
  const seed = opt.seed ?? 11;
  const rnd = mulberry32(seed);
  const depth = opt.depth ?? 'woven';
  const D = depth === 'printed' ? 0 : depth === 'relief' ? 0.45 : 1;

  const gl = model.palette[ground].lab;
  const warpC = oklabToRgb(gl[0] > 0.5 ? gl[0]-0.10 : gl[0]+0.10, gl[1]*0.72, gl[2]*0.72);

  for (let fy = 0; fy < H; fy++){
    const cy = (fy/tp)|0;
    const rowTone = (nz(seed,77,fy)-0.5)*8;
    for (let fx = 0; fx < W; fx++){
      const cx = (fx/tp)|0;
      const v = idx[cy*cols+cx];
      const up = draft[fy*W+fx];               // 1 = warp on top
      const yarn = up ? warpC : rgb[v];
      const n = rowTone + (nz(seed,fx,fy)-0.5)*11;
      let c = [clamp255(yarn[0]+n), clamp255(yarn[1]+n), clamp255(yarn[2]+n)];
      // relief: a thread on top is lit, the one diving under is shadowed —
      // and a weft float (run of 0s) reads as one continuous lit thread
      if (D > 0){
        const upL = fx>0 ? draft[fy*W+fx-1] : up;
        const edge = upL !== up;               // a crossing happens here
        c = c.map(q => clamp255(q + (up ? 5 : 3)*D));
        fillRect(out, fx*tw, fy*th, tw+0.5, th+0.5, c);
        if (edge) fillRect(out, fx*tw, fy*th, Math.max(1,tw*0.3), th+0.5, [0,0,0], 0.10*D);
        // horizontal thread shading: rounded top, shadowed bottom
        fillRect(out, fx*tw, fy*th, tw+0.5, th*0.30, [255,255,255], 0.06*D);
        fillRect(out, fx*tw, fy*th+th*0.74, tw+0.5, th*0.26, [0,0,0], 0.09*D);
      } else {
        fillRect(out, fx*tw, fy*th, tw+0.5, th+0.5, c);
      }
    }
  }

  if (depth !== 'printed'){
    const d = out.data;
    for (let i = 0; i < d.length; i += 4){
      const n = (rnd()-0.5)*9*D;
      d[i]=clamp255(d[i]+n); d[i+1]=clamp255(d[i+1]+n); d[i+2]=clamp255(d[i+2]+n);
    }
  }
  return out;
}

/* The draft itself as an image — black warp-up, white weft-up. This is the
   file a jacquard pipeline would take. */
export function renderDraftImage(model, scale = 2){
  const { draft, W, H } = model.draft();
  const out = newImg(W*scale, H*scale);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
    const v = draft[y*W+x] ? 0 : 255;
    fillRect(out, x*scale, y*scale, scale, scale, [v,v,v]);
  }
  return out;
}
