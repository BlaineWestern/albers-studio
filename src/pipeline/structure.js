/* Layer 4 — structure. The jacquard insight (TC2 / AdaCAD): colour and weave
   structure are SEPARATE decisions. Each yarn is assigned a role and, in V2,
   an explicit lift structure; the draft is derived, never painted.
   Roles: ground (dominant), field (share >= 15%, weaves as cloth),
   supplementary (rare, floats on top). */

export function yarnRoles(idx, K, ground){
  const tally = new Int32Array(K);
  for (const v of idx) tally[v]++;
  return Array.from({length:K}, (_,i) =>
    i === ground ? 'ground' : (tally[i]/idx.length >= 0.15 ? 'field' : 'supplementary'));
}

/* Weave structures as lift functions: (x,y) -> warp up? Classic drafts. */
export const STRUCTURES = {
  plain:   { name:'Plain weave',  lift:(x,y) => (x+y) & 1 },
  twill:   { name:'2/2 twill',    lift:(x,y) => ((x+y) % 4) < 2 },
  basket:  { name:'Basket 2×2',   lift:(x,y) => ((x>>1)+(y>>1)) & 1 },
  weft5:   { name:'Weft float 5', lift:(x,y) => (x % 5 === (y*2) % 5) ? 1 : 0 },
  satin8:  { name:'8-end satin',  lift:(x,y) => (x % 8 === (y*3) % 8) ? 1 : 0 }
};
export const DEFAULT_ASSIGN = { ground:'plain', field:'twill', supplementary:'weft5' };

/* Loom-honesty checks on a binary draft (1 = warp up). AdaCAD / TexCel-style
   constraints: every row and column must interlace; floats should not run away. */
export function validateDraft(draft, W, H, opt = {}){
  const maxFloat = opt.maxFloat ?? Math.max(8, Math.ceil(Math.max(W, H) * 0.35));
  const issues = [];
  let ups = 0;
  for (let y = 0; y < H; y++){
    let has0 = false, has1 = false, run = 1, prev = draft[y*W];
    for (let x = 0; x < W; x++){
      const v = draft[y*W+x];
      if (v){ has1 = true; ups++; } else has0 = true;
      if (x && v === prev){ run++; if (run > maxFloat) issues.push({ kind:'row-float', y, len:run }); }
      else run = 1;
      prev = v;
    }
    if (!has0 || !has1) issues.push({ kind:'row-flat', y });
  }
  for (let x = 0; x < W; x++){
    let has0 = false, has1 = false, run = 1, prev = draft[x];
    for (let y = 0; y < H; y++){
      const v = draft[y*W+x];
      if (v) has1 = true; else has0 = true;
      if (y && v === prev){ run++; if (run > maxFloat) issues.push({ kind:'col-float', x, len:run }); }
      else run = 1;
      prev = v;
    }
    if (!has0 || !has1) issues.push({ kind:'col-flat', x });
  }
  // collapse repeated float reports
  const flatIssues = issues.filter(i => i.kind.endsWith('-flat'));
  const floatOver = issues.filter(i => i.kind.endsWith('-float')).length;
  return {
    ok: flatIssues.length === 0 && floatOver === 0,
    liftRatio: ups / Math.max(1, W*H),
    flatRowsCols: flatIssues.length,
    floatViolations: floatOver,
    maxFloat,
    issues: issues.slice(0, 24) // cap for provenance payloads
  };
}

/* Runs of supplementary yarn, merged for float drawing and for SVG. */
export function markRuns(idx, cols, rows, roles){
  const at = (x,y) => (x<0||y<0||x>=cols||y>=rows) ? -1 : idx[y*cols+x];
  const isM = v => v >= 0 && roles[v] === 'supplementary';
  const done = new Uint8Array(cols*rows);
  const runs = [];
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++){
    const v = at(x,y);
    if (!isM(v) || done[y*cols+x]) continue;
    let a=x, b=x; while(at(a-1,y)===v)a--; while(at(b+1,y)===v)b++;
    let c=y, d=y; while(at(x,c-1)===v)c--; while(at(x,d+1)===v)d++;
    if (d-c > b-a){ for(let yy=c;yy<=d;yy++) done[yy*cols+x]=1; runs.push({v,x0:x,y0:c,x1:x,y1:d,vert:true}); }
    else { for(let xx=a;xx<=b;xx++) done[y*cols+xx]=1; runs.push({v,x0:a,y0:y,x1:b,y1:y,vert:false}); }
  }
  return runs;
}

export function floatStats(idx, cols, rows, k){
  const runs = Array.from({length:k}, () => ({ n:0, total:0, max:0 }));
  for (let y = 0; y < rows; y++){
    let x = 0;
    while (x < cols){
      const v = idx[y*cols + x];
      let len = 1;
      while (x + len < cols && idx[y*cols + x + len] === v) len++;
      const r = runs[v]; r.n++; r.total += len; if (len > r.max) r.max = len;
      x += len;
    }
  }
  return runs.map(r => ({ mean: r.n ? r.total/r.n : 0, max: r.max, breaks: r.n }));
}

/* V2's product: a binary draft at thread resolution — the thing a jacquard
   loom actually reads. threadsPerCell threads per cell in each direction. */
export function buildDraft(idx, cols, rows, roles, assign, tp = 2){
  const W = cols*tp, H = rows*tp;
  const draft = new Uint8Array(W*H);
  for (let fy = 0; fy < H; fy++){
    const cy = (fy/tp)|0;
    for (let fx = 0; fx < W; fx++){
      const cx = (fx/tp)|0;
      const v = idx[cy*cols+cx];
      const s = STRUCTURES[assign[roles[v]] || 'plain'] || STRUCTURES.plain;
      draft[fy*W+fx] = s.lift(fx, fy) ? 1 : 0;
    }
  }
  return { draft, W, H, tp };
}
