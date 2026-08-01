import { buildDraft } from './pipeline/structure.js';
import { runDraftOps } from './pipeline/draft-ops.js';

export const API = 'http://localhost:4571/api';

/** Attach draft() that rebuilds from cells+assign and re-applies DesignSpec ops. */
export function attachDraft(m, meta = {}){
  m.draft = () => {
    const tp = 2;
    const base = buildDraft(
      m.cells.idx, m.geometry.cols, m.geometry.rows,
      m.palette.map(y => y.role), m.structure.assign, tp, { repair: true }
    );
    const ops = m.generative?.designSpec?.structurePlan?.ops
      || meta.designSpec?.structurePlan?.ops
      || meta.provenance?.designSpec?.structurePlan?.ops
      || [];
    if (!ops.length) return base;
    const seed = m.generative?.seed ?? meta.seed ?? 1;
    const maxFloat = (m.generative?.designSpec?.densityPlan?.maxFloat || 8) * tp;
    const mod = runDraftOps({
      draft: base.draft, W: base.W, H: base.H, ops, seed, maxFloat, repair: true
    });
    return { draft: mod.draft, W: mod.W, H: mod.H, tp, validity: mod.validity };
  };
  return m;
}

export function imgToCanvas(img, cvs){
  cvs.width = img.w; cvs.height = img.h;
  const c = cvs.getContext('2d');
  const d = c.createImageData(img.w, img.h);
  d.data.set(img.data);
  c.putImageData(d, 0, 0);
}

export function download(name, href){
  const a = document.createElement('a');
  a.download = name; a.href = href; a.click();
}

export function pathTool(){
  const p = (typeof location !== 'undefined' ? location.pathname : '/').replace(/\/$/, '') || '/';
  if (p === '/photo') return 'photo';
  if (p === '/generate') return 'generate';
  return 'home';
}
