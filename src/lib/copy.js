// Static copy (FR / EN). Projects, certifications and contact details come from the main portfolio.
export const FLOOR_IDS = ['intro', 'profil', 'savoir-faire', 'projets', 'contact'];

export const copy = {
  fr: {
    langSwitch: 'Switch to English',
    skip: 'Aller au contenu',
    full: 'Portfolio complet',
    home: 'Accueil',
    floorsNav: 'Sections',
    loading: 'Chargement',
    next: 'Suite',
    play: 'Lancer le mix',
    pause: 'Mettre en pause',
    floors: ['Intro', 'Profil', 'Savoir-faire', 'Projets', 'Contact'],
    intro: {
      name: 'Antoine Millot',
      title: ['Data Analyst', '& AI Engineer.'],
      sub: 'Je transforme la donnée en décisions et les tâches répétitives en workflows automatisés.',
      cta: 'Voir les projets',
      contact: 'Me contacter',
      hint: 'Défiler',
    },
    profil: {
      title: 'Je lis la donnée, j’en sors un signal.',
      body: 'Dashboards, agents IA et outils sur mesure : je pars du besoin métier et je vais jusqu’à la mise en production.',
      facts: [
        ['Aujourd’hui', 'Data Analyst CSM / AI Engineer en alternance chez Sage, 2026–2027'],
        ['Formation', 'Bachelor AI Applied to Business, Eugenia School'],
        ['Où', 'Paris · français et anglais courants'],
      ],
    },
    craft: {
      title: 'Trois réglages, une seule machine.',
      items: [
        ['Data', 'SQL, Python, Power BI, Looker Studio : des tableaux de bord qui servent à décider.'],
        ['IA', 'Agents, RAG, LLM : des outils qui lisent, trient et rédigent.'],
        ['Automatisation', 'n8n, Make, API : les tâches répétitives tournent toutes seules.'],
      ],
      stats: ['projets livrés', 'certifications', 'secteurs'],
    },
    projects: {
      title: 'Projets',
      count: (n) => `${n} titres`,
      open: 'Voir l’étude de cas',
      prev: 'Projet précédent',
      next: 'Projet suivant',
      result: 'Résultat',
      hint: 'Choisis un titre : le disque sort du bac.',
    },
    contact: {
      title: 'On lance le prochain projet ?',
      body: 'Un process trop long, une donnée qui dort, une idée d’agent IA : écris-moi.',
      linkedin: 'LinkedIn',
      credit: 'Scène rendue dans Blender',
    },
  },
  en: {
    langSwitch: 'Passer en français',
    skip: 'Skip to content',
    full: 'Full portfolio',
    home: 'Home',
    floorsNav: 'Sections',
    loading: 'Loading',
    next: 'Next',
    play: 'Play the mix',
    pause: 'Pause',
    floors: ['Intro', 'Profile', 'Craft', 'Projects', 'Contact'],
    intro: {
      name: 'Antoine Millot',
      title: ['Data Analyst', '& AI Engineer.'],
      sub: 'I turn data into decisions and repetitive tasks into automated workflows.',
      cta: 'See the projects',
      contact: 'Get in touch',
      hint: 'Scroll',
    },
    profil: {
      title: 'I read the data and pull out the signal.',
      body: 'Dashboards, AI agents and custom tools: I start from the business need and go all the way to production.',
      facts: [
        ['Now', 'Data Analyst CSM / AI Engineer, apprenticeship at Sage, 2026–2027'],
        ['Studies', 'Bachelor AI Applied to Business, Eugenia School'],
        ['Where', 'Paris · fluent French and English'],
      ],
    },
    craft: {
      title: 'Three settings, one machine.',
      items: [
        ['Data', 'SQL, Python, Power BI, Looker Studio: dashboards people decide with.'],
        ['AI', 'Agents, RAG, LLMs: tools that read, sort and write.'],
        ['Automation', 'n8n, Make, APIs: repetitive tasks run on their own.'],
      ],
      stats: ['projects shipped', 'certifications', 'industries'],
    },
    projects: {
      title: 'Projects',
      count: (n) => `${n} titles`,
      open: 'Read the case study',
      prev: 'Previous project',
      next: 'Next project',
      result: 'Result',
      hint: 'Pick a title: the record comes out of the crate.',
    },
    contact: {
      title: 'Shall we start the next one?',
      body: 'A process that takes too long, data nobody uses, an idea for an AI agent: write to me.',
      linkedin: 'LinkedIn',
      credit: 'Scene rendered in Blender',
    },
  },
};

export const pick = (obj, lang) => (typeof obj === 'string' ? obj : obj?.[lang] || obj?.fr || obj?.en || '');
