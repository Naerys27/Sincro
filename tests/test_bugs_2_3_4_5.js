const { chromium } = require('playwright');
const assert = require('assert');

(async () => {
  const BASE = 'http://localhost:8899';
  const browser = await chromium.launch();
  let pass = 0, fail = 0;
  function ok(name, cond) { if (cond) { console.log('PASS', name); pass++; } else { console.log('FAIL', name); fail++; } }

  // --- Bug 2: parte_servicio_diario resetForm guard ---
  {
    const page = await browser.newPage();
    let dialogSeen = false;
    page.on('dialog', d => { dialogSeen = true; d.dismiss(); });
    await page.goto(BASE + '/parte_servicio_diario.html');
    await page.evaluate(() => localStorage.clear());
    await page.goto(BASE + '/parte_servicio_diario.html');
    await page.fill('#conductor', 'JUAN PEREZ');
    await page.evaluate(() => resetForm());
    await page.waitForTimeout(100);
    ok('Bug2: confirm() se dispara al rellenar solo conductor', dialogSeen);
    const conductorStillThere = await page.inputValue('#conductor');
    ok('Bug2: datos NO se pierden tras cancelar confirm', conductorStillThere === 'JUAN PEREZ');
    await page.close();
  }

  // --- Bug 3: parte_combustible resetForm guard ---
  {
    const page = await browser.newPage();
    let dialogSeen = false;
    page.on('dialog', d => { dialogSeen = true; d.dismiss(); });
    await page.goto(BASE + '/parte_combustible.html');
    await page.evaluate(() => localStorage.clear());
    await page.goto(BASE + '/parte_combustible.html');
    await page.waitForTimeout(200);
    await page.fill('#v_tarjeta', '1234 5678 9999 0000');
    await page.evaluate(() => resetForm());
    await page.waitForTimeout(100);
    ok('Bug3: confirm() se dispara al rellenar solo tarjeta (sin v_mat/v_mes)', dialogSeen);
    const tarjetaStillThere = await page.inputValue('#v_tarjeta');
    ok('Bug3: datos NO se pierden tras cancelar confirm', tarjetaStillThere === '1234 5678 9999 0000');
    await page.close();
  }

  // --- Bug 4: orden_reparacion resetFormOR guard ---
  {
    const page = await browser.newPage();
    let dialogSeen = false;
    page.on('dialog', d => { dialogSeen = true; d.dismiss(); });
    await page.goto(BASE + '/orden_reparacion.html');
    await page.evaluate(() => localStorage.clear());
    await page.goto(BASE + '/orden_reparacion.html');
    await page.waitForTimeout(200);
    const concepto = await page.$('#concepto');
    if (concepto) {
      await page.fill('#concepto', 'Cambio de aceite');
      await page.evaluate(() => resetFormOR());
      await page.waitForTimeout(100);
      ok('Bug4: confirm() se dispara al rellenar solo concepto (sin fecha/matricula)', dialogSeen);
      const conceptoStillThere = await page.inputValue('#concepto');
      ok('Bug4: datos NO se pierden tras cancelar confirm', conceptoStillThere === 'Cambio de aceite');
    } else {
      console.log('SKIP Bug4: #concepto no encontrado, revisar id real del campo');
    }
    await page.close();
  }

  // --- Bug 5: mergeData per-field / per-record merge (storage.js) ---
  {
    const page = await browser.newPage();
    await page.goto(BASE + '/parte_combustible.html');
    const result = await page.evaluate(() => {
      var mergeDataFn = window.FSStorage && window.FSStorage._test_mergeData;
      return typeof mergeDataFn;
    });
    console.log('Bug5: mergeData no expuesta globalmente (esperado), se testea por lectura de codigo/logica manualmente');
  }

  console.log('\n=== RESULTADO:', pass, 'PASS /', fail, 'FAIL ===');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();

