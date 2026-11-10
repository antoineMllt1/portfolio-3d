# Portfolio 3D — Antoine Millot

The experimental version of the portfolio: a photoreal turntable rendered in Blender (Cycles) and
played by the scroll, like a product page. The classic, lighter portfolio lives in
[`portfolio-pro`](https://github.com/antoineMllt1/portfolio-pro); this site reads its projects,
certifications and contact details from that site's `/api/content`, so edits made in its `/admin`
show up here too.

## How it works

- **The film** — `render/scene.py` builds the turntable (plinth, platter, record, tonearm) with real
  materials and lights, animates five beats and renders 120 frames, once in 16:9 (desktop) and once
  in 9:16 (phones). It also exports where the labels and the record sit on screen for every frame.
- **The page** — `src/lib/sequence.js` draws the frame that matches the scroll position on a canvas,
  cross-fading between frames. Frames load coarse to fine (every 8th first), so the film works after
  about 15 images. Beats are the `[data-key]` sections in `src/App.jsx`.
- **The server** — `server/index.js` serves the build, relays `/api/content`, `/media` and `/uploads`
  from the main site (`MAIN_URL`), and falls back to `server/snapshot.json` if that site is down.

| Beat | Frame | On screen |
| --- | --- | --- |
| Intro | 1 | Whole turntable, name and role |
| Needle | 30 | Close-up as the needle drops |
| Teardown | 60 | Base, platter, record and arm apart, labelled Data / AI / Automation / Impact |
| Numbers | 90 | Orbit from the other side, key figures |
| Projects | 120 | Top-down record, project grid, then contact |

Reduced motion: no smooth scrolling, and the film jumps from beat to beat instead of playing.

## Rendering the film again

```bash
pip install bpy==5.2.3 pillow numpy   # official Blender module, ships OpenImageDenoise
python3 render/textures.py            # label + groove textures (run from render/)
python render/scene.py -- --variant wide --samples 24 --out render/out/wide
python render/scene.py -- --variant tall --samples 20 --out render/out/tall
npm run frames                         # → public/frames (WebP, 2 sizes per variant) + manifest
```

About 30 s per desktop frame on 4 CPU cores. `--still 30 --scale 50` renders one test frame.

## Run locally

```bash
npm install
npm run build
npm start              # http://localhost:3002 (MAIN_URL defaults to the live portfolio)
```
