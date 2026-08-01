import { buildDraft } from './pipeline/structure.js';

export const API = 'http://localhost:4571/api';

export function attachDraft(m){
  m.draft = () => buildDraft(m.cells.idx, m.geometry.cols, m.geometry.rows,
    m.palette.map(y => y.role), m.structure.assign, 2);
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
