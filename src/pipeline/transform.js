/* Image → textile transform tool.
   Photograph → (photo mode) → shared buildModel → same constructTapestry path
   as Generate. Photo modes only change *how the image is read* into a model;
   they do not invent a separate renderer. */
import { warpQuad, quadAspect } from './geometry.js';
import { buildModel } from './model.js';
import { modelToConfig } from './config.js';
import { buildDraft, DEFAULT_ASSIGN } from './structure.js';
import { fingerprintModel } from './fingerprint.js';

export const TRANSFORM_DEFAULTS = {
  k: 6,
  cols: 0,
  longSide: 1100,
  inset: 0.05,
  tp: 2,
  mode: 'faithful'
};

/**
 * Photo-tool modes — analysis / interpretation of the source image.
 * All modes still run: optional flatten → buildModel → draft → constructTapestry.
 */
export const PHOTO_MODES = {
  faithful: {
    label: 'Faithful',
    note: 'balanced quantize + mark-bias — default cloth reading',
    flatten: true,
    params: { markBias: 0.30, assign: { ...DEFAULT_ASSIGN } }
  },
  poster: {
    label: 'Poster',
    note: 'fewer yarns, stronger marks — graphic posterization',
    flatten: true,
    params: {
      markBias: 0.48,
      kOffset: -2,
      kMin: 3,
      assign: { ground: 'plain', field: 'basket', supplementary: 'weft5' }
    }
  },
  tapestry: {
    label: 'Tapestry',
    note: 'richer palette, softer bias — pictorial weaving lean',
    flatten: true,
    params: {
      markBias: 0.20,
      kOffset: 1,
      kMax: 10,
      assign: { ground: 'plain', field: 'twill', supplementary: 'satin8' }
    }
  },
  structure: {
    label: 'Structure',
    note: 'emphasize weave structure over colour fidelity',
    flatten: true,
    params: {
      markBias: 0.42,
      assign: { ground: 'twill', field: 'basket', supplementary: 'weft5' }
    }
  },
  document: {
    label: 'Document',
    note: 'no perspective warp — document the flat frame as woven',
    flatten: false,
    params: { markBias: 0.30, assign: { ...DEFAULT_ASSIGN } }
  }
};

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

function resolvePhotoMode(name){
  return PHOTO_MODES[name] || PHOTO_MODES.faithful;
}

/** Apply photo-mode knobs onto buildModel params (shared construction entry). */
export function photoModeParams(modeName, opts = {}){
  const mode = resolvePhotoMode(modeName);
  const baseK = opts.k ?? TRANSFORM_DEFAULTS.k;
  const off = mode.params.kOffset || 0;
  let k = baseK + off;
  if (mode.params.kMin != null) k = Math.max(mode.params.kMin, k);
  if (mode.params.kMax != null) k = Math.min(mode.params.kMax, k);
  k = Math.max(2, Math.min(10, k));
  return {
    mode: modeName in PHOTO_MODES ? modeName : 'faithful',
    flatten: opts.flatten != null ? opts.flatten : mode.flatten,
    modelParams: {
      k,
      cols: opts.cols || undefined,
      seed: opts.seed ?? 7,
      tp: opts.tp ?? TRANSFORM_DEFAULTS.tp,
      markBias: mode.params.markBias,
      assign: { ...mode.params.assign },
      version: 'v2'
    }
  };
}

/**
 * Photograph → weave model via a photo mode, then the shared buildModel path.
 * @param {object} opts
 * @param {string} [opts.mode]  PHOTO_MODES key
 */
export function transformImage(opts = {}){
  const src = opts.image?.data && opts.image.w
    ? (opts.image.data instanceof Uint8ClampedArray
        ? opts.image
        : decodeImagePayload(opts.image))
    : decodeImagePayload(opts.image);

  const resolved = photoModeParams(opts.mode ?? TRANSFORM_DEFAULTS.mode, opts);
  const flatten = resolved.flatten;
  const longSide = opts.longSide ?? TRANSFORM_DEFAULTS.longSide;
  const tp = resolved.modelParams.tp;

  let flat = src;
  let quad = opts.quad || null;
  if (flatten){
    quad = quad || defaultQuad(src.w, src.h);
    const ar = quadAspect(quad);
    const w = ar >= 1 ? longSide : Math.round(longSide * ar);
    const h = ar >= 1 ? Math.round(longSide / ar) : longSide;
    flat = warpQuad(src, quad, w, h);
  }

  // Shared construction entry: same buildModel used everywhere
  const model = attachDraft(buildModel(flat, resolved.modelParams), tp);

  const cfg = modelToConfig(model, {
    name: opts.name || `photo-${resolved.mode}`,
    source: 'transform',
    tool: 'photo',
    photoMode: resolved.mode,
    flatten,
    k: resolved.modelParams.k,
    cols: opts.cols || model.geometry.cols
  });

  return {
    model,
    config: cfg,
    flat: { w: flat.w, h: flat.h, data: flat.data },
    transform: {
      schema: 'albers-studio/transform@1',
      source: 'photograph',
      mode: resolved.mode,
      flatten,
      quad,
      k: resolved.modelParams.k,
      cols: model.geometry.cols,
      rows: model.geometry.rows,
      markBias: resolved.modelParams.markBias,
      assign: resolved.modelParams.assign,
      fingerprint: fingerprintModel(model),
      construction: 'shared-buildModel+constructTapestry'
    }
  };
}
