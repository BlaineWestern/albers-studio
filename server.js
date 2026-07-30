/* Albers Studio server — zero dependencies. Serves the built app and a tiny
   SQLite API using Node's built-in node:sqlite (Node 22+).
   Run: node server.js   → http://localhost:4571                            */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const PORT = 4571;
const ROOT = new URL('./dist/', import.meta.url).pathname;
// STUDIO_DB overrides the location (useful when the app folder is on a
// network mount, where SQLite's file locking is unsupported).
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
const cors = res => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};

createServer((req, res) => {
  cors(res);
  if (req.method === 'OPTIONS'){ res.writeHead(204); return res.end(); }
  const url = new URL(req.url, 'http://x');

  if (url.pathname === '/api/configs' && req.method === 'GET'){
    const rows = db.prepare(
      'SELECT id, name, created, cols, rows, yarns FROM configs ORDER BY id DESC').all();
    res.writeHead(200, {'Content-Type':'application/json'});
    return res.end(JSON.stringify(rows));
  }
  if (url.pathname === '/api/configs' && req.method === 'POST'){
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const cfg = JSON.parse(body);
        db.prepare('INSERT INTO configs (name, created, cols, rows, yarns, json) VALUES (?,?,?,?,?,?)')
          .run(cfg.meta?.name || 'untitled', cfg.meta?.created || new Date().toISOString(),
               cfg.gauge?.cols || 0, cfg.gauge?.rows || 0, cfg.yarns?.length || 0, body);
        res.writeHead(201, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ ok:true }));
      } catch (e){ res.writeHead(400); res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }
  const m = url.pathname.match(/^\/api\/configs\/(\d+)$/);
  if (m && req.method === 'GET'){
    const row = db.prepare('SELECT * FROM configs WHERE id = ?').get(+m[1]);
    res.writeHead(row ? 200 : 404, {'Content-Type':'application/json'});
    return res.end(JSON.stringify(row || { error:'not found' }));
  }
  if (m && req.method === 'DELETE'){
    db.prepare('DELETE FROM configs WHERE id = ?').run(+m[1]);
    res.writeHead(200, {'Content-Type':'application/json'});
    return res.end(JSON.stringify({ ok:true }));
  }

  // static
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = join(ROOT, p);
  if (existsSync(file)){
    res.writeHead(200, {'Content-Type': MIME[extname(file)] || 'application/octet-stream'});
    return res.end(readFileSync(file));
  }
  res.writeHead(404); res.end('not found');
}).listen(PORT, () => console.log(`Albers Studio → http://localhost:${PORT}`));
