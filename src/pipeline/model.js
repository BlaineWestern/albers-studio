/* The model: one layered document, every layer separately inspectable.
   { source -> geometry -> palette -> cells -> structure -> stats }
   Renderers consume the model; they never reach back into the photograph. */
import { quantize } from './palette.js';
import { cellIndices } from './grid.js';
import { yarnRoles, markRuns, floatStats, buildDraft, DEFAULT_ASSIGN } from './structure.js';
import { estimateWeave } from './analyze.js';
import { oklabToRgb } from './core.js';

export function buildModel(flat, params = {}){
  const k = params.k ?? 6;
  const pitch = estimateWeave(flat);
  // The measured pitch can imply a very dense grid (Pasture: 229 threads).
  // That is true of the cloth but hostile to configs, SVG and rendering, so
  // the auto gauge is capped; the honest measured count is kept in geometry.
  const measured = pitch.confX >= 0.04 && pitch.pitchX ? Math.round(flat.w / pitch.pitchX) : 0;
  const cols = params.cols ?? (measured ? Math.max(60, Math.min(180, measured)) : 120);
  const wefted = (pitch.pitchX && pitch.pitchY && pitch.confY >= 0.04)
    ? pitch.pitchY / pitch.pitchX : 0.86;
  const rows = params.rows ?? Math.max(4, Math.round(cols * flat.h / flat.w / wefted));
  const palette = quantize(flat, k, params.seed ?? 7);
  const { idx, ground } = cellIndices(flat, cols, rows, palette, params.markBias ?? 0.30);
  const roles = yarnRoles(idx, palette.length, ground);
  const assign = { ...DEFAULT_ASSIGN, ...(params.assign || {}) };
  const share = new Array(palette.length).fill(0);
  for (const v of idx) share[v]++;
  return {
    version: params.version ?? 'v2',
    geometry: { cols, rows, wefted, pitch, measuredCols: measured },
    palette: palette.map((lab,i) => ({
      lab, rgb: oklabToRgb(...lab), role: roles[i], share: share[i]/idx.length })),
    cells: { idx, ground },
    structure: { assign, runs: markRuns(idx, cols, rows, roles),
                 floats: floatStats(idx, cols, rows, palette.length) },
    draft: () => buildDraft(idx, cols, rows, roles, assign, params.tp ?? 2)
  };
}
