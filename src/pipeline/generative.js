/* Generative tapestry — environmental readings + a rug fingerprint → model.
   No photograph. The fingerprint supplies gauge, palette geometry, role mix,
   float behaviour and spatial priors; env knobs tint colour, density, and
   anisotropy so each reading yields a distinct but stylistically related cloth. */
import { mulberry32, nz, oklabToRgb, clamp01 } from './core.js';
import { yarnRoles, markRuns, floatStats, buildDraft, DEFAULT_ASSIGN } from './structure.js';
import { blendFingerprints } from './fingerprint.js';

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
    // map physical units into roughly 0..1 modulators
    warm: clamp01((e.temperature - (-5)) / 40),          // -5..35°C
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
      disorder: 0.28, groundShare: 0.55
    }
  };
}

function valueNoise2(rnd, cols, rows, freq, seed){
  // coarse lattice + bilinear — cheap, headless, deterministic
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
  // light domain warp from seed for less grid-like fields
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++){
    out[y*cols+x] = clamp01(out[y*cols+x]*0.85 + nz(seed, x, y)*0.15);
  }
  return out;
}

function envTintLab(lab, n){
  // temperature → b (yellow/blue); season → a (green/red); light → L
  const L = clamp01(lab[0] + (n.lit - 0.5)*0.18 + (n.warm - 0.5)*0.04);
  const a = lab[1] + (n.season - 0.5)*0.08 + (n.humid - 0.5)*-0.03;
  const b = lab[2] + (n.warm - 0.5)*0.12 + (n.wet - 0.5)*-0.04;
  return [L, a, b];
}

function pickGround(shares, roles){
  const g = roles.findIndex(r => r === 'ground');
  if (g >= 0) return g;
  let best = 0;
  for (let i = 1; i < shares.length; i++) if (shares[i] > shares[best]) best = i;
  return best;
}

/** Paint an indexmap that obeys fingerprint spatial priors + env modulators. */
function generateIndexmap(fp, n, cols, rows, seed){
  const rnd = mulberry32(seed);
  const k = fp.yarns.k;
  const roles = fp.yarns.roles.slice();
  const shares = fp.yarns.shares.slice();
  const ground = pickGround(shares, roles);

  // env reshapes role mix: wet → more marks; windy → more disorder/field breakup
  const markBoost = 1 + n.wet*1.4 + n.humid*0.3;
  const fieldBoost = 1 + n.windy*0.5;
  let adj = shares.map((s,i) => {
    if (roles[i] === 'supplementary') return s * markBoost;
    if (roles[i] === 'field') return s * fieldBoost;
    return s;
  });
  // keep ground dominant enough to read as cloth
  const minGround = Math.max(0.35, (fp.spatial.groundShare || 0.5) * (1 - n.wet*0.25));
  const sumElse = adj.reduce((a,s,i) => a + (i===ground?0:s), 0);
  adj[ground] = Math.max(minGround, 1 - sumElse);
  const tot = adj.reduce((a,b)=>a+b,0) || 1;
  adj = adj.map(s => s/tot);

  // cumulative thresholds for non-ground yarns (noise above ground share)
  const order = [...Array(k).keys()].filter(i => i !== ground)
    .sort((a,b) => adj[b] - adj[a]);
  const nonGroundMass = Math.max(1e-6, 1 - adj[ground]);
  const thresholds = [];
  let acc = 0;
  for (const i of order){
    acc += adj[i] / nonGroundMass;
    thresholds.push({ i, t: acc });
  }

  const freq = 0.04 + n.windy*0.08 + (fp.spatial.disorder || 0.25)*0.1;
  const field = valueNoise2(rnd, cols, rows, freq, seed ^ 0x9e3779b9);
  // anisotropic stretch: wind elongates horizontally; vertShare prior elongates vertically
  const vertBias = (fp.marks.vertShare ?? 0.35) + n.windy*-0.25 + (1 - (fp.spatial.vertCoherence||0.6))*0.2;
  const aniso = valueNoise2(rnd, cols, rows, freq*0.6, seed ^ 0x85ebca6b);

  const idx = new Uint8Array(cols * rows);
  const targetMean = Math.max(1.2, (fp.spatial.meanRun || 3) * (1 + n.humid*0.35));
  const stick = clamp01(1 - 1/targetMean); // probability of continuing a run

  for (let y = 0; y < rows; y++){
    let runV = ground, runLen = 0;
    for (let x = 0; x < cols; x++){
      const o = y*cols + x;
      // blend isotropic + vertical-biased noise
      const vNoise = field[o]*(1 - clamp01(vertBias)) + aniso[o]*clamp01(vertBias);
      // vertical continuity prior
      const above = y > 0 ? idx[(y-1)*cols+x] : -1;
      let chosen = ground;
      if (runLen > 0 && rnd() < stick && runV !== ground){
        chosen = runV;
      } else {
        const t = clamp01(vNoise + (nz(seed, x*3, y)-0.5)*(0.08 + n.windy*0.12));
        // low noise → ground; high noise → field/marks by share
        if (t < adj[ground]) chosen = ground;
        else {
          const u = (t - adj[ground]) / nonGroundMass;
          chosen = order[order.length-1] ?? ground;
          for (const { i, t: th } of thresholds){
            if (u <= th){ chosen = i; break; }
          }
        }
        // encourage vertical coherence for ground/field
        if (above >= 0 && rnd() < (fp.spatial.vertCoherence || 0.6) * (1 - n.windy*0.4)){
          if (roles[above] !== 'supplementary' || roles[chosen] === 'supplementary')
            chosen = above;
        }
      }
      idx[o] = chosen;
      if (chosen === runV) runLen++;
      else { runV = chosen; runLen = 1; }
    }
  }

  // sprinkle / prune supplementary marks to match mark density prior × wetness
  const supp = roles.map((r,i) => r === 'supplementary' ? i : -1).filter(i => i >= 0);
  if (supp.length){
    const targetShare = Math.min(0.35, (fp.yarns.mix.supplementary || 0.1) * markBoost);
    let cur = 0;
    for (const v of idx) if (roles[v] === 'supplementary') cur++;
    const want = Math.round(targetShare * cols * rows);
    let guard = cols * rows * 2;
    while (cur < want && guard-- > 0){
      const x = (rnd()*cols)|0, y = (rnd()*rows)|0;
      const o = y*cols+x;
      if (roles[idx[o]] === 'supplementary') continue;
      // prefer horizontal or vertical runs per vertShare
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

  // enforce ground dominance so the cloth still reads as a weave ground
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

/**
 * Build a generative weave model.
 * @param {object} opts
 * @param {object} [opts.env] environmental readings (see ENV_DEFAULTS)
 * @param {object|object[]} [opts.fingerprint] one fingerprint or list to blend
 * @param {number} [opts.seed]
 * @param {number} [opts.cols] override gauge cols
 * @param {number} [opts.rows] override gauge rows
 */
export function generateFromEnv(opts = {}){
  let fp = opts.fingerprint;
  if (Array.isArray(fp)) fp = fp.length ? blendFingerprints(fp) : defaultFingerprint();
  if (!fp) fp = defaultFingerprint();

  const n = normEnv(opts.env);
  const seed = opts.seed ?? (Math.floor(n.raw.temperature*100) ^ Math.floor(n.raw.humidity*10) ^ 0xA1B2);
  const cols = Math.max(24, Math.min(240, opts.cols ?? fp.gauge.cols ?? 96));
  const wefted = fp.gauge.wefted ?? 0.86;
  const rowsFinal = Math.max(16, Math.min(240,
    opts.rows ?? fp.gauge.rows ?? Math.max(16, Math.round(cols * 0.75))));

  const { idx, ground: paintedGround, roles } = generateIndexmap(fp, n, cols, rowsFinal, seed);
  // if the designated ground was starved (shouldn't happen), fall back to majority
  const tally = new Int32Array(fp.yarns.k);
  for (const v of idx) tally[v]++;
  let ground = paintedGround;
  if (tally[ground] < idx.length * 0.15){
    ground = 0;
    for (let i = 1; i < tally.length; i++) if (tally[i] > tally[ground]) ground = i;
  }

  const palette = fp.yarns.labs.map((lab, i) => {
    const tinted = envTintLab(lab, n);
    const rgb = oklabToRgb(...tinted);
    return { lab: tinted, rgb, role: roles[i] || fp.yarns.roles[i] || 'field', share: 0 };
  });
  // recompute roles/shares from actual cells (env may have shifted mix)
  const liveRoles = yarnRoles(idx, palette.length, ground);
  const share = new Array(palette.length).fill(0);
  for (const v of idx) share[v]++;
  for (let i = 0; i < palette.length; i++){
    palette[i].role = liveRoles[i];
    palette[i].share = share[i] / idx.length;
    // ensure rgb present even if fingerprint lacked it
    if (!palette[i].rgb?.length) palette[i].rgb = oklabToRgb(...palette[i].lab);
  }

  const assign = { ...DEFAULT_ASSIGN, ...(fp.structures || {}) };
  const runs = markRuns(idx, cols, rowsFinal, liveRoles);
  const floats = floatStats(idx, cols, rowsFinal, palette.length);

  return {
    version: 'v2',
    generative: {
      env: n.raw,
      seed,
      style: fp.source?.name || 'default',
      fingerprintSchema: fp.schema
    },
    geometry: {
      cols, rows: rowsFinal, wefted,
      pitch: { pitchX: 0, pitchY: 0, confX: 0, confY: 0 },
      measuredCols: 0
    },
    palette,
    cells: { idx, ground },
    structure: { assign, runs, floats },
    draft: () => buildDraft(idx, cols, rowsFinal, liveRoles, assign, opts.tp ?? 2)
  };
}
