/* Cellular-automaton draft seeds — filtered through validate/repair.
   Optional DesignSpec op; not a replacement for named structures. */
import { mulberry32 } from './core.js';
import { STRUCTURES, validateDraft, repairDraft } from './structure.js';

/** Elementary CA next row from previous (Wolfram rule 0–255). */
function caStep(prev, rule){
  const n = prev.length;
  const next = new Uint8Array(n);
  for (let i = 0; i < n; i++){
    const l = prev[(i - 1 + n) % n];
    const c = prev[i];
    const r = prev[(i + 1) % n];
    const idx = (l << 2) | (c << 1) | r;
    next[i] = (rule >> idx) & 1;
  }
  return next;
}

/**
 * Grow a draft from a structure seed via elementary CA rows, then repair.
 * @param {object} opts
 * @param {number} opts.W
 * @param {number} opts.H
 * @param {number} [opts.rule=90]
 * @param {number} [opts.steps] generations after seed row (default H-1)
 * @param {string} [opts.structure='plain'] seed row family
 * @param {number} [opts.seed]
 * @param {number} [opts.maxFloat]
 */
export function generateCaDraft(opts = {}){
  const W = opts.W|0, H = opts.H|0;
  if (W < 2 || H < 2) throw new Error('ca draft needs W,H >= 2');
  const rule = (opts.rule ?? 90) & 255;
  const seed = opts.seed ?? 1;
  const rnd = mulberry32(seed ^ 0xCA11);
  const s = STRUCTURES[opts.structure || 'plain'] || STRUCTURES.plain;

  let row = new Uint8Array(W);
  for (let x = 0; x < W; x++)
    row[x] = s.lift(x, 0) ? 1 : (rnd() < 0.15 ? 1 : 0);

  const draft = new Uint8Array(W * H);
  draft.set(row, 0);
  const steps = opts.steps ?? (H - 1);
  for (let y = 1; y < H; y++){
    if (y <= steps) row = caStep(row, rule);
    else {
      // fall back to structure beyond CA horizon
      row = new Uint8Array(W);
      for (let x = 0; x < W; x++) row[x] = s.lift(x, y) ? 1 : 0;
    }
    draft.set(row, y * W);
  }

  const maxFloat = opts.maxFloat ?? Math.max(8, Math.ceil(Math.max(W, H) * 0.35));
  const repaired = repairDraft(draft, W, H, { maxFloat });
  return {
    draft: repaired.draft,
    W, H,
    rule,
    validity: repaired.validity,
    repairs: repaired.repairs
  };
}

/** Score candidates; return best valid (or least-bad repaired) draft. */
export function searchCaDrafts(opts = {}){
  const rules = opts.rules || [90, 30, 110, 150, 22];
  const structures = opts.structures || ['plain', 'twill', 'basket'];
  let best = null;
  for (const structure of structures){
    for (const rule of rules){
      const cand = generateCaDraft({ ...opts, structure, rule });
      const score = (cand.validity.ok ? 1000 : 0)
        - cand.validity.flatRowsCols * 20
        - cand.validity.floatViolations
        - Math.abs(cand.validity.liftRatio - 0.5) * 100;
      if (!best || score > best.score)
        best = { ...cand, structure, score };
    }
  }
  return best;
}

export { validateDraft };
