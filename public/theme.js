// Appliqué avant l'affichage pour éviter un flash de thème : préférences propres à cet appareil.
(function () {
  try {
    var theme = localStorage.getItem('bernard-theme');
    var accent = localStorage.getItem('bernard-accent');
    // Thème clair par défaut ; le thème sombre s'active avec le bouton lune.
    document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
    if (accent) document.documentElement.dataset.accent = accent;
  } catch (e) { /* stockage indisponible : thème clair */ }
})();
