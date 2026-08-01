/* Image → textile transform tool.
   Photograph (RGBA buffer) → optional perspective flatten → buildModel.
   Headless: no DOM. Shared by the Photo UI and POST /api/transform. */
import { warpQuad, quadAspect } from './geometry.js';
import { buildModel } from './model.js';
import { modelToConfig } from './config.js';
import { buildDraft } from './structure.js';
import { fingerprintModel } from './fingerprint.js';

export const TRANSFORM_DEFAULTS = {
  k: 6,
  cols: 0,          // 0 = auto from pitch
  longSide: 1100,   // flatten output long edge
  inset: 0.05,      // default corner inset when quad omitted
  tp: 2
};

/** Default corner quad inset from image edges. */
export function defaultQuad(w, h, inset = TRANSFORM_DEFAULTS.inset){
  const mx = w * inset, my = h * inset;
  return [[mx, my], [w - mx, my], [w - mx, h - my], [mx, h - my]];
}

function attachDraft(model, tp = 2){
  model.draft = () => buildDraft(
    model.cells.idx, model.geometry.cols, model.geometry.rows,
    model.palette.map(y => y.role), model.structure.assign, tp);
  return model;
}

/**
 * Decode a transform request image payload into {w,h,data}.
 * Accepts:
 *   { w, h, data: number[] | Uint8ClampedArray | base64 string of RGBA }
 */
export function decodeImagePayload(img){
  if (!img || !img.w || !img.h) throw Object.assign(new Error('image requires w, h, data'), { status:400 });
  const n = img.w * img.h * 4;
  let data;
  if (typeof img.data === 'string'){
    const bin = Buffer.from(img.data, 'base64');
    if (bin.length < n) throw Object.assign(new Error(`RGBA base64 too short: ${bin.length} < ${n}`), { status:400 });
    data = new Uint8ClampedArray(bin.buffer, bin.byteOffset, n);
  } else if (Array.isArray(img.data) || ArrayBuffer.isView(img.data)){
    data = new Uint8ClampedArray(img.data);
    if (data.length < n) throw Object.assign(new Error(`RGBA length ${data.length} < ${n}`), { status:400 });
  } else {
    throw Object.assign(new Error('image.data must be base64 string or byte array'), { status:400 });
  }
  return { w: img.w|0, h: img.h|0, data };
}

/**
 * Run the photograph → weave model pipeline.
 * @param {object} opts
 * @param {{w,h,data}} opts.image          source RGBA
 * @param {number[][]} [opts.quad]         perspective corners TL,TR,BR,BL
 * @param {boolean} [opts.flatten=true]    warp to flat cloth view
 * @param {number} [opts.k]                yarn count
 * @param {number} [opts.cols]             thread count (0 = auto)
 * @param {number} [opts.seed]
 * @param {number} [opts.longSide]
 * @param {string} [opts.name]
 */
export function transformImage(opts = {}){
  const src = opts.image?.data && opts.image.w
    ? (opts.image.data instanceof Uint8ClampedArray
        ? opts.image
        : decodeImagePayload(opts.image))
    : decodeImagePayload(opts.image);

  const flatten = opts.flatten !== false;
  const k = opts.k ?? TRANSFORM_DEFAULTS.k;
  const cols = opts.cols ?? TRANSFORM_DEFAULTS.cols;
  const longSide = opts.longSide ?? TRANSFORM_DEFAULTS.longSide;
  const tp = opts.tp ?? TRANSFORM_DEFAULTS.tp;

  let flat = src;
  let quad = opts.quad || null;
  if (flatten){
    quad = quad || defaultQuad(src.w, src.h);
    const ar = quadAspect(quad);
    const w = ar >= 1 ? longSide : Math.round(longSide * ar);
    const h = ar >= 1 ? Math.round(longSide / ar) : longSide;
    flat = warpQuad(src, quad, w, h);
  }

  const model = attachDraft(buildModel(flat, {
    k,
    cols: cols || undefined,
    seed: opts.seed ?? 7,
    tp
  }), tp);

  const cfg = modelToConfig(model, {
    name: opts.name || 'photo-transform',
    source: 'transform',
    tool: 'photo',
    flatten,
    k,
    cols: cols || model.geometry.cols
  });

  return {
    model,
    config: cfg,
    flat: { w: flat.w, h: flat.h },
    transform: {
      schema: 'albers-studio/transform@1',
      source: 'photograph',
      flatten,
      quad,
      k,
      cols: model.geometry.cols,
      rows: model.geometry.rows,
      fingerprint: fingerprintModel(model)
    }
  };
}
