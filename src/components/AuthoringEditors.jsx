import { useEffect, useRef, useState } from 'react';
import { paintBrush } from '../pipeline/cells.js';
import { yarnRoles, markRuns, floatStats, buildDraft, validateDraft } from '../pipeline/structure.js';
import { runDraftOps } from '../pipeline/draft-ops.js';

/** Motif brush on indexmap + clickable draft grid. */
export function AuthoringEditors({ model, setModel, onEdited }){
  const [yarnId, setYarnId] = useState(0);
  const [brush, setBrush] = useState(1);
  const [undo, setUndo] = useState([]);
  const motifRef = useRef();
  const draftRef = useRef();

  useEffect(() => {
    if (!model || !motifRef.current) return;
    paintIndexmap(model, motifRef.current);
  }, [model]);

  useEffect(() => {
    if (!model?.draft || !draftRef.current) return;
    paintDraftGrid(model.draft(), draftRef.current);
  }, [model]);

  if (!model) return null;

  const pushUndo = () => {
    setUndo(u => [...u.slice(-19), {
      idx: model.cells.idx.slice(),
      overrides: structuredClone(model.structure.manualOverrides || [])
    }]);
  };

  const rebuildFromIdx = (idx) => {
    const next = {
      ...model,
      cells: { ...model.cells, idx },
      palette: model.palette.map(y => ({ ...y })),
      structure: { ...model.structure }
    };
    const roles = yarnRoles(idx, next.palette.length, next.cells.ground);
    const share = new Array(next.palette.length).fill(0);
    for (const v of idx) share[v]++;
    for (let i = 0; i < next.palette.length; i++){
      next.palette[i].role = roles[i];
      next.palette[i].share = share[i] / idx.length;
    }
    next.structure.runs = markRuns(idx, next.geometry.cols, next.geometry.rows, roles);
    next.structure.floats = floatStats(idx, next.geometry.cols, next.geometry.rows, next.palette.length);
    const d = buildDraft(idx, next.geometry.cols, next.geometry.rows, roles, next.structure.assign, 2, { repair: true });
    // clear layered drafts (indexmap changed)
    next.structure.layers = null;
    next.structure.doubleWeave = false;
    next.structure.validity = d.validity;
    const overrides = next.structure.manualOverrides || [];
    next.draft = () => {
      if (!overrides.length) return d;
      const mod = runDraftOps({
        draft: d.draft, W: d.W, H: d.H,
        ops: [{ op: 'manualOverrides', cells: overrides }],
        repair: true
      });
      return { draft: mod.draft, W: mod.W, H: mod.H, tp: 2, validity: mod.validity };
    };
    setModel(next);
    onEdited?.(next);
  };

  const onMotifPointer = (e) => {
    if (!model || e.buttons !== 1 && e.type === 'pointermove') return;
    if (e.type === 'pointerdown') pushUndo();
    const cvs = motifRef.current;
    const rect = cvs.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / rect.width * model.geometry.cols);
    const y = Math.floor((e.clientY - rect.top) / rect.height * model.geometry.rows);
    if (x < 0 || y < 0 || x >= model.geometry.cols || y >= model.geometry.rows) return;
    const idx = paintBrush(model.cells.idx, model.geometry.cols, model.geometry.rows, x, y, yarnId, brush);
    rebuildFromIdx(idx);
  };

  const onDraftClick = (e) => {
    if (!model?.draft) return;
    pushUndo();
    const d = model.draft();
    const cvs = draftRef.current;
    const rect = cvs.getBoundingClientRect();
    // show a capped view for interaction
    const viewW = Math.min(d.W, 64);
    const viewH = Math.min(d.H, 48);
    const x = Math.floor((e.clientX - rect.left) / rect.width * viewW);
    const y = Math.floor((e.clientY - rect.top) / rect.height * viewH);
    if (x < 0 || y < 0 || x >= viewW || y >= viewH) return;
    const overrides = [...(model.structure.manualOverrides || [])];
    const cur = d.draft[y * d.W + x] ? 1 : 0;
    const v = cur ? 0 : 1;
    const existing = overrides.findIndex(o => o.x === x && o.y === y);
    if (existing >= 0) overrides[existing] = { x, y, v };
    else overrides.push({ x, y, v });
    const next = {
      ...model,
      structure: { ...model.structure, manualOverrides: overrides }
    };
    next.draft = () => {
      const base = buildDraft(
        next.cells.idx, next.geometry.cols, next.geometry.rows,
        next.palette.map(y => y.role), next.structure.assign, 2, { repair: true }
      );
      const mod = runDraftOps({
        draft: base.draft, W: base.W, H: base.H,
        ops: [
          ...(next.generative?.designSpec?.structurePlan?.ops || []).filter(o => o.op !== 'manualOverrides'),
          { op: 'manualOverrides', cells: overrides }
        ],
        seed: next.generative?.seed ?? 1,
        repair: true
      });
      next.structure.validity = mod.validity;
      return { draft: mod.draft, W: mod.W, H: mod.H, tp: 2, validity: mod.validity };
    };
    // refresh validity immediately
    const probed = next.draft();
    next.structure.validity = probed.validity || validateDraft(probed.draft, probed.W, probed.H);
    setModel(next);
    onEdited?.(next);
  };

  const doUndo = () => {
    if (!undo.length) return;
    const prev = undo[undo.length - 1];
    setUndo(u => u.slice(0, -1));
    const next = {
      ...model,
      cells: { ...model.cells, idx: prev.idx },
      structure: { ...model.structure, manualOverrides: prev.overrides || [] }
    };
    // rebuild roles from restored idx
    const idx = prev.idx;
    const roles = yarnRoles(idx, next.palette.length, next.cells.ground);
    const share = new Array(next.palette.length).fill(0);
    for (const v of idx) share[v]++;
    for (let i = 0; i < next.palette.length; i++){
      next.palette[i] = { ...next.palette[i], role: roles[i], share: share[i] / idx.length };
    }
    next.structure.runs = markRuns(idx, next.geometry.cols, next.geometry.rows, roles);
    next.structure.floats = floatStats(idx, next.geometry.cols, next.geometry.rows, next.palette.length);
    const overrides = next.structure.manualOverrides || [];
    next.draft = () => {
      const base = buildDraft(idx, next.geometry.cols, next.geometry.rows, roles, next.structure.assign, 2, { repair: true });
      if (!overrides.length) return base;
      const mod = runDraftOps({
        draft: base.draft, W: base.W, H: base.H,
        ops: [{ op: 'manualOverrides', cells: overrides }],
        repair: true
      });
      return { draft: mod.draft, W: mod.W, H: mod.H, tp: 2, validity: mod.validity };
    };
    const probed = next.draft();
    next.structure.validity = probed.validity;
    setModel(next);
    onEdited?.(next);
  };

  const setFace = (face) => {
    if (!model.structure.layers?.length) return;
    const next = { ...model, structure: { ...model.structure, face } };
    // preserve draft() that reads face from structure
    next.draft = () => {
      const L = next.structure.layers[face ? 1 : 0] || next.structure.layers[0];
      return { draft: L.draft.slice(), W: L.W, H: L.H, tp: L.tp, face, validity: L.validity };
    };
    next.structure.validity = next.structure.layers[face ? 1 : 0]?.validity || next.structure.validity;
    setModel(next);
    onEdited?.(next);
  };

  const validity = model.structure?.validity;

  return (
    <div className="authoring" data-testid="authoring">
      <div className="plabel">Authoring · motif + draft</div>
      <div className="bar">
        {model.palette.map((y, i) =>
          <button key={i} type="button" className={i===yarnId?'on yarn-pick': 'yarn-pick'}
                  data-testid={`yarn-pick-${i}`}
                  style={{ borderColor: `rgb(${y.rgb})` }}
                  onClick={()=>setYarnId(i)} title={y.role}>
            <i style={{ background:`rgb(${y.rgb})` }}/>{i}
          </button>)}
        <label>Brush <input type="range" min="0" max="4" value={brush}
               data-testid="brush-radius"
               onChange={e=>setBrush(+e.target.value)}/> {brush}</label>
        <button type="button" data-testid="authoring-undo" disabled={!undo.length} onClick={doUndo}>Undo</button>
        {model.structure?.layers?.length > 1 && (
          <span className="vtoggle weave-modes" style={{marginLeft:0}} data-testid="face-toggle">
            <button type="button" className={!model.structure.face?'on':''}
                    data-testid="face-a"
                    onClick={()=>setFace(0)}>Face A</button>
            <button type="button" className={model.structure.face?'on':''}
                    data-testid="face-b"
                    onClick={()=>setFace(1)}>Face B</button>
          </span>
        )}
      </div>
      <div className="authoring-grids">
        <div>
          <div className="plabel">Indexmap brush</div>
          <canvas ref={motifRef} className="edit-grid" data-testid="motif-canvas"
                  onPointerDown={onMotifPointer}
                  onPointerMove={onMotifPointer}/>
        </div>
        <div>
          <div className="plabel">Draft toggles
            {validity ? ` · ${validity.ok ? 'ok' : 'flagged'}` : ''}</div>
          <canvas ref={draftRef} className="edit-grid" data-testid="draft-canvas"
                  onClick={onDraftClick}/>
        </div>
      </div>
    </div>
  );
}

function paintIndexmap(model, cvs){
  const { cols, rows } = model.geometry;
  const scale = Math.max(2, Math.min(8, Math.floor(280 / cols)));
  cvs.width = cols * scale;
  cvs.height = rows * scale;
  const c = cvs.getContext('2d');
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++){
    const yarn = model.palette[model.cells.idx[y*cols+x]];
    c.fillStyle = `rgb(${yarn.rgb})`;
    c.fillRect(x*scale, y*scale, scale, scale);
  }
}

function paintDraftGrid(d, cvs){
  const viewW = Math.min(d.W, 64);
  const viewH = Math.min(d.H, 48);
  const scale = Math.max(2, Math.min(6, Math.floor(280 / viewW)));
  cvs.width = viewW * scale;
  cvs.height = viewH * scale;
  const c = cvs.getContext('2d');
  for (let y = 0; y < viewH; y++) for (let x = 0; x < viewW; x++){
    const up = d.draft[y*d.W+x];
    c.fillStyle = up ? '#1c1a17' : '#ece3cd';
    c.fillRect(x*scale, y*scale, scale-0.5, scale-0.5);
  }
}
