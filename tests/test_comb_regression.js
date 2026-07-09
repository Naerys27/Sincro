const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('dialog', d => d.accept());
  const BASE = 'http://localhost:8899';

  console.log('=== TEST 9 (regresion): fix de contaminacion cruzada de repostajes A->B->A sigue funcionando ===');
  await page.goto(BASE + '/parte_combustible.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(300);

  await page.fill('#v_mes', '2026-07');
  await page.locator('#v_mes').dispatchEvent('change');
  await page.fill('#v_mat', 'AAAA111');
  await page.locator('#v_mat').dispatchEvent('change');
  await page.waitForTimeout(200);

  await page.fill('#nf_gk', '1000');
  await page.fill('#nf_ge', '50');
  await page.fill('#nf_gl', '35');
  await page.evaluate(() => addRepostaje('g'));
  await page.waitForTimeout(200);

  // cambiar a matricula B
  await page.fill('#v_mat', 'BBBB222');
  await page.locator('#v_mat').dispatchEvent('change');
  await page.waitForTimeout(200);
  let rowsB0 = await page.evaluate(() => Array.from(document.querySelectorAll('.gk')).filter(e => e.value).length);
  console.log('Filas CON DATOS en tabla justo tras cambiar a B (deberian ser 0):', rowsB0);

  await page.fill('#nf_gk', '2000');
  await page.fill('#nf_ge', '60');
  await page.fill('#nf_gl', '40');
  await page.evaluate(() => addRepostaje('g'));
  await page.waitForTimeout(200);

  // volver a matricula A
  await page.fill('#v_mat', 'AAAA111');
  await page.locator('#v_mat').dispatchEvent('change');
  await page.waitForTimeout(300);
  const rowsA = await page.evaluate(() => Array.from(document.querySelectorAll('.gk')).map(e => e.value).filter(Boolean));
  console.log('Filas de KM CON DATOS en tabla al volver a A:', JSON.stringify(rowsA));

  const hist = await page.evaluate(() => JSON.parse(localStorage.getItem('partes_combustible_hist_v1') || '{}'));
  console.log('Historico guardado:', JSON.stringify(hist));

  const aOk = rowsA.length === 1 && rowsA[0] === '1000';
  const histAKey = hist['AAAA111/2026-07'];
  const histBKey = hist['BBBB222/2026-07'];
  const noMix = histAKey && histAKey.entries.length === 1 && histAKey.entries[0].kms === '1000' &&
                histBKey && histBKey.entries.length === 1 && histBKey.entries[0].kms === '2000';
  if (aOk && noMix) {
    console.log('OK: el fix de contaminacion cruzada sigue funcionando correctamente, sin mezcla A/B');
  } else {
    console.log('*** REGRESION DETECTADA: los repostajes de A y B se han mezclado o perdido ***');
  }

  await browser.close();
})();

