// Record sleeves for the crate: one front and one back per project, plus the record label.
// A small label series ("AM Records"): same grid and type, one palette and one motif per project.
//   node scripts/covers/covers.cjs        → render/covers/*.png (scene textures) + public/covers/*.webp
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'render', 'covers');
const S = 1400;

// ---- deterministic random ----
function rng(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

// ---- motifs (SVG fragments in a 1000×1000 box) ----
const M = {
  funnel: (c) => {
    // 100 dots, 10 kept
    const r = rng(11);
    const keep = new Set();
    while (keep.size < 10) keep.add(Math.floor(r() * 100));
    let s = '';
    for (let i = 0; i < 100; i++) {
      const x = 95 + (i % 10) * 90;
      const y = 95 + Math.floor(i / 10) * 90;
      s += keep.has(i) ? `<circle cx="${x}" cy="${y}" r="34" fill="${c.accent}"/>` : `<circle cx="${x}" cy="${y}" r="30" fill="none" stroke="${c.ink}" stroke-width="5" opacity=".55"/>`;
    }
    return s;
  },
  graph: (c) => {
    const r = rng(5);
    const pts = Array.from({ length: 13 }, () => [80 + r() * 840, 80 + r() * 840]);
    let s = '';
    pts.forEach((p, i) => pts.forEach((q, j) => {
      if (j > i && Math.hypot(p[0] - q[0], p[1] - q[1]) < 380) s += `<line x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}" stroke="${c.ink}" stroke-width="5"/>`;
    }));
    pts.forEach((p, i) => (s += `<circle cx="${p[0]}" cy="${p[1]}" r="${i % 4 === 0 ? 46 : 22}" fill="${i % 4 === 0 ? c.accent : c.ink}"/>`));
    return s;
  },
  diamonds: (c) => {
    let s = '';
    for (let i = 0; i < 9; i++) {
      const k = 470 - i * 52;
      s += `<path d="M500 ${500 - k} L${500 + k * 0.72} 500 L500 ${500 + k} L${500 - k * 0.72} 500 Z" fill="none" stroke="${i === 4 ? c.accent : c.ink}" stroke-width="${i === 4 ? 12 : 4}"/>`;
    }
    return s;
  },
  skyline: (c) => {
    const r = rng(23);
    let s = '';
    let x = 40;
    while (x < 960) {
      const w = 50 + r() * 70;
      const h = 180 + r() * 620;
      s += `<rect x="${x}" y="${1000 - h}" width="${Math.min(w, 960 - x)}" height="${h}" fill="${r() > 0.78 ? c.accent : c.ink}"/>`;
      x += w + 14;
    }
    return s + `<circle cx="790" cy="170" r="92" fill="${c.accent}"/>`;
  },
  three: (c) => {
    let s = '';
    for (let i = 0; i < 3; i++) s += `<path d="M${60 + i * 300} 940 V${520 - i * 190} h240 V940 Z" fill="${i === 2 ? c.accent : c.ink}"/>`;
    return s + `<path d="M40 960 H960" stroke="${c.ink}" stroke-width="14"/>`;
  },
  bars: (c) => {
    const h = [240, 300, 280, 390, 430, 520, 600, 580, 720, 860];
    let s = '';
    h.forEach((v, i) => (s += `<rect x="${52 + i * 92}" y="${960 - v}" width="64" height="${v}" fill="${i === 9 ? c.accent : c.ink}"/>`));
    return s + `<path d="M84 700 L900 80" stroke="${c.accent}" stroke-width="10" stroke-dasharray="4 26" stroke-linecap="round"/>`;
  },
  clock: (c) => {
    let s = `<circle cx="500" cy="500" r="450" fill="none" stroke="${c.ink}" stroke-width="18"/>`;
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      const r1 = i % 5 === 0 ? 360 : 400;
      s += `<line x1="${500 + Math.sin(a) * r1}" y1="${500 - Math.cos(a) * r1}" x2="${500 + Math.sin(a) * 425}" y2="${500 - Math.cos(a) * 425}" stroke="${c.ink}" stroke-width="${i % 5 === 0 ? 12 : 4}"/>`;
    }
    return s + `<path d="M500 500 L500 150" stroke="${c.accent}" stroke-width="22" stroke-linecap="round"/><path d="M500 500 L560 150" stroke="${c.ink}" stroke-width="10" stroke-linecap="round"/><circle cx="500" cy="500" r="30" fill="${c.accent}"/>`;
  },
  meridian: (c) => {
    let s = `<circle cx="500" cy="500" r="450" fill="none" stroke="${c.ink}" stroke-width="8"/>`;
    for (let i = 1; i < 6; i++) s += `<ellipse cx="500" cy="500" rx="${i * 75}" ry="450" fill="none" stroke="${c.ink}" stroke-width="5"/>`;
    for (let i = -3; i <= 3; i++) {
      const y = 500 + i * 120;
      const w = Math.sqrt(450 * 450 - (i * 120) ** 2);
      s += `<line x1="${500 - w}" y1="${y}" x2="${500 + w}" y2="${y}" stroke="${c.ink}" stroke-width="5"/>`;
    }
    return s + `<ellipse cx="500" cy="500" rx="225" ry="450" fill="none" stroke="${c.accent}" stroke-width="16"/>`;
  },
  radar: (c) => {
    let s = '';
    const n = 7;
    const pt = (i, r) => `${500 + Math.sin((i / n) * Math.PI * 2) * r},${500 - Math.cos((i / n) * Math.PI * 2) * r}`;
    for (let k = 1; k <= 4; k++) s += `<polygon points="${Array.from({ length: n }, (_, i) => pt(i, k * 112)).join(' ')}" fill="none" stroke="${c.ink}" stroke-width="4"/>`;
    for (let i = 0; i < n; i++) s += `<line x1="500" y1="500" x2="${pt(i, 448).split(',')[0]}" y2="${pt(i, 448).split(',')[1]}" stroke="${c.ink}" stroke-width="4"/>`;
    const v = [410, 250, 380, 300, 430, 210, 340];
    return s + `<polygon points="${v.map((r, i) => pt(i, r)).join(' ')}" fill="${c.accent}" fill-opacity=".88" stroke="${c.ink}" stroke-width="8"/>`;
  },
  rings: (c) => {
    let s = '';
    for (let i = 0; i < 17; i++) s += `<circle cx="330" cy="620" r="${40 + i * 56}" fill="none" stroke="${c.ink}" stroke-width="${i % 4 === 0 ? 10 : 3}"/>`;
    return s + `<circle cx="330" cy="620" r="40" fill="${c.accent}"/><circle cx="726" cy="224" r="22" fill="${c.accent}"/><circle cx="820" cy="700" r="14" fill="${c.accent}"/>`;
  },
  flow: (c) => {
    let s = '';
    const rows = [200, 500, 800];
    rows.forEach((y, r) => {
      for (let i = 0; i < 4; i++) {
        const x = 60 + i * 235;
        const on = (r + i) % 3 === 0;
        s += `<rect x="${x}" y="${y - 80}" width="170" height="160" rx="80" fill="${on ? c.accent : 'none'}" stroke="${c.ink}" stroke-width="8"/>`;
        if (i < 3) s += `<path d="M${x + 180} ${y} h44" stroke="${c.ink}" stroke-width="8"/>`;
      }
    });
    return s + `<path d="M882 280 V420 M118 580 V720" stroke="${c.ink}" stroke-width="8"/>`;
  },
  wave: (c) => {
    const r = rng(41);
    let s = '';
    for (let i = 0; i < 46; i++) {
      const h = 60 + Math.abs(Math.sin(i * 0.42) * Math.cos(i * 0.13)) * 620 + r() * 120;
      s += `<rect x="${40 + i * 20.2}" y="${500 - h / 2}" width="11" height="${h}" rx="5" fill="${i > 17 && i < 26 ? c.accent : c.ink}"/>`;
    }
    return s;
  },
};

// ---- the series ----
const P = [
  { slug: 'revenue-engine-hackathon', big: 'Revenue Engine', small: 'Hackathon', tags: 'Clay · lemlist · HubSpot · OpenAI', motif: 'funnel', bg: '#2343B4', ink: '#F1EADB', accent: '#F2A93B', layout: 'A' },
  { slug: 'spendmap', big: 'SpendMap', small: 'Finance · IA', tags: 'n8n · RAG · Neo4j · Agents IA', motif: 'graph', bg: '#EDE5D3', ink: '#0E1F45', accent: '#D8472A', layout: 'B' },
  { slug: 'lvmh', big: 'LVMH', small: 'Dashboard', tags: 'Pipeline IA · Dataviz', motif: 'diamonds', bg: '#15110E', ink: '#C8A45E', accent: '#EFE6D2', layout: 'C' },
  { slug: 'estimia', big: 'Estimia', small: 'Immobilier · PropTech', tags: 'Web app · Data', motif: 'skyline', bg: '#C4522E', ink: '#F3E9D8', accent: '#14254F', layout: 'A' },
  { slug: 'hackathon-3m', big: '3M', small: 'Hackathon · Finaliste', tags: 'Make · Mistral AI · Agents IA', motif: 'three', bg: '#EFA72E', ink: '#15110E', accent: '#C5301F', layout: 'B' },
  { slug: 'carrefour', big: 'Carrefour', small: 'Dashboard', tags: 'Looker Studio · Dataviz', motif: 'bars', bg: '#1E4939', ink: '#F0E8D6', accent: '#F2A93B', layout: 'A' },
  { slug: 'devis-traiteur', big: 'Devis Traiteur', small: 'Automatisation', tags: 'Automatisation · Web app', motif: 'clock', bg: '#EDE5D3', ink: '#23261C', accent: '#D8472A', layout: 'C' },
  { slug: 'meridian', big: 'Meridian', small: 'Conseil · SaaS', tags: 'IA générative · Web app', motif: 'meridian', bg: '#0F3A45', ink: '#CFE2E4', accent: '#F2A93B', layout: 'B' },
  { slug: 'riskscope', big: 'RiskScope', small: 'Private Equity', tags: 'IA générative · Web app', motif: 'radar', bg: '#F1ECE0', ink: '#141414', accent: '#2343B4', layout: 'A' },
  { slug: 'seo-geo-control-room', big: 'SEO / GEO', small: 'Control Room', tags: 'Scraping · Python · Next.js', motif: 'rings', bg: '#3A1E3E', ink: '#F0D9D2', accent: '#E8C24A', layout: 'B' },
  { slug: 'hackathon-payfit', big: 'PayFit', small: 'Hackathon', tags: 'n8n · GPT-4o · Agents IA', motif: 'flow', bg: '#8DB3D8', ink: '#0E1F45', accent: '#F4EFE3', layout: 'A' },
  { slug: 'licter-fnac-darty', big: 'Fnac Darty', small: 'BDD Licter ×', tags: 'Make · Python · Scraping · GPT-4o · Supabase', motif: 'wave', bg: '#B3282A', ink: '#F2E8D5', accent: '#15110E', layout: 'C' },
];

const css = `
  * { box-sizing: border-box; margin: 0; }
  body { width: ${S}px; height: ${S}px; overflow: hidden; font-family: 'Inter Display', Inter, sans-serif; }
  .c { position: relative; width: ${S}px; height: ${S}px; padding: 64px; }
  .mono { font-family: 'JetBrains Mono', monospace; font-weight: 500; letter-spacing: .14em; text-transform: uppercase; font-size: 21px; }
  .top { position: absolute; left: 64px; right: 64px; top: 56px; display: flex; justify-content: space-between; align-items: center; }
  .rule { position: absolute; left: 64px; right: 64px; top: 104px; height: 3px; }
  .bottom { position: absolute; left: 64px; right: 64px; bottom: 54px; display: flex; justify-content: space-between; align-items: flex-end; }
  .big { font-weight: 900; letter-spacing: -.045em; line-height: .86; }
  .small { font-weight: 500; letter-spacing: -.01em; }
  svg { position: absolute; display: block; }
  .logo { display: inline-flex; align-items: center; gap: 12px; }
  .logo i { width: 30px; height: 30px; border-radius: 50%; border: 3px solid currentColor; position: relative; display: inline-block; }
  .logo i::after { content: ''; position: absolute; inset: 9px; border-radius: 50%; background: currentColor; }
`;

function front(p, i) {
  const no = `AM-${String(i + 1).padStart(3, '0')}`;
  const svg = (x, y, w) => `<svg viewBox="0 0 1000 1000" style="left:${x}px;top:${y}px;width:${w}px;height:${w}px">${M[p.motif](p)}</svg>`;
  const len = p.big.length;
  const size = (max) => Math.min(max, Math.floor((1272 / len) * 1.6));
  let body = '';
  if (p.layout === 'A') {
    body = `${svg(64, 150, 800)}
      <div style="position:absolute;left:64px;right:64px;bottom:128px">
        <div class="small" style="font-size:44px;margin-bottom:14px;color:${p.accent === p.bg ? p.ink : p.accent}">${p.small}</div>
        <div class="big" style="font-size:${size(250)}px">${p.big}</div>
      </div>`;
  } else if (p.layout === 'B') {
    body = `<div style="position:absolute;left:64px;right:64px;top:140px">
        <div class="big" style="font-size:${size(290)}px">${p.big}</div>
        <div class="small" style="font-size:44px;margin-top:20px;color:${p.accent}">${p.small}</div>
      </div>
      ${svg(S - 64 - 760, S - 128 - 760, 760)}`;
  } else {
    body = `${svg(290, 150, 820)}
      <div style="position:absolute;left:64px;right:64px;bottom:128px">
        <div class="small" style="font-size:44px;margin-bottom:14px;color:${p.accent}">${p.small}</div>
        <div class="big" style="font-size:${size(230)}px">${p.big}</div>
      </div>`;
  }
  return `<style>${css}</style><div class="c" style="background:${p.bg};color:${p.ink}">
    <div class="top mono"><span class="logo"><i></i>AM Records</span><span>Stereo · 33⅓</span><span>${no}</span></div>
    <div class="rule" style="background:${p.ink}"></div>
    ${body}
    <div class="bottom mono"><span>${p.tags}</span><span>Antoine Millot</span></div>
  </div>`;
}

function back(p, i) {
  const no = `AM-${String(i + 1).padStart(3, '0')}`;
  const r = rng(100 + i);
  let bars = '';
  let x = 0;
  while (x < 300) {
    const w = 2 + Math.floor(r() * 7);
    bars += `<rect x="${x}" y="0" width="${w}" height="110" fill="${p.bg === '#EDE5D3' || p.bg === '#F1ECE0' ? p.ink : '#15110E'}"/>`;
    x += w + 3 + Math.floor(r() * 6);
  }
  const ink = '#1B1A17';
  return `<style>${css}</style><div class="c" style="background:#E9E1CF;color:${ink}">
    <div class="top mono"><span class="logo"><i></i>AM Records</span><span>${no}</span></div>
    <div class="rule" style="background:${ink}"></div>
    <div style="position:absolute;left:64px;top:150px;width:${S - 128}px;height:26px;background:${p.bg}"></div>
    <div style="position:absolute;left:64px;top:230px;right:64px">
      <div class="big" style="font-size:120px">${p.big}</div>
      <div class="small" style="font-size:40px;margin-top:10px">${p.small}</div>
    </div>
    <div class="mono" style="position:absolute;left:64px;top:560px;line-height:2.3;font-size:25px">
      <div style="opacity:.55">Face A</div><div>A1 &nbsp; Le problème</div><div>A2 &nbsp; La solution</div>
      <div style="opacity:.55;margin-top:26px">Face B</div><div>B1 &nbsp; L’impact</div><div>B2 &nbsp; À retenir</div>
    </div>
    <div class="mono" style="position:absolute;right:64px;top:560px;text-align:right;line-height:2.3;font-size:21px;max-width:520px">${p.tags.split(' · ').join('<br>')}</div>
    <div class="bottom mono"><span>Écrit, produit et mixé par Antoine Millot<br>Paris · 2026</span><svg viewBox="0 0 300 110" style="position:static;width:300px;height:110px">${bars}</svg></div>
  </div>`;
}

// The divider card at the front of the crate: the index of the series.
function index() {
  const ink = '#1B1A17';
  const rows = P.map((p, i) => `<div style="display:flex;justify-content:space-between;border-bottom:2px solid ${ink}33;padding:9px 0"><span>${String(i + 1).padStart(2, '0')} &nbsp; ${p.big}</span><span style="opacity:.6">${p.small}</span></div>`).join('');
  return `<style>${css}</style><div class="c" style="background:#E9E1CF;color:${ink}">
    <div class="top mono"><span class="logo"><i></i>AM Records</span><span>Catalogue 2024 — 2026</span><span>12 titres</span></div>
    <div class="rule" style="background:${ink}"></div>
    <div style="position:absolute;left:64px;top:128px;right:64px;display:flex;justify-content:space-between;align-items:flex-end">
      <div class="big" style="font-size:210px">Projets</div>
      <div class="small" style="font-size:38px;text-align:right;padding-bottom:22px">Data · IA<br>Automatisation</div>
    </div>
    <div style="position:absolute;left:64px;right:64px;top:372px;height:22px;background:#F2A93B"></div>
    <div class="mono" style="position:absolute;left:64px;right:64px;top:430px;font-size:24px;letter-spacing:.08em">${rows}</div>
    <div class="bottom mono"><span>Antoine Millot · Paris</span><span>AM-000</span></div>
  </div>`;
}

function label() {
  const arc = (id, r, sweep) => `<path id="${id}" d="M ${500 - r} 500 A ${r} ${r} 0 0 ${sweep} ${500 + r} 500" fill="none"/>`;
  return `<style>*{margin:0}body{width:1000px;height:1000px;overflow:hidden}text{font-family:'JetBrains Mono',monospace}</style>
  <svg viewBox="0 0 1000 1000" width="1000" height="1000">
    <rect width="1000" height="1000" fill="#F2A93B"/>
    <circle cx="500" cy="500" r="488" fill="none" stroke="#15110E" stroke-width="6"/>
    <circle cx="500" cy="500" r="462" fill="none" stroke="#15110E" stroke-width="2"/>
    <path d="M40 500 H960" stroke="#15110E" stroke-width="3"/>
    <rect x="0" y="500" width="1000" height="500" fill="#15110E" opacity=".06"/>
    <defs>${arc('t', 372, 1)}${arc('b', 404, 0)}</defs>
    <text font-size="64" font-weight="700" fill="#15110E" letter-spacing="10"><textPath href="#t" startOffset="50%" text-anchor="middle">ANTOINE MILLOT</textPath></text>
    <text font-size="33" font-weight="500" fill="#15110E" letter-spacing="7"><textPath href="#b" startOffset="50%" text-anchor="middle">DATA ANALYST · AI ENGINEER · PARIS</textPath></text>
    <text x="150" y="455" font-size="30" font-weight="600" fill="#15110E" letter-spacing="4">AM RECORDS</text>
    <text x="850" y="455" font-size="30" font-weight="600" fill="#15110E" letter-spacing="4" text-anchor="end">AM-000</text>
    <text x="150" y="565" font-size="26" font-weight="500" fill="#15110E" letter-spacing="3">SIDE A</text>
    <text x="850" y="565" font-size="26" font-weight="500" fill="#15110E" letter-spacing="3" text-anchor="end">33⅓ RPM · STEREO</text>
    <text x="500" y="640" font-size="24" font-weight="500" fill="#15110E" letter-spacing="3" text-anchor="middle">1 · DATA &#160;&#160; 2 · IA &#160;&#160; 3 · AUTOMATISATION</text>
    <circle cx="500" cy="500" r="58" fill="none" stroke="#15110E" stroke-width="2"/>
  </svg>`;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'public', 'covers'), { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: S, height: S }, deviceScaleFactor: 1 });
  for (let i = 0; i < P.length; i++) {
    for (const [side, html] of [['front', front(P[i], i)], ['back', back(P[i], i)]]) {
      await page.setContent(html);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: path.join(OUT, `${P[i].slug}-${side}.png`) });
    }
  }
  await page.setContent(index());
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(OUT, 'index-front.png') });
  await page.setViewportSize({ width: 1000, height: 1000 });
  await page.setContent(label());
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(OUT, 'label.png') });
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'order.json'), JSON.stringify(P.map((p) => p.slug)));
  // Web copies of the fronts (project list thumbnails).
  execFileSync('python3', ['-c', `
import json, os
from PIL import Image
root = ${JSON.stringify(ROOT)}
for slug in json.load(open(os.path.join(root, 'render/covers/order.json'))):
    im = Image.open(os.path.join(root, 'render/covers', slug + '-front.png')).convert('RGB').resize((480, 480), Image.LANCZOS)
    im.save(os.path.join(root, 'public/covers', slug + '.webp'), 'WEBP', quality=82, method=6)
`]);
  console.log('covers:', P.length);
})();
