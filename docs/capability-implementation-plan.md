# Capability Implementation Plan

Plan to close the gaps in [`capability-map.csv`](./capability-map.csv).  
Goal: turn each unfinished map row into **working functionality** in Albers Studio — parametric, loom-honest, shared `constructTapestry` — **without** importing FabricGen/AdaCAD code.

**Status legend (map):** `done` · `partial` · `none`  
**Phases:** 1 = AdaCAD-like draft surface · 2 = edit/export depth · 3 = research optional

### Execution status (this branch)

| Milestone | State |
|-----------|--------|
| M1 Structure honesty | **done** — 11 structures, `repairDraft`, validity on save |
| M2 Draft dataflow | **done** — `draft-ops.js`, glitch op, DesignSpec.ops |
| M3 Spec as product surface | **done** — `materializeFromDesignSpec`, inspector UI, provenance |
| M4 Stronger priors | **done** — 8×8 `roleGrid` spatial bias |
| M5 Authoring | **done** — motif brush + draft grid toggles + undo |
| M6 Interchange | **done** — WIF + lift JSON + double-weave faces |
| M7 Appearance/QA | **done** — richer handloom + golden checksums |

Still deferred: L3-05 learned yarn shading, L4-04 diffusion/LLM drafts.

**Appearance follow-on:** fringe craft × physics — see [`fringe-heuristics-plan.md`](./fringe-heuristics-plan.md). **F1 done** (T/k/m + arc-length); F2–F5 pending.

---

## Principles (do not violate)

1. Colour (indexmap) stays separate from structure (draft).
2. Photo and Generate keep distinct model-creation paths; both end in `constructTapestry`.
3. Prefer named structures + ops + validation over ML.
4. Every generative/photo result remains saveable and re-renderable without the source.
5. Update `capability-map.csv` `status` when a row lands; keep `approach` in sync.

---

## Dependency graph (phase 1)

```
L2-01 structures library
   └─► L2-03 validity + repair
         ├─► L2-04 draft-ops graph  ◄── L2-05 glitch (as one op)
         │         └─► L4-02 editable DesignSpec
         │                   └─► L5-05 DesignSpec inspector UI
         └─► L4-03 provenance bundle (also needs L4-02 fields)
L1-03 richer fingerprints ──► feeds DesignSpec defaults (parallel OK)
L5-02 appearance/photoMode in config meta ──► polish alongside L4-03
```

Phase 2 depends on phase-1 draft-ops + DesignSpec being stable.

---

## Phase 1 — Parametric draft surface

Ship order below. Each item lists **how** (approach), **touch**, **done when**.

### 1. L2-01 — Named weave structures library (`partial` → `done`)

**How**
1. Add lift functions to `STRUCTURES` in `structure.js`: e.g. `twill31`, `twill12`, `satin5`, `warpFloat4`, `basket4`, optional `lenoStub` (document as approximation).
2. Keep each as pure `(x,y) → 0|1`; no side effects.
3. Unit test: for W,H ≥ 16 every new structure passes `validateDraft` (or is flagged as open-structure if intentionally float-heavy).
4. Wire names into generative `structurePlan` and photo `PHOTO_MODES` assign options where useful.

**Touch:** `src/pipeline/structure.js`, `test/run.mjs`, maybe `generative.js` defaults  
**Done when:** ≥10 named lifts; each has a test; map row → `done`

---

### 2. L2-03 — Draft validity + repair (`partial` → `done`)

**How**
1. Extend `validateDraft` with optional `maxFloatByStructure` and coarse `shaftHint` (period of lift pattern).
2. Add `repairDraft(draft, W, H, opt)`: force interlacement on flat rows/cols (flip mid-run bits); break overlong floats every `maxFloat`.
3. Call repair from `buildDraft` / generative materialize when `opt.repair !== false`; stash validity on `model.structure.validity`.
4. Refuse silent save of `ok:false` unless `meta.allowInvalidDraft`.

**Touch:** `structure.js`, `generative.js`, `config.js`, tests  
**Done when:** Invalid drafts auto-repair or surface flag; provenance includes validity  
**Depends on:** L2-01 helpful but not blocking

---

### 3. L2-04 + L2-05 — Draft ops graph + structure glitch (`none`/`partial` → `done`)

**How**
1. New module `src/pipeline/draft-ops.js`:
   - Ops as `{ op, ...params }` applied in order to a base binary draft or structure seed.
   - First ops: `fromStructure`, `blockRepeat`, `invertRegion`, `cropPad`, `glitch` (value-noise flip with density + seed), `validate`/`repair`.
2. Extend `DesignSpec.structurePlan` with `ops: []`; `resolveDesignSpec` → materialize via op runner then `validateDraft`/`repairDraft`.
3. Glitch (L2-05) is only an op — never invent a second draft path.
4. Determinism: same ops + seed → identical draft bytes.

**Touch:** `draft-ops.js`, `generative.js`, `structure.js`, tests  
**Done when:** DesignSpec lists ops; glitch changes draft; validity ok or repaired  
**Depends on:** L2-03

---

### 4. L4-02 — Editable DesignSpec surface (`partial` → `done`)

**How**
1. Export a stable JSON schema object from `resolveDesignSpec` (gauge, palettePlan, structurePlan+ops, densityPlan, appearancePlan).
2. Add `materializeFromDesignSpec(spec, { seed })` separate from env mapping so UI can edit spec then rebuild model.
3. Keep `generateFromEnv` as: env+fingerprint → DesignSpec → materialize.
4. API: optional `POST /api/generate` body `{ designSpec, seed }` bypasses env map when present.

**Touch:** `generative.js`, `server.js`, tests  
**Done when:** Edit one DesignSpec field; output changes; other fields stable under same seed  
**Depends on:** L2-04

---

### 5. L5-05 — DesignSpec inspector UI (`none` → `done`)

**How**
1. Panel on Generate tool: sections for gauge / palette / structure(+ops) / density / appearance.
2. Controlled inputs bound to DesignSpec state; **Rematerialize** calls `materializeFromDesignSpec` (local) or API.
3. Show read-only provenance summary under inspector.
4. Do not put this on Photo — Photo keeps PHOTO_MODES.

**Touch:** `GenerateTool.jsx`, small presentational component if needed, CSS  
**Done when:** All plan fields visible; editable subset rematerializes cloth  
**Depends on:** L4-02

---

### 6. L4-03 — Provenance bundle (`partial` → `done`)

**How**
1. Normalize `config.meta.provenance`: `{ tool, env?, photoMode?, style, seed, designSpec?, validity, created }`.
2. On Save profile / export, also offer `provenance.json` (same blob).
3. Generate + Photo both write provenance; construction knobs (mode/tightness/roughness) included.

**Touch:** `config.js`, `TapestryStage.jsx`, `transform.js`, `generative.js`  
**Done when:** Saved profile always contains provenance fields above  
**Depends on:** L4-02 (for designSpec snapshot); can start earlier for env/seed

---

### 7. L1-03 — Richer style priors (`partial` → stronger `partial`/`done`)

**How**
1. Extend fingerprint with spatial histograms: row/col yarn entropy, mark run length percentiles, optional 8×8 downsample of role map.
2. In generative indexmap, bias noise using those priors (not motif copy-paste).
3. Blend: weighted average of Labs + structure assign + spatial stats across `profileIds`.
4. Test: steered generate differs from default in cells + assign; remains draft-valid.

**Touch:** `fingerprint.js`, `generative.js`, tests  
**Done when:** Multi-rug blend changes spatial stats measurably; no ML weights  
**Parallel:** can run beside L2-* 

---

### 8. L5-02 / L4-01 polish (already `done`, tighten)

**How**
- Persist `meta.weave` + `meta.photoMode` consistently on every save.
- Document env→DesignSpec map next to inspector; clamp table covered by API tests (exists).

---

## Phase 2 — Edit, layers, export

Do after phase-1 DesignSpec + draft-ops are stable.

| ID | Capability | How (summary) | Depends |
|----|------------|---------------|---------|
| L2-08 | Draft editor UI | Grid over draft bits; toggle cell; live `constructTapestry`; validity badge; write back into DesignSpec ops as `manualOverrides` or bake into draft snapshot | L2-04, L5-05 |
| L1-05 | Motif / region edit | Selection + yarn reassign on `cells.idx`; rebuild draft via assign; undo stack | L2-03 |
| L2-07 | Double-weave | Model `layers[2]` drafts + face index; render samples face; config schema bump | L2-01, L2-04 |
| L2-09 + L5-08 | Loom / WIF export | `export-wif.js` write/read; round-trip draft; JSON lift sidecar | L2-03 |
| L3-04 | Richer handloom | Procedural strand twist + thickness multi-octave in `weave.js`; keep deterministic | L3-02 done |
| L6-02 | Golden images | Fixture PNGs per mode; SSIM/pixel threshold in `test/golden` | construct stable |

---

## Phase 3 — Optional / research

| ID | Capability | How | Gate |
|----|------------|-----|------|
| L2-06 | CA structure search | Generate candidates → `validateDraft`/`repair`; expose as DesignSpec op `caSeed` | Only if library+ops feel limiting |
| L3-05 | Learned yarn shading | Spike only; compare to cord/handloom; **do not** vendor FabricGen | Product asks for photoreal |
| L4-04 | Diffusion / LLM drafts | **wontfix** unless funded | Explicit decision |

---

## Suggested milestones (engineering slices)

| Milestone | Map IDs | Outcome |
|-----------|---------|---------|
| **M1** Structure honesty | L2-01, L2-03 | Bigger library + repair/validity on every draft |
| **M2** Draft dataflow | L2-04, L2-05 | `draft-ops.js` + glitch; DesignSpec.ops |
| **M3** Spec as product surface | L4-02, L5-05, L4-03 | Edit DesignSpec in UI; provenance on save |
| **M4** Stronger priors | L1-03 | Fingerprints steer space not only gauge/palette |
| **M5** Authoring | L2-08, L1-05 | Draft + motif edit |
| **M6** Interchange | L2-09, L5-08, L2-07 | WIF/JSON loom export; optional double-weave |
| **M7** Appearance/QA | L3-04, L6-02 | Richer handloom + goldens |

---

## Tracking

- Source of truth for status: [`capability-map.csv`](./capability-map.csv) (`status`, `approach`, `depends_on`).
- After each milestone: run `npm test`, bump CSV rows, short note in PR.
- Do not mark a row `done` without its `acceptance_criteria` covered by a test or a manual UI check listed in the PR.

---

## Out of scope (unless reopened)

- Porting or depending on FabricGen / AdaCAD / WeavingLLM codebases.
- Replacing `constructTapestry` with a second photo-only renderer.
- End-to-end diffusion textiles (L4-04).
