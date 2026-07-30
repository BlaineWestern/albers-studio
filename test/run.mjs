import { readFileSync } from 'node:fs';
import { newImg, oklabToRgb, rgbToOklab } from '../src/pipeline/core.js';
import { warpQuad, solveHomography } from '../src/pipeline/geometry.js';
import { buildModel } from '../src/pipeline/model.js';
import { modelToConfig, configToModel, rleEncode, rleDecode } from '../src/pipeline/config.js';
import { fidelity, meanDelta } from '../src/pipeline/analyze.js';
import { renderV1 } from '../src/pipeline/render/v1.js';
import { renderV12 } from '../src/pipeline/render/v12.js';
import { renderV2, renderDraftImage } from '../src/pipeline/render/v2.js';
import { modelToSvg } from '../src/pipeline/svg.js';
import { buildDraft } from '../src/pipeline/structure.js';

let fails = 0;
const ok = (c,m) => { if(!c){ console.log('  FAIL', m); fails++; } };

// real photograph
const buf = readFileSync('/tmp/fx/pasture.raw');
const w = buf.readUInt32LE(0), h = buf.readUInt32LE(4);
const photo = { w, h, data:new Uint8ClampedArray(buf.buffer, buf.byteOffset+8, w*h*4) };

console.log('1. layered model from real photo');
const model = buildModel(photo, { k:8 });
ok(model.geometry.cols > 60 && model.geometry.cols < 300, 'auto gauge unreasonable: '+model.geometry.cols);
ok(model.palette.length === 8, 'palette size');
ok(model.palette.filter(y=>y.role==='supplementary').length >= 2, 'no supplementary yarns found');
ok(model.palette.filter(y=>y.role==='ground').length === 1, 'ground count wrong');
console.log(`   ${model.geometry.cols}x${model.geometry.rows}, roles: ` +
  model.palette.map(y=>y.role[0]).join(''));

console.log('2. all three renderers, same model');
const fids = {};
for (const [name, fn] of [['V1',renderV1],['V1.2',renderV12],['V2',renderV2]]){
  const out = fn(model, { targetW: 800 });
  ok(out.w > 0 && out.h > 0, name+' empty');
  let clear=0; for(let i=3;i<out.data.length;i+=4) if(out.data[i]<255) clear++;
  ok(clear===0, name+': transparent pixels');
  const f = fidelity(photo, out);
  fids[name]=f;
  ok(f.mean < 16, `${name}: mean dE ${f.mean.toFixed(1)}`);
  ok(f.rows > 0.7, `${name}: band r ${f.rows.toFixed(3)}`);
  // determinism
  const out2 = fn(model, { targetW: 800 });
  ok(Buffer.compare(Buffer.from(out.data),Buffer.from(out2.data))===0, name+' not deterministic');
  console.log(`   ${name.padEnd(5)} ${out.w}x${out.h}  dE ${f.mean.toFixed(1)}  band r ${f.rows.toFixed(3)}`);
}

console.log('3. responsive: different container widths give same cloth, different scale');
{
  const a = renderV2(model, { targetW: 400 }), b = renderV2(model, { targetW: 1200 });
  ok(b.w > a.w*2, 'width did not scale');
  ok(Math.abs((a.w/a.h)/(b.w/b.h) - 1) < 0.05, 'aspect drifted between sizes');
  // content equivalence at coarse scale
  const d = meanDelta(a, b, 20);
  // texture amplitude legitimately varies with pixel scale; content identity
  // is what matters, measured at coarse 20x20
  ok(d.mean < 5.5, `same model renders differently at different sizes (dE ${d.mean.toFixed(1)})`);
  console.log(`   400px vs 1200px: coarse dE ${d.mean.toFixed(2)} — same cloth, different scale`);
}

console.log('4. config profile round-trip');
{
  const cfg = modelToConfig(model, { name:'pasture-test' });
  const json = JSON.stringify(cfg);
  ok(json.length < 200000, `config too fat: ${(json.length/1024).toFixed(0)}kb`);
  const back = configToModel(JSON.parse(json));
  ok(back.geometry.cols === model.geometry.cols, 'cols lost');
  ok(back.cells.idx.length === model.cells.idx.length, 'cells length lost');
  let same=0; for(let i=0;i<back.cells.idx.length;i++) if(back.cells.idx[i]===model.cells.idx[i]) same++;
  ok(same === back.cells.idx.length, `indexmap corrupted: ${same}/${back.cells.idx.length}`);
  // re-render from config alone (no photograph!)
  back.draft = () => buildDraft(back.cells.idx, back.geometry.cols, back.geometry.rows,
    back.palette.map(y=>y.role), back.structure.assign, 2);
  const fromCfg = renderV2(back, { targetW: 800 });
  const direct  = renderV2(model, { targetW: 800 });
  ok(Buffer.compare(Buffer.from(fromCfg.data),Buffer.from(direct.data))===0,
     'render from config differs from render from model');
  console.log(`   ${(json.length/1024).toFixed(0)}kb, lossless, re-renders identically without the photo`);
}

console.log('5. RLE');
{
  const arr = new Uint8Array([0,0,0,2,2,1,1,1,1,0]);
  const back = rleDecode(rleEncode(arr), arr.length);
  ok(Buffer.compare(Buffer.from(arr),Buffer.from(back))===0, 'rle round-trip broken');
}

console.log('6. SVG layers');
{
  const svg = modelToSvg(model);
  ok(svg.includes('inkscape:groupmode="layer"'), 'no inkscape layer attrs');
  const groups = [...svg.matchAll(/<g id="yarn-(\d+)-(\w+)"/g)];
  ok(groups.length >= 6, `only ${groups.length} yarn layers`);
  ok(groups.length <= model.palette.length, 'more layers than yarns');
  const paths = [...svg.matchAll(/<path /g)];
  ok(paths.length === groups.length - 1, 'expected one path per yarn layer plus a ground rect');
  ok(svg.includes('<rect fill='), 'ground rect missing');
  // ground layer must be first (painted underneath)
  ok(new RegExp(`<g id="yarn-${model.cells.ground+1}-ground"`).test(svg.split('<g')[1] ? '<g'+svg.split('<g')[1] : ''),
     'ground is not the bottom layer');
  ok(svg.length < 700000, `svg too fat: ${(svg.length/1024).toFixed(0)}kb`);
  console.log(`   ${groups.length} yarn layers, 1 path each, ${(svg.length/1024).toFixed(0)}kb, ground at bottom`);
}

console.log('7. V2 draft is a real jacquard object');
{
  const { draft, W, H } = model.draft();
  ok(W === model.geometry.cols*2 && H === model.geometry.rows*2, 'draft resolution wrong');
  const ups = draft.reduce((a,b)=>a+b,0)/draft.length;
  ok(ups > 0.2 && ups < 0.8, `draft lift ratio ${ups.toFixed(2)} — degenerate structure`);
  const img = renderDraftImage(model, 1);
  ok(img.w === W && img.h === H, 'draft image dims');
  console.log(`   ${W}x${H} draft, ${(ups*100).toFixed(0)}% warp lifts`);
}

console.log(fails ? `\nX ${fails} failure(s)` : '\nOK all checks passed');
process.exit(fails ? 1 : 0);
