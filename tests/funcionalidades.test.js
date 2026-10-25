'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const RotaConstants = require('../frontend/constants.js');
const { Store } = require('../frontend/store.js');
const { Engine } = require('../frontend/engine.js');
const { buildWorkbook } = require('../frontend/reports.js');
const { State } = require('../frontend/app.js');
const { validateDB, parseAndValidateDB } = require('../src/validator.js');
const { writeFileAtomicSync } = require('../src/atomic-fs.js');
const { SQLiteStore } = require('../src/sqlite-store.js');
const { AppUpdater } = require('../src/updater.js');
const signHook = require('../scripts/sign-windows.js');

const SEED_PATH = path.join(__dirname, '..', 'datos', 'inventario.json');

function resetToEmptyDB() {
  Store.db = Store.createDefaultDB();
}

test('1. Línea Base Matemática: Semilla inventario.json produce exactamente los mismos resultados', () => {
  const seedRaw = fs.readFileSync(SEED_PATH, 'utf8');
  const check = parseAndValidateDB(seedRaw);
  assert.equal(check.valid, true, 'La semilla debe pasar la validación de esquema');

  Store.db = check.db;
  const c0 = Engine.compute(0);

  assert.equal(c0.rows.length, 12);
  assert.equal(c0.totCogs, 159950);
  assert.equal(c0.totIng, 260000);
  assert.equal(c0.totGan, 100050);
  assert.equal(c0.totVal, 40550);
});

test('2. Sección 3.6 de funcionalidades.md: Ejemplo Numérico Completo de Simulación Multi-Precio FIFO', () => {
  resetToEmptyDB();
  Store.db.productos.push({
    id: 'p_mon',
    nombre: 'Monitor 27 4K',
    costoUnitario: 180,
    leadTime: 7,
    desviacionLeadTime: 1,
    nivelServicioZ: 1.65,
    creadoEn: '2026-01-01T00:00:00.000Z'
  });

  // 1. 10 de Enero: Compra de 10 unidades a $180.00 c/u
  Store.db.movimientos.push({
    id: 'm_1',
    timestamp: '2026-01-10T10:00:00.000Z',
    tipo: 'compra',
    productoId: 'p_mon',
    cantidad: 10,
    costoUnitario: 180,
    _cogs: 0,
    _ingreso: 0,
    motivoAjuste: null
  });

  // 2. 20 de Enero: Compra de 15 unidades a $200.00 c/u
  Store.db.movimientos.push({
    id: 'm_2',
    timestamp: '2026-01-20T10:00:00.000Z',
    tipo: 'compra',
    productoId: 'p_mon',
    cantidad: 15,
    costoUnitario: 200,
    _cogs: 0,
    _ingreso: 0,
    motivoAjuste: null
  });

  // 3. 05 de Febrero: Venta de 12 unidades a un precio de venta de $320.00 c/u
  Store.db.movimientos.push({
    id: 'm_3',
    timestamp: '2026-02-05T10:00:00.000Z',
    tipo: 'venta',
    productoId: 'p_mon',
    cantidad: 12,
    costoUnitario: 320,
    _cogs: 0,
    _ingreso: 0,
    motivoAjuste: null
  });

  const res = Engine.compute(0);
  const row = res.rows[0];
  const capas = res.capas['p_mon'];

  // Verificación matemática exacta según Sección 3.6:
  // COGS = (10 * 180) + (2 * 200) = 1800 + 400 = $2,200.00
  // Ingreso = 12 * 320 = $3,840.00
  // Ganancia = 3840 - 2200 = $1,640.00
  // Stock restante = 13 uds @ $200 = $2,600.00
  assert.equal(row.cogs, 2200);
  assert.equal(row.ingresos, 3840);
  assert.equal(row.ganancia, 1640);
  assert.equal(row.stockActual, 13);
  assert.equal(row.valorInventario, 2600);
  assert.equal(capas.length, 1);
  assert.equal(capas[0].qty, 13);
  assert.equal(capas[0].costo, 200);
});

test('3. Sección 5 de funcionalidades.md: Heurística ABC por Proximidad, Empate y Estabilidad XYZ', () => {
  resetToEmptyDB();
  // p1 = 75% (A), p3 = 18% (antes=75, despues=93 -> B), p2 = 7% (antes=93, despues=100; 100-95=5 > 95-93=2 -> C)
  Store.db.productos.push(
    { id: 'p1', nombre: 'Prod 1', costoUnitario: 75, leadTime: 7, desviacionLeadTime: 1, nivelServicioZ: 1.65, creadoEn: '2026-01-01T00:00:00.000Z' },
    { id: 'p2', nombre: 'Prod 2', costoUnitario: 7, leadTime: 7, desviacionLeadTime: 1, nivelServicioZ: 1.65, creadoEn: '2026-01-01T00:00:00.000Z' },
    { id: 'p3', nombre: 'Prod 3', costoUnitario: 18, leadTime: 7, desviacionLeadTime: 1, nivelServicioZ: 1.65, creadoEn: '2026-01-01T00:00:00.000Z' }
  );
  Store.db.movimientos.push(
    { id: 'm1', timestamp: '2026-01-01T10:00:00.000Z', tipo: 'compra', productoId: 'p1', cantidad: 1, costoUnitario: 75 },
    { id: 'm2', timestamp: '2026-01-01T10:00:00.000Z', tipo: 'compra', productoId: 'p2', cantidad: 1, costoUnitario: 7 },
    { id: 'm3', timestamp: '2026-01-01T10:00:00.000Z', tipo: 'compra', productoId: 'p3', cantidad: 1, costoUnitario: 18 }
  );

  const abc = Engine.abc('valor');
  assert.equal(abc[0].r.id, 'p1');
  assert.equal(abc[0].abc, 'A');
  assert.equal(abc[1].r.id, 'p3');
  assert.equal(abc[1].abc, 'B');
  assert.equal(abc[2].r.id, 'p2');
  assert.equal(abc[2].abc, 'C');

  // Invariante #5: Épsilon en ABC por COGS cuando cogs === 0 (valorInventario * 0.001)
  const abcDemanda = Engine.abc('demanda');
  assert.equal(abcDemanda[0].v, 75 * 0.001);
});

test('4. Sección 6 de funcionalidades.md: Modelo Matemático de Reabastecimiento (Suavizado Exponencial, SS, PRO)', () => {
  resetToEmptyDB();
  Store.db.productos.push({
    id: 'p_reab',
    nombre: 'Teclado Pro',
    costoUnitario: 50,
    leadTime: 7,
    desviacionLeadTime: 1,
    nivelServicioZ: 1.65,
    creadoEn: '2026-01-01T00:00:00.000Z'
  });
  Store.db.movimientos.push(
    { id: 'm1', timestamp: '2026-01-01T00:00:00.000Z', tipo: 'compra', productoId: 'p_reab', cantidad: 100, costoUnitario: 50 },
    { id: 'm2', timestamp: '2026-01-15T00:00:00.000Z', tipo: 'venta', productoId: 'p_reab', cantidad: 30, costoUnitario: 80 },
    { id: 'm3', timestamp: '2026-02-15T00:00:00.000Z', tipo: 'venta', productoId: 'p_reab', cantidad: 60, costoUnitario: 80 }
  );

  const reab = Engine.reabastecimiento()[0];
  // Mes 1 = 30, Mes 2 = 60 -> F0 = 30, F1 = 0.3 * 60 + 0.7 * 30 = 18 + 21 = 39
  assert.equal(reab.pron, 39);
  // Media mensual = (30 + 60) / 2 = 45 -> dBar = 45 / 30 = 1.5 uds/día
  assert.equal(reab.dBar, 1.5);
  assert.equal(reab.stockActual, 10);
  assert.equal(reab.alerta, true);
  assert.ok(reab.sug > 0);
});

test('5. Sección 7 y Mejora #8: Ajustes Automáticos de Conteo Cíclico e Integridad FIFO', () => {
  resetToEmptyDB();
  Store.db.productos.push({
    id: 'p_aud',
    nombre: 'Disco SSD',
    costoUnitario: 100,
    leadTime: 7,
    desviacionLeadTime: 1,
    nivelServicioZ: 1.65,
    creadoEn: '2026-01-01T00:00:00.000Z'
  });
  Store.db.movimientos.push({
    id: 'm1',
    timestamp: '2026-01-01T00:00:00.000Z',
    tipo: 'compra',
    productoId: 'p_aud',
    cantidad: 10,
    costoUnitario: 100
  });

  const cBefore = Engine.compute(0).rows[0];
  assert.equal(cBefore.stockActual, 10);
  assert.equal(cBefore.valorInventario, 1000);

  // Faltante de 2 unidades (contado físico = 8, sistema = 10 -> discrepancia = -2)
  const movId = Engine.crearMovimientoAjuste('p_aud', -2, 'Merma verificada', cBefore.stockActual, cBefore.valorInventario);
  assert.ok(movId);

  const cAfter = Engine.compute(0).rows[0];
  assert.equal(cAfter.stockActual, 8);
  assert.equal(cAfter.valorInventario, 800);
  assert.equal(cAfter.cogs, 200);
});

test('6. Sección 9.1 de funcionalidades.md: Exportación de Libro Excel con 4 Hojas y Fórmulas Vivas', () => {
  // Cargar librería XLSX real del vendor para probar buildWorkbook de extremo a extremo
  globalThis.XLSX = require('../frontend/assets/vendor/xlsx.full.min.js');
  Store.db = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
  const comp = Engine.compute(30);
  const wb = buildWorkbook(comp, 'valor');

  assert.deepEqual(wb.SheetNames, [
    '1. Capas FIFO',
    '2. Clasificación ABC',
    '3. Plan de compras',
    '4. Resumen'
  ]);

  const sheet1 = wb.Sheets['1. Capas FIFO'];
  // Verificar fórmula viva en columna H fila 6 (G6*D6)
  assert.equal(sheet1['H6'].f, 'G6*D6');
});

test('7. Mejora #1 y #2: Validador de Esquema y Escritura Atómica en Disco', () => {
  const bad1 = parseAndValidateDB('no es json');
  assert.equal(bad1.valid, false);

  const bad2 = parseAndValidateDB(JSON.stringify({ config: { umbrales: { sana: 20, lenta: 10, muyLenta: 5 } }, productos: [], movimientos: [] }));
  assert.equal(bad2.valid, false, 'Debe rechazar umbrales mal ordenados');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rotastock-test-'));
  const targetFile = path.join(tmpDir, 'inventario.json');
  const payload = JSON.stringify(Store.createDefaultDB(), null, 2);

  writeFileAtomicSync(targetFile, payload);
  assert.equal(fs.existsSync(targetFile), true);
  assert.equal(fs.readFileSync(targetFile, 'utf8'), payload);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('8. Mejora #13: Persistencia Transaccional SQLite (Sincronización y Recuperación Íntegra)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rotastock-sqlite-'));
  const dbFile = path.join(tmpDir, 'inventario.sqlite');
  const sqlite = new SQLiteStore(dbFile);

  if (sqlite.available) {
    assert.equal(sqlite.init(), true);
    const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));
    assert.equal(sqlite.syncFromObject(seed), true);

    const status = sqlite.getStatus();
    assert.equal(status.enabled, true);
    assert.equal(status.productos, 12);
    assert.equal(status.movimientos, 40);

    const exported = sqlite.exportToObject();
    assert.equal(exported.productos.length, 12);
    assert.equal(exported.movimientos.length, 40);
    sqlite.close();
  }

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('9. Mejoras #4, #7, #9, #10, #11, #14 y #15: Seguridad, Estado, Constantes, Updater y Firma', async () => {
  // Mejora #9: Archivo huérfano styles.css eliminado
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'frontend', 'styles.css')), false);

  // Mejora #4: CSP presente en index.html y sandbox: true en main.js
  const html = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'index.html'), 'utf8');
  assert.ok(html.includes('http-equiv="Content-Security-Policy"'));
  const mainCode = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.ok(mainCode.includes('sandbox: true'));

  // Mejora #7 y #10: Estado encapsulado con conjunto dirtyViews para lazy rendering
  assert.equal(typeof State, 'object');
  assert.ok(State.dirtyViews instanceof Set);
  assert.equal(State.period, 30);

  // Mejora #11: Constantes de dominio explícitas
  assert.equal(RotaConstants.MS_PER_DAY, 86400000);
  assert.equal(RotaConstants.FLOAT_EPSILON, 1e-9);
  assert.equal(RotaConstants.ALFA_SUAVIZADO, 0.3);

  // Mejora #14: AppUpdater funciona de forma segura en modo offline
  const updater = new AppUpdater();
  const upRes = await updater.checkForUpdates();
  assert.equal(upRes.available, false);
  assert.equal(upRes.currentVersion, '2.0.2');

  // Mejora #15: Hook de firma de Windows funciona sin fallar cuando no hay certificado comercial
  await assert.doesNotReject(async () => {
    await signHook.default({ path: 'dist/RotaStockPlus.exe' });
  });
});

test('10. Rango de Fechas Personalizado ("Desde" y "Hasta"): Filtra y calcula capas FIFO exactamente en la ventana elegida', () => {
  resetToEmptyDB();
  Store.db.productos.push({
    id: 'p_rng',
    nombre: 'Router Industrial',
    costoUnitario: 100,
    leadTime: 7,
    desviacionLeadTime: 1,
    nivelServicioZ: 1.65,
    creadoEn: '2026-01-01T00:00:00.000Z'
  });

  // Compra el 05 de enero: 20 uds @ $100
  Store.db.movimientos.push({
    id: 'm_r1',
    timestamp: '2026-01-05T12:00:00.000Z',
    tipo: 'compra',
    productoId: 'p_rng',
    cantidad: 20,
    costoUnitario: 100
  });
  // Venta el 15 de enero (dentro de la ventana 10-20 ene): 5 uds @ $160
  Store.db.movimientos.push({
    id: 'm_r2',
    timestamp: '2026-01-15T12:00:00.000Z',
    tipo: 'venta',
    productoId: 'p_rng',
    cantidad: 5,
    costoUnitario: 160
  });
  // Venta el 28 de enero (fuera de la ventana 10-20 ene): 8 uds @ $160
  Store.db.movimientos.push({
    id: 'm_r3',
    timestamp: '2026-01-28T12:00:00.000Z',
    tipo: 'venta',
    productoId: 'p_rng',
    cantidad: 8,
    costoUnitario: 160
  });

  const cCustom = Engine.compute({ start: '2026-01-10', end: '2026-01-20' });
  const r = cCustom.rows[0];

  // Al corte del 20 de enero solo ocurrió la venta de 5 uds (quedan 15 uds en stock a esa fecha)
  assert.equal(r.salidasPer, 5);
  assert.equal(r.cogs, 500);
  assert.equal(r.ingresos, 800);
  assert.equal(r.stockActual, 15);

  // Si el usuario invierte accidentalmente Desde y Hasta, Engine.range los ordena automáticamente
  const cInverted = Engine.compute({ start: '2026-01-20', end: '2026-01-10' });
  assert.equal(cInverted.rows[0].salidasPer, 5);
  assert.equal(cInverted.rows[0].stockActual, 15);
});

test('11. Modo Viaje en el Tiempo (Copias en Solo Lectura): Previsualiza copias sin sobrescribir la base actual', async () => {
  resetToEmptyDB();
  Store.db.productos.push({
    id: 'p_live',
    nombre: 'Producto Actual En Vivo',
    costoUnitario: 50,
    leadTime: 7,
    desviacionLeadTime: 1,
    nivelServicioZ: 1.65,
    creadoEn: '2026-03-01T00:00:00.000Z'
  });

  const backupPasado = Store.createDefaultDB();
  backupPasado.productos.push({
    id: 'p_old',
    nombre: 'Producto Histórico Septiembre',
    costoUnitario: 30,
    leadTime: 5,
    desviacionLeadTime: 1,
    nivelServicioZ: 1.28,
    creadoEn: '2026-09-28T00:00:00.000Z'
  });

  assert.equal(Store.isReadOnly(), false);

  // Entrar en Modo Viaje en el Tiempo
  const ok = Store.previewSnapshot(backupPasado, 'inventario-2026-09-28.json');
  assert.equal(ok, true);
  assert.equal(Store.isReadOnly(), true);
  assert.equal(Store.activeSnapshotName, 'inventario-2026-09-28.json');
  assert.equal(Store.db.productos[0].id, 'p_old');

  // Mientras está en modo lectura, Store.save() debe bloquear cualquier escritura en disco
  const saveAttempt = await Store.save();
  assert.equal(saveAttempt, false);

  // Al salir del Modo Viaje en el Tiempo, vuelve intacta la base de datos en vivo
  Store.exitSnapshot();
  assert.equal(Store.isReadOnly(), false);
  assert.equal(Store.activeSnapshotName, null);
  assert.equal(Store.db.productos.length, 1);
  assert.equal(Store.db.productos[0].id, 'p_live');
});
