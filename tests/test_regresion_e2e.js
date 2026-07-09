const { chromium } = require('playwright');

(async () => {
  const BASE = 'http://localhost:8899';
  const browser = await chromium.launch();
  let pass = 0, fail = 0;
  function ok(name, cond, extra) { if (cond) { console.log('PASS', name); pass++; } else { console.log('FAIL', name, extra || ''); fail++; } }

  // ============ MODULO 1: PARTE SERVICIO DIARIO ============
  {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('JS: ' + e.message));
    page.on('dialog', d => d.accept());
    await page.goto(BASE + '/parte_servicio_diario.html');
    await page.evaluate(() => localStorage.clear());
    await page.goto(BASE + '/parte_servicio_diario.html');
    await page.waitForTimeout(300);

    // Flujo completo: rellenar, guardar, verificar en storage
    await page.fill('#fecha', '2026-07-03');
    await page.fill('#conductor', 'PRUEBA REGRESION');
    await page.fill('#parte_servicio', 'ZZZ1234');
    await page.fill('#marca', 'SEAT');
    await page.fill('#modelo', 'LEON');
    await page.fill('#cont_salida', '1000');
    await page.fill('#cont_llegada', '1150');
    await page.fill('#hora_salida', '08:00');
    await page.fill('#hora_llegada', '14:00');
    await page.evaluate(() => saveParteDiario());
    await page.waitForTimeout(300);
    const saved = await page.evaluate(() => {
      var l = JSON.parse(localStorage.getItem('cht_parte_servicio_diario_v1') || '[]');
      return l.length ? l[l.length - 1] : null;
    });
    ok('PD: parte guardado en storage', saved && saved.conductor === 'PRUEBA REGRESION');
    ok('PD: kms calculados (150)', saved && String(saved.kms_recorridos) === '150');
    ok('PD: vehiculo guardado en BD', await page.evaluate(() => {
      var db = JSON.parse(localStorage.getItem('partes_vehiculos_v1') || '{}');
      return !!db['ZZZ1234'];
    }));

    // Nuevo con datos -> confirm (aceptado por autodialog) -> form limpio
    await page.evaluate(() => resetForm());
    await page.waitForTimeout(200);
    const cleared = await page.inputValue('#conductor');
    ok('PD: resetForm limpia tras aceptar confirm', cleared === '');

    // Autofill por conductor (nuestro fix del bug 1): 1 solo vehiculo -> autorrellena
    await page.fill('#conductor', 'PRUEBA REGRESION');
    await page.evaluate(() => onConductorChangePD());
    await page.waitForTimeout(200);
    const matAuto = await page.inputValue('#parte_servicio');
    ok('PD: autofill matricula por conductor sigue funcionando', matAuto.replace(/[^A-Z0-9]/g, '') === 'ZZZ1234');

    // PDF
    let pdfOk = true;
    try {
      const dl = page.waitForEvent('download', { timeout: 10000 });
      await page.fill('#cont_salida', '1000');
      await page.fill('#cont_llegada', '1150');
      await page.fill('#hora_salida', '08:00');
      await page.fill('#hora_llegada', '14:00');
      await page.fill('#fecha', '2026-07-03');
      await page.evaluate(() => makePDF());
      await dl;
    } catch (e) { pdfOk = false; }
    ok('PD: PDF se genera sin errores', pdfOk);
    ok('PD: sin errores JS en consola', errors.length === 0, errors.join(' | '));
    await page.close();
  }

  // ============ MODULO 2: PARTE COMBUSTIBLE ============
  {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('JS: ' + e.message));
    page.on('dialog', d => d.accept());
    await page.goto(BASE + '/parte_combustible.html');
    await page.evaluate(() => localStorage.clear());
    await page.goto(BASE + '/parte_combustible.html');
    await page.waitForTimeout(300);

    // Vehiculo A con un repostaje
    await page.fill('#v_mes', '2026-07');
    await page.locator('#v_mes').dispatchEvent('change');
    await page.fill('#v_mat', 'AAA1111');
    await page.locator('#v_mat').dispatchEvent('change');
    await page.waitForTimeout(300);
    await page.fill('#v_marca', 'FORD');
    await page.fill('#v_modelo', 'FOCUS');
    await page.evaluate(() => { document.getElementById('tipo_combustible').value = 'gasolina'; switchFuelType(); });
    await page.fill('#nf_gk', '5000');
    await page.fill('#nf_ge', '60');
    await page.fill('#nf_gl', '40');
    await page.evaluate(() => addRepostaje('g'));
    await page.waitForTimeout(300);

    // Cambio a vehiculo B (fix contaminacion cruzada): tabla debe quedar limpia
    await page.fill('#v_mat', 'BBB2222');
    await page.locator('#v_mat').dispatchEvent('change');
    await page.waitForTimeout(400);
    const rowsB = await page.evaluate(() => Array.from(document.querySelectorAll('.gk')).map(e => e.value).filter(Boolean));
    ok('FC: al cambiar a vehiculo B la tabla queda limpia (sin contaminacion)', rowsB.length === 0, JSON.stringify(rowsB));

    // Repostaje en B, volver a A: cada uno conserva lo suyo
    await page.fill('#nf_gk', '9000');
    await page.fill('#nf_ge', '30');
    await page.fill('#nf_gl', '20');
    await page.evaluate(() => addRepostaje('g'));
    await page.waitForTimeout(300);
    await page.fill('#v_mat', 'AAA1111');
    await page.locator('#v_mat').dispatchEvent('change');
    await page.waitForTimeout(400);
    const rowsA = await page.evaluate(() => Array.from(document.querySelectorAll('.gk')).map(e => e.value).filter(Boolean));
    ok('FC: vehiculo A conserva solo su repostaje (5000)', rowsA.length === 1 && rowsA[0] === '5000', JSON.stringify(rowsA));
    const histCheck = await page.evaluate(() => {
      var h = JSON.parse(localStorage.getItem('partes_combustible_hist_v1') || '{}');
      var a = h['AAA1111/2026-07'], b = h['BBB2222/2026-07'];
      return { a: a ? a.entries.length : -1, b: b ? b.entries.length : -1 };
    });
    ok('FC: historicos separados por vehiculo (1 y 1)', histCheck.a === 1 && histCheck.b === 1, JSON.stringify(histCheck));

    // PDF con conductor normal
    let pdfOk = true;
    try {
      const dl = page.waitForEvent('download', { timeout: 10000 });
      await page.evaluate(() => makePDF());
      await dl;
    } catch (e) { pdfOk = false; }
    ok('FC: PDF se genera sin errores', pdfOk);
    ok('FC: sin errores JS en consola', errors.length === 0, errors.join(' | '));
    await page.close();
  }

  // ============ MODULO 3: ORDEN REPARACION ============
  {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('JS: ' + e.message));
    page.on('dialog', d => d.accept());
    await page.goto(BASE + '/orden_reparacion.html');
    await page.evaluate(() => localStorage.clear());
    await page.goto(BASE + '/orden_reparacion.html');
    await page.waitForTimeout(300);

    await page.fill('#fecha', '2026-07-03');
    await page.fill('#matricula', 'CCC3333');
    await page.fill('#marca', 'OPEL');
    await page.fill('#vehiculo', 'CORSA');
    await page.fill('#concepto', 'Cambio de neumaticos');
    // Flujo real: makePDF() genera el PDF y guarda la orden internamente (saveOrden limpia el form al final)
    let pdfOk = true;
    try {
      const dl = page.waitForEvent('download', { timeout: 10000 });
      await page.evaluate(() => makePDF());
      await dl;
    } catch (e) { pdfOk = false; }
    ok('OR: PDF se genera sin errores', pdfOk);
    await page.waitForTimeout(400);
    const orden = await page.evaluate(() => {
      var l = JSON.parse(localStorage.getItem('cht_orden_reparacion_v1') || '[]');
      return l.length ? l[0] : null;
    });
    ok('OR: orden guardada en storage', orden && orden.concepto === 'Cambio de neumaticos');
    ok('OR: matricula normalizada al guardar', orden && orden.matricula === 'CCC3333');
    // El historial se renderiza sin errores (usa fmtMat, antes rompia)
    const histRendered = await page.evaluate(() => {
      renderOrHistory();
      return document.querySelectorAll('.or-saved-title').length;
    });
    ok('OR: historial renderiza la orden guardada', histRendered >= 1);
    ok('OR: sin errores JS en consola', errors.length === 0, errors.join(' | '));
    await page.close();
  }

  console.log('\n=== RESULTADO:', pass, 'PASS /', fail, 'FAIL ===');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();

