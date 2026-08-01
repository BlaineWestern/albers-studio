import React, { useState, useRef, useEffect, useCallback } from 'react';
import { warpQuad, quadAspect } from '../pipeline/geometry.js';
import { configToModel } from '../pipeline/config.js';
import { fidelity } from '../pipeline/analyze.js';
import { constructTapestry, WEAVE_MODES, WEAVE_DEFAULTS } from '../pipeline/construct.js';
import { transformImage, defaultQuad, PHOTO_MODES, TRANSFORM_DEFAULTS } from '../pipeline/transform.js';
import { TapestryStage, ToolChrome } from '../components/TapestryStage.jsx';
import { API, attachDraft, imgToCanvas } from '../shared.js';

/** Photograph → textile. Own PHOTO_MODES; shared constructTapestry for pixels. */
export function PhotoTool(){
  const [src, setSrc] = useState(null);
  const [quad, setQuad] = useState(null);
  const [flat, setFlat] = useState(null);
  const [model, setModel] = useState(null);
  const [photoMode, setPhotoMode] = useState(TRANSFORM_DEFAULTS.mode);
  const [weaveMode, setWeaveMode] = useState(WEAVE_DEFAULTS.mode);
  const [tightness, setTightness] = useState(0.88);
  const [roughness, setRoughness] = useState(0.25);
  const [border, setBorder] = useState(WEAVE_DEFAULTS.border);
  const [k, setK] = useState(6);
  const [cols, setCols] = useState(0);
  const [fid, setFid] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [dbUp, setDbUp] = useState(false);
  const [busy, setBusy] = useState('');
  const [useApi, setUseApi] = useState(true);
  const srcCvs = useRef(), outCvs = useRef(), outBox = useRef(), fileRef = useRef();
  const drag = useRef(-1);

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
      setQuad(defaultQuad(w, h));
      setFlat(null); setModel(null); setFid(null);
      URL.revokeObjectURL(url);
    };
    im.src = url;
  };

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

  const applyResult = (result) => {
    setModel(result.model);
    if (result.flat?.data) setFlat(result.flat);
    else if (src && PHOTO_MODES[photoMode]?.flatten !== false){
      const ar = quadAspect(quad);
      const long = 1100;
      const fw = ar>=1?long:Math.round(long*ar), fh = ar>=1?Math.round(long/ar):long;
      setFlat(warpQuad(src, quad, fw, fh));
    } else setFlat(src);
    setFid(null);
  };

  const doProcessLocal = useCallback(() => {
    if (!src) return;
    setBusy('weaving…');
    setTimeout(() => {
      applyResult(transformImage({
        image: src, quad, mode: photoMode, k, cols: cols || undefined
      }));
      setBusy('');
    }, 20);
  }, [src, quad, photoMode, k, cols]);

  const doProcessApi = async () => {
    if (!src) return;
    setBusy('transforming…');
    try {
      let binary = '';
      const bytes = src.data;
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk)
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      const r = await fetch(API+'/transform', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          image: { w: src.w, h: src.h, data: btoa(binary) },
          quad, mode: photoMode, k, cols: cols || undefined, name: 'photo-transform'
        })
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || 'transform failed');
      const m = attachDraft(configToModel(body.config));
      const local = transformImage({
        image: src, quad, mode: photoMode, k, cols: cols || undefined
      });
      setModel(m);
      setFlat(local.flat?.data ? local.flat : src);
      setFid(null);
    } catch {
      doProcessLocal();
      return;
    }
    setBusy('');
  };

  const doProcess = () => {
    if (useApi && dbUp) doProcessApi();
    else doProcessLocal();
  };

  // Shared construction pipeline (same as Generate)
  const render = useCallback(() => {
    if (!model || !outCvs.current || !outBox.current) return;
    const wpx = Math.max(200, outBox.current.getBoundingClientRect().width - 4);
    const out = constructTapestry(model, {
      renderer: 'V2', mode: weaveMode, tightness, roughness, border, seed: 11, targetW: wpx
    });
    imgToCanvas(out, outCvs.current);
    if (flat?.data) setFid(fidelity(flat, out));
  }, [model, flat, weaveMode, tightness, roughness, border]);

  useEffect(render, [render]);
  useEffect(() => {
    if (!outBox.current) return;
    const ro = new ResizeObserver(() => render());
    ro.observe(outBox.current);
    return () => ro.disconnect();
  }, [render]);

  // Re-run transform when photo mode changes and we already have a source
  useEffect(() => {
    if (src && model) doProcessLocal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoMode]);

  const refresh = useCallback(async () => {
    try { const r = await fetch(API+'/configs'); setProfiles(await r.json()); setDbUp(true); }
    catch { setDbUp(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const loadProfile = async (id) => {
    const r = await fetch(`${API}/configs/${id}`);
    const cfg = await r.json();
    setModel(attachDraft(configToModel(cfg.json ? JSON.parse(cfg.json) : cfg)));
    setFlat(null); setFid(null);
  };

  const yarnBar = model && (
    <div className="swatches">{model.palette.map((y,i) =>
      <i key={i} style={{background:`rgb(${y.rgb})`, flex:Math.max(0.05,y.share)}}
         title={`${y.role} · ${(y.share*100).toFixed(1)}%`}/>)}</div>);

  return (
    <ToolChrome tool="photo"
      note={PHOTO_MODES[photoMode]?.note + ' · construct: ' + (WEAVE_MODES[weaveMode]?.label || 'tile')}
      dbUp={dbUp}>
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
                   data-testid="photo-file"
                   onChange={e=>loadFile(e.target.files[0])}/>
            <button data-testid="photo-open" onClick={()=>fileRef.current.click()}>Open image</button>
          </div>
          <div className="plabel" style={{marginTop:8}}>Photo mode</div>
          <div className="vtoggle weave-modes" style={{marginLeft:0, flexWrap:'wrap'}} data-testid="photo-modes">
            {Object.entries(PHOTO_MODES).map(([id, m]) =>
              <button key={id} className={id===photoMode?'on':''}
                      data-testid={`photo-mode-${id}`}
                      onClick={()=>setPhotoMode(id)} title={m.note}>{m.label}</button>)}
          </div>
        </section>

        <section>
          <div className="plabel">2 · Model · /api/transform</div>
          <div className={'stage'+(flat?'':' empty')}>
            {flat?.data && <canvas ref={c=>{ if(c) imgToCanvas(flat,c); }}/>}
          </div>
          <div className="bar">
            <label>Yarns <input type="range" min="2" max="10" value={k}
                   onChange={e=>setK(+e.target.value)}/> {k}</label>
            <label>Threads <input type="number" min="0" max="300" value={cols}
                   onChange={e=>setCols(+e.target.value)} title="0 = auto"/></label>
            <label className="check">
              <input type="checkbox" checked={useApi} onChange={e=>setUseApi(e.target.checked)}/> API
            </label>
            <button data-testid="photo-transform" disabled={!src} onClick={doProcess}>{busy||'Transform'}</button>
          </div>
          {model && <div className="readout" data-testid="photo-readout">
            mode {photoMode}
            {model.geometry.pitch.confX >= 0.04
              ? <> · pitch {model.geometry.pitch.pitchX.toFixed(1)}px → {model.geometry.cols} threads<br/></>
              : <> · {model.geometry.cols} threads<br/></>}
            {model.geometry.cols}×{model.geometry.rows} · weft/warp {model.geometry.wefted.toFixed(2)}
            {yarnBar}
            {model.palette.map((y,i) =>
              <div key={i} className="yline">
                <i style={{background:`rgb(${y.rgb})`}}/> {y.role} · {(y.share*100).toFixed(1)}%
              </div>)}
          </div>}
        </section>

        <TapestryStage
          model={model}
          weaveMode={weaveMode} setWeaveMode={setWeaveMode}
          tightness={tightness} setTightness={setTightness}
          roughness={roughness} setRoughness={setRoughness}
          border={border} setBorder={setBorder}
          outCvs={outCvs} outBox={outBox} fid={fid}
          profiles={profiles} onLoadProfile={loadProfile} showProfiles
          onSaved={refresh}
          constructionNote="shared constructTapestry"/>
      </div>
    </ToolChrome>
  );
}
