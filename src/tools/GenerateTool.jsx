import React, { useState, useRef, useEffect, useCallback } from 'react';
import { configToModel } from '../pipeline/config.js';
import { renderV1 } from '../pipeline/render/v1.js';
import { renderV12 } from '../pipeline/render/v12.js';
import { renderV2 } from '../pipeline/render/v2.js';
import { WEAVE_MODES, WEAVE_DEFAULTS } from '../pipeline/render/weave.js';
import { generateFromEnv, ENV_DEFAULTS, defaultFingerprint } from '../pipeline/generative.js';
import { TapestryStage, ToolChrome } from '../components/TapestryStage.jsx';
import { API, attachDraft, imgToCanvas } from '../shared.js';

const RENDERERS = {
  'V1':   { fn: renderV1,  note: 'archived — fat-cell original' },
  'V1.2': { fn: renderV12, note: 'archived — two-scale floats' },
  'V2':   { fn: renderV2,  note: 'draft-based weave aesthetics' },
};

const ENV_FIELDS = [
  { key:'temperature',   label:'Temp °C',   min:-5, max:35,  step:0.5 },
  { key:'humidity',      label:'Humidity %', min:0,  max:100, step:1 },
  { key:'wind',          label:'Wind m/s',  min:0,  max:20,  step:0.5 },
  { key:'precipitation', label:'Precip mm', min:0,  max:40,  step:0.5 },
  { key:'light',         label:'Light',     min:0,  max:1,   step:0.05 },
  { key:'season',        label:'Season',    min:0,  max:1,   step:0.05 },
];

/** Dedicated env + rug-style → generative textile tool (/generate, POST /api/generate). */
export function GenerateTool(){
  const [model, setModel] = useState(null);
  const [version, setVersion] = useState('V2');
  const [weaveMode, setWeaveMode] = useState(WEAVE_DEFAULTS.mode);
  const [tightness, setTightness] = useState(0.88);
  const [roughness, setRoughness] = useState(0.25);
  const [cols, setCols] = useState(0);
  const [profiles, setProfiles] = useState([]);
  const [dbUp, setDbUp] = useState(false);
  const [busy, setBusy] = useState('');
  const [env, setEnv] = useState({ ...ENV_DEFAULTS });
  const [styleIds, setStyleIds] = useState([]);
  const [genSeed, setGenSeed] = useState(42);
  const [genInfo, setGenInfo] = useState(null);
  const outCvs = useRef(), outBox = useRef();

  const refresh = useCallback(async () => {
    try { const r = await fetch(API+'/configs'); setProfiles(await r.json()); setDbUp(true); }
    catch { setDbUp(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const loadProfile = async (id) => {
    const r = await fetch(`${API}/configs/${id}`);
    const cfg = await r.json();
    const m = attachDraft(configToModel(cfg.json ? JSON.parse(cfg.json) : cfg));
    setModel(m); setGenInfo(null);
  };

  const toggleStyle = (id) => {
    setStyleIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
  };

  const doGenerate = async () => {
    setBusy('generating…');
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
        m = generateFromEnv({
          env, fingerprint: defaultFingerprint(),
          seed: genSeed, cols: cols || undefined
        });
        info = m.generative;
      }
      setModel(m); setGenInfo(info);
      if (info?.appearance){
        if (info.appearance.mode) setWeaveMode(info.appearance.mode);
        if (info.appearance.tightness != null) setTightness(info.appearance.tightness);
        if (info.appearance.roughness != null) setRoughness(info.appearance.roughness);
      }
      setVersion('V2');
    } catch (e){
      setBusy('');
      alert(e.message);
      return;
    }
    setBusy('');
  };

  const render = useCallback(() => {
    if (!model || !outCvs.current || !outBox.current) return;
    const wpx = Math.max(200, outBox.current.getBoundingClientRect().width - 4);
    const weaveOpts = version === 'V2'
      ? { mode: weaveMode, tightness, roughness, seed: 11 } : {};
    const out = RENDERERS[version].fn(model, { targetW: wpx, ...weaveOpts });
    imgToCanvas(out, outCvs.current);
  }, [model, version, weaveMode, tightness, roughness]);

  useEffect(render, [render]);
  useEffect(() => {
    if (!outBox.current) return;
    const ro = new ResizeObserver(() => render());
    ro.observe(outBox.current);
    return () => ro.disconnect();
  }, [render]);

  const yarnBar = model && (
    <div className="swatches">{model.palette.map((y,i) =>
      <i key={i} style={{background:`rgb(${y.rgb})`, flex:Math.max(0.05,y.share)}}
         title={`${y.role} · ${(y.share*100).toFixed(1)}%`}/>)}</div>);

  return (
    <ToolChrome tool="generate"
      note={version==='V2' ? (WEAVE_MODES[weaveMode]?.note || RENDERERS.V2.note) : RENDERERS[version].note}
      dbUp={dbUp}>
      <div className="cols3">
        <section>
          <div className="plabel">1 · Environment</div>
          <div className="stage env-panel">
            {ENV_FIELDS.map(f =>
              <label key={f.key} className="env-row">
                <span>{f.label}</span>
                <input type="range" min={f.min} max={f.max} step={f.step}
                       value={env[f.key]}
                       onChange={e=>setEnv(v => ({...v, [f.key]:+e.target.value}))}/>
                <em>{Number(env[f.key]).toFixed(f.step < 1 ? 2 : 0)}</em>
              </label>)}
          </div>
          <div className="bar">
            <label>Seed <input type="number" min="0" max="999999" value={genSeed}
                   onChange={e=>setGenSeed(+e.target.value||0)}/></label>
            <button onClick={()=>setEnv({...ENV_DEFAULTS})}>Reset env</button>
          </div>
        </section>

        <section>
          <div className="plabel">2 · Style from rugs · /api/generate</div>
          <div className={'stage'+(profiles.length?'':' empty gen-empty')}>
            {profiles.length > 0 && <div className="style-list">
              <p className="hint">Select saved rugs as style priors (fingerprints).
                None selected → default style.</p>
              {profiles.map(p =>
                <label key={p.id} className={'style-item'+(styleIds.includes(p.id)?' on':'')}>
                  <input type="checkbox" checked={styleIds.includes(p.id)}
                         onChange={()=>toggleStyle(p.id)}/>
                  <span>{p.name}</span>
                  <em>{p.cols}×{p.rows} · {p.yarns}y</em>
                  <button type="button" className="tiny"
                          onClick={e=>{e.preventDefault(); loadProfile(p.id);}}>peek</button>
                </label>)}
            </div>}
          </div>
          <div className="bar">
            <label>Threads <input type="number" min="0" max="300" value={cols}
                   onChange={e=>setCols(+e.target.value)}/></label>
            <button onClick={doGenerate}>{busy||'Generate'}</button>
          </div>
          {model && <div className="readout">
            {genInfo
              ? <>generative · style {genInfo.style} · seed {genInfo.seed}<br/></>
              : null}
            {model.geometry.cols}×{model.geometry.rows} · weft/warp {model.geometry.wefted.toFixed(2)}
            {yarnBar}
            {model.palette.map((y,i) =>
              <div key={i} className="yline">
                <i style={{background:`rgb(${y.rgb})`}}/> {y.role} · {(y.share*100).toFixed(1)}%
              </div>)}
          </div>}
        </section>

        <TapestryStage
          model={model} version={version} setVersion={setVersion} renderers={RENDERERS}
          weaveMode={weaveMode} setWeaveMode={setWeaveMode}
          tightness={tightness} setTightness={setTightness}
          roughness={roughness} setRoughness={setRoughness}
          outCvs={outCvs} outBox={outBox} fid={null}
          profiles={profiles} onLoadProfile={loadProfile} showProfiles={false}
          onSaved={refresh}/>
      </div>
    </ToolChrome>
  );
}
