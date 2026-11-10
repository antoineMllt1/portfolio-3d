// The page: HTML words over a rendered film. The [data-beat] markers are the film's beats
// (intro · needle · teardown · numbers · crate); the projects section plays the crate loop once per
// project, and the contact section plays the last camera move.
import Lenis from 'lenis';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { copy, pick } from './lib/copy.js';
import { toggle } from './lib/music.js';
import { Sequence, inQuad, matrix3dFor, pickVariant } from './lib/sequence.js';

const LABELS = ['base', 'platter', 'disc', 'arm'];
const TRACKS = ['A1', 'A2', 'A3', 'A4', 'B1', 'B2'];
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
  const [beat, setBeat] = useState(0);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [toast, setToast] = useState('');

  const canvasRef = useRef(null);
  const lenisRef = useRef(null);
  const labelRefs = useRef({});
  const frameRef = useRef(null);
  const seqRef = useRef(null);
  const artRef = useRef(null);
  const currentRef = useRef(0);

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

  // Film + smooth scroll. Labels and the record's click area follow anchors exported from Blender.
  useEffect(() => {
    let cancelled = false;
    let seq;
    let lenis;
    fetch('/frames/manifest.json')
      .then((r) => r.json())
      .then((manifest) => {
        if (cancelled) return;
        lenis = reduce ? null : new Lenis({ autoRaf: false, lerp: 0.1, smoothWheel: true });
        lenisRef.current = lenis;
        const variant = pickVariant();
        const teardown = (manifest[variant.name] || manifest.wide).beats[2] - 1;
        seq = new Sequence(canvasRef.current, {
          manifest,
          variant,
          lenis,
          reduce,
          count: countRef.current,
          onReady: () => setReady(true),
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
            if (at.seq === 'l' && at.index !== currentRef.current) {
              currentRef.current = at.index;
              setCurrent(at.index);
            }
          },
        });
        seqRef.current = seq;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      seq?.dispose();
      lenis?.destroy();
    };
  }, [reduce]);

  const countRef = useRef(1);
  useEffect(() => {
    countRef.current = Math.max(1, projects.length);
    seqRef.current?.setCount(countRef.current);
  }, [projects.length]);

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

  // Which section is on screen (tracklist highlight).
  useEffect(() => {
    const els = [...document.querySelectorAll('[data-track]')];
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setBeat(Number(e.target.dataset.track));
      },
      { rootMargin: '-45% 0px -45% 0px' },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [projects.length]);

  const openProject = useCallback((p) => p && window.open(`${main}/projets/${p.slug}`, '_blank', 'noopener'), [main]);
  const openRef = useRef(() => {});
  openRef.current = () => openProject(projects[currentRef.current]);

  // Scroll so that project i is lifted out of the crate (the middle of its loop).
  const goProject = (i) => {
    const n = Math.max(1, projects.length);
    const start = document.querySelector('[data-loop-start]');
    const end = document.querySelector('[data-loop-end]');
    if (!start || !end) return;
    const top = (el) => el.getBoundingClientRect().top + window.scrollY;
    const y = top(start) + ((Math.min(n - 1, Math.max(0, i)) + 0.55) / n) * (top(end) - top(start));
    if (lenisRef.current) lenisRef.current.scrollTo(y, { duration: 1.1 });
    else window.scrollTo({ top: y, behavior: reduce ? 'auto' : 'smooth' });
  };

  const go = (i) => {
    const el = document.querySelector(`[data-track="${i}"]`);
    if (!el) return;
    if (lenisRef.current) lenisRef.current.scrollTo(el, { duration: 1.4 });
    else el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
  };

  const links = (settings.links || []).filter((l) => l.url);
  const email = settings.email;
  const linkedin = settings.linkedin || 'https://www.linkedin.com/in/antoine-millot1';
  const names = t.tracks.filter(Boolean);
  const p = projects[current];

  return (
    <div className={`app ${ready ? 'ready' : ''}`}>
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
        <a className="brand" href={main} target="_blank" rel="noreferrer">
          <span className="mono">antoine</span>
          <span className="muted">.millot</span>
          <span className="badge">3D</span>
        </a>
        <nav className={`tracks ${beat >= 4 ? 'away' : ''}`} aria-label="Sections">
          <span className="side mono">{t.side(beat)}</span>
          <ol>
            {names.map((name, i) => (
              <li key={name}>
                <button type="button" className={beat === i ? 'on' : ''} onClick={() => go(i)} aria-current={beat === i ? 'true' : undefined}>
                  <span className="mono">{TRACKS[i]}</span> {name}
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <div className="hud-right">
          <button type="button" className="chip" onClick={music} aria-pressed={playing} aria-label={playing ? t.pause : t.play}>
            <span className={`eq ${playing ? 'on' : ''}`} aria-hidden><i /><i /><i /></span>
            <span className="chip-text">{playing ? t.pause : t.play}</span>
          </button>
          <button type="button" className="chip mono" onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')} aria-label={t.langSwitch}>
            {lang === 'fr' ? 'EN' : 'FR'}
          </button>
          <a className="chip" href={main} target="_blank" rel="noreferrer">{t.classic} ↗</a>
        </div>
      </header>
      {toast && <p className="toast mono" role="status">{toast}</p>}

      <main id="main">
        <section className="beat intro" data-beat data-track="0">
          <div className="copy">
            <p className="mono prompt"><span className="sky">~/antoine</span> $ {t.intro.prompt}<span className="caret" /></p>
            <h1>
              <span className="name">{t.intro.name}</span>
              <span className="line">{t.intro.line}</span>
            </h1>
            <p className="sub">{pick(settings.tagline, lang) || t.intro.sub}</p>
            <div className="row">
              <button type="button" className="btn primary" onClick={() => go(4)}>{names[4]} ↓</button>
              <button type="button" className="btn" onClick={music}>{playing ? t.pause : t.play}</button>
            </div>
            <p className="mono hint">{t.intro.hint}</p>
          </div>
        </section>

        <section className="beat" data-beat data-track="1">
          <div className="copy">
            <p className="kicker mono">{t.needle.kicker}</p>
            <h2>{t.needle.title}</h2>
            <p className="sub">{t.needle.body}</p>
          </div>
        </section>

        <section className="beat tall" data-beat data-track="2">
          <div className="copy">
            <p className="kicker mono">{t.layers.kicker}</p>
            <h2>{t.layers.title}</h2>
            <p className="sub">{t.layers.body}</p>
            {/* Same content as the floating labels, for screen readers */}
            <ul className="sr-only">
              {LABELS.map((k) => (
                <li key={k}>{t.layers.labels[k][0]} : {t.layers.labels[k][1]}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="beat end" data-beat data-track="3">
          <div className="copy">
            <p className="kicker mono">{t.numbers.kicker}</p>
            <h2>{t.numbers.title}</h2>
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
        </section>

        <section className="projects" data-beat data-loop-start data-track="4" aria-labelledby="projects-title" style={{ height: `calc(${Math.max(1, projects.length)} * 70vh + 100vh)` }}>
          <div className="sticky">
            <div className="copy panel" data-ui>
              <p className="kicker mono">
                {t.crate.kicker} · <span className="amber">{String(current + 1).padStart(2, '0')}</span>/{String(projects.length).padStart(2, '0')}
              </p>
              <h2 id="projects-title" className="sr-only">{t.crate.title}</h2>
              {p ? (
                <div key={p.slug} className="card-info">
                  <p className="mono muted">{pick(p.sector, lang)}</p>
                  <h3>{pick(p.title, lang)}</h3>
                  <p className="sub">{pick(p.tagline, lang)}</p>
                  {p.result && <p className="result mono">{pick(p.result, lang)}</p>}
                  <ul className="tags">{(p.tags || []).slice(0, 5).map((tag) => <li key={tag}>{tag}</li>)}</ul>
                </div>
              ) : (
                <h3>{t.crate.title}</h3>
              )}
              <div className="row">
                {p && <a className="btn primary" href={`${main}/projets/${p.slug}`} target="_blank" rel="noreferrer">{t.crate.open} ↗</a>}
                <button type="button" className="btn icon" aria-label={t.crate.prev} disabled={current <= 0} onClick={() => goProject(current - 1)}>←</button>
                <button type="button" className="btn icon" aria-label={t.crate.next} disabled={current >= projects.length - 1} onClick={() => goProject(current + 1)}>→</button>
              </div>
              <p className="mono hint">{t.crate.hint}</p>
            </div>
          </div>
          <div data-loop-end className="marker end" />
          {/* All the projects, for keyboard and screen-reader users */}
          <ul className="sr-only">
            {projects.map((proj) => (
              <li key={proj.slug}><a href={`${main}/projets/${proj.slug}`} target="_blank" rel="noreferrer">{pick(proj.title, lang)}</a></li>
            ))}
          </ul>
        </section>

        <section className="beat contact" data-contact data-track="5">
          <div className="copy">
            <p className="kicker mono">{t.contact.kicker}</p>
            <h2>{t.contact.title}</h2>
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
        </section>
      </main>
    </div>
  );
}
