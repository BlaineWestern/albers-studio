/* Weave aesthetics — draft-driven warp/weft representation.
   Methods distilled from fabric-rendering literature, adapted to our
   headless raster pipeline (no neural nets, no GPU meshes):

   flat     printed colour — no interlacing relief
   tile     binary draft tiles + edge shade (classic V2)
   ribbon   elliptical yarn bodies + inter-yarn gaps (surface yarn mapping)
   cord     radial cylinder shading across the thread (cross-section model)
   handloom ribbon/cord + yarn sliding, thickness jitter, tension noise
            (FabricGen-style irregularity for handwoven character)

   Shared knobs:
     tightness  0..1  packed ↔ open (space between warp and weft)
     roughness  0..1  machine-regular ↔ handloom irregular
*/
import { newImg, fillRect, clamp255, clamp01, mulberry32, nz, oklabToRgb } from '../core.js';

export const WEAVE_MODES = {
  flat:     { label: 'Flat',     note: 'printed colour — no thread relief' },
  tile:     { label: 'Tile',     note: 'draft tiles + crossing shade (loom-honest)' },
  ribbon:   { label: 'Ribbon',   note: 'elliptical yarns with gaps between threads' },
  cord:     { label: 'Cord',     note: 'cylindrical thread shading' },
  handloom: { label: 'Handloom', note: 'yarn slide + thickness jitter + tension noise' }
};

export const WEAVE_DEFAULTS = {
  mode: 'tile',
  tightness: 1,      // packed by default (classic V2); loosen to open gaps
  roughness: 0.35,   // used strongly by handloom; mild elsewhere
  seed: 11,
  gapRgb: [28, 26, 23]  // void between yarns when loosened
};

function warpColour(model){
  const gl = model.palette[model.cells.ground].lab;
  return oklabToRgb(gl[0] > 0.5 ? gl[0]-0.10 : gl[0]+0.10, gl[1]*0.72, gl[2]*0.72);
}

/* Smooth 1D value noise along an axis — yarn sliding / thickness. */
function slide1(seed, axis, i){
  const i0 = i|0, f = i - i0;
  const a = nz(seed, axis, i0), b = nz(seed, axis, i0 + 1);
  const u = f*f*(3 - 2*f);
  return a + (b - a)*u;
}

function yarnFill(tightness, rough, seed, id){
  // base fill from tightness; roughness jitters per-thread thickness
  const jitter = rough > 0 ? (nz(seed ^ 0x51, id, 3) - 0.5) * rough * 0.35 : 0;
  return clamp01(tightness + jitter);
}

/**
 * Draft-derived weave render with aesthetic modes.
 * @param {object} model
 * @param {object} [opt]
 * @param {string} [opt.mode] flat|tile|ribbon|cord|handloom
 * @param {number} [opt.tightness] 0..1
 * @param {number} [opt.roughness] 0..1
 */
export function renderWeave(model, opt = {}){
  const mode = opt.mode ?? WEAVE_DEFAULTS.mode;
  if (mode === 'flat') return renderFlat(model, opt);
  if (mode === 'tile') return renderTile(model, opt);
  // ribbon / cord / handloom share the gap+body painter
  return renderYarnBodies(model, { ...opt, mode });
}

/* ── Flat: colour map only ── */
function renderFlat(model, opt){
  const { cols, rows } = model.geometry;
  const idx = model.cells.idx;
  const rgb = model.palette.map(y => y.rgb);
  const cw = opt.cellW ?? Math.max(2, (opt.targetW ?? 900) / cols);
  const ch = cw * (model.geometry.wefted ?? 0.86);
  const out = newImg(Math.max(1, Math.round(cols*cw)), Math.max(1, Math.round(rows*ch)));
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++)
    fillRect(out, x*cw, y*ch, cw+0.5, ch+0.5, rgb[idx[y*cols+x]]);
  return out;
}

/* ── Tile: classic V2 block threads ── */
function renderTile(model, opt){
  const { cols, rows } = model.geometry;
  const idx = model.cells.idx, ground = model.cells.ground;
  const rgb = model.palette.map(y => y.rgb);
  const { draft, W, H, tp } = model.draft ? model.draft() : opt.draft;
  const cw = opt.cellW ?? Math.max(2, (opt.targetW ?? 900) / cols);
  const ch = cw * (model.geometry.wefted ?? 0.86);
  const tw = cw/tp, th = ch/tp;
  const out = newImg(Math.max(1,Math.round(W*tw)), Math.max(1,Math.round(H*th)));
  const seed = opt.seed ?? WEAVE_DEFAULTS.seed;
  const rnd = mulberry32(seed);
  const tight = clamp01(opt.tightness ?? WEAVE_DEFAULTS.tightness);
  const rough = clamp01(opt.roughness ?? 0);
  const gap = opt.gapRgb ?? WEAVE_DEFAULTS.gapRgb;
  const warpC = warpColour(model);
  const fill = Math.max(0.35, tight); // tile keeps more coverage
  const padX = tw * (1 - fill) * 0.5;
  const padY = th * (1 - fill) * 0.5;

  // gap underlay when loosened
  if (fill < 0.97) fillRect(out, 0, 0, out.w, out.h, gap);

  for (let fy = 0; fy < H; fy++){
    const cy = (fy/tp)|0;
    const rowTone = (nz(seed,77,fy)-0.5)*8*(1 + rough);
    for (let fx = 0; fx < W; fx++){
      const cx = (fx/tp)|0;
      const v = idx[cy*cols+cx];
      const up = draft[fy*W+fx];
      const yarn = up ? warpC : rgb[v];
      const n = rowTone + (nz(seed,fx,fy)-0.5)*11*(1 + rough*0.5);
      let c = [clamp255(yarn[0]+n), clamp255(yarn[1]+n), clamp255(yarn[2]+n)];
      const upL = fx>0 ? draft[fy*W+fx-1] : up;
      const edge = upL !== up;
      c = c.map(q => clamp255(q + (up ? 5 : 3)));
      const ox = rough > 0 ? (slide1(seed, 1, fx) - 0.5) * rough * tw * 0.25 : 0;
      const oy = rough > 0 ? (slide1(seed, 2, fy) - 0.5) * rough * th * 0.25 : 0;
      fillRect(out, fx*tw + padX + ox, fy*th + padY + oy, tw - padX*2 + 0.5, th - padY*2 + 0.5, c);
      if (edge) fillRect(out, fx*tw + padX + ox, fy*th + padY + oy, Math.max(1,(tw-padX*2)*0.3), th-padY*2+0.5, [0,0,0], 0.10);
      fillRect(out, fx*tw + padX + ox, fy*th + padY + oy, tw-padX*2+0.5, (th-padY*2)*0.30, [255,255,255], 0.06);
      fillRect(out, fx*tw + padX + ox, fy*th + padY + oy + (th-padY*2)*0.74, tw-padX*2+0.5, (th-padY*2)*0.26, [0,0,0], 0.09);
    }
  }
  const d = out.data;
  for (let i = 0; i < d.length; i += 4){
    const n = (rnd()-0.5)*9*(1 + rough);
    d[i]=clamp255(d[i]+n); d[i+1]=clamp255(d[i+1]+n); d[i+2]=clamp255(d[i+2]+n);
  }
  return out;
}

/* ── Ribbon / Cord / Handloom: yarn bodies with gaps ── */
function renderYarnBodies(model, opt){
  const mode = opt.mode;
  const { cols, rows } = model.geometry;
  const idx = model.cells.idx;
  const rgb = model.palette.map(y => y.rgb);
  const { draft, W, H, tp } = model.draft ? model.draft() : opt.draft;
  const cw = opt.cellW ?? Math.max(2, (opt.targetW ?? 900) / cols);
  const ch = cw * (model.geometry.wefted ?? 0.86);
  const tw = cw/tp, th = ch/tp;
  const outW = Math.max(1, Math.round(W*tw));
  const outH = Math.max(1, Math.round(H*th));
  const out = newImg(outW, outH);
  const seed = opt.seed ?? WEAVE_DEFAULTS.seed;
  const rnd = mulberry32(seed);
  const tight = clamp01(opt.tightness ?? WEAVE_DEFAULTS.tightness);
  // handloom amplifies roughness; other modes use it mildly
  const roughIn = clamp01(opt.roughness ?? WEAVE_DEFAULTS.roughness);
  const rough = mode === 'handloom' ? Math.max(0.2, roughIn) : roughIn * 0.45;
  const gap = opt.gapRgb ?? WEAVE_DEFAULTS.gapRgb;
  const warpC = warpColour(model);
  const isCord = mode === 'cord' || mode === 'handloom';
  const isHand = mode === 'handloom';

  // paint void first — tightness opens this up
  fillRect(out, 0, 0, outW, outH, gap);

  // Precompute per-warp-end and per-weft-pick thickness + slide
  const warpSlide = new Float32Array(W);
  const warpThick = new Float32Array(W);
  const weftSlide = new Float32Array(H);
  const weftThick = new Float32Array(H);
  for (let fx = 0; fx < W; fx++){
    warpSlide[fx] = isHand ? (slide1(seed, 11, fx * 0.37) - 0.5) * rough * th * 0.55 : 0;
    warpThick[fx] = yarnFill(tight, rough, seed ^ 0xA11, fx);
  }
  for (let fy = 0; fy < H; fy++){
    weftSlide[fy] = isHand ? (slide1(seed, 22, fy * 0.41) - 0.5) * rough * tw * 0.55 : 0;
    weftThick[fy] = yarnFill(tight, rough, seed ^ 0xB22, fy);
  }

  // Paint weft ribbons first (under), then warp on top where draft says — but
  // we respect the draft per cell: only the "up" yarn is fully opaque; the
  // diving yarn is thinner/darker so gaps and crossings read.
  for (let fy = 0; fy < H; fy++){
    const cy = Math.min(rows - 1, (fy/tp)|0);
    const thk = weftThick[fy];
    const bodyH = Math.max(1, th * thk);
    const y0 = fy*th + (th - bodyH)*0.5 + (isHand ? warpSlide[Math.min(W-1, fy % W)] * 0.15 : 0);
    for (let fx = 0; fx < W; fx++){
      const cx = Math.min(cols - 1, (fx/tp)|0);
      const up = draft[fy*W+fx]; // 1 = warp on top → weft dives
      const yarn = rgb[idx[cy*cols+cx]];
      const slideX = weftSlide[fy];
      const x0 = fx*tw + slideX;
      // weft always present as a horizontal strip; dimmer when diving
      const dive = up ? 0.55 : 1;
      paintYarnStrip(out, x0, y0, tw + 0.6, bodyH, yarn, {
        axis: 'h', cord: isCord, dive, seed, fx, fy, rough, mode
      });
    }
  }

  for (let fx = 0; fx < W; fx++){
    const twk = warpThick[fx];
    const bodyW = Math.max(1, tw * twk);
    const x0 = fx*tw + (tw - bodyW)*0.5;
    for (let fy = 0; fy < H; fy++){
      const cy = Math.min(rows - 1, (fy/tp)|0);
      const cx = Math.min(cols - 1, (fx/tp)|0);
      const up = draft[fy*W+fx];
      const slideY = warpSlide[fx];
      const y0 = fy*th + slideY;
      // warp only strongly visible when up; ghost when under
      if (!up && mode === 'ribbon' && tight > 0.85) continue; // packed ribbon hides underwarp
      const dive = up ? 1 : 0.4;
      paintYarnStrip(out, x0, y0, bodyW, th + 0.6, warpC, {
        axis: 'v', cord: isCord, dive, seed, fx, fy, rough, mode
      });
    }
  }

  // Handloom: sparse flyaway flecks + tension grain
  if (isHand && rough > 0){
    const flecks = Math.round(outW * outH * 0.002 * rough);
    for (let i = 0; i < flecks; i++){
      const x = (rnd() * outW)|0, y = (rnd() * outH)|0;
      const o = (y*outW + x)*4;
      const lift = (rnd() - 0.5) * 40 * rough;
      out.data[o]   = clamp255(out.data[o] + lift);
      out.data[o+1] = clamp255(out.data[o+1] + lift);
      out.data[o+2] = clamp255(out.data[o+2] + lift);
    }
  }

  const d = out.data;
  const grain = mode === 'flat' ? 0 : 7 * (1 + rough * (isHand ? 1.4 : 0.6));
  for (let i = 0; i < d.length; i += 4){
    const n = (rnd() - 0.5) * grain;
    d[i]=clamp255(d[i]+n); d[i+1]=clamp255(d[i+1]+n); d[i+2]=clamp255(d[i+2]+n);
  }
  return out;
}

function paintYarnStrip(img, x0, y0, w, h, rgb, p){
  const X0 = Math.max(0, Math.floor(x0));
  const Y0 = Math.max(0, Math.floor(y0));
  const X1 = Math.min(img.w, Math.ceil(x0 + w));
  const Y1 = Math.min(img.h, Math.ceil(y0 + h));
  if (X1 <= X0 || Y1 <= Y0) return;
  const d = img.data;
  const dive = p.dive ?? 1;
  const rough = p.rough ?? 0;

  for (let y = Y0; y < Y1; y++){
    for (let x = X0; x < X1; x++){
      // local coords in strip 0..1
      const u = (x - x0) / Math.max(1e-6, w);
      const v = (y - y0) / Math.max(1e-6, h);
      if (u < 0 || u > 1 || v < 0 || v > 1) continue;

      // elliptical ribbon mask (softer edges than a hard rect)
      let mask;
      if (p.axis === 'h'){
        // horizontal weft: thin in v
        const dv = (v - 0.5) * 2;
        mask = 1 - dv*dv;
      } else {
        const du = (u - 0.5) * 2;
        mask = 1 - du*du;
      }
      if (mask <= 0.02) continue;
      mask = Math.sqrt(Math.max(0, mask));

      // cylinder shading across the short axis
      let shade = 1;
      if (p.cord){
        const t = p.axis === 'h' ? (v - 0.5) * 2 : (u - 0.5) * 2;
        shade = 0.72 + 0.28 * Math.cos(t * Math.PI * 0.5);
        // highlight ridge
        if (Math.abs(t) < 0.25) shade += 0.08;
      } else {
        // ribbon: soft top light
        shade = p.axis === 'h' ? (0.88 + 0.12 * (1 - v)) : (0.88 + 0.12 * (1 - u));
      }

      // handloom tension noise along the yarn
      if (rough > 0 && p.mode === 'handloom'){
        const along = p.axis === 'h' ? p.fx + u : p.fy + v;
        shade += (slide1(p.seed, 33, along * 2) - 0.5) * rough * 0.22;
      }

      const a = clamp01(mask * dive);
      const o = (y * img.w + x) * 4;
      const r = clamp255(rgb[0] * shade);
      const g = clamp255(rgb[1] * shade);
      const b = clamp255(rgb[2] * shade);
      d[o]   = d[o]   + (r - d[o])   * a;
      d[o+1] = d[o+1] + (g - d[o+1]) * a;
      d[o+2] = d[o+2] + (b - d[o+2]) * a;
      d[o+3] = 255;
    }
  }
}
