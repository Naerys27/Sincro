# Errores — Sincro

Registro de errores/incidencias reales encontrados durante el desarrollo.
Formato por entrada: **Síntoma / Causa / Solución**.

Los errores históricos anteriores al fork (v91–v103) están consolidados en
`errores.md` de la raíz del repo `prueba` — aplican también a este código.

---

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
