/* Minimal WIF (Weaving Information File) write/read for binary drafts.
   Interchange only — not a full AdaCAD exporter. */
import { validateDraft } from './structure.js';

function section(name, lines){
  return `[${name}]\n` + lines.join('\n') + '\n';
}

/** Serialize a binary draft to a compact WIF-like text. */
export function draftToWif(draft, W, H, meta = {}){
  const lifts = [];
  for (let y = 0; y < H; y++){
    const row = [];
    for (let x = 0; x < W; x++) row.push(draft[y*W+x] ? '1' : '0');
    lifts.push(`${y+1}=${row.join('')}`);
  }
  const parts = [
    section('WIF', [
      'Version=1.1',
      'Date=' + (meta.created || new Date().toISOString().slice(0,10)),
      'Developers=Albers Studio',
      'Source Program=albers-studio',
      'Source Version=2.0'
    ]),
    section('CONTENTS', [
      'TEXT=true',
      'WEAVING=true',
      'WARP=true',
      'WEFT=true',
      'TIEUP=true',
      'THREADING=true',
      'TREADLING=true',
      'COLOR PALETTE=false'
    ]),
    section('TEXT', [
      'Title=' + (meta.name || 'albers-draft'),
      'Author=Albers Studio'
    ]),
    section('WEAVING', [
      `Shafts=${W}`,
      `Treadles=${H}`,
      'Rising Shed=true'
    ]),
    section('WARP', [`Threads=${W}`, 'Units=Centimeters', 'Spacing=0.05', 'Thickness=0.04']),
    section('WEFT', [`Threads=${H}`, 'Units=Centimeters', 'Spacing=0.05', 'Thickness=0.04']),
    section('ALBERS DRAFT', [
      `Width=${W}`,
      `Height=${H}`,
      ...lifts
    ])
  ];
  return parts.join('\n');
}

/** Parse WIF text produced by draftToWif (ALBERS DRAFT section). */
export function wifToDraft(text){
  const lines = String(text).split(/\r?\n/);
  let inDraft = false;
  let W = 0, H = 0;
  const rows = new Map();
  for (const line of lines){
    const t = line.trim();
    if (/^\[/.test(t)){
      inDraft = /^\[ALBERS DRAFT\]/i.test(t);
      continue;
    }
    if (!inDraft || !t || t.startsWith(';')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim();
    if (key === 'Width') W = +val;
    else if (key === 'Height') H = +val;
    else if (/^\d+$/.test(key)) rows.set(+key - 1, val);
  }
  if (W < 1 || H < 1) throw Object.assign(new Error('WIF missing ALBERS DRAFT size'), { status:400 });
  const draft = new Uint8Array(W * H);
  for (let y = 0; y < H; y++){
    const row = rows.get(y) || '';
    for (let x = 0; x < W; x++)
      draft[y*W+x] = row[x] === '1' ? 1 : 0;
  }
  return { draft, W, H, validity: validateDraft(draft, W, H) };
}

/** JSON lift sidecar — trivial round-trip companion to WIF. */
export function draftToLiftJson(draft, W, H, meta = {}){
  return {
    schema: 'albers-studio/lift@1',
    W, H,
    name: meta.name || 'draft',
    draft: Array.from(draft)
  };
}

export function liftJsonToDraft(obj){
  if (!obj || !obj.W || !obj.H || !obj.draft)
    throw Object.assign(new Error('invalid lift json'), { status:400 });
  const draft = Uint8Array.from(obj.draft);
  if (draft.length !== obj.W * obj.H)
    throw Object.assign(new Error('lift length mismatch'), { status:400 });
  return { draft, W: obj.W, H: obj.H, validity: validateDraft(draft, obj.W, obj.H) };
}
