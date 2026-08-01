import React from 'react';
import { WEAVE_MODES } from '../pipeline/construct.js';
import { modelToSvg } from '../pipeline/svg.js';
import { renderDraftImage } from '../pipeline/render/v2.js';
import { modelToConfig } from '../pipeline/config.js';
import { draftToWif, draftToLiftJson } from '../pipeline/export-wif.js';
import { API, download, imgToCanvas } from '../shared.js';

/** Shared tapestry stage — weave construction aesthetics + exports.
   Used by Photo and Generate; both feed models into constructTapestry. */
export function TapestryStage({
  model,
  weaveMode, setWeaveMode, tightness, setTightness, roughness, setRoughness,
  border, setBorder, borderRoughness, setBorderRoughness,
  outCvs, outBox, fid, profiles, onLoadProfile, showProfiles, onSaved,
  constructionNote, provenance
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
  const saveProvenance = () => {
    const blob = provenance || model?.generative?.provenance || {
      tool: 'studio',
      weave: { mode: weaveMode, tightness, roughness, border, borderRoughness }
    };
    download('provenance.json',
      'data:application/json,'+encodeURIComponent(JSON.stringify(blob, null, 2)));
  };
  const saveWif = () => {
    if (!model?.draft) return;
    const d = model.draft();
    const wif = draftToWif(d.draft, d.W, d.H, { name: 'albers-draft' });
    const lift = draftToLiftJson(d.draft, d.W, d.H, { name: 'albers-draft' });
    download('draft.wif', 'data:text/plain,'+encodeURIComponent(wif));
    download('draft.lift.json',
      'data:application/json,'+encodeURIComponent(JSON.stringify(lift)));
  };
  const saveProfile = async () => {
    const name = prompt('Profile name?', 'untitled tapestry');
    if (!name) return;
    const cfg = modelToConfig(model, {
      name,
      tool: model.generative ? 'generate' : 'photo',
      source: model.generative ? 'generative' : 'transform',
      designSpec: model.generative?.designSpec,
      weave: { mode: weaveMode, tightness, roughness, border, borderRoughness },
      env: model.generative?.env,
      seed: model.generative?.seed,
      style: model.generative?.style
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
      <div ref={outBox} className={'stage grow'+(model?'':' empty')} data-testid="tapestry-stage">
        {model && <canvas ref={outCvs} data-testid="tapestry-canvas"/>}
      </div>
      <div className="weave-controls">
        <div className="plabel">Weave appearance (shared pipeline)</div>
        <div className="vtoggle weave-modes" data-testid="weave-modes">
          {Object.entries(WEAVE_MODES).map(([id, m]) =>
            <button key={id} className={id===weaveMode?'on':''}
                    data-testid={`weave-mode-${id}`}
                    onClick={()=>{
                      setWeaveMode(id);
                      // First visit to fringe: give a visible border so the mode reads
                      if (id === 'fringe' && border <= 0) setBorder(0.4);
                    }} title={m.note}>{m.label}</button>)}
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
          <label className="env-row tight-row" title="Fringe extension past the cloth. 0 = no border.">
            <span>Border</span>
            <input type="range" min="0" max="1" step="0.01" value={border}
                   data-testid="border-slider"
                   disabled={weaveMode !== 'fringe'}
                   onChange={e=>setBorder(+e.target.value)}/>
            <em>{border.toFixed(2)}</em>
          </label>
          <label className="env-row tight-row" title="Irregularity of fringe threads only (not the cloth).">
            <span>Border rough</span>
            <input type="range" min="0" max="1" step="0.01" value={borderRoughness}
                   data-testid="border-rough-slider"
                   disabled={weaveMode !== 'fringe' || border <= 0}
                   onChange={e=>setBorderRoughness(+e.target.value)}/>
            <em>{borderRoughness.toFixed(2)}</em>
          </label>
        </div>
        {weaveMode === 'fringe' && border <= 0 &&
          <div className="plabel">Border 0 · cloth only (no fringe)</div>}
      </div>
      <div className="bar">
        <button disabled={!model} onClick={savePng}>PNG</button>
        <button disabled={!model} onClick={saveSvg}>SVG</button>
        <button disabled={!model || !model.draft} onClick={saveDraft}>Draft</button>
        <button disabled={!model || !model.draft} onClick={saveWif}>WIF</button>
        <button disabled={!model} onClick={saveProvenance}>Provenance</button>
        <button disabled={!model} onClick={saveProfile}>Save profile</button>
      </div>
      {fid && <div className="readout">
        fidelity: mean dE {fid.mean.toFixed(1)} · band r {fid.rows.toFixed(3)}
      </div>}
      {provenance && <div className="readout">
        <b>Provenance</b> · {provenance.tool || 'studio'}
        {provenance.style ? ` · ${provenance.style}` : ''}
        {provenance.seed != null ? ` · seed ${provenance.seed}` : ''}
        {provenance.draftValidity
          ? ` · draft ${provenance.draftValidity.ok ? 'ok' : 'flagged'}` : ''}
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
        <nav className="vtoggle modes" data-testid="tool-nav">
          <a className={tool==='photo'?'on':''} href="/photo" data-testid="nav-photo">Photo</a>
          <a className={tool==='generate'?'on':''} href="/generate" data-testid="nav-generate">Generate</a>
        </nav>
      </header>
      <div className="vnote">{note}
        <span className="db">{dbUp ? ' · db connected' : ' · db offline — saves fall back to JSON'}</span>
      </div>
      {children}
    </div>
  );
}
