/* RotaStock Plus — lógica + motor FIFO (replay cronológico) */
'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const fmtN = (n, d = 2) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmt0 = n => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
const fmtF = d => new Date(d).toLocaleString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtD = d => new Date(d).toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = p => p + '_' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);

/* ---------- aviso + modal ---------- */
let toastTimer = null;
function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2800);
}
function openModal(title, html) {
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = html;
  $('#modalOverlay').classList.remove('hidden');
}
function closeModal() { $('#modalOverlay').classList.add('hidden'); }

/* ---------- Store ---------- */
const Store = {
  key: 'rotastockplus_db', db: null,
  async load() {
    if (window.rotastock?.isElectron) { try { this.db = JSON.parse(await window.rotastock.loadDB()); return this.db; } catch (e) {} }
    try { const t = localStorage.getItem(this.key); if (t) { this.db = JSON.parse(t); return this.db; } } catch (e) {}
    const r = await fetch('../datos/inventario.json').catch(() => fetch('datos/inventario.json'));
    if (r?.ok) { this.db = await r.json(); return this.db; }
    this.db = { meta: { sistema: 'RotaStock Plus', versionEsquema: '2.0.0', createdAt: new Date().toISOString() }, config: { metodoCosteo: 'FIFO', umbrales: { sana: 7, lenta: 15, muyLenta: 30 }, preferenciasUI: { tema: 'oscuro', autoBackupMinutos: 1, nombreEmpresa: 'Mi negocio' } }, productos: [], movimientos: [], conteosCiclicos: [] };
    return this.db;
  },
  async save() {
    this.db.meta.totalProductos = this.db.productos.length;
    this.db.meta.totalMovimientos = this.db.movimientos.length;
    const t = JSON.stringify(this.db, null, 2);
    if (window.rotastock?.isElectron) { try { await window.rotastock.saveDB(t); } catch (e) {} }
    try { localStorage.setItem(this.key, t); } catch (e) {}
  }
};

/* ---------- Motor FIFO ---------- */
const Engine = {
  range(days) {
    const end = new Date();
    let start;
    if (days === 'hoy') { start = new Date(); start.setHours(0, 0, 0, 0); }
    else if (!days) {
      const all = Store.db.movimientos.map(m => new Date(m.timestamp).getTime());
      start = new Date(all.length ? Math.min(...all) : Date.now());
    } else start = new Date(end.getTime() - days * 864e5);
    return { start, end, days: Math.max(1, Math.floor((end - start) / 864e5)) };
  },
  compute(days) {
    const db = Store.db;
    const { start, end, days: delta } = this.range(days);
    const th = db.config.umbrales;
    const movs = [...db.movimientos].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp) || String(a.id).localeCompare(String(b.id)));
    const lots = {}, snap = {}, lastCost = {}, stock = {}, valor = {};
    db.productos.forEach(p => { lots[p.id] = []; snap[p.id] = []; stock[p.id] = 0; valor[p.id] = 0; lastCost[p.id] = 0; });
    const per = {}; db.productos.forEach(p => per[p.id] = { cogs: 0, ing: 0 });
    const perQ = {}; db.productos.forEach(p => perQ[p.id] = { compra: 0, venta: 0 });
    const lastMov = {};
    for (const m of movs) {
      if (!lots[m.productoId]) continue;
      const t = new Date(m.timestamp);
      if (m.tipo === 'compra' || m.tipo === 'ajuste_excedente') {
        lots[m.productoId].push({ remaining: m.cantidad, costo: m.costoUnitario, fecha: t, movId: m.id });
        lastCost[m.productoId] = m.costoUnitario; m._cogs = 0; m._ingreso = 0;
        if (t >= start && t <= end) perQ[m.productoId].compra += m.cantidad;
      } else {
        let pend = m.cantidad, cogs = 0;
        while (pend > 1e-9 && lots[m.productoId].length) {
          const L = lots[m.productoId][0], take = Math.min(L.remaining, pend);
          cogs += take * L.costo; L.remaining -= take; pend -= take;
          if (L.remaining <= 1e-9) lots[m.productoId].shift();
        }
        if (pend > 1e-9) cogs += pend * (lastCost[m.productoId] || 0);
        m._cogs = +cogs.toFixed(2); m._ingreso = +(m.cantidad * m.costoUnitario).toFixed(2);
        if (t >= start && t <= end) { per[m.productoId].cogs += m._cogs; per[m.productoId].ing += m._ingreso; }
        if (t >= start && t <= end) perQ[m.productoId].venta += m.cantidad;
      }
      stock[m.productoId] = lots[m.productoId].reduce((s, l) => s + l.remaining, 0);
      valor[m.productoId] = lots[m.productoId].reduce((s, l) => s + l.remaining * l.costo, 0);
      snap[m.productoId].push({ fecha: t, qty: stock[m.productoId], val: valor[m.productoId] });
      lastMov[m.productoId] = t;
    }
    const valAt = (pid, t, key) => { let v = 0; for (const x of snap[pid]) { if (x.fecha <= t) v = x[key]; else break; } return v; };
    const rows = db.productos.map(p => {
      const invFinVal = valor[p.id] || 0, invIniVal = valAt(p.id, start, 'val');
      const invFinQty = stock[p.id] || 0, invIniQty = valAt(p.id, start, 'qty');
      const invPromVal = (invIniVal + invFinVal) / 2, invPromQty = (invIniQty + invFinQty) / 2;
      const cogs = per[p.id].cogs, ingresos = per[p.id].ing;
      const rotacion = invPromVal > 0 ? cogs / invPromVal : 0;
      const cogsPerDay = cogs / delta;
      const cobertura = cogsPerDay > 0 ? invFinVal / cogsPerDay : null;
      const diasSinMov = lastMov[p.id] ? Math.max(0, Math.floor((end - lastMov[p.id]) / 864e5)) : null;
      const estado = diasSinMov === null ? 'sinDatos' : diasSinMov <= th.sana ? 'sana' : diasSinMov <= th.lenta ? 'lenta' : diasSinMov <= th.muyLenta ? 'muyLenta' : 'dormido';
      return { ...p, cogs, ingresos, ganancia: ingresos - cogs, stockActual: stock[p.id] || 0, valorInventario: invFinVal, invPromVal, invPromQty, rotacion, cobertura, diasSinMov, estado, entradasPer: perQ[p.id].compra, salidasPer: perQ[p.id].venta };
    });
    const capas = {};
    db.productos.forEach(p => { capas[p.id] = lots[p.id].filter(l => l.remaining > 1e-9).map((l, i) => ({ n: i + 1, qty: l.remaining, costo: l.costo, fecha: l.fecha })); });
    const totCogs = rows.reduce((s, r) => s + r.cogs, 0), totIng = rows.reduce((s, r) => s + r.ingresos, 0);
    const totVal = rows.reduce((s, r) => s + r.valorInventario, 0);
    const dio = totCogs > 0 ? totVal / (totCogs / delta) : null;
    return { rows, start, end, delta, totCogs, totIng, totGan: totIng - totCogs, totVal, dio, dorm: rows.filter(r => r.estado === 'dormido').length, capas };
  },
  abc(base = 'valor') {
    const { rows } = this.compute(0);
    const vals = rows.map(r => ({ r, v: base === 'valor' ? r.valorInventario : r.cogs + (r.cogs === 0 ? r.valorInventario * 0.001 : 0) }));
    const tot = vals.reduce((s, x) => s + x.v, 0) || 1;
    vals.sort((a, b) => b.v - a.v);
    vals.forEach(x => { x.pi = x.v / tot * 100; });
    // Asignador heurístico por proximidad (tolerancia al error):
    // si un producto cruza un umbral, se queda en la clase superior solo si
    // está más cerca de la meta incluyéndolo que excluyéndolo; el empate promueve.
    const UMB = [80, 95], CLS = ['A', 'B', 'C'];
    const decide = (antes, despues, obj) => (despues - obj) <= (obj - antes) ? 0 : 1;
    let acc = 0;
    for (const x of vals) {
      const antes = acc, despues = acc + x.pi;
      let idx;
      if (despues <= UMB[0]) idx = 0;
      else if (despues <= UMB[1]) idx = antes < UMB[0] ? decide(antes, despues, UMB[0]) : 1;
      else if (antes < UMB[0]) idx = decide(antes, despues, UMB[0]) === 0 ? 0 : (decide(antes, despues, UMB[1]) === 0 ? 1 : 2);
      else if (antes < UMB[1]) idx = decide(antes, despues, UMB[1]) === 0 ? 1 : 2;
      else idx = 2;
      x.abc = CLS[idx]; x.pa = despues; acc = despues;
      const cv = this.cv(x.r.id);
      x.cv = cv; x.xyz = cv <= 0.2 ? 'X' : cv <= 0.5 ? 'Y' : 'Z';
    }
    return vals;
  },
  cv(pid) {
    const ds = {};
    for (const m of Store.db.movimientos) if (m.productoId === pid && m.tipo === 'venta') { const k = m.timestamp.slice(0, 7); ds[k] = (ds[k] || 0) + m.cantidad; }
    const v = Object.values(ds); if (v.length < 2) return 0;
    const mu = v.reduce((a, b) => a + b, 0) / v.length; if (!mu) return 9;
    return Math.sqrt(v.reduce((a, b) => a + (b - mu) ** 2, 0) / v.length) / mu;
  },
  reabastecimiento() {
    const alfa = 0.3, { rows } = this.compute(0);
    return rows.map(r => {
      const byM = {};
      for (const m of Store.db.movimientos) if (m.productoId === r.id && m.tipo === 'venta') { const k = m.timestamp.slice(0, 7); byM[k] = (byM[k] || 0) + m.cantidad; }
      const dem = Object.keys(byM).sort().map(k => byM[k]);
      let F = dem[0] || 0; for (let i = 1; i < dem.length; i++) F = alfa * dem[i] + (1 - alfa) * F;
      const dBar = dem.reduce((a, b) => a + b, 0) / Math.max(1, dem.length) / 30;
      const sdD = dem.length > 1 ? Math.sqrt(dem.map(x => x / 30).reduce((a, b) => a + (b - dBar) ** 2, 0) / dem.length) : dBar * 0.3;
      const LT = r.leadTime || 7, sLT = r.desviacionLeadTime || 1, Z = r.nivelServicioZ || 1.65;
      const SS = Z * Math.sqrt(Math.max(0, LT * sdD * sdD + dBar * dBar * sLT * sLT));
      const PRO = dBar * LT + SS;
      return { ...r, dBar, pron: dem.length ? F : 0, SS, PRO, sug: Math.max(0, Math.ceil(PRO - r.stockActual)), alerta: r.stockActual <= PRO };
    });
  }
};

/* ---------- estado UI ---------- */
let PERIOD = 30, COMP = null, DASHPAGE = 1, MOVPAGE = 1;
let DASHSORT = { k: 'diasSinMov', dir: -1 }, MOVSORT = { k: 'fecha', dir: -1 };
let PRODSORT = { f: 'nombre', dir: 1 };
const EST_LBL = { sana: 'Rotación Sana', lenta: 'Rotación Lenta', muyLenta: 'Rotación Muy Lenta', dormido: 'Inventario Dormido', sinDatos: 'Sin datos' };
const pill = e => e === 'sinDatos' ? '<span class="pill">Sin datos</span>' : `<span class="pill ${e}">${EST_LBL[e]}</span>`;
const charts = {};
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

function styleCharts() {
  if (!window.Chart) return;
  Chart.defaults.color = css('--muted');
  Chart.defaults.borderColor = css('--grid');
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
}

/* ---------- render general ---------- */
async function renderAll() {
  COMP = Engine.compute(PERIOD);
  styleCharts();
  $('#periodCaption').textContent = `Del ${fmtD(COMP.start)} al ${fmtD(COMP.end)} · ${COMP.rows.length} productos · ${Store.db.movimientos.length} movimientos`;
  $('#sideEmp').textContent = Store.db.config.preferenciasUI.nombreEmpresa || 'Mi negocio';
  $('#sideStats').textContent = `${COMP.rows.length} productos · ${Store.db.movimientos.length} mov.`;
  renderDash(); renderProds(); renderABC(); renderMovs(); renderReab(); renderAud(); renderCfg();
}

/* ---------- 01 panel ---------- */
function renderDash() {
  const banner = $('#alertBanner');
  if (COMP.dorm > 0) {
    banner.classList.remove('hidden');
    const val = COMP.rows.filter(r => r.estado === 'dormido').reduce((s, r) => s + r.valorInventario, 0);
    $('#alertText').innerHTML = `<strong>Atención:</strong> ${COMP.dorm} producto(s) llevan más de ${Store.db.config.umbrales.muyLenta} días sin moverse. Dinero detenido: <strong>$${fmtN(val)}</strong>.`;
  } else banner.classList.add('hidden');
  $('#kpiDias').textContent = COMP.dio !== null ? fmtN(COMP.dio, 1) : '—';
  $('#kpiDiasSub').textContent = COMP.dio !== null ? `días · período de ${COMP.delta} días` : 'sin ventas en el período';
  $('#kpiCogs').textContent = '$' + fmtN(COMP.totCogs, 0);
  $('#kpiCogsSub').textContent = COMP.totIng ? fmtN(COMP.totCogs / COMP.totIng * 100, 1) + '% de lo vendido' : 'sin ventas en el período';
  $('#kpiIngresos').textContent = '$' + fmtN(COMP.totIng, 0);
  $('#kpiIngresosSub').textContent = 'ventas del período';
  $('#kpiGanancia').textContent = '$' + fmtN(COMP.totGan, 0);
  $('#kpiGananciaSub').textContent = COMP.totIng ? fmtN(COMP.totGan / COMP.totIng * 100, 1) + '% de margen' : '—';
  $('#kpiAlertas').textContent = COMP.dorm;
  $('#kpiAlertasSub').textContent = 'productos dormidos';

  const top = [...COMP.rows].sort((a, b) => b.ingresos - a.ingresos).slice(0, 8);
  if (charts.bar) charts.bar.destroy();
  charts.bar = new Chart($('#chartBar'), { type: 'bar',
    data: { labels: top.map(r => r.nombre.length > 18 ? r.nombre.slice(0, 17) + '…' : r.nombre),
      datasets: [{ label: 'Ingresos', data: top.map(r => +r.ingresos.toFixed(2)), backgroundColor: css('--chart-1'), borderRadius: 3 }, { label: 'COGS', data: top.map(r => +r.cogs.toFixed(2)), backgroundColor: css('--chart-2'), borderRadius: 3 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: c => `${c.dataset.label}: $${Number(c.raw).toLocaleString('en-US', { minimumFractionDigits: 2 })}` } } }, scales: { x: { grid: { color: css('--grid') } }, y: { grid: { color: css('--grid') }, ticks: { callback: v => '$' + Number(v).toLocaleString('en-US') } } } } });
  const dist = [['sana', 'Sana'], ['lenta', 'Lenta'], ['muyLenta', 'Muy lenta'], ['dormido', 'Dormido']]
    .map(([k, l]) => ({ k, l, v: COMP.rows.filter(r => r.estado === k).length }));
  if (charts.donut) charts.donut.destroy();
  charts.donut = new Chart($('#chartDonut'), { type: 'doughnut',
    data: { labels: dist.map(d => d.l), datasets: [{ data: dist.map(d => d.v), backgroundColor: [css('--sana'), css('--lenta'), css('--muyLenta'), css('--dormido')], borderColor: css('--surface'), borderWidth: 2 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'bottom' } } } });
  $('#donutLegend').innerHTML = dist.map(d => `<div class="lrow"><span><i class="dot ${d.k}"></i>${d.l}</span><b>${d.v}</b></div>`).join('');

  const q = ($('#dashSearch').value || '').toLowerCase();
  const val = { nombre: r => r.nombre.toLowerCase(), invProm: r => r.invPromQty, rotacion: r => r.rotacion, cobertura: r => (r.cobertura ?? -1), diasSinMov: r => (r.diasSinMov ?? 1e12), estadoOrden: r => ({ sinDatos: -1, sana: 0, lenta: 1, muyLenta: 2, dormido: 3 }[r.estado]) };
  let rows = COMP.rows.filter(r => r.nombre.toLowerCase().includes(q));
  rows.sort((a, b) => { const x = val[DASHSORT.k](a), y = val[DASHSORT.k](b); return (x > y ? 1 : x < y ? -1 : 0) * DASHSORT.dir; });
  $$('#dashTable th').forEach(th => { th.classList.remove('sorted', 'desc'); if (th.dataset.sort === DASHSORT.k) { th.classList.add('sorted'); if (DASHSORT.dir < 0) th.classList.add('desc'); } });
  const per = 8, pages = Math.max(1, Math.ceil(rows.length / per));
  DASHPAGE = Math.min(DASHPAGE, pages);
  const s = rows.slice((DASHPAGE - 1) * per, DASHPAGE * per);
  $('#dashTable tbody').innerHTML = s.map(r => `<tr><td>${esc(r.nombre)}</td>
    <td class="num">${fmtN(r.invPromQty, 1)}</td><td class="num">${fmtN(r.rotacion, 2)}×</td>
    <td class="num">${r.cobertura !== null ? fmtN(r.cobertura, 1) : '—'}</td>
    <td class="num">${r.diasSinMov !== null ? r.diasSinMov : '—'}</td>
    <td>${pill(r.estado)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Sin productos.</td></tr>';
  $('#dashPager').innerHTML = `<span class="pinfo">Mostrando ${s.length} de ${rows.length} · pág. ${DASHPAGE}/${pages}</span>` +
    Array.from({ length: pages }, (_, i) => `<button class="${i + 1 === DASHPAGE ? 'active' : ''}" data-pg="${i + 1}">${i + 1}</button>`).join('');
  $$('#dashPager button').forEach(b => b.onclick = () => { DASHPAGE = +b.dataset.pg; renderDash(); });
}

/* ---------- 02 productos ---------- */
function renderProds() {
  const q = ($('#prodSearch').value || '').toLowerCase(), fe = $('#prodFilterEstado').value;
  const key = { nombre: 'nombre', rotacion: 'rotacion', cogs: 'cogs', ingresos: 'ingresos', ganancia: 'ganancia', cobertura: 'cobertura', diasSinMov: 'diasSinMov' }[PRODSORT.f];
  let rows = COMP.rows.filter(r => r.nombre.toLowerCase().includes(q) && (!fe || r.estado === fe));
  rows.sort((a, b) => {
    let va = a[key], vb = b[key];
    if (typeof va === 'string') return PRODSORT.dir > 0 ? va.localeCompare(vb) : vb.localeCompare(va);
    va = va ?? -1; vb = vb ?? -1;
    return PRODSORT.dir > 0 ? va - vb : vb - va;
  });
  $('#productGrid').innerHTML = rows.map(r => `<div class="prod-card">
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
  </div>`).join('') || '<div class="empty">Sin productos. Crea el primero con “Nuevo producto”.</div>';
  $$('#productGrid [data-edit]').forEach(b => b.onclick = () => editProd(b.dataset.edit));
  $$('#productGrid [data-del]').forEach(b => b.onclick = () => delProd(b.dataset.del));
}
function editProd(id) {
  const p = Store.db.productos.find(x => x.id === id);
  openModal('Editar producto', `<div class="form-grid">
    <label>Nombre<input id="mNombre" class="input" value="${esc(p.nombre)}" /></label>
    <label>Tiempo de entrega del proveedor (días)<input id="mLT" class="input" type="number" min="1" value="${p.leadTime ?? 7}" /></label>
    <label>Margen de seguridad<select id="mZ" class="input"><option value="1.65" ${(p.nivelServicioZ ?? 1.65) >= 1.65 ? 'selected' : ''}>Alto</option><option value="1.28" ${p.nivelServicioZ === 1.28 ? 'selected' : ''}>Normal</option><option value="1.04" ${p.nivelServicioZ === 1.04 ? 'selected' : ''}>Bajo</option></select></label>
    <label>Costo base<input id="mC" class="input" type="number" min="0" step="0.01" value="${p.costoUnitario ?? 0}" /></label>
    <div class="form-actions"><button class="btn btn-primary" id="mSave">Guardar</button><button class="btn btn-ghost" id="mCancel">Cancelar</button></div></div>`);
  $('#mCancel').onclick = closeModal;
  $('#mSave').onclick = async () => {
    p.nombre = $('#mNombre').value.trim() || p.nombre;
    p.leadTime = +$('#mLT').value || 7; p.nivelServicioZ = +$('#mZ').value; p.costoUnitario = +$('#mC').value || p.costoUnitario;
    await Store.save(); closeModal(); renderAll(); toast('Producto actualizado', 'ok');
  };
}
function delProd(id) {
  const p = Store.db.productos.find(x => x.id === id);
  const n = Store.db.movimientos.filter(m => m.productoId === id).length;
  openModal('Eliminar producto', `<p>Se eliminará <strong>${esc(p.nombre)}</strong> con sus <strong>${n}</strong> movimientos y todo se recalculará. ¿Continuar?</p>
    <div class="form-actions"><button class="btn btn-danger" id="mDel">Sí, eliminar</button><button class="btn btn-ghost" id="mCancel">Cancelar</button></div>`);
  $('#mCancel').onclick = closeModal;
  $('#mDel').onclick = async () => {
    Store.db.productos = Store.db.productos.filter(x => x.id !== id);
    Store.db.movimientos = Store.db.movimientos.filter(m => m.productoId !== id);
    await Store.save(); closeModal(); renderAll(); toast('Producto eliminado', 'ok');
  };
}

/* ---------- 03 clasificación ---------- */
function renderABC() {
  const base = $('#abcBase').value, data = Engine.abc(base);
  const tot = data.reduce((s, d) => s + d.v, 0) || 1;
  const baseName = base === 'valor' ? 'Dinero en stock' : 'COGS';
  $('#abcBaseHead').textContent = baseName;
  $('#abcInfo').textContent = `${data.length} productos clasificados`;
  const groups = ['A', 'B', 'C'].map(g => {
    const items = data.filter(d => d.abc === g);
    return { g, items, share: items.reduce((s, d) => s + d.v, 0) / tot * 100 };
  });
  $('#abcCats').innerHTML = groups.map(g => `<div class="abc-cat ${g.g}">
    <div class="abc-cat-t">Categoría ${g.g}</div>
    <div class="muted">Productos: <strong style="color:var(--text)">${g.items.length}</strong> (${fmtN(g.items.length / data.length * 100, 2)}% del total)</div>
    <div class="muted">${baseName}: <strong style="color:var(--text)">${fmtN(g.share, 2)}%</strong> del total</div>
  </div>`).join('');
  const col = { A: css('--dormido'), B: css('--lenta'), C: css('--sana') };
  const lineCol = css('--text');
  if (charts.pareto) charts.pareto.destroy();
  charts.pareto = new Chart($('#chartPareto'), { type: 'bar',
    data: { labels: data.map(d => d.r.nombre.length > 16 ? d.r.nombre.slice(0, 15) + '…' : d.r.nombre),
      datasets: [{ type: 'bar', label: baseName, data: data.map(d => +d.v.toFixed(2)), backgroundColor: data.map(d => col[d.abc]), borderRadius: 3 },
        { type: 'line', label: '% acumulado', data: data.map(d => +d.pa.toFixed(1)), borderColor: lineCol, pointBackgroundColor: lineCol, yAxisID: 'y1', tension: 0.2 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { x: { grid: { color: css('--grid') } }, y: { grid: { color: css('--grid') }, ticks: { callback: v => '$' + Number(v).toLocaleString('en-US') } }, y1: { position: 'right', min: 0, max: 100, ticks: { callback: v => v + '%' }, grid: { drawOnChartArea: false } } } } });
  $('#paretoChips').innerHTML = [['A', 'Grupo A — lo más importante'], ['B', 'Grupo B — intermedio'], ['C', 'Grupo C — lo de menor peso']]
    .map(([g, l]) => `<span><i class="dot" style="color:${col[g]}"></i>${l}</span>`).join('');
  const xyzLbl = { X: 'Estable', Y: 'Variable', Z: 'Irregular' };
  const xyzCls = { X: 'abc', Y: 'warn', Z: 'bad' };
  const grpCls = { A: 'bad', B: 'warn', C: 'abc' };
  $('#abcTable tbody').innerHTML = data.map(d => `<tr><td><strong>${esc(d.r.nombre)}</strong></td>
    <td class="num">$${fmtN(d.v)}</td>
    <td class="num">${fmtN(d.pi, 1)}%</td><td class="num">${fmtN(d.pa, 1)}%</td>
    <td><span class="badge ${grpCls[d.abc]}">Grupo ${d.abc}</span></td><td class="num">${fmtN(d.cv, 2)}</td>
    <td><span class="badge ${xyzCls[d.xyz]}">${xyzLbl[d.xyz]}</span></td>
    <td>${d.abc === 'A' ? 'Cada 30 días' : d.abc === 'B' ? 'Cada 60 días' : 'Cada 120 días'}</td></tr>`).join('');
}

/* ---------- 04 movimientos ---------- */
function renderMovs() {
  const q = ($('#movSearch').value || '').toLowerCase(), f = $('#movFilterTipo').value;
  const names = Object.fromEntries(Store.db.productos.map(p => [p.id, p.nombre]));
  const pr = $('#movPeriodo').value;
  let desde = 0;
  if (pr === 'hoy') { const d = new Date(); d.setHours(0, 0, 0, 0); desde = d.getTime(); }
  else if (pr !== 'siempre') desde = Date.now() - (+pr) * 864e5;
  let rows = [...Store.db.movimientos]
    .filter(m => (names[m.productoId] || '').toLowerCase().includes(q) && (!f || m.tipo === f || (f === 'compra' && m.tipo === 'ajuste_excedente')) && new Date(m.timestamp).getTime() >= desde)
    .map(m => ({ ...m, producto: names[m.productoId] || '(eliminado)', fecha: new Date(m.timestamp).getTime() }));
  rows.sort((a, b) => { const x = a[MOVSORT.k], y = b[MOVSORT.k]; return (x > y ? 1 : x < y ? -1 : 0) * MOVSORT.dir; });
  $$('#movTable th').forEach(th => { th.classList.remove('sorted', 'desc'); if (th.dataset.sort === MOVSORT.k) { th.classList.add('sorted'); if (MOVSORT.dir < 0) th.classList.add('desc'); } });
  $('#movCount').textContent = `· ${rows.length} registros`;
  const per = 10, pages = Math.max(1, Math.ceil(rows.length / per));
  MOVPAGE = Math.min(MOVPAGE, pages);
  const s = rows.slice((MOVPAGE - 1) * per, MOVPAGE * per);
  $('#movTable tbody').innerHTML = s.map(m => `<tr><td>${fmtF(m.timestamp)}</td><td>${esc(m.producto)}</td>
    <td><span class="badge ${m.tipo === 'venta' ? 'venta' : 'compra'}">${m.tipo === 'venta' ? 'Venta' : 'Compra'}</span>${m.motivoAjuste ? `<br><small class="muted">${esc(m.motivoAjuste)}</small>` : ''}</td>
    <td class="num">${fmt0(m.cantidad)}</td><td class="num">$${fmtN(m.costoUnitario)}</td><td class="num">$${fmtN(m.cantidad * m.costoUnitario)}</td>
    <td><button class="icon-btn" data-emov="${m.id}" title="Editar"><svg class="i"><use href="#i-edit"/></svg></button><button class="icon-btn" data-dmov="${m.id}" title="Eliminar"><svg class="i"><use href="#i-trash"/></svg></button></td></tr>`).join('') || '<tr><td colspan="7" class="muted">Sin movimientos.</td></tr>';
  $('#movPager').innerHTML = `<span class="pinfo">Pág. ${MOVPAGE}/${pages} · ${rows.length} registros</span>` +
    Array.from({ length: Math.min(pages, 9) }, (_, i) => `<button class="${i + 1 === MOVPAGE ? 'active' : ''}" data-pg="${i + 1}">${i + 1}</button>`).join('');
  $$('#movPager button').forEach(b => b.onclick = () => { MOVPAGE = +b.dataset.pg; renderMovs(); });
  $$('#movTable [data-emov]').forEach(b => b.onclick = () => editMov(b.dataset.emov));
  $$('#movTable [data-dmov]').forEach(b => b.onclick = async () => {
    Store.db.movimientos = Store.db.movimientos.filter(x => x.id !== b.dataset.dmov);
    await Store.save(); renderAll(); toast('Movimiento eliminado', 'ok');
  });
}
function editMov(id) {
  const m = id ? Store.db.movimientos.find(x => x.id === id) : null;
  const prods = Store.db.productos;
  openModal(id ? 'Editar movimiento' : 'Registrar movimiento', `<div class="form-grid">
    <label>Producto<div class="form-group"><input id="mProdTxt" class="input" autocomplete="off" value="${m ? esc(prods.find(p => p.id === m.productoId)?.nombre || '') : ''}" placeholder="Escribe para buscar…" /><div class="autocomplete-list hidden" id="mProdList"></div></div></label>
    <label>Tipo<select id="mTipo" class="input"><option value="compra" ${m?.tipo === 'compra' ? 'selected' : ''}>Compra (entra)</option><option value="venta" ${!m || m?.tipo === 'venta' ? 'selected' : ''}>Venta (sale)</option></select></label>
    <label>Fecha y hora<input id="mFec" class="input" type="datetime-local" value="${m ? m.timestamp.slice(0, 16) : new Date().toISOString().slice(0, 16)}" /></label>
    <label>Cantidad<input id="mCant" class="input" type="number" min="1" step="1" value="${m?.cantidad || 1}" /></label>
    <label id="mCostLbl">Precio de venta<input id="mCost" class="input" type="number" min="0" step="0.01" value="${m?.costoUnitario || 0}" /></label>
    <div class="form-actions"><button class="btn btn-primary" id="mSave">Guardar</button><button class="btn btn-ghost" id="mCancel">Cancelar</button></div></div>`);
  let selId = m?.productoId || '';
  const txt = $('#mProdTxt'), list = $('#mProdList');
  const paint = v => { list.innerHTML = prods.filter(p => p.nombre.toLowerCase().includes(v.toLowerCase())).slice(0, 8).map(p => `<div data-pid="${p.id}">${esc(p.nombre)}</div>`).join(''); list.classList.remove('hidden');
    $$('#mProdList [data-pid]').forEach(d => d.onmousedown = () => { selId = d.dataset.pid; txt.value = d.textContent; list.classList.add('hidden'); }); };
  txt.onfocus = () => paint(txt.value); txt.oninput = () => { selId = ''; paint(txt.value); }; txt.onblur = () => setTimeout(() => list.classList.add('hidden'), 150);
  const lbl = () => $('#mCostLbl').firstChild.textContent = $('#mTipo').value === 'compra' ? 'Costo de compra' : 'Precio de venta';
  $('#mTipo').onchange = lbl; lbl();
  $('#mCancel').onclick = closeModal;
  $('#mSave').onclick = async () => {
    const tipo = $('#mTipo').value, cant = parseInt($('#mCant').value), cu = +$('#mCost').value;
    const ts = new Date($('#mFec').value); if (!selId || !(cant >= 1) || !(cu >= 0) || isNaN(ts)) { toast('Revisa los datos ingresados', 'err'); return; }
    if (tipo === 'venta') {
      const r = Engine.compute(0).rows.find(x => x.id === selId);
      let disp = r ? r.stockActual : 0;
      if (m?.tipo === 'venta' && m.productoId === selId) disp += m.cantidad;
      if (m?.tipo === 'compra' && m.productoId === selId) disp -= m.cantidad;
      if (cant > disp + 1e-9) { toast(`Stock insuficiente: disponible ${fmt0(Math.max(0, disp))} unidad(es).`, 'err'); return; }
    }
    if (m) Object.assign(m, { productoId: selId, tipo, cantidad: cant, costoUnitario: cu, timestamp: ts.toISOString() });
    else Store.db.movimientos.push({ id: uid('m'), timestamp: ts.toISOString(), tipo, productoId: selId, cantidad: cant, costoUnitario: cu, _cogs: 0, _ingreso: 0, motivoAjuste: null });
    await Store.save(); closeModal(); renderAll(); toast('Movimiento guardado', 'ok');
  };
}

/* ---------- 05 qué comprar ---------- */
function renderReab() {
  const data = Engine.reabastecimiento().sort((a, b) => (b.alerta - a.alerta) || (a.stockActual - a.PRO) - (b.stockActual - b.PRO));
  const al = data.filter(d => d.alerta);
  $('#reabAlert').innerHTML = al.length
    ? `<div class="alert-banner"><span id="alertText"><strong>Hay que comprar:</strong> ${al.length} producto(s) están en nivel bajo. Total sugerido: <strong>${fmt0(al.reduce((s, d) => s + d.sug, 0))} uds.</strong></span></div>`
    : `<div class="alert-banner ok"><span id="alertText"><strong>Todo bien:</strong> ningún producto necesita compra por ahora.</span></div>`;
  $('#reabInfo').textContent = `· ${al.length} por comprar`;
  $('#reabTable tbody').innerHTML = data.map(d => `<tr><td><strong>${esc(d.nombre)}</strong><br><small class="muted">El proveedor tarda ~${d.leadTime} días</small></td>
    <td class="num">${fmt0(d.stockActual)}</td><td class="num">${fmtN(d.dBar, 1)}</td><td class="num">${fmtN(d.pron, 0)} al mes</td>
    <td class="num">${fmtN(d.SS, 0)}</td><td class="num">${fmtN(d.PRO, 0)}</td><td class="num"><strong>${fmt0(d.sug)}</strong></td>
    <td>${d.alerta ? '<span class="badge bad">Comprar</span>' : '<span class="badge abc">Bien</span>'}</td></tr>`).join('');
}

/* ---------- 06 conteos ---------- */
function renderAud() {
  const list = Store.db.conteosCiclicos || [];
  const ira = list.length ? list.filter(c => c.discrepancia === 0).length / list.length * 100 : 100;
  $('#iraKpis').innerHTML = `
    <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Exactitud de conteos</span></div><span class="kpi-value">${fmtN(ira, 1)}%</span><span class="kpi-sub">${list.length} conteos realizados</span></div>
    <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Faltantes</span></div><span class="kpi-value">${fmt0(list.filter(c => c.discrepancia < 0).reduce((s, c) => s + c.discrepancia, 0))}</span><span class="kpi-sub">unidades que faltaron</span></div>
    <div class="kpi-card"><div class="kpi-top"><span class="kpi-label">Sobrantes</span></div><span class="kpi-value">+${fmt0(list.filter(c => c.discrepancia > 0).reduce((s, c) => s + c.discrepancia, 0))}</span><span class="kpi-sub">unidades de más</span></div>`;
  const names = Object.fromEntries(Store.db.productos.map(p => [p.id, p.nombre]));
  $('#audTable tbody').innerHTML = [...list].reverse().map(c => `<tr><td>${fmtF(c.timestamp)}</td><td>${esc(names[c.productoId] || '(eliminado)')}</td>
    <td class="num">${fmt0(c.stockSistema)}</td><td class="num">${fmt0(c.stockFisico)}</td>
    <td class="num"><strong style="color:var(--${c.discrepancia === 0 ? 'sana' : 'dormido'})">${c.discrepancia > 0 ? '+' : ''}${fmt0(c.discrepancia)}</strong></td>
    <td>${esc(c.motivo || '—')}</td><td class="mono" style="font-size:.76rem">${c.movimientoAjusteId ? 'Ajustado' : 'Sin diferencia'}</td>
    <td><button class="icon-btn" data-econteo="${c.id}" title="Editar"><svg class="i"><use href="#i-edit"/></svg></button><button class="icon-btn" data-rconteo="${c.id}" title="Revertir (como si nunca hubiera existido)"><svg class="i"><use href="#i-trash"/></svg></button></td></tr>`).join('') || '<tr><td colspan="8" class="muted">Aún no hay conteos.</td></tr>';
  $$('#audTable [data-econteo]').forEach(b => b.onclick = () => editConteo(b.dataset.econteo));
  $$('#audTable [data-rconteo]').forEach(b => b.onclick = () => revertConteo(b.dataset.rconteo));
}
/* Stock del sistema sin contar el ajuste que generó este conteo */
function sysSinAjuste(c) {
  const r = Engine.compute(0).rows.find(x => x.id === c.productoId);
  return r ? r.stockActual - c.discrepancia : 0;
}
function editConteo(id) {
  const c = Store.db.conteosCiclicos.find(x => x.id === id);
  if (!c) return;
  const nombre = (Store.db.productos.find(p => p.id === c.productoId) || {}).nombre || '(eliminado)';
  const sys = sysSinAjuste(c);
  openModal('Editar conteo', `<div class="form-grid">
    <label>Producto<input class="input" disabled value="${esc(nombre)}" /></label>
    <label>Sistema actual (sin este ajuste)<input class="input" disabled value="${sys} uds." /></label>
    <label>Lo contado en físico<input id="eFis" class="input" type="number" min="0" step="1" value="${c.stockFisico}" /></label>
    <label>Motivo de la diferencia<input id="eMot" class="input" value="${esc(c.motivo || '')}" /></label>
    <div class="form-actions"><button class="btn btn-primary" id="eSave">Guardar</button><button class="btn btn-ghost" id="eCancel">Cancelar</button></div>
    <p class="muted">Al guardar se rehace el ajuste con la nueva diferencia.</p></div>`);
  $('#eCancel').onclick = closeModal;
  $('#eSave').onclick = async () => {
    const fis = parseInt($('#eFis').value), mot = $('#eMot').value.trim() || 'Ajuste de conteo';
    if (!(fis >= 0)) { toast('Ingresa lo contado en físico', 'err'); return; }
    if (c.movimientoAjusteId) Store.db.movimientos = Store.db.movimientos.filter(m => m.id !== c.movimientoAjusteId);
    const r = Engine.compute(0).rows.find(x => x.id === c.productoId);
    const sysClean = r ? r.stockActual : 0;
    const d = fis - sysClean; let movId = null;
    if (d !== 0) {
      const costo = sysClean > 0 ? (r.valorInventario / sysClean) : (Store.db.productos.find(p => p.id === c.productoId)?.costoUnitario || 0);
      movId = uid('m');
      Store.db.movimientos.push({ id: movId, timestamp: new Date().toISOString(), tipo: d < 0 ? 'venta' : 'compra', productoId: c.productoId, cantidad: Math.abs(d), costoUnitario: +costo.toFixed(2), _cogs: 0, _ingreso: 0, motivoAjuste: (d < 0 ? 'Faltante: ' : 'Sobrante: ') + mot });
    }
    Object.assign(c, { stockSistema: sysClean, stockFisico: fis, discrepancia: d, motivo: mot, movimientoAjusteId: movId });
    await Store.save(); closeModal(); renderAll(); toast('Conteo actualizado', 'ok');
  };
}
function revertConteo(id) {
  const c = Store.db.conteosCiclicos.find(x => x.id === id);
  if (!c) return;
  openModal('Revertir conteo', `<p>Se eliminará este conteo${c.movimientoAjusteId ? ' y su ajuste del historial' : ''}. Todo volverá a como estaba, como si nunca hubiera existido. ¿Continuar?</p>
    <div class="form-actions"><button class="btn btn-danger" id="rYes">Sí, revertir</button><button class="btn btn-ghost" id="rNo">Cancelar</button></div>`);
  $('#rNo').onclick = closeModal;
  $('#rYes').onclick = async () => {
    if (c.movimientoAjusteId) Store.db.movimientos = Store.db.movimientos.filter(m => m.id !== c.movimientoAjusteId);
    Store.db.conteosCiclicos = Store.db.conteosCiclicos.filter(x => x.id !== id);
    await Store.save(); closeModal(); renderAll(); toast('Conteo revertido', 'ok');
  };
}
function newConteo() {
  const prods = Store.db.productos;
  if (!prods.length) { toast('Primero crea un producto', 'err'); return; }
  openModal('Nuevo conteo', `<div class="form-grid">
    <label>Producto<select id="cProd" class="input">${prods.map(p => `<option value="${p.id}">${esc(p.nombre)}</option>`).join('')}</select></label>
    <label>Lo que dice el sistema<input id="cSys" class="input" disabled /></label>
    <label>Lo que contaste en físico<input id="cFis" class="input" type="number" min="0" step="1" /></label>
    <label>Motivo de la diferencia<input id="cMot" class="input" placeholder="Ej. empaque dañado…" /></label>
    <div class="form-actions"><button class="btn btn-primary" id="cSave">Guardar</button><button class="btn btn-ghost" id="cCancel">Cancelar</button></div>
    <p class="muted">Si hay diferencia, el sistema la registra solo en los movimientos.</p></div>`);
  const upd = () => { const r = COMP.rows.find(x => x.id === $('#cProd').value); if (r) $('#cSys').value = r.stockActual + ' uds.'; };
  $('#cProd').onchange = upd; upd();
  $('#cCancel').onclick = closeModal;
  $('#cSave').onclick = async () => {
    const pid = $('#cProd').value, fis = parseInt($('#cFis').value), mot = $('#cMot').value.trim() || 'Ajuste de conteo';
    const r = COMP.rows.find(x => x.id === pid);
    if (!r || !(fis >= 0)) { toast('Ingresa lo que contaste en físico', 'err'); return; }
    const d = fis - r.stockActual; let movId = null;
    if (d !== 0) {
      const costo = r.stockActual > 0 ? r.valorInventario / r.stockActual : (Store.db.productos.find(p => p.id === pid)?.costoUnitario || 0);
      movId = uid('m');
      Store.db.movimientos.push({ id: movId, timestamp: new Date().toISOString(), tipo: d < 0 ? 'venta' : 'compra', productoId: pid, cantidad: Math.abs(d), costoUnitario: +costo.toFixed(2), _cogs: 0, _ingreso: 0, motivoAjuste: (d < 0 ? 'Faltante: ' : 'Sobrante: ') + mot });
    }
    Store.db.conteosCiclicos.push({ id: uid('aud'), timestamp: new Date().toISOString(), productoId: pid, stockSistema: r.stockActual, stockFisico: fis, discrepancia: d, motivo: mot, iraCumplido: d === 0 ? 1 : 0, movimientoAjusteId: movId });
    await Store.save(); closeModal(); renderAll(); toast(d === 0 ? 'Conteo exacto' : 'Conteo guardado y ajustado', 'ok');
  };
}

/* ---------- 07 config ---------- */
function renderCfg() {
  const c = Store.db.config;
  $('#cfgSana').value = c.umbrales.sana; $('#cfgLenta').value = c.umbrales.lenta; $('#cfgMuyLenta').value = c.umbrales.muyLenta;
  $('#cfgEmpresa').value = c.preferenciasUI.nombreEmpresa || '';
  $('#cfgTema').value = document.documentElement.dataset.theme;
}
/* ---------- 08 copias ---------- */
function exportJSON() {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(Store.db, null, 2)], { type: 'application/json' }));
  a.download = `inventario_completo_${new Date().toISOString().slice(0, 10)}.json`; a.click();
  toast('Copia descargada', 'ok');
}
async function listBackups() {
  if (!window.rotastock?.isElectron) { toast('Las copias automáticas están en la versión de escritorio', 'err'); return; }
  const l = await window.rotastock.listBackups();
  $('#bkList').innerHTML = l.slice(0, 20).map(n => `<div class="kv"><span class="mono">${esc(n)}</span><button class="btn btn-ghost" data-bk="${esc(n)}" style="padding:5px 10px">Recuperar</button></div>`).join('') || '<p class="muted">Aún no hay copias automáticas.</p>';
  $$('#bkList [data-bk]').forEach(b => b.onclick = async () => {
    Store.db = JSON.parse(await window.rotastock.readBackup(b.dataset.bk));
    await Store.save(); applyTheme(); renderAll(); toast('Copia recuperada', 'ok');
  });
}

/* ---------- 09 informes ---------- */
/* ---------- 09 informes ---------- */
const colL = n => { let s = ''; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const XF = { money: '#,##0.00', int: '#,##0', qty1: '#,##0.0', pct1: '0.0%', fecha: 'yyyy-mm-dd' };
const N = (v, z) => ({ t: 'n', v, z });
function wsAoa(aoa, cols, merges, autofilter) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  if (cols) ws['!cols'] = cols;
  if (merges) ws['!merges'] = merges;
  if (autofilter) ws['!autofilter'] = { ref: autofilter };
  return ws;
}
function buildWorkbook(C, base) {
  const wb = XLSX.utils.book_new();
  const emp = Store.db.config.preferenciasUI.nombreEmpresa || 'Mi negocio';
  const periodo = `${fmtD(C.start)} al ${fmtD(C.end)}`;
  const estadoLbl = e => (e === 'sinDatos' ? 'Sin datos' : EST_LBL[e]);
  const xyzLbl = { X: 'Estable', Y: 'Variable', Z: 'Irregular' };

  /* ---- Hoja 1: Capas FIFO (una fila por lote vivo, con fórmulas vivas) ---- */
  const a1 = [
    ['RotaStock Plus — Capas FIFO por lote'],
    ['Negocio', emp, '', 'Emitido', fmtD(new Date())],
    ['Período', periodo, '', 'Método', 'FIFO (PEPS)'],
    [],
    ['Producto', 'Lote', 'Fecha entrada', 'Costo unit.', 'Entradas (período)', 'Salidas (período)', 'Stock', 'Valor capa', 'Días sin mov.', 'Estado']
  ];
  let er = a1.length + 1; // fila Excel de la primera fila de datos
  const er0 = er;
  for (const p of C.rows) {
    const live = (C.capas[p.id] && C.capas[p.id].length) ? C.capas[p.id] : [{ n: '—', qty: p.stockActual, costo: p.stockActual > 0 ? p.valorInventario / p.stockActual : 0, fecha: null }];
    live.forEach((l, i) => {
      a1.push([p.nombre, typeof l.n === 'number' ? 'Lote ' + l.n : '—',
        l.fecha ? { t: 'd', v: new Date(l.fecha), z: XF.fecha } : '—',
        N(l.costo, XF.money),
        i === 0 ? N(p.entradasPer, XF.int) : '',
        i === 0 ? N(p.salidasPer, XF.int) : '',
        N(l.qty, XF.int),
        { t: 'n', f: `${colL(6)}${er}*${colL(3)}${er}`, z: XF.money },
        p.diasSinMov !== null ? N(p.diasSinMov, XF.int) : '—',
        estadoLbl(p.estado)]);
      er++;
    });
  }
  const er1 = er - 1;
  a1.push(['TOTAL', '', '', '',
    { t: 'n', f: `SUM(${colL(4)}${er0}:${colL(4)}${er1})`, z: XF.int },
    { t: 'n', f: `SUM(${colL(5)}${er0}:${colL(5)}${er1})`, z: XF.int },
    { t: 'n', f: `SUM(${colL(6)}${er0}:${colL(6)}${er1})`, z: XF.int },
    { t: 'n', f: `SUM(${colL(7)}${er0}:${colL(7)}${er1})`, z: XF.money }, '', '']);
  XLSX.utils.book_append_sheet(wb, wsAoa(a1,
    [{ wch: 30 }, { wch: 10 }, { wch: 14 }, { wch: 13 }, { wch: 17 }, { wch: 16 }, { wch: 10 }, { wch: 15 }, { wch: 13 }, { wch: 17 }],
    [{ s: { r: 0, c: 0 }, e: { r: 0, c: 9 } }], `A5:J${er1}`), '1. Capas FIFO');

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
  abc.forEach(d => a2.push([d.r.nombre, N(d.v, XF.money), N(d.pi / 100, XF.pct1), N(d.pa / 100, XF.pct1),
    'Grupo ' + d.abc, xyzLbl[d.xyz], d.abc === 'A' ? 'Cada 30 días' : d.abc === 'B' ? 'Cada 60 días' : 'Cada 120 días']));
  XLSX.utils.book_append_sheet(wb, wsAoa(a2,
    [{ wch: 30 }, { wch: 16 }, { wch: 13 }, { wch: 13 }, { wch: 10 }, { wch: 12 }, { wch: 14 }],
    [{ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }], `A10:G${a2.length}`), '2. Clasificación ABC');

  /* ---- Hoja 3: Plan de compras ---- */
  const reab = Engine.reabastecimiento();
  const a3 = [
    ['RotaStock Plus — Plan de compras'],
    ['Negocio', emp, '', 'Emitido', fmtD(new Date())],
    ['Nota', 'Sugerencias con todo el historial de ventas'],
    [],
    ['Producto', 'En stock', 'Venta prom./día', 'Pronóstico mensual', 'Reserva', 'Pedir al llegar a', 'Cantidad a pedir', 'Estado']
  ];
  reab.forEach(d => a3.push([d.nombre, N(d.stockActual, XF.int), N(d.dBar, XF.qty1), N(d.pron, XF.qty1),
    N(d.SS, XF.qty1), N(d.PRO, XF.qty1), N(d.sug, XF.int), d.alerta ? 'Comprar' : 'Bien']));
  XLSX.utils.book_append_sheet(wb, wsAoa(a3,
    [{ wch: 30 }, { wch: 10 }, { wch: 15 }, { wch: 18 }, { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 10 }],
    [{ s: { r: 0, c: 0 }, e: { r: 0, c: 7 } }], `A5:H${a3.length}`), '3. Plan de compras');

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
  a4.push([],
    ['Conteos realizados', N(list.length, XF.int)],
    ['Exactitud de conteos', N(ira, XF.pct1)],
    ['Faltantes (uds.)', N(list.filter(c => c.discrepancia < 0).reduce((s, c) => s + c.discrepancia, 0), XF.int)],
    ['Sobrantes (uds.)', N(list.filter(c => c.discrepancia > 0).reduce((s, c) => s + c.discrepancia, 0), XF.int)]);
  XLSX.utils.book_append_sheet(wb, wsAoa(a4, [{ wch: 32 }, { wch: 22 }], [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }]), '4. Resumen');
  return wb;
}
function genXLSX() {
  const R = Engine.compute(repDays());
  const wb = buildWorkbook(R, $('#abcBase').value);
  const periodo = $('#repPeriodo').selectedOptions[0].textContent.replace(/\s/g, '');
  XLSX.writeFile(wb, `RotaStock_Informe_${periodo}_${R.end.toISOString().slice(0, 10)}.xlsx`, { cellDates: true });
  toast('Excel generado', 'ok');
}
function repDays() {
  const v = $('#repPeriodo').value;
  return v === 'hoy' ? 'hoy' : v === 'siempre' ? 0 : +v;
}
function chartPNG(kind, R) {
  // Gráficos re-dibujados en paleta de impresión (no toca lo que se ve en pantalla)
  try {
    const cv = document.createElement('canvas'); cv.width = 880; cv.height = 420;
    const ink = '#1d211e', grid = 'rgba(29,33,30,.12)', PET = '#1f5668', CLAY = '#a85a32';
    const legend = { position: 'bottom', labels: { color: ink } };
    const scales = { x: { ticks: { color: ink }, grid: { color: grid } }, y: { ticks: { color: ink }, grid: { color: grid } } };
    let cfg = null;
    if (kind === 'bar') {
      const top = [...R.rows].sort((a, b) => b.ingresos - a.ingresos).slice(0, 8);
      cfg = { type: 'bar', data: { labels: top.map(r => r.nombre.length > 20 ? r.nombre.slice(0, 19) + '…' : r.nombre),
        datasets: [{ label: 'Ingresos', data: top.map(r => +r.ingresos.toFixed(2)), backgroundColor: PET }, { label: 'COGS', data: top.map(r => +r.cogs.toFixed(2)), backgroundColor: CLAY }] },
        options: { responsive: false, animation: false, plugins: { legend }, scales } };
    } else if (kind === 'donut') {
      const dist = [['sana', 'Sana'], ['lenta', 'Lenta'], ['muyLenta', 'Muy lenta'], ['dormido', 'Dormido']]
        .map(([k, l]) => ({ l, v: R.rows.filter(r => r.estado === k).length }));
      cfg = { type: 'doughnut', data: { labels: dist.map(d => d.l),
        datasets: [{ data: dist.map(d => d.v), backgroundColor: ['#38724f', '#8a6810', '#a9531a', '#9c3630'] }] },
        options: { responsive: false, animation: false, plugins: { legend }, cutout: '62%' } };
    } else {
      const data = Engine.abc($('#abcBase').value);
      const col = { A: '#9c3630', B: '#8a6810', C: '#38724f' };
      cfg = { type: 'bar', data: { labels: data.map(d => d.r.nombre.length > 16 ? d.r.nombre.slice(0, 15) + '…' : d.r.nombre),
        datasets: [{ type: 'bar', label: 'Base', data: data.map(d => +d.v.toFixed(2)), backgroundColor: data.map(d => col[d.abc]) },
          { type: 'line', label: '% acumulado', data: data.map(d => +d.pa.toFixed(1)), borderColor: ink, pointBackgroundColor: ink, yAxisID: 'y1', tension: .2 }] },
        options: { responsive: false, animation: false, plugins: { legend },
          scales: { x: { ticks: { color: ink }, grid: { color: grid } }, y: { ticks: { color: ink }, grid: { color: grid } }, y1: { position: 'right', min: 0, max: 100, ticks: { color: ink, callback: v => v + '%' }, grid: { drawOnChartArea: false } } } } };
    }
    const ch = new Chart(cv, cfg);
    const url = ch.toBase64Image(); ch.destroy();
    return url;
  } catch (e) { return null; }
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
    table: { styles: { fontSize: 7.5, textColor: INK }, headStyles: { fillColor: PET, textColor: 255, fontSize: 7.5 }, alternateRowStyles: { fillColor: PAP }, margin: { left: M, right: M } }
  };
  // Banda de portada
  doc.setFillColor(...PET); doc.rect(0, 0, W, 30, 'F');
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(17);
  doc.text('Informe de inventario', M, 12);
  doc.setFontSize(9); doc.setFont('helvetica', 'normal');
  doc.text(emp, M, 19);
  doc.text(`Período: ${periodo} · Método FIFO (PEPS) · Emitido ${fmtD(new Date())}`, M, 24);
  let y = 38;
  const salto = () => { if (y > 248) { doc.addPage(); y = 20; } };
  const h2 = t => { salto(); doc.setFontSize(12); doc.setTextColor(...PET); doc.setFont('helvetica', 'bold'); doc.text(t, M, y); y += 6; };
  const parr = t => { doc.setFontSize(9); doc.setTextColor(...INK); doc.setFont('helvetica', 'normal');
    doc.splitTextToSize(t, CW).forEach(l => { salto(); doc.text(l, M, y); y += 5; }); y += 3; };
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
    doc.setFillColor(...PAP); doc.setDrawColor(...PET);
    doc.roundedRect(x, y, bw, 20, 2, 2, 'FD');
    doc.setFontSize(7); doc.setTextColor(...MUT); doc.text(k[0], x + 3, y + 6);
    doc.setFontSize(11); doc.setTextColor(...(i === 4 && C.dorm > 0 ? ARC : INK)); doc.setFont('helvetica', 'bold');
    doc.text(String(k[1]), x + 3, y + 14); doc.setFont('helvetica', 'normal');
  });
  y += 26;
  parr(`Entre el ${fmtD(C.start)} y el ${fmtD(C.end)} el negocio vendió $${fmtN(C.totIng, 0)} con un costo de $${fmtN(C.totCogs, 0)}, dejando una ganancia de $${fmtN(C.totGan, 0)}. El stock actual alcanzaría para ${C.dio !== null ? fmtN(C.dio, 1) + ' días' : '—'} al ritmo de ventas del período. Hay ${C.dorm} producto(s) en alerta por falta de movimiento.`);
  // 2. Detalle
  h2('2. Detalle por producto');
  doc.autoTable({ ...T.table, startY: y,
    head: [['Producto', 'Stock', 'Inv. prom.', 'Rotación', 'Cobertura', 'Sin mov.', 'Estado']],
    body: C.rows.map(r => [r.nombre.slice(0, 32), r.stockActual, r.invPromQty.toFixed(1), r.rotacion.toFixed(2),
      r.cobertura !== null ? r.cobertura.toFixed(1) : '—', r.diasSinMov !== null ? r.diasSinMov : '—', estadoLbl(r.estado)]) });
  y = doc.lastAutoTable.finalY + 10;
  // 3. Gráficos
  if (imgs.bar || imgs.donut) {
    h2('3. Gráficos');
    const gw = (CW - 4) / 2, gh = gw * 0.55;
    if (y + gh > 270) { doc.addPage(); y = 20; }
    if (imgs.bar) doc.addImage(imgs.bar, 'PNG', M, y, gw, gh);
    if (imgs.donut) doc.addImage(imgs.donut, 'PNG', M + gw + 4, y, gw, gh);
    y += gh + 10;
  }
  // 4. Clasificación
  h2('4. Clasificación de productos');
  const abc = Engine.abc(base);
  const totB = abc.reduce((s, d) => s + d.v, 0) || 1;
  parr(['A', 'B', 'C'].map(g => {
    const it = abc.filter(d => d.abc === g);
    return `Grupo ${g}: ${it.length} producto(s), ${fmtN(it.reduce((s, d) => s + d.v, 0) / totB * 100, 1)}% del dinero.`;
  }).join(' '));
  doc.autoTable({ ...T.table, startY: y,
    head: [['Producto', base === 'valor' ? 'Valor en stock' : 'COGS', '% total', '% acum.', 'Grupo', 'Estabilidad']],
    body: abc.map(d => [d.r.nombre.slice(0, 30), '$' + fmtN(d.v, 0), d.pi.toFixed(1) + '%', d.pa.toFixed(1) + '%',
      'Grupo ' + d.abc, { X: 'Estable', Y: 'Variable', Z: 'Irregular' }[d.xyz]]) });
  y = doc.lastAutoTable.finalY + 10;
  if (imgs.pareto) {
    if (y + 70 > 270) { doc.addPage(); y = 20; }
    doc.addImage(imgs.pareto, 'PNG', M, y, CW, 70); y += 76;
  }
  // 5. Compras
  h2('5. Qué comprar');
  const reab = Engine.reabastecimiento();
  const al = reab.filter(d => d.alerta);
  if (!al.length) parr('Ningún producto necesita compra por ahora: todo el stock está por encima de su nivel de pedido.');
  else {
    parr(`${al.length} producto(s) llegaron a su nivel de pedido. Total sugerido: ${fmt0(al.reduce((s, d) => s + d.sug, 0))} uds.`);
    doc.autoTable({ ...T.table, startY: y, head: [['Producto', 'Stock', 'Pedir al llegar a', 'Cantidad a pedir']],
      body: al.map(d => [d.nombre.slice(0, 34), d.stockActual, d.PRO.toFixed(0), d.sug]) });
    y = doc.lastAutoTable.finalY + 10;
  }
  // 6. Conteos
  h2('6. Conteos de almacén');
  const list = Store.db.conteosCiclicos || [];
  const ira = list.length ? list.filter(c => c.discrepancia === 0).length / list.length * 100 : 100;
  parr(`Se realizaron ${list.length} conteo(s) con una exactitud de ${fmtN(ira, 1)}%. Faltantes: ${fmt0(list.filter(c => c.discrepancia < 0).reduce((s, c) => s + c.discrepancia, 0))} uds. Sobrantes: +${fmt0(list.filter(c => c.discrepancia > 0).reduce((s, c) => s + c.discrepancia, 0))} uds.`);
  if (list.length) {
    const names = Object.fromEntries(Store.db.productos.map(p => [p.id, p.nombre]));
    doc.autoTable({ ...T.table, startY: y, head: [['Fecha', 'Producto', 'Sistema', 'Físico', 'Diferencia', 'Motivo']],
      body: [...list].reverse().slice(0, 40).map(c => [fmtD(c.timestamp), (names[c.productoId] || '—').slice(0, 28),
        c.stockSistema, c.stockFisico, (c.discrepancia > 0 ? '+' : '') + c.discrepancia, (c.motivo || '—').slice(0, 30)]) });
  }
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); doc.setFontSize(8); doc.setTextColor(...MUT);
    doc.text(`RotaStock Plus · FIFO (PEPS) · Página ${i} de ${n}`, M, 290);
  }
  return doc;
}
function genPDF() {
  try {
    const R = Engine.compute(repDays());
    const imgs = { bar: chartPNG('bar', R), donut: chartPNG('donut', R), pareto: chartPNG('pareto', R) };
    const doc = buildPdf(R, $('#abcBase').value, imgs);
    doc.save(`Informe_RotaStock_${R.end.toISOString().slice(0, 10)}.pdf`);
    toast('PDF generado', 'ok');
  } catch (e) { toast('No se pudo generar el PDF, usa Imprimir', 'err'); }
}

/* ---------- tema ---------- */
function applyTheme() {
  const t = Store.db.config.preferenciasUI.tema === 'claro' ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('rotastock_theme', t); } catch (e) {}
  const cfg = $('#cfgTema'); if (cfg) cfg.value = t;
}

/* ---------- eventos ---------- */
function init() {
  $$('.nav-item').forEach(b => b.onclick = () => {
    $$('.nav-item').forEach(x => x.classList.remove('active')); b.classList.add('active');
    $$('.view').forEach(v => v.classList.add('hidden')); $('#view-' + b.dataset.view).classList.remove('hidden');
    if (window.innerWidth <= 900) $('#sidebar').classList.remove('open');
  });
  $('#periodSelect').onchange = e => { PERIOD = e.target.value === 'all' ? 0 : +e.target.value; DASHPAGE = 1; renderAll(); };
  $('#btnRefresh').onclick = () => { renderAll(); toast('Datos actualizados', 'ok'); };
  $('#btnTheme').onclick = async () => {
    Store.db.config.preferenciasUI.tema = document.documentElement.dataset.theme === 'dark' ? 'claro' : 'oscuro';
    applyTheme(); await Store.save();
  };
  $('#btnToggleSidebar').onclick = () => { document.body.classList.toggle('sidebar-closed'); };
  $('#closeAlert').onclick = () => $('#alertBanner').classList.add('hidden');
  $('#dashSearch').oninput = () => { DASHPAGE = 1; renderDash(); };
  $$('#dashTable th').forEach(th => th.onclick = () => {
    const k = th.dataset.sort; DASHSORT = { k, dir: DASHSORT.k === k ? -DASHSORT.dir : (k === 'nombre' || k === 'estadoOrden' ? 1 : -1) }; renderDash();
  });
  $('#prodSearch').oninput = renderProds; $('#prodFilterEstado').onchange = renderProds; $('#prodSortField').onchange = e => { PRODSORT.f = e.target.value; renderProds(); };
  $('#prodSortDir').onclick = e => { PRODSORT.dir *= -1; e.target.dataset.dir = PRODSORT.dir > 0 ? 'asc' : 'desc'; e.target.textContent = PRODSORT.dir > 0 ? '▲ Asc' : '▼ Desc'; renderProds(); };
  $('#btnNuevoProducto').onclick = () => {
    openModal('Nuevo producto', `<div class="form-grid">
    <label><span class="lt">Nombre <span class="req">*</span></span><input id="nN" class="input" /></label>
    <label>Costo base<input id="nC" class="input" type="number" min="0" step="0.01" /></label>
    <label>Unidades iniciales<input id="nS" class="input" type="number" min="0" step="1" value="0" /></label>
    <label>Costo total de esas unidades<input id="nT" class="input" type="number" min="0" step="0.01" /></label>
    <label>Tiempo de entrega del proveedor (días)<input id="nLT" class="input" type="number" min="1" value="7" /></label>
    <p class="form-hint">Si pones unidades iniciales, el costo total es obligatorio.</p>
    <div class="form-actions"><button class="btn btn-primary" id="nSave">Crear</button><button class="btn btn-ghost" id="nCancel">Cancelar</button></div></div>`);
    $('#nCancel').onclick = closeModal;
    $('#nSave').onclick = async () => {
      const n = $('#nN').value.trim(), s = parseInt($('#nS').value || 0), t = +$('#nT').value || 0;
      if (!n) { toast('Ponle un nombre al producto', 'err'); return; }
      if (s > 0 && !(t > 0)) { toast('Falta el costo total de las unidades iniciales', 'err'); return; }
      const id = uid('p');
      Store.db.productos.push({ id, nombre: n, costoUnitario: +($('#nC').value || (s > 0 ? t / s : 0)), leadTime: +$('#nLT').value || 7, desviacionLeadTime: 1, nivelServicioZ: 1.65, creadoEn: new Date().toISOString() });
      if (s > 0) Store.db.movimientos.push({ id: uid('m'), timestamp: new Date().toISOString(), tipo: 'compra', productoId: id, cantidad: s, costoUnitario: +(t / s).toFixed(4), _cogs: 0, _ingreso: 0, motivoAjuste: null });
      await Store.save(); closeModal(); renderAll(); toast('Producto creado', 'ok');
    };
  };
  $('#abcBase').onchange = renderABC;
  $('#movSearch').oninput = () => { MOVPAGE = 1; renderMovs(); };
  $('#movFilterTipo').onchange = () => { MOVPAGE = 1; renderMovs(); };
  $('#movPeriodo').onchange = () => { MOVPAGE = 1; renderMovs(); };
  $$('#movTable th[data-sort]').forEach(th => th.onclick = () => {
    const k = th.dataset.sort; MOVSORT = { k, dir: MOVSORT.k === k ? -MOVSORT.dir : (k === 'producto' || k === 'tipo' ? 1 : -1) }; renderMovs();
  });
  $('#btnNuevoMovimiento').onclick = () => editMov('');
  $('#btnNuevoConteo').onclick = newConteo;
  $('#configForm').onsubmit = async e => {
    e.preventDefault();
    const s = +$('#cfgSana').value, l = +$('#cfgLenta').value, m = +$('#cfgMuyLenta').value;
    if (!(s >= 0 && s <= l && l <= m)) { toast('Los días deben ir de menor a mayor', 'err'); return; }
    Store.db.config.umbrales = { sana: s, lenta: l, muyLenta: m };
    await Store.save(); renderAll(); toast('Configuración guardada', 'ok');
  };
  $('#btnResetConfig').onclick = async () => { Store.db.config.umbrales = { sana: 7, lenta: 15, muyLenta: 30 }; await Store.save(); renderAll(); toast('Valores por defecto', 'ok'); };
  $('#bizForm').onsubmit = async e => {
    e.preventDefault();
    Store.db.config.preferenciasUI.nombreEmpresa = $('#cfgEmpresa').value.trim();
    Store.db.config.preferenciasUI.tema = $('#cfgTema').value === 'light' ? 'claro' : 'oscuro';
    applyTheme(); await Store.save(); renderAll(); toast('Datos guardados', 'ok');
  };
  $('#btnExport').onclick = exportJSON;
  $('#fileImport').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = async () => { try {
      const d = JSON.parse(r.result);
      if (!d.productos || !d.movimientos || !d.config) throw 0;
      Store.db = d; await Store.save(); applyTheme(); renderAll(); toast('Copia cargada correctamente', 'ok');
    } catch (_) { toast('Ese archivo no es una copia válida', 'err'); } };
    r.readAsText(f); e.target.value = '';
  };
  $('#btnListBk').onclick = listBackups;
  $('#btnPDF').onclick = genPDF; $('#btnXLSX').onclick = genXLSX; $('#btnPrint').onclick = () => window.print();
  $('#modalClose').onclick = closeModal;
  $('#modalOverlay').addEventListener('click', e => { if (e.target.id === 'modalOverlay') closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
}

document.addEventListener('DOMContentLoaded', async () => {
  await Store.load();
  const sel = $('#periodSelect'); if (sel) sel.value = '30';
  applyTheme(); init(); renderAll();
});
if (typeof module !== 'undefined') module.exports = { Engine, Store, buildWorkbook, buildPdf };
