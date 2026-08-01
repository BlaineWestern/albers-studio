# Albers Studio

Photograph → layered weave model → tapestry. React app, versioned renderers,
SQLite profiles. Also: environment readings + rug fingerprints → generative
tapestry.

## Run

    node server.js          # → http://localhost:4571  (Node 22+, no install)

Everything is prebuilt in `dist/`. The SQLite file (`studio.db`) is created
next to the server; set `STUDIO_DB=/path/to/db` to relocate it.

To rebuild after editing source: `npm install && npm run build`.

## Layers

    photograph
      └─ geometry   corner quad → homography flatten, pitch estimation
      └─ palette    Oklab over-clustering, k most-distinct yarns, roles
      └─ cells      indexmap: one yarn per thread crossing (mark-bias vote)
      └─ structure  per-role weave structures → binary draft (jacquard-style)
      └─ render     V1 / V1.2 (archived) · V2 (draft-derived)

    environment + rug fingerprint
      └─ fingerprint  gauge, palette Labs, role mix, floats, spatial priors
      └─ generative   env modulators → indexmap → same model / draft / render

Renderers only see the model — never the photograph. A saved profile
(config JSON in SQLite) re-renders bit-identically without the source image.
Fingerprints extracted from those profiles steer generative weaves.

## Versions (top-right toggle)

- **V1** — archived fat-cell renderer (one square per crossing)
- **V1.2** — archived two-scale renderer: fine ground + supplementary floats
- **V2** — draft-based weave aesthetics (see below)

## Weave aesthetics (V2)

| Mode | Method | Look |
|------|--------|------|
| **Flat** | Colour map only | Printed blocks — no interlacing |
| **Tile** | Binary draft tiles + edge shade | Classic loom-honest V2 |
| **Ribbon** | Elliptical yarn bodies + gaps | Surface yarn mapping; gaps open with looseness |
| **Cord** | Radial cylinder shading | Rounder threads (cross-section model) |
| **Handloom** | Yarn sliding + thickness jitter + tension noise | Irregular handwoven character |

**Tightness** (0.15–1): packed ↔ open — controls yarn fill vs void between warp/weft.
**Roughness** (0–1): machine-regular ↔ handloom — sliding, thickness jitter, flyaway flecks,
tension grain (strongest in Handloom mode).

These controls apply in both **Photo** and **Generate** app modes.

See also: [`docs/generative-textile-methods.md`](docs/generative-textile-methods.md)
(input → DesignSpec → indexmap / draft / appearance) and
[`docs/anni-albers-textile-profile.md`](docs/anni-albers-textile-profile.md).

## Generative / environment API

| Route | Purpose |
|-------|---------|
| `GET /api/configs/:id/fingerprint` | Extract style prior from a saved rug |
| `POST /api/fingerprint` | Fingerprint an inline config and/or blend `profileIds` |
| `POST /api/generate` | `{ env, profileIds?, seed?, cols?, save? }` → config |
| `GET /api/generate/defaults` | Env schema + default fingerprint |

Env fields: `temperature` (°C), `humidity` (%), `wind` (m/s),
`precipitation` (mm), `light` (0–1), `season` (0–1). These tint palette Labs,
reshape mark/field density, and stretch spatial anisotropy while the selected
rug fingerprint(s) supply gauge, yarns, structures, and float priors.

UI: header **Photo | Generate** mode switch.

## Exports

PNG (raster) · SVG with one layer per yarn (Illustrator/Inkscape layer
groups, ground as a single rect, integer path data) · Draft PNG (black =
warp up) · Profile JSON → SQLite.

## Tests

    npm test                # unit + API integration
    npm run test:unit       # pipeline / generative only
    npm run test:api        # HTTP routes against a throwaway server

Unit suite uses a synthetic woven fixture (always available). If
`/tmp/fx/pasture.raw` exists, an extra real-photo fidelity gate runs too.
