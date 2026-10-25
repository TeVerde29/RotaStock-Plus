'use strict';

/**
 * Motor de Exportación: Libro Excel (4 hojas con fórmulas vivas) e Informe PDF Ejecutivo (6 secciones).
 * Implementa la Sección 9 de funcionalidades.md.
 */
(function () {
  const { EST_LBL, XYZ_LBL, $, fmtN, fmt0, fmtD } =
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
    money: '#,##0.00',
    int: '#,##0',
    qty1: '#,##0.0',
    pct1: '0.0%',
    fecha: 'yyyy-mm-dd'
  };

  const N = (v, z) => ({ t: 'n', v, z });

  function wsAoa(aoa, cols, merges, autofilter) {
    const XLSXLib = globalThis.XLSX;
    const ws = XLSXLib.utils.aoa_to_sheet(aoa);
    if (cols) ws['!cols'] = cols;
    if (merges) ws['!merges'] = merges;
    if (autofilter) ws['!autofilter'] = { ref: autofilter };
    return ws;
  }

  function buildWorkbook(C, base) {
    const XLSXLib = globalThis.XLSX;
    const wb = XLSXLib.utils.book_new();
    const emp = Store.db.config.preferenciasUI.nombreEmpresa || 'Mi negocio';
    const periodo = `${fmtD(C.start)} al ${fmtD(C.end)}`;
    const estadoLbl = e => (e === 'sinDatos' ? 'Sin datos' : EST_LBL[e]);

    /* ---- Hoja 1: Capas FIFO (una fila por lote vivo, con fórmulas vivas) ---- */
    const a1 = [
      ['RotaStock Plus — Capas FIFO por lote'],
      ['Negocio', emp, '', 'Emitido', fmtD(new Date())],
      ['Período', periodo, '', 'Método', 'FIFO (PEPS)'],
      [],
      ['Producto', 'Lote', 'Fecha entrada', 'Costo unit.', 'Entradas (período)', 'Salidas (período)', 'Stock', 'Valor capa', 'Días sin mov.', 'Estado']
    ];
    let er = a1.length + 1;
    const er0 = er;
    for (const p of C.rows) {
      const live =
        C.capas[p.id] && C.capas[p.id].length
          ? C.capas[p.id]
          : [{ n: '—', qty: p.stockActual, costo: p.stockActual > 0 ? p.valorInventario / p.stockActual : 0, fecha: null }];
      live.forEach((l, i) => {
        a1.push([
          p.nombre,
          typeof l.n === 'number' ? 'Lote ' + l.n : '—',
          l.fecha ? { t: 'd', v: new Date(l.fecha), z: XF.fecha } : '—',
          N(l.costo, XF.money),
          i === 0 ? N(p.entradasPer, XF.int) : '',
          i === 0 ? N(p.salidasPer, XF.int) : '',
          N(l.qty, XF.int),
          { t: 'n', f: `${colL(6)}${er}*${colL(3)}${er}`, z: XF.money },
          p.diasSinMov !== null ? N(p.diasSinMov, XF.int) : '—',
          estadoLbl(p.estado)
        ]);
        er++;
      });
    }
    const er1 = er - 1;
    a1.push([
      'TOTAL', '', '', '',
      { t: 'n', f: `SUM(${colL(4)}${er0}:${colL(4)}${er1})`, z: XF.int },
      { t: 'n', f: `SUM(${colL(5)}${er0}:${colL(5)}${er1})`, z: XF.int },
      { t: 'n', f: `SUM(${colL(6)}${er0}:${colL(6)}${er1})`, z: XF.int },
      { t: 'n', f: `SUM(${colL(7)}${er0}:${colL(7)}${er1})`, z: XF.money },
      '', ''
    ]);
    XLSXLib.utils.book_append_sheet(
      wb,
      wsAoa(
        a1,
        [{ wch: 30 }, { wch: 10 }, { wch: 14 }, { wch: 13 }, { wch: 17 }, { wch: 16 }, { wch: 10 }, { wch: 15 }, { wch: 13 }, { wch: 17 }],
        [{ s: { r: 0, c: 0 }, e: { r: 0, c: 9 } }],
        `A5:J${er1}`
      ),
      '1. Capas FIFO'
    );

    /* ---- Hoja 2: Clasificación ABC ---- */
    const abc = Engine.abc(base);
    const totB = abc.reduce((s, d) => s + d.v, 0) || 1;
    const gsum = g => abc.filter(d => d.abc === g);
    const a2 = [
      ['RotaStock Plus — Clasificación ABC' + (base === 'valor' ? ' (dinero en stock)' : ' (COGS)')],
      ['Negocio', emp, '', 'Emitido', fmtD(new Date())],
      ['Historial', 'Completo (todas las ventas)'],
      [],
      ['Categoría', 'Productos', '% del dinero'],
      ['A — lo más importante', gsum('A').length, N(gsum('A').reduce((s, d) => s + d.v, 0) / totB, XF.pct1)],
      ['B — intermedio', gsum('B').length, N(gsum('B').reduce((s, d) => s + d.v, 0) / totB, XF.pct1)],
      ['C — lo de menor peso', gsum('C').length, N(gsum('C').reduce((s, d) => s + d.v, 0) / totB, XF.pct1)],
      [],
      ['Producto', base === 'valor' ? 'Valor en stock' : 'COGS', '% del total', '% acumulado', 'Grupo', 'Estabilidad', 'Revisar cada']
    ];
    abc.forEach(d =>
      a2.push([
        d.r.nombre,
        N(d.v, XF.money),
        N(d.pi / 100, XF.pct1),
        N(d.pa / 100, XF.pct1),
        'Grupo ' + d.abc,
        XYZ_LBL[d.xyz],
        d.abc === 'A' ? 'Cada 30 días' : d.abc === 'B' ? 'Cada 60 días' : 'Cada 120 días'
      ])
    );
    XLSXLib.utils.book_append_sheet(
      wb,
      wsAoa(
        a2,
        [{ wch: 30 }, { wch: 16 }, { wch: 13 }, { wch: 13 }, { wch: 10 }, { wch: 12 }, { wch: 14 }],
        [{ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }],
        `A10:G${a2.length}`
      ),
      '2. Clasificación ABC'
    );

    /* ---- Hoja 3: Plan de compras ---- */
    const reab = Engine.reabastecimiento();
    const a3 = [
      ['RotaStock Plus — Plan de compras'],
      ['Negocio', emp, '', 'Emitido', fmtD(new Date())],
      ['Nota', 'Sugerencias con todo el historial de ventas'],
      [],
      ['Producto', 'En stock', 'Venta prom./día', 'Pronóstico mensual', 'Reserva', 'Pedir al llegar a', 'Cantidad a pedir', 'Estado']
    ];
    reab.forEach(d =>
      a3.push([
        d.nombre,
        N(d.stockActual, XF.int),
        N(d.dBar, XF.qty1),
        N(d.pron, XF.qty1),
        N(d.SS, XF.qty1),
        N(d.PRO, XF.qty1),
        N(d.sug, XF.int),
        d.alerta ? 'Comprar' : 'Bien'
      ])
    );
    XLSXLib.utils.book_append_sheet(
      wb,
      wsAoa(
        a3,
        [{ wch: 30 }, { wch: 10 }, { wch: 15 }, { wch: 18 }, { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 10 }],
        [{ s: { r: 0, c: 0 }, e: { r: 0, c: 7 } }],
        `A5:H${a3.length}`
      ),
      '3. Plan de compras'
    );

    /* ---- Hoja 4: Resumen ---- */
    const list = Store.db.conteosCiclicos || [];
    const ira = list.length ? list.filter(c => c.discrepancia === 0).length / list.length : 1;
    const top = [...C.rows].sort((a, b) => b.ingresos - a.ingresos).slice(0, 5);
    const a4 = [
      ['RotaStock Plus — Resumen del período'],
      ['Negocio', emp],
      ['Período', periodo],
      ['Emitido', fmtD(new Date())],
      ['Método', 'FIFO (PEPS)'],
      [],
      ['Indicador', 'Valor'],
      ['Días de inventario', C.dio !== null ? N(C.dio, '0.0" días"') : 'Sin ventas en el período'],
      ['Costo de lo vendido', N(C.totCogs, XF.money)],
      ['Ingresos totales', N(C.totIng, XF.money)],
      ['Ganancia bruta', N(C.totGan, XF.money)],
      ['Productos en alerta (dormidos)', N(C.dorm, XF.int)],
      [],
      ['Top 5 por ingresos', 'Ingresos']
    ];
    top.forEach(r => a4.push([r.nombre, N(r.ingresos, XF.money)]));
    a4.push(
      [],
      ['Conteos realizados', N(list.length, XF.int)],
      ['Exactitud de conteos', N(ira, XF.pct1)],
      ['Faltantes (uds.)', N(list.filter(c => c.discrepancia < 0).reduce((s, c) => s + c.discrepancia, 0), XF.int)],
      ['Sobrantes (uds.)', N(list.filter(c => c.discrepancia > 0).reduce((s, c) => s + c.discrepancia, 0), XF.int)]
    );
    XLSXLib.utils.book_append_sheet(
      wb,
      wsAoa(a4, [{ wch: 32 }, { wch: 22 }], [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }]),
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

  function chartPNG(kind, R) {
    try {
      const cv = document.createElement('canvas');
      cv.width = 880;
      cv.height = 420;
      const ink = '#1d211e', grid = 'rgba(29,33,30,.12)', PET = '#1f5668', CLAY = '#a85a32';
      const legend = { position: 'bottom', labels: { color: ink } };
      const scales = { x: { ticks: { color: ink }, grid: { color: grid } }, y: { ticks: { color: ink }, grid: { color: grid } } };
      let cfg = null;
      if (kind === 'bar') {
        const top = [...R.rows].sort((a, b) => b.ingresos - a.ingresos).slice(0, 8);
        cfg = {
          type: 'bar',
          data: {
            labels: top.map(r => (r.nombre.length > 20 ? r.nombre.slice(0, 19) + '…' : r.nombre)),
            datasets: [
              { label: 'Ingresos', data: top.map(r => +r.ingresos.toFixed(2)), backgroundColor: PET },
              { label: 'COGS', data: top.map(r => +r.cogs.toFixed(2)), backgroundColor: CLAY }
            ]
          },
          options: { responsive: false, animation: false, plugins: { legend }, scales }
        };
      } else if (kind === 'donut') {
        const dist = [
          ['sana', 'Sana'],
          ['lenta', 'Lenta'],
          ['muyLenta', 'Muy lenta'],
          ['dormido', 'Dormido']
        ].map(([k, l]) => ({ l, v: R.rows.filter(r => r.estado === k).length }));
        cfg = {
          type: 'doughnut',
          data: {
            labels: dist.map(d => d.l),
            datasets: [{ data: dist.map(d => d.v), backgroundColor: ['#38724f', '#8a6810', '#a9531a', '#9c3630'] }]
          },
          options: { responsive: false, animation: false, plugins: { legend }, cutout: '62%' }
        };
      } else {
        const data = Engine.abc($('#abcBase')?.value || 'valor');
        const col = { A: '#9c3630', B: '#8a6810', C: '#38724f' };
        cfg = {
          type: 'bar',
          data: {
            labels: data.map(d => (d.r.nombre.length > 16 ? d.r.nombre.slice(0, 15) + '…' : d.r.nombre)),
            datasets: [
              { type: 'bar', label: 'Base', data: data.map(d => +d.v.toFixed(2)), backgroundColor: data.map(d => col[d.abc]) },
              { type: 'line', label: '% acumulado', data: data.map(d => +d.pa.toFixed(1)), borderColor: ink, pointBackgroundColor: ink, yAxisID: 'y1', tension: 0.2 }
            ]
          },
          options: {
            responsive: false,
            animation: false,
            plugins: { legend },
            scales: {
              x: { ticks: { color: ink }, grid: { color: grid } },
              y: { ticks: { color: ink }, grid: { color: grid } },
              y1: { position: 'right', min: 0, max: 100, ticks: { color: ink, callback: v => v + '%' }, grid: { drawOnChartArea: false } }
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

  function buildPdf(C, base, imgs) {
    const NS = (typeof window !== 'undefined' && window.jspdf) || globalThis.jspdf;
    const { jsPDF } = NS;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const PET = [31, 86, 104], PAP = [246, 243, 236], INK = [29, 33, 30], MUT = [93, 98, 91], ARC = [168, 90, 50];
    const W = 210, M = 14, CW = W - 2 * M;
    const emp = Store.db.config.preferenciasUI.nombreEmpresa || 'Mi negocio';
    const periodo = `${fmtD(C.start)} al ${fmtD(C.end)}`;
    const estadoLbl = e => (e === 'sinDatos' ? 'Sin datos' : EST_LBL[e]);
    const T = {
      table: {
        styles: { fontSize: 7.5, textColor: INK },
        headStyles: { fillColor: PET, textColor: 255, fontSize: 7.5 },
        alternateRowStyles: { fillColor: PAP },
        margin: { left: M, right: M }
      }
    };

    // Banda de portada
    doc.setFillColor(...PET);
    doc.rect(0, 0, W, 30, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(17);
    doc.text('Informe de inventario', M, 12);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(emp, M, 19);
    doc.text(`Período: ${periodo} · Método FIFO (PEPS) · Emitido ${fmtD(new Date())}`, M, 24);
    let y = 38;
    const salto = () => {
      if (y > 248) {
        doc.addPage();
        y = 20;
      }
    };
    const h2 = t => {
      salto();
      doc.setFontSize(12);
      doc.setTextColor(...PET);
      doc.setFont('helvetica', 'bold');
      doc.text(t, M, y);
      y += 6;
    };
    const parr = t => {
      doc.setFontSize(9);
      doc.setTextColor(...INK);
      doc.setFont('helvetica', 'normal');
      doc.splitTextToSize(t, CW).forEach(l => {
        salto();
        doc.text(l, M, y);
        y += 5;
      });
      y += 3;
    };

    // 1. Resumen
    h2('1. Resumen del período');
    const kpis = [
      ['Días de inventario', C.dio !== null ? fmtN(C.dio, 1) : '—'],
      ['Costo de lo vendido', '$' + fmtN(C.totCogs, 0)],
      ['Ingresos', '$' + fmtN(C.totIng, 0)],
      ['Ganancia bruta', '$' + fmtN(C.totGan, 0)],
      ['En alerta', String(C.dorm)]
    ];
    const bw = (CW - 4 * 3) / 5;
    kpis.forEach((k, i) => {
      const x = M + i * (bw + 3);
      doc.setFillColor(...PAP);
      doc.setDrawColor(...PET);
      doc.roundedRect(x, y, bw, 20, 2, 2, 'FD');
      doc.setFontSize(7);
      doc.setTextColor(...MUT);
      doc.text(k[0], x + 3, y + 6);
      doc.setFontSize(11);
      doc.setTextColor(...(i === 4 && C.dorm > 0 ? ARC : INK));
      doc.setFont('helvetica', 'bold');
      doc.text(String(k[1]), x + 3, y + 14);
      doc.setFont('helvetica', 'normal');
    });
    y += 26;
    parr(
      `Entre el ${fmtD(C.start)} y el ${fmtD(C.end)} el negocio vendió $${fmtN(C.totIng, 0)} con un costo de $${fmtN(C.totCogs, 0)}, dejando una ganancia de $${fmtN(C.totGan, 0)}. El stock actual alcanzaría para ${C.dio !== null ? fmtN(C.dio, 1) + ' días' : '—'} al ritmo de ventas del período. Hay ${C.dorm} producto(s) en alerta por falta de movimiento.`
    );

    // 2. Detalle
    h2('2. Detalle por producto');
    doc.autoTable({
      ...T.table,
      startY: y,
      head: [['Producto', 'Stock', 'Inv. prom.', 'Rotación', 'Cobertura', 'Sin mov.', 'Estado']],
      body: C.rows.map(r => [
        r.nombre.slice(0, 32),
        r.stockActual,
        r.invPromQty.toFixed(1),
        r.rotacion.toFixed(2),
        r.cobertura !== null ? r.cobertura.toFixed(1) : '—',
        r.diasSinMov !== null ? r.diasSinMov : '—',
        estadoLbl(r.estado)
      ])
    });
    y = doc.lastAutoTable.finalY + 10;

    // 3. Gráficos
    if (imgs.bar || imgs.donut) {
      h2('3. Gráficos');
      const gw = (CW - 4) / 2, gh = gw * 0.55;
      if (y + gh > 270) {
        doc.addPage();
        y = 20;
      }
      if (imgs.bar) doc.addImage(imgs.bar, 'PNG', M, y, gw, gh);
      if (imgs.donut) doc.addImage(imgs.donut, 'PNG', M + gw + 4, y, gw, gh);
      y += gh + 10;
    }

    // 4. Clasificación
    h2('4. Clasificación de productos');
    const abc = Engine.abc(base);
    const totB = abc.reduce((s, d) => s + d.v, 0) || 1;
    parr(
      ['A', 'B', 'C']
        .map(g => {
          const it = abc.filter(d => d.abc === g);
          return `Grupo ${g}: ${it.length} producto(s), ${fmtN((it.reduce((s, d) => s + d.v, 0) / totB) * 100, 1)}% del dinero.`;
        })
        .join(' ')
    );
    doc.autoTable({
      ...T.table,
      startY: y,
      head: [['Producto', base === 'valor' ? 'Valor en stock' : 'COGS', '% total', '% acum.', 'Grupo', 'Estabilidad']],
      body: abc.map(d => [
        d.r.nombre.slice(0, 30),
        '$' + fmtN(d.v, 0),
        d.pi.toFixed(1) + '%',
        d.pa.toFixed(1) + '%',
        'Grupo ' + d.abc,
        XYZ_LBL[d.xyz]
      ])
    });
    y = doc.lastAutoTable.finalY + 10;
    if (imgs.pareto) {
      if (y + 70 > 270) {
        doc.addPage();
        y = 20;
      }
      doc.addImage(imgs.pareto, 'PNG', M, y, CW, 70);
      y += 76;
    }

    // 5. Compras
    h2('5. Qué comprar');
    const reab = Engine.reabastecimiento();
    const al = reab.filter(d => d.alerta);
    if (!al.length) {
      parr('Ningún producto necesita compra por ahora: todo el stock está por encima de su nivel de pedido.');
    } else {
      parr(`${al.length} producto(s) llegaron a su nivel de pedido. Total sugerido: ${fmt0(al.reduce((s, d) => s + d.sug, 0))} uds.`);
      doc.autoTable({
        ...T.table,
        startY: y,
        head: [['Producto', 'Stock', 'Pedir al llegar a', 'Cantidad a pedir']],
        body: al.map(d => [d.nombre.slice(0, 34), d.stockActual, d.PRO.toFixed(0), d.sug])
      });
      y = doc.lastAutoTable.finalY + 10;
    }

    // 6. Conteos
    h2('6. Conteos de almacén');
    const list = Store.db.conteosCiclicos || [];
    const ira = list.length ? (list.filter(c => c.discrepancia === 0).length / list.length) * 100 : 100;
    parr(
      `Se realizaron ${list.length} conteo(s) con una exactitud de ${fmtN(ira, 1)}%. Faltantes: ${fmt0(list.filter(c => c.discrepancia < 0).reduce((s, c) => s + c.discrepancia, 0))} uds. Sobrantes: +${fmt0(list.filter(c => c.discrepancia > 0).reduce((s, c) => s + c.discrepancia, 0))} uds.`
    );
    if (list.length) {
      const names = Object.fromEntries(Store.db.productos.map(p => [p.id, p.nombre]));
      doc.autoTable({
        ...T.table,
        startY: y,
        head: [['Fecha', 'Producto', 'Sistema', 'Físico', 'Diferencia', 'Motivo']],
        body: [...list].reverse().slice(0, 40).map(c => [
          fmtD(c.timestamp),
          (names[c.productoId] || '—').slice(0, 28),
          c.stockSistema,
          c.stockFisico,
          (c.discrepancia > 0 ? '+' : '') + c.discrepancia,
          (c.motivo || '—').slice(0, 30)
        ])
      });
    }

    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(...MUT);
      doc.text(`RotaStock Plus · FIFO (PEPS) · Página ${i} de ${n}`, M, 290);
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
