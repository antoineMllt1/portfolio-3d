// The page: six floors over a rendered film. One scroll step (wheel, swipe, keys) moves one floor;
// the film travels by itself from beat to beat. On the projects floor the record is pulled out of
// the crate, and the catalogue of covers picks which one.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { copy, pick } from './lib/copy.js';
import { Film, inQuad, matrix3dFor, pickVariant } from './lib/film.js';
import { toggle } from './lib/music.js';

const LABELS = ['base', 'platter', 'disc', 'arm'];
const TRACKS = ['A1', 'A2', 'A3', 'A4', 'B1', 'B2'];
const FLOORS = 6;
const PROJECTS = 4;
const ART = 600; // px size of the cover layer before it is mapped onto the sleeve

function initialLang() {
  try {
    const saved = localStorage.getItem('lang');
    if (saved === 'fr' || saved === 'en') return saved;
  } catch {
    /* storage unavailable */
  }
  return navigator.language?.startsWith('fr') ? 'fr' : 'en';
}

function useContent() {
  const [data, setData] = useState({ projects: [], certifications: [], settings: {}, mainUrl: '' });
  useEffect(() => {
    fetch('/api/content')
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, []);
  return data;
}

// Media fields are { src, w, h } objects (older entries may be plain strings).
const srcOf = (m) => (typeof m === 'string' ? m : m?.src || '');
const coverOf = (p, lang) => srcOf((lang === 'en' && p.media?.coverEn) || p.media?.cover || p.media?.image);
const certCount = (certs) => certs.reduce((sum, c) => sum + Math.max(1, c.data.modules?.length || 0), 0);
const host = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

function Floor({ i, floor, className = '', children }) {
  const on = floor === i;
  return (
    <section className={`floor ${className} ${on ? 'on' : floor > i ? 'above' : 'below'}`} data-floor={i} inert={on ? undefined : ''} aria-hidden={!on}>
      {children}
    </section>
  );
}

export default function App() {
  const [lang, setLangState] = useState(initialLang);
  const t = copy[lang];
  const content = useContent();
  const settings = content.settings || {};
  const main = content.mainUrl || 'https://antoine-millot.up.railway.app';
  const projects = useMemo(() => content.projects.map((p) => p.data), [content.projects]);
  // Same count as the main site: the part before the slash, lower-cased.
  const sectors = useMemo(() => new Set(projects.map((p) => p.sector?.fr?.split('/')[0].trim().toLowerCase()).filter(Boolean)).size, [projects]);

  const [reduce] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState(0);
  const [floor, setFloor] = useState(0);
  const [current, setCurrent] = useState(0);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [toast, setToast] = useState('');

  const canvasRef = useRef(null);
  const filmRef = useRef(null);
  const labelRefs = useRef({});
  const frameRef = useRef(null);
  const artRef = useRef(null);
  const floorRef = useRef(0);
  const currentRef = useRef(0);
  const busyRef = useRef(false);
  const lock = (v) => {
    busyRef.current = v;
    setBusy(v);
  };

  const setLang = (next) => {
    setLangState(next);
    try {
      localStorage.setItem('lang', next);
    } catch {
      /* storage unavailable */
    }
  };
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const toastTimer = useRef(0);
  const music = useCallback(() => {
    const on = toggle(settings.music || '');
    setPlaying(on);
    if (!settings.music) {
      setToast(t.soon);
      clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(''), 2000);
    }
  }, [settings.music, t.soon]);
  const musicRef = useRef(music);
  musicRef.current = music;

  // The film. Labels and the record's click area follow anchors exported from Blender.
  useEffect(() => {
    let cancelled = false;
    let film;
    fetch('/frames/manifest.json')
      .then((r) => r.json())
      .then((manifest) => {
        if (cancelled) return;
        const variant = pickVariant();
        const teardown = (manifest[variant.name] || manifest.wide).beats[2] - 1;
        film = new Film(canvasRef.current, {
          manifest,
          variant,
          reduce,
          onReady: () => setReady(true),
          onProgress: (x) => setProgress(x),
          onFrame: (at) => {
            frameRef.current = at;
            const show = at.seq === 'f' ? Math.max(0, 1 - Math.abs(at.f - teardown) / 12) : 0;
            for (const k of LABELS) {
              const el = labelRefs.current[k];
              if (!el) continue;
              const p = show > 0.01 && at.project(k);
              el.style.opacity = p ? String(show) : '0';
              if (p) el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
            }
            // The project cover follows the lifted sleeve's white face.
            const art = artRef.current;
            if (art) {
              const face = at.seq === 'l' ? at.face() : null;
              const alpha = face ? Math.min(1, Math.max(0, (face.v - 0.12) / 0.25)) : 0;
              art.style.opacity = String(alpha);
              if (alpha > 0) art.style.transform = matrix3dFor(ART, ART, face.corners);
            }
          },
        });
        filmRef.current = film;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      film?.dispose();
    };
  }, [reduce]);

  // Floors: the film travels to the floor's beat; the projects floor then pulls a record out.
  const goFloor = useCallback((j) => {
    const to = Math.max(0, Math.min(FLOORS - 1, j));
    const from = floorRef.current;
    if (to === from || busyRef.current) return;
    const film = filmRef.current;
    lock(true);
    floorRef.current = to;
    setFloor(to);
    // Keyboard users: focus follows the floor (its heading), without scrolling anything.
    setTimeout(() => document.querySelector(`[data-floor="${to}"] h1, [data-floor="${to}"] h2`)?.focus({ preventScroll: true }), 420);
    const arrive = () => {
      if (to === PROJECTS && film?.m.loop) film.lift(() => lock(false));
      else lock(false);
    };
    const travel = () => {
      if (!film) return arrive();
      film.travel(film.beats[to] ?? film.beats[film.beats.length - 1], arrive);
    };
    if (from === PROJECTS && film?.mode === 'l') film.putBack(travel);
    else travel();
  }, []);
  const goRef = useRef(goFloor);
  goRef.current = goFloor;

  // Change record: the current one goes back into the crate, the cover swaps while the sleeve's
  // face is hidden, and the next one is pulled out.
  const goProject = useCallback((i) => {
    const n = projects.length;
    if (!n || busyRef.current) return;
    const next = ((i % n) + n) % n;
    if (next === currentRef.current) return;
    const film = filmRef.current;
    if (!film || floorRef.current !== PROJECTS || film.mode !== 'l') {
      currentRef.current = next;
      setCurrent(next);
      return;
    }
    lock(true);
    film.putBack(() => {
      currentRef.current = next;
      setCurrent(next);
      film.lift(() => lock(false));
    });
  }, [projects.length]);
  const goProjectRef = useRef(goProject);
  goProjectRef.current = goProject;

  // One wheel notch, one swipe or one key = one floor.
  useEffect(() => {
    let cool = 0;
    const stepFloor = (d) => {
      const now = performance.now();
      if (now < cool) return;
      cool = now + 900;
      goRef.current(floorRef.current + d);
    };
    const onWheel = (e) => {
      const box = e.target.closest?.('[data-scroll]');
      if (box && box.scrollHeight > box.clientHeight + 2) return; // a panel that scrolls on its own
      if (Math.abs(e.deltaY) < 12) return;
      e.preventDefault();
      stepFloor(e.deltaY > 0 ? 1 : -1);
    };
    let y0 = null;
    const onTouchStart = (e) => (y0 = e.touches[0].clientY);
    const onTouchEnd = (e) => {
      if (y0 == null) return;
      const dy = y0 - e.changedTouches[0].clientY;
      y0 = null;
      if (Math.abs(dy) > 50) stepFloor(dy > 0 ? 1 : -1);
    };
    const onKey = (e) => {
      if (e.target.closest?.('input, textarea, select')) return;
      const map = { ArrowDown: 1, PageDown: 1, ' ': 1, ArrowUp: -1, PageUp: -1 };
      if (e.key in map) {
        e.preventDefault();
        stepFloor(map[e.key]);
      } else if (floorRef.current === PROJECTS && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        e.preventDefault();
        goProjectRef.current(currentRef.current + (e.key === 'ArrowRight' ? 1 : -1));
      }
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const openProject = useCallback((p) => p && window.open(`${main}/projets/${p.slug}`, '_blank', 'noopener'), [main]);
  const openRef = useRef(() => {});
  openRef.current = () => openProject(projects[currentRef.current]);

  // Clicks on the film: the record (centre and rim come from the film) starts the mix; the lifted
  // sleeve opens the project.
  useEffect(() => {
    const hit = (e) => {
      const fr = frameRef.current;
      if (!fr || e.target.closest?.('a, button, [data-ui]')) return null;
      const p = { x: e.clientX, y: e.clientY };
      if (fr.seq === 'l') {
        const face = fr.face();
        if (face && face.v > 0.2 && inQuad(p, face.corners)) return 'sleeve';
      }
      const c = fr.project('record');
      const rim = fr.project('rim');
      if (!c || !rim) return null;
      const r = Math.hypot(rim.x - c.x, rim.y - c.y);
      // Seen at an angle the record is an ellipse: a flattened test is close enough.
      return Math.hypot(p.x - c.x, (p.y - c.y) * 1.6) < r * 1.05 ? 'record' : null;
    };
    const click = (e) => {
      const h = hit(e);
      if (h === 'record') musicRef.current();
      else if (h === 'sleeve') openRef.current();
    };
    const move = (e) => document.documentElement.classList.toggle('over-object', !!hit(e));
    window.addEventListener('click', click);
    window.addEventListener('pointermove', move, { passive: true });
    return () => {
      window.removeEventListener('click', click);
      window.removeEventListener('pointermove', move);
    };
  }, []);

  const links = (settings.links || []).filter((l) => l.url);
  const email = settings.email;
  const linkedin = settings.linkedin || 'https://www.linkedin.com/in/antoine-millot1';
  const names = t.tracks.filter(Boolean);
  const p = projects[current];
  const hasMusic = !!settings.music;

  return (
    <div className={`app floor-${floor} ${ready ? 'ready' : ''}`}>
      {progress < 0.999 && <div className="progress" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={t.loading} style={{ transform: `scaleX(${progress})` }} />}
      <a href="#main" className="skip">{t.skip}</a>
      <div className="backdrop" aria-hidden>
        <img className="poster" src="/frames/poster.webp" alt="" />
        <canvas ref={canvasRef} className="stage" />
        {/* Multiplied onto the white sleeve in the film, so it takes the film's light and shadow */}
        <div ref={artRef} className="sleeve-art" style={{ width: ART, height: ART }}>
          {p && (
            <div key={p.slug} className="sleeve-inner">
              {coverOf(p, lang) ? <img src={coverOf(p, lang)} alt="" decoding="async" /> : <div className="sleeve-blank" />}
              <div className="sleeve-band">
                <span className="mono">{String(current + 1).padStart(2, '0')} · {pick(p.sector, lang)}</span>
                <strong>{pick(p.title, lang)}</strong>
                <em>{pick(p.result, lang)}</em>
              </div>
            </div>
          )}
        </div>
        <div className="scrim" />
      </div>

      <div className="labels" aria-hidden>
        {LABELS.map((k) => (
          <div key={k} ref={(el) => (labelRefs.current[k] = el)} className="label3d">
            <span className="dot" />
            <span className="lbl">
              <strong>{t.layers.labels[k][0]}</strong>
              <em>{t.layers.labels[k][1]}</em>
            </span>
          </div>
        ))}
      </div>

      <header className="hud" data-ui>
        <button type="button" className="brand" onClick={() => goFloor(0)} aria-label={t.home}>
          <span className="mono">antoine</span>
          <span className="muted">.millot</span>
          <span className="badge">3D</span>
        </button>
        {/* Where we are: one dot per floor, the current floor's name */}
        <nav className="floors-nav" aria-label={t.floors}>
          {names.map((name, i) => (
            <button key={name} type="button" className={floor === i ? 'on' : ''} onClick={() => goFloor(i)} aria-label={name} aria-current={floor === i ? 'true' : undefined} title={name} />
          ))}
          <span className="floor-name mono" aria-hidden>{String(floor + 1).padStart(2, '0')} · {names[floor]}</span>
        </nav>
        <nav className={`tracks ${floor >= PROJECTS ? 'away' : ''}`} aria-label={t.floors}>
          <span className="side mono">{t.side(floor)}</span>
          <ol>
            {names.map((name, i) => (
              <li key={name}>
                <button type="button" className={floor === i ? 'on' : ''} onClick={() => goFloor(i)} aria-current={floor === i ? 'true' : undefined}>
                  <span className="mono">{TRACKS[i]}</span> {name}
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <div className="hud-right">
          {hasMusic && (
            <button type="button" className="chip" onClick={music} aria-pressed={playing} aria-label={playing ? t.pause : t.play}>
              <span className={`eq ${playing ? 'on' : ''}`} aria-hidden><i /><i /><i /></span>
              <span className="chip-text">{playing ? t.pause : t.play}</span>
            </button>
          )}
          <button type="button" className="chip mono" onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')} aria-label={t.langSwitch}>
            {lang === 'fr' ? 'EN' : 'FR'}
          </button>
          <a className="chip" href={main} target="_blank" rel="noreferrer">{t.classic} ↗</a>
        </div>
      </header>
      {toast && <p className="toast mono" role="status">{toast}</p>}

      {floor < FLOORS - 1 && (
        <button type="button" className="next mono" onClick={() => goFloor(floor + 1)} data-ui>
          <span>{names[floor + 1]}</span> ↓
        </button>
      )}

      <main id="main" className="floors">
        <Floor i={0} floor={floor} className="intro">
          <div className="copy">
            <p className="mono prompt"><span className="sky">~/antoine</span> $ {t.intro.prompt}<span className="caret" /></p>
            <h1 tabIndex={-1}>
              <span className="name">{t.intro.name}</span>
              <span className="line">{t.intro.line}</span>
            </h1>
            <p className="sub">{pick(settings.tagline, lang) || t.intro.sub}</p>
            <div className="row">
              <button type="button" className="btn primary" onClick={() => goFloor(PROJECTS)}>{t.intro.cta} ↓</button>
              <button type="button" className="btn" onClick={() => goFloor(FLOORS - 1)}>{t.intro.contact}</button>
            </div>
            <p className="mono hint">{hasMusic ? t.intro.hintMusic : t.intro.hint}</p>
          </div>
        </Floor>

        <Floor i={1} floor={floor}>
          <div className="copy">
            <p className="kicker mono">{t.needle.kicker}</p>
            <h2 tabIndex={-1}>{t.needle.title}</h2>
            <p className="sub">{t.needle.body}</p>
          </div>
        </Floor>

        <Floor i={2} floor={floor} className="top">
          <div className="copy">
            <p className="kicker mono">{t.layers.kicker}</p>
            <h2 tabIndex={-1}>{t.layers.title}</h2>
            <p className="sub">{t.layers.body}</p>
            {/* Same content as the floating labels, for screen readers */}
            <ul className="sr-only">
              {LABELS.map((k) => (
                <li key={k}>{t.layers.labels[k][0]} : {t.layers.labels[k][1]}</li>
              ))}
            </ul>
          </div>
        </Floor>

        <Floor i={3} floor={floor} className="end">
          <div className="copy">
            <p className="kicker mono">{t.numbers.kicker}</p>
            <h2 tabIndex={-1}>{t.numbers.title}</h2>
            <dl className="stats">
              {[
                [projects.length, t.numbers.projects],
                [certCount(content.certifications || []), t.numbers.certs],
                [sectors, t.numbers.sectors],
              ].map(([n, label]) => (
                <div key={label}>
                  <dt className="mono">{label}</dt>
                  <dd>{n || '—'}</dd>
                </div>
              ))}
            </dl>
          </div>
        </Floor>

        <Floor i={PROJECTS} floor={floor} className="projects">
          <div className="copy panel" data-ui data-scroll>
            <p className="kicker mono">
              {t.crate.kicker} · <span className="amber">{String(current + 1).padStart(2, '0')}</span>/{String(projects.length).padStart(2, '0')}
            </p>
            {p ? (
              <div key={p.slug} className="card-info">
                <p className="mono muted">{pick(p.sector, lang)}</p>
                <h2 tabIndex={-1}>{pick(p.title, lang)}</h2>
                <p className="sub">{pick(p.tagline, lang)}</p>
                {p.result && <p className="result mono">{pick(p.result, lang)}</p>}
              </div>
            ) : (
              <h2>{t.crate.title}</h2>
            )}
            <div className="row">
              {p && <a className="btn primary" href={`${main}/projets/${p.slug}`} target="_blank" rel="noreferrer">{t.crate.open} ↗</a>}
              <button type="button" className="btn icon" aria-label={t.crate.prev} disabled={busy} onClick={() => goProject(current - 1)}>←</button>
              <button type="button" className="btn icon" aria-label={t.crate.next} disabled={busy} onClick={() => goProject(current + 1)}>→</button>
            </div>
            {/* The catalogue: every cover; click one to pull it out of the crate */}
            <ol className="catalogue" aria-label={t.crate.title}>
              {projects.map((proj, i) => (
                <li key={proj.slug}>
                  <button type="button" className={i === current ? 'on' : ''} disabled={busy} onClick={() => goProject(i)} aria-current={i === current ? 'true' : undefined} title={pick(proj.title, lang)}>
                    {coverOf(proj, lang) ? <img src={coverOf(proj, lang)} alt="" loading="lazy" decoding="async" width="160" height="100" /> : <span className="thumb-blank" />}
                    <span className="mono">{String(i + 1).padStart(2, '0')}</span>
                    <span className="sr-only">{pick(proj.title, lang)}</span>
                  </button>
                </li>
              ))}
            </ol>
            <p className="mono hint">{t.crate.hint}</p>
          </div>
        </Floor>

        <Floor i={5} floor={floor} className="contact">
          <div className="copy" data-scroll>
            <p className="kicker mono">{t.contact.kicker}</p>
            <h2 tabIndex={-1}>{t.contact.title}</h2>
            <p className="mono muted where">{pick(settings.location, lang) || t.contact.location}</p>
            <p className="sub">{t.contact.body}</p>
            <div className="row">
              {email && <a className="btn primary" href={`mailto:${email}`}>{email}</a>}
              <a className="btn" href={linkedin} target="_blank" rel="noreferrer">{t.contact.linkedin} ↗</a>
            </div>
            {links.length > 0 && (
              <ul className="links">
                {links.map((l) => (
                  <li key={l.url}>
                    <a href={l.url} target="_blank" rel="noreferrer">
                      <span>{l.label || host(l.url)}</span> <span className="mono muted">{host(l.url)} ↗</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
            <a className="classic" href={main} target="_blank" rel="noreferrer">{t.contact.classic} →</a>
            <p className="mono muted foot">© {new Date().getFullYear()} Antoine Millot · Data & AI · {lang === 'fr' ? 'Rendu Blender Cycles' : 'Rendered in Blender Cycles'}</p>
          </div>
        </Floor>
      </main>
    </div>
  );
}
