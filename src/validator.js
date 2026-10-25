'use strict';

/**
 * Validador de integridad y esquema para la base de datos de RotaStock Plus (v2.0.0).
 * Cumple con la Sección 2 de funcionalidades.md.
 */

const VALID_MOV_TYPES = new Set(['compra', 'venta', 'ajuste_excedente']);

function isPlainObject(obj) {
  return typeof obj === 'object' && obj !== null && !Array.isArray(obj);
}

/**
 * Valida que un objeto de base de datos cumpla con la estructura requerida.
 * @param {any} db Objeto parseado del JSON
 * @returns {{ valid: boolean, error: string | null }}
 */
function validateDB(db) {
  if (!isPlainObject(db)) {
    return { valid: false, error: 'La raíz de la base de datos debe ser un objeto JSON.' };
  }

  if (!isPlainObject(db.config)) {
    return { valid: false, error: 'Falta el objeto obligatorio "config".' };
  }

  if (!isPlainObject(db.config.umbrales)) {
    return { valid: false, error: 'Falta el objeto "config.umbrales".' };
  }

  const { sana, lenta, muyLenta } = db.config.umbrales;
  if (
    !Number.isFinite(Number(sana)) ||
    !Number.isFinite(Number(lenta)) ||
    !Number.isFinite(Number(muyLenta)) ||
    Number(sana) < 0 ||
    Number(sana) > Number(lenta) ||
    Number(lenta) > Number(muyLenta)
  ) {
    return { valid: false, error: 'Los umbrales de rotación deben ser numéricos y cumplir 0 <= sana <= lenta <= muyLenta.' };
  }

  if (!Array.isArray(db.productos)) {
    return { valid: false, error: 'El campo "productos" debe ser un arreglo.' };
  }

  if (!Array.isArray(db.movimientos)) {
    return { valid: false, error: 'El campo "movimientos" debe ser un arreglo.' };
  }

  if (db.conteosCiclicos !== undefined && !Array.isArray(db.conteosCiclicos)) {
    return { valid: false, error: 'El campo "conteosCiclicos" debe ser un arreglo.' };
  }

  for (let i = 0; i < db.productos.length; i++) {
    const p = db.productos[i];
    if (!isPlainObject(p) || typeof p.id !== 'string' || !p.id.trim()) {
      return { valid: false, error: `Producto en índice ${i} carece de "id" válido.` };
    }
    if (typeof p.nombre !== 'string' || !p.nombre.trim()) {
      return { valid: false, error: `Producto "${p.id}" carece de "nombre" válido.` };
    }
    if (p.costoUnitario !== undefined && (!Number.isFinite(Number(p.costoUnitario)) || Number(p.costoUnitario) < 0)) {
      return { valid: false, error: `Producto "${p.id}" tiene un "costoUnitario" inválido.` };
    }
  }

  for (let i = 0; i < db.movimientos.length; i++) {
    const m = db.movimientos[i];
    if (!isPlainObject(m) || typeof m.id !== 'string' || !m.id.trim()) {
      return { valid: false, error: `Movimiento en índice ${i} carece de "id" válido.` };
    }
    if (!VALID_MOV_TYPES.has(m.tipo)) {
      return { valid: false, error: `Movimiento "${m.id}" tiene un tipo inválido: "${m.tipo}".` };
    }
    if (typeof m.productoId !== 'string' || !m.productoId.trim()) {
      return { valid: false, error: `Movimiento "${m.id}" carece de "productoId" válido.` };
    }
    if (!Number.isFinite(Number(m.cantidad)) || Number(m.cantidad) <= 0) {
      return { valid: false, error: `Movimiento "${m.id}" tiene una cantidad inválida (${m.cantidad}).` };
    }
    if (!Number.isFinite(Number(m.costoUnitario)) || Number(m.costoUnitario) < 0) {
      return { valid: false, error: `Movimiento "${m.id}" tiene un costoUnitario inválido (${m.costoUnitario}).` };
    }
    if (typeof m.timestamp !== 'string' || Number.isNaN(new Date(m.timestamp).getTime())) {
      return { valid: false, error: `Movimiento "${m.id}" tiene un timestamp inválido.` };
    }
  }

  return { valid: true, error: null };
}

/**
 * Parsea un string JSON y valida que represente una base de datos íntegra de RotaStock Plus.
 * Normaliza propiedades opcionales como meta y conteosCiclicos si faltan.
 * @param {string} rawText Texto JSON
 * @returns {{ valid: boolean, db: object | null, error: string | null }}
 */
function parseAndValidateDB(rawText) {
  if (typeof rawText !== 'string' || !rawText.trim()) {
    return { valid: false, db: null, error: 'El contenido recibido está vacío o no es texto.' };
  }
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    return { valid: false, db: null, error: `JSON mal formado: ${err.message}` };
  }

  const check = validateDB(parsed);
  if (!check.valid) {
    return { valid: false, db: null, error: check.error };
  }

  if (!Array.isArray(parsed.conteosCiclicos)) {
    parsed.conteosCiclicos = [];
  }
  if (!isPlainObject(parsed.meta)) {
    parsed.meta = {
      sistema: 'RotaStock Plus',
      versionEsquema: '2.0.0',
      createdAt: new Date().toISOString()
    };
  }
  parsed.meta.totalProductos = parsed.productos.length;
  parsed.meta.totalMovimientos = parsed.movimientos.length;

  return { valid: true, db: parsed, error: null };
}

module.exports = {
  validateDB,
  parseAndValidateDB
};
