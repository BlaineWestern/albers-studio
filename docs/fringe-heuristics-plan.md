# Fringe Heuristics Plan — Robust Craft × Physics

Plan to harden **Fringe** mode’s **Border** / **Border rough** model so craft and physics are independently meaningful — not noise remapped into tension/stiffness labels.

**Scope:** appearance layer only (`src/pipeline/render/weave.js` + construct/UI wiring).  
**Out of scope:** learned yarn BRDF (L3-05), cloth FEM, FabricGen/AdaCAD code.

**Status:** F1 implemented (arc-length T/k/m + debug exports + UI ledger readout). F2–F5 pending.

---

## Current baseline (honest)

| Claim | What we actually do |
|-------|---------------------|
| Tension / stiffness / mass | Sampled then collapsed into one sag scalar |
| Gravity | Screen +Y cantilever `∝ t²`; top fringe still grows −Y then sags |
| Twist / yarn memory | Single sine on lateral offset |
| Ply split | Binary 1→2 strands when `fray > 0.45` |
| Hairiness | Shade noise on disk stamps |
| Craft cut | IID length / missing ends — no edge correlation |
| Material coupling | Ignores yarn role, float budget, structure; sett only thins radius |

**Verdict:** useful visual dial; weak as craft finish model and as free-end mechanics.

---

## Principles

1. **Two ledgers.** Craft params and physics params are named, sampled, and applied in separate stages — then composed on one path.
2. **Conserved length.** Droop bends an arc-length curve; it does not stretch rubber threads.
3. **Independent knobs inside one slider.** `borderRoughness` remains the UI dial; internally it modulates a *vector* of craft + physics amounts (not one noise amp).
4. **Loom / finish honesty.** Prefer behaviours a weaver would recognize: scissors pass, twisted bundles, tip wear — over abstract particle glitter.
5. **Determinism.** Same `seed` + opts → bit-identical raster (keep mulberry32 / `nz` / `slide1`).
6. **No ML.** Procedural only; photo refs are for A/B validation, not training.

---

## Target architecture

```
border, borderRoughness, tightness, seed, yarn/role context
        │
        ▼
┌───────────────────┐     ┌────────────────────────────┐
│ Craft ledger      │     │ Physics ledger             │
│ · cut groups      │     │ · T, k, m per end          │
│ · length field    │     │ · free-end response        │
│ · missing / knot  │     │ · arc-length integrate     │
│ · tip finish      │     │ · tip fray / ply count     │
│ · bundle twist    │     │ · neighbor crowding        │
└─────────┬─────────┘     └─────────────┬──────────────┘
          │                             │
          └──────────► path samples ◄───┘
                          │
                          ▼
                   stamp / shade strand
                          │
                          ▼
                   tip fade polish (craft)
```

**API surface (keep public knobs stable):**

| Opt | Role |
|-----|------|
| `border` | Max extension budget (pad scale) |
| `borderRoughness` | Mix amount for both ledgers |
| `tightness` | Sett → radius + crowding rest length |
| `seed` | Determinism |

Optional later (not required for M1–M3): `fringeStyle: 'cut' \| 'twisted' \| 'knotted'` as a craft preset that reweights the ledger.

---

## Milestone map

| ID | Focus | Done when |
|----|--------|-----------|
| **F1** | Decouple physics ledger + arc-length paths | **done** — sag at fixed length; T/k/m distinct; debug exports + UI readout |
| **F2** | Robust craft ledger (grouped cut, bundles) | Edge-correlated lengths; optional twisted/knotted groups |
| **F3** | Material + sett coupling | Role/thickness/sett change droop/fray/splay measurably |
| **F4** | Tip & appearance honesty | Continuous ply count; geometric hair flecks; less pure shade noise |
| **F5** | Validation harness | Histogram / droop metrics + golden fringe fixtures |

Ship order: **F1 → F2 → F3 → F4 → F5** (F5 tests land incrementally from F1).

---

## F1 — Physics ledger + conserved-length paths

### How

1. **Replace collapsed sag** with an explicit per-end state:
   - `T` tension ∈ [0,1] — resists lateral release and reduces curvature
   - `k` stiffness ∈ [0,1] — resists bending (curvature gain)
   - `m` mass ∈ [0,1] — gravity load scale  
   Sample with small independent noise; `borderRoughness` sets *means and spreads*, not a single multiplier on everything.

2. **Free-end response** (2D, image space):
   - Outward unit `ô` from selvedge; gravity `ĝ = (0,1)`.
   - Integrate a discrete curve with **arc-length** `L` (from craft length):
     - Curvature κ(t) ∝ `(m / max(ε,k)) · (1 − αT) · |ĝ × ô|` plus a soft alignment term so hanging sides droop “down,” top ends curl under gravity instead of stretching.
   - Use small-step polyline (`ds = L/N`); position is sum of `ds · tangent` — length conserved by construction.

3. **Lateral release** as residual set: initial tangent bias ⊥ `ô`, decaying with `T` along the curve (not a separate unbounded sine amp). Keep a *small* twist modulation as perturbation on tangent, amplitude ∝ `(1−k)·rough`.

4. **Pad budget** from max of: craft `L`, expected droop AABB, crowding — so tips stay on-canvas without the old “stretch pad with rough” hack as the only strategy.

### Touch
`weave.js` (`fringePhysics`, `paintFringeStrand`); unit tests in `test/run.mjs`

### Done when
- Fixed `L`, raising `m` or lowering `k` increases vertical droop / curl without increasing polyline length beyond tolerance (~1%). ✅
- Raising `T` at fixed `m,k` reduces lateral deviation. ✅
- `borderRoughness` still moves pixels >2%; determinism preserved. ✅
- Doc comment in `weave.js` lists the ledger formulas in one place. ✅
- UI shows mean T/k/m readout (`taut` / `soft` / `heavy`). ✅
- Exported debug: `fringeLedgerMeans`, `sampleFringeEnd`, `integrateFringePath`. ✅

### Debug cheatsheet
```js
import { fringeLedgerMeans, integrateFringePath } from './render/weave.js';
fringeLedgerMeans(0.9); // → { T, k, m, label: 'heavy' }
integrateFringePath({ ax:0, ay:0, ox:1, oy:0, len:40, T:0.3, k:0.4, m:0.8, rough:0.5 });
// → { points, arcLength, tip, droop, maxLateral, kappa }
```

### Risks
Over-curving at high rough → clamp κ; keep N adaptive with `L`. (κ scale tuned so T/k/m stay separable.)

---

## F2 — Craft ledger (finish behaviours)

### How

1. **Scissors / cut field** along each edge:
   - Low-frequency 1D noise (or smoothstep groups of size `G ≈ 3…8` ends) shared by neighbors → correlated lengths.
   - High-frequency IID jitter scaled by rough → hand irregularity inside a group.

2. **Missing ends** as craft attrition:
   - Probability rises with rough; prefer isolated misses (inhibit adjacent miss) so the edge doesn’t look like random salt.

3. **Bundles** (when rough above a threshold, or future `fringeStyle`):
   - Group every `B` ends; shared anchor; slight collective twist of the bundle axis; optional overhand “knot” blob near the root (disk cluster) for knotted style later.

4. **Tip finish pass** stays craft-side: opacity/value taper in pad space, but driven by each strand’s *actual tip position* (from F1 path), not only a rect pad distance field.

5. **Corner policy:** warp and weft fringe meet at corners — prefer warp dominance or a short gap so corners don’t double-paint into a blot.

### Touch
`weave.js` craft sampling helpers; optional `fringeStyle` in `WEAVE_DEFAULTS` + UI later

### Done when
- Autocorrelation of lengths along an edge is higher than IID baseline at same rough.
- Missing ends rarely form runs of ≥3 at default rough.
- Bundle mode (even if auto-only) visibly groups strands vs cut-only.
- Tip fade follows drooped tips (no rectangular “frame” of darkness when strands curl in).

---

## F3 — Material & sett coupling

### How

1. Pass into fringe: per-end yarn rgb **and** role (warp colour vs edge weft cell role if available), plus `tightness`.
2. Priors:
   - Thicker fill / lower tightness → higher `m`, larger radius, more fray.
   - Supplementary role → more fray, slightly less `T`.
   - High tightness → shorter crowding rest length, less splay.
3. Optional: float stats from draft near the edge bias “loose selvedge” (lower `T`).

### Touch
`renderFringe` call sites; maybe thin helpers reading `model.cells` / roles

### Done when
Unit test: same geometry, different tightness or role mix → measurable change in mean tip droop or mean tip radius; cloth body checksum unchanged when only `borderRoughness` changes.

---

## F4 — Tip & strand appearance

### How

1. **Continuous ply count** `p = 1 + floor(fray·pMax)` with smooth lateral offsets; each ply thinner (`r/√p`).
2. **Geometric hair:** sparse short offset stamps near tip (not only shade noise), density ∝ fray.
3. Keep cylinder shade; reduce reliance on multi-octave shade noise as the primary “rough” cue.
4. Root thickening mild; tip diameter falloff tied to fray + wear craft term.

### Done when
High fray shows split tips in structure (ply offsets), not only noisier colour; low fray stays single clean cord.

---

## F5 — Validation harness

### Metrics (deterministic, on synthetic model)

| Metric | Intent |
|--------|--------|
| `lengthHist` | Craft cut distribution / group correlation |
| `meanDroop` | Physics gravity response vs `m,k` |
| `tipRadiusRatio` | Taper honesty |
| `pixelΔ(rough)` | Regression: dial still alive |
| Golden PNG checksums | Lock visual contracts for 2–3 fringe fixtures |

### Touch
`test/run.mjs`, `test/golden/weave-checksums.json` (add fringe entries)

### Done when
F1–F4 each have at least one metric assertion; goldens updated once per milestone, not every WIP commit.

---

## UI / product

Keep **Border** and **Border rough** as the only fringe sliders for now.

- Update tooltip / note to: *“Craft cut + free-end physics (droop, tension, tip fray).”*
- After F2, optional third control or segmented `fringeStyle` if bundles need a clear preset — only if auto bundling is ambiguous in the UI.

Appearance plan / provenance: record `border`, `borderRoughness`, and later `fringeStyle` in weave meta (already partially present via construct opts).

---

## Non-goals

- Full fiber or cloth simulation
- Learned BRDF / neural yarn (L3-05)
- Physics for cloth **Roughness** / handloom body (separate track)
- Porting FabricGen procedural yarn code

---

## Effort characterization (technical, not calendar)

| Milestone | Invasiveness | Main risk |
|-----------|--------------|-----------|
| F1 | Medium — rewrite path integrator | Curvature blow-up; pad cropping |
| F2 | Medium — edge sampling + corners | Corner double-paint; bundle clutter |
| F3 | Low–medium — thread context in | Overfitting priors to one palette |
| F4 | Low — stamp strategy | Perf if hair stamps too dense |
| F5 | Low — tests/goldens | Brittle goldens if F1 still tuning |

---

## Suggested first implementation slice

**F1 + minimal F5:** decoupled `T,k,m`, arc-length integrate, tests for length conservation and droop monotonicity. Leave craft IID lengths temporarily so the physics win is isolatable; then F2 swaps in the cut field without retuning gravity.

---

## Map / docs sync

When implementation starts:

1. Add row to `capability-map.csv` e.g. `L3-07 appearance | Fringe craft+physics ledgers | …`
2. Link this doc from `capability-implementation-plan.md` under appearance follow-ons.
3. Keep `generative-textile-methods.md` appearance bullet accurate (“fringe = craft finish + free-end response”).
