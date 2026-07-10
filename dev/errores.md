# Errores — Sincro

Registro de errores/incidencias reales encontrados durante el desarrollo.
Formato por entrada: **Síntoma / Causa / Solución**.

Los errores históricos anteriores al fork (v91–v103) están consolidados en
`errores.md` de la raíz del repo `prueba` — aplican también a este código.

---

## 2026-07-10 — XSS almacenado explotable vía sincronización + fallback del SW envenenaba respuestas de API (revisión de seguridad, sincro-v8)

- **Síntoma:** detectado en revisión de seguridad proactiva (agente security-reviewer), no en uso real. Cuatro hallazgos: (1) `renderHistorico()` en `parte_combustible.html` concatenaba campos del histórico sincronizado (`kms`, `eur`, `lit`, `fecha`, `mes`...) en `innerHTML` sin escapar; (2) las fotos (`photos[idx].data` / `rowPhotos`) iban crudas a `<img src="...">` vía `innerHTML` en tres puntos (histórico, tarjetas de repostaje, editor inline); (3) los botones Editar/Borrar/Cargar de parte diario y orden de reparación usaban `onclick="fn('${escapeHtml(id)}')"` inline; (4) el `fetch` handler de `sw.js` respondía con `index.html` a CUALQUIER petición fallida, incluidas las llamadas a la API de Drive.
- **Causa:** (1-2) omisión de `escapeHtml()` en rutas de render que existían antes de la sincronización — entonces el dato solo podía escribirlo el propio usuario en su dispositivo; con Drive sync, un registro manipulado en un dispositivo se ejecuta en todos los demás (XSS almacenado cross-device), pudiendo robar el token OAuth de `sessionStorage`. (3) `escapeHtml` protege el contexto HTML pero NO el contexto JavaScript-en-atributo: el navegador des-escapa las entidades antes de interpretar el `onclick`, así que un id como `');payload//` rompe la comilla y ejecuta — bypass clásico. (4) el fallback offline pensado para navegaciones se aplicaba a todo, de modo que con red inestable `download()` podía recibir HTML con status 200, tratarlo como remoto vacío `{}` y enmascarar errores de sync.
- **Solución (sincro-v8):** (1) `escapeHtml()` en todos los campos interpolados de `renderHistorico`, tarjetas de repostaje y atributos `value` del editor inline; (2) fotos validadas con `/^data:image\/(jpeg|png|webp);/` y construidas con `createElement` + `.src` (o escapadas donde siguen en template); (3) `onclick` inline sustituido por `data-id` escapado + `addEventListener` con el id leído de `getAttribute` (patrón que ya usaba bien parte_combustible); (4) `sw.js` ignora peticiones a otros orígenes (Drive/GIS pasan directas a red) y el fallback a `index.html` solo aplica si `request.mode === 'navigate'`.
- **Nota:** los puntos 1-3 son heredados del fork — `prueba` (producción) tiene el mismo código de render y debería recibir el mismo fix en su próximo deploy (allí el riesgo es menor al no haber sync, pero el hueco existe).

## 2026-07-10 — Parte creado en el móvil no llegaba al PC (investigación multi-sesión)

- **Síntoma:** al crear un parte diario en el móvil, no aparecía en el PC pese a esperar, recargar y comprobar que ambos dispositivos mostraban "Sincronizado con Google Drive" con la misma cuenta.
- **Investigación:** se descartaron, con evidencia directa (consulta a `files.list` de Drive, snapshots de `drive_sync_meta_v1`), tres hipótesis antes de dar con la causa: (1) bug en `mergeData()`/lápidas — descartado por lectura de código; (2) archivo duplicado en `appDataFolder` por dos dispositivos creándolo a la vez — descartado, solo existía un `fileId`; (3) bug en el path de escritura a `localStorage` del móvil — descartado por lectura de código. La versión remota (`lastVersion`) seguía sin subir pese a que el móvil mostraba "Sincronizado", indicando que la subida nunca llegaba a completarse realmente pero la UI no lo reflejaba.
- **Causa raíz (probable):** la misma race condition del botón "Reconectar" corregida en `sincro-v6` (ver entrada anterior) — el listener de clic global consumía el lock `_syncing` antes de que la llamada explícita de `connect()`/reconexión terminara, dejando el dispositivo en un estado de "sincronizado" aparente sin que la subida real se completara. Al no forzarse nunca una reconexión limpia tras el fix, el móvil se quedó en ese estado colgado hasta que se limpiaron manualmente los datos del sitio (localStorage + caché) y se reconectó desde cero.
- **Herramienta de diagnóstico creada:** panel visible en pantalla activable con `?debug=1` en la URL de cualquier módulo (sin necesitar DevTools/USB, útil en PC corporativo con restricciones) — muestra `DriveSync.getStatus()`, `drive_sync_meta_v1` y los últimos 5 partes diarios, con auto-refresco cada 2s. Añadido en `sincro-v7`.
- **Verificación:** tras reconectar el móvil desde cero (datos del sitio borrados), tanto la creación de partes nuevos como el borrado (lápidas) se propagan correctamente entre móvil y PC en ambas direcciones, confirmado con capturas del panel `?debug=1` en los dos dispositivos mostrando el mismo `lastVersion` y los mismos registros.
- **Limitación conocida:** no se pudo confirmar con certeza absoluta que la causa fuera exclusivamente la race condition (no se capturó evidencia directa del móvil en el momento exacto del fallo original, por la restricción de USB debugging en el PC corporativo del usuario). Si el problema reaparece, usar el panel `?debug=1` para capturar el estado antes/después de crear un parte y descartar otras causas.

## 2026-07-09 — "Reconectar" mostraba "No se pudo conectar con Google" aunque sí sincronizaba

- **Síntoma:** al tocar el botón "Reconectar" (estado `reauth`), el popup de Google se abría y cerraba rápido, saltaba una alerta "No se pudo conectar con Google. Inténtalo de nuevo." — pero el panel pasaba a "Sincronizado con Google Drive · ahora" igualmente.
- **Causa:** carrera entre dos llamadas a `syncNow()`. El listener de clic global (capture-phase, pensado para "reintento silencioso a caballito del siguiente gesto" en los módulos sin botón explícito) se dispara con CUALQUIER clic mientras `_status === 'reauth'` — incluido el propio clic sobre el botón "Reconectar". Por ser capture-phase se ejecuta ANTES que el `onclick` del botón: arranca un `syncNow(false)` silencioso que marca `_syncing = true`. Cuando a continuación corre `syncConnect() → DriveSync.connect() → syncNow(true, true)` (la llamada explícita con `select_account`), la encuentra ya en curso y se descarta (`_syncing` ya true → `_syncAgain = true`, resuelve con `ok = undefined`), disparando la alerta de error aunque el reintento silencioso de fondo termine sincronizando bien un instante después.
- **Solución:** el listener global ignora los clics sobre elementos con la clase `ds-connect-btn` (los botones "Conectar con Google" / "Reconectar" en `index.html`, que ya disparan `syncConnect()` explícitamente). Así solo un flujo pide el token en cada clic sobre esos botones.

## 2026-07-09 — "Conectar con Google" no dejaba elegir cuenta si ya había una sesión activa

- **Síntoma:** en un navegador con una cuenta de Google ya logueada, el botón "Conectar con Google" no mostraba el selector de cuentas — usaba directamente la sesión activa, sin opción de elegir otra.
- **Causa:** `requestToken()` llamaba a `requestAccessToken({})` para el flujo interactivo, sin especificar `prompt`. GIS interpreta eso como "usa la sesión que haya", saltándose el selector si detecta una cuenta ya logueada (más agresivo aún con FedCM en Chrome moderno).
- **Solución:** `DriveSync.connect()` (el botón explícito de conectar) ahora limpia cualquier token cacheado en `sessionStorage` y pide el token con `prompt: 'select_account'`, forzando siempre el selector de cuentas. La renovación silenciosa en segundo plano (sondeo, debounce) sigue usando `prompt: 'none'` sin tocar — no debe interrumpir a la usuaria. El reintento tras `reauth` (chip "toca para reconectar") tampoco fuerza selector: es una renovación de la misma cuenta ya conectada, no un cambio de cuenta.

## 2026-07-09 — Los Service Workers de `prueba` y `Sincro` se borrarían la caché mutuamente

- **Síntoma:** detectado al crear el fork, antes de que llegara a producirse: ambas apps se sirven desde el mismo origen (`naerys27.github.io`) y comparten el almacén de Cache Storage. El `activate` de cada `sw.js` borraba **toda** caché cuyo nombre no coincidiera con la suya (`keys.filter(k => k !== CACHE)`), así que cada actualización de una app destruiría la caché offline de la otra.
- **Causa:** el filtro de limpieza de cachés antiguas asumía que la app es la única del origen — cierto hasta ahora, falso al convivir dos deploys en el mismo dominio de GitHub Pages.
- **Solución:** en Sincro, caché renombrada a `sincro-v1` y filtro restringido al propio prefijo: `k.startsWith('sincro-') && k !== CACHE`. **Pendiente:** aplicar el fix equivalente en `prueba` (`k.startsWith('partes-loco-')`) en su próximo deploy; hasta entonces, cada deploy de producción borrará la caché de Sincro (sin pérdida de datos, solo re-descarga).

## 2026-07-09 — Un parte borrado "resucitaba" al sincronizar con otro dispositivo

- **Síntoma:** el usuario borra un parte en el PC; al rato el móvil sigue mostrándolo y, tras sincronizar, el parte reaparece también en el PC. Detectado en la primera prueba real Android↔PC.
- **Causa:** `mergeData()` hace unión por `id`: "el remoto tiene un registro que el local no tiene" es indistinguible de "otro dispositivo creó un registro nuevo", así que el merge restauraba lo borrado. Hueco de diseño clásico de sincronización sin registro de borrados.
- **Solución:** lápidas (tombstones) en `storage.js`, clave `partes_tombstones_v1` (sincronizada como una clave de datos más). `setItem` detecta ids desaparecidos en partes diarios, órdenes e histórico de combustible y registra `clave|id → fecha de borrado`; si un id reaparece, su lápida se retira. `mergeData` excluye todo registro cuya lápida sea más reciente que su `updatedAt` (una re-creación posterior gana a la lápida) y fusiona las lápidas quedándose con la más reciente, purgando las de más de 180 días. Regresión: `tests/test_tombstones.js` (8 asserts) + escenario e2e en `test_drivesync.js`.
- **Limitación conocida aceptada:** conductores y BD de vehículos siguen fusionándose por unión pura (no tienen timestamps por registro) — borrar un conductor de la lista puede reaparecer tras sincronizar hasta que el dedup del siguiente guardado lo limpie. Se abordará solo si molesta en el uso real.

## 2026-07-09 — Tras conectar Google, el index no mostraba los datos sincronizados hasta recargar

- **Síntoma:** al conectar la cuenta de Google (o al llegar datos de otro dispositivo), la página de inicio seguía mostrando el estado anterior (tarjetas "último registro" vacías/viejas) hasta recargar a mano. Detectado por el usuario en la primera prueba real.
- **Causa:** la sincronización escribe los datos fusionados en localStorage, pero el index ya estaba renderizado y nada re-ejecutaba `updateModuleStats()`. Los módulos no lo sufren porque leen storage al abrirse.
- **Solución:** `DriveSync.onDataChange(cb)` — drivesync notifica cuando un pull trae cambios remotos (versión distinta), e `index.html` refresca las tarjetas al recibirlo. Assert de regresión añadido a `tests/test_drivesync.js`. Limitación conocida aceptada: un módulo ya abierto con datos en pantalla no re-renderiza su vista si llegan cambios remotos de fondo (se ven al reabrir); se decidirá si merece cableado por módulo tras la prueba real.

## 2026-07-09 — Test de sync perdía una escritura: el Service Worker recargaba la página a mitad de test

- **Síntoma:** en `tests/test_drivesync.js`, la subida tras el debounce ocurría exactamente 1 vez pero SIN el dato recién escrito; `dirty` quedaba en false y el dato desaparecía también de localStorage. Parecía una carrera de datos en `drivesync.js`.
- **Causa:** no era un bug de la app. Al cargar `index.html` en el test, el SW se instala, hace `clients.claim()` → `controllerchange` → `index.html` ejecuta `window.location.reload()` (comportamiento intencionado de actualización). La recarga re-ejecuta el `addInitScript` de Playwright, que **resetea localStorage a los datos-semilla del test**, borrando la escritura y el `fileId`; el drivesync recién cargado subía ese estado reseteado. Diagnóstico: instrumentación del mock con timestamps — el sync delator empezaba con `findFile` (imposible con `fileId` cacheado) 55ms después de la escritura, y `navigator.serviceWorker.controller` pasaba a `true` justo después.
- **Solución:** `browser.newContext({ serviceWorkers: 'block' })` en el test. **Gotcha general a recordar:** cualquier test Playwright que cargue `index.html` con `addInitScript` destructivo debe bloquear service workers, o el reload por `controllerchange` re-sembrará el estado a mitad de test.

## 2026-07-09 — Función de importar copia inaccesible (feature huérfana)

- **Síntoma:** existía el enlace "exportar copia de todos los datos" en `index.html`, pero ninguna forma visible de importar una copia exportada.
- **Causa:** `importAllData()` y su `<input type="file" id="import-all-input">` oculto estaban implementados, pero ningún elemento de la UI disparaba el `.click()` del input — la feature quedó a medias en algún momento.
- **Solución:** añadido enlace "↑ importar copia de datos" junto al de exportar que dispara el input oculto. Nota de comportamiento: la importación **reemplaza** cada módulo presente en el archivo (no fusiona); mejora opcional futura: importar vía `mergeData()`. Mismo fix aplicable a `prueba` en su próximo deploy.
