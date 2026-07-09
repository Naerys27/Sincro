# Errores — Sincro

Registro de errores/incidencias reales encontrados durante el desarrollo.
Formato por entrada: **Síntoma / Causa / Solución**.

Los errores históricos anteriores al fork (v91–v103) están consolidados en
`errores.md` de la raíz del repo `prueba` — aplican también a este código.

---

## 2026-07-09 — Los Service Workers de `prueba` y `Sincro` se borrarían la caché mutuamente

- **Síntoma:** detectado al crear el fork, antes de que llegara a producirse: ambas apps se sirven desde el mismo origen (`naerys27.github.io`) y comparten el almacén de Cache Storage. El `activate` de cada `sw.js` borraba **toda** caché cuyo nombre no coincidiera con la suya (`keys.filter(k => k !== CACHE)`), así que cada actualización de una app destruiría la caché offline de la otra.
- **Causa:** el filtro de limpieza de cachés antiguas asumía que la app es la única del origen — cierto hasta ahora, falso al convivir dos deploys en el mismo dominio de GitHub Pages.
- **Solución:** en Sincro, caché renombrada a `sincro-v1` y filtro restringido al propio prefijo: `k.startsWith('sincro-') && k !== CACHE`. **Pendiente:** aplicar el fix equivalente en `prueba` (`k.startsWith('partes-loco-')`) en su próximo deploy; hasta entonces, cada deploy de producción borrará la caché de Sincro (sin pérdida de datos, solo re-descarga).

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
