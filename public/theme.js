// Appliqué avant l'affichage pour éviter un flash de thème : préférences propres à cet appareil.
(function () {
  try {
    var theme = localStorage.getItem('bernard-theme');
    var accent = localStorage.getItem('bernard-accent');
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
    if (accent) document.documentElement.dataset.accent = accent;
  } catch (e) { /* stockage indisponible : thème du système */ }
})();
