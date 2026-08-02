/* HTTP API integration — spins the real server against a throwaway SQLite DB
   on an isolated port. Run: node test/api.mjs */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { unlinkSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4599;
const DB = `/tmp/albers-api-test-${process.pid}.db`;
const BASE = `http://127.0.0.1:${PORT}`;

let fails = 0;
const ok = (c, m) => { if (!c){ console.log('  FAIL', m); fails++; } };

async function req(method, path, body){
  const r = await fetch(BASE + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* raw */ }
  return { status: r.status, json, text };
}

function scrubDb(){
  for (const f of [DB, DB+'-wal', DB+'-shm', DB+'-journal'])
    if (existsSync(f)) try { unlinkSync(f); } catch { /* */ }
}

async function withServer(fn){
  scrubDb();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, STUDIO_DB: DB, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let ready = false, err = '', out = '';
  child.stderr.on('data', d => { err += d; });
  child.stdout.on('data', d => {
    out += d;
    if (String(d).includes('Albers Studio')) ready = true;
  });

  const deadline = Date.now() + 8000;
  while (!ready && Date.now() < deadline){
    if (child.exitCode != null) throw new Error('server died: '+err+out);
    await sleep(40);
  }
  if (!ready){
    child.kill('SIGKILL');
    throw new Error('server start timeout: '+err+out);
  }
  // brief settle for listen()
  await sleep(60);
  try { return await fn(); }
  finally {
    child.kill('SIGTERM');
    await sleep(120);
    if (child.exitCode == null) child.kill('SIGKILL');
    scrubDb();
  }
}

console.log('API · defaults');
await withServer(async () => {
  const r = await req('GET', '/api/generate/defaults');
  ok(r.status === 200, 'defaults status '+r.status);
  ok(r.json.env?.temperature != null, 'defaults env');
  ok(r.json.fingerprint?.schema === 'albers-studio/fingerprint@1', 'defaults fp schema');

  console.log('API · generate (default style)');
  const g = await req('POST', '/api/generate', {
    env: { temperature: 12, humidity: 60, wind: 4, precipitation: 2, light: 0.4, season: 0.3 },
    seed: 41, cols: 56, rows: 40, name: 'api-gen', save: true
  });
  ok(g.status === 200, 'generate status '+g.status);
  ok(g.json.config?.schema === 'albers-studio/config@1', 'generate config schema');
  ok(g.json.config.gauge.cols === 56 && g.json.config.gauge.rows === 40, 'generate gauge');
  ok(g.json.config.yarns?.length >= 3, 'generate yarns');
  ok(g.json.config.ground != null, 'generate ground');
  ok(g.json.generative?.seed === 41, 'generate seed stamp');
  ok(Array.isArray(g.json.config.cells) && g.json.config.cells.length > 0, 'generate RLE cells');
  const gShare = g.json.config.yarns[g.json.config.ground]?.share ?? 0;
  ok(gShare > 0.2, 'api generate ground starved: '+gShare);

  console.log('API · list / fingerprint / style-steer');
  const list = await req('GET', '/api/configs');
  ok(list.status === 200 && list.json.length >= 1, 'list profiles');
  const id = list.json[0].id;

  const fp = await req('GET', `/api/configs/${id}/fingerprint`);
  ok(fp.status === 200, 'fingerprint status');
  ok(fp.json.schema === 'albers-studio/fingerprint@1', 'fp schema');
  ok(fp.json.spatial.groundShare > 0.15, 'fp groundShare '+fp.json.spatial.groundShare);
  ok(fp.json.yarns.k === g.json.config.yarns.length, 'fp yarn k');

  const steered = await req('POST', '/api/generate', {
    env: { temperature: -3, precipitation: 30, wind: 15 },
    profileIds: [id], seed: 7, cols: 48, rows: 36
  });
  ok(steered.status === 200, 'steered generate');
  ok(steered.json.generative.style === 'api-gen', 'style from profile: '+steered.json.generative.style);

  console.log('API · POST /api/fingerprint blend + errors');
  const blend = await req('POST', '/api/fingerprint', { profileIds: [id], config: g.json.config });
  ok(blend.status === 200, 'blend fingerprint');
  ok(blend.json.yarns.k >= 2, 'blend k');

  const bad = await req('POST', '/api/fingerprint', {});
  ok(bad.status === 400, 'empty fingerprint should 400');

  const missing = await req('POST', '/api/generate', { profileIds: [99999] });
  ok(missing.status === 404, 'missing profile should 404, got '+missing.status);

  const none = await req('GET', '/api/configs/99999/fingerprint');
  ok(none.status === 404, 'missing fingerprint 404');

  console.log('API · get / delete profile');
  const one = await req('GET', `/api/configs/${id}`);
  ok(one.status === 200 && one.json.json, 'get profile json');
  const del = await req('DELETE', `/api/configs/${id}`);
  ok(del.status === 200, 'delete');
  const gone = await req('GET', `/api/configs/${id}`);
  ok(gone.status === 404, 'deleted profile gone');

  console.log('API · determinism across requests');
  const a = await req('POST', '/api/generate', {
    env: { temperature: 20 }, seed: 123, cols: 40, rows: 30
  });
  const b = await req('POST', '/api/generate', {
    env: { temperature: 20 }, seed: 123, cols: 40, rows: 30
  });
  ok(JSON.stringify(a.json.config.cells) === JSON.stringify(b.json.config.cells),
     'API generate not deterministic');
  ok(JSON.stringify(a.json.config.yarns.map(y => y.lab)) ===
     JSON.stringify(b.json.config.yarns.map(y => y.lab)),
     'API palette not deterministic');

  console.log('API · transform (image → textile)');
  // tiny 8x8 RGBA cloth
  const w = 32, h = 24;
  const rgba = Buffer.alloc(w*h*4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const o = (y*w+x)*4;
    const yarn = ((x>>2)+(y>>2)) & 3;
    const c = [[60,70,40],[140,120,70],[50,50,40],[200,90,50]][yarn];
    rgba[o]=c[0]; rgba[o+1]=c[1]; rgba[o+2]=c[2]; rgba[o+3]=255;
  }
  const tr = await req('POST', '/api/transform', {
    image: { w, h, data: rgba.toString('base64') },
    mode: 'poster', flatten: true, k: 4, cols: 40, name: 'api-photo', save: true
  });
  ok(tr.status === 200, 'transform status '+tr.status);
  ok(tr.json.config?.schema === 'albers-studio/config@1', 'transform config');
  ok(tr.json.transform?.schema === 'albers-studio/transform@1', 'transform stamp');
  ok(tr.json.transform?.mode === 'poster', 'transform photo mode');
  ok(tr.json.config.gauge.cols === 40, 'transform cols');
  ok(tr.json.config.yarns?.length >= 3, 'transform yarns');
  ok(tr.json.config.meta?.source === 'transform', 'transform meta source');

  const td = await req('GET', '/api/transform/defaults');
  ok(td.status === 200 && td.json.tool === 'photo', 'transform defaults');
  ok(td.json.route === '/photo', 'transform route documented');
  ok(td.json.photoModes?.faithful && td.json.photoModes?.document, 'photoModes documented');
  ok(td.json.construction?.includes('constructTapestry'), 'shared construction noted');

  const badTr = await req('POST', '/api/transform', {});
  ok(badTr.status === 400, 'transform without image should 400');

  console.log('API · extreme env clamps cleanly');
  const extreme = await req('POST', '/api/generate', {
    env: { temperature: 999, humidity: -50, wind: 1000, precipitation: -1, light: 5, season: -2 },
    seed: 1, cols: 32, rows: 24
  });
  ok(extreme.status === 200, 'extreme env status');
  ok(extreme.json.config.yarns.every(y => y.rgb.every(c => c >= 0 && c <= 255)),
     'extreme env produced invalid rgb');

  console.log('API · designSpec rematerialize + WIF');
  const specBody = a.json.generative?.designSpec || {
    gauge: { cols: 40, rows: 30, wefted: 0.86 },
    palettePlan: { labs:[[0.4,0,0],[0.6,0,0]], roles:['ground','field'], shares:[0.6,0.4] },
    structurePlan: { ground:'plain', field:'twill', supplementary:'weft5', ops:[{op:'glitch',density:0.03}] },
    densityPlan: { markBoost:1, fieldBoost:1, disorder:0.3, vertBias:0.3, meanRun:3, minGround:0.45, maxFloat:8 },
    appearancePlan: { tightness:0.8, roughness:0.3, mode:'tile' },
    seed: 99
  };
  const rem = await req('POST', '/api/generate', { designSpec: specBody, seed: 99, name: 'spec-api' });
  ok(rem.status === 200, 'designSpec generate status '+rem.status);
  ok(rem.json.generative?.designSpec?.structurePlan, 'designSpec echoed');
  ok(rem.json.config.meta?.provenance?.designSpec, 'provenance on config');

  const defs = await req('GET', '/api/generate/defaults');
  ok(defs.json.structures?.length >= 10, 'defaults list structures');

  const draftBits = new Array(16).fill(0).map((_,i) => i % 2);
  const wifExp = await req('POST', '/api/export/wif', { draft: draftBits, W: 4, H: 4, meta:{ name:'t' } });
  ok(wifExp.status === 200 && wifExp.json.wif.includes('ALBERS DRAFT'), 'export wif');
  const wifImp = await req('POST', '/api/import/wif', { wif: wifExp.json.wif });
  ok(wifImp.status === 200 && wifImp.json.W === 4, 'import wif');
});

console.log(fails ? `\nX ${fails} API failure(s)` : '\nOK api checks passed');
process.exit(fails ? 1 : 0);
