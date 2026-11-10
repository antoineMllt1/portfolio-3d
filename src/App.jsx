// The page: HTML words over a rendered film. The [data-key] markers are the film's beats
// (intro · needle · teardown · numbers · projects); scrolling between two markers plays the frames between them.
import Lenis from 'lenis';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { copy, pick } from './lib/copy.js';
import { toggle } from './lib/music.js';
import { Sequence, pickVariant } from './lib/sequence.js';

const LABELS = ['base', 'platter', 'disc', 'arm'];
const TRACKS = ['A1', 'A2', 'A3', 'A4', 'B1', 'B2'];

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
  const [playing, setPlaying] = useState(false);
  const [toast, setToast] = useState('');

  const canvasRef = useRef(null);
  const lenisRef = useRef(null);
  const labelRefs = useRef({});
  const frameRef = useRef(null);

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
        const teardown = manifest[variant.name].beats[2] - 1;
        seq = new Sequence(canvasRef.current, {
          manifest,
          variant,
          lenis,
          reduce,
          onReady: () => setReady(true),
          onFrame: (f, project) => {
            frameRef.current = { f, project };
            const show = Math.max(0, 1 - Math.abs(f - teardown) / 12);
            for (const k of LABELS) {
              const el = labelRefs.current[k];
              if (!el) continue;
              const p = show > 0.01 && project(k);
              el.style.opacity = p ? String(show) : '0';
              if (p) el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
            }
          },
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      seq?.dispose();
      lenis?.destroy();
    };
  }, [reduce]);

  // Click on the record (its centre and rim come from the film) starts the mix.
  useEffect(() => {
    const onRecord = (e) => {
      const fr = frameRef.current;
      if (!fr || e.target.closest?.('a, button, [data-ui]')) return false;
      const c = fr.project('record');
      const rim = fr.project('rim');
      if (!c || !rim) return false;
      const r = Math.hypot(rim.x - c.x, rim.y - c.y);
      // Seen at an angle the record is an ellipse: a flattened test is close enough.
      return Math.hypot(e.clientX - c.x, (e.clientY - c.y) * 1.6) < r * 1.05;
    };
    const click = (e) => onRecord(e) && musicRef.current();
    const move = (e) => document.documentElement.classList.toggle('over-object', !!onRecord(e));
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

  return (
    <div className={`app ${ready ? 'ready' : ''}`}>
      <a href="#main" className="skip">{t.skip}</a>
      <div className="backdrop" aria-hidden>
        <img className="poster" src="/frames/poster.webp" alt="" />
        <canvas ref={canvasRef} className="stage" />
        <div className="scrim" />
        <div className={`veil ${beat >= 4 ? 'on' : ''}`} />
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
        <nav className={`tracks ${beat >= 5 ? 'away' : ''}`} aria-label="Sections">
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
        <section className="beat intro" data-key data-track="0">
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

        <section className="beat" data-key data-track="1">
          <div className="copy">
            <p className="kicker mono">{t.needle.kicker}</p>
            <h2>{t.needle.title}</h2>
            <p className="sub">{t.needle.body}</p>
          </div>
        </section>

        <section className="beat tall" data-key data-track="2">
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

        <section className="beat end" data-key data-track="3">
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

        <section className="projects" data-key data-track="4" aria-labelledby="projects-title">
          <div className="copy wide">
            <p className="kicker mono">{t.crate.kicker} · {String(projects.length).padStart(2, '0')}</p>
            <h2 id="projects-title">{t.crate.title}</h2>
            <ul className="grid">
              {projects.map((p, i) => (
                <li key={p.slug} className={i === 0 ? 'featured' : ''}>
                  <a href={`${main}/projets/${p.slug}`} target="_blank" rel="noreferrer">
                    <span className="thumb">
                      {coverOf(p, lang) && <img src={coverOf(p, lang)} alt="" loading="lazy" decoding="async" width="1600" height="1000" />}
                    </span>
                    <span className="meta">
                      <span className="mono muted">{String(i + 1).padStart(2, '0')} · {pick(p.sector, lang)}</span>
                      <strong>{pick(p.title, lang)}</strong>
                      <span className="tagline">{pick(p.tagline, lang)}</span>
                      {p.result && <span className="mono amber">{pick(p.result, lang)}</span>}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="beat contact" data-track="5">
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
