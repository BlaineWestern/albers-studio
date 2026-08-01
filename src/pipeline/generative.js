/* Generative textile design — inputs + style prior → loom-honest model.
   Architecture (see docs/generative-textile-methods.md):
     Inputs → DesignSpec (named params) → indexmap | draft | appearance
   Colour and structure stay separate; drafts use known valid weave families. */
import { mulberry32, nz, oklabToRgb, clamp01 } from './core.js';
import { yarnRoles, markRuns, floatStats, buildDraft, DEFAULT_ASSIGN, STRUCTURES } from './structure.js';
import { blendFingerprints } from './fingerprint.js';
import { runDraftOps, defaultModulatorOps } from './draft-ops.js';

/** Default env schema — all optional; missing keys use mid defaults. */
export const ENV_DEFAULTS = {
  temperature: 18,   // °C
  humidity: 55,      // %
  wind: 3,           // m/s
  precipitation: 0,  // mm (recent)
  light: 0.55,       // 0–1 relative illuminance
  season: 0.5        // 0–1 through year (0=winter, 0.5=summer)
};

function normEnv(env = {}){
  const e = { ...ENV_DEFAULTS, ...env };
  return {
    warm: clamp01((e.temperature - (-5)) / 40),
    humid: clamp01(e.humidity / 100),
    windy: clamp01(e.wind / 20),
    wet: clamp01(e.precipitation / 40),
    lit: clamp01(e.light),
    season: clamp01(e.season),
    raw: e
  };
}

/** Built-in neutral fingerprint when no saved rug is supplied. */
export function defaultFingerprint(){
  return {
    schema: 'albers-studio/fingerprint@1',
    source: { name: 'default', cols: 96, rows: 72 },
    gauge: { cols: 96, rows: 72, wefted: 0.86, aspect: 1.55 },
    yarns: {
      k: 5,
      labs: [
        [0.42, -0.02, 0.04],
        [0.55, -0.04, 0.06],
        [0.68,  0.02, 0.08],
        [0.35,  0.06, 0.02],
        [0.78, -0.01, 0.10]
      ],
      rgb: [],
      roles: ['ground','field','field','supplementary','supplementary'],
      shares: [0.55, 0.20, 0.12, 0.08, 0.05],
      mix: { ground: 0.55, field: 0.32, supplementary: 0.13 }
    },
    structures: { ...DEFAULT_ASSIGN },
    floats: [
      { mean: 4.2, max: 14, breaks: 200 },
      { mean: 3.1, max: 10, breaks: 80 },
      { mean: 2.8, max: 8, breaks: 60 },
      { mean: 2.2, max: 6, breaks: 40 },
      { mean: 1.8, max: 5, breaks: 30 }
    ],
    marks: { count: 40, vertShare: 0.35 },
    spatial: {
      transitionRate: 0.22, vertCoherence: 0.62,
      meanRun: 3.4, p50Run: 2, p90Run: 8,
      disorder: 0.28, groundShare: 0.55,
      roleGrid: null
    }
  };
}

function valueNoise2(rnd, cols, rows, freq, seed){
  const gw = Math.max(2, Math.ceil(cols * freq));
  const gh = Math.max(2, Math.ceil(rows * freq));
  const grid = new Float32Array((gw+1)*(gh+1));
  for (let i = 0; i < grid.length; i++) grid[i] = rnd();
  const out = new Float32Array(cols*rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++){
    const u = (x / Math.max(1, cols-1)) * gw;
    const v = (y / Math.max(1, rows-1)) * gh;
    const x0 = u|0, y0 = v|0;
    const fx = u - x0, fy = v - y0;
    const i00 = y0*(gw+1)+x0, i10 = i00+1, i01 = i00+(gw+1), i11 = i01+1;
    const top = grid[i00] + (grid[i10]-grid[i00])*fx;
    const bot = grid[i01] + (grid[i11]-grid[i01])*fx;
    out[y*cols+x] = top + (bot-top)*fy;
  }
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++)
    out[y*cols+x] = clamp01(out[y*cols+x]*0.85 + nz(seed, x, y)*0.15);
  return out;
}

function envTintLab(lab, n){
  const L = clamp01(lab[0] + (n.lit - 0.5)*0.18 + (n.warm - 0.5)*0.04);
  const a = lab[1] + (n.season - 0.5)*0.08 + (n.humid - 0.5)*-0.03;
  const b = lab[2] + (n.warm - 0.5)*0.12 + (n.wet - 0.5)*-0.04;
  return [L, a, b];
}

function knownStructure(name, fallback){
  return STRUCTURES[name] ? name : fallback;
}

/**
 * Parametric DesignSpec — AdaCAD-like surface between inputs and materialization.
 */
export function resolveDesignSpec(env, fingerprint, opts = {}){
  const n = normEnv(env);
  const fp = fingerprint || defaultFingerprint();
  const seed = opts.seed ?? (Math.floor(n.raw.temperature*100) ^ Math.floor(n.raw.humidity*10) ^ 0xA1B2);
  const cols = Math.max(24, Math.min(240, opts.cols ?? fp.gauge.cols ?? 96));
  const wefted = fp.gauge.wefted ?? 0.86;
  const rows = Math.max(16, Math.min(240,
    opts.rows ?? fp.gauge.rows ?? Math.max(16, Math.round(cols * 0.75))));

  const base = { ...DEFAULT_ASSIGN, ...(fp.structures || {}) };
  const structurePlan = {
    ground: knownStructure(base.ground, 'plain'),
    field: knownStructure(base.field, 'twill'),
    supplementary: knownStructure(base.supplementary, 'weft5')
  };
  if (n.windy > 0.55) structurePlan.field = n.wet > 0.4 ? 'basket' : 'twill';
  else if (n.lit > 0.7 && n.warm > 0.55) structurePlan.field = 'satin8';
  if (n.wet > 0.45) structurePlan.supplementary = 'weft5';
  else if (n.humid < 0.35 && n.windy < 0.3) structurePlan.supplementary = 'satin8';

  const tightness = clamp01(0.92 - n.humid*0.25 - n.wet*0.2);
  const roughness = clamp01(0.12 + n.windy*0.55 + n.wet*0.15);
  const preferredMode = roughness > 0.45 ? 'handloom' : tightness < 0.7 ? 'ribbon' : 'tile';

  const ops = Array.isArray(opts.ops) ? opts.ops.slice()
    : defaultModulatorOps({ windy: n.windy, glitch: opts.glitch });

  return {
    schema: 'albers-studio/design-spec@1',
    seed,
    gauge: { cols, rows, wefted },
    palettePlan: {
      k: fp.yarns.k,
      labs: fp.yarns.labs.map(lab => envTintLab(lab, n)),
      roles: fp.yarns.roles.slice(),
      shares: fp.yarns.shares.slice(),
      mix: { ...fp.yarns.mix }
    },
    structurePlan: { ...structurePlan, ops },
    densityPlan: {
      markBoost: 1 + n.wet*1.4 + n.humid*0.3,
      fieldBoost: 1 + n.windy*0.5,
      disorder: (fp.spatial.disorder || 0.25) + n.windy*0.15,
      vertBias: (fp.marks.vertShare ?? 0.35) + n.windy*-0.25
        + (1 - (fp.spatial.vertCoherence || 0.6))*0.2,
      meanRun: Math.max(1.2, (fp.spatial.meanRun || 3) * (1 + n.humid*0.35)),
      minGround: Math.max(0.35, (fp.spatial.groundShare || 0.5) * (1 - n.wet*0.25)),
      maxFloat: Math.max(6, Math.round(8 + n.wet*6 - n.windy*2)),
      roleGridBias: 0.35
    },
    appearancePlan: { tightness, roughness, mode: preferredMode },
    modulators: n,
    style: {
      name: fp.source?.name || 'default',
      fingerprintSchema: fp.schema || null
    },
    _fingerprint: fp
  };
}

/** Normalize a client-edited DesignSpec (fill defaults, clamp). */
export function normalizeDesignSpec(spec = {}, opts = {}){
  const fp = opts.fingerprint || defaultFingerprint();
  const seed = opts.seed ?? spec.seed ?? 1;
  const cols = Math.max(24, Math.min(240, spec.gauge?.cols ?? fp.gauge.cols ?? 96));
  const rows = Math.max(16, Math.min(240, spec.gauge?.rows ?? fp.gauge.rows ?? 72));
  const wefted = spec.gauge?.wefted ?? fp.gauge.wefted ?? 0.86;
  const roles = (spec.palettePlan?.roles || fp.yarns.roles).slice();
  const labs = (spec.palettePlan?.labs || fp.yarns.labs).map(l => l.slice());
  const shares = (spec.palettePlan?.shares || fp.yarns.shares).slice();
  const sum = shares.reduce((a,b)=>a+b,0) || 1;
  const structurePlan = {
    ground: knownStructure(spec.structurePlan?.ground, 'plain'),
    field: knownStructure(spec.structurePlan?.field, 'twill'),
    supplementary: knownStructure(spec.structurePlan?.supplementary, 'weft5'),
    ops: Array.isArray(spec.structurePlan?.ops) ? spec.structurePlan.ops.slice() : []
  };
  return {
    schema: 'albers-studio/design-spec@1',
    seed,
    gauge: { cols, rows, wefted },
    palettePlan: {
      k: labs.length,
      labs, roles, shares: shares.map(s => s/sum),
      mix: spec.palettePlan?.mix || { ...fp.yarns.mix }
    },
    structurePlan,
    densityPlan: {
      markBoost: spec.densityPlan?.markBoost ?? 1,
      fieldBoost: spec.densityPlan?.fieldBoost ?? 1,
      disorder: spec.densityPlan?.disorder ?? (fp.spatial.disorder || 0.25),
      vertBias: spec.densityPlan?.vertBias ?? 0.35,
      meanRun: spec.densityPlan?.meanRun ?? (fp.spatial.meanRun || 3),
      minGround: spec.densityPlan?.minGround ?? 0.45,
      maxFloat: spec.densityPlan?.maxFloat ?? 8,
      roleGridBias: spec.densityPlan?.roleGridBias ?? 0.35
    },
    appearancePlan: {
      tightness: clamp01(spec.appearancePlan?.tightness ?? 0.88),
      roughness: clamp01(spec.appearancePlan?.roughness ?? 0.25),
      mode: spec.appearancePlan?.mode || 'tile'
    },
    modulators: spec.modulators || normEnv(ENV_DEFAULTS),
    style: spec.style || { name: fp.source?.name || 'default', fingerprintSchema: fp.schema },
    _fingerprint: fp
  };
}

function pickGround(shares, roles){
  const g = roles.findIndex(r => r === 'ground');
  if (g >= 0) return g;
  let best = 0;
  for (let i = 1; i < shares.length; i++) if (shares[i] > shares[best]) best = i;
  return best;
}

function sampleRoleGrid(fp, cols, rows, x, y){
  const g = fp.spatial?.roleGrid;
  if (!g?.w || !g?.h || !g?.data?.length) return -1;
  const gx = Math.min(g.w - 1, Math.max(0, Math.floor(x / cols * g.w)));
  const gy = Math.min(g.h - 1, Math.max(0, Math.floor(y / rows * g.h)));
  return g.data[gy * g.w + gx] ?? -1;
}

/** Macro colour layer — yarn indexmap from DesignSpec density + fingerprint. */
function generateIndexmap(fp, spec, cols, rows){
  const seed = spec.seed;
  const rnd = mulberry32(seed);
  const k = Math.min(fp.yarns.k, spec.palettePlan.labs.length);
  const roles = (spec.palettePlan.roles || fp.yarns.roles).slice(0, k);
  const shares = (spec.palettePlan.shares || fp.yarns.shares).slice(0, k);
  const ground = pickGround(shares, roles);
  const dens = spec.densityPlan;
  const windy = spec.modulators?.windy ?? 0;

  let adj = shares.map((s,i) => {
    if (roles[i] === 'supplementary') return s * dens.markBoost;
    if (roles[i] === 'field') return s * dens.fieldBoost;
    return s;
  });
  const minGround = dens.minGround;
  const sumElse = adj.reduce((a,s,i) => a + (i===ground?0:s), 0);
  adj[ground] = Math.max(minGround, 1 - sumElse);
  const tot = adj.reduce((a,b)=>a+b,0) || 1;
  adj = adj.map(s => s/tot);

  const order = [...Array(k).keys()].filter(i => i !== ground)
    .sort((a,b) => adj[b] - adj[a]);
  const nonGroundMass = Math.max(1e-6, 1 - adj[ground]);
  const thresholds = [];
  let acc = 0;
  for (const i of order){
    acc += adj[i] / nonGroundMass;
    thresholds.push({ i, t: acc });
  }

  const freq = 0.04 + dens.disorder * 0.35;
  const field = valueNoise2(rnd, cols, rows, freq, seed ^ 0x9e3779b9);
  const vertBias = dens.vertBias;
  const aniso = valueNoise2(rnd, cols, rows, freq*0.6, seed ^ 0x85ebca6b);
  const idx = new Uint8Array(cols * rows);
  const stick = clamp01(1 - 1/dens.meanRun);
  const gridBias = clamp01(dens.roleGridBias ?? 0);

  for (let y = 0; y < rows; y++){
    let runV = ground, runLen = 0;
    for (let x = 0; x < cols; x++){
      const o = y*cols + x;
      const vNoise = field[o]*(1 - clamp01(vertBias)) + aniso[o]*clamp01(vertBias);
      const above = y > 0 ? idx[(y-1)*cols+x] : -1;
      let chosen = ground;
      if (runLen > 0 && rnd() < stick && runV !== ground){
        chosen = runV;
      } else {
        const t = clamp01(vNoise + (nz(seed, x*3, y)-0.5)*(0.08 + windy*0.12));
        if (t < adj[ground]) chosen = ground;
        else {
          const u = (t - adj[ground]) / nonGroundMass;
          chosen = order[order.length-1] ?? ground;
          for (const { i, t: th } of thresholds){
            if (u <= th){ chosen = i; break; }
          }
        }
        const gridYarn = sampleRoleGrid(fp, cols, rows, x, y);
        if (gridYarn >= 0 && gridYarn < k && rnd() < gridBias)
          chosen = gridYarn;
        if (above >= 0 && rnd() < (fp.spatial.vertCoherence || 0.6) * (1 - windy*0.4)){
          if (roles[above] !== 'supplementary' || roles[chosen] === 'supplementary')
            chosen = above;
        }
      }
      idx[o] = chosen;
      if (chosen === runV) runLen++;
      else { runV = chosen; runLen = 1; }
    }
  }

  const supp = roles.map((r,i) => r === 'supplementary' ? i : -1).filter(i => i >= 0);
  if (supp.length){
    const targetShare = Math.min(0.35, (fp.yarns.mix.supplementary || 0.1) * dens.markBoost);
    let cur = 0;
    for (const v of idx) if (roles[v] === 'supplementary') cur++;
    const want = Math.round(targetShare * cols * rows);
    let guard = cols * rows * 2;
    while (cur < want && guard-- > 0){
      const x = (rnd()*cols)|0, y = (rnd()*rows)|0;
      const o = y*cols+x;
      if (roles[idx[o]] === 'supplementary') continue;
      const vert = rnd() < (fp.marks.vertShare ?? 0.35);
      const yarn = supp[(rnd()*supp.length)|0];
      const len = Math.max(1, Math.round((fp.spatial.p50Run || 2) * (0.6 + rnd())));
      if (vert){
        for (let dy = 0; dy < len && y+dy < rows; dy++){
          const p = (y+dy)*cols+x;
          if (roles[idx[p]] !== 'supplementary'){ idx[p] = yarn; cur++; }
        }
      } else {
        for (let dx = 0; dx < len && x+dx < cols; dx++){
          const p = y*cols+x+dx;
          if (roles[idx[p]] !== 'supplementary'){ idx[p] = yarn; cur++; }
        }
      }
    }
    while (cur > want * 1.15 && guard-- > 0){
      const o = (rnd()*idx.length)|0;
      if (roles[idx[o]] === 'supplementary'){ idx[o] = ground; cur--; }
    }
  }

  {
    const wantG = Math.round(minGround * cols * rows);
    let g = 0;
    for (const v of idx) if (v === ground) g++;
    let guard = cols * rows;
    while (g < wantG && guard-- > 0){
      const o = (rnd()*idx.length)|0;
      if (idx[o] !== ground && roles[idx[o]] !== 'supplementary'){ idx[o] = ground; g++; }
    }
  }
  return { idx, ground, roles, shares: adj };
}

function publicDesignSpec(spec){
  return {
    schema: spec.schema,
    seed: spec.seed,
    gauge: spec.gauge,
    palettePlan: {
      k: spec.palettePlan.k,
      labs: spec.palettePlan.labs,
      roles: spec.palettePlan.roles,
      shares: spec.palettePlan.shares,
      mix: spec.palettePlan.mix
    },
    structurePlan: {
      ground: spec.structurePlan.ground,
      field: spec.structurePlan.field,
      supplementary: spec.structurePlan.supplementary,
      ops: spec.structurePlan.ops || []
    },
    densityPlan: { ...spec.densityPlan },
    appearancePlan: { ...spec.appearancePlan }
  };
}

/**
 * Materialize a weave model from an explicit DesignSpec (editable dataflow).
 * @param {object} designSpec
 * @param {object} [opts]
 */
export function materializeFromDesignSpec(designSpec, opts = {}){
  const fp = opts.fingerprint || designSpec._fingerprint || defaultFingerprint();
  const spec = normalizeDesignSpec(designSpec, { fingerprint: fp, seed: opts.seed ?? designSpec.seed });
  const { cols, rows: rowsFinal, wefted } = spec.gauge;
  const seed = spec.seed;
  const tp = opts.tp ?? 2;

  const { idx, ground: paintedGround, roles } = generateIndexmap(fp, spec, cols, rowsFinal);
  const tally = new Int32Array(spec.palettePlan.labs.length);
  for (const v of idx) tally[v]++;
  let ground = paintedGround;
  if (tally[ground] < idx.length * 0.15){
    ground = 0;
    for (let i = 1; i < tally.length; i++) if (tally[i] > tally[ground]) ground = i;
  }

  const palette = spec.palettePlan.labs.map((lab, i) => ({
    lab, rgb: oklabToRgb(...lab),
    role: roles[i] || spec.palettePlan.roles[i] || 'field', share: 0
  }));
  const liveRoles = yarnRoles(idx, palette.length, ground);
  const share = new Array(palette.length).fill(0);
  for (const v of idx) share[v]++;
  for (let i = 0; i < palette.length; i++){
    palette[i].role = liveRoles[i];
    palette[i].share = share[i] / idx.length;
  }

  const assign = {
    ground: spec.structurePlan.ground,
    field: spec.structurePlan.field,
    supplementary: spec.structurePlan.supplementary
  };
  const runs = markRuns(idx, cols, rowsFinal, liveRoles);
  const floats = floatStats(idx, cols, rowsFinal, palette.length);
  const maxFloat = (spec.densityPlan.maxFloat || 8) * tp;

  const baseDraft = buildDraft(idx, cols, rowsFinal, liveRoles, assign, tp, {
    maxFloat, repair: true
  });
  const ops = spec.structurePlan.ops || [];
  const modulated = ops.length
    ? runDraftOps({
        draft: baseDraft.draft, W: baseDraft.W, H: baseDraft.H,
        ops, seed, maxFloat, repair: true
      })
    : { draft: baseDraft.draft, W: baseDraft.W, H: baseDraft.H,
        ops: [], validity: baseDraft.validity, repairs: baseDraft.repairs || 0 };

  const validity = modulated.validity;
  const draftCache = { draft: modulated.draft, W: modulated.W, H: modulated.H, tp };
  const pubSpec = publicDesignSpec(spec);

  return {
    version: 'v2',
    generative: {
      schema: 'albers-studio/generative@1',
      env: spec.modulators?.raw || null,
      seed,
      style: spec.style.name,
      fingerprintSchema: spec.style.fingerprintSchema,
      designSpec: pubSpec,
      provenance: {
        created: new Date().toISOString(),
        tool: 'generate',
        inputs: { env: spec.modulators?.raw || null, seed, style: spec.style.name },
        designSpec: pubSpec,
        layers: ['design-spec', 'indexmap', 'draft', 'appearance'],
        draftOps: modulated.ops,
        draftValidity: {
          ok: validity.ok,
          liftRatio: +validity.liftRatio.toFixed(3),
          flatRowsCols: validity.flatRowsCols,
          floatViolations: validity.floatViolations,
          repairs: modulated.repairs || 0
        },
        appearance: spec.appearancePlan
      },
      appearance: spec.appearancePlan
    },
    geometry: {
      cols, rows: rowsFinal, wefted,
      pitch: { pitchX: 0, pitchY: 0, confX: 0, confY: 0 },
      measuredCols: 0
    },
    palette,
    cells: { idx, ground },
    structure: { assign, runs, floats, validity },
    draft: () => ({ ...draftCache, draft: draftCache.draft.slice() })
  };
}

/**
 * Generate a textile design model from inputs + style prior (no photograph).
 */
export function generateFromEnv(opts = {}){
  let fp = opts.fingerprint;
  if (Array.isArray(fp)) fp = fp.length ? blendFingerprints(fp) : defaultFingerprint();
  if (!fp) fp = defaultFingerprint();

  const spec = resolveDesignSpec(opts.env, fp, opts);
  return materializeFromDesignSpec(spec, { fingerprint: fp, seed: spec.seed, tp: opts.tp });
}
