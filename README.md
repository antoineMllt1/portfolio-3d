# Portfolio 3D — Antoine Millot

A portfolio shot like a film: a turntable and a crate of records on a sideboard, rendered in
Blender (Cycles) and played by the page. Each project is a record sleeve in the crate.

The lighter, classic portfolio lives in [`portfolio-pro`](https://github.com/antoineMllt1/portfolio-pro).
This site reads its projects, certifications and contact details from that site's `/api/content`.

## How it works

- **The scene** (`render/`) is built at real-world scale: a scanned sideboard, plant and lamp, wood
  and plaster textures and a room HDRI from Poly Haven (CC0); the turntable and the crate are
  modelled in code (`parts.py`), down to the cartridge leads, the strobe dots and the dust.
- **The sleeves** (`scripts/covers/covers.cjs`) are designed as a label series, one front and one
  back per project, and printed into the scene as textures: they take the room's light and shadows.
- **The film** (`render/scene.py`) is two frame sequences with motion blur, plus bigger "rest" frames:
  - `f`, 121 frames: the camera travels between five beats (intro, stylus, controls, crate, room);
  - `c`, 116 frames: going through the crate; record *k* is pulled up at frame `6 + 10k`;
  - 17 rest frames (one per beat and per record) at 2560 px, 96 samples.
- **The page** (`src/`) has five floors. One wheel step, swipe or key moves one floor and the film
  travels there (`lib/film.js`, `lib/input.js`). On the projects floor, picking a title plays the
  crate sequence up to that record. At rest the clean frame fades in and drifts very slowly.
- **The server** (`server/index.js`) serves the build and relays `/api/content`, `/media` and
  `/uploads` from the main site (`MAIN_URL`), with `server/snapshot.json` as a fallback.

Reduced motion: no travel and no drift; floors and records change with a short dissolve.

### Adding a project

The sleeves are part of the rendered film, so a new project needs a sleeve and a render: add it to
`P` in `scripts/covers/covers.cjs`, run the covers script and render again. Until then, a project
that exists in the admin but not in the crate is listed under the others with a link to its case study.

## Rendering

```bash
pip install bpy==5.2.3 pillow numpy            # official Blender module (ships OpenImageDenoise)
python3 render/fetch_assets.py                  # Poly Haven assets → render/assets (245 MB, not committed)
node scripts/covers/covers.cjs                  # sleeves → render/covers + public/covers
python render/scene.py -- --holds --scale 160 --samples 96 --out render/out/wide
python render/scene.py -- --seq f --scale 80 --samples 16 --out render/out/wide
python render/scene.py -- --seq c --scale 80 --samples 16 --out render/out/wide
npm run frames                                  # → public/frames (WebP) + manifest.json
```

On 4 CPU cores: about 5 min per rest frame, 45 s per motion frame. Renders resume where they stopped.
`--still 91 --scale 50` renders one test frame; `--variant tall` frames the scene for phones.

## Run locally

```bash
npm install
npm run build
npm start              # http://localhost:3002 (MAIN_URL defaults to the live portfolio)
```
