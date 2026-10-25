'use strict';

(function initThemeAttribute() {
  let theme = 'dark';
  try {
    const saved = localStorage.getItem('rotastock_theme');
    if (saved === 'light' || saved === 'dark') {
      theme = saved;
    }
  } catch (err) {
    console.warn('[ThemeInit] No se pudo leer rotastock_theme desde localStorage:', err.message);
  }
  document.documentElement.setAttribute('data-theme', theme);
})();
