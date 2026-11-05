// Appliqué avant l'affichage pour éviter un flash : préférences propres à cet appareil.
(() => {
  const root = document.documentElement;
  try {
    const theme = localStorage.getItem('bernard-theme');
    const accent = localStorage.getItem('bernard-accent');
    // Thème clair par défaut ; le thème sombre s'active avec le bouton lune.
    root.dataset.theme = theme === 'dark' ? 'dark' : 'light';
    if (accent) root.dataset.accent = accent;
  } catch { /* stockage indisponible : thème clair */ }

  // Langue (même règle que detectLang dans i18n.js) : si ce n'est pas le français, la page,
  // écrite en français, reste masquée jusqu'à sa traduction par i18n.js (au plus 1,5 s).
  let lang = null;
  try { lang = localStorage.getItem('bernard-lang'); } catch { /* ignoré */ }
  if (lang !== 'fr' && lang !== 'en') {
    const tags = navigator.languages?.length ? navigator.languages : [navigator.language || ''];
    const base = tags.map((tag) => String(tag).toLowerCase().split(/[-_]/)[0]).find((b) => b === 'fr' || b === 'en');
    lang = base || 'fr';
  }
  if (lang !== 'fr') {
    root.lang = lang;
    root.classList.add('i18n-pending');
    setTimeout(() => root.classList.remove('i18n-pending'), 1500);
  }
})();
