/* Synthetic cloth fixture — always-on substitute for /tmp/fx/pasture.raw.
   Periodic warp/weft at a known pitch so estimateWeave / buildModel exercise
   the real photograph path without an external binary. */
import { newImg } from '../src/pipeline/core.js';

const YARNS = [
  [62, 78, 48],    // ground olive
  [140, 128, 72],  // field straw
  [48, 52, 38],    // dark field
  [196, 92, 54],   // supplementary terracotta
  [220, 200, 150], // supplementary cream
];

/** Build a woven-looking RGBA buffer. pitch ≈ thread period in pixels. */
export function syntheticCloth(opt = {}){
  const pitch = opt.pitch ?? 8;
  const cols = opt.cols ?? 96;
  const rows = opt.rows ?? 72;
  const w = cols * pitch, h = rows * pitch;
  const img = newImg(w, h);
  const d = img.data;
  // low-freq field noise decides yarn; fine checker gives measurable pitch
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const cx = (x / pitch)|0, cy = (y / pitch)|0;
    const cell = hash(cx, cy, opt.seed ?? 17);
    let yarn = 0;
    if (cell > 0.88) yarn = 3 + ((cx + cy) & 1);
    else if (cell > 0.62) yarn = 1 + (cell > 0.75 ? 1 : 0);
    // interlacing: warp shows on even parity of thread coords
    const tx = x % pitch, ty = y % pitch;
    const warpUp = ((tx < pitch/2) ^ (ty < pitch/2)) ? 1 : 0;
    let [r,g,b] = YARNS[yarn];
    if (warpUp){ r = (r*0.82)|0; g = (g*0.82)|0; b = (b*0.82)|0; }
    // thread edge shade for autocorrelation peaks
    if (tx === 0 || ty === 0){ r = (r*0.7)|0; g = (g*0.7)|0; b = (b*0.7)|0; }
    const o = (y*w + x)*4;
    d[o]=r; d[o+1]=g; d[o+2]=b; d[o+3]=255;
  }
  return { img, pitch, cols, rows, yarns: YARNS.length };
}

function hash(x, y, seed){
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1274126177) | 0;
  h = Math.imul(h ^ h >>> 13, 1274126177) | 0;
  return ((h ^ h >>> 16) >>> 0) / 4294967296;
}
