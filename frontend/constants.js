'use strict';

/**
 * Constantes del dominio y utilidades de formato para RotaStock Plus.
 * Elimina valores numéricos mágicos y centraliza reglas de presentación.
 */
(function () {
  const MS_PER_DAY = 86_400_000;
  const FLOAT_EPSILON = 1e-9;
  const ALFA_SUAVIZADO = 0.3;
  const DIAS_POR_MES = 30;
  const CV_FALLBACK_FACTOR = 0.3;
  const CV_SIN_MEDIA = 9;
  const ABC_EPSILON_FACTOR = 0.001;
  const ABC_UMBRALES = [80, 95];
  const ABC_CLASES = ['A', 'B', 'C'];
  const CV_UMBRAL_X = 0.2;
  const CV_UMBRAL_Y = 0.5;
  const DEFAULT_LEAD_TIME = 7;
  const DEFAULT_DESV_LT = 1;
  const DEFAULT_Z = 1.65;
  const DEFAULT_UMBRALES = { sana: 7, lenta: 15, muyLenta: 30 };

  const EST_LBL = {
    sana: 'Rotación Sana',
    lenta: 'Rotación Lenta',
    muyLenta: 'Rotación Muy Lenta',
    dormido: 'Inventario Dormido',
    sinDatos: 'Sin datos'
  };

  const XYZ_LBL = {
    X: 'Estable',
    Y: 'Variable',
    Z: 'Irregular'
  };

  const $ = s => (typeof document !== 'undefined' ? document.querySelector(s) : null);
  const $$ = s => (typeof document !== 'undefined' ? [...document.querySelectorAll(s)] : []);

  const fmtN = (n, d = 2) =>
    Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

  const fmt0 = n =>
    Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });

  const fmtF = d =>
    new Date(d).toLocaleString('es-PE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

  const fmtD = d =>
    new Date(d).toLocaleDateString('es-PE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });

  const esc = s =>
    String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c]));

  const uid = p => p + '_' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);

  const RotaConstants = {
    MS_PER_DAY,
    FLOAT_EPSILON,
    ALFA_SUAVIZADO,
    DIAS_POR_MES,
    CV_FALLBACK_FACTOR,
    CV_SIN_MEDIA,
    ABC_EPSILON_FACTOR,
    ABC_UMBRALES,
    ABC_CLASES,
    CV_UMBRAL_X,
    CV_UMBRAL_Y,
    DEFAULT_LEAD_TIME,
    DEFAULT_DESV_LT,
    DEFAULT_Z,
    DEFAULT_UMBRALES,
    EST_LBL,
    XYZ_LBL,
    $,
    $$,
    fmtN,
    fmt0,
    fmtF,
    fmtD,
    esc,
    uid
  };

  globalThis.RotaConstants = RotaConstants;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = RotaConstants;
  }
})();
