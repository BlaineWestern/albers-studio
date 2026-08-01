import React from 'react';
import { WEAVE_MODES } from '../pipeline/construct.js';
import { modelToSvg } from '../pipeline/svg.js';
import { renderDraftImage } from '../pipeline/render/v2.js';
import { modelToConfig } from '../pipeline/config.js';
import { API, download, imgToCanvas } from '../shared.js';

/** Shared tapestry stage — weave construction aesthetics + exports.
   Used by Photo and Generate; both feed models into constructTapestry. */
export function TapestryStage({
  model,
  weaveMode, setWeaveMode, tightness, setTightness, roughness, setRoughness,
  outCvs, outBox, fid, profiles, onLoadProfile, showProfiles, onSaved,
  constructionNote
}){
  const savePng = () => download(
    `tapestry-${weaveMode}.png`,
    outCvs.current.toDataURL('image/png'));
  const saveSvg = () => download('tapestry-layers.svg',
    'data:image/svg+xml,'+encodeURIComponent(modelToSvg(model)));
  const saveDraft = () => {
    const img = renderDraftImage(model);
    const t = document.createElement('canvas');
    imgToCanvas(img, t);
    download('draft.png', t.toDataURL('image/png'));
  };
  const saveProfile = async () => {
    const name = prompt('Profile name?', 'untitled tapestry');
    if (!name) return;
    const cfg = modelToConfig(model, {
      name, weave: { mode: weaveMode, tightness, roughness }
    });
    try {
      await fetch(API+'/configs', { method:'POST',
        headers:{'Content-Type':'application/json'}, body: JSON.stringify(cfg) });
      onSaved?.();
    } catch {
      download(name.replace(/\W+/g,'-')+'.json',
        'data:application/json,'+encodeURIComponent(JSON.stringify(cfg)));
    }
  };

  return (
    <section>
      <div className="plabel">3 · Construction · {weaveMode}
        {constructionNote ? ` · ${constructionNote}` : ''}</div>
      <div ref={outBox} className={'stage grow'+(model?'':' empty')}>
        {model && <canvas ref={outCvs}/>}
      </div>
      <div className="weave-controls">
        <div className="plabel">Weave appearance (shared pipeline)</div>
        <div className="vtoggle weave-modes">
          {Object.entries(WEAVE_MODES).map(([id, m]) =>
            <button key={id} className={id===weaveMode?'on':''}
                    onClick={()=>setWeaveMode(id)} title={m.note}>{m.label}</button>)}
        </div>
        <div className="bar weave-sliders">
          <label className="env-row tight-row">
            <span>Tightness</span>
            <input type="range" min="0.15" max="1" step="0.01" value={tightness}
                   onChange={e=>setTightness(+e.target.value)}/>
            <em>{tightness.toFixed(2)}</em>
          </label>
          <label className="env-row tight-row">
            <span>Roughness</span>
            <input type="range" min="0" max="1" step="0.01" value={roughness}
                   onChange={e=>setRoughness(+e.target.value)}/>
            <em>{roughness.toFixed(2)}</em>
          </label>
        </div>
      </div>
      <div className="bar">
        <button disabled={!model} onClick={savePng}>PNG</button>
        <button disabled={!model} onClick={saveSvg}>SVG</button>
        <button disabled={!model || !model.draft} onClick={saveDraft}>Draft</button>
        <button disabled={!model} onClick={saveProfile}>Save profile</button>
      </div>
      {fid && <div className="readout">
        fidelity: mean dE {fid.mean.toFixed(1)} · band r {fid.rows.toFixed(3)}
      </div>}
      {showProfiles && profiles?.length > 0 && <div className="readout">
        <b>Profiles</b>
        {profiles.map(p =>
          <div key={p.id} className="yline">
            <button className="tiny" onClick={()=>onLoadProfile(p.id)}>load</button>
            &nbsp;{p.name} · {p.cols}×{p.rows} · {p.yarns} yarns
          </div>)}
      </div>}
    </section>
  );
}

export function ToolChrome({ tool, note, dbUp, children }){
  return (
    <div className="app">
      <header>
        <h1>Albers Studio</h1>
        <span className="sub">{tool === 'photo'
          ? 'photograph → photo modes → shared construction'
          : 'environment + rug style → shared construction'}</span>
        <nav className="vtoggle modes">
          <a className={tool==='photo'?'on':''} href="/photo">Photo</a>
          <a className={tool==='generate'?'on':''} href="/generate">Generate</a>
        </nav>
      </header>
      <div className="vnote">{note}
        <span className="db">{dbUp ? ' · db connected' : ' · db offline — saves fall back to JSON'}</span>
      </div>
      {children}
    </div>
  );
}
