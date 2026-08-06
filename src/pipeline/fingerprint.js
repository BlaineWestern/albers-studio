/* Rug fingerprint — extract a compact style prior from a saved profile
   (or model). Captures gauge, palette geometry, role mix, float behaviour,
   and spatial statistics of the indexmap so a generative pass can follow
   the character of a known tapestry without copying its cells. */
import { rleDecode } from './config.js';
import { DEFAULT_ASSIGN } from './structure.js';

function spatialStats(idx, cols, rows, ground){
  const N = cols * rows;
  let transitions = 0, vertSame = 0, vertPairs = 0;
  const runLens = [];
  for (let y = 0; y < rows; y++){
    let x = 0;
    while (x < cols){
      const v = idx[y*cols + x];
      let len = 1;
      while (x + len < cols && idx[y*cols + x + len] === v) len++;
      runLens.push(len);
      if (x + len < cols) transitions++;
      x += len;
    }
  }
  for (let y = 0; y < rows - 1; y++) for (let x = 0; x < cols; x++){
    vertPairs++;
    if (idx[y*cols+x] === idx[(y+1)*cols+x]) vertSame++;
  }
  runLens.sort((a,b) => a-b);
  const pct = p => runLens[Math.min(runLens.length-1, Math.floor(p*(runLens.length-1)))] || 1;
  const meanRun = runLens.length ? runLens.reduce((a,b)=>a+b,0)/runLens.length : 1;
  // local entropy proxy: how often a cell differs from its 4-neighbours
  let disagree = 0, neigh = 0;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++){
    const v = idx[y*cols+x];
    if (x+1 < cols){ neigh++; if (idx[y*cols+x+1] !== v) disagree++; }
    if (y+1 < rows){ neigh++; if (idx[(y+1)*cols+x] !== v) disagree++; }
  }
  return {
    transitionRate: +(transitions / Math.max(1, rows*(cols-1))).toFixed(4),
    vertCoherence: +(vertSame / Math.max(1, vertPairs)).toFixed(4),
    meanRun: +meanRun.toFixed(2),
    p50Run: pct(0.5),
    p90Run: pct(0.9),
    disorder: +(disagree / Math.max(1, neigh)).toFixed(4),
    groundShare: +(idx.reduce((a,v)=>a+(v===ground?1:0),0) / N).toFixed(4)
  };
}

/** Extract a style fingerprint from a saved config (schema albers-studio/config@1). */
export function fingerprintConfig(cfg){
  const cols = cfg.gauge.cols, rows = cfg.gauge.rows;
  const idx = Array.isArray(cfg.cells) && cfg.cells.length === cols*rows
    ? Uint8Array.from(cfg.cells)
    : rleDecode(cfg.cells, cols * rows);
  const ground = cfg.ground ?? 0;
  const yarns = cfg.yarns || [];
  const roles = { ground:0, field:0, supplementary:0 };
  for (const y of yarns) roles[y.role] = (roles[y.role] || 0) + (y.share || 0);
  const floats = (cfg.characteristics?.floats || []).map(f => ({
    mean: f.mean ?? 0, max: f.max ?? 0, breaks: f.breaks ?? 0
  }));
  const spatial = spatialStats(idx, cols, rows, ground);
  return {
    schema: 'albers-studio/fingerprint@1',
    source: { name: cfg.meta?.name || null, cols, rows },
    gauge: {
      cols, rows,
      wefted: cfg.gauge.wefted ?? 0.86,
      aspect: +(cols / Math.max(1, rows * (cfg.gauge.wefted ?? 0.86))).toFixed(4)
    },
    yarns: {
      k: yarns.length,
      labs: yarns.map(y => y.lab.slice()),
      rgb: yarns.map(y => y.rgb.slice()),
      roles: yarns.map(y => y.role),
      shares: yarns.map(y => y.share ?? 0),
      mix: {
        ground: +roles.ground.toFixed(4),
        field: +roles.field.toFixed(4),
        supplementary: +roles.supplementary.toFixed(4)
      }
    },
    structures: { ...(cfg.structures || DEFAULT_ASSIGN) },
    floats,
    marks: {
      count: cfg.characteristics?.markRuns ?? 0,
      vertShare: cfg.characteristics?.vertMarkShare ?? 0
    },
    spatial
  };
}

/** Fingerprint directly from a live model (same fields as config path). */
export function fingerprintModel(model){
  const { geometry:g, palette, cells, structure } = model;
  return fingerprintConfig({
    meta: { name: 'live-model' },
    gauge: { cols: g.cols, rows: g.rows, wefted: g.wefted },
    yarns: palette.map(y => ({ lab: y.lab, rgb: y.rgb, role: y.role, share: y.share })),
    ground: cells.ground,
    cells: Array.from(cells.idx),
    structures: structure.assign,
    characteristics: {
      floats: structure.floats,
      markRuns: structure.runs?.length ?? 0,
      vertMarkShare: structure.runs?.length
        ? structure.runs.filter(r => r.vert).length / structure.runs.length : 0
    }
  });
}

/** Blend several fingerprints into one style prior (equal weight, or weights[]). */
export function blendFingerprints(fps, weights){
  if (!fps.length) throw new Error('no fingerprints to blend');
  if (fps.length === 1) return structuredClone(fps[0]);
  const w = weights && weights.length === fps.length
    ? weights.slice() : fps.map(() => 1);
  const W = w.reduce((a,b)=>a+b,0);
  const avg = (pick) => fps.reduce((s,f,i) => s + pick(f)*w[i], 0) / W;

  // Use the fingerprint with the median yarn count as the palette scaffold,
  // then average Lab toward the blend so multi-rug styles stay coherent.
  const sorted = fps.slice().sort((a,b) => a.yarns.k - b.yarns.k);
  const base = structuredClone(sorted[Math.floor(sorted.length/2)]);
  const k = base.yarns.k;
  for (let i = 0; i < k; i++){
    const labs = fps.map(f => f.yarns.labs[Math.min(i, f.yarns.k-1)]);
    base.yarns.labs[i] = [0,1,2].map(c =>
      labs.reduce((s,lab,j) => s + lab[c]*w[j], 0) / W);
    base.yarns.shares[i] = avg(f => f.yarns.shares[Math.min(i, f.yarns.k-1)]);
  }
  // renormalize shares
  const sum = base.yarns.shares.reduce((a,b)=>a+b,0) || 1;
  base.yarns.shares = base.yarns.shares.map(s => +(s/sum).toFixed(5));
  base.yarns.mix = {
    ground: +avg(f => f.yarns.mix.ground).toFixed(4),
    field: +avg(f => f.yarns.mix.field).toFixed(4),
    supplementary: +avg(f => f.yarns.mix.supplementary).toFixed(4)
  };
  base.gauge = {
    cols: Math.round(avg(f => f.gauge.cols)),
    rows: Math.round(avg(f => f.gauge.rows)),
    wefted: +avg(f => f.gauge.wefted).toFixed(3),
    aspect: +avg(f => f.gauge.aspect).toFixed(4)
  };
  base.spatial = {
    transitionRate: +avg(f => f.spatial.transitionRate).toFixed(4),
    vertCoherence: +avg(f => f.spatial.vertCoherence).toFixed(4),
    meanRun: +avg(f => f.spatial.meanRun).toFixed(2),
    p50Run: Math.round(avg(f => f.spatial.p50Run)),
    p90Run: Math.round(avg(f => f.spatial.p90Run)),
    disorder: +avg(f => f.spatial.disorder).toFixed(4),
    groundShare: +avg(f => f.spatial.groundShare).toFixed(4)
  };
  base.marks = {
    count: Math.round(avg(f => f.marks.count)),
    vertShare: +avg(f => f.marks.vertShare).toFixed(3)
  };
  if (base.floats?.length){
    base.floats = base.floats.map((_,i) => ({
      mean: +avg(f => (f.floats[Math.min(i, (f.floats.length||1)-1)] || {mean:1}).mean).toFixed(2),
      max: Math.round(avg(f => (f.floats[Math.min(i, (f.floats.length||1)-1)] || {max:1}).max)),
      breaks: Math.round(avg(f => (f.floats[Math.min(i, (f.floats.length||1)-1)] || {breaks:0}).breaks))
    }));
  }
  base.source = { name: 'blend:'+fps.map(f=>f.source?.name||'?').join('+'), ...base.gauge };
  return base;
}
