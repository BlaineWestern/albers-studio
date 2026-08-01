# Albers Studio

Two tools. Photograph → layered weave model → tapestry. Environment + rug
fingerprints → generative textile design. React app, versioned renderers,
SQLite profiles.

## Run

    node server.js          # → http://localhost:4571  (Node 22+, no install)

| UI route | Tool | API |
|----------|------|-----|
| `/` | Home / picker | — |
| `/photo` | Image → textile | `POST /api/transform` |
| `/generate` | Env + style → textile | `POST /api/generate` |

Everything is prebuilt in `dist/`. The SQLite file (`studio.db`) is created
next to the server; set `STUDIO_DB=/path/to/db` to relocate it.

To rebuild after editing source: `npm install && npm run build`.

## Layers

    photograph                          (/photo · /api/transform)
      └─ photo mode  faithful | poster | tapestry | structure | document
      └─ geometry · palette · cells · structure → weave model
      └─ constructTapestry  (shared) Flat|Tile|Ribbon|Cord|Handloom

    environment + rug fingerprint       (/generate · /api/generate)
      └─ DesignSpec  named params from env + style prior
      └─ indexmap · validated draft · appearance plan
      └─ constructTapestry  (same pipeline)

Photo modes change how the image is *read* into a model. Generate builds a
model from DesignSpec. Both share `constructTapestry` for pixels.

Renderers only see the model — never the photograph. A saved profile
(config JSON in SQLite) re-renders bit-identically without the source image.
Fingerprints extracted from those profiles steer generative weaves.

See also: [`docs/generative-textile-methods.md`](docs/generative-textile-methods.md)
and [`docs/anni-albers-textile-profile.md`](docs/anni-albers-textile-profile.md).

## Photo transform API

`POST /api/transform` — `{ image:{w,h,data:base64RGBA}, mode?, quad?, flatten?, k?, cols?, save? }` → config  
`GET /api/transform/defaults` — schema + `photoModes` docs

Photo modes: **faithful** · **poster** · **tapestry** · **structure** · **document**.

## Generative / environment API

| Route | Purpose |
|-------|---------|
| `GET /api/configs/:id/fingerprint` | Extract style prior from a saved rug |
| `POST /api/fingerprint` | Fingerprint inline config and/or blend `profileIds` |
| `POST /api/generate` | `{ env, profileIds?, seed?, cols?, save? }` → config |
| `GET /api/generate/defaults` | Env schema + default fingerprint |

Env fields: `temperature` (°C), `humidity` (%), `wind` (m/s),
`precipitation` (mm), `light` (0–1), `season` (0–1).

## Weave aesthetics (V2)

Flat · Tile · Ribbon · Cord · Handloom, plus **Tightness** and **Roughness**.

## Tests

    npm test
    npm run test:unit
    npm run test:api
