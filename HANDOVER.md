# Handover — Partes de Locomoción CHT — fork SINCRO
**Fecha:** 2026-07-09 | **SW actual:** `sincro-v2` (sin desplegar) | Fork de `prueba` (v103) para la feature de sincronización Google Drive

---

## SINCRO — Sincronización Google Drive (2026-07-09, implementada, pendiente de prueba real)

Diseño y plan en `dev/`. Suite completa en verde (12 archivos, ~150 asserts).

- **`drivesync.js` (nuevo):** OAuth con GIS bajo demanda + Drive REST con `fetch`; un archivo `partes_datos.json` en `appDataFolder`; ciclo download→merge→upload reutilizando `mergeData()`; disparadores: carga, primer plano, `online`, sondeo 30 s, escritura con debounce 3 s; estados `disconnected/synced/pending/reauth`; chip de reconexión máx. 1/día; Client ID embebido (público por diseño).
- **`storage.js` reescrito:** retirado el canal File System Access API (sustituido por Drive); `FSStorage` mantiene la API de los módulos (`init/onReady/getItem/setItem`) y añade `mergeData` (ahora pública), `onWrite`, `setSyncActive`, `readAll`, `writeAll`. `stripOldPhotos` purga con sync activo (antes: con archivo vinculado).
- **`index.html`:** panel "Sincronización con Google" (Conectar/estado/Desconectar) en lugar del panel de archivo; enlace "importar copia de datos" añadido (la función existía pero era inaccesible).
- **Tests:** `test_drivesync.js` nuevo (14 asserts, Drive simulado con `page.route`); `test_stripOldPhotos.js` reescrito para el modelo nuevo; typo corregido en `test_ambiguo.js` (esperaba `111-AAA` en vez de `111-1AAA`). **Gotcha nuevo documentado en `dev/errores.md`:** tests que cargan `index.html` con `addInitScript` destructivo deben usar `serviceWorkers: 'block'` (el reload por `controllerchange` re-siembra el estado).
- **Google Cloud:** proyecto `partes-locomocion`, Drive API habilitada, OAuth client "PWA Partes" con orígenes `https://naerys27.github.io` y `http://localhost:8080`. **Verificar que la app está publicada en producción (Público → Publicar la app), no en modo prueba.**

**Pendiente:** push a GitHub (usuario, GitHub Desktop) → prueba E2E real Android↔PC con cuenta de Google del desarrollador durante varios días (medir frecuencia real del aviso de reconexión) → decisión de paso a producción (`prueba`).

---

## Estado general

PWA funcional desplegada en https://naerys27.github.io/prueba/
3 módulos: Parte Servicio Diario · Parte Combustible · Orden de Reparación
Sin backend — almacenamiento en localStorage, sincronizado entre dispositivos vía Google Drive (`appDataFolder`, ver sección SINCRO arriba).

---

## Cambios recientes

### v103 — EN PREPARACIÓN (2026-07-06, local, sin desplegar)

Ronda de robustez tras testing adversario (todos con test de regresión en `tests/test_adversarial.js`, 30 asserts):

- **Coma decimal (bug real):** los campos de euros/litros eran `type="number"` y el navegador descartaba la coma en silencio — teclear "50,55" guardaba **5055** (importe ×100). Ahora son `type="text" inputmode="decimal"` con `normDec()` que convierte coma→punto al teclear y rechaza caracteres no numéricos. Aplicado en combustible (form nuevo repostaje, tabla, editor inline) y parte diario (p1-3/l1-3). Los km siguen `type="number"` (enteros).
- **Aviso importe sospechoso:** `MAX_EUR_AVISO = 400` — importes de repostaje >400€ piden `confirm()` antes de aceptarse (addRepostaje, saveRepostajeInline, saveParteDiario).
- **Aviso fecha fuera de mes:** repostaje con fecha de otro mes distinto a `v_mes` pide confirmación (antes se aceptaba en silencio).
- **Dedup conductores por acentos (combustible):** "JOSÉ PÉREZ" y "JOSE PEREZ" ya no conviven en la lista — dedup con `normStr`, gana la última grafía escrita (mismo criterio que `saveConductorName` del diario). Toast "Conductor repetido" al detectarlo.
- **Tope de 14 repostajes:** al intentar el 15º ahora sale `showErr` persistente con mensaje claro (antes toast fugaz).

### v102 — DESPLEGADO 2026-07-03 (8 bugs + stripOldPhotos + suite de tests)

- **Contaminación cruzada de repostajes/km entre vehículos** (`onMatriculaChange`, caso real `MMM-04024` junio 2026): desplegado. El JSON de la usuaria se corrigió manualmente contrastando ticket a ticket (solo `MMM05520/2026-06` tenía entries duplicadas; `km_ini/km_fin` de 4 matrículas quedaron en blanco por irreconstruibles — deben reintroducirlos los conductores).
- **Órdenes de reparación rotas en producción**: `normMat`/`fmtMat` estaban dentro de un IIFE pero se llamaban desde funciones globales — guardar/cargar/borrar/listar órdenes lanzaba `ReferenceError` desde v99. Movidas al scope global.
- **Autofill conductor ambiguo** (diario): conductor con varios vehículos elige el usado más recientemente (`pickLastUsedVehiclePD`); nunca pisa una matrícula ya escrita.
- **Guards `resetForm` de los 3 módulos**: comprobaban solo 1-2 campos; ahora `formHasData*()` revisa todos los campos, fotos y firma.
- **`mergeData()` en storage.js**: merge por `updatedAt`/`createdAt` (antes localStorage pisaba versiones más recientes del archivo); vehículos campo a campo.
- **XSS**: nombres de conductor sin escapar via `innerHTML` en combustible — `escapeHtml()` añadida.
- **`stripOldPhotos()`**: documentada en v97 pero nunca existió en el código; implementada de verdad (purga fotos >3 meses solo de localStorage, el JSON conserva todo; el merge recupera fotos del archivo si el registro purgado gana por timestamp).
- **Suite de tests permanente**: `tests/` con 10 archivos (~130 asserts) + `tests/run_tests.sh` + README. **Obligatorio pasarla antes de cada deploy.**

### UX / UI — Grupos 1-4 (completados)
- **Grupo 1:** Toast 2800ms, padding-bottom seguro (iOS), contraste botón danger, firma 150px, botones flex, font-size `.ch`
- **Grupo 2:** Colapso secciones en móvil, touch targets 44px, checkboxes accesibles
- **Grupo 3:** Atributo `for` en todos los labels, label "Matrícula" en parte diario
- **Grupo 4:** Tabla responsiva en parte combustible, confirmación "Nuevo" en los 3 módulos, `showErr()` en orden_reparacion, manejo `QuotaExceededError`

### Chips matrícula → control segmentado (v90) — PENDIENTE BETA
`parte_combustible.html`: chips como tab bar iOS integrado en card. Revertible — ver `memory/project_chips_tabs_revert.md`.

### Bug fixes persistencia (v91-v92)
- `saveCurrentVehicle()` añadido al inicio de `saveHistorico()` en parte_combustible → tarjeta ya no se pierde al guardar sin PDF.
- `saveVehicleOR()` añadido al inicio de `saveOrden()` en orden_reparacion → marca/modelo ya no se pierden.

### Historial parte diario rediseñado (v93)
`parte_servicio_diario.html`: visor de partes guardados como `<details class="action-panel">` colapsable. Summary: "Mis partes del mes (N partes · M matrículas)".

### Último registro en menú principal (v94)
`index.html`: `updateModuleStats()` muestra debajo de cada tarjeta del menú el último registro guardado en ese módulo.

### Asteriscos campos obligatorios (v95)
CSS `.req { color: #e53e3e; }` en los 3 módulos. Campos marcados:
- Parte diario: Conductor/a*, Fecha*, Matrícula*
- Combustible: Mes / Año*, Matrícula*
- Orden reparación: Fecha*, Matrícula* (OR en validación)

### Conductor por repostaje (v101)

`parte_combustible.html`: cuando hay más de un conductor en el parte, cada repostaje puede asociarse al conductor que lo realizó.

- **UI:** select `#nf_gc` / `#nf_dc` siempre visible bajo los campos del formulario. Con 1 conductor → auto-seleccionado. Con N → dropdown.
- **Almacenamiento:** campo `conductor` en cada entrada del JSON (`partes_combustible_hist_v1`). Compatible hacia atrás (entradas antiguas sin conductor = cadena vacía).
- **Tarjetas:** muestra `👤 Nombre` bajo los datos si hay conductor asignado.
- **Edición inline:** select conductor aparece solo si hay >1 conductores (con 1 no hay elección posible, el valor se preserva).
- **PDF `multiCond` flag** (`_condList.length > 1`):
  - Gasolina multiCond: 7 columnas, Conductor (w:48) en ci=5. TOTAL: `ML+81` L, `ML+107` €.
  - Gas-oil multiCond: 9 columnas, Conductor (w:44) en ci=7. TOTAL: `ML+55/71/89/107`.
  - Sin multiCond: layout original sin cambios.
  - Truncación de nombre con `getTextWidth()` + `…`.
- **PDF sección conductores:** auto-shrink 10→7pt + `splitTextToSize` para wrapping si no cabe.
- NR: 13 → 14 (máximo de repostajes por parte).
- Backup del original: `parte_combustible_v100_backup.html`.

**Bugs a evitar:** ver `memory/project_parte_combustible_estado.md` sección "Feature: Conductor por repostaje".

### Conductor en mayúsculas (v100)
`parte_servicio_diario` y `parte_combustible`: campo conductor muestra mayúsculas mientras se escribe (CSS) y convierte el valor al perder el foco. Se guarda siempre en mayúsculas. El PDF ya mostraba el valor del campo, por lo que también sale en mayúsculas.

### Formato matrícula con guión (v99)
Los 3 módulos: `normMat` normaliza la matrícula (sin separadores, mayúsculas) para almacenamiento; `fmtMat` la muestra con guión (MMA-05505). Migración automática de claves antiguas (con espacio o sin separador) al cargar la BD. El campo formatea al perder el foco. Retrocompatible con datos guardados.

### Fix autocompletado matrícula/conductor (v98)
`parte_servicio_diario.html`: corregido bucle destructivo entre `onMatriculaChangePD` y `onConductorChangePD`.
- `onMatriculaChangePD`: ya no borra el conductor si ya tiene contenido (solo lo limpia si la matrícula se vacía); solo autocompleta conductor desde BD si el campo está vacío.
- `onConductorChangePD`: ya no sobreescribe la matrícula si ya tiene contenido (solo autocompleta si está vacío).
- Causa: conductores que usaban una matrícula nueva (MMA05981) pero tenían otra matrícula guardada en BD — el autocompletado cruzado les borraba los datos al intentar corregir.

### Validación Conductor/a (v96)
`parte_servicio_diario.html`: añadida validación real en `validateParteData()` — el parte no se puede guardar ni generar PDF sin indicar el nombre del conductor/a.

### Purga fotos antiguas de localStorage (v97)
`storage.js`: función privada `stripOldPhotos()` — cuando hay archivo JSON vinculado, las fotos de entradas con más de 3 meses se eliminan de localStorage (pero se conservan en el JSON durante 6 meses). Evita que localStorage se llene con Base64 acumulado.
- `mergeData()` actualizado para recuperar fotos del archivo cuando localStorage no las tiene (evita que el merge borre fotos del JSON progresivamente).
- `saveHistorico()` en `parte_combustible.html` añade `try/catch` con `showErr` para `QuotaExceededError`.

---

## Archivos de prueba en prueba/ (NO desplegar)
- `parte_servicio_diario_historial_test.html`
- `parte_combustible_tabs.html` / `_tabs_a.html` / `_tabs_b.html`
- `parte_combustible_conductor_test.html` — prototipo de la feature conductor (ya integrada en el real)
- `parte_combustible_v100_backup.html` — backup pre-v101

---

## Pendientes

- **Desplegar v103** (coma decimal + avisos + dedup): pasar `bash tests/run_tests.sh`, commit, push, bump `sw.js` a v103.
- **Añadir `test_adversarial.js` a `tests/`** al cerrar la ronda v103 (ya escrito, 30 asserts).
- **Entregar a la usuaria el JSON corregido** (`partes_copia_2026-07-03.json`, local, gitignoreado) y que confirme que le llega la v102.
- **km de junio en blanco**: avisar a los responsables de `MMM06038/MMM05520/MMM04024/MMM05422` para que reintroduzcan `km_ini/km_fin` de junio a mano (irreconstruibles).
- **Validación en móvil real**: la suite cubre lógica en Chromium desktop; falta un ciclo completo en Android (PWA instalada, cámara, vinculación real del JSON).
- **DECISIÓN APLAZADA (2026-07-06) — arrastre de conductores a mes nuevo:** hoy la lista de conductores de combustible NO se precarga al abrir un mes nuevo del mismo vehículo (hay que reescribirla). Se decidió dejarlo así por ahora. Si se cambia de opinión: precargar desde el mes más reciente de la misma matrícula al crear el registro (opción recomendada en su día; ver conversación 2026-07-06).
- **Chips:** validar con beta testers. Si rechazo → `memory/project_chips_tabs_revert.md`.
- **Concepto en OR:** sin asterisco ni validación — pendiente decisión (de momento se deja sin tocar).
- **Backend separado:** `~/partes-server` WSL puerto 3001 → `memory/project_partes_backend.md`.

---

## Funciones clave

| Función | Archivo | Qué hace |
|---------|---------|---------|
| `saveCurrentVehicle()` | parte_combustible | Guarda marca/modelo/tarjeta/coste en BD vehículos |
| `saveVehicleOR()` | orden_reparacion | Guarda marca/modelo en BD vehículos |
| `saveCurrentVehiclePD()` | parte_servicio_diario | Guarda marca/modelo en BD vehículos |
| `updateModuleStats()` | index.html | Último registro en tarjetas del menú |
| `renderSavedDays()` | parte_servicio_diario | Lista de partes del mes seleccionado |
| `saveHistorico()` | parte_combustible | Guarda parte mensual + BD vehículos |
| `saveOrden()` | orden_reparacion | Guarda orden + BD vehículos |
| `validateParteData()` | parte_servicio_diario | Valida fecha + conductor/a + matrícula + contadores + horas |

---

## Colores del proyecto

| Color | Uso |
|-------|-----|
| `#e5eef4` | Fondo chips bar (claro), botones `.btnc` |
| `#0e1c2e` | Fondo chips bar (oscuro), card headers dark |
| `#5a7184` | Texto secundario |
| `#0f6f9c` | Azul principal (brand) |
| `#0d1520` | Inputs modo oscuro |
| `#e53e3e` | Asterisco campos obligatorios |
