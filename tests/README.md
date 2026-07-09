# Tests de regresión — Partes de Locomoción

Batería automatizada que prueba la app en un navegador real (Playwright/Chromium): rellena formularios, cambia entre matrículas, edita, borra y genera PDFs como lo haría un usuario, y comprueba que los datos guardados son exactamente los esperados.

**Regla de oro: ejecutar SIEMPRE antes de cada deploy.** Si algún test falla, no subir.

## Requisitos (una sola vez)

Node.js y Playwright. En WSL/Linux:

```bash
mkdir -p ~/scratch/pw-prueba && cd ~/scratch/pw-prueba
npm i playwright
npx playwright install chromium
# si faltan librerías del sistema: npx playwright install-deps chromium (o via apt como root)
```

## Ejecutar

Desde la raíz del repo:

```bash
bash tests/run_tests.sh
```

El script sirve el repo en `http://localhost:8899` (si no hay ya un servidor), lanza todos los `tests/test_*.js` y termina con `RESULTADO GLOBAL`. Si Playwright está instalado en otra ruta: `PW_DIR=/ruta bash tests/run_tests.sh`.

## Qué cubre cada archivo

| Archivo | Cubre | Origen |
|---|---|---|
| `test_ambiguo.js` | Autofill conductor→matrícula con conductor de varios vehículos (5 escenarios) | Bug real (jul 2026) |
| `test_bugs_2_3_4_5.js` | Guards de confirmación en `resetForm` de los 3 módulos | Bugs reales |
| `test_comb_regression.js` | Contaminación cruzada de repostajes entre vehículos (A→B→A) | Bug real reportado en beta |
| `test_regresion_e2e.js` | Flujo completo de los 3 módulos: rellenar → guardar → PDF | Regresión general |
| `test_nuevos_bugs.js` | Merge por timestamp (réplica) + XSS en nombre de conductor | Bugs reales |
| `test_mergeData.js` | Merge de vehículos/históricos al reconectar JSON (réplica) | Bug real |
| `test_stripOldPhotos.js` | Purga de fotos >3 meses de localStorage con el `storage.js` real (API de archivos simulada) | Feature v97/v102 |
| `test_mensual_multi.js` | Parte combustible: 3 vehículos/4 conductores, aislamiento total, km por vehículo, meses, edición, borrado, PDFs | Exploratorio |
| `test_diario_multi.js` | Parte diario: varios vehículos/conductores, autofills, validaciones, PDF | Exploratorio |
| `test_edicion_multi.js` | Edición en los 3 módulos, incl. reindexado de fotos al borrar un repostaje intermedio | Exploratorio |

## Avisos de mantenimiento

- `test_mergeData.js` y la primera parte de `test_nuevos_bugs.js` contienen una **réplica** de `mergeData()` de `storage.js` (es función privada). Si se modifica `mergeData()` en `storage.js`, actualizar la réplica o los tests darán falsa confianza. `test_stripOldPhotos.js` sí prueba el `storage.js` real.
- Playwright **auto-cancela** los `confirm()`/`alert()` si el test no registra `page.on('dialog', ...)` — puede producir falsos fallos (documentado en CLAUDE.md).
- Lo que esta batería NO cubre: dispositivos móviles reales, la cámara, el diálogo real de permisos del archivo JSON y la actualización del Service Worker en clientes.
