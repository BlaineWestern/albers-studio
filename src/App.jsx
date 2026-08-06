import React, { useState, useRef, useEffect, useCallback } from 'react';
import { warpQuad, quadAspect } from './pipeline/geometry.js';
import { buildModel } from './pipeline/model.js';
import { modelToConfig, configToModel } from './pipeline/config.js';
import { fidelity } from './pipeline/analyze.js';
import { renderV1 } from './pipeline/render/v1.js';
import { renderV12 } from './pipeline/render/v12.js';
import { renderV2, renderDraftImage } from './pipeline/render/v2.js';
import { modelToSvg } from './pipeline/svg.js';
import { generateFromEnv, ENV_DEFAULTS, defaultFingerprint } from './pipeline/generative.js';
import { buildDraft } from './pipeline/structure.js';

const RENDERERS = {
  'V1':   { fn: renderV1,  note: 'archived — fat-cell original' },
  'V1.2': { fn: renderV12, note: 'archived — two-scale floats' },
  'V2':   { fn: renderV2,  note: 'draft-based (jacquard-style)' },
};
const API = 'http://localhost:4571/api';

const ENV_FIELDS = [
  { key:'temperature',   label:'Temp °C',   min:-5, max:35,  step:0.5 },
  { key:'humidity',      label:'Humidity %', min:0,  max:100, step:1 },
  { key:'wind',          label:'Wind m/s',  min:0,  max:20,  step:0.5 },
  { key:'precipitation', label:'Precip mm', min:0,  max:40,  step:0.5 },
  { key:'light',         label:'Light',     min:0,  max:1,   step:0.05 },
  { key:'season',        label:'Season',    min:0,  max:1,   step:0.05 },
];

function attachDraft(m){
  m.draft = () => buildDraft(m.cells.idx, m.geometry.cols, m.geometry.rows,
    m.palette.map(y => y.role), m.structure.assign, 2);
  return m;
}

const imgToCanvas = (img, cvs) => {
  cvs.width = img.w; cvs.height = img.h;
  const c = cvs.getContext('2d');
  const d = c.createImageData(img.w, img.h);
  d.data.set(img.data);
  c.putImageData(d, 0, 0);
};

export default function App(){
  const [mode, setMode] = useState('photo'); // photo | generate
  const [src, setSrc] = useState(null);
  const [quad, setQuad] = useState(null);
  const [flat, setFlat] = useState(null);
  const [model, setModel] = useState(null);
  const [version, setVersion] = useState('V2');
  const [k, setK] = useState(6);
  const [cols, setCols] = useState(0);       // 0 = auto from pitch
  const [fid, setFid] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [dbUp, setDbUp] = useState(false);
  const [busy, setBusy] = useState('');
  const [status, setStatus] = useState({ text: '', tone: 'ok' });
  const [profileName, setProfileName] = useState('untitled tapestry');
  const [env, setEnv] = useState({ ...ENV_DEFAULTS });
  const [styleIds, setStyleIds] = useState([]);
  const [genSeed, setGenSeed] = useState(42);
  const [genInfo, setGenInfo] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const srcCvs = useRef(), outCvs = useRef(), outBox = useRef(), fileRef = useRef();
  const drag = useRef(-1);

  const announce = (text, tone = 'ok') => setStatus({ text, tone });

  /* ── data in ── */
  const loadFile = f => {
    if (!f) return;
    if (!f.type.startsWith('image/')){
      announce('Choose an image file (PNG, JPEG, WebP…).', 'err');
      return;
    }
    const url = URL.createObjectURL(f);
    const im = new Image();
    im.onload = () => {
      const s = Math.min(1, 1500/Math.max(im.width, im.height));
      const w = Math.round(im.width*s), h = Math.round(im.height*s);
      const t = document.createElement('canvas'); t.width=w; t.height=h;
      const tc = t.getContext('2d'); tc.drawImage(im,0,0,w,h);
      const d = tc.getImageData(0,0,w,h);
      setSrc({ w, h, data:new Uint8ClampedArray(d.data) });
      const mx=w*0.05, my=h*0.05;
      setQuad([[mx,my],[w-mx,my],[w-mx,h-my],[mx,h-my]]);
      setFlat(null); setModel(null); setFid(null);
      announce('Drag the four corners to the cloth edges, then Flatten.', 'ok');
      URL.revokeObjectURL(url);
    };
    im.onerror = () => announce('Could not read that image.', 'err');
    im.src = url;
  };

  /* ── corner editor ── */
  useEffect(() => {
    if (!src || !srcCvs.current) return;
    const cvs = srcCvs.current;
    imgToCanvas(src, cvs);
    const c = cvs.getContext('2d');
    c.fillStyle='rgba(20,18,15,.5)';
    c.beginPath(); c.rect(0,0,src.w,src.h);
    c.moveTo(quad[0][0],quad[0][1]);
    for (let i=3;i>=1;i--) c.lineTo(quad[i][0],quad[i][1]);
    c.closePath(); c.fill('evenodd');
    c.strokeStyle='#ece3cd'; c.lineWidth=Math.max(1.5,src.w/560);
    c.beginPath(); c.moveTo(quad[0][0],quad[0][1]);
    for (let i=1;i<4;i++) c.lineTo(quad[i][0],quad[i][1]);
    c.closePath(); c.stroke();
    const r = Math.max(6, src.w/110);
    quad.forEach(([x,y]) => { c.beginPath(); c.arc(x,y,r,0,7);
      c.fillStyle='#ece3cd'; c.fill(); c.strokeStyle='#1c1a17'; c.stroke(); });
  }, [src, quad]);

  const toImg = e => {
    const b = srcCvs.current.getBoundingClientRect();
    return [(e.clientX-b.left)*(srcCvs.current.width/b.width),
            (e.clientY-b.top)*(srcCvs.current.height/b.height)];
  };

  /* ── pipeline ── */
  const doFlatten = () => {
    const ar = quadAspect(quad);
    const long = 1100;
    const w = ar>=1?long:Math.round(long*ar), h = ar>=1?Math.round(long/ar):long;
    setFlat(warpQuad(src, quad, w, h));
    setModel(null); setFid(null);
    announce('Cloth flattened. Set yarns/threads if you like, then Process.', 'ok');
  };

  const doProcess = useCallback(() => {
    if (!flat) return;
    setBusy('weaving…');
    announce('Weaving model…', 'ok');
    setTimeout(() => {
      const m = buildModel(flat, { k, cols: cols || undefined });
      setModel(m);
      setBusy('');
      announce('Model ready — tapestry updates on the right.', 'ok');
    }, 20);
  }, [flat, k, cols]);

  /* ── responsive render: re-render when the container resizes ── */
  const render = useCallback(() => {
    if (!model || !outCvs.current || !outBox.current) return;
    const wpx = Math.max(200, outBox.current.getBoundingClientRect().width - 4);
    const out = RENDERERS[version].fn(model, { targetW: wpx });
    imgToCanvas(out, outCvs.current);
    if (flat) setFid(fidelity(flat, out));
  }, [model, version, flat]);

  useEffect(render, [render]);
  useEffect(() => {
    if (!outBox.current) return;
    const ro = new ResizeObserver(() => render());
    ro.observe(outBox.current);
    return () => ro.disconnect();
  }, [render]);

  /* ── profiles (SQLite via local server) ── */
  const refresh = useCallback(async () => {
    try { const r = await fetch(API+'/configs'); setProfiles(await r.json()); setDbUp(true); }
    catch { setDbUp(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (!dbUp && styleIds.length) setStyleIds([]);
  }, [dbUp, styleIds.length]);

  const saveProfile = async () => {
    const name = (profileName || '').trim() || 'untitled tapestry';
    const cfg = modelToConfig(model, { name, renderer: version });
    try {
      await fetch(API+'/configs', { method:'POST',
        headers:{'Content-Type':'application/json'}, body: JSON.stringify(cfg) });
      refresh();
      announce(`Saved profile “${name}” to the studio database.`, 'ok');
    } catch {
      const a = document.createElement('a');
      a.download = name.replace(/\W+/g,'-')+'.json';
      a.href = 'data:application/json,'+encodeURIComponent(JSON.stringify(cfg));
      a.click();
      announce(`Database offline — downloaded “${name}.json” instead.`, 'warn');
    }
  };
  const loadProfile = async (id) => {
    const r = await fetch(`${API}/configs/${id}`);
    const cfg = await r.json();
    const m = attachDraft(configToModel(cfg.json ? JSON.parse(cfg.json) : cfg));
    setModel(m); setFlat(null); setFid(null); setGenInfo(null);
    announce('Loaded profile into tapestry stage.', 'ok');
  };

  const toggleStyle = (id) => {
    if (!dbUp) return;
    setStyleIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
  };

  const doGenerate = async () => {
    setBusy('generating…');
    announce('Generating tapestry from environment + style…', 'ok');
    try {
      let m, info;
      if (dbUp){
        const r = await fetch(API+'/generate', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({
            env, profileIds: styleIds, seed: genSeed,
            cols: cols || undefined, name: 'env tapestry'
          })
        });
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || 'generate failed');
        m = attachDraft(configToModel(body.config));
        info = body.generative;
      } else {
        if (styleIds.length)
          announce('Database offline — rug styles unavailable; using default style.', 'warn');
        const fp = defaultFingerprint();
        m = generateFromEnv({ env, fingerprint: fp, seed: genSeed, cols: cols || undefined });
        info = m.generative;
      }
      setModel(m); setFlat(null); setFid(null); setGenInfo(info);
      announce('Generative tapestry ready.', 'ok');
    } catch (e){
      setBusy('');
      announce(e.message || 'Generate failed.', 'err');
      return;
    }
    setBusy('');
  };

  /* ── exports ── */
  const dl = (name, href) => { const a=document.createElement('a'); a.download=name; a.href=href; a.click(); };
  const savePng = () => dl('tapestry-'+version+'.png', outCvs.current.toDataURL('image/png'));
  const saveSvg = () => dl('tapestry-layers.svg',
    'data:image/svg+xml,'+encodeURIComponent(modelToSvg(model)));
  const saveDraft = () => {
    const img = renderDraftImage(model);
    const t = document.createElement('canvas');
    imgToCanvas(img, t);
    dl('draft.png', t.toDataURL('image/png'));
  };

  const yarnBar = model && (
    <div className="swatches" role="img" aria-label="Yarn share swatches">
      {model.palette.map((y,i) =>
        <i key={i} style={{background:`rgb(${y.rgb})`, flex:Math.max(0.05,y.share)}}
           title={`${y.role} · ${(y.share*100).toFixed(1)}%`}/>)}
    </div>);

  const threadsLabel = cols > 0 ? String(cols) : 'Auto';
  const photoHint = !src
    ? 'Open or drop a photograph of cloth. Next you will mark the four corners.'
    : !flat
      ? 'Drag the corner handles onto the cloth edges, then Flatten to straighten the weave.'
      : 'Flattened cloth is ready. Adjust yarns if needed, then Process.';
  const modelHint = !flat
    ? 'Appears after Flatten — the rectified cloth used to build the weave model.'
    : !model
      ? 'Ready to weave. Process builds the yarn model and tapestry.'
      : null;
  const genEmptyHint = !dbUp
    ? { title: 'Database offline', body: 'Start the studio server to load rug profiles, or Generate with the default style.' }
    : { title: 'No saved rugs yet', body: 'In Photo mode, weave a tapestry and Save profile — then select it here as a style prior.' };

  return (
    <div className="app">
      <header>
        <div className="brand">
          <h1>Albers Studio</h1>
          <p className="sub">{mode === 'photo'
            ? 'Photograph → layered weave model → tapestry'
            : 'Environment + rug style → generative tapestry'}</p>
        </div>
        <div className="header-controls">
          <div className="vtoggle modes" role="group" aria-label="Studio mode">
            <button type="button" className={mode==='photo'?'on':''}
                    aria-pressed={mode==='photo'}
                    onClick={()=>setMode('photo')}>Photo</button>
            <button type="button" className={mode==='generate'?'on':''}
                    aria-pressed={mode==='generate'}
                    onClick={()=>setMode('generate')}>Generate</button>
          </div>
        </div>
      </header>

      <div className="vmeta">
        <div className="vnote">
          Renderer <strong>{version}</strong>
          {version === 'V2' ? ' · draft-based (jacquard-style)' : ` · ${RENDERERS[version].note}`}
          <span className={'db'+(dbUp?'':' warn')}>
            {dbUp ? ' · database connected' : ' · database offline — saves download as JSON'}
          </span>
        </div>
        <details className="adv-render" open={showArchived || version !== 'V2'}
                 onToggle={e=>setShowArchived(e.target.open)}>
          <summary>Archived renderers</summary>
          <div className="vtoggle" role="group" aria-label="Renderer version">
            {Object.keys(RENDERERS).map(v =>
              <button type="button" key={v} className={v===version?'on':''}
                      aria-pressed={v===version}
                      onClick={()=>setVersion(v)}>{v}</button>)}
          </div>
        </details>
      </div>

      <div className="status" role="status" aria-live="polite" data-tone={status.tone || 'ok'}>
        {busy || status.text || '\u00a0'}
      </div>

      <div className="cols3">
        {mode === 'photo' ? (
          <section aria-labelledby="step-source">
            <h2 id="step-source" className="plabel">1 · Source & corners</h2>
            <p className="step-hint">{photoHint}</p>
            <div className={'stage'+(src?'':'')}
                 role={src ? undefined : 'button'}
                 tabIndex={src ? undefined : 0}
                 aria-label={src ? undefined : 'Open image'}
                 onClick={e=>{ if(!src) fileRef.current.click(); }}
                 onKeyDown={e=>{ if(!src && (e.key==='Enter'||e.key===' ')){ e.preventDefault(); fileRef.current.click(); }}}
                 onDragOver={e=>e.preventDefault()}
                 onDrop={e=>{e.preventDefault(); loadFile(e.dataTransfer.files[0]);}}>
              {!src && <div className="stage-empty">
                <strong>Drop an image</strong>
                <span>or use Open image — then drag corners to the cloth</span>
              </div>}
              {src && <canvas ref={srcCvs} className="edit" aria-label="Source with corner handles"/>}
            </div>
            <div className="bar">
              <input ref={fileRef} type="file" accept="image/*" style={{display:'none'}}
                     onChange={e=>loadFile(e.target.files[0])}/>
              <button type="button" onClick={()=>fileRef.current.click()}>Open image</button>
              <button type="button" className={src && !flat ? 'primary' : ''}
                      disabled={!src} onClick={doFlatten}
                      title="Warp the photo so the marked rectangle becomes flat cloth">
                Flatten
              </button>
            </div>
          </section>
        ) : (
          <section aria-labelledby="step-env">
            <h2 id="step-env" className="plabel">1 · Environment</h2>
            <p className="step-hint">
              Climate readings tint palette and density. Start with defaults, then nudge.
            </p>
            <div className="stage env-panel">
              {ENV_FIELDS.map(f =>
                <label key={f.key} className="env-row">
                  <span>{f.label}</span>
                  <input type="range" min={f.min} max={f.max} step={f.step}
                         value={env[f.key]}
                         aria-valuetext={String(env[f.key])}
                         onChange={e=>setEnv(v => ({...v, [f.key]:+e.target.value}))}/>
                  <em>{Number(env[f.key]).toFixed(f.step < 1 ? 2 : 0)}</em>
                </label>)}
            </div>
            <div className="bar">
              <label>Seed <input type="number" min="0" max="999999" value={genSeed}
                     aria-label="Generation seed"
                     onChange={e=>setGenSeed(+e.target.value||0)}/></label>
              <button type="button" onClick={()=>setEnv({...ENV_DEFAULTS})}>Reset env</button>
            </div>
          </section>
        )}

        <section aria-labelledby="step-model">
          <h2 id="step-model" className="plabel">
            {mode === 'photo' ? '2 · Model' : '2 · Style from rugs'}
          </h2>
          {mode === 'photo' ? (
            <>
              {modelHint && <p className="step-hint">{modelHint}</p>}
              <div className="stage">
                {!flat && <div className="stage-empty">
                  <strong>Waiting for Flatten</strong>
                  <span>Rectified cloth appears here after step 1</span>
                </div>}
                {flat && <canvas className="view" ref={c=>{ if(c) imgToCanvas(flat,c); }}
                                 aria-label="Flattened cloth"/>}
              </div>
              <div className="bar">
                <label>Yarns <input type="range" min="2" max="10" value={k}
                       aria-valuetext={`${k} yarns`}
                       onChange={e=>setK(+e.target.value)}/> {k}</label>
                <label>Threads
                  <input type="number" min="0" max="300" value={cols}
                         aria-label="Thread count; 0 means auto from pitch"
                         onChange={e=>setCols(+e.target.value)}/>
                  <span className="threads-val">{threadsLabel}</span>
                </label>
                <button type="button" className={flat && !model ? 'primary' : ''}
                        disabled={!flat} onClick={doProcess}>
                  {busy==='weaving…' ? busy : 'Process'}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="stage">
                {profiles.length === 0 && <div className="stage-empty">
                  <strong>{genEmptyHint.title}</strong>
                  <span>{genEmptyHint.body}</span>
                </div>}
                {profiles.length > 0 && <div className="style-list">
                  {!dbUp
                    ? <p className="hint warn">Database offline — rug styles cannot steer Generate.
                        Start the server, or continue with the built-in default style.</p>
                    : <p className="hint">Select saved rugs to steer gauge, palette, and floats.
                        None selected → built-in default style.</p>}
                  {profiles.map(p =>
                    <label key={p.id}
                           className={'style-item'
                             +(styleIds.includes(p.id)?' on':'')
                             +(!dbUp?' disabled':'')}>
                      <input type="checkbox" checked={styleIds.includes(p.id)}
                             disabled={!dbUp}
                             onChange={()=>toggleStyle(p.id)}/>
                      <span>{p.name}</span>
                      <em>{p.cols}×{p.rows} · {p.yarns}y</em>
                      <button type="button" className="tiny" disabled={!dbUp}
                              title="Load this profile into the tapestry stage"
                              onClick={e=>{e.preventDefault(); loadProfile(p.id);}}>
                        Open
                      </button>
                    </label>)}
                </div>}
              </div>
              <div className="bar">
                <label>Threads
                  <input type="number" min="0" max="300" value={cols}
                         aria-label="Thread count; 0 means fingerprint gauge"
                         onChange={e=>setCols(+e.target.value)}/>
                  <span className="threads-val">{threadsLabel}</span>
                </label>
                <button type="button" className="primary" onClick={doGenerate}>
                  {busy==='generating…' ? busy : 'Generate'}
                </button>
              </div>
            </>
          )}
          {model && <div className="readout">
            {genInfo
              ? <>generative · style {genInfo.style} · seed {genInfo.seed}<br/></>
              : model.geometry.pitch.confX >= 0.04
                ? <>measured pitch {model.geometry.pitch.pitchX.toFixed(1)}px → {model.geometry.cols} threads<br/></>
                : <>{mode==='photo' ? 'no confident pitch — ' : ''}{model.geometry.cols} threads<br/></>}
            {model.geometry.cols}×{model.geometry.rows} · weft/warp {model.geometry.wefted.toFixed(2)}
            {yarnBar}
            {model.palette.map((y,i) =>
              <div key={i} className="yline">
                <i style={{background:`rgb(${y.rgb})`}} aria-hidden="true"/> {y.role} · {(y.share*100).toFixed(1)}%
                {model.structure.floats[i] && <> · floats {model.structure.floats[i].mean.toFixed(1)}/{model.structure.floats[i].max}</>}
              </div>)}
          </div>}
        </section>

        <section className="exports" aria-labelledby="step-tapestry">
          <h2 id="step-tapestry" className="plabel">3 · Tapestry — {version}</h2>
          <p className="step-hint">
            {model ? 'Export the weave or save a reusable profile.' : 'The finished tapestry appears here after Process or Generate.'}
          </p>
          <div ref={outBox} className="stage grow">
            {!model && <div className="stage-empty">
              <strong>No tapestry yet</strong>
              <span>Complete steps 1–2 to weave</span>
            </div>}
            {model && <canvas ref={outCvs} className="view" aria-label="Rendered tapestry"/>}
          </div>
          <div className="bar">
            <div className="save-row">
              <label className="save-row">
                Profile name
                <input type="text" value={profileName}
                       disabled={!model}
                       onChange={e=>setProfileName(e.target.value)}
                       aria-label="Profile name"/>
              </label>
              <button type="button" className="primary" disabled={!model} onClick={saveProfile}>
                Save profile
              </button>
            </div>
            <button type="button" disabled={!model} onClick={savePng}>PNG</button>
            <button type="button" disabled={!model} onClick={saveSvg}>SVG</button>
            <button type="button" disabled={!model || !model.draft} onClick={saveDraft}
                    title={!model?.draft ? 'Draft export needs a draft-capable model' : 'Export lift draft'}>
              Draft
            </button>
          </div>
          {fid && <div className="readout">
            fidelity: mean dE {fid.mean.toFixed(1)} · band r {fid.rows.toFixed(3)}
          </div>}
          {profiles.length > 0 && mode === 'photo' && <div className="readout">
            <b>Saved profiles</b>
            {profiles.map(p =>
              <div key={p.id} className="yline">
                <button type="button" className="tiny" onClick={()=>loadProfile(p.id)}>Open</button>
                &nbsp;{p.name} · {p.cols}×{p.rows} · {p.yarns} yarns
              </div>)}
          </div>}
        </section>
      </div>
    </div>
  );
}
