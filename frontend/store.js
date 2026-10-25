'use strict';

/**
 * Capa de Persistencia Híbrida (Store) para RotaStock Plus.
 * Implementa la cascada de 4 niveles (Electron IPC -> localStorage -> fetch semilla -> fallback)
 * y validación de estructura (Sección 2 y 10.3 de funcionalidades.md).
 */
(function () {
  const { DEFAULT_UMBRALES } = globalThis.RotaConstants || require('./constants.js');

  const Store = {
    key: 'rotastockplus_db',
    db: null,

    createDefaultDB() {
      return {
        meta: {
          sistema: 'RotaStock Plus',
          versionEsquema: '2.0.0',
          createdAt: new Date().toISOString(),
          totalProductos: 0,
          totalMovimientos: 0
        },
        config: {
          metodoCosteo: 'FIFO',
          umbrales: { ...DEFAULT_UMBRALES },
          preferenciasUI: {
            tema: 'oscuro',
            autoBackupMinutos: 1,
            nombreEmpresa: 'Mi negocio'
          }
        },
        productos: [],
        movimientos: [],
        conteosCiclicos: []
      };
    },

    isValidStructure(d) {
      return Boolean(
        d &&
        typeof d === 'object' &&
        Array.isArray(d.productos) &&
        Array.isArray(d.movimientos) &&
        d.config &&
        typeof d.config === 'object' &&
        d.config.umbrales
      );
    },

    normalize(d) {
      if (!Array.isArray(d.conteosCiclicos)) d.conteosCiclicos = [];
      if (!d.meta || typeof d.meta !== 'object') {
        d.meta = {
          sistema: 'RotaStock Plus',
          versionEsquema: '2.0.0',
          createdAt: new Date().toISOString()
        };
      }
      d.meta.totalProductos = d.productos.length;
      d.meta.totalMovimientos = d.movimientos.length;
      return d;
    },

    async load() {
      if (typeof window !== 'undefined' && window.rotastock?.isElectron) {
        try {
          const raw = await window.rotastock.loadDB();
          const parsed = JSON.parse(raw);
          if (this.isValidStructure(parsed)) {
            this.db = this.normalize(parsed);
            return this.db;
          }
        } catch (err) {
          console.warn('[Store] Error al cargar desde Electron IPC, probando siguiente nivel:', err.message);
        }
      }

      if (typeof localStorage !== 'undefined') {
        try {
          const t = localStorage.getItem(this.key);
          if (t) {
            const parsed = JSON.parse(t);
            if (this.isValidStructure(parsed)) {
              this.db = this.normalize(parsed);
              return this.db;
            }
          }
        } catch (err) {
          console.warn('[Store] Error al leer desde localStorage:', err.message);
        }
      }

      if (typeof fetch === 'function') {
        try {
          const r = await fetch('../datos/inventario.json').catch(() => fetch('datos/inventario.json'));
          if (r?.ok) {
            const parsed = await r.json();
            if (this.isValidStructure(parsed)) {
              this.db = this.normalize(parsed);
              return this.db;
            }
          }
        } catch (err) {
          console.warn('[Store] No se pudo obtener semilla mediante fetch:', err.message);
        }
      }

      this.db = this.createDefaultDB();
      return this.db;
    },

    async save() {
      if (!this.isValidStructure(this.db)) {
        console.error('[Store] Intento de guardado cancelado: estructura de base de datos inválida.');
        return false;
      }

      this.normalize(this.db);
      const t = JSON.stringify(this.db, null, 2);
      let savedOk = true;

      if (typeof window !== 'undefined' && window.rotastock?.isElectron) {
        try {
          const res = await window.rotastock.saveDB(t);
          if (!res) {
            console.error('[Store] El proceso principal de Electron rechazó el guardado.');
            savedOk = false;
          }
        } catch (err) {
          console.error('[Store] Error al guardar vía Electron IPC:', err.message);
          savedOk = false;
        }
      }

      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem(this.key, t);
        } catch (err) {
          console.warn('[Store] No se pudo espejar la base de datos en localStorage:', err.message);
        }
      }

      return savedOk;
    }
  };

  globalThis.Store = Store;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Store };
  }
})();
