/* The profile: a tapestry captured as configuration. Everything except the
   photograph's pixels — palette, gauge, indexmap (run-length encoded),
   structure assignment, measured characteristics. Enough to re-render,
   compare, and study without the source image. */
export function rleEncode(idx){
  const out = [];
  let i = 0;
  while (i < idx.length){
    const v = idx[i]; let n = 1;
    while (i+n < idx.length && idx[i+n] === v && n < 65535) n++;
    out.push(v, n); i += n;
  }
  return out;
}
export function rleDecode(rle, len){
  const idx = new Uint8Array(len);
  let p = 0;
  for (let i = 0; i < rle.length; i += 2){
    idx.fill(rle[i], p, p + rle[i+1]); p += rle[i+1];
  }
  return idx;
}

export function modelToConfig(model, meta = {}){
  const { geometry:g, palette, cells, structure } = model;
  return {
    schema: 'albers-studio/config@1',
    meta: { name: meta.name || 'untitled', created: new Date().toISOString(), ...meta },
    version: model.version,
    gauge: { cols: g.cols, rows: g.rows, wefted: g.wefted,
             pitchX: g.pitch.pitchX, pitchY: g.pitch.pitchY, pitchConf: +g.pitch.confX.toFixed(3) },
    yarns: palette.map(y => ({ lab: y.lab.map(v=>+v.toFixed(5)), rgb: y.rgb,
                               role: y.role, share: +y.share.toFixed(5) })),
    ground: cells.ground,
    cells: rleEncode(cells.idx),
    structures: structure.assign,
    characteristics: {
      floats: structure.floats.map(f => ({ mean:+f.mean.toFixed(2), max:f.max, breaks:f.breaks })),
      markRuns: structure.runs.length,
      vertMarkShare: +(structure.runs.filter(r=>r.vert).length /
                       Math.max(1, structure.runs.length)).toFixed(3)
    }
  };
}

export function configToModel(cfg){
  const idx = rleDecode(cfg.cells, cfg.gauge.cols * cfg.gauge.rows);
  return {
    version: cfg.version,
    geometry: { cols: cfg.gauge.cols, rows: cfg.gauge.rows, wefted: cfg.gauge.wefted,
      pitch: { pitchX: cfg.gauge.pitchX, pitchY: cfg.gauge.pitchY,
               confX: cfg.gauge.pitchConf ?? 0, confY: cfg.gauge.pitchConf ?? 0 } },
    palette: cfg.yarns.map(y => ({ lab: y.lab, rgb: y.rgb, role: y.role, share: y.share })),
    cells: { idx, ground: cfg.ground },
    structure: { assign: cfg.structures, runs: [], floats: cfg.characteristics.floats }
  };
}
