# Albers Studio

Photograph → layered weave model → tapestry. React app, versioned renderers,
SQLite profiles.

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

Renderers only see the model — never the photograph. A saved profile
(config JSON in SQLite) re-renders bit-identically without the source image.

## Versions (top-right toggle)

- **V1** — archived fat-cell renderer (one square per crossing)
- **V1.2** — archived two-scale renderer: fine ground + supplementary floats
- **V2** — draft-based: every yarn's role maps to a lift structure; the render
  is derived from the binary draft a TC2-class loom could read. Export the
  draft itself with the Draft button.

## Exports

PNG (raster) · SVG with one layer per yarn (Illustrator/Inkscape layer
groups, ground as a single rect, integer path data) · Draft PNG (black =
warp up) · Profile JSON → SQLite.

## Tests

    node test/run.mjs

Runs the fuzzy suite against the real Pasture photograph: model shape,
three renderers, responsive equivalence, config round-trip, SVG layer
structure, draft sanity.
