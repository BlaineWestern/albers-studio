/* Albers Studio server — zero dependencies. Serves the built app and API.
   Run: node server.js   → http://localhost:4571

   Tools (UI routes — SPA):
     /              home / tool picker
     /photo         image → textile transform tool
     /generate      env + rug style → generative textile tool

   API:
     POST /api/transform                    photograph RGBA → config (+ optional save)
     GET  /api/transform/defaults           transform schema
     GET/POST/DELETE /api/configs[/:id]     saved rug profiles
     GET  /api/configs/:id/fingerprint      style prior from a saved rug
     POST /api/fingerprint                  fingerprint an inline config body
     POST /api/generate                     env data + profile style → config
     GET  /api/generate/defaults
*/
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fingerprintConfig, blendFingerprints } from './src/pipeline/fingerprint.js';
import { generateFromEnv, defaultFingerprint, ENV_DEFAULTS } from './src/pipeline/generative.js';
import { transformImage, TRANSFORM_DEFAULTS } from './src/pipeline/transform.js';
import { modelToConfig } from './src/pipeline/config.js';
import { buildDraft } from './src/pipeline/structure.js';

const PORT = Number(process.env.PORT) || 4571;
const ROOT = new URL('./dist/', import.meta.url).pathname;
const db = new DatabaseSync(process.env.STUDIO_DB
  || new URL('./studio.db', import.meta.url).pathname);
db.exec(`CREATE TABLE IF NOT EXISTS configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created TEXT NOT NULL,
  cols INTEGER, rows INTEGER, yarns INTEGER,
  json TEXT NOT NULL
)`);

const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
               '.svg':'image/svg+xml', '.png':'image/png', '.json':'application/json' };
const SPA_PATHS = new Set(['/', '/photo', '/generate']);
const cors = res => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};
const json = (res, code, body) => {
  res.writeHead(code, {'Content-Type':'application/json'});
  res.end(JSON.stringify(body));
};
const readBody = req => new Promise((resolve, reject) => {
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    try { resolve(body ? JSON.parse(body) : {}); }
    catch (e){ reject(e); }
  });
  req.on('error', reject);
});

function loadConfigRow(id){
  const row = db.prepare('SELECT * FROM configs WHERE id = ?').get(+id);
  if (!row) return null;
  return { row, cfg: JSON.parse(row.json) };
}

function fingerprintsForIds(ids){
  const fps = [];
  for (const id of ids){
    const hit = loadConfigRow(id);
    if (!hit) throw Object.assign(new Error(`profile ${id} not found`), { status:404 });
    fps.push(fingerprintConfig(hit.cfg));
  }
  return fps;
}

function attachDraft(model){
  model.draft = () => buildDraft(
    model.cells.idx, model.geometry.cols, model.geometry.rows,
    model.palette.map(y => y.role), model.structure.assign, 2);
  return model;
}

function saveConfig(cfg){
  db.prepare('INSERT INTO configs (name, created, cols, rows, yarns, json) VALUES (?,?,?,?,?,?)')
    .run(cfg.meta?.name || 'untitled', cfg.meta?.created || new Date().toISOString(),
         cfg.gauge?.cols || 0, cfg.gauge?.rows || 0, cfg.yarns?.length || 0, JSON.stringify(cfg));
}

createServer(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS'){ res.writeHead(204); return res.end(); }
  const url = new URL(req.url, 'http://x');

  try {
    if (url.pathname === '/api/configs' && req.method === 'GET'){
      const rows = db.prepare(
        'SELECT id, name, created, cols, rows, yarns FROM configs ORDER BY id DESC').all();
      return json(res, 200, rows);
    }
    if (url.pathname === '/api/configs' && req.method === 'POST'){
      const cfg = await readBody(req);
      saveConfig(cfg);
      return json(res, 201, { ok:true });
    }

    // POST /api/transform — photograph → textile config
    // body: { image:{w,h,data:base64|number[]}, quad?, flatten?, k?, cols?, seed?, name?, save? }
    if (url.pathname === '/api/transform' && req.method === 'POST'){
      const body = await readBody(req);
      if (!body.image) return json(res, 400, { error: 'image payload required' });
      const result = transformImage({
        image: body.image,
        quad: body.quad,
        flatten: body.flatten,
        k: body.k,
        cols: body.cols,
        seed: body.seed,
        longSide: body.longSide,
        name: body.name,
        tp: body.tp
      });
      if (body.save) saveConfig(result.config);
      return json(res, 200, {
        config: result.config,
        transform: result.transform,
        flat: result.flat
      });
    }
    if (url.pathname === '/api/transform/defaults' && req.method === 'GET'){
      return json(res, 200, {
        tool: 'photo',
        route: '/photo',
        defaults: TRANSFORM_DEFAULTS,
        image: {
          w: 'pixels', h: 'pixels',
          data: 'base64 RGBA (w*h*4) or number[]',
          note: 'Client typically downscales max side ≤1500 before upload'
        },
        quad: 'optional [[x,y]×4] TL,TR,BR,BL — default inset 5%'
      });
    }

    if (url.pathname === '/api/fingerprint' && req.method === 'POST'){
      const body = await readBody(req);
      const fps = [];
      if (body.profileIds?.length) fps.push(...fingerprintsForIds(body.profileIds));
      if (body.config) fps.push(fingerprintConfig(body.config));
      if (body.schema === 'albers-studio/config@1') fps.push(fingerprintConfig(body));
      if (!fps.length) return json(res, 400, { error:'provide config and/or profileIds' });
      return json(res, 200, fps.length === 1 ? fps[0] : blendFingerprints(fps));
    }

    if (url.pathname === '/api/generate' && req.method === 'POST'){
      const body = await readBody(req);
      let fp = body.fingerprint || null;
      if (body.profileIds?.length){
        const fromProfiles = fingerprintsForIds(body.profileIds);
        fp = fp ? blendFingerprints([...fromProfiles, fp]) : blendFingerprints(fromProfiles);
      }
      const model = attachDraft(generateFromEnv({
        env: { ...ENV_DEFAULTS, ...(body.env || {}) },
        fingerprint: fp || defaultFingerprint(),
        seed: body.seed,
        cols: body.cols,
        rows: body.rows,
        tp: body.tp
      }));
      const cfg = modelToConfig(model, {
        name: body.name || `env-${model.generative.style}`,
        source: 'generative',
        env: model.generative.env,
        seed: model.generative.seed,
        style: model.generative.style
      });
      if (body.save) saveConfig(cfg);
      return json(res, 200, { config: cfg, generative: model.generative });
    }

    if (url.pathname === '/api/generate/defaults' && req.method === 'GET'){
      return json(res, 200, {
        tool: 'generate',
        route: '/generate',
        env: ENV_DEFAULTS,
        units: {
          temperature: '°C', humidity: '%', wind: 'm/s',
          precipitation: 'mm', light: '0–1 relative', season: '0–1 year phase'
        },
        fingerprint: defaultFingerprint()
      });
    }

    const fpMatch = url.pathname.match(/^\/api\/configs\/(\d+)\/fingerprint$/);
    if (fpMatch && req.method === 'GET'){
      const hit = loadConfigRow(fpMatch[1]);
      if (!hit) return json(res, 404, { error:'not found' });
      return json(res, 200, fingerprintConfig(hit.cfg));
    }

    const m = url.pathname.match(/^\/api\/configs\/(\d+)$/);
    if (m && req.method === 'GET'){
      const row = db.prepare('SELECT * FROM configs WHERE id = ?').get(+m[1]);
      return json(res, row ? 200 : 404, row || { error:'not found' });
    }
    if (m && req.method === 'DELETE'){
      db.prepare('DELETE FROM configs WHERE id = ?').run(+m[1]);
      return json(res, 200, { ok:true });
    }
  } catch (e){
    return json(res, e.status || 400, { error: e.message });
  }

  // static + SPA tool routes
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  if (SPA_PATHS.has(url.pathname)) p = '/index.html';
  const file = join(ROOT, p);
  if (existsSync(file)){
    res.writeHead(200, {'Content-Type': MIME[extname(file)] || 'application/octet-stream'});
    return res.end(readFileSync(file));
  }
  res.writeHead(404); res.end('not found');
}).listen(PORT, () => console.log(`Albers Studio → http://localhost:${PORT}`));
