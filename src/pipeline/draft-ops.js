/* Parametric draft operation chain — AdaCAD-like dataflow without AdaCAD code.
   Ops transform a binary lift plan; colour/indexmap stays elsewhere. */
import { mulberry32, clamp01 } from './core.js';
import { STRUCTURES, validateDraft, repairDraft } from './structure.js';
import { generateCaDraft } from './structure-ca.js';

export const DRAFT_OPS = {
  fromStructure: 'Seed draft from a named STRUCTURES lift',
  blockRepeat: 'Tile a region across the draft',
  invertRegion: 'Invert lifts inside a rect',
  cropPad: 'Crop then pad back to size',
  glitch: 'Seeded bit-flip noise (structure glitch)',
  caSeed: 'Elementary CA row growth (filtered by repair)',
  manualOverrides: 'Apply {x,y,v} lift overrides',
  validate: 'Attach validity (no mutation)',
  repair: 'Force interlacement / break floats'
};

function blank(W, H, fill = 0){
  return new Uint8Array(W * H).fill(fill ? 1 : 0);
}

function fromStructure(W, H, name = 'plain'){
  const s = STRUCTURES[name] || STRUCTURES.plain;
  const draft = blank(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
    draft[y*W+x] = s.lift(x, y) ? 1 : 0;
  return draft;
}

function blockRepeat(draft, W, H, opt = {}){
  const bw = Math.max(1, Math.min(W, opt.bw ?? Math.max(2, (W/4)|0)));
  const bh = Math.max(1, Math.min(H, opt.bh ?? Math.max(2, (H/4)|0)));
  const ox = opt.ox ?? 0, oy = opt.oy ?? 0;
  const out = blank(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
    const sx = (ox + (x % bw)) % W;
    const sy = (oy + (y % bh)) % H;
    out[y*W+x] = draft[sy*W+sx];
  }
  return out;
}

function invertRegion(draft, W, H, opt = {}){
  const out = draft.slice();
  const x0 = Math.max(0, opt.x0 ?? 0);
  const y0 = Math.max(0, opt.y0 ?? 0);
  const x1 = Math.min(W, opt.x1 ?? W);
  const y1 = Math.min(H, opt.y1 ?? H);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++)
    out[y*W+x] = out[y*W+x] ? 0 : 1;
  return out;
}

function cropPad(draft, W, H, opt = {}){
  const mx = Math.max(0, Math.min((W/2)|0, opt.marginX ?? 0));
  const my = Math.max(0, Math.min((H/2)|0, opt.marginY ?? 0));
  if (!mx && !my) return draft.slice();
  const cw = W - mx*2, ch = H - my*2;
  if (cw < 1 || ch < 1) return draft.slice();
  const out = blank(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
    const sx = mx + ((x - mx % cw + cw) % cw);
    const sy = my + ((y - my % ch + ch) % ch);
    out[y*W+x] = draft[sy*W+sx];
  }
  return out;
}

function glitch(draft, W, H, opt = {}){
  const density = clamp01(opt.density ?? 0.04);
  const seed = opt.seed ?? 1;
  const rnd = mulberry32(seed ^ 0xD7A11);
  const out = draft.slice();
  for (let i = 0; i < out.length; i++){
    if (rnd() < density) out[i] = out[i] ? 0 : 1;
  }
  return out;
}

function applyOverrides(draft, W, H, overrides = []){
  const out = draft.slice();
  for (const o of overrides){
    const x = o.x|0, y = o.y|0;
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    out[y*W+x] = o.v ? 1 : 0;
  }
  return out;
}

/**
 * Apply an ordered op list to a draft (or seed from structure).
 * @param {object} opts
 * @param {number} opts.W
 * @param {number} opts.H
 * @param {Uint8Array} [opts.draft] starting draft
 * @param {object[]} [opts.ops]
 * @param {number} [opts.seed]
 * @param {number} [opts.maxFloat]
 * @param {boolean} [opts.repair=true]
 */
export function runDraftOps(opts = {}){
  const W = opts.W|0, H = opts.H|0;
  if (W < 1 || H < 1) throw new Error('runDraftOps requires W,H');
  const ops = Array.isArray(opts.ops) ? opts.ops.slice() : [];
  let draft = opts.draft
    ? opts.draft.slice()
    : fromStructure(W, H, opts.structure || 'plain');
  const seed = opts.seed ?? 1;
  const log = [];

  if (!opts.draft && !ops.length)
    ops.push({ op: 'fromStructure', structure: opts.structure || 'plain' });

  for (const step of ops){
    const op = step.op || step.type;
    if (op === 'fromStructure'){
      if (opts.draft && log.length === 0){
        // keep indexmap-derived draft; treat as no-op seed marker
        log.push({ op, skipped: true, reason: 'base-draft-present' });
        continue;
      }
      draft = fromStructure(W, H, step.structure || step.name || 'plain');
      log.push({ op, structure: step.structure || step.name || 'plain' });
    } else if (op === 'blockRepeat'){
      draft = blockRepeat(draft, W, H, step);
      log.push({ op });
    } else if (op === 'invertRegion'){
      draft = invertRegion(draft, W, H, step);
      log.push({ op });
    } else if (op === 'cropPad'){
      draft = cropPad(draft, W, H, step);
      log.push({ op });
    } else if (op === 'glitch'){
      draft = glitch(draft, W, H, { density: step.density, seed: step.seed ?? seed });
      log.push({ op, density: step.density ?? 0.04 });
    } else if (op === 'caSeed'){
      const ca = generateCaDraft({
        W, H,
        rule: step.rule ?? 90,
        structure: step.structure || 'plain',
        seed: step.seed ?? seed,
        steps: step.steps,
        maxFloat: opts.maxFloat
      });
      draft = ca.draft;
      log.push({ op, rule: ca.rule, structure: step.structure || 'plain' });
    } else if (op === 'manualOverrides'){
      draft = applyOverrides(draft, W, H, step.cells || step.overrides || []);
      log.push({ op, n: (step.cells || step.overrides || []).length });
    } else if (op === 'validate'){
      log.push({ op, validity: validateDraft(draft, W, H, opts) });
    } else if (op === 'repair'){
      const r = repairDraft(draft, W, H, opts);
      draft = r.draft;
      log.push({ op, repairs: r.repairs });
    } else {
      throw Object.assign(new Error(`unknown draft op: ${op}`), { status:400 });
    }
  }

  const maxFloat = opts.maxFloat ?? Math.max(8, Math.ceil(Math.max(W, H) * 0.35));
  let repairs = 0;
  let validity = validateDraft(draft, W, H, { maxFloat });
  if (opts.repair !== false && !validity.ok){
    const r = repairDraft(draft, W, H, { maxFloat });
    draft = r.draft;
    repairs = r.repairs;
    validity = r.validity;
    log.push({ op: 'repair', repairs, auto: true });
  }

  return { draft, W, H, ops: log, validity, repairs };
}

/** Default modulator ops from env modulators / explicit glitch density. */
export function defaultModulatorOps(modulators = {}){
  const ops = [];
  const windy = modulators.windy ?? 0;
  const density = modulators.glitch ?? (windy > 0.4 ? 0.02 + windy * 0.05 : 0);
  if (density > 0.001)
    ops.push({ op: 'glitch', density: clamp01(density) });
  return ops;
}
