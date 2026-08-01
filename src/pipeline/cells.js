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
