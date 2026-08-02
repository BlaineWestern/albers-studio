/* Indexmap editing helpers — colour layer only; draft must be rebuilt after. */

/** Reassign all cells inside an inclusive rect to yarn id. */
export function reassignRegion(idx, cols, rows, rect, yarnId){
  const out = idx instanceof Uint8Array ? idx.slice() : Uint8Array.from(idx);
  const x0 = Math.max(0, rect.x0|0), y0 = Math.max(0, rect.y0|0);
  const x1 = Math.min(cols - 1, rect.x1|0), y1 = Math.min(rows - 1, rect.y1|0);
  const v = yarnId|0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++)
    out[y*cols+x] = v;
  return out;
}

/** Replace every occurrence of fromId with toId. */
export function reassignYarn(idx, fromId, toId){
  const out = idx instanceof Uint8Array ? idx.slice() : Uint8Array.from(idx);
  for (let i = 0; i < out.length; i++) if (out[i] === fromId) out[i] = toId;
  return out;
}

/** Paint a disc brush at cell (cx,cy) with radius r (cells). */
export function paintBrush(idx, cols, rows, cx, cy, yarnId, radius = 1){
  const out = idx instanceof Uint8Array ? idx.slice() : Uint8Array.from(idx);
  const r = Math.max(0, radius|0);
  const v = yarnId|0;
  for (let y = cy - r; y <= cy + r; y++){
    if (y < 0 || y >= rows) continue;
    for (let x = cx - r; x <= cx + r; x++){
      if (x < 0 || x >= cols) continue;
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r + 0.25)
        out[y * cols + x] = v;
    }
  }
  return out;
}
