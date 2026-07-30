/* V1 — archived. The original fat-cell renderer: one square per crossing,
   cell-scale interlace. Kept for comparison; superseded by V1.2's two-scale
   rendering and V2's draft. */
import { newImg, fillRect, clamp255, mulberry32 } from '../core.js';

export function renderV1(model, opt = {}){
  const { cols, rows } = model.geometry;
  const idx = model.cells.idx, ground = model.cells.ground;
  const rgb = model.palette.map(y => y.rgb);
  const cw = opt.cellW ?? Math.max(2, (opt.targetW ?? 900) / cols);
  const ch = cw * (model.geometry.wefted ?? 0.86);
  const out = newImg(Math.round(cols*cw), Math.round(rows*ch));
  const rnd = mulberry32(opt.seed ?? 11);
  const gl = model.palette[ground].lab;
  const warpC = rgb[ground].map(v => clamp255(v + (gl[0] > 0.5 ? -26 : 26)));
  fillRect(out, 0, 0, out.w, out.h, warpC);
  for (let cy = 0; cy < rows; cy++){
    const rowTone = (rnd()-0.5)*7;
    for (let cx = 0; cx < cols; cx++){
      const v = idx[cy*cols+cx];
      const n = rowTone + (rnd()-0.5)*12;
      const c = rgb[v].map(q => clamp255(q+n));
      const px = cx*cw, py = cy*ch;
      fillRect(out, px-0.4, py, cw+0.8, ch+0.6, c);
      if ((cx+cy)&1){
        const w = c.map((q,i) => q*0.68 + warpC[i]*0.32);
        fillRect(out, px+cw*0.24, py, cw*0.52, ch, w.map(q=>clamp255(q+7)));
        fillRect(out, px+cw*0.24, py+ch*0.72, cw*0.52, ch*0.28, [0,0,0], 0.10);
      } else {
        fillRect(out, px, py+ch*0.16, cw, ch*0.30, [255,255,255], 0.055);
        fillRect(out, px, py+ch*0.78, cw, ch*0.22, [0,0,0], 0.085);
      }
    }
  }
  const d = out.data;
  for (let i = 0; i < d.length; i += 4){
    const n = (rnd()-0.5)*10;
    d[i]=clamp255(d[i]+n); d[i+1]=clamp255(d[i+1]+n); d[i+2]=clamp255(d[i+2]+n);
  }
  return out;
}
