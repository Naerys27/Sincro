# Plan — Implementar sincronización Google Drive en Sincro

## Contexto

La PWA "Partes de Locomoción" solo sincroniza hoy vía archivo JSON local (File System
Access API), que no funciona en Android. Se decidió (diseño aprobado en
`Sincro/dev/2026-07-09-google-drive-sync-design.md`) sustituirlo por sincronización
automática con Google Drive (`appDataFolder`, scope `drive.appdata`, GIS + REST con
`fetch`, sin backend). Se desarrolla en el fork **Sincro**
(`...\ProyectoGithub\Sincro`, publicado en https://naerys27.github.io/Sincro/), sin
tocar producción (`prueba`).

Claves del diseño: localStorage = fuente de verdad local; Drive = un único
`partes_datos.json`; se reutiliza `mergeData()` de `storage.js`; sync al abrir/volver a
primer plano/tras guardar (debounce 3 s)/sondeo 30 s; reconexión nunca bloqueante,
aviso máx. 1/día.

## Fase 0 — Google Cloud Console (usuario, guiado, ~15 min)

Con el Gmail personal del usuario en https://console.cloud.google.com:
1. Crear proyecto (ej. "partes-locomocion").
2. Habilitar **Google Drive API**.
3. Pantalla de consentimiento OAuth: tipo Externo, publicar en producción (scope
   `drive.appdata` es no sensible — sin verificación).
4. Credencial **OAuth client ID** tipo "Web application" con orígenes JavaScript
   autorizados: `https://naerys27.github.io` y `http://localhost:8080`.
5. Guardar el **Client ID** resultante (no hay client secret en este flujo).

El código de la Fase 1 puede escribirse en paralelo con un placeholder de Client ID.

## Fase 1 — Código (todo en Sincro)

### 1.1 Nuevo `drivesync.js` (archivo principal de la feature)

IIFE global `DriveSync`, mismo estilo que `storage.js` (var, sin ES6 modules).

- **Constantes:** `CLIENT_ID`, `SCOPE = 'https://www.googleapis.com/auth/drive.appdata'`,
  `FILE_NAME = 'partes_datos.json'`, `POLL_MS = 30000`, `DEBOUNCE_MS = 3000`,
  `NAG_INTERVAL_MS` (aviso reconexión 1/día).
- **Auth:** carga bajo demanda del script GIS (`https://accounts.google.com/gsi/client`
  inyectado solo al conectar/renovar); `initTokenClient` + `requestAccessToken`.
  Renovación silenciosa (`prompt: ''`) y, si falla, reintento aprovechando el siguiente
  gesto del usuario. Token cacheado en `sessionStorage` con su expiry (matiz sobre el
  diseño, que decía "solo memoria": la app es multipágina — index ↔ módulos — y sin
  cache por pestaña habría que renegociar token en cada navegación; sessionStorage se
  limpia al cerrar pestaña y no hay scripts de terceros. Actualizar el design doc).
- **API Drive (fetch puro):** `findFile()` (files.list en appDataFolder),
  `createFile()`, `download()` (alt=media), `getVersion()` (fields=version),
  `upload()` (PATCH uploadType=media).
- **Anti-pisado:** antes de cada subida, `getVersion()`; si la versión remota cambió
  desde la última vista, descargar + merge + entonces subir (matiz: Drive API v3 no
  soporta If-Match real; la ventana de carrera restante es inocua porque el merge por
  `updatedAt` converge en el siguiente ciclo. Actualizar design doc).
- **Ciclo `syncNow()`:** token → fileId (buscar/crear, cachear en localStorage
  `drive_sync_meta`) → comparar versión → descargar/merge/subir según toque.
- **Disparadores:** al cargar la página, `visibilitychange` → visible, evento `online`,
  `setInterval(POLL_MS)` solo con pestaña visible, y notificación de cambio desde
  FSStorage (debounce 3 s).
- **Estado para UI:** `DriveSync.getStatus()` (`disconnected | synced | pending |
  reauth_needed`) + `DriveSync.onStatusChange(cb)`, `connect()`, `disconnect()`,
  `lastSyncTime()`.
- **Indicador discreto en módulos:** función que pinta un chip flotante pequeño solo en
  estado `reauth_needed` (máx. 1 aviso/día, `localStorage` clave del último aviso); un
  toque → popup de Google.

### 1.2 `storage.js` — simplificar y abrir puntos de enganche

- **Retirar el canal File System Access** (Drive lo sustituye, decisión de diseño):
  eliminar `_handle`, `setup()`, `reconnect()`, `showReconnectBanner()`, lecturas de
  IndexedDB del file handle. `FSStorage.getItem/setItem/removeItem` quedan sobre
  localStorage + notificación de cambios. La API pública que usan los 3 módulos NO
  cambia.
- **Exponer `FSStorage.mergeData`** (hoy es función privada del IIFE) para que
  `drivesync.js` la reutilice tal cual.
- **Hook de cambios:** `FSStorage.onWrite(cb)` — `setItem/removeItem` lo invocan;
  `drivesync.js` se suscribe para el debounce de subida.
- **`stripOldPhotos()`:** hoy solo purga si hay archivo vinculado (`_active`); pasar la
  condición a "Drive conectado" (el JSON completo con fotos vive en Drive).

### 1.3 `index.html` — panel "Sincronización con Google"

Reescribir el bloque `storage-panel` (`#st-warn/#st-pend/#st-ok`,
[index.html:314-337](../Sincro/index.html#L314)) y `updateStorageUI()`
([index.html:345](../Sincro/index.html#L345)):

- Sin conectar → aviso "Datos sin proteger" con botón **"Conectar con Google"**
  (→ `DriveSync.connect()`).
- Conectado → `☁️ Sincronizado hace X min` / `☁️ Pendiente de sincronizar` + botón
  "Desconectar".
- `reauth_needed` → "Toca para reconectar" (mismo patrón visual actual `st-pend`).
- Retirar `setupFile()/storageReconnect()/storageDisconnect()` del archivo antiguo y
  el aviso `#st-nosup` (ya no aplica: Drive funciona en cualquier navegador moderno).
- Exportar/importar copia manual: **sin cambios** (ya operan vía FSStorage).

### 1.4 Los 3 módulos HTML

`parte_servicio_diario.html`, `parte_combustible.html`, `orden_reparacion.html`:
añadir `<script src="drivesync.js"></script>` tras `storage.js`. Nada más — leen y
escriben por FSStorage, y el indicador discreto lo inyecta drivesync.js.

### 1.5 `sw.js`

Añadir `drivesync.js` a `FILES` y bump de caché a `sincro-v2`.
El script GIS es externo y NO se cachea (se carga solo online, por diseño).

## Fase 2 — Verificación

1. **Tests nuevos** `tests/test_drivesync.js` (Playwright, mock de `fetch` a
   `googleapis.com` y stub del token): primer sync sube estado local; remoto más nuevo
   gana merge; conflicto de versión → re-merge sin pérdida; offline → pendiente →
   reintento en `online`; debounce agrupa guardados. Registrar `page.on('dialog')`
   (gotcha conocido).
2. **Suite existente en verde:** `bash tests/run_tests.sh` (via WSL) — los módulos no
   cambian su API de datos, pero storage.js sí cambia por dentro.
3. **E2E manual local:** `python -m http.server 8080` + cuenta Google real del usuario;
   dos perfiles de Chrome simulando dos dispositivos (mismo origen ⇒ usar perfiles
   distintos, gotcha documentado): crear parte en A → aparece en B tras el sondeo;
   editar en B → vuelve a A.
4. **Deploy a Sincro** (push del usuario vía GitHub Desktop) y prueba real
   Android ↔ PC varios días midiendo la frecuencia real del aviso de reconexión.

## Documentación al cerrar

- Actualizar `Sincro/CLAUDE.md` y `HANDOVER.md` (arquitectura storage nueva, Drive).
- Ajustar design doc: sessionStorage para token, versión-antes-de-subir en vez de
  If-Match.
- `dev/errores.md` con cualquier incidencia real que surja.

## Fuera de alcance (explícito)

- Optimización de fotos en archivos separados (solo si la prueba real lo pide).
- Importar con merge en vez de reemplazo (mejora opcional apuntada).
- Cambios en `prueba` (producción): fix prefijo sw.js + enlace importar quedan
  anotados para su próximo deploy, no forman parte de esto.
