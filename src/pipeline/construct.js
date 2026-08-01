/* Shared image construction — model → tapestry pixels.
   Photo and Generate both end here. They differ in how the *model* is made
   (photograph analysis vs DesignSpec generation); construction is one path:
   draft-aware weave render with appearance knobs (mode/tightness/roughness/border). */
import { renderWeave, WEAVE_DEFAULTS, WEAVE_MODES } from './render/weave.js';
import { renderV1 } from './render/v1.js';
import { renderV12 } from './render/v12.js';

export { WEAVE_MODES, WEAVE_DEFAULTS };

const LEGACY = {
  V1: renderV1,
  'V1.2': renderV12
};

/**
 * Construct a tapestry image from a weave model.
 * @param {object} model
 * @param {object} [opt]
 * @param {string} [opt.renderer='V2']  V2 uses weave aesthetics; V1/V1.2 archived
 * @param {string} [opt.mode]           weave aesthetic incl. fringe
 * @param {number} [opt.tightness]
 * @param {number} [opt.roughness]
 * @param {number} [opt.border]           fringe extension 0..1 (0 = no border)
 * @param {number} [opt.borderRoughness]  fringe craft+physics mix 0..1
 * @param {number} [opt.targetW]
 * @param {number} [opt.seed]
 */
export function constructTapestry(model, opt = {}){
  const renderer = opt.renderer ?? 'V2';
  if (renderer !== 'V2' && LEGACY[renderer])
    return LEGACY[renderer](model, { targetW: opt.targetW, seed: opt.seed });
  return renderWeave(model, {
    mode: opt.mode ?? WEAVE_DEFAULTS.mode,
    tightness: opt.tightness ?? WEAVE_DEFAULTS.tightness,
    roughness: opt.roughness ?? WEAVE_DEFAULTS.roughness,
    border: opt.border ?? WEAVE_DEFAULTS.border,
    borderRoughness: opt.borderRoughness ?? WEAVE_DEFAULTS.borderRoughness,
    seed: opt.seed ?? WEAVE_DEFAULTS.seed,
    targetW: opt.targetW,
    cellW: opt.cellW,
    gapRgb: opt.gapRgb,
    draft: opt.draft
  });
}
