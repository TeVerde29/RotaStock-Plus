'use strict';

/**
 * RotaStock Plus — Controlador de Interfaz de Usuario (UI), Estado Encapsulado y Renderizado Perezoso.
 * Cumple íntegramente con la Sección 8, 10, 11 y 12 de funcionalidades.md.
 */
(function () {
  const {
    MS_PER_DAY,
    FLOAT_EPSILON,
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
  } = globalThis.RotaConstants || require('./constants.js');

  const { Store } = globalThis.Store ? { Store: globalThis.Store } : require('./store.js');
  const { Engine } = globalThis.Engine ? { Engine: globalThis.Engine } : require('./engine.js');
  const { buildWorkbook, buildPdf, chartPNG, repDays } =
    globalThis.Reports || require('./reports.js');

  /* ---------- Estado Encapsulado de la UI (Mejora #7 y #10) ---------- */
  const ALL_VIEWS = [
    'dashboard',
    'productos',
    'abc',
    'movimientos',
    'reabastecimiento',
    'auditoria',
    'configuracion',
    'respaldos',
    'reportes'
  ];

  const State = {
    period: 30,
    comp: null,
    activeView: 'dashboard',
    dirtyViews: new Set(ALL_VIEWS),
    dashPage: 1,
    movPage: 1,
    dashSort: { k: 'diasSinMov', dir: -1 },
    movSort: { k: 'fecha', dir: -1 },
    prodSort: { f: 'nombre', dir: 1 },
    charts: {},
    toastTimer: null
  };

  const pill = e =>
    e === 'sinDatos' ? '<span class="pill">Sin datos</span>' : `<span class="pill ${e}">${EST_LBL[e]}</span>`;

  const css = n =>
    typeof document !== 'undefined' && typeof getComputedStyle === 'function'
      ? getComputedStyle(document.documentElement).getPropertyValue(n).trim()
      : '';

  /* ---------- Aviso + Modal ---------- */
  function toast(msg, kind = '') {
    const t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast ' + kind;
    clearTimeout(State.toastTimer);
    State.toastTimer = setTimeout(() => t.classList.add('hidden'), 2800);
  }

  function openModal(title, html) {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = html;
    $('#modalOverlay').classList.remove('hidden');
  }

  function closeModal() {
    $('#modalOverlay')?.classList.add('hidden');
  }

  function guardWriteAction() {
    if (Store.isReadOnly()) {
      toast(
        `Modo lectura: estás viendo "${Store.activeSnapshotName}". Pulsa "Volver a la versión actual" para hacer cambios.`,
        'err'
      );
      return true;
    }
    return false;
  }

  function toISODateInput(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function initDefaultDateInputs() {
    const today = new Date();
    const past14 = new Date(today.getTime() - 14 * MS_PER_DAY);
    const sFrom = toISODateInput(past14);
    const sTo = toISODateInput(today);
    ['dashFrom', 'movFrom', 'repFrom'].forEach(id => {
      const el = $('#' + id);
      if (el && !el.value) el.value = sFrom;
    });
    ['dashTo', 'movTo', 'repTo'].forEach(id => {
      const el = $('#' + id);
      if (el && !el.value) el.value = sTo;
    });
  }

  function resolveDashPeriod() {
    const v = $('#periodSelect')?.value || '30';
    const box = $('#dashCustomRange');
    if (v === 'custom') {
      box?.classList.remove('hidden');
      const s = $('#dashFrom')?.value;
      const e = $('#dashTo')?.value;
      return s || e ? { start: s || e, end: e || s } : 30;
    }
    box?.classList.add('hidden');
    return v === 'all' || v === 'siempre' ? 0 : v === 'hoy' ? 'hoy' : +v;
  }

  function syncTimeTravelUI() {
    const ro = Store.isReadOnly();
    if (typeof document !== 'undefined') {
      document.body.classList.toggle('is-readonly', ro);
    }
    const banner = $('#timeTravelBanner');
    const txt = $('#timeTravelText');
    const badge = $('#snapshotStatusBadge');
    if (banner) {
      if (ro) {
        banner.classList.remove('hidden');
        if (txt) {
          txt.innerHTML = `Estás viendo la copia <strong>${esc(Store.activeSnapshotName)}</strong> (${Store.db.productos.length} productos · ${Store.db.movimientos.length} movimientos). Tus datos actuales siguen intactos.`;
        }
      } else {
        banner.classList.add('hidden');
      }
    }
    if (badge) {
      badge.textContent = ro ? 'Copia histórica' : 'Versión';
    }
  }

  function styleCharts() {
    if (typeof window === 'undefined' || !window.Chart) return;
    window.Chart.defaults.color = css('--muted');
    window.Chart.defaults.borderColor = css('--grid');
    window.Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  }

  /* ---------- Despachador de Renderizado Perezoso por Pestaña (Mejora #10) ---------- */
  const VIEW_RENDERERS = {
    dashboard: () => renderDash(),
    productos: () => renderProds(),
    abc: () => renderABC(),
    movimientos: () => renderMovs(),
    reabastecimiento: () => renderReab(),
    auditoria: () => renderAud(),
    configuracion: () => renderCfg(),
    respaldos: () => listBackups(true),
    reportes: () => {}
  };

  function renderActiveView() {
    const view = State.activeView || 'dashboard';
    if (VIEW_RENDERERS[view]) {
      VIEW_RENDERERS[view]();
      State.dirtyViews.delete(view);
    }
  }

  async function renderAll(forceAll = false) {
    State.comp = Engine.compute(State.period);
    styleCharts();
    syncTimeTravelUI();

    const cap = $('#periodCaption');
    if (cap) {
      cap.textContent = `Del ${fmtD(State.comp.start)} al ${fmtD(State.comp.end)} · ${State.comp.rows.length} productos · ${Store.db.movimientos.length} movimientos`;
    }
    const sideEmp = $('#sideEmp');
    if (sideEmp) {
      sideEmp.textContent = Store.db.config.preferenciasUI.nombreEmpresa || 'Mi negocio';
    }
    const sideStats = $('#sideStats');
    if (sideStats) {
      sideStats.textContent = `${State.comp.rows.length} productos · ${Store.db.movimientos.length} mov.`;
    }

    ALL_VIEWS.forEach(v => State.dirtyViews.add(v));

    if (forceAll) {
      renderDash();
      renderProds();
      renderABC();
      renderMovs();
      renderReab();
      renderAud();
      renderCfg();
      State.dirtyViews.clear();
    } else {
      renderActiveView();
    }
  }

  /* ---------- 01 Panel de Control ---------- */
  function renderDash() {
    const COMP = State.comp || Engine.compute(State.period);
    State.comp = COMP;

    const banner = $('#alertBanner');
    if (COMP.dorm > 0) {
      banner.classList.remove('hidden');
      const val = COMP.rows.filter(r => r.estado === 'dormido').reduce((s, r) => s + r.valorInventario, 0);
      $('#alertText').innerHTML = `<strong>Atención:</strong> ${COMP.dorm} producto(s) llevan más de ${Store.db.config.umbrales.muyLenta} días sin moverse. Dinero detenido: <strong>$${fmtN(val)}</strong>.`;
    } else {
      banner.classList.add('hidden');
    }

    $('#kpiDias').textContent = COMP.dio !== null ? fmtN(COMP.dio, 1) : '—';
    $('#kpiDiasSub').textContent = COMP.dio !== null ? `días · período de ${COMP.delta} días` : 'sin ventas en el período';
    $('#kpiCogs').textContent = '$' + fmtN(COMP.totCogs, 0);
    $('#kpiCogsSub').textContent = COMP.totIng ? fmtN((COMP.totCogs / COMP.totIng) * 100, 1) + '% de lo vendido' : 'sin ventas en el período';
    $('#kpiIngresos').textContent = '$' + fmtN(COMP.totIng, 0);
    $('#kpiIngresosSub').textContent = 'ventas del período';
    $('#kpiGanancia').textContent = '$' + fmtN(COMP.totGan, 0);
    $('#kpiGananciaSub').textContent = COMP.totIng ? fmtN((COMP.totGan / COMP.totIng) * 100, 1) + '% de margen' : '—';
    $('#kpiAlertas').textContent = COMP.dorm;
    $('#kpiAlertasSub').textContent = 'productos dormidos';

    const top = [...COMP.rows].sort((a, b) => b.ingresos - a.ingresos).slice(0, 8);
    if (State.charts.bar) State.charts.bar.destroy();
    if (typeof window !== 'undefined' && window.Chart && $('#chartBar')) {
      State.charts.bar = new window.Chart($('#chartBar'), {
        type: 'bar',
        data: {
          labels: top.map(r => (r.nombre.length > 18 ? r.nombre.slice(0, 17) + '…' : r.nombre)),
          datasets: [
            { label: 'Ingresos', data: top.map(r => +r.ingresos.toFixed(2)), backgroundColor: css('--chart-1'), borderRadius: 3 },
            { label: 'COGS', data: top.map(r => +r.cogs.toFixed(2)), backgroundColor: css('--chart-2'), borderRadius: 3 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom' },
            tooltip: {
              callbacks: {
                label: c => `${c.dataset.label}: $${Number(c.raw).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
              }
            }
          },
          scales: {
            x: { grid: { color: css('--grid') } },
            y: { grid: { color: css('--grid') }, ticks: { callback: v => '$' + Number(v).toLocaleString('en-US') } }
          }
        }
      });
    }

    const dist = [
      ['sana', 'Sana'],
      ['lenta', 'Lenta'],
      ['muyLenta', 'Muy lenta'],
      ['dormido', 'Dormido']
    ].map(([k, l]) => ({ k, l, v: COMP.rows.filter(r => r.estado === k).length }));

    if (State.charts.donut) State.charts.donut.destroy();
    if (typeof window !== 'undefined' && window.Chart && $('#chartDonut')) {
      State.charts.donut = new window.Chart($('#chartDonut'), {
        type: 'doughnut',
        data: {
          labels: dist.map(d => d.l),
          datasets: [
            {
              data: dist.map(d => d.v),
              backgroundColor: [css('--sana'), css('--lenta'), css('--muyLenta'), css('--dormido')],
              borderColor: css('--surface'),
              borderWidth: 2
            }
          ]
        },
        options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'bottom' } } }
      });
    }
    $('#donutLegend').innerHTML = dist.map(d => `<div class="lrow"><span><i class="dot ${d.k}"></i>${d.l}</span><b>${d.v}</b></div>`).join('');

    const q = ($('#dashSearch').value || '').toLowerCase();
    const val = {
      nombre: r => r.nombre.toLowerCase(),
      invProm: r => r.invPromQty,
      rotacion: r => r.rotacion,
      cobertura: r => r.cobertura ?? -1,
      diasSinMov: r => r.diasSinMov ?? 1e12,
      estadoOrden: r => ({ sinDatos: -1, sana: 0, lenta: 1, muyLenta: 2, dormido: 3 }[r.estado])
    };
    const rows = COMP.rows.filter(r => r.nombre.toLowerCase().includes(q));
    rows.sort((a, b) => {
      const x = val[State.dashSort.k](a), y = val[State.dashSort.k](b);
      return (x > y ? 1 : x < y ? -1 : 0) * State.dashSort.dir;
    });
    $$('#dashTable th').forEach(th => {
      th.classList.remove('sorted', 'desc');
      if (th.dataset.sort === State.dashSort.k) {
        th.classList.add('sorted');
        if (State.dashSort.dir < 0) th.classList.add('desc');
      }
    });
    const per = 8, pages = Math.max(1, Math.ceil(rows.length / per));
    State.dashPage = Math.min(State.dashPage, pages);
    const s = rows.slice((State.dashPage - 1) * per, State.dashPage * per);
    $('#dashTable tbody').innerHTML =
      s
        .map(
          r => `<tr><td>${esc(r.nombre)}</td>
      <td class="num">${fmtN(r.invPromQty, 1)}</td><td class="num">${fmtN(r.rotacion, 2)}×</td>
      <td class="num">${r.cobertura !== null ? fmtN(r.cobertura, 1) : '—'}</td>
      <td class="num">${r.diasSinMov !== null ? r.diasSinMov : '—'}</td>
      <td>${pill(r.estado)}</td></tr>`
        )
        .join('') || '<tr><td colspan="6" class="muted">Sin productos.</td></tr>';
    $('#dashPager').innerHTML =
      `<span class="pinfo">Mostrando ${s.length} de ${rows.length} · pág. ${State.dashPage}/${pages}</span>` +
      Array.from({ length: pages }, (_, i) => `<button class="${i + 1 === State.dashPage ? 'active' : ''}" data-pg="${i + 1}">${i + 1}</button>`).join('');
    $$('#dashPager button').forEach(b => (b.onclick = () => {
      State.dashPage = +b.dataset.pg;
      renderDash();
    }));
  }

  /* ---------- 02 Productos ---------- */
  function renderProds() {
    const COMP = State.comp || Engine.compute(State.period);
    const q = ($('#prodSearch').value || '').toLowerCase(), fe = $('#prodFilterEstado').value;
    const key = {
      nombre: 'nombre',
      rotacion: 'rotacion',
      cogs: 'cogs',
      ingresos: 'ingresos',
      ganancia: 'ganancia',
      cobertura: 'cobertura',
      diasSinMov: 'diasSinMov'
    }[State.prodSort.f];
    const rows = COMP.rows.filter(r => r.nombre.toLowerCase().includes(q) && (!fe || r.estado === fe));
    rows.sort((a, b) => {
      let va = a[key], vb = b[key];
      if (typeof va === 'string') return State.prodSort.dir > 0 ? va.localeCompare(vb) : vb.localeCompare(va);
      va = va ?? -1;
      vb = vb ?? -1;
      return State.prodSort.dir > 0 ? va - vb : vb - va;
    });
    $('#productGrid').innerHTML =
      rows
        .map(
          r => `<div class="prod-card">
      <div class="prod-card-top"><span class="prod-name">${esc(r.nombre)}</span>${pill(r.estado)}</div>
      <div class="prod-metrics">
        <div class="pm"><span class="pm-lbl">Stock actual</span><span class="pm-val">${fmt0(r.stockActual)}</span></div>
        <div class="pm"><span class="pm-lbl">Inv. promedio</span><span class="pm-val">${fmtN(r.invPromQty, 1)}</span></div>
        <div class="pm"><span class="pm-lbl">COGS</span><span class="pm-val">$${fmtN(r.cogs)}</span></div>
        <div class="pm"><span class="pm-lbl">Ingresos</span><span class="pm-val">$${fmtN(r.ingresos)}</span></div>
        <div class="pm"><span class="pm-lbl">Ganancia</span><span class="pm-val">$${fmtN(r.ganancia)}</span></div>
        <div class="pm"><span class="pm-lbl">Rotación</span><span class="pm-val">${fmtN(r.rotacion, 2)}×</span></div>
        <div class="pm"><span class="pm-lbl">Días cobertura</span><span class="pm-val">${r.cobertura !== null ? fmtN(r.cobertura, 1) : '—'}</span></div>
        <div class="pm"><span class="pm-lbl">Días sin mov.</span><span class="pm-val">${r.diasSinMov !== null ? r.diasSinMov : '—'}</span></div>
      </div>
      <div class="prod-actions"><button class="btn btn-ghost" data-edit="${r.id}"><svg class="i"><use href="#i-edit"/></svg> Editar</button><button class="btn btn-danger" data-del="${r.id}"><svg class="i"><use href="#i-trash"/></svg> Eliminar</button></div>
    </div>`
        )
        .join('') || '<div class="empty">Sin productos. Crea el primero con “Nuevo producto”.</div>';
    $$('#productGrid [data-edit]').forEach(b => (b.onclick = () => editProd(b.dataset.edit)));
    $$('#productGrid [data-del]').forEach(b => (b.onclick = () => delProd(b.dataset.del)));
  }

  function editProd(id) {
    if (guardWriteAction()) return;
    const p = Store.db.productos.find(x => x.id === id);
    if (!p) return;
    openModal(
      'Editar producto',
      `<div class="form-grid">
      <label>Nombre<input id="mNombre" class="input" required maxlength="120" value="${esc(p.nombre)}" /></label>
      <label>Tiempo de entrega del proveedor (días)<input id="mLT" class="input" type="number" min="1" step="1" required value="${p.leadTime ?? DEFAULT_LEAD_TIME}" /></label>
      <label>Margen de seguridad<select id="mZ" class="input"><option value="1.65" ${(p.nivelServicioZ ?? DEFAULT_Z) >= 1.65 ? 'selected' : ''}>Alto</option><option value="1.28" ${p.nivelServicioZ === 1.28 ? 'selected' : ''}>Normal</option><option value="1.04" ${p.nivelServicioZ === 1.04 ? 'selected' : ''}>Bajo</option></select></label>
      <label>Costo base<input id="mC" class="input" type="number" min="0" step="0.01" value="${p.costoUnitario ?? 0}" /></label>
      <div class="form-actions"><button class="btn btn-primary" id="mSave">Guardar</button><button class="btn btn-ghost" id="mCancel">Cancelar</button></div></div>`
    );
    $('#mCancel').onclick = closeModal;
    $('#mSave').onclick = async () => {
      const nuevoNombre = $('#mNombre').value.trim();
      const lt = +$('#mLT').value;
      const cBase = +$('#mC').value;
      p.nombre = nuevoNombre || p.nombre;
      p.leadTime = Number.isFinite(lt) && lt >= 1 ? Math.floor(lt) : DEFAULT_LEAD_TIME;
      p.nivelServicioZ = +$('#mZ').value || DEFAULT_Z;
      p.costoUnitario = Number.isFinite(cBase) && cBase >= 0 ? cBase : p.costoUnitario;
      await Store.save();
      closeModal();
      renderAll();
      toast('Producto actualizado', 'ok');
    };
  }

  function delProd(id) {
    if (guardWriteAction()) return;
    const p = Store.db.productos.find(x => x.id === id);
    if (!p) return;
    const n = Store.db.movimientos.filter(m => m.productoId === id).length;
    openModal(
      'Eliminar producto',
      `<p>Se eliminará <strong>${esc(p.nombre)}</strong> con sus <strong>${n}</strong> movimientos y todo se recalculará. ¿Continuar?</p>
      <div class="form-actions"><button class="btn btn-danger" id="mDel">Sí, eliminar</button><button class="btn btn-ghost" id="mCancel">Cancelar</button></div>`
    );
    $('#mCancel').onclick = closeModal;
    $('#mDel').onclick = async () => {
      Store.db.productos = Store.db.productos.filter(x => x.id !== id);
      Store.db.movimientos = Store.db.movimientos.filter(m => m.productoId !== id);
      await Store.save();
      closeModal();
      renderAll();
      toast('Producto eliminado', 'ok');
    };
  }

  /* ---------- 03 Clasificación ABC ---------- */
  function renderABC() {
    const base = $('#abcBase').value, data = Engine.abc(base);
    const tot = data.reduce((s, d) => s + d.v, 0) || 1;
    const baseName = base === 'valor' ? 'Dinero en stock' : 'COGS';
    $('#abcBaseHead').textContent = baseName;
    $('#abcInfo').textContent = `${data.length} productos clasificados`;
    const groups = ['A', 'B', 'C'].map(g => {
      const items = data.filter(d => d.abc === g);
      return { g, items, share: (items.reduce((s, d) => s + d.v, 0) / tot) * 100 };
    });
    const totalCount = data.length || 1;
    $('#abcCats').innerHTML = groups
      .map(
        g => `<div class="abc-cat ${g.g}">
      <div class="abc-cat-t">Categoría ${g.g}</div>
      <div class="muted">Productos: <strong style="color:var(--text)">${g.items.length}</strong> (${fmtN((g.items.length / totalCount) * 100, 2)}% del total)</div>
      <div class="muted">${baseName}: <strong style="color:var(--text)">${fmtN(g.share, 2)}%</strong> del total</div>
    </div>`
      )
      .join('');

    const col = { A: css('--dormido'), B: css('--lenta'), C: css('--sana') };
    const lineCol = css('--text');
    if (State.charts.pareto) State.charts.pareto.destroy();
    if (typeof window !== 'undefined' && window.Chart && $('#chartPareto')) {
      State.charts.pareto = new window.Chart($('#chartPareto'), {
        type: 'bar',
        data: {
          labels: data.map(d => (d.r.nombre.length > 16 ? d.r.nombre.slice(0, 15) + '…' : d.r.nombre)),
          datasets: [
            { type: 'bar', label: baseName, data: data.map(d => +d.v.toFixed(2)), backgroundColor: data.map(d => col[d.abc]), borderRadius: 3 },
            { type: 'line', label: '% acumulado', data: data.map(d => +d.pa.toFixed(1)), borderColor: lineCol, pointBackgroundColor: lineCol, yAxisID: 'y1', tension: 0.2 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom' } },
          scales: {
            x: { grid: { color: css('--grid') } },
            y: { grid: { color: css('--grid') }, ticks: { callback: v => '$' + Number(v).toLocaleString('en-US') } },
            y1: { position: 'right', min: 0, max: 100, ticks: { callback: v => v + '%' }, grid: { drawOnChartArea: false } }
          }
        }
      });
    }
    $('#paretoChips').innerHTML = [
      ['A', 'Grupo A — lo más importante'],
      ['B', 'Grupo B — intermedio'],
      ['C', 'Grupo C — lo de menor peso']
    ]
      .map(([g, l]) => `<span><i class="dot" style="color:${col[g]}"></i>${l}</span>`)
      .join('');

    const xyzCls = { X: 'abc', Y: 'warn', Z: 'bad' };
    const grpCls = { A: 'bad', B: 'warn', C: 'abc' };
    $('#abcTable tbody').innerHTML = data
      .map(
        d => `<tr><td><strong>${esc(d.r.nombre)}</strong></td>
      <td class="num">$${fmtN(d.v)}</td>
      <td class="num">${fmtN(d.pi, 1)}%</td><td class="num">${fmtN(d.pa, 1)}%</td>
      <td><span class="badge ${grpCls[d.abc]}">Grupo ${d.abc}</span></td><td class="num">${fmtN(d.cv, 2)}</td>
      <td><span class="badge ${xyzCls[d.xyz]}">${XYZ_LBL[d.xyz]}</span></td>
      <td>${d.abc === 'A' ? 'Cada 30 días' : d.abc === 'B' ? 'Cada 60 días' : 'Cada 120 días'}</td></tr>`
      )
      .join('');
  }

  /* ---------- 04 Movimientos ---------- */
  function renderMovs() {
    const q = ($('#movSearch').value || '').toLowerCase(), f = $('#movFilterTipo').value;
    const names = Object.fromEntries(Store.db.productos.map(p => [p.id, p.nombre]));
    const pr = $('#movPeriodo').value;
    const customBox = $('#movCustomRange');
    let desde = 0;
    let hasta = Infinity;
    if (pr === 'custom') {
      customBox?.classList.remove('hidden');
      const r = Engine.range({ start: $('#movFrom')?.value, end: $('#movTo')?.value });
      desde = r.start.getTime();
      hasta = r.end.getTime();
    } else {
      customBox?.classList.add('hidden');
      if (pr === 'hoy') {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        desde = d.getTime();
      } else if (pr !== 'siempre') {
        desde = Date.now() - +pr * MS_PER_DAY;
      }
    }

    const rows = [...Store.db.movimientos]
      .filter(m => {
        const ts = new Date(m.timestamp).getTime();
        return (
          (names[m.productoId] || '').toLowerCase().includes(q) &&
          (!f || m.tipo === f || (f === 'compra' && m.tipo === 'ajuste_excedente')) &&
          ts >= desde &&
          ts <= hasta
        );
      })
      .map(m => ({ ...m, producto: names[m.productoId] || '(eliminado)', fecha: new Date(m.timestamp).getTime() }));

    rows.sort((a, b) => {
      const x = a[State.movSort.k], y = b[State.movSort.k];
      return (x > y ? 1 : x < y ? -1 : 0) * State.movSort.dir;
    });
    $$('#movTable th').forEach(th => {
      th.classList.remove('sorted', 'desc');
      if (th.dataset.sort === State.movSort.k) {
        th.classList.add('sorted');
        if (State.movSort.dir < 0) th.classList.add('desc');
      }
    });
    $('#movCount').textContent = `· ${rows.length} registros`;
    const per = 10, pages = Math.max(1, Math.ceil(rows.length / per));
    State.movPage = Math.min(State.movPage, pages);
    const s = rows.slice((State.movPage - 1) * per, State.movPage * per);
    $('#movTable tbody').innerHTML =
      s
        .map(
          m => `<tr><td>${fmtF(m.timestamp)}</td><td>${esc(m.producto)}</td>
      <td><span class="badge ${m.tipo === 'venta' ? 'venta' : 'compra'}">${m.tipo === 'venta' ? 'Venta' : 'Compra'}</span>${m.motivoAjuste ? `<br><small class="muted">${esc(m.motivoAjuste)}</small>` : ''}</td>
      <td class="num">${fmt0(m.cantidad)}</td><td class="num">$${fmtN(m.costoUnitario)}</td><td class="num">$${fmtN(m.cantidad * m.costoUnitario)}</td>
      <td><button class="icon-btn" data-emov="${m.id}" title="Editar"><svg class="i"><use href="#i-edit"/></svg></button><button class="icon-btn" data-dmov="${m.id}" title="Eliminar"><svg class="i"><use href="#i-trash"/></svg></button></td></tr>`
        )
        .join('') || '<tr><td colspan="7" class="muted">Sin movimientos.</td></tr>';
    $('#movPager').innerHTML =
      `<span class="pinfo">Pág. ${State.movPage}/${pages} · ${rows.length} registros</span>` +
      Array.from({ length: Math.min(pages, 9) }, (_, i) => `<button class="${i + 1 === State.movPage ? 'active' : ''}" data-pg="${i + 1}">${i + 1}</button>`).join('');
    $$('#movPager button').forEach(b => (b.onclick = () => {
      State.movPage = +b.dataset.pg;
      renderMovs();
    }));
    $$('#movTable [data-emov]').forEach(b => (b.onclick = () => editMov(b.dataset.emov)));
    $$('#movTable [data-dmov]').forEach(
      b =>
        (b.onclick = async () => {
          if (guardWriteAction()) return;
          Store.db.movimientos = Store.db.movimientos.filter(x => x.id !== b.dataset.dmov);
          await Store.save();
          renderAll();
          toast('Movimiento eliminado', 'ok');
        })
    );
  }

  function editMov(id) {
    if (guardWriteAction()) return;
    const m = id ? Store.db.movimientos.find(x => x.id === id) : null;
    const prods = Store.db.productos;
    openModal(
      id ? 'Editar movimiento' : 'Registrar movimiento',
      `<div class="form-grid">
      <label>Producto<div class="form-group"><input id="mProdTxt" class="input" autocomplete="off" required value="${m ? esc(prods.find(p => p.id === m.productoId)?.nombre || '') : ''}" placeholder="Escribe para buscar…" /><div class="autocomplete-list hidden" id="mProdList"></div></div></label>
      <label>Tipo<select id="mTipo" class="input"><option value="compra" ${m?.tipo === 'compra' ? 'selected' : ''}>Compra (entra)</option><option value="venta" ${!m || m?.tipo === 'venta' ? 'selected' : ''}>Venta (sale)</option></select></label>
      <label>Fecha y hora<input id="mFec" class="input" type="datetime-local" required value="${m ? m.timestamp.slice(0, 16) : new Date().toISOString().slice(0, 16)}" /></label>
      <label>Cantidad<input id="mCant" class="input" type="number" min="1" step="1" required value="${m?.cantidad || 1}" /></label>
      <label id="mCostLbl">Precio de venta<input id="mCost" class="input" type="number" min="0" step="0.01" required value="${m?.costoUnitario || 0}" /></label>
      <div class="form-actions"><button class="btn btn-primary" id="mSave">Guardar</button><button class="btn btn-ghost" id="mCancel">Cancelar</button></div></div>`
    );
    let selId = m?.productoId || '';
    const txt = $('#mProdTxt'), list = $('#mProdList');
    const paint = v => {
      list.innerHTML = prods
        .filter(p => p.nombre.toLowerCase().includes(v.toLowerCase()))
        .slice(0, 8)
        .map(p => `<div data-pid="${p.id}">${esc(p.nombre)}</div>`)
        .join('');
      list.classList.remove('hidden');
      $$('#mProdList [data-pid]').forEach(
        d =>
          (d.onmousedown = () => {
            selId = d.dataset.pid;
            txt.value = d.textContent;
            list.classList.add('hidden');
          })
      );
    };
    txt.onfocus = () => paint(txt.value);
    txt.oninput = () => {
      selId = '';
      paint(txt.value);
    };
    txt.onblur = () => setTimeout(() => list.classList.add('hidden'), 150);
    const lbl = () => ($('#mCostLbl').firstChild.textContent = $('#mTipo').value === 'compra' ? 'Costo de compra' : 'Precio de venta');
    $('#mTipo').onchange = lbl;
    lbl();
    $('#mCancel').onclick = closeModal;
    $('#mSave').onclick = async () => {
      const tipo = $('#mTipo').value, cant = parseInt($('#mCant').value, 10), cu = +$('#mCost').value;
      const ts = new Date($('#mFec').value);
      if (!selId || !Number.isFinite(cant) || cant < 1 || !Number.isFinite(cu) || cu < 0 || Number.isNaN(ts.getTime())) {
        toast('Revisa los datos ingresados', 'err');
        return;
      }
      if (tipo === 'venta') {
        const r = Engine.compute(0).rows.find(x => x.id === selId);
        let disp = r ? r.stockActual : 0;
        if (m?.tipo === 'venta' && m.productoId === selId) disp += m.cantidad;
        if (m?.tipo === 'compra' && m.productoId === selId) disp -= m.cantidad;
        if (cant > disp + FLOAT_EPSILON) {
          toast(`Stock insuficiente: disponible ${fmt0(Math.max(0, disp))} unidad(es).`, 'err');
          return;
        }
      }
      if (m) {
        Object.assign(m, { productoId: selId, tipo, cantidad: cant, costoUnitario: cu, timestamp: ts.toISOString() });
      } else {
        Store.db.movimientos.push({
          id: uid('m'),
          timestamp: ts.toISOString(),
          tipo,
          productoId: selId,
          cantidad: cant,
          costoUnitario: cu,
          _cogs: 0,
          _ingreso: 0,
          motivoAjuste: null
        });
      }
      await Store.save();
      closeModal();
      renderAll();
      toast('Movimiento guardado', 'ok');
    };
  }

  /* ---------- 05 Qué Comprar ---------- */
  function renderReab() {
    const data = Engine.reabastecimiento().sort((a, b) => b.alerta - a.alerta || a.stockActual - a.PRO - (b.stockActual - b.PRO));
    const al = data.filter(d => d.alerta);
    $('#reabAlert').innerHTML = al.length
      ? `<div class="alert-banner"><span id="alertText"><strong>Hay que comprar:</strong> ${al.length} producto(s) están en nivel bajo. Total sugerido: <strong>${fmt0(al.reduce((s, d) => s + d.sug, 0))} uds.</strong></span></div>`
      : `<div class="alert-banner ok"><span id="alertText"><strong>Todo bien:</strong> ningún producto necesita compra por ahora.</span></div>`;
    $('#reabInfo').textContent = `· ${al.length} por comprar`;
    $('#reabTable tbody').innerHTML = data
      .map(
        d => `<tr><td><strong>${esc(d.nombre)}</strong><br><small class="muted">El proveedor tarda ~${d.leadTime} días</small></td>
      <td class="num">${fmt0(d.stockActual)}</td><td class="num">${fmtN(d.dBar, 1)}</td><td class="num">${fmtN(d.pron, 0)} al mes</td>
      <td class="num">${fmtN(d.SS, 0)}</td><td class="num">${fmtN(d.PRO, 0)}</td><td class="num"><strong>${fmt0(d.sug)}</strong></td>
      <td>${d.alerta ? '<span class="badge bad">Comprar</span>' : '<span class="badge abc">Bien</span>'}</td></tr>`
      )
      .join('');
  }

  /* ---------- 06 Conteos de Almacén ---------- */
  function renderAud() {
    const list = Store.db.conteosCiclicos || [];
    const ira = list.length ? (list.filter(c => c.discrepancia === 0).length / list.length) * 100 : 100;
    $('#iraKpis').innerHTML = `
      <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Exactitud de conteos</span></div><span class="kpi-value">${fmtN(ira, 1)}%</span><span class="kpi-sub">${list.length} conteos realizados</span></div>
      <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Faltantes</span></div><span class="kpi-value">${fmt0(list.filter(c => c.discrepancia < 0).reduce((s, c) => s + c.discrepancia, 0))}</span><span class="kpi-sub">unidades que faltaron</span></div>
      <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Sobrantes</span></div><span class="kpi-value">+${fmt0(list.filter(c => c.discrepancia > 0).reduce((s, c) => s + c.discrepancia, 0))}</span><span class="kpi-sub">unidades de más</span></div>`;
    const names = Object.fromEntries(Store.db.productos.map(p => [p.id, p.nombre]));
    $('#audTable tbody').innerHTML =
      [...list]
        .reverse()
        .map(
          c => `<tr><td>${fmtF(c.timestamp)}</td><td>${esc(names[c.productoId] || '(eliminado)')}</td>
      <td class="num">${fmt0(c.stockSistema)}</td><td class="num">${fmt0(c.stockFisico)}</td>
      <td class="num"><strong style="color:var(--${c.discrepancia === 0 ? 'sana' : 'dormido'})">${c.discrepancia > 0 ? '+' : ''}${fmt0(c.discrepancia)}</strong></td>
      <td>${esc(c.motivo || '—')}</td><td class="mono" style="font-size:.76rem">${c.movimientoAjusteId ? 'Ajustado' : 'Sin diferencia'}</td>
      <td><button class="icon-btn" data-econteo="${c.id}" title="Editar"><svg class="i"><use href="#i-edit"/></svg></button><button class="icon-btn" data-rconteo="${c.id}" title="Revertir (como si nunca hubiera existido)"><svg class="i"><use href="#i-trash"/></svg></button></td></tr>`
        )
        .join('') || '<tr><td colspan="8" class="muted">Aún no hay conteos.</td></tr>';
    $$('#audTable [data-econteo]').forEach(b => (b.onclick = () => editConteo(b.dataset.econteo)));
    $$('#audTable [data-rconteo]').forEach(b => (b.onclick = () => revertConteo(b.dataset.rconteo)));
  }

  function sysSinAjuste(c) {
    const r = Engine.compute(0).rows.find(x => x.id === c.productoId);
    return r ? r.stockActual - c.discrepancia : 0;
  }

  function editConteo(id) {
    if (guardWriteAction()) return;
    const c = Store.db.conteosCiclicos.find(x => x.id === id);
    if (!c) return;
    const nombre = (Store.db.productos.find(p => p.id === c.productoId) || {}).nombre || '(eliminado)';
    const sys = sysSinAjuste(c);
    openModal(
      'Editar conteo',
      `<div class="form-grid">
      <label>Producto<input class="input" disabled value="${esc(nombre)}" /></label>
      <label>Sistema actual (sin este ajuste)<input class="input" disabled value="${sys} uds." /></label>
      <label>Lo contado en físico<input id="eFis" class="input" type="number" min="0" step="1" required value="${c.stockFisico}" /></label>
      <label>Motivo de la diferencia<input id="eMot" class="input" maxlength="200" value="${esc(c.motivo || '')}" /></label>
      <div class="form-actions"><button class="btn btn-primary" id="eSave">Guardar</button><button class="btn btn-ghost" id="eCancel">Cancelar</button></div>
      <p class="muted">Al guardar se rehace el ajuste con la nueva diferencia.</p></div>`
    );
    $('#eCancel').onclick = closeModal;
    $('#eSave').onclick = async () => {
      const fis = parseInt($('#eFis').value, 10), mot = $('#eMot').value.trim() || 'Ajuste de conteo';
      if (!Number.isFinite(fis) || fis < 0) {
        toast('Ingresa lo contado en físico', 'err');
        return;
      }
      if (c.movimientoAjusteId) {
        Store.db.movimientos = Store.db.movimientos.filter(m => m.id !== c.movimientoAjusteId);
      }
      const r = Engine.compute(0).rows.find(x => x.id === c.productoId);
      const sysClean = r ? r.stockActual : 0;
      const valClean = r ? r.valorInventario : 0;
      const d = fis - sysClean;
      const movId = Engine.crearMovimientoAjuste(c.productoId, d, mot, sysClean, valClean);
      Object.assign(c, {
        stockSistema: sysClean,
        stockFisico: fis,
        discrepancia: d,
        motivo: mot,
        iraCumplido: d === 0 ? 1 : 0,
        movimientoAjusteId: movId
      });
      await Store.save();
      closeModal();
      renderAll();
      toast('Conteo actualizado', 'ok');
    };
  }

  function revertConteo(id) {
    if (guardWriteAction()) return;
    const c = Store.db.conteosCiclicos.find(x => x.id === id);
    if (!c) return;
    openModal(
      'Revertir conteo',
      `<p>Se eliminará este conteo${c.movimientoAjusteId ? ' y su ajuste del historial' : ''}. Todo volverá a como estaba, como si nunca hubiera existido. ¿Continuar?</p>
      <div class="form-actions"><button class="btn btn-danger" id="rYes">Sí, revertir</button><button class="btn btn-ghost" id="rNo">Cancelar</button></div>`
    );
    $('#rNo').onclick = closeModal;
    $('#rYes').onclick = async () => {
      if (c.movimientoAjusteId) {
        Store.db.movimientos = Store.db.movimientos.filter(m => m.id !== c.movimientoAjusteId);
      }
      Store.db.conteosCiclicos = Store.db.conteosCiclicos.filter(x => x.id !== id);
      await Store.save();
      closeModal();
      renderAll();
      toast('Conteo revertido', 'ok');
    };
  }

  function newConteo() {
    if (guardWriteAction()) return;
    const prods = Store.db.productos;
    if (!prods.length) {
      toast('Primero crea un producto', 'err');
      return;
    }
    openModal(
      'Nuevo conteo',
      `<div class="form-grid">
      <label>Producto<select id="cProd" class="input">${prods.map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('')}</select></label>
      <label>Lo que dice el sistema<input id="cSys" class="input" disabled /></label>
      <label>Lo que contaste en físico<input id="cFis" class="input" type="number" min="0" step="1" required /></label>
      <label>Motivo de la diferencia<input id="cMot" class="input" maxlength="200" placeholder="Ej. empaque dañado…" /></label>
      <div class="form-actions"><button class="btn btn-primary" id="cSave">Guardar</button><button class="btn btn-ghost" id="cCancel">Cancelar</button></div>
      <p class="muted">Si hay diferencia, el sistema la registra solo en los movimientos.</p></div>`
    );
    const COMP = State.comp || Engine.compute(State.period);
    const upd = () => {
      const r = COMP.rows.find(x => x.id === $('#cProd').value);
      if (r) $('#cSys').value = r.stockActual + ' uds.';
    };
    $('#cProd').onchange = upd;
    upd();
    $('#cCancel').onclick = closeModal;
    $('#cSave').onclick = async () => {
      const pid = $('#cProd').value, fis = parseInt($('#cFis').value, 10), mot = $('#cMot').value.trim() || 'Ajuste de conteo';
      const r = COMP.rows.find(x => x.id === pid);
      if (!r || !Number.isFinite(fis) || fis < 0) {
        toast('Ingresa lo que contaste en físico', 'err');
        return;
      }
      const d = fis - r.stockActual;
      const movId = Engine.crearMovimientoAjuste(pid, d, mot, r.stockActual, r.valorInventario);
      Store.db.conteosCiclicos.push({
        id: uid('aud'),
        timestamp: new Date().toISOString(),
        productoId: pid,
        stockSistema: r.stockActual,
        stockFisico: fis,
        discrepancia: d,
        motivo: mot,
        iraCumplido: d === 0 ? 1 : 0,
        movimientoAjusteId: movId
      });
      await Store.save();
      closeModal();
      renderAll();
      toast(d === 0 ? 'Conteo exacto' : 'Conteo guardado y ajustado', 'ok');
    };
  }

  /* ---------- 07 Configuración ---------- */
  function renderCfg() {
    const c = Store.db.config;
    $('#cfgSana').value = c.umbrales.sana;
    $('#cfgLenta').value = c.umbrales.lenta;
    $('#cfgMuyLenta').value = c.umbrales.muyLenta;
    $('#cfgEmpresa').value = c.preferenciasUI.nombreEmpresa || '';
    $('#cfgTema').value = document.documentElement.dataset.theme;
  }

  /* ---------- 08 Copias de Seguridad y Modo Viaje en el Tiempo ---------- */
  function exportJSON() {
    const a = document.createElement('a');
    const suffix = Store.isReadOnly()
      ? `_copia_${Store.activeSnapshotName.replace(/[^a-zA-Z0-9_-]/g, '_')}`
      : `_${new Date().toISOString().slice(0, 10)}`;
    a.href = URL.createObjectURL(new Blob([JSON.stringify(Store.db, null, 2)], { type: 'application/json' }));
    a.download = `inventario_completo${suffix}.json`;
    a.click();
    toast('Copia descargada', 'ok');
  }

  async function activateBackupPreview(name) {
    try {
      const raw = await window.rotastock.readBackup(name);
      const parsed = JSON.parse(raw);
      if (!Store.previewSnapshot(parsed, name)) {
        throw new Error('Estructura de copia inválida');
      }
      applyTheme();
      await listBackups(true);
      renderAll();
      toast(`Modo lectura: viendo copia ${name}`, 'ok');
    } catch (err) {
      console.error('[App] Error al abrir copia en modo lectura:', err.message);
      toast('No se pudo abrir la copia seleccionada', 'err');
    }
  }

  function exitBackupPreview() {
    if (!Store.isReadOnly()) return;
    Store.exitSnapshot();
    applyTheme();
    listBackups(true);
    renderAll();
    toast('Volviste a la base de datos actual (En vivo)', 'ok');
  }

  function confirmRestoreCurrentSnapshot() {
    if (!Store.isReadOnly()) return;
    const snapName = Store.activeSnapshotName;
    openModal(
      'Restaurar esta copia como actual',
      `<p>¿Deseas reemplazar tu inventario actual con los datos de la copia <strong>${esc(snapName)}</strong>?</p>
      <p class="muted">Antes de sobrescribir, el sistema conservará el respaldo diario automático.</p>
      <div class="form-actions"><button class="btn btn-primary" id="mConfirmRestore">Sí, restaurar como actual</button><button class="btn btn-ghost" id="mCancelRestore">Cancelar</button></div>`
    );
    $('#mCancelRestore').onclick = closeModal;
    $('#mConfirmRestore').onclick = async () => {
      await Store.restoreSnapshotAsLive();
      closeModal();
      applyTheme();
      await listBackups(true);
      renderAll();
      toast(`Copia "${snapName}" restaurada como versión actual`, 'ok');
    };
  }

  async function listBackups(silent = false) {
    const sel = $('#snapshotSelect');
    const bkContainer = $('#bkList');
    let l = [];
    if (typeof window !== 'undefined' && window.rotastock?.isElectron) {
      try {
        l = await window.rotastock.listBackups();
      } catch (err) {
        console.error('[App] Error al listar copias:', err.message);
        if (!silent) toast('Error al consultar copias automáticas', 'err');
      }
    } else if (!silent) {
      toast('Las copias automáticas de carpeta están en la versión de escritorio; puedes abrir cualquier .json con "Ver archivo .json"', 'ok');
    }

    if (sel) {
      const currentSnap = Store.activeSnapshotName;
      const isExt = currentSnap && !l.includes(currentSnap);
      sel.innerHTML =
        `<option value="__live__">🟢 Versión actual (En vivo)</option>` +
        (isExt ? `<option value="__ext__" selected>📂 ${esc(currentSnap)} (Solo lectura)</option>` : '') +
        l
          .slice(0, 30)
          .map(
            n =>
              `<option value="${esc(n)}" ${currentSnap === n ? 'selected' : ''}>🕒 ${esc(n)} (Solo lectura)</option>`
          )
          .join('') +
        `<option value="__open_file__">📂 Abrir otro archivo .json en modo lectura…</option>`;
      if (!currentSnap) sel.value = '__live__';
    }

    if (!bkContainer) return;

    const liveRow = `<div class="bk-row ${!Store.isReadOnly() ? 'active-bk' : ''}">
      <div>
        <strong>🟢 Base de datos actual (En vivo)</strong>
        <div class="muted" style="margin-top:2px;font-size:.8rem">Tus datos de trabajo del día de hoy</div>
      </div>
      <div class="bk-row-actions">
        ${
          Store.isReadOnly()
            ? `<button class="btn btn-primary" id="btnBkReturnLive" style="padding:5px 12px">Volver a versión actual</button>`
            : `<span class="badge abc">Activa ahora</span>`
        }
      </div>
    </div>`;

    const backupRows = l
      .slice(0, 25)
      .map(n => {
        const isCurrent = Store.activeSnapshotName === n;
        return `<div class="bk-row ${isCurrent ? 'active-bk' : ''}">
          <div>
            <span class="mono"><strong>${esc(n)}</strong></span>
            ${isCurrent ? `<span class="badge warn" style="margin-left:6px">Viendo en pantalla</span>` : ''}
          </div>
          <div class="bk-row-actions">
            <button class="btn ${isCurrent ? 'btn-primary' : 'btn-ghost'}" data-preview-bk="${esc(n)}" style="padding:5px 10px">
              ${isCurrent ? 'Viendo copia' : 'Ver en pantalla (Solo lectura)'}
            </button>
            <button class="btn btn-ghost" data-bk="${esc(n)}" style="padding:5px 10px">Restaurar como actual</button>
          </div>
        </div>`;
      })
      .join('');

    bkContainer.innerHTML =
      liveRow +
      (backupRows || '<p class="muted" style="margin-top:8px">No se encontraron copias automáticas previas en la carpeta backups.</p>');

    const btnLive = $('#btnBkReturnLive');
    if (btnLive) btnLive.onclick = exitBackupPreview;

    $$('#bkList [data-preview-bk]').forEach(
      b =>
        (b.onclick = () => {
          activateBackupPreview(b.dataset.previewBk);
        })
    );

    $$('#bkList [data-bk]').forEach(
      b =>
        (b.onclick = () => {
          const bkName = b.dataset.bk;
          openModal(
            'Restaurar copia como actual',
            `<p>¿Seguro que deseas reemplazar la base de datos actual con la copia <strong>${esc(bkName)}</strong>?</p>
            <p class="muted">Si solo quieres consultar los datos sin sobrescribir tu inventario actual, usa el botón <strong>"Ver en pantalla (Solo lectura)"</strong>.</p>
            <div class="form-actions"><button class="btn btn-primary" id="mDoRestore">Sí, reemplazar actual</button><button class="btn btn-ghost" id="mNoRestore">Cancelar</button></div>`
          );
          $('#mNoRestore').onclick = closeModal;
          $('#mDoRestore').onclick = async () => {
            try {
              const raw = await window.rotastock.readBackup(bkName);
              const parsed = JSON.parse(raw);
              if (!Store.isValidStructure(parsed)) {
                throw new Error('Estructura de copia inválida');
              }
              Store.liveDb = null;
              Store.activeSnapshotName = null;
              Store.db = Store.normalize(parsed);
              await Store.save();
              closeModal();
              applyTheme();
              await listBackups(true);
              renderAll();
              toast(`Copia ${bkName} restaurada como actual`, 'ok');
            } catch (err) {
              console.error('[App] Error al recuperar copia:', err.message);
              toast('No se pudo recuperar la copia seleccionada', 'err');
            }
          };
        })
    );
  }

  /* ---------- 09 Informes ---------- */
  function genXLSX() {
    try {
      const R = Engine.compute(repDays());
      const wb = buildWorkbook(R, $('#abcBase').value);
      const selVal = $('#repPeriodo')?.value;
      const periodo =
        selVal === 'custom'
          ? `${fmtD(R.start)}_a_${fmtD(R.end)}`
          : ($('#repPeriodo')?.selectedOptions[0]?.textContent || 'Periodo').replace(/\s+/g, '');
      globalThis.XLSX.writeFile(wb, `RotaStock_Informe_${periodo}_${R.end.toISOString().slice(0, 10)}.xlsx`, { cellDates: true });
      toast('Excel generado', 'ok');
    } catch (err) {
      console.error('[App] Error al generar Excel:', err.message);
      toast('No se pudo generar el archivo Excel', 'err');
    }
  }

  function genPDF() {
    try {
      const R = Engine.compute(repDays());
      const imgs = { bar: chartPNG('bar', R), donut: chartPNG('donut', R), pareto: chartPNG('pareto', R) };
      const doc = buildPdf(R, $('#abcBase').value, imgs);
      doc.save(`Informe_RotaStock_${R.end.toISOString().slice(0, 10)}.pdf`);
      toast('PDF generado', 'ok');
    } catch (err) {
      console.error('[App] Error al generar PDF:', err.message);
      toast('No se pudo generar el PDF, usa Imprimir', 'err');
    }
  }

  /* ---------- Tema ---------- */
  function applyTheme() {
    const t = Store.db.config.preferenciasUI.tema === 'claro' ? 'light' : 'dark';
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.theme = t;
    }
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('rotastock_theme', t);
      } catch (err) {
        console.warn('[App] No se pudo guardar el tema en localStorage:', err.message);
      }
    }
    const cfg = $('#cfgTema');
    if (cfg) cfg.value = t;
  }

  /* ---------- Eventos e Inicialización ---------- */
  function init() {
    $$('.nav-item').forEach(
      b =>
        (b.onclick = () => {
          $$('.nav-item').forEach(x => x.classList.remove('active'));
          b.classList.add('active');
          const targetView = b.dataset.view;
          $$('.view').forEach(v => v.classList.add('hidden'));
          $('#view-' + targetView).classList.remove('hidden');
          State.activeView = targetView;
          if (State.dirtyViews.has(targetView)) {
            renderActiveView();
          }
          if (window.innerWidth <= 900) $('#sidebar').classList.remove('open');
        })
    );

    $('#periodSelect').onchange = () => {
      State.period = resolveDashPeriod();
      State.dashPage = 1;
      renderAll();
    };
    const onDashDateChange = () => {
      if ($('#periodSelect')?.value === 'custom') {
        State.period = resolveDashPeriod();
        State.dashPage = 1;
        renderAll();
      }
    };
    if ($('#dashFrom')) $('#dashFrom').onchange = onDashDateChange;
    if ($('#dashTo')) $('#dashTo').onchange = onDashDateChange;

    if ($('#snapshotSelect')) {
      $('#snapshotSelect').onchange = async e => {
        const val = e.target.value;
        if (val === '__live__') {
          exitBackupPreview();
        } else if (val === '__open_file__') {
          $('#filePreview')?.click();
          e.target.value = Store.activeSnapshotName || '__live__';
        } else if (val !== '__ext__') {
          await activateBackupPreview(val);
        }
      };
    }

    if ($('#btnExitSnapshot')) {
      $('#btnExitSnapshot').onclick = exitBackupPreview;
    }
    if ($('#btnRestoreSnapshot')) {
      $('#btnRestoreSnapshot').onclick = confirmRestoreCurrentSnapshot;
    }
    if ($('#btnPreviewExternal')) {
      $('#btnPreviewExternal').onclick = () => $('#filePreview')?.click();
    }
    if ($('#filePreview')) {
      $('#filePreview').onchange = e => {
        const f = e.target.files[0];
        if (!f) return;
        const r = new FileReader();
        r.onload = async () => {
          try {
            const d = JSON.parse(r.result);
            if (!Store.previewSnapshot(d, f.name)) {
              throw new Error('Estructura de archivo inválida');
            }
            applyTheme();
            await listBackups(true);
            renderAll();
            toast(`Viendo archivo "${f.name}" en modo lectura`, 'ok');
          } catch (err) {
            console.warn('[App] Archivo de vista previa inválido:', err.message);
            toast('Ese archivo no es una copia válida', 'err');
          }
        };
        r.readAsText(f);
        e.target.value = '';
      };
    }

    $('#btnRefresh').onclick = () => {
      listBackups(true);
      renderAll();
      toast('Datos actualizados', 'ok');
    };
    $('#btnTheme').onclick = async () => {
      Store.db.config.preferenciasUI.tema = document.documentElement.dataset.theme === 'dark' ? 'claro' : 'oscuro';
      applyTheme();
      if (!Store.isReadOnly()) {
        await Store.save();
      }
    };
    $('#btnToggleSidebar').onclick = () => {
      document.body.classList.toggle('sidebar-closed');
    };
    $('#closeAlert').onclick = () => $('#alertBanner').classList.add('hidden');
    $('#dashSearch').oninput = () => {
      State.dashPage = 1;
      renderDash();
    };
    $$('#dashTable th').forEach(
      th =>
        (th.onclick = () => {
          const k = th.dataset.sort;
          State.dashSort = {
            k,
            dir: State.dashSort.k === k ? -State.dashSort.dir : k === 'nombre' || k === 'estadoOrden' ? 1 : -1
          };
          renderDash();
        })
    );

    $('#prodSearch').oninput = renderProds;
    $('#prodFilterEstado').onchange = renderProds;
    $('#prodSortField').onchange = e => {
      State.prodSort.f = e.target.value;
      renderProds();
    };
    $('#prodSortDir').onclick = e => {
      State.prodSort.dir *= -1;
      e.target.dataset.dir = State.prodSort.dir > 0 ? 'asc' : 'desc';
      e.target.textContent = State.prodSort.dir > 0 ? '▲ Asc' : '▼ Desc';
      renderProds();
    };

    $('#btnNuevoProducto').onclick = () => {
      if (guardWriteAction()) return;
      openModal(
        'Nuevo producto',
        `<div class="form-grid">
      <label><span class="lt">Nombre <span class="req">*</span></span><input id="nN" class="input" required maxlength="120" /></label>
      <label>Costo base<input id="nC" class="input" type="number" min="0" step="0.01" /></label>
      <label>Unidades iniciales<input id="nS" class="input" type="number" min="0" step="1" value="0" /></label>
      <label>Costo total de esas unidades<input id="nT" class="input" type="number" min="0" step="0.01" /></label>
      <label>Tiempo de entrega del proveedor (días)<input id="nLT" class="input" type="number" min="1" step="1" value="7" /></label>
      <p class="form-hint">Si pones unidades iniciales, el costo total es obligatorio.</p>
      <div class="form-actions"><button class="btn btn-primary" id="nSave">Crear</button><button class="btn btn-ghost" id="nCancel">Cancelar</button></div></div>`
      );
      $('#nCancel').onclick = closeModal;
      $('#nSave').onclick = async () => {
        const n = $('#nN').value.trim(), s = parseInt($('#nS').value || 0, 10), t = +$('#nT').value || 0;
        if (!n) {
          toast('Ponle un nombre al producto', 'err');
          return;
        }
        if (s > 0 && !(t > 0)) {
          toast('Falta el costo total de las unidades iniciales', 'err');
          return;
        }
        const id = uid('p');
        const ltVal = +$('#nLT').value;
        Store.db.productos.push({
          id,
          nombre: n,
          costoUnitario: +($('#nC').value || (s > 0 ? t / s : 0)),
          leadTime: Number.isFinite(ltVal) && ltVal >= 1 ? Math.floor(ltVal) : DEFAULT_LEAD_TIME,
          desviacionLeadTime: DEFAULT_DESV_LT,
          nivelServicioZ: DEFAULT_Z,
          creadoEn: new Date().toISOString()
        });
        if (s > 0) {
          Store.db.movimientos.push({
            id: uid('m'),
            timestamp: new Date().toISOString(),
            tipo: 'compra',
            productoId: id,
            cantidad: s,
            costoUnitario: +(t / s).toFixed(4),
            _cogs: 0,
            _ingreso: 0,
            motivoAjuste: null
          });
        }
        await Store.save();
        closeModal();
        renderAll();
        toast('Producto creado', 'ok');
      };
    };

    $('#abcBase').onchange = renderABC;
    $('#movSearch').oninput = () => {
      State.movPage = 1;
      renderMovs();
    };
    $('#movFilterTipo').onchange = () => {
      State.movPage = 1;
      renderMovs();
    };
    $('#movPeriodo').onchange = () => {
      State.movPage = 1;
      renderMovs();
    };
    const onMovDateChange = () => {
      if ($('#movPeriodo')?.value === 'custom') {
        State.movPage = 1;
        renderMovs();
      }
    };
    if ($('#movFrom')) $('#movFrom').onchange = onMovDateChange;
    if ($('#movTo')) $('#movTo').onchange = onMovDateChange;

    if ($('#repPeriodo')) {
      $('#repPeriodo').onchange = e => {
        $('#repCustomRange')?.classList.toggle('hidden', e.target.value !== 'custom');
      };
    }
    $$('#movTable th[data-sort]').forEach(
      th =>
        (th.onclick = () => {
          const k = th.dataset.sort;
          State.movSort = {
            k,
            dir: State.movSort.k === k ? -State.movSort.dir : k === 'producto' || k === 'tipo' ? 1 : -1
          };
          renderMovs();
        })
    );
    $('#btnNuevoMovimiento').onclick = () => editMov('');
    $('#btnNuevoConteo').onclick = newConteo;

    $('#configForm').onsubmit = async e => {
      e.preventDefault();
      if (guardWriteAction()) return;
      const s = +$('#cfgSana').value, l = +$('#cfgLenta').value, m = +$('#cfgMuyLenta').value;
      if (!(Number.isFinite(s) && Number.isFinite(l) && Number.isFinite(m) && s >= 0 && s <= l && l <= m)) {
        toast('Los días deben ir de menor a mayor', 'err');
        return;
      }
      Store.db.config.umbrales = { sana: s, lenta: l, muyLenta: m };
      await Store.save();
      renderAll();
      toast('Configuración guardada', 'ok');
    };

    $('#btnResetConfig').onclick = async () => {
      if (guardWriteAction()) return;
      Store.db.config.umbrales = { ...DEFAULT_UMBRALES };
      await Store.save();
      renderAll();
      toast('Valores por defecto', 'ok');
    };

    $('#bizForm').onsubmit = async e => {
      e.preventDefault();
      if (guardWriteAction()) return;
      Store.db.config.preferenciasUI.nombreEmpresa = $('#cfgEmpresa').value.trim();
      Store.db.config.preferenciasUI.tema = $('#cfgTema').value === 'light' ? 'claro' : 'oscuro';
      applyTheme();
      await Store.save();
      renderAll();
      toast('Datos guardados', 'ok');
    };

    $('#btnExport').onclick = exportJSON;
    $('#fileImport').onchange = e => {
      const f = e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = async () => {
        try {
          const d = JSON.parse(r.result);
          if (!Store.isValidStructure(d)) {
            throw new Error('Estructura de archivo inválida');
          }
          Store.liveDb = null;
          Store.activeSnapshotName = null;
          Store.db = Store.normalize(d);
          await Store.save();
          applyTheme();
          await listBackups(true);
          renderAll();
          toast('Copia cargada como versión actual', 'ok');
        } catch (err) {
          console.warn('[App] Intento de importar archivo inválido:', err.message);
          toast('Ese archivo no es una copia válida', 'err');
        }
      };
      r.readAsText(f);
      e.target.value = '';
    };

    $('#btnListBk').onclick = () => listBackups(false);
    $('#btnPDF').onclick = genPDF;
    $('#btnXLSX').onclick = genXLSX;
    $('#btnPrint').onclick = () => window.print();
    $('#modalClose').onclick = closeModal;
    $('#modalOverlay').addEventListener('click', e => {
      if (e.target.id === 'modalOverlay') closeModal();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeModal();
    });
  }

  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('DOMContentLoaded', async () => {
      await Store.load();
      initDefaultDateInputs();
      const sel = $('#periodSelect');
      if (sel) sel.value = '30';
      applyTheme();
      init();
      await listBackups(true);
      renderAll();
    });
  }

  const exportedApp = { Engine, Store, State, buildWorkbook, buildPdf };
  globalThis.App = exportedApp;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exportedApp;
  }
})();
