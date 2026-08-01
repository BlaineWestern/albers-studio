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
  plain:      { name:'Plain weave',   period:2, maxFloat:2,  lift:(x,y) => (x+y) & 1 },
  twill:      { name:'2/2 twill',     period:4, maxFloat:2,  lift:(x,y) => ((x+y) % 4) < 2 },
  twill31:    { name:'3/1 twill',     period:4, maxFloat:3,  lift:(x,y) => ((x+y) % 4) < 3 },
  twill12:    { name:'1/2 twill',     period:3, maxFloat:2,  lift:(x,y) => ((x+y) % 3) === 0 },
  basket:     { name:'Basket 2×2',    period:4, maxFloat:2,  lift:(x,y) => ((x>>1)+(y>>1)) & 1 },
  basket4:    { name:'Basket 4×4',    period:8, maxFloat:4,  lift:(x,y) => ((x>>2)+(y>>2)) & 1 },
  weft5:      { name:'Weft float 5',  period:5, maxFloat:5,  lift:(x,y) => (x % 5 === (y*2) % 5) ? 1 : 0 },
  warpFloat4: { name:'Warp float 4', period:4, maxFloat:4,  lift:(x,y) => (y % 4 === (x*2) % 4) ? 1 : 0 },
  satin5:     { name:'5-end satin',   period:5, maxFloat:4,  lift:(x,y) => (x % 5 === (y*2) % 5) ? 1 : 0 },
  satin8:     { name:'8-end satin',   period:8, maxFloat:7,  lift:(x,y) => (x % 8 === (y*3) % 8) ? 1 : 0 },
  /* Open gauze-like approximation — not true leno crossing; documented stub. */
  lenoStub:   { name:'Leno stub',     period:4, maxFloat:3,  lift:(x,y) => {
    const pair = (x >> 1) & 1;
    return ((y + pair) & 1) ? 1 : 0;
  }}
};
export const DEFAULT_ASSIGN = { ground:'plain', field:'twill', supplementary:'weft5' };

export function structureNames(){
  return Object.keys(STRUCTURES);
}

export function shaftHint(name){
  return STRUCTURES[name]?.period ?? 2;
}

function maxFloatForAssign(assign, fallback){
  if (!assign) return fallback;
  let m = 2;
  for (const key of Object.values(assign)){
    const s = STRUCTURES[key];
    if (s?.maxFloat != null) m = Math.max(m, s.maxFloat);
  }
  return Math.max(fallback, m);
}

/* Loom-honesty checks on a binary draft (1 = warp up). */
export function validateDraft(draft, W, H, opt = {}){
  const maxFloat = opt.maxFloat ?? Math.max(8, Math.ceil(Math.max(W, H) * 0.35));
  const issues = [];
  let ups = 0;
  for (let y = 0; y < H; y++){
    let has0 = false, has1 = false, run = 1, prev = draft[y*W];
    for (let x = 0; x < W; x++){
      const v = draft[y*W+x];
      if (v){ has1 = true; ups++; } else has0 = true;
      if (x && v === prev){ run++; if (run > maxFloat) issues.push({ kind:'row-float', y, x, len:run }); }
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
      if (y && v === prev){ run++; if (run > maxFloat) issues.push({ kind:'col-float', x, y, len:run }); }
      else run = 1;
      prev = v;
    }
    if (!has0 || !has1) issues.push({ kind:'col-flat', x });
  }
  const flatIssues = issues.filter(i => i.kind.endsWith('-flat'));
  const floatOver = issues.filter(i => i.kind.endsWith('-float')).length;
  const periods = opt.assign
    ? [...new Set(Object.values(opt.assign).map(shaftHint))]
    : [];
  return {
    ok: flatIssues.length === 0 && floatOver === 0,
    liftRatio: ups / Math.max(1, W*H),
    flatRowsCols: flatIssues.length,
    floatViolations: floatOver,
    maxFloat,
    shaftHint: periods.length ? Math.max(...periods) : null,
    issues: issues.slice(0, 24)
  };
}

/** Force interlacement and break overlong floats. Mutates a copy. */
export function repairDraft(draft, W, H, opt = {}){
  const out = draft instanceof Uint8Array ? draft.slice() : Uint8Array.from(draft);
  const maxFloat = opt.maxFloat ?? Math.max(8, Math.ceil(Math.max(W, H) * 0.35));
  let repairs = 0;

  for (let y = 0; y < H; y++){
    let has0 = false, has1 = false;
    for (let x = 0; x < W; x++){
      const v = out[y*W+x];
      if (v) has1 = true; else has0 = true;
    }
    if (!has0 || !has1){
      const mid = (W/2)|0;
      out[y*W+mid] = has1 ? 0 : 1;
      if (W > 2) out[y*W+((mid+1)%W)] = has1 ? 1 : 0;
      repairs++;
    }
    let run = 1;
    for (let x = 1; x < W; x++){
      if (out[y*W+x] === out[y*W+x-1]){
        run++;
        if (run > maxFloat){
          out[y*W+x] = out[y*W+x] ? 0 : 1;
          run = 1;
          repairs++;
        }
      } else run = 1;
    }
  }

  for (let x = 0; x < W; x++){
    let has0 = false, has1 = false;
    for (let y = 0; y < H; y++){
      const v = out[y*W+x];
      if (v) has1 = true; else has0 = true;
    }
    if (!has0 || !has1){
      const mid = (H/2)|0;
      out[mid*W+x] = has1 ? 0 : 1;
      if (H > 2) out[((mid+1)%H)*W+x] = has1 ? 1 : 0;
      repairs++;
    }
    let run = 1;
    for (let y = 1; y < H; y++){
      if (out[y*W+x] === out[(y-1)*W+x]){
        run++;
        if (run > maxFloat){
          out[y*W+x] = out[y*W+x] ? 0 : 1;
          run = 1;
          repairs++;
        }
      } else run = 1;
    }
  }

  const validity = validateDraft(out, W, H, opt);
  return { draft: out, W, H, repairs, validity };
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

/** V2 product: binary draft at thread resolution. */
export function buildDraft(idx, cols, rows, roles, assign, tp = 2, opt = {}){
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
  const maxFloat = opt.maxFloat ?? Math.max(
    maxFloatForAssign(assign, 8),
    Math.ceil(Math.max(W, H) * 0.35)
  );
  if (opt.repair === false){
    return {
      draft, W, H, tp,
      validity: validateDraft(draft, W, H, { maxFloat, assign })
    };
  }
  const repaired = repairDraft(draft, W, H, { maxFloat, assign });
  return { draft: repaired.draft, W, H, tp, validity: repaired.validity, repairs: repaired.repairs };
}

/**
 * Double-weave: two independent lift plans (face A / face B) from two assigns.
 * Face B defaults to swapped field/ground structures when not provided.
 */
export function buildLayeredDraft(idx, cols, rows, roles, assignA, assignB, tp = 2, opt = {}){
  const a = buildDraft(idx, cols, rows, roles, assignA, tp, opt);
  const bAssign = assignB || {
    ground: assignA.field || 'twill',
    field: assignA.ground || 'plain',
    supplementary: assignA.supplementary || 'weft5'
  };
  const b = buildDraft(idx, cols, rows, roles, bAssign, tp, opt);
  return {
    layers: [
      { assign: { ...assignA }, ...a },
      { assign: { ...bAssign }, ...b }
    ],
    face: opt.face ?? 0,
    W: a.W, H: a.H, tp
  };
}

/** Pick active face from layered draft result. */
export function draftFromLayers(layered, face = 0){
  const i = face ? 1 : 0;
  const L = layered.layers[i] || layered.layers[0];
  return { draft: L.draft, W: L.W, H: L.H, tp: L.tp, validity: L.validity, face: i, assign: L.assign };
}
