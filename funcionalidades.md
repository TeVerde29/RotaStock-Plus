# Especificación Técnica Integral y Manual de Replicación — RotaStock Plus (v2.0.0)

> **Propósito de este documento:** Este archivo contiene la especificación exhaustiva, las fórmulas matemáticas exactas, la arquitectura de datos, los algoritmos paso a paso (con manejo de múltiples lotes a diferentes precios mediante **FIFO / PEPS estricto**), las reglas de validación y el comportamiento de los 9 módulos de **RotaStock Plus**. Cualquier ingeniero de software puede utilizar este documento como **plano definitivo (blueprint)** para replicar el sistema al 100% en cualquier otro lenguaje o plataforma (Python, C#, Java, Go, Rust, Flutter, Web Fullstack, etc.) obteniendo exactamente los mismos resultados numéricos y operativos.

---

## Tabla de Contenidos

1. [Filosofía y Principios Arquitectónicos](#1-filosofía-y-principios-arquitectónicos)
2. [Esquema Completo de Base de Datos (Estado Único JSON)](#2-esquema-completo-de-base-de-datos-estado-único-json)
3. [Motor de Replay Cronológico FIFO Estricto (PEPS) y Multi-Precio](#3-motor-de-replay-cronológico-fifo-estricto-peps-y-multi-precio)
4. [Fórmulas de Indicadores Financieros, Rotación, Cobertura y Semaforización](#4-fórmulas-de-indicadores-financieros-rotación-cobertura-y-semaforización)
5. [Algoritmo Heurístico de Clasificación ABC (por Proximidad) y Estabilidad XYZ](#5-algoritmo-heurístico-de-clasificación-abc-por-proximidad-y-estabilidad-xyz)
6. [Modelo Matemático de Reabastecimiento («Qué Comprar»)](#6-modelo-matemático-de-reabastecimiento-qué-comprar)
7. [Auditoría Física, Conteos Cíclicos, Ajustes Automáticos e IRA](#7-auditoría-física-conteos-cíclicos-ajustes-automáticos-e-ira)
8. [Especificación Funcional de los 9 Módulos e Interfaz de Usuario](#8-especificación-funcional-de-los-9-módulos-e-interfaz-de-usuario)
9. [Motor de Exportación: Libro Excel (con Fórmulas Vivas) e Informe PDF Ejecutivo](#9-motor-de-exportación-libro-excel-con-fórmulas-vivas-e-informe-pdf-ejecutivo)
10. [Persistencia, Cascada de Carga, Copias Automáticas y Seguridad](#10-persistencia-cascada-de-carga-copias-automáticas-y-seguridad)
11. [Diseño Visual, Paleta de Colores y Reglas de Formato](#11-diseño-visual-paleta-de-colores-y-reglas-de-formato)
12. [Casos Borde (Edge Cases) e Invariantes para Replicación Exacta](#12-casos-borde-edge-cases-e-invariantes-para-replicación-exacta)

---

## 1. Filosofía y Principios Arquitectónicos

### 1.1. Fuente Única de Verdad y Event Sourcing Simplificado (Replay Total)
El principio más importante de **RotaStock Plus** es que **no almacena saldos de stock ni indicadores financieros precalculados como fuente de verdad**.
- Los objetos de producto **no tienen** un atributo `stock` persistido.
- Los lotes FIFO **no se guardan** en la base de datos; viven en memoria y se reconstruyen desde cero en cada cálculo.
- La única fuente de verdad para las existencias y costos es la **bitácora histórica de movimientos** (`movimientos[]`).
- **Invariante de Recálculo:** Cualquier alta, edición o eliminación de un producto, movimiento o conteo físico dispara un **replay cronológico completo** desde el primer movimiento de la historia hasta el presente. Esto garantiza que jamás exista desincronización ("deriva") entre lo que ocurrió en el almacén y lo que muestra la pantalla, incluso si el usuario inserta, edita o borra una compra o venta con fecha pasada.

### 1.2. Por qué FIFO Estricto (PEPS: Primeras Entradas, Primeras Salidas)
En la realidad comercial, un mismo producto (SKU) se compra en distintos momentos a **diferentes precios unitarios de adquisición** (por inflación, descuentos por volumen, variación de tipo de cambio o cambio de proveedor) y se vende a **diferentes precios de venta**.
- El sistema mantiene por cada producto una **cola FIFO (`Queue`) de capas o lotes de entrada**, donde cada lote conserva su cantidad remanente (`remaining`), su costo unitario exacto de compra (`costo`), su fecha de ingreso (`fecha`) y el ID del movimiento que lo originó (`movId`).
- Cuando ocurre una **venta**, el operador **solo ingresa la cantidad vendida y el precio unitario de venta**. El operador **nunca** ingresa el costo de lo vendido (COGS).
- El motor FIFO consume automáticamente las unidades de los lotes más antiguos disponibles. Si una venta requiere más unidades de las que tiene el lote más antiguo, agota ese lote a su costo histórico y continúa consumiendo del siguiente lote (a su propio costo histórico) hasta cubrir la venta.

---

## 2. Esquema Completo de Base de Datos (Estado Único JSON)

Toda la información del sistema reside en una única estructura de datos serializable en JSON (`inventario.json`).

### 2.1. Estructura Raíz
```json
{
  "meta": {
    "sistema": "RotaStock Plus",
    "versionEsquema": "2.0.0",
    "createdAt": "2026-09-27T14:00:00.000Z",
    "totalProductos": 12,
    "totalMovimientos": 40
  },
  "config": {
    "metodoCosteo": "FIFO",
    "umbrales": {
      "sana": 7,
      "lenta": 15,
      "muyLenta": 30
    },
    "preferenciasUI": {
      "tema": "oscuro",
      "autoBackupMinutos": 1,
      "nombreEmpresa": "Almacén Central de Infraestructura"
    }
  },
  "productos": [],
  "movimientos": [],
  "conteosCiclicos": []
}
```

### 2.2. Diccionario de Entidades y Campos

#### A. Objeto `meta`
| Campo | Tipo | Descripción y Regla de Negocio |
| :--- | :--- | :--- |
| `sistema` | `string` | Constante `"RotaStock Plus"`. |
| `versionEsquema` | `string` | Constante `"2.0.0"`. |
| `createdAt` | `string` (ISO-8601) | Fecha de creación inicial de la base de datos. |
| `totalProductos` | `int` | Se actualiza automáticamente antes de cada guardado: `productos.length`. |
| `totalMovimientos` | `int` | Se actualiza automáticamente antes de cada guardado: `movimientos.length`. |

#### B. Objeto `config`
| Campo | Tipo | Valor por Defecto | Descripción y Regla de Negocio |
| :--- | :--- | :--- | :--- |
| `metodoCosteo` | `string` | `"FIFO"` | Invariante del sistema (no editable en UI). |
| `umbrales.sana` | `int` | `7` | Límite máximo de días sin movimiento para «Rotación Sana». |
| `umbrales.lenta` | `int` | `15` | Límite máximo de días sin movimiento para «Rotación Lenta». |
| `umbrales.muyLenta`| `int` | `30` | Límite máximo de días sin movimiento para «Rotación Muy Lenta». Todo lo mayor a este valor es «Inventario Dormido». |
| `preferenciasUI.tema`| `string` | `"oscuro"` o `"claro"` | Mapea a `"dark"` (si `"oscuro"`) o `"light"` (si `"claro"`) en el DOM. |
| `preferenciasUI.autoBackupMinutos` | `int` | `1` | Conservado por compatibilidad de esquema. |
| `preferenciasUI.nombreEmpresa` | `string` | `"Mi negocio"` | Nombre mostrado en el pie del sidebar y en las cabeceras de reportes PDF/Excel. |

#### C. Arreglo `productos[]` (Catálogo de SKUs)
| Campo | Tipo | Por Defecto | Descripción y Regla de Negocio |
| :--- | :--- | :--- | :--- |
| `id` | `string` | `uid('p')` | Identificador único del producto. |
| `nombre` | `string` | — | Nombre descriptivo del SKU (obligatorio, no vacío). |
| `costoUnitario` | `float` | `0` | **Costo base de respaldo**. No se usa para valorar compras normales (cada compra trae su propio costo). Solo se utiliza si se hace un ajuste de conteo sobre un producto cuyo stock actual en sistema es `0`. |
| `leadTime` | `int` | `7` | Tiempo de entrega del proveedor en días ($\ge 1$). Alimenta el cálculo de punto de pedido. |
| `desviacionLeadTime`| `float` | `1` | Desviación estándar del tiempo de entrega en días ($s_{LT}$). Al crear un producto desde la UI se inicializa en `1`. |
| `nivelServicioZ` | `float` | `1.65` | Factor $Z$ de nivel de servicio estadístico: `1.65` (Alto ~95%), `1.28` (Normal ~90%), `1.04` (Bajo ~85%). |
| `creadoEn` | `string` (ISO) | `now()` | Fecha y hora de creación del producto. |

*(Nota: Si en archivos semilla aparecen campos como `claseABC` o `categoriaRotacion` dentro de `productos[]`, el motor los ignora por completo porque siempre los calcula en tiempo real).*

#### D. Arreglo `movimientos[]` (Bitácora de Transacciones)
| Campo | Tipo | Descripción y Regla de Negocio |
| :--- | :--- | :--- |
| `id` | `string` | Identificador único (`uid('m')`). |
| `timestamp` | `string` (ISO-8601) | Fecha y hora exacta del movimiento. Define el orden del replay FIFO. |
| `tipo` | `string` | Valores posibles: `"compra"`, `"venta"`, o `"ajuste_excedente"`. |
| `productoId` | `string` | Referencia a `productos[].id`. |
| `cantidad` | `int` | Unidades enteras movidas ($\ge 1$). Siempre positivo. |
| `costoUnitario` | `float` | **Polimórfico según el tipo:**<br>• Si `tipo` es `"compra"` o `"ajuste_excedente"`: representa el **Costo Unitario de Compra** de ese lote específico.<br>• Si `tipo` es `"venta"`: representa el **Precio Unitario de Venta** al cliente en esa transacción específica.<br>• Si es una venta generada por **faltante de conteo**: se guarda el costo promedio ponderado de las capas vivas en el momento del ajuste. |
| `_cogs` | `float` | **Campo derivado (reescrito en cada replay):** `0` en compras; en ventas es el costo real FIFO de las unidades vendidas, redondeado a 2 decimales. |
| `_ingreso` | `float` | **Campo derivado (reescrito en cada replay):** `0` en compras; en ventas es $\text{cantidad} \times \text{costoUnitario}$ (precio de venta), redondeado a 2 decimales. |
| `motivoAjuste` | `string \| null` | `null` para compras y ventas normales. En ajustes originados por conteos físicos contiene `"Faltante: <motivo>"` o `"Sobrante: <motivo>"`. |

#### E. Arreglo `conteosCiclicos[]` (Historial de Auditorías Físicas)
| Campo | Tipo | Descripción y Regla de Negocio |
| :--- | :--- | :--- |
| `id` | `string` | Identificador único (`uid('aud')`). |
| `timestamp` | `string` (ISO-8601) | Fecha y hora en que se realizó el conteo. |
| `productoId` | `string` | Referencia a `productos[].id`. |
| `stockSistema` | `int` | Stock que calculaba el motor FIFO justo antes de aplicar este conteo. |
| `stockFisico` | `int` | Cantidad real contada físicamente en el almacén ($\ge 0$). |
| `discrepancia` | `int` | $\text{stockFisico} - \text{stockSistema}$. Negativo = Faltante; Positivo = Sobrante; `0` = Exacto. |
| `motivo` | `string` | Explicación de la diferencia (por defecto `"Ajuste de conteo"`). |
| `iraCumplido` | `int` (`0` o `1`) | `1` si `discrepancia === 0`, de lo contrario `0`. |
| `movimientoAjusteId`| `string \| null` | Si `discrepancia !== 0`, guarda el `id` del movimiento automático insertado en `movimientos[]`. Si `discrepancia === 0`, es `null`. |

### 2.3. Generador de Identificadores Únicos (`uid`)
Para generar IDs sin colisiones de forma local:
$$\text{uid}(\text{prefijo}) = \text{prefijo} + \text{"\_"} + \text{ base36}(\text{timestamp\_ms}) + \text{ base36}(\lfloor \text{random}() \times 10000 \rfloor)$$
Prefijos utilizados: `'p'` para productos, `'m'` para movimientos, `'aud'` para conteos cíclicos.

---

## 3. Motor de Replay Cronológico FIFO Estricto (PEPS) y Multi-Precio

Esta sección detalla el corazón algorítmico del sistema (`Engine.range(days)` y `Engine.compute(days)`).

### 3.1. Determinación de la Ventana de Tiempo (`Engine.range(days)`)
El motor siempre ejecuta el replay FIFO **desde el inicio de los tiempos** para construir las capas de lotes reales, pero filtra las métricas de flujo (COGS del período, ingresos del período, entradas y salidas del período) dentro de una ventana $[t_{\text{start}}, t_{\text{end}}]$:

1. **Fin del intervalo ($t_{\text{end}}$):** Siempre es el instante actual (`new Date()`).
2. **Inicio del intervalo ($t_{\text{start}}$):**
   - Si `days === 'hoy'`: $t_{\text{start}}$ es el día actual a las `00:00:00.000` en hora local.
   - Si `days === 0` o es `falsy` (modo **«Siempre»** / historial completo):
     - Si existen movimientos en la base de datos: $t_{\text{start}} = \min(\text{timestamp de todos los movimientos})$.
     - Si no existen movimientos: $t_{\text{start}} = t_{\text{end}}$.
   - Si `days` es un número entero positivo $N$ (ej. `7`, `15`, `30`, `90`, `180`, `365`):
     $$t_{\text{start}} = t_{\text{end}} - N \times 86\,400\,000\text{ ms}$$
3. **Duración del período en días ($\Delta$):**
   $$\Delta = \max\left(1, \left\lfloor \frac{t_{\text{end}} - t_{\text{start}}}{86\,400\,000} \right\rfloor\right)$$
   *(Nota crítica: $\Delta$ nunca es menor que `1`, evitando divisiones por cero cuando se consulta el período «Hoy» o bases recién creadas).*

### 3.2. Ordenamiento Cronológico Determinista
Antes de procesar, se clona el arreglo `movimientos` y se ordena de forma ascendente bajo dos criterios:
1. **Criterio primario:** Fecha/hora ascendente (`new Date(a.timestamp) - new Date(b.timestamp)`).
2. **Criterio de desempate (Tie-breaker):** Si dos movimientos tienen exactamente el mismo milisegundo en `timestamp`, se ordenan lexicográficamente por su `id` (`String(a.id).localeCompare(String(b.id))`).

### 3.3. Estructuras en Memoria Inicializadas por Producto
Para cada producto $p \in \text{productos}$:
- `lots[p.id] = []` $\rightarrow$ Cola FIFO de lotes activos. Cada lote tiene la estructura:
  `{ remaining: number, costo: number, fecha: Date, movId: string }`
- `snap[p.id] = []` $\rightarrow$ Historial de instantáneas (*snapshots*) tras cada movimiento:
  `{ fecha: Date, qty: number, val: number }`
- `stock[p.id] = 0` $\rightarrow$ Cantidad total actual en existencia.
- `valor[p.id] = 0` $\rightarrow$ Valor monetario total actual en existencia.
- `lastCost[p.id] = 0` $\rightarrow$ Último costo unitario de compra conocido para ese producto.
- `per[p.id] = { cogs: 0, ing: 0 }` $\rightarrow$ Acumuladores de COGS e Ingresos dentro del período $[t_{\text{start}}, t_{\text{end}}]$.
- `perQ[p.id] = { compra: 0, venta: 0 }` $\rightarrow$ Acumuladores de unidades compradas y vendidas dentro del período $[t_{\text{start}}, t_{\text{end}}]$.
- `lastMov[p.id] = undefined` $\rightarrow$ Fecha (`Date`) del último movimiento procesado del producto.

### 3.4. Algoritmo Paso a Paso de Procesamiento de Movimientos (El Bucle FIFO)
Se recorre cada movimiento $m$ del arreglo ordenado:

1. **Verificación de existencia del producto:** Si `lots[m.productoId]` no existe (es decir, el movimiento pertenece a un `productoId` huérfano/borrado), se ignora (`continue`).
2. Sea $t = \text{new Date}(m.\text{timestamp})$.
3. **Rama A — Entrada de Mercancía (`m.tipo === 'compra'` o `m.tipo === 'ajuste_excedente'`):**
   - Se agrega un nuevo lote al final de la cola `lots[m.productoId]`:
     ```js
     lots[m.productoId].push({
       remaining: m.cantidad,
       costo: m.costoUnitario,
       fecha: t,
       movId: m.id
     });
     ```
   - Se actualiza el último costo conocido: `lastCost[m.productoId] = m.costoUnitario`.
   - Se marcan los valores derivados del movimiento: `m._cogs = 0` y `m._ingreso = 0`.
   - Si el movimiento ocurrió dentro del período ($t \ge t_{\text{start}}$ y $t \le t_{\text{end}}$):
     $$\text{perQ}[m.\text{productoId}].\text{compra} \mathrel{+}= m.\text{cantidad}$$

4. **Rama B — Salida de Mercancía (`m.tipo === 'venta'`):**
   - Se inicializan: `pend = m.cantidad` (unidades pendientes por consumir de los lotes) y `cogs = 0` (acumulador del costo de esta venta).
   - **Bucle de Consumo de Capas FIFO:**
     Mientras `pend > 1e-9` **y** la cola `lots[m.productoId]` no esté vacía:
     1. Se inspecciona el lote más antiguo (frente de la cola): `L = lots[m.productoId][0]`.
     2. Se calcula cuánto podemos tomar de este lote:
        $$\text{take} = \min(L.\text{remaining}, \text{pend})$$
     3. Se acumula el costo proporcional usando el costo unitario histórico de ese lote $L$:
        $$\text{cogs} \mathrel{+}= \text{take} \times L.\text{costo}$$
     4. Se descuentan las unidades tomadas:
        $$L.\text{remaining} \mathrel{-}= \text{take}$$
        $$\text{pend} \mathrel{-}= \text{take}$$
     5. **Tolerancia de punto flotante (`1e-9`):** Si $L.\text{remaining} \le 10^{-9}$, el lote se considera completamente agotado y se retira del frente de la cola (`lots[m.productoId].shift()`).
   - **Respaldo ante quiebre histórico (Fallback por edición/eliminación de compras pasadas):**
     Si tras vaciar todos los lotes disponibles aún queda `pend > 1e-9` (por ejemplo, si el usuario borró manualmente una compra antigua dejando una venta posterior sin lote de respaldo), las unidades restantes se costean al último costo de compra conocido:
     $$\text{Si } \text{pend} > 10^{-9} \implies \text{cogs} \mathrel{+}= \text{pend} \times (\text{lastCost}[m.\text{productoId}] \parallel 0)$$
   - **Cálculo de COGS e Ingreso de la transacción:**
     $$m.\text{\_cogs} = \text{round}(\text{cogs}, 2)$$
     $$m.\text{\_ingreso} = \text{round}(m.\text{cantidad} \times m.\text{costoUnitario}, 2)$$
     *(Observa cómo `m.costoUnitario` en la venta actúa como el precio unitario de venta para calcular `_ingreso`, mientras que `_cogs` provino exclusivamente de los costos `L.costo` de los lotes de compra consumidos).*
   - **Acumulación en el período seleccionado:**
     Si $t \ge t_{\text{start}}$ y $t \le t_{\text{end}}$:
     $$\text{per}[m.\text{productoId}].\text{cogs} \mathrel{+}= m.\text{\_cogs}$$
     $$\text{per}[m.\text{productoId}].\text{ing} \mathrel{+}= m.\text{\_ingreso}$$
     $$\text{perQ}[m.\text{productoId}].\text{venta} \mathrel{+}= m.\text{cantidad}$$

5. **Actualización de Estado Post-Movimiento e Instantánea (Snapshot):**
   Inmediatamente después de procesar el movimiento $m$ (sea entrada o salida):
   $$\text{stock}[m.\text{productoId}] = \sum_{l \in \text{lots}[m.\text{productoId}]} l.\text{remaining}$$
   $$\text{valor}[m.\text{productoId}] = \sum_{l \in \text{lots}[m.\text{productoId}]} (l.\text{remaining} \times l.\text{costo})$$
   Se guarda un snapshot cronológico para poder consultar qué inventario existía en cualquier fecha pasada:
   ```js
   snap[m.productoId].push({
     fecha: t,
     qty: stock[m.productoId],
     val: valor[m.productoId]
   });
   lastMov[m.productoId] = t;
   ```

### 3.5. Extracción de Capas Vivas (`capas[pid]`)
Al finalizar el bucle de todos los movimientos, los lotes que quedaron en `lots[p.id]` con `remaining > 1e-9` constituyen las **Capas FIFO Vivas** del inventario actual:
```js
capas[p.id] = lots[p.id]
  .filter(l => l.remaining > 1e-9)
  .map((l, i) => ({
    n: i + 1,           // Número secuencial de lote vivo (1 = el más antiguo por salir)
    qty: l.remaining,   // Unidades restantes en esta capa
    costo: l.costo,     // Costo unitario de compra de esta capa
    fecha: l.fecha      // Fecha en que entró este lote
  }));
```

### 3.6. Ejemplo Numérico Completo de Simulación Multi-Precio
Supongamos el producto `"Monitor 27 4K"` con cuatro eventos cronológicos:
1. **10 de Enero:** Compra de `10` unidades a **\$180.00** c/u.
   - Cola de lotes: `[Lote 1: 10 uds @ $180]`. Stock = `10`, Valor = `\$1,800.00`.
2. **20 de Enero:** Compra de `15` unidades a **\$200.00** c/u (subió el precio del proveedor).
   - Cola de lotes: `[Lote 1: 10 uds @ $180, Lote 2: 15 uds @ $200]`. Stock = `25`, Valor = `\$4,800.00`.
3. **05 de Febrero:** Venta de `12` unidades a un precio de venta de **\$320.00** c/u.
   - El motor toma primero las `10` uds completas del **Lote 1** a `\$180` ($10 \times 180 = \$1,800$) $\rightarrow$ **Lote 1 se agota y sale de la cola**.
   - Faltan `2` uds por cubrir (`pend = 2`). Toma `2` uds del **Lote 2** a `\$200` ($2 \times 200 = \$400$) $\rightarrow$ **Lote 2 queda con `13` uds**.
   - **COGS de la venta (`_cogs`):** $\$1,800 + \$400 = \mathbf{\$2,200.00}$.
   - **Ingreso de la venta (`_ingreso`):** $12 \times \$320 = \mathbf{\$3,840.00}$.
   - **Ganancia bruta de la venta:** $\$3,840 - \$2,200 = \mathbf{\$1,640.00}$.
   - **Estado del almacén tras la venta:** Cola viva = `[Lote 1 (antes 2): 13 uds @ $200]`. Stock actual = `13`, Valor del inventario = $13 \times \$200 = \mathbf{\$2,600.00}$.

---

## 4. Fórmulas de Indicadores Financieros, Rotación, Cobertura y Semaforización

Una vez terminado el bucle FIFO, para cada producto $p$ se calculan sus indicadores en el período $[t_{\text{start}}, t_{\text{end}}]$ de duración $\Delta$ días.

### 4.1. Interpolación Histórica de Inventario Inicial (`valAt`)
Para conocer el inventario al inicio del período ($t_{\text{start}}$), se busca en la lista de snapshots `snap[p.id]` el último registro cuya fecha sea menor o igual a $t_{\text{start}}$:
```js
function valAt(pid, t_start, key) {
  let v = 0;
  for (const x of snap[pid]) {
    if (x.fecha <= t_start) v = x[key]; // key puede ser 'val' (dinero) o 'qty' (unidades)
    else break;
  }
  return v;
}
```
*(Si el primer movimiento del producto ocurrió después de $t_{\text{start}}$, el inventario inicial antes de ese movimiento era `0`).*

### 4.2. Fórmulas por Producto (Fila $r$)
Para cada producto $p$:
1. **Inventario Inicial y Final (en Valor Monetario y en Unidades):**
   $$\text{invIniVal} = \text{valAt}(p.\text{id}, t_{\text{start}}, \text{'val'}), \quad \text{invFinVal} = \text{valor}[p.\text{id}] \parallel 0$$
   $$\text{invIniQty} = \text{valAt}(p.\text{id}, t_{\text{start}}, \text{'qty'}), \quad \text{invFinQty} = \text{stock}[p.\text{id}] \parallel 0$$
2. **Inventario Promedio del Período (en Valor y en Unidades):**
   $$\text{invPromVal} = \frac{\text{invIniVal} + \text{invFinVal}}{2}$$
   $$\text{invPromQty} = \frac{\text{invIniQty} + \text{invFinQty}}{2}$$
3. **COGS, Ingresos y Ganancia Bruta del Período:**
   $$\text{cogs} = \text{per}[p.\text{id}].\text{cogs}, \quad \text{ingresos} = \text{per}[p.\text{id}].\text{ing}$$
   $$\text{ganancia} = \text{ingresos} - \text{cogs}$$
4. **Índice de Rotación Financiera del Período (`rotacion`):**
   $$\text{rotacion} = \begin{cases} \dfrac{\text{cogs}}{\text{invPromVal}} & \text{si } \text{invPromVal} > 0 \\[8pt] 0 & \text{si } \text{invPromVal} = 0 \end{cases}$$
5. **Costo Diario Vendido y Días de Cobertura (`cobertura`):**
   $$\text{cogsPerDay} = \frac{\text{cogs}}{\Delta}$$
   $$\text{cobertura} = \begin{cases} \dfrac{\text{invFinVal}}{\text{cogsPerDay}} & \text{si } \text{cogsPerDay} > 0 \\[8pt] \text{null} & \text{si } \text{cogsPerDay} = 0 \end{cases}$$
6. **Días sin Movimiento (`diasSinMov`):**
   Mide cuántos días enteros han transcurrido desde el último movimiento de cualquier tipo del producto hasta hoy ($t_{\text{end}}$):
   $$\text{diasSinMov} = \begin{cases} \max\left(0, \left\lfloor \dfrac{t_{\text{end}} - \text{lastMov}[p.\text{id}]}{86\,400\,000} \right\rfloor\right) & \text{si existe } \text{lastMov}[p.\text{id}] \\[8pt] \text{null} & \text{si nunca tuvo movimientos} \end{cases}$$

### 4.3. Regla de Semaforización por Inactividad (`estado`)
Con los umbrales configurados $s = \text{umbrales.sana}$ (defecto `7`), $\ell = \text{umbrales.lenta}$ (defecto `15`), $m = \text{umbrales.muyLenta}$ (defecto `30`):
$$\text{estado} = \begin{cases}
\text{'sinDatos'} & \text{si } \text{diasSinMov} = \text{null} \\
\text{'sana'} & \text{si } \text{diasSinMov} \le s \\
\text{'lenta'} & \text{si } s < \text{diasSinMov} \le \ell \\
\text{'muyLenta'} & \text{si } \ell < \text{diasSinMov} \le m \\
\text{'dormido'} & \text{si } \text{diasSinMov} > m
\end{cases}$$

### 4.4. Fórmulas Globales del Almacén (Totales del Período)
Sumando sobre todas las filas de productos $r \in \text{rows}$:
- **COGS Total del Período:** $\text{totCogs} = \sum r.\text{cogs}$
- **Ingresos Totales del Período:** $\text{totIng} = \sum r.\text{ingresos}$
- **Ganancia Bruta Total:** $\text{totGan} = \text{totIng} - \text{totCogs}$
- **Margen Bruto Porcentual:** $\text{margen\%} = \text{totIng} > 0 \ ? \ (\text{totGan} / \text{totIng}) \times 100 : 0$
- **Peso del Costo sobre Ventas:** $\text{pesoCogs\%} = \text{totIng} > 0 \ ? \ (\text{totCogs} / \text{totIng}) \times 100 : 0$
- **Valor Total Actual del Inventario:** $\text{totVal} = \sum r.\text{valorInventario}$
- **Días de Inventario Global (`dio` — Days Inventory Outstanding):**
  $$\text{dio} = \begin{cases} \dfrac{\text{totVal}}{\text{totCogs} / \Delta} & \text{si } \text{totCogs} > 0 \\[8pt] \text{null} & \text{si } \text{totCogs} = 0 \end{cases}$$
- **Total de Productos en Alerta (`dorm`):** Cantidad de productos con $r.\text{estado} === \text{'dormido'}$.
- **Dinero Detenido en Alerta:** $\sum_{r.\text{estado} === \text{'dormido'}} r.\text{valorInventario}$.

---

## 5. Algoritmo Heurístico de Clasificación ABC (por Proximidad) y Estabilidad XYZ

La función `Engine.abc(base)` clasifica todos los productos utilizando **siempre el historial completo (`Engine.compute(0)`)**, independientemente del filtro de período que tenga seleccionado el Panel de Control.

### 5.1. Selección del Criterio Base y Épsilon de Desempate
El usuario puede elegir dos bases de valoración (`base`):
1. **`base === 'valor'` (Dinero en stock actual):**
   $$v_i = r_i.\text{valorInventario}$$
2. **`base === 'demanda'` (Costo de lo vendido histórico — COGS):**
   Si un producto tiene $\text{cogs} = 0$ pero tiene stock valorizado, para evitar que todos los productos sin ventas empaten en cero absoluto sin distinción de cuánto capital inmovilizan, se le suma un $\varepsilon = 0.001 \times \text{valorInventario}$:
   $$v_i = \begin{cases} r_i.\text{cogs} & \text{si } r_i.\text{cogs} > 0 \\ r_i.\text{valorInventario} \times 0.001 & \text{si } r_i.\text{cogs} = 0 \end{cases}$$

### 5.2. Ordenamiento de Pareto y Participación Porcentual
1. Se calcula la suma total de la base: $\text{tot} = \left(\sum_i v_i\right) \parallel 1$ (si la suma es `0`, se usa `1` para evitar `NaN`).
2. Se ordena el arreglo de productos de **mayor a menor** valor $v_i$ (`vals.sort((a, b) => b.v - a.v)`).
3. Para cada producto en orden descendente se calcula su peso porcentual individual ($p_i$):
   $$p_i = \frac{v_i}{\text{tot}} \times 100$$

### 5.3. Asignador Heurístico por Proximidad (Con Tolerancia al Error)
A diferencia de un corte rígido tradicional (donde si el acumulado pasa de `79.9%` a `80.1%` el producto es degradado a B, o donde un producto gigante pasa de `50%` a `92%` distorsionando el corte), RotaStock Plus implementa una **función de decisión por proximidad a la meta** con umbrales objetivo $\text{UMB} = [80, 95]$ y clases $\text{CLS} = [\text{'A'}, \text{'B'}, \text{'C'}]$.

Sea `antes` el porcentaje acumulado antes de incluir el producto actual, y $\text{despues} = \text{antes} + p_i$ el porcentaje acumulado tras incluirlo.
Se define la función auxiliar `decide(antes, despues, obj)`:
$$\text{decide}(\text{antes}, \text{despues}, \text{obj}) = \begin{cases} 0 \text{ (promueve/mantiene en la clase del umbral)} & \text{si } (\text{despues} - \text{obj}) \le (\text{obj} - \text{antes}) \\ 1 \text{ (pasa a la siguiente clase)} & \text{si } (\text{despues} - \text{obj}) > (\text{obj} - \text{antes}) \end{cases}$$
*(Nota: El signo $\le$ implica que **en caso de empate exacto de distancias, el producto se promueve a la clase superior**).*

Para cada ítem en orden descendente (iniciando con `acc = 0`):
- `antes = acc`, `despues = acc + x.pi`
- Evaluación de `idx` (`0` $\rightarrow$ `'A'`, `1` $\rightarrow$ `'B'`, `2` $\rightarrow$ `'C'`):
  1. **Caso 1 (`despues <= 80`):** No ha superado el primer umbral $\implies \text{idx} = 0$ (**Clase A**).
  2. **Caso 2 (`80 < despues <= 95`):**
     - Si `antes < 80` (acaba de cruzar el umbral de 80%): $\text{idx} = \text{decide}(\text{antes}, \text{despues}, 80)$ (será `0` = **A** si `despues` está más cerca o igual de `80` que `antes`; de lo contrario `1` = **B**).
     - Si `antes >= 80` (ya estaba en la zona B): $\text{idx} = 1$ (**Clase B**).
  3. **Caso 3 (`despues > 95` y `antes < 80`):** El ítem saltó ambos umbrales de golpe:
     - Primero evalúa contra `80`: si $\text{decide}(\text{antes}, \text{despues}, 80) === 0 \implies \text{idx} = 0$ (**Clase A**).
     - Si no, evalúa contra `95`: si $\text{decide}(\text{antes}, \text{despues}, 95) === 0 \implies \text{idx} = 1$ (**Clase B**); de lo contrario $\text{idx} = 2$ (**Clase C**).
  4. **Caso 4 (`despues > 95` y `80 <= antes < 95`):** Acaba de cruzar el umbral de 95%:
     - Si $\text{decide}(\text{antes}, \text{despues}, 95) === 0 \implies \text{idx} = 1$ (**Clase B**); de lo contrario $\text{idx} = 2$ (**Clase C**).
  5. **Caso 5 (`antes >= 95`):** Ya había superado el 95% previamente $\implies \text{idx} = 2$ (**Clase C**).
- Se asigna: `x.abc = CLS[idx]`, `x.pa = despues`, `acc = despues`.

### 5.4. Coeficiente de Variación Mensual (`Engine.cv(pid)`) y Clasificación XYZ
La clasificación XYZ mide la regularidad de la demanda en unidades físicas mes a mes:
1. Se filtran todos los movimientos del producto `pid` donde `m.tipo === 'venta'`. *(Nota: Esto incluye las ventas normales y los ajustes por faltante de conteo).*
2. Se agrupan sumando `m.cantidad` por mes calendario usando los primeros 7 caracteres del timestamp ISO (`k = m.timestamp.slice(0, 7)`, formato `"YYYY-MM"`).
3. Sea $V = [q_1, q_2, \dots, q_k]$ el arreglo de cantidades totales vendidas en cada mes con ventas registradas (`Object.values(ds)`):
   - Si el producto tiene ventas en **menos de 2 meses distintos** ($k < 2$): retorna $\text{CV} = 0$.
   - Se calcula la media mensual $\mu = \frac{1}{k}\sum_{j=1}^k q_j$. Si $\mu = 0$, retorna $\text{CV} = 9$.
   - Se calcula la desviación estándar poblacional dividida por la media:
     $$\text{CV} = \frac{\sqrt{\frac{1}{k}\sum_{j=1}^k (q_j - \mu)^2}}{\mu}$$
4. **Asignación de Clase XYZ y Etiqueta de Estabilidad:**
   - Si $\text{CV} \le 0.20 \implies \text{xyz} = \text{'X'}$ (**«Estable»**)
   - Si $0.20 < \text{CV} \le 0.50 \implies \text{xyz} = \text{'Y'}$ (**«Variable»**)
   - Si $\text{CV} > 0.50 \implies \text{xyz} = \text{'Z'}$ (**«Irregular»**)

### 5.5. Frecuencia Sugerida de Revisión / Conteo Físico
Depende exclusivamente del grupo ABC del producto:
- **Grupo A:** `"Cada 30 días"`
- **Grupo B:** `"Cada 60 días"`
- **Grupo C:** `"Cada 120 días"`

---

## 6. Modelo Matemático de Reabastecimiento («Qué Comprar»)

La función `Engine.reabastecimiento()` calcula para cada producto su pronóstico de ventas, stock de seguridad, punto de reorden (nivel de pedido) y cantidad sugerida de compra, partiendo siempre de `Engine.compute(0)` (historial completo y stock actual real).

### 6.1. Serie Temporal de Ventas Mensuales
Para un producto $r$:
1. Se agrupan todas sus ventas (`m.tipo === 'venta'`) por clave mensual `"YYYY-MM"` (`k = m.timestamp.slice(0, 7)`), sumando `m.cantidad`.
2. Se ordenan las claves `"YYYY-MM"` alfabéticamente (orden cronológico ascendente) para obtener el vector de demandas mensuales observadas:
   $$\text{dem} = [D_0, D_1, \dots, D_{k-1}]$$

### 6.2. Pronóstico Mensual por Suavizado Exponencial Simple ($\alpha = 0.3$)
- Constante de suavizado: $\alpha = 0.3$.
- Si `dem` está vacío ($k = 0$), el pronóstico mensual es $\text{pron} = 0$.
- Si `dem` tiene al menos un mes ($k \ge 1$):
  1. Se inicializa con el primer mes registrado: $F_0 = D_0$.
  2. Para cada mes subsiguiente $i = 1, 2, \dots, k-1$:
     $$F_i = \alpha \cdot D_i + (1 - \alpha) \cdot F_{i-1}$$
  3. El pronóstico mensual final es $\text{pron} = F_{k-1}$.

### 6.3. Demanda Diaria Promedio ($\bar{d}$) y Desviación Estándar Diaria ($\sigma_d$)
1. **Demanda Diaria Media (`dBar`):**
   $$\bar{d} = \frac{\sum_{i=0}^{k-1} D_i}{\max(1, k) \times 30}$$
   *(Si no hay ventas, $\bar{d} = 0$).*
2. **Desviación Estándar de la Demanda Diaria (`sdD`):**
   - Si hay más de un mes con ventas ($k > 1$), se transforma cada demanda mensual en tasa diaria ($d_i = D_i / 30$) y se calcula la desviación estándar poblacional:
     $$\sigma_d = \sqrt{\frac{1}{k} \sum_{i=0}^{k-1} \left(\frac{D_i}{30} - \bar{d}\right)^2}$$
   - Si hay `0` o `1` solo mes con ventas ($k \le 1$), se asume una variabilidad heurística del 30% de la demanda diaria:
     $$\sigma_d = 0.3 \times \bar{d}$$

### 6.4. Stock de Seguridad (`SS`), Punto de Reorden (`PRO`) y Sugerencia de Compra (`sug`)
Tomando los parámetros configurados en el producto (o sus valores por defecto si son nulos/0):
- $LT = r.\text{leadTime} \parallel 7$ (días que tarda el proveedor)
- $s_{LT} = r.\text{desviacionLeadTime} \parallel 1$ (desviación del tiempo de entrega en días)
- $Z = r.\text{nivelServicioZ} \parallel 1.65$ (factor de servicio)

1. **Reserva o Stock de Seguridad (`SS`):**
   Combina la incertidumbre de la demanda durante el lead time y la incertidumbre del propio lead time (bajo independencia estadística):
   $$\text{SS} = Z \times \sqrt{\max\left(0,\; LT \cdot \sigma_d^2 + \bar{d}^2 \cdot s_{LT}^2\right)}$$
2. **Punto de Reorden / «Pedir al llegar a» (`PRO`):**
   $$\text{PRO} = \bar{d} \cdot LT + \text{SS}$$
3. **Cantidad Sugerida a Pedir (`sug`):**
   $$\text{sug} = \max\left(0,\; \lceil \text{PRO} - r.\text{stockActual} \rceil\right)$$
4. **Estado de Alerta de Compra (`alerta`):**
   $$\text{alerta} = (r.\text{stockActual} \le \text{PRO})$$
   - Si `alerta === true`: Etiqueta **«Comprar»** (rojo).
   - Si `alerta === false`: Etiqueta **«Bien»** (verde).

*(Nota de caso particular: Si un producto nunca ha tenido ventas ($\bar{d} = 0, \sigma_d = 0$), entonces $\text{SS} = 0$ y $\text{PRO} = 0$. Si además su $\text{stockActual} = 0$, se cumple $0 \le 0 \implies \text{alerta} = \text{true}$, con $\text{sug} = \max(0, \lceil 0 - 0 \rceil) = 0$ unidades).*

---

## 7. Auditoría Física, Conteos Cíclicos, Ajustes Automáticos e IRA

El módulo de **Conteos de Almacén** permite auditar físicamente el inventario y conciliar diferencias sin romper la integridad del motor FIFO.

### 7.1. Registro de un Nuevo Conteo Físico
Cuando el usuario selecciona un producto $p$ e ingresa la cantidad física contada $\text{fis} \ge 0$ y un motivo $\text{mot}$ (si lo deja vacío se usa `"Ajuste de conteo"`):
1. Se obtiene el estado actual del producto mediante el motor: `r = COMP.rows.find(x => x.id === pid)`.
2. Sea $\text{sys} = r.\text{stockActual}$ el stock que dice el sistema en ese instante.
3. **Cálculo de la Discrepancia:**
   $$d = \text{fis} - \text{sys}$$
4. **Generación Automática del Movimiento de Ajuste (si $d \neq 0$):**
   - Se calcula el **costo unitario de valoración del ajuste**:
     - Si el producto tiene stock en el sistema ($\text{sys} > 0$), se usa el costo promedio ponderado actual de sus capas vivas:
       $$\text{costo} = \frac{r.\text{valorInventario}}{\text{sys}}$$
     - Si el producto no tenía stock en el sistema ($\text{sys} = 0$), se usa el costo base del maestro del producto:
       $$\text{costo} = p.\text{costoUnitario} \parallel 0$$
   - Se crea un nuevo movimiento en `Store.db.movimientos` con `movId = uid('m')`:
     - `timestamp`: fecha/hora actual ISO (`new Date().toISOString()`).
     - `tipo`:
       - Si $d < 0$ (hay menos en físico que en sistema $\rightarrow$ **Faltante**): `tipo = 'venta'` (para que el motor FIFO consuma $|d|$ unidades de las capas más antiguas).
       - Si $d > 0$ (hay más en físico que en sistema $\rightarrow$ **Sobrante**): `tipo = 'compra'` (para que el motor FIFO inyecte una nueva capa de $|d|$ unidades).
     - `productoId`: `pid`
     - `cantidad`: $|d|$ (`Math.abs(d)`)
     - `costoUnitario`: `round(costo, 2)` (`+costo.toFixed(2)`)
     - `motivoAjuste`: `(d < 0 ? 'Faltante: ' : 'Sobrante: ') + mot`
5. **Registro en `conteosCiclicos[]`:**
   ```js
   Store.db.conteosCiclicos.push({
     id: uid('aud'),
     timestamp: new Date().toISOString(),
     productoId: pid,
     stockSistema: r.stockActual,
     stockFisico: fis,
     discrepancia: d,
     motivo: mot,
     iraCumplido: d === 0 ? 1 : 0,
     movimientoAjusteId: movId // null si d === 0
   });
   ```

### 7.2. Edición de un Conteo Existente (`editConteo(id)`)
Si el operador se equivocó al digitar un conteo y lo edita:
1. **Cálculo de Vista Previa («Sistema actual sin este ajuste»):**
   $$\text{sysSinAjuste}(c) = r.\text{stockActual} - c.\text{discrepancia}$$
2. **Al guardar el nuevo valor físico (`fis`) y nuevo motivo (`mot`):**
   - Si el conteo tenía un `c.movimientoAjusteId` asociado, **se elimina ese movimiento** de `Store.db.movimientos`.
   - Se ejecuta `Engine.compute(0)` para obtener el stock limpio (`sysClean`) y valor limpio (`r.valorInventario`) sin ese ajuste previo.
   - Se calcula la nueva discrepancia: $d = \text{fis} - \text{sysClean}$.
   - Si $d \neq 0$, se inserta un nuevo movimiento de ajuste (`venta` si $d < 0$, `compra` si $d > 0$) exactamente con la misma regla de costo de la sección 7.1.
   - Se actualiza el objeto de conteo $c$ con `{ stockSistema: sysClean, stockFisico: fis, discrepancia: d, motivo: mot, movimientoAjusteId: movId }`.

### 7.3. Reversión Total de un Conteo (`revertConteo(id)`)
Permite deshacer un conteo «como si nunca hubiera existido»:
1. Si `c.movimientoAjusteId` no es nulo, se elimina dicho movimiento de `Store.db.movimientos`.
2. Se elimina el registro $c$ de `Store.db.conteosCiclicos`.
3. Se guarda y se ejecuta el replay completo (`renderAll()`), restaurando instantáneamente las capas FIFO a su estado original.

### 7.4. Índice de Exactitud de Registro de Inventario (IRA) y KPIs de Auditoría
Dado el arreglo `list = Store.db.conteosCiclicos`:
- **Exactitud de Conteos (`IRA %`):**
  $$\text{IRA} = \begin{cases} \dfrac{\text{cantidad de conteos con } (\text{discrepancia} === 0)}{\text{list.length}} \times 100 & \text{si } \text{list.length} > 0 \\[8pt] 100 & \text{si } \text{list.length} = 0 \end{cases}$$
- **Total Unidades Faltantes:**
  $$\text{Faltantes} = \sum_{c \in \text{list},\; c.\text{discrepancia} < 0} c.\text{discrepancia} \quad (\text{valor negativo o } 0)$$
- **Total Unidades Sobrantes:**
  $$\text{Sobrantes} = \sum_{c \in \text{list},\; c.\text{discrepancia} > 0} c.\text{discrepancia} \quad (\text{se muestra con signo } +)$$

---

## 8. Especificación Funcional de los 9 Módulos e Interfaz de Usuario

El sistema cuenta con **3 selectores de período independientes** para que cambiar la vista en un módulo no altere el análisis de otro:
1. **Período del Panel de Control (`PERIOD`):** Afecta al Módulo 01 y a las métricas del período mostradas en las tarjetas del Módulo 02. Opciones: `7` (1 semana), `15` (15 días), `30` (1 mes — **por defecto al iniciar**), `90` (3 meses), `180` (6 meses), `365` (1 año), `'all'` (internamente `0` = Siempre).
2. **Período de la Bitácora de Movimientos (`#movPeriodo`):** Afecta solo a la tabla del Módulo 04. Opciones: `'hoy'`, `'7'`, `'15'`, `'30'`, `'90'`, `'180'`, `'365'`, `'siempre'` (**por defecto**).
3. **Período de Informes (`#repPeriodo`):** Afecta a la generación de PDF y Excel en el Módulo 09. Opciones: `'hoy'`, `'7'`, `'15'`, `'30'` (**por defecto**), `'90'`, `'180'`, `'365'`, `'siempre'`.

---

### Módulo 01 — Panel de Control (`view-dashboard`)
- **Banner de Alerta Superior:**
  - Visible solo si `COMP.dorm > 0`.
  - Muestra: *"Atención: X producto(s) llevan más de [umbrales.muyLenta] días sin moverse. Dinero detenido: $Y."*
  - Tiene botón `×` para ocultarlo temporalmente hasta el próximo re-render.
- **5 Tarjetas KPI:**
  1. **Días de inventario:** Valor `fmtN(COMP.dio, 1)` o `'—'` si es `null`. Subtítulo: `"días · período de Δ días"` o `"sin ventas en el período"`.
  2. **Costo de lo vendido:** `'$' + fmtN(COMP.totCogs, 0)`. Subtítulo: porcentaje sobre ingresos (`fmtN(totCogs / totIng * 100, 1) + '% de lo vendido'`) o `"sin ventas en el período"`.
  3. **Ingresos totales:** `'$' + fmtN(COMP.totIng, 0)`. Subtítulo: `"ventas del período"`.
  4. **Ganancia bruta:** `'$' + fmtN(COMP.totGan, 0)`. Subtítulo: margen bruto (`fmtN(totGan / totIng * 100, 1) + '% de margen'`) o `'—'`.
  5. **Alertas de rotación:** `COMP.dorm` (borde/icono en color rojo/dormido). Subtítulo: `"productos dormidos"`.
- **Gráfico 1 — Barras Agrupadas («Ingresos vs. costos por producto»):**
  - Toma los **Top 8 productos con mayor ingreso** en el período (`[...COMP.rows].sort((a, b) => b.ingresos - a.ingresos).slice(0, 8)`).
  - Nombres en eje X truncados a 18 caracteres (`nombre.slice(0, 17) + '…'`).
  - Dos series: `Ingresos` (color `--chart-1`) y `COGS` (color `--chart-2`).
- **Gráfico 2 — Dona («Salud del inventario»):**
  - Cuenta cuántos productos del catálogo están en cada uno de los 4 estados: `Sana`, `Lenta`, `Muy lenta`, `Dormido` (agujero central `cutout: '62%'`), acompañado de una lista leyenda inferior con conteos.
- **Tabla «Detalle por producto»:**
  - Buscador en tiempo real por nombre (`#dashSearch`).
  - Columnas ordenables haciendo clic en el encabezado:
    1. `Producto` (`nombre`, alfabético)
    2. `Inv. promedio` (`invPromQty`, 1 decimal)
    3. `Rotación` (`rotacion`, 2 decimales + sufijo `×`)
    4. `Días cobertura` (`cobertura`, 1 decimal o `'—'`; al ordenar, `null` vale `-1`)
    5. `Días sin mov.` (`diasSinMov`, entero o `'—'`; **orden por defecto al arrancar: descendente**, donde `null` vale `1e12`)
    6. `Estado` (`estadoOrden`: `sinDatos: -1, sana: 0, lenta: 1, muyLenta: 2, dormido: 3`)
  - Paginación de **8 filas por página**.

---

### Módulo 02 — Productos (`view-productos`)
- **Barra de herramientas:**
  - Buscador por nombre (`#prodSearch`).
  - Filtro desplegable por estado (`Todos`, `sana`, `lenta`, `muyLenta`, `dormido`).
  - Selector de campo de ordenamiento (`nombre`, `rotacion`, `cogs`, `ingresos`, `ganancia`, `cobertura`, `diasSinMov`) y botón de dirección (`▲ Asc` / `▼ Desc`).
- **Grilla de Tarjetas (`#productGrid`):**
  - Cada tarjeta muestra: Nombre del producto, píldora de estado, y 8 métricas en cuadrícula $2 \times 4$: `Stock actual` (entero), `Inv. promedio` (1 dec), `COGS` (\$2 dec), `Ingresos` (\$2 dec), `Ganancia` (\$2 dec), `Rotación` (2 dec + `×`), `Días cobertura` (1 dec o `'—'`), `Días sin mov.` (entero o `'—'`), más botones **Editar** y **Eliminar**.
- **Modal «Nuevo producto»:**
  - Campos:
    1. `Nombre *` (texto obligatorio).
    2. `Costo base` (número $\ge 0$, paso `0.01`, opcional).
    3. `Unidades iniciales` (entero $\ge 0$, defecto `0`).
    4. `Costo total de esas unidades` (número $\ge 0$, paso `0.01`).
    5. `Tiempo de entrega del proveedor (días)` (entero $\ge 1$, defecto `7`).
  - **Validación y Lógica de Creación:**
    - Si `nombre` está vacío $\rightarrow$ Error: *"Ponle un nombre al producto"*.
    - Si `unidades iniciales (s) > 0` y `costo total (t) <= 0` $\rightarrow$ Error: *"Falta el costo total de las unidades iniciales"*.
    - Si no se ingresó `Costo base`, se asigna `s > 0 ? t / s : 0`.
    - Se crea el producto con `leadTime = +nLT || 7`, `desviacionLeadTime = 1`, `nivelServicioZ = 1.65`.
    - **Si `s > 0`, se inserta automáticamente un primer movimiento de compra** con `cantidad = s` y `costoUnitario = +(t / s).toFixed(4)` (redondeado a **4 decimales** para máxima exactitud del lote inicial).
- **Modal «Editar producto»:**
  - Permite modificar: `Nombre`, `Tiempo de entrega del proveedor (días)`, `Margen de seguridad` (select: `Alto` = `1.65`, `Normal` = `1.28`, `Bajo` = `1.04`) y `Costo base`.
- **Modal «Eliminar producto»:**
  - Muestra advertencia indicando cuántos movimientos asociados se eliminarán. Al confirmar, borra el producto de `productos[]` y todos sus movimientos de `movimientos[]` en cascada, y recalcula todo el sistema.

---

### Módulo 03 — Clasificación ABC (`view-abc`)
- **Selector de Base (`#abcBase`):** `"Ver por: dinero en stock"` (`valor`) o `"Ver por: costo de lo vendido (COGS)"` (`demanda`).
- **3 Tarjetas de Resumen (`Categoría A`, `Categoría B`, `Categoría C`):**
  - Muestran la cantidad de productos en la categoría, qué porcentaje representan del total de productos del catálogo, y qué porcentaje concentran del dinero/COGS total (2 decimales).
- **Gráfico Mixto de Pareto («Curva de importancia»):**
  - Eje izquierdo (`y`, en dólares): Barras con el valor base de cada producto, coloreadas según su clase ABC (`A` = rojo `--dormido`, `B` = ámbar `--lenta`, `C` = verde `--sana`).
  - Eje derecho (`y1`, de `0%` a `100%`): Línea continua con el porcentaje acumulado (`pa`).
- **Tabla ABC/XYZ:**
  - Columnas: `Producto`, `Valor en stock` (o `COGS`), `% del total` (1 dec), `% acumulado` (1 dec), `Grupo` (`Grupo A/B/C`), `Estabilidad` (valor numérico de `CV` con 2 decimales), `Estabilidad` (badge `Estable` / `Variable` / `Irregular`), y `Revisar cada` (`Cada 30 / 60 / 120 días`).

---

### Módulo 04 — Movimientos (`view-movimientos`)
- **Filtros:**
  - Buscador por nombre de producto (`#movSearch`).
  - Filtro por tipo (`#movFilterTipo`):
    - `""`: Compras y ventas.
    - `"compra"`: Solo compras (incluye también cualquier movimiento con `tipo === 'ajuste_excedente'`).
    - `"venta"`: Solo ventas.
  - Filtro por período (`#movPeriodo`): filtra visualmente los movimientos cuya fecha sea $\ge \text{desde}$, sin afectar el motor FIFO.
- **Tabla de Movimientos:**
  - Ordenable por: `Fecha y hora` (`fecha`, por defecto descendente), `Producto` (`producto`), `Tipo` (`tipo`), `Cantidad` (`cantidad`), `Costo/Precio unit.` (`costoUnitario`).
  - Columna `Tipo`: Muestra badge `Compra` o `Venta`, y si tiene `motivoAjuste`, lo muestra debajo en letra pequeña atenuada.
  - Columna `Total`: Muestra `cantidad * costoUnitario` formateado a 2 decimales.
  - Paginación de **10 registros por página** (mostrando hasta 9 botones de página).
- **Modal «Registrar / Editar movimiento»:**
  - `Producto`: Input con autocompletado que muestra hasta 8 coincidencias al escribir o enfocar.
  - `Tipo`: `Compra (entra)` o `Venta (sale)`. Al cambiar el tipo, la etiqueta del campo monetario cambia dinámicamente entre **`"Costo de compra"`** y **`"Precio de venta"`**.
  - `Fecha y hora`: Input `datetime-local`.
  - `Cantidad`: Entero $\ge 1$.
  - `Costo de compra / Precio de venta`: Número $\ge 0$, paso `0.01`.
  - **Validación Estricta de Stock Disponible en Ventas:**
    Si `tipo === 'venta'`:
    1. Se consulta el stock actual total del producto: `disp = Engine.compute(0).rows.find(x => x.id === selId)?.stockActual || 0`.
    2. **Reintegro virtual si se está editando un movimiento existente (`m`):**
       - Si el movimiento original `m` era una `venta` del mismo producto (`m.productoId === selId`), se le suma su cantidad previa al disponible (`disp += m.cantidad`).
       - Si el movimiento original `m` era una `compra` del mismo producto (`m.productoId === selId`) y ahora se está cambiando a `venta`, se le resta su cantidad previa (`disp -= m.cantidad`).
    3. Si `cant > disp + 1e-9`, **se bloquea el guardado** y se lanza el toast de error:
       `"Stock insuficiente: disponible X unidad(es)."`

---

### Módulo 05 — Qué Comprar (`view-reabastecimiento`)
- **Ordenamiento de Prioridad en la Tabla:**
  Los productos se ordenan poniendo primero todos los que están en alerta (`b.alerta - a.alerta`), y dentro de cada grupo, ordenados por urgencia de holgura ascendente: `(a.stockActual - a.PRO) - (b.stockActual - b.PRO)`.
- **Banner Superior:**
  - Si hay productos en alerta: Banner rojo indicando cuántos productos están en nivel bajo y la suma total de unidades sugeridas a pedir (`sum(d.sug)`).
  - Si ningún producto está en alerta: Banner verde *"Todo bien: ningún producto necesita compra por ahora."*
- **Tabla de Reabastecimiento:**
  - Columnas: `Producto` (con subtítulo `"El proveedor tarda ~X días"`), `En stock` (`stockActual`, entero), `Venta prom./día` (`dBar`, 1 dec), `Pronóstico` (`pron`, entero + `" al mes"`), `Reserva` (`SS`, entero), `Pedir al llegar a` (`PRO`, entero), `Cantidad a pedir` (`sug`, entero en negrita), `Estado` (`Comprar` / `Bien`).

---

### Módulo 06 — Conteos de Almacén (`view-auditoria`)
- **3 Tarjetas KPI Superiores:** `Exactitud de conteos` (IRA % con 1 dec y conteo total debajo), `Faltantes` (unidades negativas), `Sobrantes` (`+` unidades positivas).
- **Tabla de Historial de Conteos:**
  - Orden inverso al de inserción (`[...list].reverse()`, el más reciente arriba).
  - Columnas: `Fecha`, `Producto`, `Sistema`, `Físico`, `Diferencia` (coloreada en verde `--sana` si es `0`, o rojo `--dormido` si es $\neq 0$, con signo `+` si es positiva), `Motivo`, `Ajuste` (`"Ajustado"` si generó movimiento o `"Sin diferencia"`), y botones **Editar** y **Revertir**.

---

### Módulo 07 — Configuración (`view-configuracion`)
- **Formulario 1 — «Días sin movimiento»:**
  - Inputs numéricos enteros para `Rotación sana — hasta` (`s`), `Rotación lenta — hasta` (`l`), `Rotación muy lenta — hasta` (`m`).
  - **Regla de Validación:** Debe cumplirse estrictamente:
    $$0 \le s \le l \le m$$
    Si no se cumple, muestra error: *"Los días deben ir de menor a mayor"*.
  - Botón **Restablecer por defecto**: restaura `{ sana: 7, lenta: 15, muyLenta: 30 }`.
- **Formulario 2 — «Datos del negocio»:**
  - `Nombre del negocio` y selector de `Apariencia` (`Oscuro` / `Claro`).

---

### Módulo 08 — Copias de Seguridad (`view-respaldos`)
- **Descargar copia completa (`exportJSON`):** Descarga un archivo llamado `inventario_completo_YYYY-MM-DD.json` con el volcado exacto de `Store.db` indentado a 2 espacios.
- **Cargar copia (`#fileImport`):** Lee un archivo `.json` local, verifica que el JSON parseado contenga las tres propiedades obligatorias (`d.productos && d.movimientos && d.config`), reemplaza `Store.db`, guarda en disco y `localStorage`, aplica el tema y re-renderiza todo. Si falla la validación, muestra *"Ese archivo no es una copia válida"*.
- **Ver copias automáticas (`listBackups`):** En escritorio (Electron), lista hasta las 20 copias automáticas diarias más recientes de la carpeta `backups/` con un botón **Recuperar** al lado de cada una.

---

### Módulo 09 — Informes (`view-reportes`)
- Selector de `Período del informe` (`#repPeriodo`) y 3 botones de acción: **Generar PDF**, **Generar Excel** e **Imprimir** (`window.print()`).

---

## 9. Motor de Exportación: Libro Excel (con Fórmulas Vivas) e Informe PDF Ejecutivo

### 9.1. Especificación del Libro Excel (`buildWorkbook` — 4 Hojas)
El archivo se descarga con el nombre `RotaStock_Informe_<PeríodoSinEspacios>_YYYY-MM-DD.xlsx`.
Formatos numéricos de celda Excel utilizados:
- `money`: `'#,##0.00'`
- `int`: `'#,##0'`
- `qty1`: `'#,##0.0'`
- `pct1`: `'0.0%'`
- `fecha`: `'yyyy-mm-dd'`

#### Hoja 1: `"1. Capas FIFO"`
Muestra el desglose lote por lote de las capas FIFO vivas de cada producto:
- **Filas 1 a 3:** Título (`RotaStock Plus — Capas FIFO por lote`), Negocio, Fecha de emisión, Período y Método (`FIFO (PEPS)`).
- **Fila 5 (Encabezados con Autofiltro `A5:J< última_fila_datos >`):**
  `A: Producto` | `B: Lote` | `C: Fecha entrada` | `D: Costo unit.` | `E: Entradas (período)` | `F: Salidas (período)` | `G: Stock` | `H: Valor capa` | `I: Días sin mov.` | `J: Estado`
- **Filas de Datos (una fila por cada lote vivo `C.capas[p.id]`):**
  - Si un producto tiene lotes vivos en `C.capas[p.id]`, se emite una fila por cada lote (`"Lote 1"`, `"Lote 2"`, etc.).
  - Si un producto **no tiene lotes vivos** (stock `0`), se emite una única fila con Lote `'—'`, Fecha `'—'`, Costo `0` y Stock `0`.
  - **Evitar duplicidad de flujos del período:** Las columnas `E (Entradas del período)` y `F (Salidas del período)` solo se escriben en la **primera fila (`i === 0`)** de cada producto; en las filas de los lotes subsiguientes del mismo producto se dejan en blanco `""` para que la suma vertical de la columna sea exacta.
  - **Fórmula Viva por Fila en Columna H (`Valor capa`):** En lugar de un número estático, la celda en la fila `er` contiene la fórmula de Excel:
    $$H_{\text{er}} = \text{Formula}(\texttt{"G"} + \text{er} + \texttt{"*D"} + \text{er})$$
- **Fila Final (`TOTAL`):**
  Contiene fórmulas nativas `SUM(...)` para las columnas `E`, `F`, `G` y `H`:
  - `E`: `SUM(E6:E<er1>)`
  - `F`: `SUM(F6:F<er1>)`
  - `G`: `SUM(G6:G<er1>)`
  - `H`: `SUM(H6:H<er1>)`

#### Hoja 2: `"2. Clasificación ABC"`
- Respeta la base (`valor` o `demanda`) que esté seleccionada en el Módulo 03.
- Incluye cuadro resumen superior para las categorías `A`, `B` y `C` (cantidad de productos y `% del dinero`) y luego la tabla detallada con autofiltro en `A10:G<N>`:
  `Producto` | `Valor en stock / COGS` | `% del total` | `% acumulado` | `Grupo` | `Estabilidad` | `Revisar cada`.

#### Hoja 3: `"3. Plan de compras"`
- Tabla completa del modelo de reabastecimiento con autofiltro en `A5:H<N>`:
  `Producto` | `En stock` | `Venta prom./día` | `Pronóstico mensual` | `Reserva` | `Pedir al llegar a` | `Cantidad a pedir` | `Estado`.

#### Hoja 4: `"4. Resumen"`
- Tabla ejecutiva con:
  1. Indicadores generales del período: `Días de inventario`, `Costo de lo vendido`, `Ingresos totales`, `Ganancia bruta`, `Productos en alerta (dormidos)`.
  2. `Top 5 por ingresos` del período.
  3. Resumen de auditoría física: `Conteos realizados`, `Exactitud de conteos (IRA)`, `Faltantes (uds.)`, `Sobrantes (uds.)`.

---

### 9.2. Especificación del Informe Ejecutivo PDF (`buildPdf` — 6 Secciones)
El archivo se genera en formato **A4 vertical** (`210 mm × 297 mm`, márgenes laterales de `14 mm`) con el nombre `Informe_RotaStock_YYYY-MM-DD.pdf`.
- **Renderizado Off-Screen de Gráficos (`chartPNG`):**
  Para que el PDF siempre sea legible e imprimible en papel blanco sin importar si el usuario tiene activado el modo oscuro en pantalla, el sistema crea un `<canvas>` temporal en memoria de `880 × 420 px` sin animación y dibuja los 3 gráficos (`bar`, `donut`, `pareto`) con una **paleta fija de impresión**:
  - Tinta de texto: `#1d211e` | Grilla: `rgba(29,33,30,.12)`
  - Azul Petróleo (Ingresos): `#1f5668` | Arcilla (COGS): `#a85a32`
  - Semáforo de impresión: Sana `#38724f`, Lenta `#8a6810`, Muy lenta `#a9531a`, Dormido `#9c3630`.
- **Estructura de las 6 Secciones:**
  - **Banda de Portada Superior (`0` a `30 mm`):** Fondo azul petróleo (`RGB 31, 86, 104`), título `"Informe de inventario"`, nombre de la empresa, período analizado, método `"FIFO (PEPS)"` y fecha de emisión.
  - **Sección 1 — Resumen del período:** 5 cajas KPI redondeadas + un párrafo narrativo autogenerado con los resultados financieros y días de inventario del período.
  - **Sección 2 — Detalle por producto:** Tabla completa (`autoTable`) con `Producto`, `Stock`, `Inv. prom.`, `Rotación`, `Cobertura`, `Sin mov.`, `Estado`.
  - **Sección 3 — Gráficos:** Inserta lado a lado las imágenes PNG del gráfico de barras Top 8 y la dona de salud del inventario.
  - **Sección 4 — Clasificación de productos:** Párrafo resumen de grupos A/B/C, tabla completa ABC/XYZ e imagen PNG de ancho completo de la curva de Pareto.
  - **Sección 5 — Qué comprar:** Filtra **únicamente los productos en alerta** (`alerta === true`). Si no hay ninguno, imprime párrafo confirmando que todo el stock está por encima de su nivel de pedido; si los hay, imprime el resumen de unidades sugeridas y la tabla de compras.
  - **Sección 6 — Conteos de almacén:** Párrafo con total de conteos, exactitud IRA %, faltantes y sobrantes, seguido de la tabla con hasta los últimos 40 conteos realizados.
  - **Pie de Página Numerado:** En todas las páginas a `y = 290 mm`: `"RotaStock Plus · FIFO (PEPS) · Página i de n"`.

---

## 10. Persistencia, Cascada de Carga, Copias Automáticas y Seguridad

### 10.1. Rutas de Almacenamiento en Escritorio (Windows / Electron)
En el proceso principal (`main.js`):
- Ruta base: `path.join(app.getPath('appData'), 'RotaStockPlus')` $\rightarrow$ en Windows corresponde a:
  `C:\Users\<usuario>\AppData\Roaming\RotaStockPlus\`
- Archivo principal de base de datos:
  `C:\Users\<usuario>\AppData\Roaming\RotaStockPlus\datos\inventario.json`
- Carpeta de copias de seguridad automáticas:
  `C:\Users\<usuario>\AppData\Roaming\RotaStockPlus\backups\`
- **Inicialización (`ensureFiles`):** Al arrancar por primera vez, si no existe `inventario.json` en `AppData`, busca si existe una semilla en `./datos/inventario.json` dentro del directorio de la aplicación; si existe la copia, y si no, escribe el objeto vacío `defaultDB()`.

### 10.2. Algoritmo de Copias Automáticas Diarias y Purga a 30 Días
1. **Una copia por día (`maybeBackup`):** Cada vez que el usuario guarda un cambio (`db:save`), el proceso principal verifica la fecha local en formato `YYYY-MM-DD`. Si aún no existe el archivo `backups/inventario-YYYY-MM-DD.json`, lo crea con el contenido guardado. Si ya existe el de hoy, no lo sobrescribe (conserva la primera foto estable del día).
2. **Purga automática (`pruneBackups`):** Al iniciar la app y tras crear un backup diario, escanea la carpeta `backups/` y elimina cualquier archivo `inventario-*.json` cuya fecha de modificación (`mtimeMs`) tenga más de **30 días** de antigüedad:
   $$\text{mtimeMs} < \text{Date.now}() - 30 \times 86\,400\,000$$

### 10.3. Cascada de Carga Híbrida (`Store.load()`)
El frontend puede ejecutarse tanto dentro de Electron como directamente en un navegador web estándar:
1. **Nivel 1 (Electron IPC):** Si `window.rotastock?.isElectron` es verdadero, invoca `window.rotastock.loadDB()`.
2. **Nivel 2 (`localStorage`):** Si no está en Electron (o si falla), lee `localStorage.getItem('rotastockplus_db')`.
3. **Nivel 3 (`fetch` semilla):** Si `localStorage` está vacío, intenta hacer `fetch('../datos/inventario.json')` o `fetch('datos/inventario.json')`.
4. **Nivel 4 (Fallback en memoria):** Si todo lo anterior falla, inicializa `Store.db` con el esquema vacío por defecto.
- Al guardar (`Store.save()`), actualiza `meta.totalProductos` y `meta.totalMovimientos`, guarda en Electron vía IPC (`saveDB`) y también espeja en `localStorage`.

### 10.4. Seguridad y Aislamiento IPC
- La ventana de Electron se crea con `contextIsolation: true` y `nodeIntegration: false`.
- El script `preload.js` expone únicamente 4 métodos asíncronos en `window.rotastock`:
  - `loadDB()` $\rightarrow$ canal `'db:load'`
  - `saveDB(text)` $\rightarrow$ canal `'db:save'`
  - `listBackups()` $\rightarrow$ canal `'db:listBackups'`
  - `readBackup(name)` $\rightarrow$ canal `'db:readBackup'` (aplica `path.basename(name)` en el proceso principal para impedir ataques de *Path Traversal* fuera de la carpeta `backups/`).
- En toda la interfaz, cualquier texto ingresado por el usuario (nombres de productos, motivos, empresa) se sanitiza mediante la función `esc(s)` que escapa `&`, `<`, `>`, `"`, `'` antes de insertarse en `innerHTML`, previniendo inyecciones XSS.

---

## 11. Diseño Visual, Paleta de Colores y Reglas de Formato

### 11.1. Paleta de Colores (Temas Oscuro y Claro)
El sistema implementa dos temas completos mediante variables CSS en `:root` (oscuro por defecto) y `:root[data-theme="light"]` (claro):

| Token CSS | Rol Visual | Tema Oscuro (`dark`) | Tema Claro (`light`) |
| :--- | :--- | :--- | :--- |
| `--bg` | Fondo general de la aplicación | `#161816` (Grafito cálido) | `#eeebe3` (Papel cálido) |
| `--bg-2` | Fondo de barra lateral (Sidebar) | `#1a1c19` | `#e6e2d8` |
| `--surface` | Tarjetas, paneles y modales | `#212420` | `#faf8f3` |
| `--field` | Inputs y selectores | `#191b18` | `#fffefa` |
| `--text` | Texto principal | `#e9e6dc` | `#1d211e` |
| `--muted` | Texto secundario / etiquetas | `#a2a599` | `#5d625b` |
| `--primary` | Acento principal (Azul petróleo) | `#7fb4c4` | `#1f5668` |
| `--clay` | Acento secundario (Arcilla / Ventas) | `#dc946c` | `#a85a32` |
| `--sana` | Semáforo: Rotación Sana | `#8cc3a0` | `#38724f` |
| `--lenta` | Semáforo: Rotación Lenta | `#dcb54f` | `#8a6810` |
| `--muyLenta` | Semáforo: Rotación Muy Lenta | `#e39a62` | `#a9531a` |
| `--dormido` | Semáforo: Inventario Dormido / Alerta | `#e48c86` | `#9c3630` |

### 11.2. Reglas de Formateo de Números y Fechas
Para replicar la presentación exacta de la interfaz:
- **Números con decimales (`fmtN(n, d = 2)`):** Locale `'en-US'` (separador de miles con coma `,` y punto decimal `.`), con `d` decimales fijos (`minimumFractionDigits: d, maximumFractionDigits: d`).
- **Números enteros (`fmt0(n)`):** Locale `'en-US'`, `maximumFractionDigits: 0`.
- **Fechas con hora (`fmtF(d)`):** Locale `'es-PE'` (`DD/MM/YYYY, HH:MM`).
- **Fechas cortas (`fmtD(d)`):** Locale `'es-PE'` (`DD/MM/YYYY`).

---

## 12. Casos Borde (Edge Cases) e Invariantes para Replicación Exacta

Si vas a programar este sistema en otro lenguaje (ej. Python, C#, Java, TypeScript, etc.), asegúrate de cumplir estos **10 invariantes**:

1. **Tolerancia de Punto Flotante (`1e-9`):** Al restar cantidades de lotes en el motor FIFO o validar stock disponible para una venta, usa siempre una tolerancia $\varepsilon = 10^{-9}$ (`L.remaining <= 1e-9` para retirar un lote de la cola; `cant > disp + 1e-9` para rechazar una venta).
2. **Desempate de Timestamps Idénticos:** Si dos movimientos tienen la misma fecha/hora hasta el milisegundo (por ejemplo, cargas masivas o pruebas automatizadas), el ordenamiento debe desempatar comparando el `id` como cadena de texto (`localeCompare`).
3. **Independencia entre Rotación y Estado de Semaforización:** La `rotacion` mide velocidad financiera en el período ($\text{COGS} / \text{InvPromedio}$), mientras que el `estado` (`sana`, `lenta`, `muyLenta`, `dormido`) depende **exclusivamente** de `diasSinMov` (días transcurridos desde el último movimiento del producto hasta hoy). Un producto puede tener alta rotación anual pero estar `dormido` si lleva 35 días sin moverse.
4. **ABC y Plan de Compras Siempre sobre Historial Completo:** `Engine.abc()` y `Engine.reabastecimiento()` siempre invocan internamente `Engine.compute(0)` (todos los tiempos), nunca el período corto del Dashboard.
5. **Épsilon en ABC por COGS:** En `Engine.abc('demanda')`, cuando un producto tiene `cogs === 0`, su valor de ordenamiento no es `0`, sino `valorInventario * 0.001`.
6. **Promoción en Empate del Asignador ABC:** En la función `decide(antes, despues, obj)`, la comparación es `(despues - obj) <= (obj - antes)`. Si la distancia por arriba es exactamente igual a la distancia por abajo, el producto se queda en la categoría superior (`A` o `B`).
7. **División Mensual entre 30 en Reabastecimiento:** En `Engine.reabastecimiento()`, la demanda diaria media `dBar` se obtiene dividiendo el promedio de los meses **con ventas registradas** entre `30`.
8. **Desviación Diaria con un Solo Mes de Ventas:** Si un producto solo tiene ventas en 1 mes calendario (`dem.length <= 1`), `sdD` no es `0`, sino `dBar * 0.3`. En cambio, en `Engine.cv(pid)` (para la clasificación XYZ), si tiene ventas en menos de 2 meses (`v.length < 2`), `CV` sí retorna `0` (Estable `X`).
9. **Ajustes de Conteo Integrados al Flujo FIFO:** Un conteo físico con diferencia negativa inserta un movimiento con `tipo: 'venta'` y `costoUnitario` igual al costo promedio de las capas vivas (`valorInventario / stockActual`). Esto hace que el ajuste consuma lotes FIFO reales y mantenga cuadrado el valor del inventario.
10. **Costo Unitario de Stock Inicial a 4 Decimales:** Al crear un producto con stock inicial $s > 0$ y costo total del lote $t > 0$, el movimiento inicial de compra se registra con `costoUnitario = round(t / s, 4)`, evitando pérdidas por redondeo cuando $t$ no es múltiplo exacto de $s$.
