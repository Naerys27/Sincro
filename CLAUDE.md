# CLAUDE.md — Partes de Locomoción (CHT) — fork SINCRO

> **Este repo es el fork de desarrollo de la sincronización con Google Drive.**
> Producción sigue en el repo `prueba` (https://naerys27.github.io/prueba/).
> URL de este fork: https://naerys27.github.io/Sincro/ — Service Worker: `sincro-v2`.
> Diseño, plan y errores de la feature: carpeta `dev/`.

## Al inicio de cada sesión

Leer siempre antes de responder:

1. Este archivo (`CLAUDE.md`) — arquitectura, convenciones, restricciones.
2. `handover.md` — historial de cambios, pendientes y funciones clave.
3. Memoria del proyecto en `~/.claude/projects/.../memory/` — bugs conocidos y contexto de sesiones anteriores.

---

## Descripción del proyecto

PWA (Progressive Web App) para gestionar la documentación del Servicio de Locomoción de la Confederación Hidrográfica del Tajo. Sin backend, sin dependencias externas, 100% frontend estático.

**URL de producción (beta):** [https://naerys27.github.io/prueba/](https://naerys27.github.io/prueba/)

**Service Worker actual:** `partes-loco-v102` (desplegado 2026-07-03) — incrementar en cada deploy. Cambios locales pendientes de deploy → bump a v103.

---

## Estructura del proyecto

```text
Sincro/
├── index.html                  # Pantalla principal / menú + panel "Sincronización con Google"
├── parte_servicio_diario.html  # Módulo partes diarios de vehículos
├── parte_combustible.html      # Módulo partes mensuales de combustible
├── orden_reparacion.html       # Módulo órdenes de reparación y suministro
├── storage.js                  # Capa de almacenamiento (localStorage, merge, hooks)
├── drivesync.js                # Sincronización con Google Drive (appDataFolder)
├── sw.js                       # Service Worker (caché offline, versión actual: sincro-v2)
├── tests/                      # Batería de regresión Playwright — pasar SIEMPRE antes de deploy (tests/README.md)
├── dev/                        # Diseño, plan y errores.md de la feature de sync
├── manifest.json               # Manifiesto PWA
└── icons/
    ├── icon-192.png
    └── icon-512.png
```

---

## Tecnologías

- **HTML/CSS/JS puro** — sin frameworks, sin build tools, sin npm
- **jsPDF** — generación de PDFs en cliente (incrustado en cada HTML)
- **Google Drive API (`appDataFolder`)** — sincronización Android↔PC por usuaria, sin backend (drivesync.js)
- **Google Identity Services (GIS)** — OAuth; script oficial cargado bajo demanda solo al conectar/renovar
- **Service Worker** — caché offline y detección de actualizaciones
- **PWA** — instalable en móvil y PC via manifest.json

---

## Comandos

No hay build ni compilación. El proyecto se sirve directamente como archivos estáticos.

**Desarrollo local:**
Abrir los `.html` directamente en Chrome/Edge, o servir con cualquier servidor estático:

```bash
# opción simple con Python
python -m http.server 8080
```

**Deploy:**

```bash
# 1. SIEMPRE antes de subir: ejecutar la batería de regresión (ver tests/README.md)
bash tests/run_tests.sh   # si falla algún test, NO desplegar

# 2. Subir
git add .
git commit -m "descripción"
git push origin main
```

GitHub Pages publica automáticamente desde la rama `main`.

**IMPORTANTE — tras cada deploy:** incrementar la versión del Service Worker en `sw.js`:

```javascript
const CACHE = 'partes-loco-vN';  // incrementar N — actualmente v102
```

Si no se incrementa, los usuarios seguirán usando la versión cacheada anterior.

---

## Arquitectura de almacenamiento

`storage.js` expone el objeto global `FSStorage` (capa de acceso a datos de los módulos) y
`drivesync.js` expone `DriveSync` (sincronización). **localStorage es siempre la fuente de
verdad local** — la app funciona al 100% sin Google.

| Estado DriveSync | Comportamiento |
| --- | --- |
| `disconnected` | Solo localStorage (como siempre) |
| `synced` | localStorage + archivo `partes_datos.json` en el `appDataFolder` de Drive de la usuaria |
| `pending` | Cambios locales aún sin subir (sin red o en debounce); se reintenta solo |
| `reauth` | Token caducado y renovación silenciosa fallida; chip discreto "toca para reconectar" (máx. 1/día) |

**Ciclo de sync (drivesync.js):** al cargar la página, al volver a primer plano, al evento
`online`, sondeo cada 30 s (`POLL_MS`, solo pestaña visible) y tras cada escritura con
debounce de 3 s (`DEBOUNCE_MS`). Antes de subir siempre se descarga y se pasa por
`mergeData()` — nunca se pisa el remoto. Token OAuth en `sessionStorage` (por pestaña),
nunca en localStorage.

**Claves de datos en storage:**

- `partes_vehiculos_v1` — base de datos de vehículos
- `partes_conductores_v1` — lista de conductores
- `cht_parte_servicio_diario_v1` — historial partes diarios
- `cht_orden_reparacion_v1` — historial órdenes de reparación
- `partes_combustible_hist_v1` — historial partes combustible

**Retención de datos:**

- Partes diarios: 3 meses (purga automática)
- Partes combustible: 6 meses (purga automática)
- Órdenes de reparación: 6 meses (purga automática)

---

## Generación de PDFs

Cada módulo tiene su propia función `draw*Institucional(doc)` que dibuja el PDF con jsPDF.

**Constantes de layout A4 (mm):**

- `ML = 12` — margen izquierdo
- `CW = 186` — ancho de contenido
- `PW = 210` — ancho de página
- Estilos rect válidos en jsPDF: `'S'`, `'F'`, `'FD'`, `'DF'` — **nunca `'SD'`**

**Cabecera estándar (los 3 módulos):**

- Logo CHT izquierda (129.8×22.3mm)
- "Locomocion" bold azul oscuro, alineado a la derecha
- Fecha/mes en gris claro, alineado a la derecha
- Línea separadora azul

**Banner post-generación (`_showPDFOpenModal` / `showPDFSaved`):**
Todos los módulos muestran un modal bottom-sheet con dos botones en fila: "Cerrar" (izquierda) y "Abrir PDF ↗" (derecha). El blob URL se pasa como segundo parámetro y se revoca al cerrar.

---

## Convenciones de código

- **Sin frameworks, sin ES6 modules** — todo en `var`, funciones globales, compatible con Chrome/Edge modernos
- **Parte diario** usa `const`/`let` y arrow functions (estilo más moderno que los otros dos módulos)
- **Sin comentarios** salvo que el WHY no sea obvio
- **IDs de formulario** son los nombres de campo directos: `matricula`, `fecha`, `conductor`, etc.
- `gv(id)` — helper para `document.getElementById(id).value`
- `q(selector)` — helper para `document.querySelector(selector)` (solo en parte diario)
- Borradores (`saveDraft`/`checkDraft`): clave `DRAFT_KEY` distinta por módulo, expiran a las 2 horas
- Tema claro/oscuro: `localStorage` clave `partes_theme`, atributo `data-theme="dark"` en `<html>`
- **Funciones < 50 líneas** — si una función crece más, extraer partes con nombre descriptivo
- **Anidación máxima 4 niveles** — usar early return para aplanar en vez de anidar más
- **Sin números mágicos** — usar constantes nombradas; en PDF ya existen `ML`, `CW`, `PW`, seguir ese patrón para cualquier posición Y nueva
- **XSS: nunca `innerHTML` con datos del usuario** — usar `textContent` para texto plano; si se necesita estructura HTML, crear elementos con `createElement`
- **`aria-live="polite"`** en contenedores de toasts y `showErr()` para que los lectores de pantalla anuncien los mensajes dinámicos

---

## Decisiones de arquitectura

**Todo en un solo HTML por módulo**
jsPDF se incrusta completo en cada HTML para garantizar funcionamiento offline sin CDN externo. Hace los archivos grandes pero elimina dependencias externas.

**localStorage como fuente de verdad local**
Todo se escribe primero en localStorage, siempre. Drive es un canal de sincronización, no un requisito: sin red o sin conectar, la app funciona entera.

**Google Drive (`appDataFolder`) en vez de File System Access API**
El archivo JSON vinculado (mecanismo anterior) no funcionaba en Android. Drive con scope `drive.appdata` (no sensible, sin verificación de Google) da sync Android↔PC por usuaria sin backend. OneDrive/Graph API sigue descartado (cuenta corporativa AGE sin registro de apps en Azure). Ver `dev/2026-07-09-google-drive-sync-design.md`.

**Sin Service Worker scope personalizado**
El SW cubre `./` para simplicidad. A tener en cuenta si se despliega en subcarpeta de servidor.

---

## Features implementadas (estado a 2026-06-25)

- **Último registro en menú (v94):** `index.html` muestra bajo cada tarjeta el último dato guardado (`updateModuleStats()`)
- **Chips de matrícula en parte combustible (v90):** control segmentado iOS integrado en la card — pendiente validación beta
- **Campos obligatorios marcados (v95):** `.req { color:#e53e3e }` + `<span class="req">*</span>` en labels de los 3 módulos
- **Historial parte diario colapsable (v93):** `<details class="action-panel">` con summary dinámico que muestra contadores
- **BD vehículos persistente (v91-92):** `saveCurrentVehicle/saveVehicleOR/saveCurrentVehiclePD` al inicio de cada guardado
- **showErr():** en los 3 módulos — reemplaza `alert()`
- **QuotaExceededError:** manejado en los 3 módulos con mensaje descriptivo
- **Confirmación "Nuevo":** guard en `resetForm()` de los 3 módulos para evitar pérdida de datos
- **Validación Conductor/a (v96):** parte diario no guarda ni genera PDF sin conductor indicado
- **Purga fotos antiguas (v97):** `stripOldPhotos()` en `storage.js` — fotos >3 meses se eliminan de localStorage (se conservan en JSON 6 meses)
- **Fix autocompletado matrícula/conductor (v98):** eliminado bucle destructivo en `parte_servicio_diario.html` — cada campo solo autocompleta si el otro está vacío
- **Formato matrícula con guión (v99):** `normMat` para almacenamiento, `fmtMat` para visualización (MMA-05505) — retrocompatible
- **Conductor en mayúsculas (v100):** parte diario y combustible — CSS + conversión al perder foco
- **Conductor por repostaje (v101):** select conductor en cada repostaje, campo en JSON, tarjetas con 👤, PDF multiCond

## Patrón de bug de persistencia (RESUELTO)

Las funciones `saveCurrentVehicle/saveVehicleOR/saveCurrentVehiclePD` deben llamarse al **inicio** de `saveHistorico/saveOrden/saveParteDiario`, no solo desde `makePDF`. Si se añade un nuevo campo de vehículo, verificar que se incluye en estas funciones.

## Patrón de bug: contaminación cruzada de repostajes entre vehículos (RESUELTO — desplegado en v102)

**Síntoma:** al generar el PDF mensual de Parte Combustible para una matrícula, aparecían repostajes de OTRO vehículo del mismo usuario mezclados en la tabla. Reportado por usuaria beta con varios vehículos a su cargo (caso real: `MMM-04024`, junio 2026 — histórico corrupto, corrección manual pendiente del JSON de la usuaria).

**Causa raíz:** `onMatriculaChange()` en `parte_combustible.html` no guardaba ni limpiaba la tabla de repostajes al escribir una matrícula nueva (sin parte guardado ese mes) en `#v_mat`. Las filas del vehículo anterior seguían en el DOM y se mezclaban con las del nuevo.

**Fix:** `onMatriculaChange()` ahora guarda el vehículo saliente (`saveCurrentVehicle()` + `saveHistorico()`) y limpia la tabla antes de cargar/crear el histórico del vehículo entrante.

**Verificación:** regresión con Playwright (Edge, `channel="msedge"`) simulando 2 vehículos con repostajes en el mismo mes, cambio de A→B→A, y repostaje adicional al volver a A. Resultado: cada vehículo conserva solo sus propias entradas, sin pérdidas ni mezcla.

**Trampa de testing a recordar:** Playwright **auto-descarta** (`cancel`) cualquier `confirm()`/`alert()` si no se registra `page.on("dialog", ...)`. En este módulo, `switchFuelType()` muestra un `confirm()` cuando ya hay repostajes y se cambia el tipo de combustible; si se cancela, **invierte** el valor de `#tipo_combustible` al contrario del actual. Sin manejar el diálogo, un test puede disparar ese `confirm()` sin querer (p.ej. re-seleccionando un `<select>` que ya tenía el valor correcto) y acabar con el campo en un valor incorrecto, produciendo falsos negativos ("se pierde el segundo repostaje") que no son bugs reales de la app.

---

## Funciones clave

| Función | Archivo | Qué hace |
| --- | --- | --- |
| `saveCurrentVehicle()` | parte_combustible | Guarda marca/modelo/tarjeta/coste en BD vehículos |
| `saveVehicleOR()` | orden_reparacion | Guarda marca/modelo en BD vehículos |
| `saveCurrentVehiclePD()` | parte_servicio_diario | Guarda marca/modelo en BD vehículos |
| `updateModuleStats()` | index.html | Último registro en tarjetas del menú |
| `renderSavedDays()` | parte_servicio_diario | Lista de partes del mes seleccionado |
| `saveHistorico()` | parte_combustible | Guarda parte mensual + BD vehículos |
| `saveOrden()` | orden_reparacion | Guarda orden + BD vehículos |
| `validateParteData()` | parte_servicio_diario | Valida fecha + conductor/a + matrícula + contadores + horas |
| `updateConductorSelects()` | parte_combustible | Sincroniza selects de conductor en forms de repostaje |
| `stripOldPhotos()` | storage.js | Purga fotos >3 meses de localStorage cuando hay JSON vinculado |

---

## Sistema de diseño

### Colores

| Color | Uso |
| --- | --- |
| `#0f6f9c` | Azul principal (brand) |
| `#0e1c2e` | Fondo chips bar (oscuro), card headers dark |
| `#e5eef4` | Fondo chips bar (claro), botones `.btnc` |
| `#5a7184` | Texto secundario |
| `#0d1520` | Inputs modo oscuro |
| `#e53e3e` | Asterisco campos obligatorios / danger |

### Componentes de UI recurrentes

- **Toast:** duración 2800ms, esquina inferior
- **Modal post-PDF:** bottom-sheet con "Cerrar" (izq) + "Abrir PDF ↗" (der) — blob URL revocado al cerrar
- **`showErr(msg)`:** reemplaza `alert()` en los 3 módulos
- **`.req`:** `color:#e53e3e` — marca campos obligatorios en labels

## Archivos de prueba (no desplegar)

- `parte_servicio_diario_historial_test.html` — copia de prueba del rediseño historial
- `parte_combustible_tabs*.html` — prototipos de chips descartados
- `parte_combustible_conductor_test.html` — prototipo conductor por repostaje (ya integrado en el real)
- `parte_combustible_v100_backup.html` — backup pre-v101

---

## Principios de desarrollo

### Proceso: plan antes de código

Antes de tocar HTML/CSS/JS o coordenadas PDF:

1. Describir qué cambia y dónde (función, sección, layout).
2. Identificar efectos secundarios: ¿afecta a otras funciones? ¿cambia posiciones PDF?
3. Solo entonces: implementar.

Para cambios en PDF, indicar siempre si aplica `multiCond` o no y verificar que las posiciones TOTAL no se desplazan.

### Formularios

- Labels siempre visibles — nunca solo placeholder como label.
- Errores inline, específicos: "El campo Matrícula es obligatorio", no "campo inválido".
- Copy en voz activa: "Guardar", "Añadir repostaje", no "Submit" ni "OK".
- Touch targets mínimo 44px (PWA mobile-first).
- Focus visible por teclado en todos los controles interactivos.

### Restraint

- No añadir animaciones decorativas — solo donde ayuden al usuario (toast, transición de sección).
- No añadir campos, opciones o botones que no hayan sido pedidos.
- Antes de entregar: ¿hay algo que se pueda quitar sin perder funcionalidad? Quitarlo.

### Stack — restricciones a respetar

- Sin frameworks, sin npm, sin build tools.
- jsPDF embebido — no usar imports externos nuevos.
- Coordenadas PDF son absolutas y frágiles: documentar siempre las posiciones TOTAL que cambien y si dependen del flag `multiCond`.
- Service Worker: incrementar `partes-loco-vN` en cada deploy.

### Errores y decisiones

- Antes de tocar código relacionado con un bug, revisar `handover.md` y la memoria del proyecto — el patrón puede estar ya documentado.
- Cuando el usuario tome una decisión relevante (stack, naming, flujo, regla de negocio), registrarla en memoria sin que lo pidan.

### Cuándo escalar a subagente

- **PLANNER** — tarea con más de 3 pasos interdependientes o que toque PDF + JS + UI simultáneamente. Desglosar en pasos atómicos antes de escribir código.
- **DEBUGGER** — bug que se repite en la sesión, o cuya causa raíz no está clara tras un primer análisis.

---

## Decisiones descartadas

Tecnologías y enfoques probados y descartados — no volver a proponerlos.

| Qué | Por qué se descartó |
| --- | --- |
| Sincronización cloud (OneDrive/Graph API) | Cuenta corporativa AGE sin posibilidad de registrar app en Azure |
| CDN externo para jsPDF | Elimina funcionamiento offline — se incrusta completo en cada HTML |
| ES6 modules / import-export | Incompatible con la arquitectura de archivo único por módulo |
| Backend / servidor | Sin infraestructura disponible — la PWA debe ser 100% estática |
| Frameworks CSS (Bootstrap, Tailwind) | Añaden peso y dependencias externas sin beneficio para este alcance |
