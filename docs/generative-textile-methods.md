# Generative Textile Design — Methods & Studio Architecture

How solid generative textile systems work, and how Albers Studio’s **Generate** mode is meant to work as an **input → textile design** pipeline (not as a photo filter).

---

## What the research agrees on

Across FabricGen, AdaCAD, computational craft tools, data→textile projects (Vibeweaving, Aural Textiles), and classical CA/jacquard work, good systems share the same skeleton:

### 1. Decouple layers (do not paint “fake cloth” in one step)

| Layer | Responsibility | Analogues |
|-------|----------------|-----------|
| **Macro / colour** | Which yarn where (motif, regions, shares) | FabricGen albedo path; our cell indexmap |
| **Structure / draft** | Warp-up vs weft-up at each crossing | AdaCAD operations; WeavingLLM drafts; our `buildDraft` |
| **Appearance** | Yarn body, gaps, roughness, shading | FabricGen procedural yarn; our weave modes |

Albers’ own split — pictorial colour vs weave structure vs tactile yarn — is the craft version of this.

### 2. Prefer parametric dataflows over opaque generators

**AdaCAD** treats drafting as chained parameterized operations: change an input, the draft updates. Valid generative textile design should expose named knobs (gauge, structure family, float budget, density) that inputs *modulate*, rather than a black-box image.

### 3. Stay loom-honest

- Start from **known valid structures** (plain / twill / satin / documented floats), then modulate — as in generative glitch-draft tools that Perlin-perturb a base weave rather than inventing illegal lift plans.
- Enforce **constraints**: every row/column needs interlacement; floats should respect a max length (TexCel CA filters; AdaCAD validity; jacquard dither controlling intersection count).
- Export a **draft** that could, in principle, be read by a loom (TC2 / jacquard-class), not only a pretty PNG.

### 4. Map external data with an explicit transform

Data-driven textile projects (Vibeweaving, Aural Textiles, weather sonification) use a clear pipeline:

```
capture → normalize → map to textile parameters → constrain → materialize → record provenance
```

They do **not** dump sensor values straight into pixels. Provenance (what was measured, which style prior, which seed) travels with the output.

### 5. Style priors are first-class

FabricGen’s WeavingLLM / procedural params and AdaCAD’s saved operations both treat “how this cloth behaves” as reusable knowledge. Our **rug fingerprints** play that role: gauge, palette Labs, role mix, float stats, spatial priors.

---

## Methods we evaluated

| Method | Strength | Fit for this studio |
|--------|----------|---------------------|
| **Parametric draft ops (AdaCAD)** | Editable, loom-native, composable | Core architecture we follow |
| **Known-structure + noise glitch** | Organic variation, still weaveable | Used in indexmap + appearance roughness |
| **CA weave generators** | Huge variety of dobby patterns | Optional future; must filter for float/bind validity |
| **Image → jacquard dither** | Photo fidelity | That is our **Photo** path, not Generate |
| **Diffusion + LLM drafts (FabricGen)** | Rich visuals | Heavy; we keep procedural + fingerprint instead of ML |
| **Data→textile with provenance** | Honest environmental work | Matches Generate + env inputs |

**Best conceptual fit for “generate designs from inputs”:**  
parametric, layered, loom-valid generation steered by a style prior — *not* end-to-end image synthesis.

---

## Albers Studio Generate mode (target architecture)

```
Inputs
  ├─ environmental / numeric readings   (temperature, humidity, wind, …)
  ├─ style prior                        (fingerprint from saved rugs, or default)
  └─ seed / gauge overrides
        ↓
DesignSpec  (named parameters — the AdaCAD-like dataflow surface)
  ├─ gauge          cols, rows, wefted
  ├─ palettePlan    Labs + role targets + shares
  ├─ structurePlan  role → plain|twill|basket|weft5|satin8
  ├─ densityPlan    mark boost, field breakup, anisotropy, run length
  └─ appearancePlan tightness, roughness, preferred weave mode
        ↓
Materialize (three layers)
  ├─ 1. indexmap     macro colour / yarn assignment
  ├─ 2. draft        binary lift plan from structures (validated)
  └─ 3. constructTapestry  shared weave aesthetic (tile/ribbon/cord/handloom) using appearancePlan
        ↓
Outputs
  ├─ model + config profile (re-renderable without inputs)
  ├─ draft PNG / SVG layers
  └─ provenance     env, style name, seed, DesignSpec snapshot
```

Photo uses the same construction step after its own **PHOTO_MODES** analysis path
(`faithful` · `poster` · `tapestry` · `structure` · `document`). Modes change how
the photograph becomes a model; `constructTapestry` is shared.

### Input → parameter map (current)

| Input | DesignSpec effect |
|-------|-------------------|
| Temperature / season / light | Palette Lab tint (warmth, hue, lightness) |
| Precipitation / humidity | Supplementary mark density; slightly looser appearance |
| Wind | Field breakup, spatial anisotropy, higher roughness |
| Rug fingerprint | Gauge, yarn Labs/roles/shares, structure assign, float/spatial priors |
| Seed | Deterministic noise for indexmap + handloom irregularity |

### Non-negotiables

1. **Colour and structure stay separate** — never bake interlacing into the indexmap.
2. **Draft comes from named structures** assigned by role, then validated.
3. **Generate mode does not require a photograph** — inputs + prior only.
4. **Every generative result is saveable as a profile** and re-renderable bit-identically.
5. **Provenance is part of the artifact**, not an afterthought.

---

## What Generate mode is *for*

Future product framing: Generate is the mode that turns **external inputs + rug style** into a **textile design** (model, draft, exports). Photo remains the path that *analyses* an existing cloth via its own photo modes. Both feed **`constructTapestry`** — weave aesthetics (tightness, handloom roughness) are the shared appearance layer once a model exists.

This keeps faith with Albers: structure first, materials articulate, industry-honest drafts — with environmental or other data acting as the parametric driver, not as a texture pasted on.

---

## Sources

- FabricGen (CVPR 2026) — macro texture vs micro draft/procedural yarn  
- AdaCAD (CHI 2023) — parametric weave notation / dataflows; draft validity  
- generative_weaving (Gelosi) — base structures + Perlin glitch  
- TexCel / CA weave design — constraint filtering for bind & float  
- Jacquard pattern from visual impressions (IEEE TII) — controlled intersections  
- Vibeweaving / Aural Textiles — data capture → map → loom constraints → provenance  
- Anni Albers, *On Weaving* — structure/colour/tactility as distinct decisions  

See also: [`anni-albers-textile-profile.md`](./anni-albers-textile-profile.md)
