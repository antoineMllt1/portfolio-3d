// The page: five floors over a rendered film. One step of the wheel, a swipe or a key moves one
// floor and the camera travels there by itself. On the projects floor, picking a title makes the film
// go through the crate until that record is pulled up.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FLOOR_IDS, copy, pick } from './lib/copy.js';
import { Film, inQuad, pickVariant } from './lib/film.js';
import { useFloorInput } from './lib/input.js';
import { toggle } from './lib/music.js';

const FLOORS = FLOOR_IDS.length;
const PROJECTS = 3;
const two = (n) => String(n).padStart(2, '0');

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

const certCount = (certs) => certs.reduce((sum, c) => sum + Math.max(1, c.data.modules?.length || 0), 0);
const host = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};
const SITES = { 'github.com': 'GitHub', 'reddit.com': 'Reddit', 'x.com': 'X', 'twitter.com': 'X', 'instagram.com': 'Instagram', 'youtube.com': 'YouTube', 'medium.com': 'Medium', 'kaggle.com': 'Kaggle', 'huggingface.co': 'Hugging Face', 'malt.fr': 'Malt' };
// "https://github.com/someone" → ["GitHub", "@someone"]
const profile = (l) => {
  const h = host(l.url);
  let who = '';
  try {
    who = new URL(l.url).pathname.split('/').filter(Boolean).pop() || '';
  } catch {}
  return [l.label || SITES[h] || h, who && SITES[h] ? `@${who.replace(/^@/, '')}` : h];
};
const titleFromSlug = (slug) => slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function Floor({ i, floor, className = '', children }) {
  const on = floor === i;
  return (
    <section id={FLOOR_IDS[i]} className={`floor ${className} ${on ? 'on' : ''}`} data-floor={i} inert={on ? undefined : ''} aria-hidden={!on}>
      {children}
    </section>
  );
}

// Reveal: children of a floor rise one after the other once the camera is nearly there.
const R = ({ i = 0, as: Tag = 'div', className = '', ...rest }) => <Tag className={`r ${className}`} style={{ '--i': i }} {...rest} />;

export default function App() {
  const [lang, setLangState] = useState(initialLang);
  const t = copy[lang];
  const content = useContent();
  const settings = content.settings || {};
  const main = content.mainUrl || 'https://antoine-millot.up.railway.app';

  const [reduce] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState(0);
  const [order, setOrder] = useState([]);
  const [floor, setFloor] = useState(0);
  const [current, setCurrent] = useState(0);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);

  const canvasRef = useRef(null);
  const filmRef = useRef(null);
  const floorRef = useRef(0);
  const currentRef = useRef(0);
  const busyRef = useRef(false);
  const lock = (v) => {
    busyRef.current = v;
    setBusy(v);
  };

  // The crate's records, in the order they were printed into the film; details come from the API.
  const bySlug = useMemo(() => new Map(content.projects.map((p) => [p.data.slug, p.data])), [content.projects]);
  const records = useMemo(() => order.map((slug) => bySlug.get(slug) || { slug, title: titleFromSlug(slug) }), [order, bySlug]);
  const others = useMemo(() => content.projects.map((p) => p.data).filter((p) => order.length && !order.includes(p.slug)), [content.projects, order]);
  const sectors = useMemo(() => new Set(content.projects.map((p) => p.data.sector?.fr?.split('/')[0].trim().toLowerCase()).filter(Boolean)).size, [content.projects]);

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

  // ---- the film
  useEffect(() => {
    let cancelled = false;
    let film;
    fetch('/frames/manifest.json')
      .then((r) => r.json())
      .then((manifest) => {
        if (cancelled) return;
        const variant = pickVariant(manifest);
        film = new Film(canvasRef.current, { manifest, variant, reduce, onReady: () => setReady(true), onProgress: setProgress });
        filmRef.current = film;
        setOrder(film.m.crate.order);
        // Deep link: start on the floor named in the address.
        const start = FLOOR_IDS.indexOf(location.hash.slice(1));
        if (start > 0) {
          floorRef.current = start;
          setFloor(start);
          film.pos = { seq: 'f', f: film.beats[start] };
          film.want('f', film.beats[start]);
          if (start === PROJECTS) film.toRecord(0);
        }
      })
      .catch(() => setReady(true));
    return () => {
      cancelled = true;
      film?.dispose();
    };
  }, [reduce]);

  // ---- floors
  const goFloor = useCallback((j) => {
    const to = Math.max(0, Math.min(FLOORS - 1, j));
    const from = floorRef.current;
    if (to === from || busyRef.current) return;
    const film = filmRef.current;
    lock(true);
    floorRef.current = to;
    setFloor(to);
    history.replaceState(null, '', to ? `#${FLOOR_IDS[to]}` : location.pathname);
    // Keyboard users: focus follows the floor (its heading).
    setTimeout(() => document.querySelector(`[data-floor="${to}"] [data-focus]`)?.focus({ preventScroll: true }), 500);
    if (!film) return lock(false);
    const arrive = () => (to === PROJECTS ? film.toRecord(currentRef.current, () => lock(false)) : lock(false));
    const travel = () => film.toBeat(to, from, arrive);
    if (from === PROJECTS) film.closeCrate(travel, PROJECTS);
    else travel();
  }, []);

  // A hash typed in the address bar, or a link to "#contact", moves to that floor.
  useEffect(() => {
    const onHash = () => goFloor(Math.max(0, FLOOR_IDS.indexOf(location.hash.slice(1))));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [goFloor]);

  const goProject = useCallback((i) => {
    const n = filmRef.current?.m.crate.order.length || 0;
    if (!n || busyRef.current) return;
    const next = ((i % n) + n) % n;
    if (next === currentRef.current) return;
    currentRef.current = next;
    setCurrent(next);
    if (floorRef.current !== PROJECTS) return;
    lock(true);
    filmRef.current.toRecord(next, () => lock(false));
  }, []);

  useFloorInput({
    step: (d) => goFloor(floorRef.current + d),
    side: (d) => floorRef.current === PROJECTS && goProject(currentRef.current + d),
    jump: (where) => goFloor(where === 'first' ? 0 : FLOORS - 1),
  });

  // ---- the pulled-up cover is a link to the case study
  const openRef = useRef(() => {});
  openRef.current = () => {
    const p = records[currentRef.current];
    if (p) window.open(`${main}/projets/${p.slug}`, '_blank', 'noopener');
  };
  useEffect(() => {
    const onCover = (e) => {
      const film = filmRef.current;
      if (!film || floorRef.current !== PROJECTS || e.target.closest?.('a, button, [data-ui]')) return false;
      const quad = film.coverQuad(currentRef.current);
      return !!quad && inQuad({ x: e.clientX, y: e.clientY }, quad);
    };
    const click = (e) => onCover(e) && openRef.current();
    const move = (e) => document.documentElement.classList.toggle('over-cover', onCover(e));
    window.addEventListener('click', click);
    window.addEventListener('pointermove', move, { passive: true });
    return () => {
      window.removeEventListener('click', click);
      window.removeEventListener('pointermove', move);
    };
  }, []);

  const music = () => setPlaying(toggle(settings.music || ''));
  const links = (settings.links || []).filter((l) => l.url);
  const email = settings.email;
  const linkedin = settings.linkedin || 'https://www.linkedin.com/in/antoine-millot1';
  const p = records[current];
  const stats = [content.projects.length, certCount(content.certifications || []), sectors];

  return (
    <div className={`app at-${FLOOR_IDS[floor]} ${ready ? 'ready' : ''}`}>
      <a href="#main" className="skip">{t.skip}</a>
      <div className="backdrop" aria-hidden>
        <img className="poster" src="/frames/poster.webp" alt="" />
        <canvas ref={canvasRef} className="stage" />
        <div className="scrim" />
      </div>
      {progress < 0.999 && <div className="progress" role="progressbar" aria-label={t.loading} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} style={{ transform: `scaleX(${progress})` }} />}

      <header className="top" data-ui>
        <button type="button" className="brand" onClick={() => goFloor(0)} aria-label={t.home}>
          Antoine Millot
        </button>
        <div className="top-right">
          {settings.music && (
            <button type="button" className="link" onClick={music} aria-pressed={playing}>
              <span className={`eq ${playing ? 'on' : ''}`} aria-hidden><i /><i /><i /></span>
              {playing ? t.pause : t.play}
            </button>
          )}
          <button type="button" className="link mono" onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')} aria-label={t.langSwitch}>
            <span className={lang === 'fr' ? 'on' : ''}>FR</span> / <span className={lang === 'en' ? 'on' : ''}>EN</span>
          </button>
          <a className="link" href={main} target="_blank" rel="noreferrer">{t.full} ↗</a>
        </div>
      </header>

      <nav className="rail" aria-label={t.floorsNav} data-ui>
        {t.floors.map((name, i) => (
          <button key={name} type="button" className={floor === i ? 'on' : ''} onClick={() => goFloor(i)} aria-current={floor === i ? 'true' : undefined}>
            <span className="rail-name">{name}</span>
            <span className="rail-mark" aria-hidden />
          </button>
        ))}
      </nav>
      <p className="counter mono" aria-hidden>
        {two(floor + 1)} <span>/ {two(FLOORS)}</span>
      </p>
      {floor < FLOORS - 1 && (
        <button type="button" className="next" onClick={() => goFloor(floor + 1)} data-ui aria-label={`${t.next} : ${t.floors[floor + 1]}`}>
          <span className="mono">{floor === 0 ? t.intro.hint : t.floors[floor + 1]}</span>
          <svg viewBox="0 0 16 16" aria-hidden><path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
        </button>
      )}

      <main id="main">
        <Floor i={0} floor={floor}>
          <div className="copy">
            <R i={0} as="p" className="kicker mono">{t.intro.name}</R>
            <h1 data-focus tabIndex={-1}>
              <R i={1} as="span">{t.intro.title[0]}</R>
              <R i={2} as="span">{t.intro.title[1]}</R>
            </h1>
            <R i={3} as="p" className="sub">{pick(settings.tagline, lang) || t.intro.sub}</R>
            <R i={4} className="row">
              <button type="button" className="btn primary" onClick={() => goFloor(PROJECTS)}>{t.intro.cta}</button>
              <button type="button" className="btn" onClick={() => goFloor(FLOORS - 1)}>{t.intro.contact}</button>
            </R>
          </div>
        </Floor>

        <Floor i={1} floor={floor}>
          <div className="copy">
            <R i={0} as="p" className="kicker mono">02 — {t.floors[1]}</R>
            <R i={1} as="h2" data-focus tabIndex={-1}>{t.profil.title}</R>
            <R i={2} as="p" className="sub">{t.profil.body}</R>
            <R i={3} as="dl" className="facts">
              {t.profil.facts.map(([k, v]) => (
                <div key={k}>
                  <dt className="mono">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </R>
          </div>
        </Floor>

        <Floor i={2} floor={floor}>
          <div className="copy">
            <R i={0} as="p" className="kicker mono">03 — {t.floors[2]}</R>
            <R i={1} as="h2" data-focus tabIndex={-1}>{t.craft.title}</R>
            <R i={2} as="ol" className="pillars">
              {t.craft.items.map(([k, v], i) => (
                <li key={k}>
                  <span className="mono">{two(i + 1)}</span>
                  <div>
                    <strong>{k}</strong>
                    <p>{v}</p>
                  </div>
                </li>
              ))}
            </R>
            <R i={3} as="dl" className="stats">
              {stats.map((n, i) => (
                <div key={t.craft.stats[i]}>
                  <dd>{n || '—'}</dd>
                  <dt className="mono">{t.craft.stats[i]}</dt>
                </div>
              ))}
            </R>
          </div>
        </Floor>

        <Floor i={PROJECTS} floor={floor} className="projects">
          <div className="copy panel" data-ui>
            <R i={0} as="p" className="kicker mono">04 — {t.projects.title} · {t.projects.count(records.length + others.length)}</R>
            <R i={1} as="ol" className="list" data-scroll>
              {records.map((rec, i) => (
                <li key={rec.slug}>
                  <button type="button" className={i === current ? 'on' : ''} onClick={() => goProject(i)} aria-current={i === current ? 'true' : undefined} disabled={busy && i !== current}>
                    <span className="no mono">{two(i + 1)}</span>
                    <img src={`/covers/${rec.slug}.webp`} alt="" width="28" height="28" loading="lazy" decoding="async" />
                    <span className="name">{pick(rec.title, lang)}</span>
                    <span className="sector mono">{pick(rec.sector, lang).split('/')[0].trim()}</span>
                  </button>
                </li>
              ))}
              {others.map((rec) => (
                <li key={rec.slug}>
                  <a href={`${main}/projets/${rec.slug}`} target="_blank" rel="noreferrer">
                    <span className="no mono">+</span>
                    <span className="name">{pick(rec.title, lang)}</span>
                    <span className="sector mono">↗</span>
                  </a>
                </li>
              ))}
            </R>
            {p && (
              <R i={2} className="detail" key={p.slug} data-focus tabIndex={-1} aria-live="polite">
                <h2>{pick(p.title, lang)}</h2>
                {p.tagline && <p className="tagline">{pick(p.tagline, lang)}</p>}
                {p.result && (
                  <p className="result mono">
                    <span>{t.projects.result}</span> {pick(p.result, lang)}
                  </p>
                )}
                <div className="row">
                  <a className="btn primary" href={`${main}/projets/${p.slug}`} target="_blank" rel="noreferrer">{t.projects.open} ↗</a>
                  <button type="button" className="btn icon" aria-label={t.projects.prev} onClick={() => goProject(current - 1)}>←</button>
                  <button type="button" className="btn icon" aria-label={t.projects.next} onClick={() => goProject(current + 1)}>→</button>
                </div>
              </R>
            )}
          </div>
        </Floor>

        <Floor i={4} floor={floor}>
          <div className="copy" data-scroll>
            <R i={0} as="p" className="kicker mono">05 — {t.floors[4]}</R>
            <R i={1} as="h2" data-focus tabIndex={-1}>{t.contact.title}</R>
            <R i={2} as="p" className="sub">{t.contact.body}</R>
            <R i={3} className="row">
              {email && <a className="btn primary" href={`mailto:${email}`}>{email}</a>}
              <a className="btn" href={linkedin} target="_blank" rel="noreferrer">{t.contact.linkedin} ↗</a>
            </R>
            <R i={4} as="ul" className="links">
              {links.map((l) => (
                <li key={l.url}>
                  <a href={l.url} target="_blank" rel="noreferrer">
                    <span>{profile(l)[0]}</span>
                    <span className="mono">{profile(l)[1]} ↗</span>
                  </a>
                </li>
              ))}
              <li>
                <a href={main} target="_blank" rel="noreferrer">
                  <span>{t.full}</span>
                  <span className="mono">{host(main)} ↗</span>
                </a>
              </li>
            </R>
            <R i={5} as="p" className="foot mono">© {new Date().getFullYear()} Antoine Millot · {t.contact.credit}</R>
          </div>
        </Floor>
      </main>
    </div>
  );
}
