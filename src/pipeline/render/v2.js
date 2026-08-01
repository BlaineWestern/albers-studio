/* V2 — draft-based jacquard render. Aesthetic modes, tightness, and handloom
   roughness live in ./weave.js; this module keeps the stable API and draft export. */
import { renderWeave, WEAVE_DEFAULTS } from './weave.js';
import { newImg, fillRect } from '../core.js';

export function renderV2(model, opt = {}){
  // legacy depth: 'printed'|'relief'|'woven' maps onto new modes when mode unset
  const opt2 = { ...opt };
  if (!opt2.mode){
    if (opt.depth === 'printed') opt2.mode = 'flat';
    else if (opt.depth === 'relief'){ opt2.mode = 'tile'; opt2.tightness = opt2.tightness ?? 0.95; }
    else opt2.mode = opt2.mode ?? WEAVE_DEFAULTS.mode;
  }
  return renderWeave(model, opt2);
}

/* The draft itself as an image — black warp-up, white weft-up. This is the
   file a jacquard pipeline would take. */
export function renderDraftImage(model, scale = 2){
  const { draft, W, H } = model.draft();
  const out = newImg(W*scale, H*scale);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
    const v = draft[y*W+x] ? 0 : 255;
    fillRect(out, x*scale, y*scale, scale, scale, [v,v,v]);
  }
  return out;
}
