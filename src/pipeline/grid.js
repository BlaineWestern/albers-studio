/* Layer 3 — the indexmap. Which yarn holds each thread crossing. Majority
   vote with a mark handicap: a rare yarn taking >30% of a cell wins it. */
import { rgbToOklab } from './core.js';

export function cellIndices(img, cols, rows, palette, markBias = 0.30){
  const idx = new Uint8Array(cols*rows);
  const cw = img.w / cols, ch = img.h / rows;
  const K = palette.length;
  const cellVotes = [];
  const globalTally = new Int32Array(K);
  for (let cy = 0; cy < rows; cy++){
    for (let cx = 0; cx < cols; cx++){
      const votes = new Int32Array(K);
      const x0 = Math.floor(cx*cw), x1 = Math.max(x0+1, Math.floor((cx+1)*cw));
      const y0 = Math.floor(cy*ch), y1 = Math.max(y0+1, Math.floor((cy+1)*ch));
      const sx = Math.max(1, Math.floor((x1-x0)/4)), sy = Math.max(1, Math.floor((y1-y0)/4));
      let total = 0;
      for (let y = y0; y < y1 && y < img.h; y += sy){
        for (let x = x0; x < x1 && x < img.w; x += sx){
          const o = (y*img.w + x)*4;
          const p = rgbToOklab(img.data[o], img.data[o+1], img.data[o+2]);
          let best = 0, bd = Infinity;
          for (let c = 0; c < K; c++){
            const q = palette[c];
            const dd = (p[0]-q[0])**2 + (p[1]-q[1])**2 + (p[2]-q[2])**2;
            if (dd < bd){ bd = dd; best = c; }
          }
          votes[best]++; total++;
        }
      }
      cellVotes.push({ votes, total });
      for (let c = 0; c < K; c++) globalTally[c] += votes[c];
    }
  }
  let ground = 0;
  for (let c = 1; c < K; c++) if (globalTally[c] > globalTally[ground]) ground = c;
  for (let i = 0; i < cellVotes.length; i++){
    const { votes, total } = cellVotes[i];
    let mark = -1;
    for (let c = 0; c < K; c++)
      if (c !== ground && (mark < 0 || votes[c] > votes[mark])) mark = c;
    if (mark >= 0 && total > 0 && votes[mark] / total >= markBias) idx[i] = mark;
    else { let best = 0; for (let c = 1; c < K; c++) if (votes[c] > votes[best]) best = c; idx[i] = best; }
  }
  return { idx, ground };
}
