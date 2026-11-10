// Small server for the 3D site: serves the build and relays content + media from the main portfolio,
// so projects edited in its /admin show up here too, and WebGL textures stay same-origin.
import express from 'express';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAIN_URL = (process.env.MAIN_URL || 'https://antoine-millot.up.railway.app').replace(/\/$/, '');
const PORT = Number(process.env.PORT) || 3002;
const snapshot = JSON.parse(readFileSync(join(root, 'server/snapshot.json'), 'utf8'));

const app = express();
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
    ].join('; '),
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Content: cached for a minute; falls back to the last good copy, then to the bundled snapshot.
let cache = { at: 0, body: null };
async function content() {
  if (cache.body && Date.now() - cache.at < 60_000) return cache.body;
  try {
    const r = await fetch(`${MAIN_URL}/api/content`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`status ${r.status}`);
    const body = await r.json();
    if (!Array.isArray(body.projects)) throw new Error('bad shape');
    cache = { at: Date.now(), body };
    return body;
  } catch (err) {
    console.warn('[content] main site unreachable:', err.message);
    return cache.body || snapshot;
  }
}
app.get('/api/content', async (_req, res) => {
  const body = await content();
  res.setHeader('Cache-Control', 'no-cache');
  res.json({ ...body, mainUrl: MAIN_URL });
});

// Media relay (covers, images, the mix). Range is forwarded so audio can seek.
const SAFE = /^\/(media|uploads)\/[A-Za-z0-9._\-/]+$/;
app.get(/^\/(media|uploads)\//, async (req, res) => {
  if (!SAFE.test(req.path) || req.path.includes('..')) return res.status(400).end();
  try {
    const headers = req.headers.range ? { range: req.headers.range } : {};
    const r = await fetch(`${MAIN_URL}${req.path}`, { headers, signal: AbortSignal.timeout(15000) });
    res.status(r.status);
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
      const v = r.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    res.setHeader('Cache-Control', r.ok ? 'public, max-age=3600' : 'no-store');
    if (!r.body) return res.end();
    Readable.fromWeb(r.body).pipe(res);
  } catch {
    res.status(502).end();
  }
});

const dist = join(root, 'dist');
app.use('/assets', express.static(join(dist, 'assets'), { immutable: true, maxAge: '1y' }));
app.use(express.static(dist, { index: false, maxAge: '1h' }));
app.get(/.*/, (_req, res) => res.sendFile(join(dist, 'index.html')));

const server = app.listen(PORT, () => console.log(`[3d] listening on :${PORT}, content from ${MAIN_URL}`));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
