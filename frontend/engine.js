'use strict';

/**
 * Motor Matemático y Replay Cronológico FIFO Estricto (PEPS) de RotaStock Plus.
 * Implementa las Secciones 3, 4, 5, 6 y 7 de funcionalidades.md sin acoplamiento al DOM.
 */
(function () {
  const {
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
    uid
  } = globalThis.RotaConstants || require('./constants.js');

  const { Store } = globalThis.Store ? { Store: globalThis.Store } : require('./store.js');

  const Engine = {
    /**
     * Determina la ventana de tiempo [start, end] y su duración en días (Sección 3.1).
     */
    range(days) {
      const end = new Date();
      let start;
      if (days === 'hoy') {
        start = new Date();
        start.setHours(0, 0, 0, 0);
      } else if (!days) {
        const all = Store.db.movimientos.map(m => new Date(m.timestamp).getTime());
        start = new Date(all.length ? Math.min(...all) : Date.now());
      } else {
        start = new Date(end.getTime() - days * MS_PER_DAY);
      }
      return { start, end, days: Math.max(1, Math.floor((end - start) / MS_PER_DAY)) };
    },

    /**
     * Replay cronológico completo de capas FIFO y cálculo de indicadores (Secciones 3 y 4).
     */
    compute(days) {
      const db = Store.db;
      const { start, end, days: delta } = this.range(days);
      const th = db.config.umbrales;
      const movs = [...db.movimientos].sort(
        (a, b) => new Date(a.timestamp) - new Date(b.timestamp) || String(a.id).localeCompare(String(b.id))
      );

      const lots = {}, snap = {}, lastCost = {}, stock = {}, valor = {};
      const per = {}, perQ = {}, lastMov = {};

      db.productos.forEach(p => {
        lots[p.id] = [];
        snap[p.id] = [];
        stock[p.id] = 0;
        valor[p.id] = 0;
        lastCost[p.id] = 0;
        per[p.id] = { cogs: 0, ing: 0 };
        perQ[p.id] = { compra: 0, venta: 0 };
      });

      for (const m of movs) {
        if (!lots[m.productoId]) continue;
        const t = new Date(m.timestamp);
        if (m.tipo === 'compra' || m.tipo === 'ajuste_excedente') {
          lots[m.productoId].push({
            remaining: m.cantidad,
            costo: m.costoUnitario,
            fecha: t,
            movId: m.id
          });
          lastCost[m.productoId] = m.costoUnitario;
          m._cogs = 0;
          m._ingreso = 0;
          if (t >= start && t <= end) perQ[m.productoId].compra += m.cantidad;
        } else {
          let pend = m.cantidad, cogs = 0;
          while (pend > FLOAT_EPSILON && lots[m.productoId].length) {
            const L = lots[m.productoId][0];
            const take = Math.min(L.remaining, pend);
            cogs += take * L.costo;
            L.remaining -= take;
            pend -= take;
            if (L.remaining <= FLOAT_EPSILON) lots[m.productoId].shift();
          }
          if (pend > FLOAT_EPSILON) cogs += pend * (lastCost[m.productoId] || 0);
          m._cogs = +cogs.toFixed(2);
          m._ingreso = +(m.cantidad * m.costoUnitario).toFixed(2);
          if (t >= start && t <= end) {
            per[m.productoId].cogs += m._cogs;
            per[m.productoId].ing += m._ingreso;
            perQ[m.productoId].venta += m.cantidad;
          }
        }
        stock[m.productoId] = lots[m.productoId].reduce((s, l) => s + l.remaining, 0);
        valor[m.productoId] = lots[m.productoId].reduce((s, l) => s + l.remaining * l.costo, 0);
        snap[m.productoId].push({ fecha: t, qty: stock[m.productoId], val: valor[m.productoId] });
        lastMov[m.productoId] = t;
      }

      const valAt = (pid, t, key) => {
        let v = 0;
        for (const x of snap[pid]) {
          if (x.fecha <= t) v = x[key];
          else break;
        }
        return v;
      };

      const rows = db.productos.map(p => {
        const invFinVal = valor[p.id] || 0, invIniVal = valAt(p.id, start, 'val');
        const invFinQty = stock[p.id] || 0, invIniQty = valAt(p.id, start, 'qty');
        const invPromVal = (invIniVal + invFinVal) / 2, invPromQty = (invIniQty + invFinQty) / 2;
        const cogs = per[p.id].cogs, ingresos = per[p.id].ing;
        const rotacion = invPromVal > 0 ? cogs / invPromVal : 0;
        const cogsPerDay = cogs / delta;
        const cobertura = cogsPerDay > 0 ? invFinVal / cogsPerDay : null;
        const diasSinMov = lastMov[p.id] ? Math.max(0, Math.floor((end - lastMov[p.id]) / MS_PER_DAY)) : null;
        const estado =
          diasSinMov === null
            ? 'sinDatos'
            : diasSinMov <= th.sana
            ? 'sana'
            : diasSinMov <= th.lenta
            ? 'lenta'
            : diasSinMov <= th.muyLenta
            ? 'muyLenta'
            : 'dormido';
        return {
          ...p,
          cogs,
          ingresos,
          ganancia: ingresos - cogs,
          stockActual: stock[p.id] || 0,
          valorInventario: invFinVal,
          invPromVal,
          invPromQty,
          rotacion,
          cobertura,
          diasSinMov,
          estado,
          entradasPer: perQ[p.id].compra,
          salidasPer: perQ[p.id].venta
        };
      });

      const capas = {};
      db.productos.forEach(p => {
        capas[p.id] = lots[p.id]
          .filter(l => l.remaining > FLOAT_EPSILON)
          .map((l, i) => ({ n: i + 1, qty: l.remaining, costo: l.costo, fecha: l.fecha }));
      });

      const totCogs = rows.reduce((s, r) => s + r.cogs, 0);
      const totIng = rows.reduce((s, r) => s + r.ingresos, 0);
      const totVal = rows.reduce((s, r) => s + r.valorInventario, 0);
      const dio = totCogs > 0 ? totVal / (totCogs / delta) : null;

      return {
        rows,
        start,
        end,
        delta,
        totCogs,
        totIng,
        totGan: totIng - totCogs,
        totVal,
        dio,
        dorm: rows.filter(r => r.estado === 'dormido').length,
        capas
      };
    },

    /**
     * Clasificación ABC heurística por proximidad y matriz XYZ (Sección 5).
     */
    abc(base = 'valor') {
      const { rows } = this.compute(0);
      const vals = rows.map(r => ({
        r,
        v: base === 'valor' ? r.valorInventario : r.cogs + (r.cogs === 0 ? r.valorInventario * ABC_EPSILON_FACTOR : 0)
      }));
      const tot = vals.reduce((s, x) => s + x.v, 0) || 1;
      vals.sort((a, b) => b.v - a.v);
      vals.forEach(x => {
        x.pi = (x.v / tot) * 100;
      });

      const decide = (antes, despues, obj) => (despues - obj <= obj - antes ? 0 : 1);
      let acc = 0;
      for (const x of vals) {
        const antes = acc, despues = acc + x.pi;
        let idx;
        if (despues <= ABC_UMBRALES[0]) idx = 0;
        else if (despues <= ABC_UMBRALES[1]) idx = antes < ABC_UMBRALES[0] ? decide(antes, despues, ABC_UMBRALES[0]) : 1;
        else if (antes < ABC_UMBRALES[0])
          idx = decide(antes, despues, ABC_UMBRALES[0]) === 0 ? 0 : decide(antes, despues, ABC_UMBRALES[1]) === 0 ? 1 : 2;
        else if (antes < ABC_UMBRALES[1]) idx = decide(antes, despues, ABC_UMBRALES[1]) === 0 ? 1 : 2;
        else idx = 2;

        x.abc = ABC_CLASES[idx];
        x.pa = despues;
        acc = despues;
        const cv = this.cv(x.r.id);
        x.cv = cv;
        x.xyz = cv <= CV_UMBRAL_X ? 'X' : cv <= CV_UMBRAL_Y ? 'Y' : 'Z';
      }
      return vals;
    },

    /**
     * Coeficiente de variación mensual de ventas para clasificación XYZ (Sección 5.4).
     */
    cv(pid) {
      const ds = {};
      for (const m of Store.db.movimientos) {
        if (m.productoId === pid && m.tipo === 'venta') {
          const k = m.timestamp.slice(0, 7);
          ds[k] = (ds[k] || 0) + m.cantidad;
        }
      }
      const v = Object.values(ds);
      if (v.length < 2) return 0;
      const mu = v.reduce((a, b) => a + b, 0) / v.length;
      if (!mu) return CV_SIN_MEDIA;
      return Math.sqrt(v.reduce((a, b) => a + (b - mu) ** 2, 0) / v.length) / mu;
    },

    /**
     * Modelo matemático de reabastecimiento: suavizado exponencial, SS, PRO y sugerencia (Sección 6).
     */
    reabastecimiento() {
      const { rows } = this.compute(0);
      return rows.map(r => {
        const byM = {};
        for (const m of Store.db.movimientos) {
          if (m.productoId === r.id && m.tipo === 'venta') {
            const k = m.timestamp.slice(0, 7);
            byM[k] = (byM[k] || 0) + m.cantidad;
          }
        }
        const dem = Object.keys(byM).sort().map(k => byM[k]);
        let F = dem[0] || 0;
        for (let i = 1; i < dem.length; i++) {
          F = ALFA_SUAVIZADO * dem[i] + (1 - ALFA_SUAVIZADO) * F;
        }
        const dBar = dem.reduce((a, b) => a + b, 0) / Math.max(1, dem.length) / DIAS_POR_MES;
        const sdD =
          dem.length > 1
            ? Math.sqrt(dem.map(x => x / DIAS_POR_MES).reduce((a, b) => a + (b - dBar) ** 2, 0) / dem.length)
            : dBar * CV_FALLBACK_FACTOR;
        const LT = r.leadTime || DEFAULT_LEAD_TIME;
        const sLT = r.desviacionLeadTime || DEFAULT_DESV_LT;
        const Z = r.nivelServicioZ || DEFAULT_Z;
        const SS = Z * Math.sqrt(Math.max(0, LT * sdD * sdD + dBar * dBar * sLT * sLT));
        const PRO = dBar * LT + SS;
        return {
          ...r,
          dBar,
          pron: dem.length ? F : 0,
          SS,
          PRO,
          sug: Math.max(0, Math.ceil(PRO - r.stockActual)),
          alerta: r.stockActual <= PRO
        };
      });
    },

    /**
     * Crea e inserta un movimiento automático de ajuste por discrepancia de conteo físico (Sección 7.1 y 7.2).
     */
    crearMovimientoAjuste(pid, discrepancia, motivo, stockActual, valorInventario) {
      if (discrepancia === 0) return null;
      const costo =
        stockActual > 0
          ? valorInventario / stockActual
          : Store.db.productos.find(p => p.id === pid)?.costoUnitario || 0;
      const movId = uid('m');
      Store.db.movimientos.push({
        id: movId,
        timestamp: new Date().toISOString(),
        tipo: discrepancia < 0 ? 'venta' : 'compra',
        productoId: pid,
        cantidad: Math.abs(discrepancia),
        costoUnitario: +costo.toFixed(2),
        _cogs: 0,
        _ingreso: 0,
        motivoAjuste: (discrepancia < 0 ? 'Faltante: ' : 'Sobrante: ') + motivo
      });
      return movId;
    }
  };

  globalThis.Engine = Engine;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Engine };
  }
})();
