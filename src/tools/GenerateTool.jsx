import { useState, useRef, useEffect, useCallback } from 'react';
import { constructTapestry, WEAVE_MODES, WEAVE_DEFAULTS } from '../pipeline/construct.js';
import {
  generateFromEnv, materializeFromDesignSpec, ENV_DEFAULTS, defaultFingerprint,
  resolveDesignSpec
} from '../pipeline/generative.js';
import { structureNames } from '../pipeline/structure.js';
import { configToModel } from '../pipeline/config.js';
import { TapestryStage, ToolChrome } from '../components/TapestryStage.jsx';
import { API, attachDraft, imgToCanvas } from '../shared.js';

const ENV_FIELDS = [
  { key:'temperature',   label:'Temp °C',   min:-5, max:35,  step:0.5 },
  { key:'humidity',      label:'Humidity %', min:0,  max:100, step:1 },
  { key:'wind',          label:'Wind m/s',  min:0,  max:20,  step:0.5 },
  { key:'precipitation', label:'Precip mm', min:0,  max:40,  step:0.5 },
  { key:'light',         label:'Light',     min:0,  max:1,   step:0.05 },
  { key:'season',        label:'Season',    min:0,  max:1,   step:0.05 },
];

const STRUCT_OPTS = structureNames();

/** Env + rug-style → generative textile. Shares constructTapestry with Photo. */
export function GenerateTool(){
  const [model, setModel] = useState(null);
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
  const [designSpec, setDesignSpec] = useState(null);
  const [glitch, setGlitch] = useState(0);
  const outCvs = useRef(), outBox = useRef();

  const refresh = useCallback(async () => {
    try { const r = await fetch(API+'/configs'); setProfiles(await r.json()); setDbUp(true); }
    catch { setDbUp(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const loadProfile = async (id) => {
    const r = await fetch(`${API}/configs/${id}`);
    const cfg = await r.json();
    const parsed = cfg.json ? JSON.parse(cfg.json) : cfg;
    const m = attachDraft(configToModel(parsed), parsed.meta || {});
    setModel(m);
    setGenInfo(parsed.meta?.provenance ? { ...parsed.meta.provenance, designSpec: parsed.meta.designSpec } : null);
    if (parsed.meta?.designSpec) setDesignSpec(parsed.meta.designSpec);
  };

  const toggleStyle = (id) => {
    setStyleIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
  };

  const applyModel = (m, info) => {
    setModel(m);
    setGenInfo(info);
    if (info?.designSpec) setDesignSpec(structuredClone(info.designSpec));
    if (info?.appearance){
      if (info.appearance.mode) setWeaveMode(info.appearance.mode);
      if (info.appearance.tightness != null) setTightness(info.appearance.tightness);
      if (info.appearance.roughness != null) setRoughness(info.appearance.roughness);
    }
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
            cols: cols || undefined, name: 'env tapestry',
            glitch: glitch || undefined
          })
        });
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || 'generate failed');
        m = attachDraft(configToModel(body.config), body.config.meta || {});
        m.generative = body.generative;
        info = body.generative;
      } else {
        m = generateFromEnv({
          env, fingerprint: defaultFingerprint(),
          seed: genSeed, cols: cols || undefined, glitch: glitch || undefined
        });
        info = m.generative;
      }
      applyModel(m, info);
    } catch (e){
      setBusy('');
      alert(e.message);
      return;
    }
    setBusy('');
  };

  const rematerialize = async () => {
    if (!designSpec) return;
    setBusy('rematerializing…');
    try {
      const next = {
        ...designSpec,
        seed: genSeed,
        structurePlan: {
          ...designSpec.structurePlan,
          ops: glitch > 0
            ? [...(designSpec.structurePlan?.ops || []).filter(o => o.op !== 'glitch'),
               { op: 'glitch', density: glitch }]
            : (designSpec.structurePlan?.ops || []).filter(o => o.op !== 'glitch')
        }
      };
      let m, info;
      if (dbUp){
        const r = await fetch(API+'/generate', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ designSpec: next, seed: genSeed, name: 'spec tapestry' })
        });
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || 'rematerialize failed');
        m = attachDraft(configToModel(body.config), body.config.meta || {});
        m.generative = body.generative;
        info = body.generative;
      } else {
        m = materializeFromDesignSpec(next, { fingerprint: defaultFingerprint(), seed: genSeed });
        info = m.generative;
      }
      applyModel(m, info);
    } catch (e){
      alert(e.message);
    }
    setBusy('');
  };

  const previewSpecFromEnv = () => {
    const spec = resolveDesignSpec(env, defaultFingerprint(), {
      seed: genSeed, cols: cols || undefined, glitch: glitch || undefined
    });
    setDesignSpec(structuredClone({
      schema: spec.schema, seed: spec.seed, gauge: spec.gauge,
      palettePlan: spec.palettePlan, structurePlan: spec.structurePlan,
      densityPlan: spec.densityPlan, appearancePlan: spec.appearancePlan
    }));
  };

  const patchSpec = (path, value) => {
    setDesignSpec(s => {
      if (!s) return s;
      const next = structuredClone(s);
      const parts = path.split('.');
      let cur = next;
      for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]];
      cur[parts[parts.length - 1]] = value;
      return next;
    });
  };

  const render = useCallback(() => {
    if (!model || !outCvs.current || !outBox.current) return;
    const wpx = Math.max(200, outBox.current.getBoundingClientRect().width - 4);
    const out = constructTapestry(model, {
      renderer: 'V2', mode: weaveMode, tightness, roughness, seed: 11, targetW: wpx
    });
    imgToCanvas(out, outCvs.current);
  }, [model, weaveMode, tightness, roughness]);

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

  const validity = model?.structure?.validity || genInfo?.provenance?.draftValidity;

  return (
    <ToolChrome tool="generate"
      note={(genInfo?.designSpec
        ? `DesignSpec · ${genInfo.designSpec.structurePlan?.field || 'twill'}`
        : 'parametric DesignSpec') + ' · construct: ' + (WEAVE_MODES[weaveMode]?.label || 'tile')}
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
            <label className="env-row">
              <span>Glitch</span>
              <input type="range" min="0" max="0.12" step="0.005" value={glitch}
                     onChange={e=>setGlitch(+e.target.value)}/>
              <em>{glitch.toFixed(3)}</em>
            </label>
          </div>
          <div className="bar">
            <label>Seed <input type="number" min="0" max="999999" value={genSeed}
                   onChange={e=>setGenSeed(+e.target.value||0)}/></label>
            <button onClick={()=>setEnv({...ENV_DEFAULTS})}>Reset env</button>
            <button onClick={previewSpecFromEnv}>Preview spec</button>
          </div>

          <div className="plabel" style={{marginTop:10}}>DesignSpec inspector</div>
          <div className="stage env-panel spec-panel">
            {!designSpec && <p className="hint">Generate or Preview spec to edit named plans.</p>}
            {designSpec && <>
              <label className="env-row">
                <span>Cols</span>
                <input type="range" min="24" max="160" step="1" value={designSpec.gauge.cols}
                       onChange={e=>patchSpec('gauge.cols', +e.target.value)}/>
                <em>{designSpec.gauge.cols}</em>
              </label>
              <label className="env-row">
                <span>Rows</span>
                <input type="range" min="16" max="140" step="1" value={designSpec.gauge.rows}
                       onChange={e=>patchSpec('gauge.rows', +e.target.value)}/>
                <em>{designSpec.gauge.rows}</em>
              </label>
              {['ground','field','supplementary'].map(role =>
                <label key={role} className="env-row">
                  <span>{role}</span>
                  <select value={designSpec.structurePlan[role]}
                          onChange={e=>patchSpec(`structurePlan.${role}`, e.target.value)}>
                    {STRUCT_OPTS.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                  <em/>
                </label>)}
              <label className="env-row">
                <span>Disorder</span>
                <input type="range" min="0.05" max="0.8" step="0.01"
                       value={designSpec.densityPlan.disorder}
                       onChange={e=>patchSpec('densityPlan.disorder', +e.target.value)}/>
                <em>{designSpec.densityPlan.disorder.toFixed(2)}</em>
              </label>
              <label className="env-row">
                <span>Tight</span>
                <input type="range" min="0.2" max="1" step="0.01"
                       value={designSpec.appearancePlan.tightness}
                       onChange={e=>patchSpec('appearancePlan.tightness', +e.target.value)}/>
                <em>{designSpec.appearancePlan.tightness.toFixed(2)}</em>
              </label>
              <label className="env-row">
                <span>Rough</span>
                <input type="range" min="0" max="1" step="0.01"
                       value={designSpec.appearancePlan.roughness}
                       onChange={e=>patchSpec('appearancePlan.roughness', +e.target.value)}/>
                <em>{designSpec.appearancePlan.roughness.toFixed(2)}</em>
              </label>
              <div className="bar">
                <button onClick={rematerialize}>{busy || 'Rematerialize'}</button>
              </div>
            </>}
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
            {validity
              ? <>draft {validity.ok ? 'ok' : 'repaired/flagged'} · lift {(validity.liftRatio*100||0).toFixed?.(0) ?? Math.round((validity.liftRatio||0)*100)}%<br/></>
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
          model={model}
          weaveMode={weaveMode} setWeaveMode={setWeaveMode}
          tightness={tightness} setTightness={setTightness}
          roughness={roughness} setRoughness={setRoughness}
          outCvs={outCvs} outBox={outBox} fid={null}
          profiles={profiles} onLoadProfile={loadProfile} showProfiles={false}
          onSaved={refresh}
          provenance={genInfo?.provenance || model?.generative?.provenance}
          constructionNote="shared constructTapestry"/>
      </div>
    </ToolChrome>
  );
}
