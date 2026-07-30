import React, { useState, useRef, useEffect, useCallback } from 'react';
import { newImg, sampleBilinear } from './pipeline/core.js';
import { warpQuad, quadAspect } from './pipeline/geometry.js';
import { buildModel } from './pipeline/model.js';
import { modelToConfig, configToModel } from './pipeline/config.js';
import { fidelity } from './pipeline/analyze.js';
import { renderV1 } from './pipeline/render/v1.js';
import { renderV12 } from './pipeline/render/v12.js';
import { renderV2, renderDraftImage } from './pipeline/render/v2.js';
import { modelToSvg } from './pipeline/svg.js';

const RENDERERS = {
  'V1':   { fn: renderV1,  note: 'archived — fat-cell original' },
  'V1.2': { fn: renderV12, note: 'archived — two-scale floats' },
  'V2':   { fn: renderV2,  note: 'draft-based (jacquard-style)' },
};
const API = 'http://localhost:4571/api';

const imgToCanvas = (img, cvs) => {
  cvs.width = img.w; cvs.height = img.h;
  const c = cvs.getContext('2d');
  const d = c.createImageData(img.w, img.h);
  d.data.set(img.data);
  c.putImageData(d, 0, 0);
};

export default function App(){
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
  const srcCvs = useRef(), outCvs = useRef(), outBox = useRef(), fileRef = useRef();
  const drag = useRef(-1);

  /* ── data in ── */
  const loadFile = f => {
    if (!f || !f.type.startsWith('image/')) return;
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
      URL.revokeObjectURL(url);
    };
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
  };

  const doProcess = useCallback(() => {
    if (!flat) return;
    setBusy('weaving…');
    setTimeout(() => {
      const m = buildModel(flat, { k, cols: cols || undefined });
      setModel(m);
      setBusy('');
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

  const saveProfile = async () => {
    const name = prompt('Profile name?', 'untitled tapestry');
    if (!name) return;
    const cfg = modelToConfig(model, { name, renderer: version });
    try {
      await fetch(API+'/configs', { method:'POST',
        headers:{'Content-Type':'application/json'}, body: JSON.stringify(cfg) });
      refresh();
    } catch {
      // server down: fall back to a JSON download so nothing is lost
      const a = document.createElement('a');
      a.download = name.replace(/\W+/g,'-')+'.json';
      a.href = 'data:application/json,'+encodeURIComponent(JSON.stringify(cfg));
      a.click();
    }
  };
  const loadProfile = async (id) => {
    const r = await fetch(`${API}/configs/${id}`);
    const cfg = await r.json();
    const m = configToModel(cfg.json ? JSON.parse(cfg.json) : cfg);
    // reattach draft builder for V2
    import('./pipeline/structure.js').then(({ buildDraft }) => {
      m.draft = () => buildDraft(m.cells.idx, m.geometry.cols, m.geometry.rows,
        m.palette.map(y=>y.role), m.structure.assign, 2);
      setModel(m); setFlat(null); setFid(null);
    });
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
    <div className="swatches">{model.palette.map((y,i) =>
      <i key={i} style={{background:`rgb(${y.rgb})`, flex:Math.max(0.05,y.share)}}
         title={`${y.role} · ${(y.share*100).toFixed(1)}%`}/>)}</div>);

  return (
    <div className="app">
      <header>
        <h1>Albers Studio</h1>
        <span className="sub">photograph → layered weave model → tapestry</span>
        <div className="vtoggle">
          {Object.keys(RENDERERS).map(v =>
            <button key={v} className={v===version?'on':''} onClick={()=>setVersion(v)}>{v}</button>)}
        </div>
      </header>
      <div className="vnote">{RENDERERS[version].note}
        <span className="db">{dbUp ? ' · db connected' : ' · db offline (start: node server.js) — saves fall back to JSON'}</span>
      </div>

      <div className="cols3">
        <section>
          <div className="plabel">1 · Source & corners</div>
          <div className={'stage'+(src?'':' empty')}
               onClick={e=>{ if(!src) fileRef.current.click(); }}
               onDragOver={e=>e.preventDefault()}
               onDrop={e=>{e.preventDefault(); loadFile(e.dataTransfer.files[0]);}}>
            {src && <canvas ref={srcCvs}
              onPointerDown={e=>{ const [x,y]=toImg(e);
                let b=-1,bd=1e9; quad.forEach(([qx,qy],i)=>{const d=Math.hypot(qx-x,qy-y); if(d<bd){bd=d;b=i;}});
                if (bd < Math.max(28, src.w/26)){ drag.current=b; e.target.setPointerCapture(e.pointerId); } }}
              onPointerMove={e=>{ if(drag.current<0) return; const [x,y]=toImg(e);
                setQuad(q=>q.map((p,i)=>i===drag.current?[Math.max(0,Math.min(src.w,x)),Math.max(0,Math.min(src.h,y))]:p)); }}
              onPointerUp={()=>{ drag.current=-1; }}/>}
          </div>
          <div className="bar">
            <input ref={fileRef} type="file" accept="image/*" style={{display:'none'}}
                   onChange={e=>loadFile(e.target.files[0])}/>
            <button onClick={()=>fileRef.current.click()}>Open image</button>
            <button disabled={!src} onClick={doFlatten}>Flatten</button>
          </div>
        </section>

        <section>
          <div className="plabel">2 · Model</div>
          <div className={'stage'+(flat?'':' empty')}>
            {flat && <canvas ref={c=>{ if(c) imgToCanvas(flat,c); }}/>}
          </div>
          <div className="bar">
            <label>Yarns <input type="range" min="2" max="10" value={k}
                   onChange={e=>setK(+e.target.value)}/> {k}</label>
            <label>Threads <input type="number" min="0" max="300" value={cols} placeholder="auto"
                   onChange={e=>setCols(+e.target.value)} title="0 = auto from measured pitch"/></label>
            <button disabled={!flat} onClick={doProcess}>{busy||'Process'}</button>
          </div>
          {model && <div className="readout">
            {model.geometry.pitch.confX >= 0.04
              ? <>measured pitch {model.geometry.pitch.pitchX.toFixed(1)}px → {model.geometry.cols} threads</>
              : <>no confident pitch — {model.geometry.cols} threads (manual)</>}
            <br/>{model.geometry.cols}×{model.geometry.rows} · weft/warp {model.geometry.wefted.toFixed(2)}
            {yarnBar}
            {model.palette.map((y,i) =>
              <div key={i} className="yline">
                <i style={{background:`rgb(${y.rgb})`}}/> {y.role} · {(y.share*100).toFixed(1)}%
                {model.structure.floats[i] && <> · floats {model.structure.floats[i].mean.toFixed(1)}/{model.structure.floats[i].max}</>}
              </div>)}
          </div>}
        </section>

        <section>
          <div className="plabel">3 · Tapestry — {version}</div>
          <div ref={outBox} className={'stage grow'+(model?'':' empty')}>
            {model && <canvas ref={outCvs}/>}
          </div>
          <div className="bar">
            <button disabled={!model} onClick={savePng}>PNG</button>
            <button disabled={!model} onClick={saveSvg}>SVG (layers)</button>
            <button disabled={!model || !model.draft} onClick={saveDraft}>Draft</button>
            <button disabled={!model} onClick={saveProfile}>Save profile</button>
          </div>
          {fid && <div className="readout">
            fidelity: mean dE {fid.mean.toFixed(1)} · band r {fid.rows.toFixed(3)}
          </div>}
          {profiles.length > 0 && <div className="readout">
            <b>Profiles</b>
            {profiles.map(p =>
              <div key={p.id} className="yline">
                <button className="tiny" onClick={()=>loadProfile(p.id)}>load</button>
                &nbsp;{p.name} · {p.cols}×{p.rows} · {p.yarns} yarns
              </div>)}
          </div>}
        </section>
      </div>
    </div>
  );
}
