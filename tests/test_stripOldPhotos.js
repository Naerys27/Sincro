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

  // Stub del File System Access API: archivo en memoria en window.__fileText
  const stubFS = () => {
    window.__fileText = '';
    // IndexedDB falso: el handle con funciones no es clonable por el IDB real
    const fakeDb = {
      createObjectStore() {},
      transaction() {
        const tx = {
          objectStore: () => ({
            put: () => ({}),
            get: () => { const rq = {}; setTimeout(() => rq.onsuccess && rq.onsuccess({ target: { result: undefined } }), 0); return rq; },
            delete: () => ({})
          })
        };
        setTimeout(() => tx.oncomplete && tx.oncomplete(), 0);
        return tx;
      }
    };
    Object.defineProperty(window, 'indexedDB', { value: { open: () => { const r = { result: fakeDb }; setTimeout(() => r.onsuccess && r.onsuccess({ target: { result: fakeDb } }), 0); return r; } } });
    const handle = {
      queryPermission: async () => 'granted',
      requestPermission: async () => 'granted',
      getFile: async () => ({ text: async () => window.__fileText }),
      createWritable: async () => ({ write: async (t) => { window.__fileText = t; }, close: async () => {} })
    };
    window.showSaveFilePicker = async () => handle;
    window.showOpenFilePicker = async () => [handle];
  };

  // ===== ESCENARIO A: modo activo (JSON vinculado) =====
  {
    const page = await browser.newPage();
    await page.addInitScript(stubFS);
    await page.goto(BASE + '/parte_combustible.html');
    await page.evaluate(() => localStorage.clear());
    await page.goto(BASE + '/parte_combustible.html');
    await page.waitForTimeout(300);

    const r = await page.evaluate(async (hist) => {
      localStorage.setItem('partes_combustible_hist_v1', JSON.stringify(hist));
      const okSetup = await FSStorage.setup(false);
      // Escritura via setItem estando activo (dispara purga en la copia LS)
      FSStorage.setItem('partes_combustible_hist_v1', JSON.stringify(hist));
      await new Promise(r2 => setTimeout(r2, 200));
      return {
        okSetup,
        file: JSON.parse(window.__fileText || '{}'),
        ls: JSON.parse(localStorage.getItem('partes_combustible_hist_v1') || '{}'),
        cacheRead: JSON.parse(FSStorage.getItem('partes_combustible_hist_v1') || '{}')
      };
    }, mkHist());

    ok('A: setup() con archivo simulado funciona', r.okSetup === true);
    const fh = r.file.partes_combustible_hist_v1 || {};
    ok('A: el JSON conserva las fotos del mes ANTIGUO', fh[OLD_KEY] && fh[OLD_KEY].photos && !!fh[OLD_KEY].photos['0']);
    ok('A: el JSON conserva las fotos del mes reciente', fh[NEW_KEY] && fh[NEW_KEY].photos && !!fh[NEW_KEY].photos['0']);
    ok('A: localStorage SIN fotos del mes antiguo (purgadas)', r.ls[OLD_KEY] && !r.ls[OLD_KEY].photos);
    ok('A: localStorage CON fotos del mes reciente', r.ls[NEW_KEY] && r.ls[NEW_KEY].photos && !!r.ls[NEW_KEY].photos['0']);
    ok('A: el resto de datos del mes antiguo intactos en localStorage', r.ls[OLD_KEY] && r.ls[OLD_KEY].entries.length === 1 && r.ls[OLD_KEY].entries[0].kms === '100');
    ok('A: la app (getItem) sigue viendo TODAS las fotos', r.cacheRead[OLD_KEY] && r.cacheRead[OLD_KEY].photos && !!r.cacheRead[OLD_KEY].photos['0']);
    await page.close();
  }

  // ===== ESCENARIO B: recuperacion en merge — registro antiguo purgado en LS pero editado (mas nuevo), archivo con fotos =====
  {
    const page = await browser.newPage();
    await page.addInitScript(stubFS);
    await page.goto(BASE + '/parte_combustible.html');
    await page.evaluate(() => localStorage.clear());
    await page.goto(BASE + '/parte_combustible.html');
    await page.waitForTimeout(300);

    const r = await page.evaluate(async (args) => {
      const [OLD_KEY2, hist] = args;
      // El "archivo" ya contiene el registro antiguo CON fotos
      window.__fileText = JSON.stringify({ partes_combustible_hist_v1: hist });
      // localStorage: mismo registro purgado (sin fotos) pero MAS RECIENTE (editado offline)
      const purged = JSON.parse(JSON.stringify(hist));
      delete purged[OLD_KEY2].photos;
      purged[OLD_KEY2].updatedAt = '2026-07-01T10:00:00Z';
      purged[OLD_KEY2].entries[0].kms = '150';
      localStorage.setItem('partes_combustible_hist_v1', JSON.stringify(purged));
      const okSetup = await FSStorage.setup(true);
      await new Promise(r2 => setTimeout(r2, 200));
      return { okSetup, file: JSON.parse(window.__fileText || '{}') };
    }, [OLD_KEY, mkHist()]);

    const fh = r.file.partes_combustible_hist_v1 || {};
    ok('B: gana la version editada (kms=150)', fh[OLD_KEY] && fh[OLD_KEY].entries[0].kms === '150');
    ok('B: las fotos se RECUPERAN del archivo (no se pierden del JSON)', fh[OLD_KEY] && fh[OLD_KEY].photos && !!fh[OLD_KEY].photos['0']);
    await page.close();
  }

  // ===== ESCENARIO C: sin archivo vinculado, NO se purga nada =====
  {
    const page = await browser.newPage();
    await page.goto(BASE + '/parte_combustible.html');
    await page.evaluate(() => localStorage.clear());
    await page.goto(BASE + '/parte_combustible.html');
    await page.waitForTimeout(300);

    const r = await page.evaluate((hist) => {
      FSStorage.setItem('partes_combustible_hist_v1', JSON.stringify(hist));
      return JSON.parse(localStorage.getItem('partes_combustible_hist_v1') || '{}');
    }, mkHist());

    ok('C: sin JSON vinculado las fotos antiguas se conservan en localStorage', r[OLD_KEY] && r[OLD_KEY].photos && !!r[OLD_KEY].photos['0']);
    await page.close();
  }

  console.log('\n=== RESULTADO:', pass, 'PASS /', fail, 'FAIL ===');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();

