# Diseño — Sincronización Google Drive (Android ↔ PC)

**Fecha:** 2026-07-09 · **Proyecto:** Sincro (fork de `prueba` para desarrollar esta feature)
**Estado:** aprobado en conversación, pendiente de implementación

---

## Objetivo

Sincronización automática de los datos de la PWA entre los dispositivos de una misma
usuaria (Android ↔ PC), sin backend propio, usando la Google Drive API con
`appDataFolder`. Sustituye al mecanismo actual de archivo JSON vinculado
(File System Access API), que no funciona en Android.

## Decisiones tomadas

| Decisión | Elección |
| --- | --- |
| Alcance | Por usuaria: cada una sincroniza SUS dispositivos con SU cuenta de Google. Sin compartición entre usuarias (limitación aceptada de `appDataFolder`). |
| Mecanismo actual (archivo JSON vinculado) | Drive lo **sustituye** — se retira la vinculación de archivo local. |
| Momento de sync | Automático: al abrir, al volver a primer plano, tras guardar (debounce 3 s) y sondeo periódico cada 30 s con pestaña visible. |
| Autenticación | Google Identity Services (GIS, script oficial cargado bajo demanda) + Drive REST API con `fetch` puro. Sin `gapi`. |
| Scope OAuth | `drive.appdata` — no sensible: sin proceso de verificación de Google, sin límite de usuarias, sin pantalla de advertencia. |
| Coste | Cero. Proyecto de Google Cloud Console gratuito con Gmail personal; el archivo consume la cuota de Drive de cada usuaria (~pocos MB). |

## Arquitectura

Archivo nuevo **`drivesync.js`** junto a `storage.js`. `FSStorage` sigue siendo la única
puerta de acceso a datos para los 3 módulos HTML (su API `getItem`/`setItem` no cambia).

- **localStorage = fuente de verdad local.** Todo se escribe ahí primero, siempre, con o
  sin red. La app funciona al 100% sin Google (igual que hoy).
- **Drive = un único archivo `partes_datos.json`** en `appDataFolder` (oculto, privado,
  solo esta app puede leerlo; la usuaria no puede borrarlo por accidente desde la UI de
  Drive). Mismo formato que el JSON actual → **`mergeData()` existente se reutiliza tal
  cual** (merge por `updatedAt`, campo a campo en vehículos, dedup por `id`).

## Flujo de datos

**Al abrir la app / volver a primer plano:**
carga instantánea desde localStorage → (fondo) token silencioso → descargar JSON de
Drive → `mergeData(remoto, local)` → resultado a localStorage → subir si hubo cambios
locales que el remoto no tenía.

**Al guardar** (parte, orden, vehículo, conductor):
escritura inmediata en localStorage → subida a Drive con **debounce de 3 s** (varios
guardados seguidos = una subida) → si falla (sin red / sin token), estado "pendiente" y
reintento en evento `online`, al volver a primer plano, o en el siguiente guardado.

**Sondeo periódico:** cada **30 s**, solo con la pestaña visible
(`document.visibilityState === 'visible'`), petición ligera de metadatos
(`files.get` con `fields=version`). Solo si la versión remota cambió se descarga y
mergea. Constante nombrada `POLL_MS = 30000` — ajustable cambiando la constante.

**Protección contra pisado entre dispositivos:** antes de cada subida se comprueba la
`version` remota y, si cambió (u hay cambios locales), **siempre se descarga y se pasa
por `mergeData()` antes de subir** — nunca se sube sin merge previo. (Ajuste sobre el
diseño original: Drive API v3 no soporta precondición If-Match real en `files.update`;
la ventana de carrera restante es inocua porque el merge por `updatedAt` converge en el
siguiente ciclo de sondeo.)

**Nota sobre edición concurrente:** si el MISMO parte se edita en dos dispositivos sin
sync entre medias, gana la edición con `updatedAt` más reciente (no hay fusión campo a
campo dentro de un parte). Aceptado: el flujo real es secuencial (móvil → luego PC).

## Autenticación y fricción de reconexión

- Script GIS (`https://accounts.google.com/gsi/client`) cargado **solo al conectar o
  renovar** — excepción justificada y mínima a la regla "sin CDN": autenticar requiere
  red por definición; offline la app entera funciona sin él.
- Token de acceso (~1 h de vida) en **`sessionStorage`** — nunca en localStorage.
  (Ajuste sobre el diseño original "solo memoria": la app es multipágina, index ↔
  módulos, y sin caché por pestaña habría que renegociar el token en cada navegación;
  sessionStorage muere al cerrar la pestaña y no hay scripts de terceros en la app.)
- Renovación: primero silenciosa (`prompt: ''`; FedCM en Chrome moderno la hace fiable
  incluso con cookies de terceros bloqueadas). Si falla, se reintenta **a caballito del
  siguiente gesto de la usuaria** (tocar "Guardar", abrir un módulo) — contexto con
  gesto de usuario donde el navegador permite el popup si hiciera falta.
- **La reconexión nunca bloquea nada**: sin token la app funciona entera en local y los
  cambios quedan pendientes de subir.
- Aviso "toca para reconectar": indicador discreto (no banner que tapa), **máximo 1 vez
  al día**.

## UI (index.html)

La sección actual de "vincular archivo" pasa a ser **"Sincronización con Google"**:

- Botón "Conectar con Google" → popup de Google → elegir cuenta → listo. Una vez por
  dispositivo.
- Estado visible: `☁️ Sincronizado hace X min` / `☁️ Pendiente de sincronizar` /
  `Sin conectar` / `toca para reconectar`.
- Botón "Desconectar": deja de sincronizar; los datos locales permanecen.
- **Exportar/importar copia manual se mantienen tal cual** — red de seguridad
  independiente de Google (leen vía `FSStorage`, no requieren cambios).

## Errores y casos límite

- Sin red / Drive caído → app funciona igual; estado "pendiente"; reintento automático.
- `QuotaExceededError` → ya manejado en los 3 módulos.
- La usuaria borra los datos de la app desde ajustes de Drive → la app detecta archivo
  inexistente, sube el estado local completo y sigue.
- Dos dispositivos suben "a la vez" → precondición de versión + re-merge (arriba).
- PC corporativo AGE: validar en fase de prueba que las políticas no bloquean el popup
  de Google (requisito: sesión de Gmail **personal** en el navegador, no la cuenta AGE).

## Llamadas a la Drive API (todas con `fetch`)

| Operación | Llamada |
| --- | --- |
| Buscar el archivo | `GET files?spaces=appDataFolder&q=name='partes_datos.json'` |
| Crear | `POST upload/drive/v3/files?uploadType=multipart` con `parents:["appDataFolder"]` |
| Descargar | `GET files/{id}?alt=media` |
| Comprobar versión (sondeo) | `GET files/{id}?fields=version` |
| Actualizar | `PATCH upload/drive/v3/files/{id}?uploadType=media` |

## Tests

- Nuevos tests unitarios del ciclo de sync con la API de Drive **simulada** (mock de
  `fetch`): merge remoto/local, conflicto de versión, reintento offline, debounce.
  Se añaden a `tests/`.
- La suite existente (~130 asserts) debe seguir en verde — los módulos no cambian su
  API de datos.
- **Validación empírica en Android real (fase 2):** medir la frecuencia real del aviso
  de reconexión durante varios días de uso antes de plantear el paso a producción.

## Fases

1. **Fase 0 — Google Cloud Console (usuario, ~15 min guiado):** crear proyecto, activar
   Drive API, credencial OAuth "Web application" con orígenes autorizados
   `https://naerys27.github.io` y `http://localhost:8080`.
2. **Fase 1 — Implementación:** `drivesync.js`, integración en `storage.js`/`FSStorage`,
   UI de conexión y estado en `index.html`.
3. **Fase 2 — Validación:** tests + prueba real Android↔PC varios días con la cuenta del
   desarrollador. Decisión de paso a producción (`prueba`) a la vista de los resultados.

## Ajustes ya aplicados al fork Sincro (2026-07-09)

- `sw.js`: caché `sincro-v1`; el `activate` solo borra cachés con prefijo `sincro-`
  (mismo origen que producción — sin esto se borrarían mutuamente).
- `manifest.json`: nombre "(Sincro)" para distinguir la PWA instalada.
- **Pendiente en producción** (`prueba`, próximo deploy): mismo fix de prefijo en su
  `sw.js` (`k.startsWith('partes-loco-')`).
- **Aviso:** mismo origen ⇒ `prueba` y `Sincro` **comparten localStorage** en un mismo
  navegador. Probar Sincro en otro perfil de Chrome u otro dispositivo.

## Consideración futura — migración a servidor interno de la organización

Si la web se muda de GitHub Pages a un servidor propio de la organización, la
sincronización sigue funcionando sin cambios de código ni de proyecto Google Cloud:
solo hay que **añadir el nuevo origen** a "Orígenes de JavaScript autorizados" del
cliente OAuth. Requisitos que debe cumplir ese servidor para que Google lo acepte:

1. **HTTPS con certificado válido** (Google no acepta `http://` salvo localhost).
2. **Dominio real** (no IPs a pelo ni `.local`; vale un dominio real que solo resuelva
   en la intranet, p. ej. `partes.chtajo.es`).
3. **Salida a internet de los clientes** hacia `accounts.google.com` y
   `googleapis.com` — la web puede ser intranet, pero el sync habla con Google.
   Si el proxy corporativo los bloquea en los PCs, la app funciona local-first pero
   sin sync en esos PCs.

Los datos de las usuarias viven en sus Drives: la migración de hosting no los toca.

## Descartado (no volver a proponer)

| Qué | Por qué |
| --- | --- |
| OneDrive / Graph API | Cuenta corporativa AGE sin registro de apps en Azure. |
| Carpeta sincronizada de Drive/OneDrive Desktop + File System Access API | No funciona en Android (sin carpeta real del filesystem ni `showSaveFilePicker`). |
| Backend propio | Descartado por el usuario (sin hosting viable para los móviles). |
| OAuth implícito por redirect (sin script GIS) | Renovar token = redirect completo de página, riesgo de perder formularios a medias. |
| Librería `gapi` completa | Más peso sin ventaja frente a GIS + REST con `fetch`. |
