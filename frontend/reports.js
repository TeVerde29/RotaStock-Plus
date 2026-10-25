'use strict';

/**
 * Motor de Exportación Ejecutiva: Libro Excel (4 hojas con fórmulas vivas y matrices analíticas)
 * e Informe PDF Ejecutivo (diseño corporativo RotaStock Plus, insignias semánticas, 6 secciones + Capas FIFO).
 * Implementa y enriquece la Sección 9 de funcionalidades.md.
 */
(function () {
  const { EST_LBL, XYZ_LBL, $, fmtN, fmt0, fmtD, fmtF } =
    globalThis.RotaConstants || require('./constants.js');
  const { Store } = globalThis.Store ? { Store: globalThis.Store } : require('./store.js');
  const { Engine } = globalThis.Engine ? { Engine: globalThis.Engine } : require('./engine.js');

  const colL = n => {
    let s = '';
    n++;
    while (n > 0) {
      const m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  };

  const XF = {
    money: '$#,##0.00',
    int: '#,##0',
    qty1: '#,##0.0',
    rot: '0.00"×"',
    dias: '0.0" días"',
    pct1: '0.0%',
    pct2: '0.00%',
    cv: '0.00',
    fecha: 'yyyy-mm-dd'
  };

  const N = (v, z) => ({ t: 'n', v: Number.isFinite(+v) ? +v : 0, z });

  function barraProgreso(pct, width = 12) {
    const p = Math.max(0, Math.min(100, Number(pct) || 0));
    const filled = Math.round((p / 100) * width);
    return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled));
  }

  function wsAoa(aoa, cols, merges, autofilter, rowsHeight) {
    const XLSXLib = globalThis.XLSX;
    const ws = XLSXLib.utils.aoa_to_sheet(aoa);
    if (cols) ws['!cols'] = cols;
    if (merges) ws['!merges'] = merges;
    if (autofilter) ws['!autofilter'] = { ref: autofilter };
    if (rowsHeight) ws['!rows'] = rowsHeight;
    return ws;
  }

  /* ==========================================================================
     1. LIBRO EXCEL EJECUTIVO (.XLSX) — 4 HOJAS CON FÓRMULAS VIVAS Y DIAGNÓSTICO
     ========================================================================== */
  function buildWorkbook(C, base) {
    const XLSXLib = globalThis.XLSX;
    const wb = XLSXLib.utils.book_new();
    const emp = Store.db.config.preferenciasUI.nombreEmpresa || 'Mi negocio';
    const periodo = `${fmtD(C.start)} al ${fmtD(C.end)} (${C.delta} días)`;
    const modoDatos = Store.isReadOnly && Store.isReadOnly()
      ? `Copia histórica (${Store.activeSnapshotName})`
      : 'Base de datos actual (En vivo)';
    const estadoLbl = e => (e === 'sinDatos' ? 'Sin datos' : EST_LBL[e]);

    /* ---- Hoja 1: Capas FIFO (conserva H6 = G6*D6 e incorpora columnas financieras K..Q) ---- */
    const a1 = [
      ['ROTASTOCK PLUS — VALORACIÓN DE CAPAS FIFO (PEPS) Y DESEMPEÑO POR LOTE'],
      ['Empresa', emp, '', 'Emitido', fmtD(new Date()), '', 'Origen de datos', modoDatos],
      ['Período analizado', periodo, '', 'Método de costeo', 'FIFO Estricto (Primeras Entradas, Primeras Salidas)', '', 'Total Productos', C.rows.length],
      [],
      [
        'Producto',
        'Lote',
        'Fecha entrada',
        'Costo unit.',
        'Entradas (período)',
        'Salidas (período)',
        'Stock',
        'Valor capa',
        'Días sin mov.',
        'Estado',
        '% Peso Stock',
        'Ingresos (período)',
        'COGS FIFO (período)',
        'Ganancia Bruta',
        'Margen Bruto %',
        'Rotación',
        'Cobertura (días)'
      ]
    ];

    let totalCapasCount = 0;
    for (const p of C.rows) {
      const live = C.capas[p.id] && C.capas[p.id].length ? C.capas[p.id] : [null];
      totalCapasCount += live.length;
    }

    let er = a1.length + 1; // Fila 6
    const er0 = er;
    const totalRowIdx = er0 + totalCapasCount;

    for (const p of C.rows) {
      const live =
        C.capas[p.id] && C.capas[p.id].length
          ? C.capas[p.id]
          : [{ n: '—', qty: p.stockActual, costo: p.stockActual > 0 ? p.valorInventario / p.stockActual : p.costoUnitario || 0, fecha: null }];
      live.forEach((l, i) => {
        a1.push([
          p.nombre,
          typeof l.n === 'number' ? 'Lote #' + l.n : 'Sin lote activo',
          l.fecha ? { t: 'd', v: new Date(l.fecha), z: XF.fecha } : '—',
          N(l.costo, XF.money),
          i === 0 ? N(p.entradasPer, XF.int) : N(0, XF.int),
          i === 0 ? N(p.salidasPer, XF.int) : N(0, XF.int),
          N(l.qty, XF.int),
          { t: 'n', f: `${colL(6)}${er}*${colL(3)}${er}`, z: XF.money }, // H{er} = G{er}*D{er}
          p.diasSinMov !== null ? N(p.diasSinMov, XF.int) : '—',
          estadoLbl(p.estado),
          { t: 'n', f: `IF($H$${totalRowIdx}>0,${colL(7)}${er}/$H$${totalRowIdx},0)`, z: XF.pct1 },
          i === 0 ? N(p.ingresos, XF.money) : N(0, XF.money),
          i === 0 ? N(p.cogs, XF.money) : N(0, XF.money),
          { t: 'n', f: `${colL(11)}${er}-${colL(12)}${er}`, z: XF.money },
          { t: 'n', f: `IF(${colL(11)}${er}>0,${colL(13)}${er}/${colL(11)}${er},0)`, z: XF.pct1 },
          i === 0 ? N(p.rotacion, XF.rot) : '—',
          i === 0 && p.cobertura !== null ? N(p.cobertura, XF.dias) : '—'
        ]);
        er++;
      });
    }
    const er1 = er - 1;
    a1.push([
      'TOTAL GENERAL',
      `${totalCapasCount} lote(s)`,
      '',
      '',
      { t: 'n', f: `SUM(${colL(4)}${er0}:${colL(4)}${er1})`, z: XF.int },
      { t: 'n', f: `SUM(${colL(5)}${er0}:${colL(5)}${er1})`, z: XF.int },
      { t: 'n', f: `SUM(${colL(6)}${er0}:${colL(6)}${er1})`, z: XF.int },
      { t: 'n', f: `SUM(${colL(7)}${er0}:${colL(7)}${er1})`, z: XF.money },
      '',
      '',
      { t: 'n', f: `SUM(${colL(10)}${er0}:${colL(10)}${er1})`, z: XF.pct1 },
      { t: 'n', f: `SUM(${colL(11)}${er0}:${colL(11)}${er1})`, z: XF.money },
      { t: 'n', f: `SUM(${colL(12)}${er0}:${colL(12)}${er1})`, z: XF.money },
      { t: 'n', f: `SUM(${colL(13)}${er0}:${colL(13)}${er1})`, z: XF.money },
      { t: 'n', f: `IF(${colL(11)}${totalRowIdx}>0,${colL(13)}${totalRowIdx}/${colL(11)}${totalRowIdx},0)`, z: XF.pct1 },
      '',
      ''
    ]);

    // Resumen inferior de salud de rotación en Hoja 1
    const th = Store.db.config.umbrales;
    a1.push(
      [],
      ['DIAGNÓSTICO DE SALUD DE ROTACIÓN E INMOVILIZACIÓN DE CAPITAL'],
      ['Estado de Rotación', 'Rango de Días sin Movimiento', 'Cantidad de Productos', '% del Catálogo', 'Unidades en Stock', 'Capital en Stock ($)', '% del Capital Total']
    );
    const totValSafe = C.totVal || 1;
    const totProdSafe = C.rows.length || 1;
    [
      ['sana', `0 a ${th.sana} días (Óptimo)`],
      ['lenta', `${th.sana + 1} a ${th.lenta} días (Vigilar)`],
      ['muyLenta', `${th.lenta + 1} a ${th.muyLenta} días (Riesgo)`],
      ['dormido', `Más de ${th.muyLenta} días (Alerta capital detenido)`]
    ].forEach(([key, rango]) => {
      const grp = C.rows.filter(r => r.estado === key);
      const u = grp.reduce((s, r) => s + r.stockActual, 0);
      const v = grp.reduce((s, r) => s + r.valorInventario, 0);
      a1.push([
        EST_LBL[key],
        rango,
        N(grp.length, XF.int),
        N(grp.length / totProdSafe, XF.pct1),
        N(u, XF.int),
        N(v, XF.money),
        N(v / totValSafe, XF.pct1)
      ]);
    });

    XLSXLib.utils.book_append_sheet(
      wb,
      wsAoa(
        a1,
        [
          { wch: 30 }, { wch: 13 }, { wch: 14 }, { wch: 14 }, { wch: 17 },
          { wch: 16 }, { wch: 11 }, { wch: 16 }, { wch: 13 }, { wch: 18 },
          { wch: 14 }, { wch: 17 }, { wch: 18 }, { wch: 16 }, { wch: 15 },
          { wch: 12 }, { wch: 15 }
        ],
        [{ s: { r: 0, c: 0 }, e: { r: 0, c: 16 } }],
        `A5:Q${er1}`,
        [{ hpt: 24 }, { hpt: 18 }, { hpt: 18 }, { hpt: 10 }, { hpt: 22 }]
      ),
      '1. Capas FIFO'
    );

    /* ---- Hoja 2: Clasificación ABC / XYZ y Matriz Cruzada ---- */
    const abc = Engine.abc(base);
    const totB = abc.reduce((s, d) => s + d.v, 0) || 1;
    const gsum = g => abc.filter(d => d.abc === g);
    const baseLabel = base === 'valor' ? 'Valor en stock ($)' : 'Costo de lo vendido COGS ($)';

    const a2 = [
      ['ROTASTOCK PLUS — CLASIFICACIÓN MULTICRITERIO ABC (PARETO) Y ESTABILIDAD XYZ'],
      ['Empresa', emp, '', 'Emitido', fmtD(new Date()), '', 'Criterio ABC', base === 'valor' ? 'Capital invertido en stock' : 'Demanda valorada (COGS)'],
      ['Alcance temporal', 'Historial completo de movimientos', '', 'Umbrales Pareto', 'Clase A (~80%) · Clase B (~95%) · Clase C (Resto)', '', 'Fronteras XYZ', 'X (CV ≤ 0.50) · Y (CV ≤ 1.00) · Z (CV > 1.00)'],
      [],
      ['RESUMEN POR CATEGORÍA ABC', 'Productos (SKUs)', '% del Catálogo', baseLabel, '% del Capital / Valor', 'Frecuencia de Conteo', 'Estrategia Recomendada'],
      [
        'Categoría A — Alta criticidad',
        N(gsum('A').length, XF.int),
        N(gsum('A').length / (abc.length || 1), XF.pct1),
        N(gsum('A').reduce((s, d) => s + d.v, 0), XF.money),
        N(gsum('A').reduce((s, d) => s + d.v, 0) / totB, XF.pct1),
        'Cada 30 días',
        'Control estricto, seguimiento continuo de proveedores y stock de seguridad prioritario'
      ],
      [
        'Categoría B — Criticidad media',
        N(gsum('B').length, XF.int),
        N(gsum('B').length / (abc.length || 1), XF.pct1),
        N(gsum('B').reduce((s, d) => s + d.v, 0), XF.money),
        N(gsum('B').reduce((s, d) => s + d.v, 0) / totB, XF.pct1),
        'Cada 60 días',
        'Revisión periódica automatizada por punto de reorden estándar'
      ],
      [
        'Categoría C — Baja criticidad',
        N(gsum('C').length, XF.int),
        N(gsum('C').length / (abc.length || 1), XF.pct1),
        N(gsum('C').reduce((s, d) => s + d.v, 0), XF.money),
        N(gsum('C').reduce((s, d) => s + d.v, 0) / totB, XF.pct1),
        'Cada 120 días',
        'Pedidos espaciados para minimizar costos administrativos'
      ],
      [],
      [
        'Ranking',
        'Producto',
        'Stock Actual',
        'Valor en Stock ($)',
        'COGS Histórico ($)',
        baseLabel,
        '% del Total',
        '% Acumulado',
        'Curva Visual',
        'Grupo ABC',
        'Coef. Variación (CV)',
        'Estabilidad XYZ',
        'Perfil ABC-XYZ',
        'Revisar cada'
      ]
    ];

    const abcStartRow = a2.length + 1;
    abc.forEach((d, idx) => {
      a2.push([
        N(idx + 1, XF.int),
        d.r.nombre,
        N(d.r.stockActual, XF.int),
        N(d.r.valorInventario, XF.money),
        N(d.r.cogs, XF.money),
        N(d.v, XF.money),
        N(d.pi / 100, XF.pct2),
        N(d.pa / 100, XF.pct2),
        barraProgreso(d.pa, 10),
        'Grupo ' + d.abc,
        N(d.cv, XF.cv),
        XYZ_LBL[d.xyz],
        `${d.abc}-${d.xyz}`,
        d.abc === 'A' ? 'Cada 30 días' : d.abc === 'B' ? 'Cada 60 días' : 'Cada 120 días'
      ]);
    });
    const abcEndRow = a2.length;
    a2.push([
      '',
      'TOTAL CATÁLOGO CLASIFICADO',
      { t: 'n', f: `SUM(C${abcStartRow}:C${abcEndRow})`, z: XF.int },
      { t: 'n', f: `SUM(D${abcStartRow}:D${abcEndRow})`, z: XF.money },
      { t: 'n', f: `SUM(E${abcStartRow}:E${abcEndRow})`, z: XF.money },
      { t: 'n', f: `SUM(F${abcStartRow}:F${abcEndRow})`, z: XF.money },
      { t: 'n', f: `SUM(G${abcStartRow}:G${abcEndRow})`, z: XF.pct1 },
      '',
      '',
      '',
      '',
      '',
      '',
      ''
    ]);

    // Matriz Cruzada ABC x XYZ
    a2.push(
      [],
      ['MATRIZ DE DECISIONES LOGÍSTICAS ABC × XYZ (CANTIDAD DE PRODUCTOS POR CUADRANTE)'],
      ['Categoría ABC \\ Estabilidad XYZ', 'X — Demanda Estable (CV ≤ 0.50)', 'Y — Demanda Variable (0.50 < CV ≤ 1.00)', 'Z — Demanda Irregular (CV > 1.00)', 'Total Productos']
    );
    ['A', 'B', 'C'].forEach(g => {
      const cx = abc.filter(d => d.abc === g && d.xyz === 'X').length;
      const cy = abc.filter(d => d.abc === g && d.xyz === 'Y').length;
      const cz = abc.filter(d => d.abc === g && d.xyz === 'Z').length;
      a2.push([`Grupo ${g}`, N(cx, XF.int), N(cy, XF.int), N(cz, XF.int), N(cx + cy + cz, XF.int)]);
    });

    XLSXLib.utils.book_append_sheet(
      wb,
      wsAoa(
        a2,
        [
          { wch: 10 }, { wch: 30 }, { wch: 14 }, { wch: 17 }, { wch: 18 },
          { wch: 18 }, { wch: 13 }, { wch: 14 }, { wch: 15 }, { wch: 12 },
          { wch: 18 }, { wch: 16 }, { wch: 14 }, { wch: 16 }
        ],
        [{ s: { r: 0, c: 0 }, e: { r: 0, c: 13 } }],
        `A10:N${abcEndRow}`,
        [{ hpt: 24 }, { hpt: 18 }, { hpt: 18 }]
      ),
      '2. Clasificación ABC'
    );

    /* ---- Hoja 3: Plan de compras (con inversión estimada y prioridad) ---- */
    const reab = Engine.reabastecimiento().sort(
      (a, b) => b.alerta - a.alerta || a.stockActual - a.PRO - (b.stockActual - b.PRO)
    );
    const alertasCount = reab.filter(d => d.alerta).length;
    const totalUnidadesPedir = reab.reduce((s, d) => s + d.sug, 0);

    const a3 = [
      ['ROTASTOCK PLUS — PLANIFICACIÓN DE REABASTECIMIENTO, STOCK DE SEGURIDAD Y ORDEN DE COMPRA'],
      ['Empresa', emp, '', 'Emitido', fmtD(new Date()), '', 'Productos por comprar', `${alertasCount} de ${reab.length}`],
      ['Modelo matemático', 'Suavizado Exponencial Simple (α = 0.30) + Punto de Reorden (PRO = d̄·LT + Z·σ)', '', 'Unidades sugeridas totales', totalUnidadesPedir],
      [],
      [
        'Producto',
        'En stock',
        'Venta prom./día',
        'Pronóstico mensual',
        'Reserva (SS)',
        'Pedir al llegar a (PRO)',
        'Cantidad a pedir',
        'Estado',
        'Entrega proveedor (días)',
        'Costo unit. ref. ($)',
        'Valor stock actual ($)',
        'Inversión estimada compra ($)',
        'Cobertura actual (días)'
      ]
    ];

    const rStart = a3.length + 1;
    reab.forEach((d, idx) => {
      const rowNum = rStart + idx;
      const costoRef = d.stockActual > 0 ? d.valorInventario / d.stockActual : d.costoUnitario || 0;
      const cobDias = d.dBar > 0 ? d.stockActual / d.dBar : null;
      a3.push([
        d.nombre,
        N(d.stockActual, XF.int),
        N(d.dBar, XF.qty1),
        N(d.pron, XF.qty1),
        N(d.SS, XF.qty1),
        N(d.PRO, XF.qty1),
        N(d.sug, XF.int),
        d.alerta ? 'COMPRAR AHORA' : 'Abastecido',
        N(d.leadTime || 7, XF.int),
        N(costoRef, XF.money),
        N(d.valorInventario, XF.money),
        { t: 'n', f: `${colL(6)}${rowNum}*${colL(9)}${rowNum}`, z: XF.money }, // G{row}*J{row}
        cobDias !== null ? N(cobDias, XF.dias) : 'Sin demanda'
      ]);
    });
    const rEnd = a3.length;
    a3.push([
      'TOTAL PLAN DE REPOSICIÓN',
      { t: 'n', f: `SUM(B${rStart}:B${rEnd})`, z: XF.int },
      { t: 'n', f: `SUM(C${rStart}:C${rEnd})`, z: XF.qty1 },
      { t: 'n', f: `SUM(D${rStart}:D${rEnd})`, z: XF.qty1 },
      '',
      '',
      { t: 'n', f: `SUM(G${rStart}:G${rEnd})`, z: XF.int },
      `${alertasCount} alerta(s)`,
      '',
      '',
      { t: 'n', f: `SUM(K${rStart}:K${rEnd})`, z: XF.money },
      { t: 'n', f: `SUM(L${rStart}:L${rEnd})`, z: XF.money },
      ''
    ]);

    XLSXLib.utils.book_append_sheet(
      wb,
      wsAoa(
        a3,
        [
          { wch: 30 }, { wch: 11 }, { wch: 16 }, { wch: 18 }, { wch: 14 },
          { wch: 20 }, { wch: 16 }, { wch: 16 }, { wch: 22 }, { wch: 18 },
          { wch: 20 }, { wch: 24 }, { wch: 20 }
        ],
        [{ s: { r: 0, c: 0 }, e: { r: 0, c: 12 } }],
        `A5:M${rEnd}`,
        [{ hpt: 24 }, { hpt: 18 }, { hpt: 18 }, { hpt: 10 }, { hpt: 22 }]
      ),
      '3. Plan de compras'
    );

    /* ---- Hoja 4: Resumen Ejecutivo Integral ---- */
    const list = Store.db.conteosCiclicos || [];
    const ira = list.length ? list.filter(c => c.discrepancia === 0).length / list.length : 1;
    const top = [...C.rows].sort((a, b) => b.ingresos - a.ingresos).slice(0, 8);
    const margenBrutoGlobal = C.totIng > 0 ? C.totGan / C.totIng : 0;
    const capDormido = C.rows.filter(r => r.estado === 'dormido').reduce((s, r) => s + r.valorInventario, 0);
    const invEstimadaTotal = reab.reduce((s, d) => {
      const cRef = d.stockActual > 0 ? d.valorInventario / d.stockActual : d.costoUnitario || 0;
      return s + d.sug * cRef;
    }, 0);

    const a4 = [
      ['ROTASTOCK PLUS — RESUMEN EJECUTIVO Y TABLERO DE CONTROL GERENCIAL'],
      ['Empresa / Almacén', emp, 'Fecha de emisión', fmtD(new Date())],
      ['Período evaluado', periodo, 'Método contable', 'FIFO Estricto (PEPS)'],
      ['Estado de la base', modoDatos, 'Total movimientos históricos', N(Store.db.movimientos.length, XF.int)],
      [],
      ['1. INDICADORES FINANCIEROS Y DE ROTACIÓN DEL PERÍODO', 'VALOR', 'INTERPRETACIÓN / DETALLE OPERATIVO'],
      ['Valor total del inventario actual', N(C.totVal, XF.money), `${C.rows.reduce((s, r) => s + r.stockActual, 0)} unidades físicas distribuidas en ${C.rows.length} productos`],
      ['Ingresos totales por ventas', N(C.totIng, XF.money), `${C.rows.reduce((s, r) => s + r.salidasPer, 0)} unidades despachadas en el período`],
      ['Costo de lo vendido (COGS FIFO)', N(C.totCogs, XF.money), C.totIng > 0 ? `Representa el ${fmtN((C.totCogs / C.totIng) * 100, 1)}% de la facturación` : 'Sin despachos en el período'],
      ['Ganancia bruta del período', N(C.totGan, XF.money), 'Utilidad bruta descontando el costo exacto por capa FIFO'],
      ['Margen bruto sobre ventas (%)', N(margenBrutoGlobal, XF.pct1), margenBrutoGlobal >= 0.3 ? 'Rentabilidad saludable' : 'Margen ajustado — revisar precios de reposición'],
      ['Días de inventario (DIO)', C.dio !== null ? N(C.dio, XF.dias) : 'Sin ventas en el período', 'Tiempo estimado para agotar el stock actual al ritmo de ventas del período'],
      ['Productos en alerta (inventario dormido)', N(C.dorm, XF.int), `Superan los ${Store.db.config.umbrales.muyLenta} días sin movimiento`],
      ['Capital inmovilizado en productos dormidos', N(capDormido, XF.money), C.totVal > 0 ? `${fmtN((capDormido / C.totVal) * 100, 1)}% del valor total del almacén` : 'Sin capital detenido'],
      ['Productos que requieren compra inmediata', N(alertasCount, XF.int), `${totalUnidadesPedir} unidades sugeridas por debajo del punto de reorden (PRO)`],
      ['Inversión estimada para reabastecimiento', N(invEstimadaTotal, XF.money), 'Costo estimado para cubrir el pedido sugerido total'],
      [],
      ['2. RANKING DE PRODUCTOS LÍDERES POR INGRESOS EN EL PERÍODO', 'Ingresos ($)', 'COGS FIFO ($)', 'Ganancia ($)', 'Margen %', 'Unidades Vendidas', 'Stock Actual']
    ];
    top.forEach(r =>
      a4.push([
        r.nombre,
        N(r.ingresos, XF.money),
        N(r.cogs, XF.money),
        N(r.ganancia, XF.money),
        N(r.ingresos > 0 ? r.ganancia / r.ingresos : 0, XF.pct1),
        N(r.salidasPer, XF.int),
        N(r.stockActual, XF.int)
      ])
    );
    a4.push(
      [],
      ['3. AUDITORÍA FÍSICA Y EXACTITUD DE REGISTROS (IRA)', 'VALOR', 'OBSERVACIÓN'],
      ['Total de conteos cíclicos registrados', N(list.length, XF.int), 'Auditorías físicas ejecutadas en almacén'],
      ['Exactitud de registros de inventario (IRA %)', N(ira, XF.pct1), ira >= 0.95 ? 'Meta de exactitud cumplida (≥ 95%)' : 'Se recomienda reforzar frecuencia de conteos'],
      ['Unidades faltantes acumuladas', N(list.filter(c => c.discrepancia < 0).reduce((s, c) => s + c.discrepancia, 0), XF.int), 'Ajustadas automáticamente como salidas en el kárdex FIFO'],
      ['Unidades sobrantes acumuladas', N(list.filter(c => c.discrepancia > 0).reduce((s, c) => s + c.discrepancia, 0), XF.int), 'Incorporadas como capas de entrada al costo vigente']
    );

    XLSXLib.utils.book_append_sheet(
      wb,
      wsAoa(
        a4,
        [{ wch: 42 }, { wch: 20 }, { wch: 22 }, { wch: 18 }, { wch: 14 }, { wch: 18 }, { wch: 14 }],
        [{ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }],
        null,
        [{ hpt: 24 }, { hpt: 18 }, { hpt: 18 }, { hpt: 18 }]
      ),
      '4. Resumen'
    );
    return wb;
  }

  function repDays() {
    const v = $('#repPeriodo')?.value || '30';
    if (v === 'custom') {
      const s = $('#repFrom')?.value;
      const e = $('#repTo')?.value;
      if (s || e) return { start: s || e, end: e || s };
      return 30;
    }
    return v === 'hoy' ? 'hoy' : v === 'siempre' || v === 'all' ? 0 : +v;
  }

  /* ==========================================================================
     2. RENDERIZADO DE GRÁFICOS DE ALTA RESOLUCIÓN PARA EL PDF
     ========================================================================== */
  function chartPNG(kind, R) {
    try {
      const cv = document.createElement('canvas');
      cv.width = 960;
      cv.height = 440;
      const ink = '#1d211e',
        muted = '#5d625b',
        grid = 'rgba(29,33,30,0.09)',
        PET = '#1f5668',
        CLAY = '#a85a32',
        BG = '#faf8f3';

      // Plugin para pintar fondo limpio color papel cálido
      const bgPlugin = {
        id: 'customCanvasBg',
        beforeDraw: chart => {
          const ctx = chart.canvas.getContext('2d');
          ctx.save();
          ctx.fillStyle = BG;
          ctx.fillRect(0, 0, chart.width, chart.height);
          ctx.restore();
        }
      };

      const legend = {
        position: 'bottom',
        labels: { color: ink, font: { size: 13, weight: '600' }, padding: 16, usePointStyle: true }
      };
      const scales = {
        x: { ticks: { color: muted, font: { size: 11, weight: '600' } }, grid: { color: grid } },
        y: {
          ticks: {
            color: muted,
            font: { size: 11 },
            callback: v => '$' + Number(v).toLocaleString('en-US')
          },
          grid: { color: grid }
        }
      };

      let cfg = null;
      if (kind === 'bar') {
        const top = [...R.rows].sort((a, b) => b.ingresos - a.ingresos).slice(0, 8);
        cfg = {
          type: 'bar',
          plugins: [bgPlugin],
          data: {
            labels: top.map(r => (r.nombre.length > 20 ? r.nombre.slice(0, 19) + '…' : r.nombre)),
            datasets: [
              { label: 'Ingresos ($)', data: top.map(r => +r.ingresos.toFixed(2)), backgroundColor: PET, borderRadius: 4 },
              { label: 'Costo Vendido COGS ($)', data: top.map(r => +r.cogs.toFixed(2)), backgroundColor: CLAY, borderRadius: 4 }
            ]
          },
          options: {
            responsive: false,
            animation: false,
            layout: { padding: { top: 16, right: 20, bottom: 8, left: 12 } },
            plugins: { legend },
            scales
          }
        };
      } else if (kind === 'donut') {
        const dist = [
          ['sana', 'Rotación sana'],
          ['lenta', 'Rotación lenta'],
          ['muyLenta', 'Rotación muy lenta'],
          ['dormido', 'Inventario dormido']
        ].map(([k, l]) => ({ l, v: R.rows.filter(r => r.estado === k).length }));
        cfg = {
          type: 'doughnut',
          plugins: [bgPlugin],
          data: {
            labels: dist.map(d => `${d.l} (${d.v})`),
            datasets: [
              {
                data: dist.map(d => d.v),
                backgroundColor: ['#38724f', '#c89622', '#c86428', '#9c3630'],
                borderColor: BG,
                borderWidth: 4
              }
            ]
          },
          options: {
            responsive: false,
            animation: false,
            layout: { padding: 16 },
            plugins: { legend },
            cutout: '60%'
          }
        };
      } else {
        const data = Engine.abc($('#abcBase')?.value || 'valor');
        const col = { A: '#9c3630', B: '#c89622', C: '#38724f' };
        cfg = {
          type: 'bar',
          plugins: [bgPlugin],
          data: {
            labels: data.map(d => (d.r.nombre.length > 16 ? d.r.nombre.slice(0, 15) + '…' : d.r.nombre)),
            datasets: [
              {
                type: 'bar',
                label: 'Valor / Base ($)',
                data: data.map(d => +d.v.toFixed(2)),
                backgroundColor: data.map(d => col[d.abc]),
                borderRadius: 4,
                order: 2
              },
              {
                type: 'line',
                label: '% Acumulado de Pareto',
                data: data.map(d => +d.pa.toFixed(1)),
                borderColor: PET,
                backgroundColor: PET,
                pointBackgroundColor: PET,
                pointRadius: 4,
                borderWidth: 2.5,
                yAxisID: 'y1',
                tension: 0.25,
                order: 1
              }
            ]
          },
          options: {
            responsive: false,
            animation: false,
            layout: { padding: { top: 16, right: 16, bottom: 8, left: 12 } },
            plugins: { legend },
            scales: {
              x: { ticks: { color: muted, font: { size: 10, weight: '600' } }, grid: { color: grid } },
              y: {
                ticks: { color: muted, font: { size: 11 }, callback: v => '$' + Number(v).toLocaleString('en-US') },
                grid: { color: grid }
              },
              y1: {
                position: 'right',
                min: 0,
                max: 100,
                ticks: { color: PET, font: { size: 11, weight: '700' }, callback: v => v + '%' },
                grid: { drawOnChartArea: false }
              }
            }
          }
        };
      }
      const ch = new globalThis.Chart(cv, cfg);
      const url = ch.toBase64Image();
      ch.destroy();
      return url;
    } catch (err) {
      console.warn(`[Reports] No se pudo renderizar gráfico "${kind}" off-screen:`, err.message);
      return null;
    }
  }

  /* ==========================================================================
     3. INFORME EJECUTIVO EN PDF (DISEÑO REPRESENTATIVO DE ROTASTOCK PLUS)
     ========================================================================== */
  function buildPdf(C, base, imgs) {
    const NS = (typeof window !== 'undefined' && window.jspdf) || globalThis.jspdf;
    const { jsPDF } = NS;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });

    // Paleta de identidad visual RotaStock Plus
    const PET = [31, 86, 104],      // Azul petróleo corporativo
      PET_DARK = [21, 61, 74],      // Petróleo profundo
      PET_SOFT = [232, 241, 244],   // Fondo suave petróleo
      CLAY = [168, 90, 50],         // Arcilla / terracota
      PAP = [247, 244, 237],        // Papel cálido
      WHITE = [255, 255, 255],
      INK = [29, 33, 30],           // Tinta principal
      MUT = [93, 98, 91],           // Gris cálido secundario
      BORDER = [216, 210, 197],     // Borde cálido
      SANA = [56, 114, 79],
      SANA_BG = [224, 238, 229],
      LENTA = [150, 110, 16],
      LENTA_BG = [246, 236, 205],
      MUYL = [175, 86, 28],
      MUYL_BG = [247, 224, 206],
      DORM = [156, 54, 48],
      DORM_BG = [245, 216, 213];

    const W = 210, M = 13, CW = W - 2 * M;
    const emp = Store.db.config.preferenciasUI.nombreEmpresa || 'Mi negocio';
    const periodo = `${fmtD(C.start)} al ${fmtD(C.end)} (${C.delta} días)`;
    const esHistorico = Boolean(Store.isReadOnly && Store.isReadOnly());
    const estadoVersion = esHistorico ? `Copia: ${Store.activeSnapshotName}` : 'Base en vivo (Actual)';
    const estadoLbl = e => (e === 'sinDatos' ? 'Sin datos' : EST_LBL[e]);

    const STATE_STYLE = {
      sana: { fg: SANA, bg: SANA_BG },
      lenta: { fg: LENTA, bg: LENTA_BG },
      muyLenta: { fg: MUYL, bg: MUYL_BG },
      dormido: { fg: DORM, bg: DORM_BG },
      sinDatos: { fg: MUT, bg: PAP }
    };

    const drawPill = (text, cx, cy, fg, bg, minW = 22) => {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.5);
      const tw = Math.max(minW, doc.getTextWidth(text) + 5);
      const th = 4.6;
      doc.setFillColor(...bg);
      doc.setDrawColor(...fg);
      doc.setLineWidth(0.2);
      doc.roundedRect(cx - tw / 2, cy - th / 2, tw, th, 1.2, 1.2, 'FD');
      doc.setTextColor(...fg);
      doc.text(text, cx, cy + 0.8, { align: 'center' });
    };

    /* ---- CABECERA CORPORATIVA REPRESENTATIVA ---- */
    doc.setFillColor(...PET);
    doc.rect(0, 0, W, 37, 'F');
    doc.setFillColor(...CLAY);
    doc.rect(0, 37, W, 2, 'F');

    // Escudo e isotipo de 3 cubos RotaStock Plus
    doc.setFillColor(...WHITE);
    doc.roundedRect(M, 7.5, 13, 13, 2.2, 2.2, 'F');
    doc.setFillColor(...PET);
    doc.roundedRect(M + 1.8, 13.8, 4.1, 4.1, 0.6, 0.6, 'F');
    doc.roundedRect(M + 7.1, 13.8, 4.1, 4.1, 0.6, 0.6, 'F');
    doc.setFillColor(...CLAY);
    doc.roundedRect(M + 4.45, 8.8, 4.1, 4.1, 0.6, 0.6, 'F');

    // Marca y título
    doc.setTextColor(...WHITE);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16.5);
    doc.text('RotaStock Plus', M + 16, 13);
    doc.setFontSize(8.2);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(210, 228, 234);
    doc.text('INFORME EJECUTIVO DE INVENTARIO, ROTACIÓN FIFO Y PLAN DE COMPRAS', M + 16, 18.2);

    // Franja de datos de la empresa en la portada
    doc.setFillColor(...PET_DARK);
    doc.roundedRect(M, 23, CW, 11, 1.8, 1.8, 'F');
    doc.setTextColor(...WHITE);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text(`EMPRESA: ${emp.toUpperCase()}`, M + 3.5, 27.6);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.4);
    doc.setTextColor(215, 230, 235);
    doc.text(`Período evaluado: ${periodo}   |   Costeo: FIFO Estricto (PEPS)   |   Emitido: ${fmtF(new Date().toISOString())}`, M + 3.5, 32);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...(esHistorico ? [245, 210, 125] : [165, 230, 188]));
    doc.text(estadoVersion, W - M - 3.5, 27.6, { align: 'right' });

    let y = 45;

    const salto = (need = 28) => {
      if (y + need > 276) {
        doc.addPage();
        // Mini-encabezado en páginas interiores
        doc.setFillColor(...PET);
        doc.rect(0, 0, W, 10, 'F');
        doc.setFillColor(...CLAY);
        doc.rect(0, 10, W, 0.8, 'F');
        doc.setTextColor(...WHITE);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.text(`RotaStock Plus — ${emp}`, M, 6.6);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.text(`Período: ${periodo}`, W - M, 6.6, { align: 'right' });
        y = 17;
      }
    };

    const sectionHeader = (num, title, subtitle, minSpace = 52) => {
      salto(minSpace);
      doc.setFillColor(...PET_SOFT);
      doc.setDrawColor(...PET);
      doc.setLineWidth(0.3);
      doc.roundedRect(M, y, CW, 9.5, 1.4, 1.4, 'F');
      doc.setFillColor(...PET);
      doc.roundedRect(M, y, 8.5, 9.5, 1.4, 1.4, 'F');
      doc.setTextColor(...WHITE);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.text(num, M + 4.25, y + 6.1, { align: 'center' });

      doc.setTextColor(...PET_DARK);
      doc.setFontSize(10.5);
      doc.text(title, M + 11.5, y + 4.6);
      if (subtitle) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.3);
        doc.setTextColor(...MUT);
        doc.text(subtitle, M + 11.5, y + 8.1);
      }
      y += 12.5;
    };

    const tableBase = {
      styles: {
        fontSize: 7.4,
        textColor: INK,
        cellPadding: { top: 2.2, right: 2.2, bottom: 2.2, left: 2.2 },
        lineColor: BORDER,
        lineWidth: 0.15,
        valign: 'middle'
      },
      headStyles: {
        fillColor: PET,
        textColor: 255,
        fontSize: 7.3,
        fontStyle: 'bold',
        halign: 'left'
      },
      footStyles: {
        fillColor: [232, 236, 238],
        textColor: INK,
        fontSize: 7.2,
        fontStyle: 'bold'
      },
      showFoot: 'lastPage',
      alternateRowStyles: { fillColor: PAP },
      margin: { left: M, right: M }
    };

    /* ---- SECCIÓN 1: TABLERO EJECUTIVO DE INDICADORES ---- */
    sectionHeader('01', 'Resumen Ejecutivo y KPIs Financieros', 'Indicadores consolidados de valor de inventario, rentabilidad FIFO y salud operativa');

    const reabAll = Engine.reabastecimiento();
    const alReab = reabAll.filter(d => d.alerta);
    const listAud = Store.db.conteosCiclicos || [];
    const iraPct = listAud.length ? (listAud.filter(c => c.discrepancia === 0).length / listAud.length) * 100 : 100;
    const margenPct = C.totIng > 0 ? (C.totGan / C.totIng) * 100 : 0;
    const cogsPct = C.totIng > 0 ? (C.totCogs / C.totIng) * 100 : 0;
    const totalUnidadesStock = C.rows.reduce((s, r) => s + r.stockActual, 0);
    const totalLotesVivos = Object.values(C.capas).reduce((s, arr) => s + arr.length, 0);

    // 6 Tarjetas KPI en cuadrícula de 3 columnas × 2 filas
    const kpis = [
      {
        lbl: 'CAPITAL EN INVENTARIO ACTUAL',
        val: '$' + fmtN(C.totVal, 2),
        sub: `${fmt0(totalUnidadesStock)} uds. en ${totalLotesVivos} lote(s) FIFO`,
        accent: PET
      },
      {
        lbl: 'INGRESOS DEL PERÍODO',
        val: '$' + fmtN(C.totIng, 2),
        sub: `${fmt0(C.rows.reduce((s, r) => s + r.salidasPer, 0))} uds. vendidas en ${C.delta} días`,
        accent: SANA
      },
      {
        lbl: 'COSTO DE LO VENDIDO (COGS)',
        val: '$' + fmtN(C.totCogs, 2),
        sub: C.totIng > 0 ? `${fmtN(cogsPct, 1)}% sobre ingresos totales` : 'Sin salidas en el período',
        accent: CLAY
      },
      {
        lbl: 'GANANCIA Y MARGEN BRUTO',
        val: '$' + fmtN(C.totGan, 2),
        sub: C.totIng > 0 ? `Margen bruto real: ${fmtN(margenPct, 1)}%` : 'Sin margen registrado',
        accent: SANA
      },
      {
        lbl: 'DÍAS DE INVENTARIO (DIO)',
        val: C.dio !== null ? fmtN(C.dio, 1) + ' días' : 'Sin ventas',
        sub: `Cobertura global al ritmo actual`,
        accent: PET
      },
      {
        lbl: 'ALERTAS Y REABASTECIMIENTO',
        val: `${C.dorm} dorm. / ${alReab.length} pedir`,
        sub: `Exactitud física IRA: ${fmtN(iraPct, 1)}%`,
        accent: C.dorm > 0 || alReab.length > 0 ? DORM : SANA
      }
    ];

    const colsKpi = 3, gapX = 3.5, gapY = 3.5;
    const cardW = (CW - (colsKpi - 1) * gapX) / colsKpi;
    const cardH = 19.5;

    kpis.forEach((k, i) => {
      const col = i % colsKpi;
      const row = Math.floor(i / colsKpi);
      const kx = M + col * (cardW + gapX);
      const ky = y + row * (cardH + gapY);

      doc.setFillColor(...PAP);
      doc.setDrawColor(...BORDER);
      doc.setLineWidth(0.25);
      doc.roundedRect(kx, ky, cardW, cardH, 1.8, 1.8, 'FD');

      // Barra de acento superior
      doc.setFillColor(...k.accent);
      doc.roundedRect(kx, ky, cardW, 2, 1, 1, 'F');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.5);
      doc.setTextColor(...MUT);
      doc.text(k.lbl, kx + 3, ky + 6.2);

      doc.setFontSize(12);
      doc.setTextColor(...INK);
      doc.text(String(k.val), kx + 3, ky + 12.8);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.8);
      doc.setTextColor(...MUT);
      doc.text(k.sub, kx + 3, ky + 17.2);
    });

    y += 2 * cardH + gapY + 4;

    // Caja de diagnóstico narrativo ejecutivo
    const capDormido = C.rows.filter(r => r.estado === 'dormido').reduce((s, r) => s + r.valorInventario, 0);
    const diagText =
      `Diagnóstico del período (${fmtD(C.start)} al ${fmtD(C.end)}): El almacén registra ventas por $${fmtN(C.totIng, 2)} ` +
      `con un costo FIFO liquidado por capas de $${fmtN(C.totCogs, 2)}, generando una utilidad bruta de $${fmtN(C.totGan, 2)} (${fmtN(margenPct, 1)}% de margen). ` +
      `El capital actual en stock asciende a $${fmtN(C.totVal, 2)} (${C.dio !== null ? fmtN(C.dio, 1) + ' días de inventario' : 'sin rotación en el período'}). ` +
      `Se identifican ${C.dorm} producto(s) en estado dormido ($${fmtN(capDormido, 2)} detenidos) y ${alReab.length} producto(s) que requieren orden de compra.`;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const diagLines = doc.splitTextToSize(diagText, CW - 8);
    const diagBoxH = diagLines.length * 4.2 + 5;
    doc.setFillColor(...PET_SOFT);
    doc.setDrawColor(...PET);
    doc.roundedRect(M, y, CW, diagBoxH, 1.5, 1.5, 'FD');
    doc.setFillColor(...PET);
    doc.rect(M, y, 1.8, diagBoxH, 'F');
    doc.setTextColor(...INK);
    diagLines.forEach((line, idx) => {
      doc.text(line, M + 4.5, y + 4.8 + idx * 4.2);
    });
    y += diagBoxH + 6;

    /* ---- SECCIÓN 2: GRÁFICOS DE DESEMPEÑO Y SALUD ---- */
    if (imgs.bar || imgs.donut) {
      sectionHeader('02', 'Análisis Gráfico de Ingresos y Salud de Rotación', 'Comparativa de facturación vs. costo vendido (Top 8) y distribución del catálogo por actividad');
      const gw = (CW - 4) / 2, gh = gw * 0.52;
      salto(gh + 12);

      [
        { img: imgs.bar, x: M, t: 'Ingresos vs. Costo de Venta (COGS FIFO)' },
        { img: imgs.donut, x: M + gw + 4, t: 'Distribución por Estado de Rotación' }
      ].forEach(card => {
        if (!card.img) return;
        doc.setFillColor(...PAP);
        doc.setDrawColor(...BORDER);
        doc.roundedRect(card.x, y, gw, gh + 8, 1.8, 1.8, 'FD');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.6);
        doc.setTextColor(...PET_DARK);
        doc.text(card.t, card.x + 3, y + 5);
        doc.addImage(card.img, 'PNG', card.x + 1.5, y + 6.5, gw - 3, gh);
      });
      y += gh + 13;
    }

    /* ---- SECCIÓN 3: DESEMPEÑO POR PRODUCTO Y CAPAS FIFO VIVAS ---- */
    sectionHeader('03', 'Desempeño Financiero por Producto y Capas FIFO', 'Métricas de stock, entradas/salidas, márgenes, rotación y lotes vivos valorados por PEPS');

    const totEnt = C.rows.reduce((s, r) => s + r.entradasPer, 0);
    const totSal = C.rows.reduce((s, r) => s + r.salidasPer, 0);

    doc.autoTable({
      ...tableBase,
      startY: y,
      head: [[
        'Producto',
        { content: 'Stock', styles: { halign: 'right' } },
        { content: 'Ent/Sal', styles: { halign: 'right' } },
        { content: 'Valor Stock', styles: { halign: 'right' } },
        { content: 'Ingresos', styles: { halign: 'right' } },
        { content: 'COGS FIFO', styles: { halign: 'right' } },
        { content: 'Ganancia', styles: { halign: 'right' } },
        { content: 'Margen', styles: { halign: 'right' } },
        { content: 'Rotac.', styles: { halign: 'right' } },
        { content: 'Cobert.', styles: { halign: 'right' } },
        { content: 'Inact.', styles: { halign: 'right' } },
        { content: 'Estado', styles: { halign: 'center' } }
      ]],
      body: C.rows.map(r => {
        const mrg = r.ingresos > 0 ? ((r.ganancia / r.ingresos) * 100).toFixed(1) + '%' : '—';
        return [
          r.nombre.slice(0, 24),
          fmt0(r.stockActual),
          `+${fmt0(r.entradasPer)} / -${fmt0(r.salidasPer)}`,
          '$' + fmtN(r.valorInventario, 0),
          '$' + fmtN(r.ingresos, 0),
          '$' + fmtN(r.cogs, 0),
          '$' + fmtN(r.ganancia, 0),
          mrg,
          r.rotacion.toFixed(2) + 'x',
          r.cobertura !== null ? r.cobertura.toFixed(1) + ' d' : '—',
          r.diasSinMov !== null ? r.diasSinMov + ' d' : '—',
          estadoLbl(r.estado)
        ];
      }),
      foot: [[
        `TOTAL (${C.rows.length} prod.)`,
        fmt0(totalUnidadesStock),
        `+${fmt0(totEnt)}/-${fmt0(totSal)}`,
        '$' + fmtN(C.totVal, 0),
        '$' + fmtN(C.totIng, 0),
        '$' + fmtN(C.totCogs, 0),
        '$' + fmtN(C.totGan, 0),
        C.totIng > 0 ? fmtN(margenPct, 1) + '%' : '—',
        '',
        C.dio !== null ? fmtN(C.dio, 1) + ' d' : '—',
        '',
        `${C.dorm} en alerta`
      ]],
      styles: {
        ...tableBase.styles,
        fontSize: 6.9,
        cellPadding: { top: 2, right: 1.4, bottom: 2, left: 1.4 }
      },
      headStyles: {
        ...tableBase.headStyles,
        fontSize: 6.8,
        cellPadding: { top: 2.2, right: 1.4, bottom: 2.2, left: 1.4 }
      },
      footStyles: {
        ...tableBase.footStyles,
        fontSize: 6.8,
        cellPadding: { top: 2.2, right: 1.4, bottom: 2.2, left: 1.4 }
      },
      columnStyles: {
        0: { cellWidth: 28, fontStyle: 'bold' },
        1: { cellWidth: 11, halign: 'right' },
        2: { cellWidth: 15, halign: 'right' },
        3: { cellWidth: 15, halign: 'right' },
        4: { cellWidth: 15, halign: 'right' },
        5: { cellWidth: 15, halign: 'right' },
        6: { cellWidth: 15, halign: 'right', fontStyle: 'bold' },
        7: { cellWidth: 12, halign: 'right' },
        8: { cellWidth: 11, halign: 'right' },
        9: { cellWidth: 12, halign: 'right' },
        10: { cellWidth: 10, halign: 'right' },
        11: { cellWidth: 25, halign: 'center' }
      },
      didDrawCell: data => {
        if (data.section === 'body' && data.column.index === 11) {
          const r = C.rows[data.row.index];
          if (!r) return;
          const st = STATE_STYLE[r.estado] || STATE_STYLE.sinDatos;
          // Cubrir texto plano con fondo de la fila y dibujar píldora vectorial
          const bgRow = data.row.index % 2 === 1 ? PAP : WHITE;
          doc.setFillColor(...bgRow);
          doc.rect(data.cell.x + 0.3, data.cell.y + 0.3, data.cell.width - 0.6, data.cell.height - 0.6, 'F');
          drawPill(
            estadoLbl(r.estado),
            data.cell.x + data.cell.width / 2,
            data.cell.y + data.cell.height / 2,
            st.fg,
            st.bg,
            22
          );
        }
      }
    });
    y = doc.lastAutoTable.finalY + 7;

    // Subtabla de Capas FIFO vivas (Lotes activos en almacén)
    const fifoRows = [];
    for (const p of C.rows) {
      const live = C.capas[p.id] || [];
      live.forEach(l => {
        const valCapa = l.qty * l.costo;
        fifoRows.push([
          p.nombre.slice(0, 30),
          `Lote #${l.n}`,
          l.fecha ? fmtD(l.fecha) : '—',
          fmt0(l.qty) + ' uds.',
          '$' + fmtN(l.costo, 2),
          '$' + fmtN(valCapa, 2),
          C.totVal > 0 ? fmtN((valCapa / C.totVal) * 100, 1) + '%' : '0.0%'
        ]);
      });
    }

    if (fifoRows.length) {
      salto(24);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.8);
      doc.setTextColor(...PET_DARK);
      doc.text('3.1 Desglose de Capas FIFO Vivas por Lote en Almacén (Orden de antigüedad PEPS)', M, y);
      y += 3;

      doc.autoTable({
        ...tableBase,
        startY: y,
        head: [[
          'Producto',
          'N° de Lote',
          'Fecha de Entrada',
          { content: 'Unidades Restantes', styles: { halign: 'right' } },
          { content: 'Costo Unitario Lote', styles: { halign: 'right' } },
          { content: 'Valor Total de Capa', styles: { halign: 'right' } },
          { content: '% del Capital Total', styles: { halign: 'right' } }
        ]],
        body: fifoRows,
        foot: [[
          'TOTAL EN CAPAS FIFO VIVAS',
          `${fifoRows.length} lote(s) activos`,
          '',
          fmt0(totalUnidadesStock) + ' uds.',
          '',
          '$' + fmtN(C.totVal, 2),
          '100.0%'
        ]],
        columnStyles: {
          0: { fontStyle: 'bold' },
          3: { halign: 'right' },
          4: { halign: 'right' },
          5: { halign: 'right', fontStyle: 'bold' },
          6: { halign: 'right' }
        }
      });
      y = doc.lastAutoTable.finalY + 8;
    }

    /* ---- SECCIÓN 4: CLASIFICACIÓN ABC / XYZ Y CURVA DE PARETO ---- */
    sectionHeader('04', 'Clasificación ABC (Pareto) y Estabilidad de Demanda XYZ', 'Jerarquización por concentración de valor/demanda y regularidad estadística mensual');

    const abc = Engine.abc(base);
    const totB = abc.reduce((s, d) => s + d.v, 0) || 1;
    const baseColTitle = base === 'valor' ? 'Valor en Stock' : 'COGS Acumulado';

    // 3 Tarjetas de resumen para Categorías A, B y C
    salto(22);
    const abcCardW = (CW - 2 * 3.5) / 3;
    const abcColors = {
      A: { fg: DORM, bg: DORM_BG, title: 'CATEGORÍA A · PRIORIDAD ALTA', freq: 'Revisión cada 30 días' },
      B: { fg: LENTA, bg: LENTA_BG, title: 'CATEGORÍA B · PRIORIDAD MEDIA', freq: 'Revisión cada 60 días' },
      C: { fg: SANA, bg: SANA_BG, title: 'CATEGORÍA C · PRIORIDAD BAJA', freq: 'Revisión cada 120 días' }
    };
    ['A', 'B', 'C'].forEach((g, idx) => {
      const items = abc.filter(d => d.abc === g);
      const monto = items.reduce((s, d) => s + d.v, 0);
      const pct = (monto / totB) * 100;
      const st = abcColors[g];
      const cx = M + idx * (abcCardW + 3.5);

      doc.setFillColor(...st.bg);
      doc.setDrawColor(...st.fg);
      doc.setLineWidth(0.25);
      doc.roundedRect(cx, y, abcCardW, 17, 1.6, 1.6, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.8);
      doc.setTextColor(...st.fg);
      doc.text(st.title, cx + 3, y + 4.8);

      doc.setFontSize(10.2);
      doc.setTextColor(...INK);
      doc.text(`${items.length} prod. (${fmtN(pct, 1)}% del valor)`, cx + 3, y + 10.5);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.8);
      doc.setTextColor(...MUT);
      doc.text(`Monto: $${fmtN(monto, 0)}  ·  ${st.freq}`, cx + 3, y + 14.8);
    });
    y += 20.5;

    doc.autoTable({
      ...tableBase,
      startY: y,
      head: [[
        '#',
        'Producto',
        { content: 'Stock', styles: { halign: 'right' } },
        { content: baseColTitle, styles: { halign: 'right' } },
        { content: '% Total', styles: { halign: 'right' } },
        { content: '% Acum.', styles: { halign: 'right' } },
        { content: 'Grupo ABC', styles: { halign: 'center' } },
        { content: 'CV Mensual', styles: { halign: 'right' } },
        { content: 'Estabilidad XYZ', styles: { halign: 'center' } },
        'Política de Conteo'
      ]],
      body: abc.map((d, i) => [
        i + 1,
        d.r.nombre.slice(0, 28),
        fmt0(d.r.stockActual),
        '$' + fmtN(d.v, 2),
        d.pi.toFixed(1) + '%',
        d.pa.toFixed(1) + '%',
        'Grupo ' + d.abc,
        d.cv.toFixed(2),
        `${XYZ_LBL[d.xyz]} (${d.xyz})`,
        d.abc === 'A' ? 'Cada 30 días' : d.abc === 'B' ? 'Cada 60 días' : 'Cada 120 días'
      ]),
      columnStyles: {
        0: { cellWidth: 8, halign: 'center' },
        1: { fontStyle: 'bold' },
        2: { halign: 'right' },
        3: { halign: 'right', fontStyle: 'bold' },
        4: { halign: 'right' },
        5: { halign: 'right' },
        6: { halign: 'center', cellWidth: 22 },
        7: { halign: 'right' },
        8: { halign: 'center', cellWidth: 25 }
      },
      didDrawCell: data => {
        if (data.section === 'body' && data.column.index === 6) {
          const item = abc[data.row.index];
          if (!item) return;
          const map = { A: { fg: DORM, bg: DORM_BG }, B: { fg: LENTA, bg: LENTA_BG }, C: { fg: SANA, bg: SANA_BG } };
          const st = map[item.abc] || map.C;
          const bgRow = data.row.index % 2 === 1 ? PAP : WHITE;
          doc.setFillColor(...bgRow);
          doc.rect(data.cell.x + 0.3, data.cell.y + 0.3, data.cell.width - 0.6, data.cell.height - 0.6, 'F');
          drawPill('Grupo ' + item.abc, data.cell.x + data.cell.width / 2, data.cell.y + data.cell.height / 2, st.fg, st.bg, 18);
        }
        if (data.section === 'body' && data.column.index === 8) {
          const item = abc[data.row.index];
          if (!item) return;
          const map = { X: { fg: SANA, bg: SANA_BG }, Y: { fg: LENTA, bg: LENTA_BG }, Z: { fg: DORM, bg: DORM_BG } };
          const st = map[item.xyz] || map.X;
          const bgRow = data.row.index % 2 === 1 ? PAP : WHITE;
          doc.setFillColor(...bgRow);
          doc.rect(data.cell.x + 0.3, data.cell.y + 0.3, data.cell.width - 0.6, data.cell.height - 0.6, 'F');
          drawPill(`${XYZ_LBL[item.xyz]} (${item.xyz})`, data.cell.x + data.cell.width / 2, data.cell.y + data.cell.height / 2, st.fg, st.bg, 21);
        }
      }
    });
    y = doc.lastAutoTable.finalY + 6;

    if (imgs.pareto) {
      salto(72);
      doc.setFillColor(...PAP);
      doc.setDrawColor(...BORDER);
      doc.roundedRect(M, y, CW, 68, 1.8, 1.8, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.8);
      doc.setTextColor(...PET_DARK);
      doc.text('Curva de Importancia de Pareto (Valor individual y porcentaje acumulado)', M + 3.5, y + 5);
      doc.addImage(imgs.pareto, 'PNG', M + 2, y + 6.5, CW - 4, 60);
      y += 73;
    }

    /* ---- SECCIÓN 5: PLAN DE COMPRAS Y REABASTECIMIENTO ---- */
    sectionHeader('05', 'Planificación de Compras y Punto de Reorden', 'Pronóstico mensual (alfa = 0.30), stock de seguridad estadístico y presupuesto estimado de compra');

    const reabSorted = [...reabAll].sort(
      (a, b) => b.alerta - a.alerta || a.stockActual - a.PRO - (b.stockActual - b.PRO)
    );
    const totSugUds = reabSorted.reduce((s, d) => s + d.sug, 0);
    const totInversionCompra = reabSorted.reduce((s, d) => {
      const cRef = d.stockActual > 0 ? d.valorInventario / d.stockActual : d.costoUnitario || 0;
      return s + d.sug * cRef;
    }, 0);

    doc.autoTable({
      ...tableBase,
      startY: y,
      head: [[
        'Producto',
        { content: 'Entrega Prov.', styles: { halign: 'right' } },
        { content: 'En Stock', styles: { halign: 'right' } },
        { content: 'Venta/Día', styles: { halign: 'right' } },
        { content: 'Pronóst./Mes', styles: { halign: 'right' } },
        { content: 'Reserva (SS)', styles: { halign: 'right' } },
        { content: 'Pedir en (PRO)', styles: { halign: 'right' } },
        { content: 'Cant. a Pedir', styles: { halign: 'right' } },
        { content: 'Inversión Est.', styles: { halign: 'right' } },
        { content: 'Acción', styles: { halign: 'center' } }
      ]],
      body: reabSorted.map(d => {
        const cRef = d.stockActual > 0 ? d.valorInventario / d.stockActual : d.costoUnitario || 0;
        const inv = d.sug * cRef;
        return [
          d.nombre.slice(0, 27),
          (d.leadTime || 7) + ' días',
          fmt0(d.stockActual),
          d.dBar.toFixed(1),
          d.pron.toFixed(0) + ' uds.',
          d.SS.toFixed(0),
          d.PRO.toFixed(0),
          fmt0(d.sug),
          inv > 0 ? '$' + fmtN(inv, 2) : '—',
          d.alerta ? 'COMPRAR' : 'Abastecido'
        ];
      }),
      foot: [[
        `TOTAL PLAN DE COMPRAS (${alReab.length} en alerta)`,
        '',
        fmt0(totalUnidadesStock),
        '',
        '',
        '',
        '',
        fmt0(totSugUds) + ' uds.',
        '$' + fmtN(totInversionCompra, 2),
        alReab.length ? 'Prioritario' : 'Todo óptimo'
      ]],
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 36 },
        1: { halign: 'right' },
        2: { halign: 'right' },
        3: { halign: 'right' },
        4: { halign: 'right' },
        5: { halign: 'right' },
        6: { halign: 'right' },
        7: { halign: 'right', fontStyle: 'bold' },
        8: { halign: 'right', fontStyle: 'bold' },
        9: { halign: 'center', cellWidth: 23 }
      },
      didDrawCell: data => {
        if (data.section === 'body' && data.column.index === 9) {
          const item = reabSorted[data.row.index];
          if (!item) return;
          const st = item.alerta ? { fg: DORM, bg: DORM_BG } : { fg: SANA, bg: SANA_BG };
          const bgRow = data.row.index % 2 === 1 ? PAP : WHITE;
          doc.setFillColor(...bgRow);
          doc.rect(data.cell.x + 0.3, data.cell.y + 0.3, data.cell.width - 0.6, data.cell.height - 0.6, 'F');
          drawPill(item.alerta ? 'COMPRAR' : 'Abastecido', data.cell.x + data.cell.width / 2, data.cell.y + data.cell.height / 2, st.fg, st.bg, 20);
        }
      }
    });
    y = doc.lastAutoTable.finalY + 8;

    /* ---- SECCIÓN 6: CONTEOS DE ALMACÉN Y AUDITORÍA FÍSICA ---- */
    sectionHeader('06', 'Auditoría Física de Almacén (Conteos Cíclicos e IRA)', 'Verificación de exactitud entre el stock del sistema y el conteo físico en estantería');

    const faltantesTot = listAud.filter(c => c.discrepancia < 0).reduce((s, c) => s + c.discrepancia, 0);
    const sobrantesTot = listAud.filter(c => c.discrepancia > 0).reduce((s, c) => s + c.discrepancia, 0);

    salto(20);
    const audCardW = (CW - 2 * 3.5) / 3;
    [
      { lbl: 'EXACTITUD DE CONTEOS (IRA)', val: fmtN(iraPct, 1) + '%', sub: `${listAud.length} auditoría(s) registradas`, fg: iraPct >= 95 ? SANA : LENTA },
      { lbl: 'FALTANTES DETECTADOS', val: fmt0(faltantesTot) + ' uds.', sub: 'Ajustados como merma/salida FIFO', fg: faltantesTot < 0 ? DORM : SANA },
      { lbl: 'SOBRANTES DETECTADOS', val: '+' + fmt0(sobrantesTot) + ' uds.', sub: 'Ajustados como entrada al costo vigente', fg: PET }
    ].forEach((ac, idx) => {
      const cx = M + idx * (audCardW + 3.5);
      doc.setFillColor(...PAP);
      doc.setDrawColor(...BORDER);
      doc.roundedRect(cx, y, audCardW, 15, 1.5, 1.5, 'FD');
      doc.setFillColor(...ac.fg);
      doc.roundedRect(cx, y, audCardW, 1.6, 0.8, 0.8, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.5);
      doc.setTextColor(...MUT);
      doc.text(ac.lbl, cx + 3, y + 5.2);
      doc.setFontSize(10.8);
      doc.setTextColor(...INK);
      doc.text(ac.val, cx + 3, y + 10.4);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.6);
      doc.setTextColor(...MUT);
      doc.text(ac.sub, cx + 3, y + 13.8);
    });
    y += 18;

    if (listAud.length) {
      const names = Object.fromEntries(Store.db.productos.map(p => [p.id, p.nombre]));
      const audRows = [...listAud].reverse().slice(0, 40);
      doc.autoTable({
        ...tableBase,
        startY: y,
        head: [[
          'Fecha y Hora',
          'Producto Auditado',
          { content: 'Stock Sistema', styles: { halign: 'right' } },
          { content: 'Conteo Físico', styles: { halign: 'right' } },
          { content: 'Diferencia', styles: { halign: 'right' } },
          'Motivo / Observación',
          { content: 'Estado Ajuste', styles: { halign: 'center' } }
        ]],
        body: audRows.map(c => [
          fmtF(c.timestamp),
          (names[c.productoId] || '(eliminado)').slice(0, 28),
          fmt0(c.stockSistema),
          fmt0(c.stockFisico),
          (c.discrepancia > 0 ? '+' : '') + fmt0(c.discrepancia),
          (c.motivo || '—').slice(0, 34),
          c.movimientoAjusteId ? 'Ajustado en Kárdex' : 'Conteo Exacto'
        ]),
        columnStyles: {
          1: { fontStyle: 'bold' },
          2: { halign: 'right' },
          3: { halign: 'right' },
          4: { halign: 'right', fontStyle: 'bold' },
          6: { halign: 'center' }
        },
        didParseCell: data => {
          if (data.section === 'body' && data.column.index === 4) {
            const c = audRows[data.row.index];
            if (c) {
              data.cell.styles.textColor = c.discrepancia === 0 ? SANA : DORM;
            }
          }
        }
      });
    } else {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8.2);
      doc.setTextColor(...MUT);
      doc.text('Aún no se han registrado conteos físicos en la bitácora de auditoría.', M, y + 4);
    }

    /* ---- PIE DE PÁGINA CORPORATIVO EN TODAS LAS HOJAS ---- */
    const totalPages = doc.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setDrawColor(...PET);
      doc.setLineWidth(0.35);
      doc.line(M, 285.5, W - M, 285.5);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.4);
      doc.setTextColor(...PET);
      doc.text(`RotaStock Plus v2.0.2  ·  ${emp}`, M, 290);

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...MUT);
      doc.text(`Método FIFO Estricto (PEPS)  ·  ${estadoVersion}`, W / 2, 290, { align: 'center' });

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...INK);
      doc.text(`Página ${i} de ${totalPages}`, W - M, 290, { align: 'right' });
    }
    return doc;
  }

  const Reports = {
    buildWorkbook,
    buildPdf,
    chartPNG,
    repDays
  };

  globalThis.Reports = Reports;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Reports;
  }
})();
