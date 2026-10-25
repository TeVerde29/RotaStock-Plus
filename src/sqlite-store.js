'use strict';

/**
 * Motor de persistencia relacional SQLite transaccional (Espejo de Alto Rendimiento).
 * Diseñado para escalar a más de 50,000 movimientos manteniendo 100% de compatibilidad
 * con el estado único JSON descrito en funcionalidades.md.
 */

const fs = require('fs');
const path = require('path');

let DatabaseSync = null;
try {
  // Soporte nativo en Node.js >= 22.5 (node:sqlite)
  const nodeSqlite = require('node:sqlite');
  if (nodeSqlite && typeof nodeSqlite.DatabaseSync === 'function') {
    DatabaseSync = nodeSqlite.DatabaseSync;
  }
} catch (_err) {
  try {
    // Fallback por si se instala better-sqlite3 en el futuro
    DatabaseSync = require('better-sqlite3');
  } catch (_err2) {
    DatabaseSync = null;
  }
}

class SQLiteStore {
  /**
   * @param {string} sqlitePath Ruta al archivo .sqlite
   */
  constructor(sqlitePath) {
    this.sqlitePath = sqlitePath;
    this.db = null;
    this.available = Boolean(DatabaseSync);
  }

  /**
   * Inicializa el esquema relacional y los índices para consultas rápidas FIFO.
   */
  init() {
    if (!this.available) return false;
    try {
      const dir = path.dirname(this.sqlitePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.db = new DatabaseSync(this.sqlitePath);
      this.db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS kv_meta (
          clave TEXT PRIMARY KEY,
          valor TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS productos (
          id TEXT PRIMARY KEY,
          nombre TEXT NOT NULL,
          costoUnitario REAL NOT NULL DEFAULT 0,
          leadTime INTEGER NOT NULL DEFAULT 7,
          desviacionLeadTime REAL NOT NULL DEFAULT 1,
          nivelServicioZ REAL NOT NULL DEFAULT 1.65,
          creadoEn TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS movimientos (
          id TEXT PRIMARY KEY,
          timestamp TEXT NOT NULL,
          tipo TEXT NOT NULL,
          productoId TEXT NOT NULL,
          cantidad INTEGER NOT NULL,
          costoUnitario REAL NOT NULL,
          _cogs REAL NOT NULL DEFAULT 0,
          _ingreso REAL NOT NULL DEFAULT 0,
          motivoAjuste TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_mov_timestamp ON movimientos(timestamp ASC, id ASC);
        CREATE INDEX IF NOT EXISTS idx_mov_producto ON movimientos(productoId, timestamp ASC);

        CREATE TABLE IF NOT EXISTS conteos_ciclicos (
          id TEXT PRIMARY KEY,
          timestamp TEXT NOT NULL,
          productoId TEXT NOT NULL,
          stockSistema INTEGER NOT NULL,
          stockFisico INTEGER NOT NULL,
          discrepancia INTEGER NOT NULL,
          motivo TEXT,
          iraCumplido INTEGER NOT NULL DEFAULT 0,
          movimientoAjusteId TEXT
        );
      `);
      return true;
    } catch (err) {
      console.error('[SQLiteStore] No se pudo inicializar SQLite:', err.message);
      this.available = false;
      this.db = null;
      return false;
    }
  }

  /**
   * Sincroniza atómicamente el estado completo del objeto DB dentro de SQLite usando una transacción ACID.
   * @param {object} data Objeto de base de datos validado
   */
  syncFromObject(data) {
    if (!this.available) return false;
    if (!this.db && !this.init()) return false;

    try {
      this.db.exec('BEGIN IMMEDIATE TRANSACTION;');

      this.db.exec('DELETE FROM kv_meta;');
      this.db.exec('DELETE FROM productos;');
      this.db.exec('DELETE FROM movimientos;');
      this.db.exec('DELETE FROM conteos_ciclicos;');

      const insMeta = this.db.prepare('INSERT INTO kv_meta (clave, valor) VALUES (?, ?)');
      insMeta.run('meta', JSON.stringify(data.meta || {}));
      insMeta.run('config', JSON.stringify(data.config || {}));

      const insProd = this.db.prepare(`
        INSERT INTO productos (id, nombre, costoUnitario, leadTime, desviacionLeadTime, nivelServicioZ, creadoEn)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const p of data.productos || []) {
        insProd.run(
          String(p.id),
          String(p.nombre),
          Number(p.costoUnitario ?? 0),
          Number(p.leadTime ?? 7),
          Number(p.desviacionLeadTime ?? 1),
          Number(p.nivelServicioZ ?? 1.65),
          String(p.creadoEn || new Date().toISOString())
        );
      }

      const insMov = this.db.prepare(`
        INSERT INTO movimientos (id, timestamp, tipo, productoId, cantidad, costoUnitario, _cogs, _ingreso, motivoAjuste)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const m of data.movimientos || []) {
        insMov.run(
          String(m.id),
          String(m.timestamp),
          String(m.tipo),
          String(m.productoId),
          Number(m.cantidad),
          Number(m.costoUnitario),
          Number(m._cogs ?? 0),
          Number(m._ingreso ?? 0),
          m.motivoAjuste ?? null
        );
      }

      const insAud = this.db.prepare(`
        INSERT INTO conteos_ciclicos (id, timestamp, productoId, stockSistema, stockFisico, discrepancia, motivo, iraCumplido, movimientoAjusteId)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const c of data.conteosCiclicos || []) {
        insAud.run(
          String(c.id),
          String(c.timestamp),
          String(c.productoId),
          Number(c.stockSistema),
          Number(c.stockFisico),
          Number(c.discrepancia),
          c.motivo ?? null,
          Number(c.iraCumplido ?? (c.discrepancia === 0 ? 1 : 0)),
          c.movimientoAjusteId ?? null
        );
      }

      this.db.exec('COMMIT;');
      return true;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK;');
      } catch (rbErr) {
        console.error('[SQLiteStore] Error en rollback:', rbErr.message);
      }
      console.error('[SQLiteStore] Error al sincronizar estado en SQLite:', err.message);
      return false;
    }
  }

  /**
   * Reconstruye el objeto completo de base de datos leyendo desde las tablas relacionales SQLite.
   * @returns {object | null}
   */
  exportToObject() {
    if (!this.available) return null;
    if (!this.db && !this.init()) return null;

    try {
      const metaRow = this.db.prepare('SELECT valor FROM kv_meta WHERE clave = ?').get('meta');
      const cfgRow = this.db.prepare('SELECT valor FROM kv_meta WHERE clave = ?').get('config');
      if (!cfgRow) return null;

      const meta = metaRow ? JSON.parse(metaRow.valor) : {};
      const config = JSON.parse(cfgRow.valor);
      const productos = this.db.prepare('SELECT * FROM productos').all();
      const movimientos = this.db.prepare('SELECT * FROM movimientos ORDER BY timestamp ASC, id ASC').all();
      const conteosCiclicos = this.db.prepare('SELECT * FROM conteos_ciclicos').all();

      return {
        meta,
        config,
        productos: productos.map(p => ({ ...p })),
        movimientos: movimientos.map(m => ({ ...m })),
        conteosCiclicos: conteosCiclicos.map(c => ({ ...c }))
      };
    } catch (err) {
      console.error('[SQLiteStore] Error al exportar desde SQLite:', err.message);
      return null;
    }
  }

  /**
   * Devuelve estadísticas de diagnóstico del motor SQLite.
   */
  getStatus() {
    if (!this.available || !this.db) {
      return { enabled: false, engine: 'json-only', path: this.sqlitePath };
    }
    try {
      const pCount = this.db.prepare('SELECT COUNT(*) AS c FROM productos').get().c;
      const mCount = this.db.prepare('SELECT COUNT(*) AS c FROM movimientos').get().c;
      return {
        enabled: true,
        engine: 'SQLite WAL (ACID)',
        path: this.sqlitePath,
        productos: pCount,
        movimientos: mCount
      };
    } catch (err) {
      return { enabled: false, engine: 'error', error: err.message };
    }
  }

  close() {
    if (this.db) {
      try {
        this.db.close();
      } catch (err) {
        console.error('[SQLiteStore] Error al cerrar base SQLite:', err.message);
      }
      this.db = null;
    }
  }
}

module.exports = {
  SQLiteStore
};
