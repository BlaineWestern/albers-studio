import { readFileSync, existsSync } from 'node:fs';
import { buildModel } from '../src/pipeline/model.js';
import { modelToConfig, configToModel, rleEncode, rleDecode } from '../src/pipeline/config.js';
import { fidelity, meanDelta, estimateWeave } from '../src/pipeline/analyze.js';
import { renderV1 } from '../src/pipeline/render/v1.js';
import { renderV12 } from '../src/pipeline/render/v12.js';
import { renderV2, renderDraftImage } from '../src/pipeline/render/v2.js';
import { renderWeave, WEAVE_MODES, WEAVE_DEFAULTS } from '../src/pipeline/render/weave.js';
import { modelToSvg } from '../src/pipeline/svg.js';
import { buildDraft, DEFAULT_ASSIGN, STRUCTURES, validateDraft, repairDraft, structureNames } from '../src/pipeline/structure.js';
import { fingerprintConfig, fingerprintModel, blendFingerprints } from '../src/pipeline/fingerprint.js';
import { generateFromEnv, materializeFromDesignSpec, defaultFingerprint, ENV_DEFAULTS, resolveDesignSpec } from '../src/pipeline/generative.js';
import { transformImage, defaultQuad, decodeImagePayload, PHOTO_MODES, photoModeParams } from '../src/pipeline/transform.js';
import { constructTapestry } from '../src/pipeline/construct.js';
import { runDraftOps } from '../src/pipeline/draft-ops.js';
import { draftToWif, wifToDraft, draftToLiftJson, liftJsonToDraft } from '../src/pipeline/export-wif.js';
import { reassignRegion, paintBrush } from '../src/pipeline/cells.js';
import { generateCaDraft, searchCaDrafts } from '../src/pipeline/structure-ca.js';
import { buildLayeredDraft, draftFromLayers } from '../src/pipeline/structure.js';
import { createHash } from 'node:crypto';
import { syntheticCloth } from './fixture.mjs';

let fails = 0;
const ok = (c,m) => { if(!c){ console.log('  FAIL', m); fails++; } };

/* ── always-on synthetic cloth (no external fixture required) ── */
const syn = syntheticCloth({ pitch: 8, cols: 100, rows: 75, seed: 17 });
const photo = syn.img;

console.log('1. layered model from synthetic cloth');
const model = buildModel(photo, { k: 5 });
ok(model.geometry.cols > 40 && model.geometry.cols < 300, 'auto gauge unreasonable: '+model.geometry.cols);
ok(model.palette.length === 5, 'palette size');
ok(model.palette.filter(y => y.role === 'ground').length === 1, 'ground count wrong');
ok(model.palette.reduce((a,y) => a + y.share, 0) > 0.99, 'shares do not sum ~1');
console.log(`   ${model.geometry.cols}x${model.geometry.rows}, roles: ` +
  model.palette.map(y => y.role[0]).join('') +
  `  pitch conf ${model.geometry.pitch.confX.toFixed(3)}`);

console.log('1b. pitch estimate near synthetic period');
{
  const pitch = estimateWeave(photo);
  ok(pitch.pitchX > 0, 'no pitchX');
  // autocorrelation may lock onto a harmonic of the thread period
  if (pitch.confX >= 0.04){
    const ratio = pitch.pitchX / syn.pitch;
    const nearHarmonic = Math.abs(ratio - Math.round(ratio)) < 0.35 && Math.round(ratio) >= 1;
    const nearExact = Math.abs(pitch.pitchX - syn.pitch) <= 3;
    ok(nearExact || nearHarmonic, `pitchX ${pitch.pitchX} not near ${syn.pitch} or harmonic`);
  }
  console.log(`   measured pitchX=${pitch.pitchX} conf=${pitch.confX.toFixed(3)} (target ${syn.pitch})`);
}

console.log('2. all three renderers, same model');
for (const [name, fn] of [['V1',renderV1],['V1.2',renderV12],['V2',renderV2]]){
  const out = fn(model, { targetW: 800 });
  ok(out.w > 0 && out.h > 0, name+' empty');
  let clear = 0; for (let i = 3; i < out.data.length; i += 4) if (out.data[i] < 255) clear++;
  ok(clear === 0, name+': transparent pixels');
  const f = fidelity(photo, out);
  ok(f.mean < 28, `${name}: mean dE ${f.mean.toFixed(1)}`); // synthetic is stylized; looser than photo
  const out2 = fn(model, { targetW: 800 });
  ok(Buffer.compare(Buffer.from(out.data), Buffer.from(out2.data)) === 0, name+' not deterministic');
  console.log(`   ${name.padEnd(5)} ${out.w}x${out.h}  dE ${f.mean.toFixed(1)}  band r ${f.rows.toFixed(3)}`);
}

console.log('3. responsive: different container widths give same cloth, different scale');
{
  const a = renderV2(model, { targetW: 400 }), b = renderV2(model, { targetW: 1200 });
  ok(b.w > a.w * 2, 'width did not scale');
  ok(Math.abs((a.w/a.h)/(b.w/b.h) - 1) < 0.05, 'aspect drifted between sizes');
  const d = meanDelta(a, b, 20);
  ok(d.mean < 9, `same model renders differently at different sizes (dE ${d.mean.toFixed(1)})`);
  console.log(`   400px vs 1200px: coarse dE ${d.mean.toFixed(2)}`);
}

console.log('4. config profile round-trip');
{
  const cfg = modelToConfig(model, { name: 'syn-test' });
  const json = JSON.stringify(cfg);
  ok(json.length < 200000, `config too fat: ${(json.length/1024).toFixed(0)}kb`);
  const back = configToModel(JSON.parse(json));
  ok(back.geometry.cols === model.geometry.cols, 'cols lost');
  ok(back.cells.idx.length === model.cells.idx.length, 'cells length lost');
  let same = 0; for (let i = 0; i < back.cells.idx.length; i++) if (back.cells.idx[i] === model.cells.idx[i]) same++;
  ok(same === back.cells.idx.length, `indexmap corrupted: ${same}/${back.cells.idx.length}`);
  back.draft = () => buildDraft(back.cells.idx, back.geometry.cols, back.geometry.rows,
    back.palette.map(y => y.role), back.structure.assign, 2);
  const fromCfg = renderV2(back, { targetW: 800 });
  const direct  = renderV2(model, { targetW: 800 });
  ok(Buffer.compare(Buffer.from(fromCfg.data), Buffer.from(direct.data)) === 0,
     'render from config differs from render from model');
  console.log(`   ${(json.length/1024).toFixed(0)}kb, lossless`);
}

console.log('5. RLE edge cases');
{
  const cases = [
    new Uint8Array([0,0,0,2,2,1,1,1,1,0]),
    new Uint8Array([7]),
    new Uint8Array(200).fill(3),
    new Uint8Array([0,1,2,3,4,5,6,7])
  ];
  for (const arr of cases){
    const back = rleDecode(rleEncode(arr), arr.length);
    ok(Buffer.compare(Buffer.from(arr), Buffer.from(back)) === 0, 'rle round-trip broken len='+arr.length);
  }
}

console.log('6. SVG layers');
{
  const svg = modelToSvg(model);
  ok(svg.includes('inkscape:groupmode="layer"'), 'no inkscape layer attrs');
  const groups = [...svg.matchAll(/<g id="yarn-(\d+)-(\w+)"/g)];
  ok(groups.length === model.palette.length, `layer count ${groups.length} ≠ yarns ${model.palette.length}`);
  const paths = [...svg.matchAll(/<path /g)];
  ok(paths.length === groups.length - 1, 'expected one path per non-ground yarn');
  ok(svg.includes('<rect fill='), 'ground rect missing');
  const firstG = svg.indexOf('<g ');
  ok(svg.slice(firstG, firstG + 80).includes('-ground"'), 'ground is not the bottom layer');
  ok(svg.length < 700000, `svg too fat: ${(svg.length/1024).toFixed(0)}kb`);
  console.log(`   ${groups.length} yarn layers, ${(svg.length/1024).toFixed(0)}kb`);
}

console.log('7. V2 draft is a real jacquard object');
{
  const { draft, W, H } = model.draft();
  ok(W === model.geometry.cols * 2 && H === model.geometry.rows * 2, 'draft resolution wrong');
  const ups = draft.reduce((a,b) => a+b, 0) / draft.length;
  ok(ups > 0.15 && ups < 0.85, `draft lift ratio ${ups.toFixed(2)} — degenerate structure`);
  // every STRUCTURES lift is defined for assigned roles
  for (const role of Object.keys(DEFAULT_ASSIGN))
    ok(STRUCTURES[model.structure.assign[role] || DEFAULT_ASSIGN[role]], 'missing structure for '+role);
  const img = renderDraftImage(model, 1);
  ok(img.w === W && img.h === H, 'draft image dims');
  console.log(`   ${W}x${H} draft, ${(ups*100).toFixed(0)}% warp lifts`);
}

console.log('8. rug fingerprint from profile');
{
  const cfg = modelToConfig(model, { name: 'style-fp' });
  const fp = fingerprintConfig(cfg);
  ok(fp.schema === 'albers-studio/fingerprint@1', 'fingerprint schema');
  ok(fp.yarns.k === model.palette.length, 'yarn count');
  ok(fp.yarns.labs.length === fp.yarns.k, 'labs length');
  ok(fp.spatial.groundShare > 0.15 && fp.spatial.groundShare < 0.95, 'ground share odd: '+fp.spatial.groundShare);
  ok(fp.spatial.meanRun >= 1, 'mean run');
  ok(fp.spatial.disorder >= 0 && fp.spatial.disorder <= 1, 'disorder out of range');
  ok(fp.spatial.vertCoherence >= 0 && fp.spatial.vertCoherence <= 1, 'vertCoherence out of range');
  const fromModel = fingerprintModel(model);
  ok(fromModel.gauge.cols === fp.gauge.cols, 'model vs config fingerprint cols diverge');
  ok(Math.abs(fromModel.spatial.groundShare - fp.spatial.groundShare) < 0.01, 'groundShare diverge');

  // blend: equal + weighted; single identity
  const def = defaultFingerprint();
  const blend = blendFingerprints([fp, def]);
  ok(blend.yarns.k >= 2, 'blend collapsed');
  ok(blend.gauge.cols > 0, 'blend gauge');
  const id = blendFingerprints([fp]);
  ok(id.yarns.k === fp.yarns.k && id.gauge.cols === fp.gauge.cols, 'single blend not identity');
  const weighted = blendFingerprints([fp, def], [0.9, 0.1]);
  ok(Math.abs(weighted.gauge.cols - fp.gauge.cols) <= Math.abs(blend.gauge.cols - fp.gauge.cols) + 1,
     'weighting ignored');
  let threw = false;
  try { blendFingerprints([]); } catch { threw = true; }
  ok(threw, 'empty blend should throw');
  console.log(`   k=${fp.yarns.k} groundShare=${fp.spatial.groundShare} meanRun=${fp.spatial.meanRun}`);
}

console.log('9. generative tapestry from environment + fingerprint');
{
  const fp = fingerprintConfig(modelToConfig(model, { name: 'syn-style' }));
  const coldEnv = { ...ENV_DEFAULTS, temperature: -2, humidity: 80, wind: 12, precipitation: 25, light: 0.25, season: 0.1 };
  const hotEnv  = { ...ENV_DEFAULTS, temperature: 32, humidity: 20, wind: 1, precipitation: 0, light: 0.9, season: 0.6 };
  const cold = generateFromEnv({ env: coldEnv, fingerprint: fp, seed: 99, cols: 80, rows: 60 });
  const hot  = generateFromEnv({ env: hotEnv,  fingerprint: fp, seed: 99, cols: 80, rows: 60 });
  ok(cold.geometry.cols === 80 && cold.geometry.rows === 60, 'gen gauge');
  ok(cold.palette.length === fp.yarns.k, 'gen palette size');
  ok(cold.cells.idx.length === 80 * 60, 'gen indexmap size');
  ok(cold.generative?.env?.temperature === -2, 'env stamped');
  ok(typeof cold.draft === 'function', 'gen draft missing');
  const { draft } = cold.draft();
  ok(draft.length === 80 * 2 * 60 * 2, 'gen draft resolution');

  const cold2 = generateFromEnv({ env: coldEnv, fingerprint: fp, seed: 99, cols: 80, rows: 60 });
  ok(Buffer.compare(Buffer.from(cold.cells.idx), Buffer.from(cold2.cells.idx)) === 0, 'gen not deterministic');
  // render determinism too
  const r1 = renderV2(cold, { targetW: 320 }), r2 = renderV2(cold2, { targetW: 320 });
  ok(Buffer.compare(Buffer.from(r1.data), Buffer.from(r2.data)) === 0, 'gen render not deterministic');

  let diff = 0;
  for (let i = 0; i < cold.cells.idx.length; i++) if (cold.cells.idx[i] !== hot.cells.idx[i]) diff++;
  ok(diff > cold.cells.idx.length * 0.02, `env had almost no effect on cells (${diff} diffs)`);

  const coldG = cold.palette[cold.cells.ground].lab;
  const hotG = hot.palette[hot.cells.ground].lab;
  ok(hotG[2] > coldG[2] || hotG[0] > coldG[0], 'env did not tint palette');
  ok(cold.palette[cold.cells.ground].share > 0.2, 'cold ground starved: '+cold.palette[cold.cells.ground].share);
  ok(hot.palette[hot.cells.ground].share > 0.2, 'hot ground starved: '+hot.palette[hot.cells.ground].share);

  // wetter should increase supplementary share vs dry (same seed/style)
  const wetSupp = cold.palette.filter(y => y.role === 'supplementary').reduce((a,y) => a + y.share, 0);
  const drySupp = hot.palette.filter(y => y.role === 'supplementary').reduce((a,y) => a + y.share, 0);
  ok(wetSupp >= drySupp - 0.02, `wet supp ${wetSupp.toFixed(3)} << dry ${drySupp.toFixed(3)}`);

  // indexmap values in range
  let bad = 0;
  for (const v of cold.cells.idx) if (v < 0 || v >= cold.palette.length) bad++;
  ok(bad === 0, 'out-of-range cell indices: '+bad);

  // generative config round-trip → identical V2 render (reapplies DesignSpec ops)
  const cfg = modelToConfig(cold, {
    name: 'gen-round', source: 'generative', tool: 'generate',
    designSpec: cold.generative.designSpec, seed: cold.generative.seed
  });
  ok(cfg.meta.source === 'generative', 'gen meta lost');
  const back = configToModel(cfg);
  // mirror shared attachDraft: rebuild + ops from designSpec
  back.draft = () => {
    const tp = 2;
    const base = buildDraft(back.cells.idx, back.geometry.cols, back.geometry.rows,
      back.palette.map(y => y.role), back.structure.assign, tp, { repair: true });
    const ops = back.generative?.designSpec?.structurePlan?.ops || [];
    if (!ops.length) return base;
    const mod = runDraftOps({
      draft: base.draft, W: base.W, H: base.H, ops,
      seed: back.generative?.seed ?? 1,
      maxFloat: (back.generative?.designSpec?.densityPlan?.maxFloat || 8) * tp,
      repair: true
    });
    return { draft: mod.draft, W: mod.W, H: mod.H, tp };
  };
  const fromCfg = renderV2(back, { targetW: 320 });
  ok(Buffer.compare(Buffer.from(fromCfg.data), Buffer.from(r1.data)) === 0,
     'gen config round-trip render differs');

  const out = renderV2(cold, { targetW: 400 });
  ok(out.w > 0 && out.h > 0, 'gen render empty');
  console.log(`   cold≠hot cells ${(100*diff/cold.cells.idx.length).toFixed(1)}%, wetSupp=${wetSupp.toFixed(2)} drySupp=${drySupp.toFixed(2)}`);
}

console.log('10. default fingerprint + edge envs');
{
  const m = generateFromEnv({ env: ENV_DEFAULTS, seed: 1 });
  ok(m.palette.length >= 3, 'default yarn count');
  ok(m.cells.idx.length === m.geometry.cols * m.geometry.rows, 'default indexmap');
  ok(m.palette[m.cells.ground].share > 0.2, 'default ground starved');
  ok(m.generative?.schema === 'albers-studio/generative@1', 'generative schema');
  ok(m.generative?.designSpec?.structurePlan?.ground, 'designSpec missing');
  ok(m.generative?.provenance?.layers?.includes('draft'), 'provenance layers');
  ok(m.structure.validity?.liftRatio > 0.1 && m.structure.validity?.liftRatio < 0.9, 'draft lift ratio');
  ok(m.structure.validity?.flatRowsCols === 0, 'draft has flat rows/cols: '+m.structure.validity?.flatRowsCols);

  const partial = generateFromEnv({ env: { temperature: 5 }, seed: 2, cols: 40, rows: 30 });
  ok(partial.geometry.cols === 40, 'partial env cols');
  const extreme = generateFromEnv({
    env: { temperature: 999, humidity: -10, wind: 500, precipitation: -5, light: 9, season: -1 },
    seed: 3, cols: 36, rows: 28
  });
  ok(extreme.palette.every(y => y.rgb.every(c => c >= 0 && c <= 255)), 'extreme rgb invalid');
  ok(extreme.palette[extreme.cells.ground].share > 0.15, 'extreme ground starved');

  const fpA = defaultFingerprint();
  const fpB = fingerprintConfig(modelToConfig(m, { name: 'b' }));
  const blended = generateFromEnv({ fingerprint: [fpA, fpB], seed: 4, cols: 48, rows: 36 });
  ok(blended.palette.length >= 3, 'array fingerprint blend');

  const s1 = generateFromEnv({ seed: 10, cols: 40, rows: 30 });
  const s2 = generateFromEnv({ seed: 11, cols: 40, rows: 30 });
  let seedDiff = 0;
  for (let i = 0; i < s1.cells.idx.length; i++) if (s1.cells.idx[i] !== s2.cells.idx[i]) seedDiff++;
  ok(seedDiff > s1.cells.idx.length * 0.05, 'seed change inert');

  const tiny = generateFromEnv({ cols: 1, rows: 1, seed: 1 });
  ok(tiny.geometry.cols >= 24 && tiny.geometry.rows >= 16, 'gauge floor not applied');

  // DesignSpec: windy env prefers broken/field structures; calm dry prefers satin-ish marks
  const windy = resolveDesignSpec({ wind: 18, precipitation: 0 }, defaultFingerprint(), { seed: 1 });
  const calm = resolveDesignSpec({ wind: 0, humidity: 20, precipitation: 0 }, defaultFingerprint(), { seed: 1 });
  ok(['twill','basket'].includes(windy.structurePlan.field), 'windy field structure: '+windy.structurePlan.field);
  ok(windy.appearancePlan.roughness > calm.appearancePlan.roughness, 'wind should raise roughness');
  ok(calm.appearancePlan.tightness >= windy.appearancePlan.tightness - 0.05, 'humidity/wind tightness');

  // validateDraft rejects all-warp
  const bad = new Uint8Array(16).fill(1);
  const badV = validateDraft(bad, 4, 4);
  ok(!badV.ok && badV.flatRowsCols > 0, 'validateDraft should reject flat draft');

  console.log(`   default ${m.geometry.cols}x${m.geometry.rows}; seedDiff=${(100*seedDiff/s1.cells.idx.length).toFixed(0)}%; draft ok=${m.structure.validity.ok}`);
}

console.log('11c. photo transform pipeline (image → textile)');
{
  const synImg = syntheticCloth({ pitch: 8, cols: 48, rows: 36, seed: 3 });
  const result = transformImage({
    image: synImg.img, mode: 'faithful', flatten: true, k: 5, cols: 60, name: 'syn-photo'
  });
  ok(result.config.schema === 'albers-studio/config@1', 'transform config schema');
  ok(result.config.meta.source === 'transform', 'transform source meta');
  ok(result.transform.schema === 'albers-studio/transform@1', 'transform stamp');
  ok(result.transform.mode === 'faithful', 'transform photo mode');
  ok(result.model.palette.length === 5, 'transform palette');
  ok(result.model.geometry.cols === 60, 'transform cols');
  ok(typeof result.model.draft === 'function', 'transform draft');
  ok(result.transform.fingerprint?.yarns?.k === 5, 'transform fingerprint');
  const b64 = Buffer.from(synImg.img.data).toString('base64');
  const decoded = decodeImagePayload({ w: synImg.img.w, h: synImg.img.h, data: b64 });
  ok(decoded.w === synImg.img.w && decoded.data.length === synImg.img.data.length, 'decode base64');
  const q = defaultQuad(100, 80, 0.1);
  ok(q.length === 4 && q[0][0] === 10, 'default quad');
  let threw = false;
  try { transformImage({}); } catch { threw = true; }
  ok(threw, 'transform without image should throw');

  // photo modes exist and change analysis knobs
  const modeIds = Object.keys(PHOTO_MODES);
  ok(modeIds.length >= 5, 'photo modes present');
  ok(PHOTO_MODES.document.flatten === false, 'document mode skips flatten');
  const poster = photoModeParams('poster', { k: 6 });
  ok(poster.modelParams.k === 4, 'poster kOffset -2');
  ok(poster.modelParams.markBias > photoModeParams('faithful').modelParams.markBias, 'poster stronger markBias');
  const doc = transformImage({ image: synImg.img, mode: 'document', k: 4, cols: 40 });
  ok(doc.transform.mode === 'document' && doc.transform.flatten === false, 'document transform');
  ok(doc.flat.w === synImg.img.w && doc.flat.h === synImg.img.h, 'document keeps source size');

  // shared construction path
  const built = constructTapestry(result.model, { mode: 'tile', tightness: 0.8, roughness: 0.2, targetW: 200, seed: 1 });
  ok(built.w > 0 && built.h > 0, 'constructTapestry empty');
  const built2 = constructTapestry(result.model, { mode: 'tile', tightness: 0.8, roughness: 0.2, targetW: 200, seed: 1 });
  ok(Buffer.compare(Buffer.from(built.data), Buffer.from(built2.data)) === 0, 'constructTapestry deterministic');

  console.log(`   transform ${result.model.geometry.cols}x${result.model.geometry.rows}, k=${result.model.palette.length}, modes=${modeIds.join('|')}`);
}

console.log('11. style transfer: fingerprint steers gauge & yarn count');
{
  const wide = { ...defaultFingerprint(), gauge: { cols: 120, rows: 40, wefted: 0.86, aspect: 3 },
    source: { name: 'wide', cols: 120, rows: 40 } };
  wide.yarns = { ...wide.yarns, k: 4, labs: wide.yarns.labs.slice(0,4),
    roles: wide.yarns.roles.slice(0,4), shares: [0.5,0.25,0.15,0.1],
    mix: { ground: 0.5, field: 0.4, supplementary: 0.1 } };
  const m = generateFromEnv({ fingerprint: wide, seed: 5 });
  ok(m.geometry.cols === 120 && m.geometry.rows === 40, 'style gauge not applied');
  ok(m.palette.length === 4, 'style yarn k not applied: '+m.palette.length);
  console.log(`   steered ${m.geometry.cols}x${m.geometry.rows}, k=${m.palette.length}`);
}

console.log('11b. weave aesthetic modes, tightness, handloom roughness');
{
  const modes = Object.keys(WEAVE_MODES);
  ok(modes.length >= 5, 'expected weave modes');
  const outs = {};
  for (const mode of modes){
    const out = renderWeave(model, { mode, targetW: 320, tightness: 0.75, roughness: 0.4, seed: 11 });
    ok(out.w > 0 && out.h > 0, mode+' empty');
    let clear = 0; for (let i = 3; i < out.data.length; i += 4) if (out.data[i] < 255) clear++;
    ok(clear === 0, mode+': transparent pixels');
    // determinism
    const out2 = renderWeave(model, { mode, targetW: 320, tightness: 0.75, roughness: 0.4, seed: 11 });
    ok(Buffer.compare(Buffer.from(out.data), Buffer.from(out2.data)) === 0, mode+' not deterministic');
    outs[mode] = out;
  }
  // modes should not all be identical
  let modeDiff = 0;
  for (let i = 0; i < outs.tile.data.length; i++)
    if (outs.tile.data[i] !== outs.ribbon.data[i]) modeDiff++;
  ok(modeDiff > outs.tile.data.length * 0.01, 'tile≈ribbon — modes collapsed');

  // tightness: looser should expose more gap colour (darker mean in void-heavy renders)
  const packed = renderWeave(model, { mode: 'ribbon', targetW: 280, tightness: 0.95, roughness: 0, seed: 3 });
  const loose  = renderWeave(model, { mode: 'ribbon', targetW: 280, tightness: 0.25, roughness: 0, seed: 3 });
  const mean = (img) => {
    let s = 0, n = 0;
    for (let i = 0; i < img.data.length; i += 4){ s += img.data[i]+img.data[i+1]+img.data[i+2]; n++; }
    return s / (n * 3);
  };
  ok(mean(loose) < mean(packed) - 2, `looseness did not darken (packed ${mean(packed).toFixed(1)} loose ${mean(loose).toFixed(1)})`);

  // handloom roughness changes pixels vs smooth
  const smooth = renderWeave(model, { mode: 'handloom', targetW: 280, tightness: 0.8, roughness: 0.05, seed: 9 });
  const rough  = renderWeave(model, { mode: 'handloom', targetW: 280, tightness: 0.8, roughness: 0.9, seed: 9 });
  let rd = 0;
  for (let i = 0; i < smooth.data.length; i++) if (smooth.data[i] !== rough.data[i]) rd++;
  ok(rd > smooth.data.length * 0.05, 'roughness inert on handloom');

  // V2 API still works and accepts new opts
  const viaV2 = renderV2(model, { mode: 'cord', targetW: 200, tightness: 0.7, roughness: 0.3 });
  ok(viaV2.w > 0, 'V2 cord empty');
  const legacy = renderV2(model, { depth: 'printed', targetW: 200 });
  ok(legacy.w > 0, 'legacy printed depth');

  // Fringe mode: border 0 = cloth-only size; border > 0 extends canvas
  ok(modes.includes('fringe'), 'fringe mode missing');
  const fringe0 = renderWeave(model, { mode: 'fringe', border: 0, targetW: 280, tightness: 0.85, roughness: 0.2, seed: 5 });
  const cordRef = renderWeave(model, { mode: 'cord', targetW: 280, tightness: 0.85, roughness: 0.2, seed: 5 });
  ok(fringe0.w === cordRef.w && fringe0.h === cordRef.h, 'fringe border=0 should match cord footprint');
  ok(Buffer.compare(Buffer.from(fringe0.data), Buffer.from(cordRef.data)) === 0, 'fringe border=0 pixels ≠ cord');
  const fringe1 = renderWeave(model, { mode: 'fringe', border: 0.6, targetW: 280, tightness: 0.85, roughness: 0.2, seed: 5 });
  ok(fringe1.w > fringe0.w && fringe1.h > fringe0.h, 'fringe border should enlarge canvas');
  const fringe1b = renderWeave(model, { mode: 'fringe', border: 0.6, targetW: 280, tightness: 0.85, roughness: 0.2, seed: 5 });
  ok(Buffer.compare(Buffer.from(fringe1.data), Buffer.from(fringe1b.data)) === 0, 'fringe not deterministic');
  const viaConstruct = constructTapestry(model, { mode: 'fringe', border: 0.5, targetW: 200, seed: 5 });
  ok(viaConstruct.w > cordRef.w * 200/280 - 2, 'constructTapestry fringe border');

  // borderRoughness affects fringe only — cloth body stays stable when borderRough changes
  const smoothFringe = renderWeave(model, {
    mode: 'fringe', border: 0.7, borderRoughness: 0.05, roughness: 0.2, targetW: 240, seed: 8
  });
  const roughFringe = renderWeave(model, {
    mode: 'fringe', border: 0.7, borderRoughness: 0.95, roughness: 0.2, targetW: 240, seed: 8
  });
  let fringeRoughDiff = 0;
  const n = Math.min(smoothFringe.data.length, roughFringe.data.length);
  for (let i = 0; i < n; i++) if (smoothFringe.data[i] !== roughFringe.data[i]) fringeRoughDiff++;
  ok(fringeRoughDiff > n * 0.02, 'borderRoughness inert on fringe');
  // same cloth roughness, different borderRoughness → still differ
  const sameClothRough = renderWeave(model, {
    mode: 'fringe', border: 0.7, borderRoughness: 0.1, roughness: 0.5, targetW: 240, seed: 8
  });
  const sameClothRough2 = renderWeave(model, {
    mode: 'fringe', border: 0.7, borderRoughness: 0.9, roughness: 0.5, targetW: 240, seed: 8
  });
  let brd = 0;
  for (let i = 0; i < sameClothRough.data.length && i < sameClothRough2.data.length; i++)
    if (sameClothRough.data[i] !== sameClothRough2.data[i]) brd++;
  ok(brd > sameClothRough.data.length * 0.02, 'borderRoughness should differ at fixed cloth roughness');

  console.log(`   modes ${modes.join(',')}; looseΔ=${(mean(packed)-mean(loose)).toFixed(1)}; roughDiff=${(100*rd/smooth.data.length).toFixed(0)}%; fringe ${fringe0.w}→${fringe1.w}; borderRoughΔ=${(100*fringeRoughDiff/n).toFixed(0)}%`);
}

console.log('13. structure library, repair, draft-ops, DesignSpec, WIF');
{
  const names = structureNames();
  ok(names.length >= 10, 'structure library size '+names.length);
  for (const name of names){
    const W = 24, H = 24;
    const d = new Uint8Array(W*H);
    const s = STRUCTURES[name];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) d[y*W+x] = s.lift(x,y) ? 1 : 0;
    const v = validateDraft(d, W, H, { maxFloat: Math.max(8, s.maxFloat || 8) });
    // lenoStub / satins may need repair — ensure repair can heal flats
    if (!v.ok){
      const r = repairDraft(d, W, H, { maxFloat: 8 });
      ok(r.validity.ok || r.repairs > 0, name+' neither ok nor repaired');
    } else ok(true, name+' valid');
  }

  const flat = new Uint8Array(64).fill(1);
  const repaired = repairDraft(flat, 8, 8, { maxFloat: 4 });
  ok(repaired.validity.flatRowsCols === 0, 'repair should clear flat rows/cols');
  ok(repaired.repairs > 0, 'repair should report work');

  const base = runDraftOps({ W: 32, H: 24, ops: [{ op:'fromStructure', structure:'twill' }], repair:true, seed:1 });
  ok(base.validity.ok, 'fromStructure twill should be ok');
  const glitched = runDraftOps({
    W: 32, H: 24, draft: base.draft,
    ops: [{ op:'glitch', density: 0.08 }], seed: 9, repair: true
  });
  ok(glitched.validity.ok, 'glitch+repair should be ok');
  let gd = 0;
  for (let i = 0; i < base.draft.length; i++) if (base.draft[i] !== glitched.draft[i]) gd++;
  ok(gd > 10, 'glitch should change draft bits');
  const g2 = runDraftOps({
    W: 32, H: 24, draft: base.draft,
    ops: [{ op:'glitch', density: 0.08 }], seed: 9, repair: true
  });
  ok(Buffer.compare(Buffer.from(glitched.draft), Buffer.from(g2.draft)) === 0, 'glitch not deterministic');

  const spec = resolveDesignSpec({ wind: 12 }, defaultFingerprint(), { seed: 7, cols: 48, rows: 36, glitch: 0.05 });
  ok(Array.isArray(spec.structurePlan.ops), 'DesignSpec has ops');
  ok(spec.structurePlan.ops.some(o => o.op === 'glitch'), 'glitch op from opts');
  const m1 = materializeFromDesignSpec(spec, { seed: 7 });
  const m2 = materializeFromDesignSpec(spec, { seed: 7 });
  ok(Buffer.compare(Buffer.from(m1.cells.idx), Buffer.from(m2.cells.idx)) === 0, 'materialize idx not deterministic');
  ok(m1.generative.designSpec.structurePlan.ground, 'public designSpec present');
  ok(m1.generative.provenance?.draftValidity, 'provenance validity');
  ok(m1.structure.validity?.ok, 'materialized draft validity');

  // edit one DesignSpec field
  const edited = structuredClone(m1.generative.designSpec);
  edited.structurePlan.field = 'basket4';
  edited.seed = 7;
  const mEdit = materializeFromDesignSpec(edited, { seed: 7 });
  ok(mEdit.structure.assign.field === 'basket4', 'edited field assign');

  const dobj = m1.draft();
  const wif = draftToWif(dobj.draft, dobj.W, dobj.H, { name: 't' });
  const back = wifToDraft(wif);
  ok(back.W === dobj.W && back.H === dobj.H, 'WIF size');
  ok(Buffer.compare(Buffer.from(dobj.draft), Buffer.from(back.draft)) === 0, 'WIF round-trip');
  const lift = draftToLiftJson(dobj.draft, dobj.W, dobj.H);
  const liftBack = liftJsonToDraft(lift);
  ok(Buffer.compare(Buffer.from(dobj.draft), Buffer.from(liftBack.draft)) === 0, 'lift json round-trip');

  const cfg = modelToConfig(m1, { name: 'prov', source: 'generative', tool: 'generate' });
  ok(cfg.meta.provenance?.designSpec, 'config provenance designSpec');
  ok(cfg.characteristics.draftValidity, 'config stores draftValidity');

  const fp = fingerprintModel(m1);
  ok(fp.spatial.roleGrid?.data?.length === 64, 'fingerprint roleGrid 8x8');
  const region = reassignRegion(m1.cells.idx, m1.geometry.cols, m1.geometry.rows, { x0:0,y0:0,x1:3,y1:3 }, 1);
  ok(region[0] === 1, 'reassignRegion');

  console.log(`   structures=${names.length}; glitchΔ=${gd}; wif ok; roleGrid=${fp.spatial.roleGrid.data.length}`);
}

console.log('14. CA drafts, double-weave, authoring helpers, golden checksums');
{
  const ca = generateCaDraft({ W: 32, H: 24, rule: 90, structure: 'plain', seed: 1 });
  ok(ca.draft.length === 32*24, 'ca draft size');
  ok(ca.validity.ok, 'ca draft should validate after repair');
  const best = searchCaDrafts({ W: 24, H: 20, seed: 2 });
  ok(best && best.validity.ok, 'ca search should find valid candidate');
  const viaOp = runDraftOps({ W: 28, H: 20, ops: [{ op: 'caSeed', rule: 110 }], seed: 4 });
  ok(viaOp.validity.ok, 'caSeed op validity');

  const spec = resolveDesignSpec({}, defaultFingerprint(), { seed: 5, cols: 36, rows: 28 });
  spec.structurePlan.doubleWeave = true;
  const dw = materializeFromDesignSpec(spec, { seed: 5 });
  ok(dw.structure.layers?.length === 2, 'double weave layers');
  const face0 = dw.draft();
  dw.structure.face = 1;
  const face1 = dw.draft();
  ok(face1.face === 1, 'face switch');
  let faceDiff = 0;
  for (let i = 0; i < face0.draft.length; i++) if (face0.draft[i] !== face1.draft[i]) faceDiff++;
  ok(faceDiff > face0.draft.length * 0.01, 'faces should differ');

  const layered = buildLayeredDraft(
    dw.cells.idx, dw.geometry.cols, dw.geometry.rows,
    dw.palette.map(y => y.role), dw.structure.assign, null, 2
  );
  const picked = draftFromLayers(layered, 1);
  ok(picked.face === 1 && picked.draft.length > 0, 'draftFromLayers');

  const painted = paintBrush(dw.cells.idx, dw.geometry.cols, dw.geometry.rows, 4, 4, 2, 2);
  ok(painted[4 * dw.geometry.cols + 4] === 2, 'paintBrush center');

  const overrides = runDraftOps({
    W: face0.W, H: face0.H, draft: face0.draft,
    ops: [{ op: 'manualOverrides', cells: [{ x: 0, y: 0, v: face0.draft[0] ? 0 : 1 }] }],
    repair: true
  });
  ok(overrides.draft[0] !== face0.draft[0], 'manualOverrides flips cell');

  // golden weave checksums
  const goldPath = new URL('./golden/weave-checksums.json', import.meta.url);
  const gold = JSON.parse(readFileSync(goldPath));
  const gm = generateFromEnv({ seed: gold.model.seed, cols: gold.model.cols, rows: gold.model.rows });
  for (const mode of Object.keys(gold.checksums)){
    const out = renderWeave(gm, {
      mode, targetW: gold.targetW, tightness: gold.tightness,
      roughness: gold.roughness, seed: gold.seed
    });
    const hash = createHash('sha256').update(Buffer.from(out.data)).digest('hex').slice(0, 16);
    ok(hash === gold.checksums[mode], `golden ${mode}: got ${hash} want ${gold.checksums[mode]}`);
  }
  console.log(`   ca rule90 ok; facesΔ=${faceDiff}; goldens ${Object.keys(gold.checksums).length}`);
}

/* optional: real pasture photo if present — extra fidelity gate */
const PASTURE = '/tmp/fx/pasture.raw';
if (existsSync(PASTURE)){
  console.log('12. optional pasture photo fidelity');
  const buf = readFileSync(PASTURE);
  const w = buf.readUInt32LE(0), h = buf.readUInt32LE(4);
  const real = { w, h, data: new Uint8ClampedArray(buf.buffer, buf.byteOffset + 8, w*h*4) };
  const rm = buildModel(real, { k: 8 });
  const out = renderV2(rm, { targetW: 800 });
  const f = fidelity(real, out);
  ok(f.mean < 16, `pasture dE ${f.mean.toFixed(1)}`);
  ok(f.rows > 0.7, `pasture band r ${f.rows.toFixed(3)}`);
  const fp = fingerprintConfig(modelToConfig(rm, { name: 'pasture' }));
  const gen = generateFromEnv({ fingerprint: fp, seed: 8, cols: 80, rows: 60 });
  ok(gen.palette.length === 8, 'pasture-style gen k');
  console.log(`   pasture dE ${f.mean.toFixed(1)}, gen k=${gen.palette.length}`);
} else {
  console.log('12. optional pasture photo — skipped (no fixture)');
}

console.log(fails ? `\nX ${fails} failure(s)` : '\nOK all checks passed');
process.exit(fails ? 1 : 0);
