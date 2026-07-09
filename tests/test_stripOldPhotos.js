// Purga de fotos antiguas de localStorage cuando la sincronizacion esta activa
// (la copia completa con fotos vive en Drive; mergeData las recupera si hace falta).
const { chromium } = require('playwright');

(async () => {
  const BASE = 'http://localhost:8899';
  const browser = await chromium.launch();
  let pass = 0, fail = 0;
  function ok(name, cond, extra) { if (cond) { console.log('PASS', name); pass++; } else { console.log('FAIL', name, extra || ''); fail++; } }

  // Mes antiguo (>3 meses desde 2026-07) y mes reciente
  const OLD_KEY = 'XXX1111/2026-01';
  const NEW_KEY = 'XXX1111/2026-06';
  const FOTO = 'data:image/png;base64,AAAA';

  function mkHist() {
    return {
      [OLD_KEY]: { mat: 'XXX1111', mes: '2026-01', tipo: 'gasolina', entries: [{ kms: '100', eur: '50', lit: '30' }], photos: { '0': { data: FOTO, w: 10, h: 10 } }, updatedAt: '2026-01-20T10:00:00Z' },
      [NEW_KEY]: { mat: 'XXX1111', mes: '2026-06', tipo: 'gasolina', entries: [{ kms: '200', eur: '60', lit: '35' }], photos: { '0': { data: FOTO, w: 10, h: 10 } }, updatedAt: '2026-06-20T10:00:00Z' }
    };
  }

  const page = await browser.newPage();
  await page.goto(BASE + '/parte_combustible.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(300);

  // ===== ESCENARIO A: sync activo -> setItem purga fotos antiguas SOLO de localStorage =====
  const rA = await page.evaluate((hist) => {
    FSStorage.setSyncActive(true);
    FSStorage.setItem('partes_combustible_hist_v1', JSON.stringify(hist));
    return JSON.parse(localStorage.getItem('partes_combustible_hist_v1') || '{}');
  }, mkHist());
  ok('A: localStorage SIN fotos del mes antiguo (purgadas)', rA[OLD_KEY] && !rA[OLD_KEY].photos);
  ok('A: localStorage CON fotos del mes reciente', rA[NEW_KEY] && rA[NEW_KEY].photos && !!rA[NEW_KEY].photos['0']);
  ok('A: el resto de datos del mes antiguo intactos', rA[OLD_KEY] && rA[OLD_KEY].entries.length === 1 && rA[OLD_KEY].entries[0].kms === '100');

  // ===== ESCENARIO B: recuperacion en merge — local purgado pero MAS RECIENTE, remoto con fotos =====
  const rB = await page.evaluate((args) => {
    const [OLD_KEY2, hist] = args;
    const remote = { partes_combustible_hist_v1: hist };
    const purged = JSON.parse(JSON.stringify(hist));
    delete purged[OLD_KEY2].photos;
    purged[OLD_KEY2].updatedAt = '2026-07-01T10:00:00Z';
    purged[OLD_KEY2].entries[0].kms = '150';
    const merged = FSStorage.mergeData(remote, { partes_combustible_hist_v1: purged });
    return merged.partes_combustible_hist_v1;
  }, [OLD_KEY, mkHist()]);
  ok('B: gana la version editada (kms=150)', rB[OLD_KEY] && rB[OLD_KEY].entries[0].kms === '150');
  ok('B: las fotos se RECUPERAN del remoto (no se pierden de Drive)', rB[OLD_KEY] && rB[OLD_KEY].photos && !!rB[OLD_KEY].photos['0']);

  // ===== ESCENARIO C: sin sync activo, NO se purga nada =====
  const rC = await page.evaluate((hist) => {
    FSStorage.setSyncActive(false);
    FSStorage.setItem('partes_combustible_hist_v1', JSON.stringify(hist));
    return JSON.parse(localStorage.getItem('partes_combustible_hist_v1') || '{}');
  }, mkHist());
  ok('C: sin sync las fotos antiguas se conservan en localStorage', rC[OLD_KEY] && rC[OLD_KEY].photos && !!rC[OLD_KEY].photos['0']);

  console.log('\n=== RESULTADO:', pass, 'PASS /', fail, 'FAIL ===');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
