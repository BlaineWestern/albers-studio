import { readFileSync, existsSync } from 'node:fs';
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
import { fingerprintConfig, fingerprintModel, blendFingerprints } from '../src/pipeline/fingerprint.js';
import { generateFromEnv, defaultFingerprint, ENV_DEFAULTS } from '../src/pipeline/generative.js';

let fails = 0;
const ok = (c,m) => { if(!c){ console.log('  FAIL', m); fails++; } };

const PASTURE = '/tmp/fx/pasture.raw';
let model = null;

if (existsSync(PASTURE)){
  const buf = readFileSync(PASTURE);
  const w = buf.readUInt32LE(0), h = buf.readUInt32LE(4);
  const photo = { w, h, data:new Uint8ClampedArray(buf.buffer, buf.byteOffset+8, w*h*4) };

  console.log('1. layered model from real photo');
  model = buildModel(photo, { k:8 });
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
    const out2 = fn(model, { targetW: 800 });
    ok(Buffer.compare(Buffer.from(out.data),Buffer.from(out2.data))===0, name+' not deterministic');
    console.log(`   ${name.padEnd(5)} ${out.w}x${out.h}  dE ${f.mean.toFixed(1)}  band r ${f.rows.toFixed(3)}`);
  }

  console.log('3. responsive: different container widths give same cloth, different scale');
  {
    const a = renderV2(model, { targetW: 400 }), b = renderV2(model, { targetW: 1200 });
    ok(b.w > a.w*2, 'width did not scale');
    ok(Math.abs((a.w/a.h)/(b.w/b.h) - 1) < 0.05, 'aspect drifted between sizes');
    const d = meanDelta(a, b, 20);
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
} else {
  console.log('1–7. skipped (no /tmp/fx/pasture.raw) — running generative suite only');
}

console.log('8. rug fingerprint from profile');
{
  const styleModel = model || generateFromEnv({ env: ENV_DEFAULTS, seed: 2, cols: 64, rows: 48 });
  const cfg = modelToConfig(styleModel, { name:'style-fp' });
  const fp = fingerprintConfig(cfg);
  ok(fp.schema === 'albers-studio/fingerprint@1', 'fingerprint schema');
  ok(fp.yarns.k === styleModel.palette.length, 'yarn count');
  ok(fp.yarns.labs.length === fp.yarns.k, 'labs length');
  ok(fp.spatial.groundShare > 0.15 && fp.spatial.groundShare < 0.95, 'ground share odd: '+fp.spatial.groundShare);
  ok(fp.spatial.meanRun >= 1, 'mean run');
  const fromModel = fingerprintModel(styleModel);
  ok(fromModel.gauge.cols === fp.gauge.cols, 'model vs config fingerprint cols diverge');
  const blend = blendFingerprints([fp, defaultFingerprint()]);
  ok(blend.yarns.k >= 2, 'blend collapsed');
  ok(blend.gauge.cols > 0, 'blend gauge');
  console.log(`   k=${fp.yarns.k} groundShare=${fp.spatial.groundShare} meanRun=${fp.spatial.meanRun} disorder=${fp.spatial.disorder}`);
}

console.log('9. generative tapestry from environment + fingerprint');
{
  const styleModel = model || generateFromEnv({ env: ENV_DEFAULTS, seed: 2, cols: 64, rows: 48 });
  const fp = fingerprintConfig(modelToConfig(styleModel, { name:'pasture-style' }));
  const cold = generateFromEnv({
    env: { ...ENV_DEFAULTS, temperature: -2, humidity: 80, wind: 12, precipitation: 25, light: 0.25, season: 0.1 },
    fingerprint: fp, seed: 99, cols: 80, rows: 60
  });
  const hot = generateFromEnv({
    env: { ...ENV_DEFAULTS, temperature: 32, humidity: 20, wind: 1, precipitation: 0, light: 0.9, season: 0.6 },
    fingerprint: fp, seed: 99, cols: 80, rows: 60
  });
  ok(cold.geometry.cols === 80 && cold.geometry.rows === 60, 'gen gauge');
  ok(cold.palette.length === fp.yarns.k, 'gen palette size');
  ok(cold.cells.idx.length === 80*60, 'gen indexmap size');
  ok(cold.generative?.env?.temperature === -2, 'env stamped');
  ok(typeof cold.draft === 'function', 'gen draft missing');
  const { draft } = cold.draft();
  ok(draft.length === 80*2*60*2, 'gen draft resolution');
  const cold2 = generateFromEnv({
    env: { ...ENV_DEFAULTS, temperature: -2, humidity: 80, wind: 12, precipitation: 25, light: 0.25, season: 0.1 },
    fingerprint: fp, seed: 99, cols: 80, rows: 60
  });
  ok(Buffer.compare(Buffer.from(cold.cells.idx), Buffer.from(cold2.cells.idx)) === 0, 'gen not deterministic');
  let diff = 0;
  for (let i = 0; i < cold.cells.idx.length; i++) if (cold.cells.idx[i] !== hot.cells.idx[i]) diff++;
  ok(diff > cold.cells.idx.length * 0.02, `env had almost no effect on cells (${diff} diffs)`);
  const coldG = cold.palette[cold.cells.ground].lab;
  const hotG = hot.palette[hot.cells.ground].lab;
  ok(hotG[2] > coldG[2] || hotG[0] > coldG[0], 'env did not tint palette');
  ok(cold.palette[cold.cells.ground].share > 0.2, 'cold ground starved: '+cold.palette[cold.cells.ground].share);
  ok(hot.palette[hot.cells.ground].share > 0.2, 'hot ground starved: '+hot.palette[hot.cells.ground].share);
  const out = renderV2(cold, { targetW: 400 });
  ok(out.w > 0 && out.h > 0, 'gen render empty');
  const round = modelToConfig(cold, { name:'gen-round', source:'generative' });
  ok(round.meta.source === 'generative', 'gen meta lost');
  ok(round.yarns.length === cold.palette.length, 'gen config yarns');
  console.log(`   cold≠hot cells ${(100*diff/cold.cells.idx.length).toFixed(1)}%, render ${out.w}x${out.h}`);
}

console.log('10. default fingerprint generate (no saved rug)');
{
  const m = generateFromEnv({ env: ENV_DEFAULTS, seed: 1 });
  ok(m.palette.length >= 3, 'default yarn count');
  ok(m.cells.idx.length === m.geometry.cols * m.geometry.rows, 'default indexmap');
  ok(m.palette[m.cells.ground].share > 0.2, 'default ground starved');
  console.log(`   default ${m.geometry.cols}x${m.geometry.rows}, ${m.palette.length} yarns`);
}

console.log(fails ? `\nX ${fails} failure(s)` : '\nOK all checks passed');
process.exit(fails ? 1 : 0);
