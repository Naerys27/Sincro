const { chromium } = require('playwright');

// Edicion en los 3 modulos: partes diarios, combustible (incl. fotos y reindexado), ordenes
(async () => {
  const BASE = 'http://localhost:8899';
  const browser = await chromium.launch();
  let pass = 0, fail = 0;
  function ok(name, cond, extra) { if (cond) { console.log('PASS', name); pass++; } else { console.log('FAIL', name, extra || ''); fail++; } }
  const FOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

  // ============ 1. EDICION PARTE DIARIO ============
  {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => d.accept());
    await page.goto(BASE + '/parte_servicio_diario.html');
    await page.evaluate(() => localStorage.clear());
    await page.goto(BASE + '/parte_servicio_diario.html');
    await page.waitForTimeout(300);

    async function creaParte(fecha, cond, mat, sal, lleg) {
      await page.fill('#fecha', fecha);
      await page.fill('#conductor', cond);
      await page.fill('#parte_servicio', mat);
      await page.fill('#cont_salida', sal);
      await page.fill('#cont_llegada', lleg);
      await page.fill('#hora_salida', '08:00');
      await page.fill('#hora_llegada', '14:00');
      await page.evaluate(() => saveParteDiario());
      await page.waitForTimeout(250);
    }
    await creaParte('2026-07-01', 'RAUL ORTEGA', 'GGG7777', '1000', '1100');
    await creaParte('2026-07-02', 'EVA LUNA', 'HHH8888', '2000', '2080');

    let parts = await page.evaluate(() => JSON.parse(localStorage.getItem('cht_parte_servicio_diario_v1') || '[]'));
    ok('PD: 2 partes creados', parts.length === 2);
    const id1 = parts.find(p => p.fecha === '2026-07-01').id;

    // Editar el primero desde el historial
    await page.evaluate((id) => editSavedPart(id), id1);
    await page.waitForTimeout(400);
    ok('PD edit: fecha cargada', (await page.inputValue('#fecha')) === '2026-07-01');
    ok('PD edit: conductor cargado', (await page.inputValue('#conductor')) === 'RAUL ORTEGA');
    ok('PD edit: contadores cargados', (await page.inputValue('#cont_salida')) === '1000');

    // Modificar y guardar: no debe duplicar
    await page.fill('#cont_llegada', '1150');
    await page.fill('#itinerario', 'Madrid - Aranjuez - Madrid');
    await page.evaluate(() => saveParteDiario());
    await page.waitForTimeout(300);
    parts = await page.evaluate(() => JSON.parse(localStorage.getItem('cht_parte_servicio_diario_v1') || '[]'));
    ok('PD edit: sigue habiendo 2 partes (sin duplicar)', parts.length === 2, 'hay ' + parts.length);
    const p1 = parts.find(p => p.fecha === '2026-07-01');
    ok('PD edit: cambios guardados (llegada 1150)', p1 && String(p1.cont_llegada) === '1150');
    ok('PD edit: kms recalculados (150)', p1 && String(p1.kms_recorridos) === '150');
    ok('PD edit: itinerario guardado', p1 && p1.itinerario === 'Madrid - Aranjuez - Madrid');
    ok('PD edit: el otro parte intacto', parts.find(p => p.fecha === '2026-07-02').conductor === 'EVA LUNA');

    // Editar cambiando la matricula: no debe corromper la BD ni el parte
    await page.evaluate((id) => editSavedPart(id), id1);
    await page.waitForTimeout(400);
    await page.fill('#parte_servicio', 'III9999');
    await page.evaluate(() => saveParteDiario());
    await page.waitForTimeout(300);
    parts = await page.evaluate(() => JSON.parse(localStorage.getItem('cht_parte_servicio_diario_v1') || '[]'));
    ok('PD edit matricula: sin duplicados', parts.length === 2);
    ok('PD edit matricula: matricula actualizada', parts.some(p => p.parte_servicio === 'III9999'));

    // Borrar un parte desde el historial
    const idBorrar = parts.find(p => p.fecha === '2026-07-02').id;
    await page.evaluate((id) => deleteSavedPart(id), idBorrar);
    await page.waitForTimeout(300);
    parts = await page.evaluate(() => JSON.parse(localStorage.getItem('cht_parte_servicio_diario_v1') || '[]'));
    ok('PD borrar: queda 1 parte', parts.length === 1);

    // PDF mensual y por matricula con lo que queda
    await creaParte('2026-07-10', 'EVA LUNA', 'HHH8888', '3000', '3100');
    await page.evaluate(() => { var i = q('mes_partes'); if (i) { i.value = '2026-07'; renderSavedDays(); } });
    await page.waitForTimeout(300);
    let dlOk = true;
    try {
      const dl = page.waitForEvent('download', { timeout: 12000 });
      await page.evaluate(() => makeMonthlyPDF());
      await dl;
    } catch (e) { dlOk = false; }
    ok('PD: PDF mensual generado', dlOk);
    let dl2Count = 0;
    page.on('download', () => dl2Count++);
    try {
      const dl = page.waitForEvent('download', { timeout: 12000 });
      await page.evaluate(() => makeMonthlyPDFByMatricula());
      await dl;
      await page.waitForTimeout(1200);
    } catch (e) {}
    ok('PD: PDFs por matricula generados (2 matriculas)', dl2Count >= 2, 'descargas=' + dl2Count);
    ok('PD: sin errores JS', errors.length === 0, errors.join(' | '));
    await page.close();
  }

  // ============ 2. EDICION PARTE COMBUSTIBLE (con fotos y reindexado) ============
  {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => d.accept());
    await page.goto(BASE + '/parte_combustible.html');
    await page.evaluate(() => localStorage.clear());
    await page.goto(BASE + '/parte_combustible.html');
    await page.waitForTimeout(300);

    await page.fill('#v_mes', '2026-07');
    await page.locator('#v_mes').dispatchEvent('change');
    await page.fill('#v_mat', 'JJJ1010');
    await page.locator('#v_mat').dispatchEvent('change');
    await page.waitForTimeout(300);
    await page.fill('#v_marca', 'KIA');
    await page.fill('#v_modelo', 'CEED');

    // 3 repostajes de gasolina, con foto en el 1º y el 2º (inyectada en rowPhotos como hace la camara)
    async function addG(kms, eur, lit, fecha) {
      await page.evaluate(() => { if (document.getElementById('tipo_combustible').value !== 'gasolina') { document.getElementById('tipo_combustible').value = 'gasolina'; switchFuelType(); } });
      await page.fill('#nf_gk', kms); await page.fill('#nf_ge', eur); await page.fill('#nf_gl', lit);
      if (fecha) await page.fill('#nf_gf', fecha);
      await page.evaluate(() => addRepostaje('g'));
      await page.waitForTimeout(200);
    }
    await addG('100', '10', '7', '2026-07-01');
    await addG('200', '20', '14', '2026-07-02');
    await addG('300', '30', '21', '2026-07-03');
    // Fotos en las filas 1 y 2 (indices de fila usados por la UI)
    const filas = await page.evaluate(() => Array.from(document.querySelectorAll('.gk')).filter(e => e.value).map(e => e.getAttribute('data-row')));
    await page.evaluate((args) => {
      const [rows, foto] = args;
      rowPhotos['g_' + rows[0]] = { data: foto, w: 1, h: 1 };
      rowPhotos['g_' + rows[1]] = { data: foto, w: 1, h: 1 };
      saveHistorico();
    }, [filas, FOTO]);
    await page.waitForTimeout(200);
    let hist = await page.evaluate(() => JSON.parse(localStorage.getItem('partes_combustible_hist_v1') || '{}'));
    let rec = hist['JJJ1010/2026-07'];
    ok('FC: 3 entradas con fotos en la 0 y la 1', rec && rec.entries.length === 3 && rec.photos && !!rec.photos['0'] && !!rec.photos['1'] && !rec.photos['2'], rec && JSON.stringify(Object.keys(rec.photos || {})));

    // Editar el conductor y los litros del 2º repostaje inline
    await page.evaluate(() => {
      document.getElementById('v_conductores').value = 'MARTA GIL\nPACO SOTO';
      updateConductorSelects();
    });
    const fila2 = filas[1];
    await page.evaluate((r) => editRepostajeInline('g', r), fila2);
    await page.waitForTimeout(250);
    await page.fill('#ie_gl_' + fila2, '15.5');
    const selCond = await page.$('#ie_gc_' + fila2);
    if (selCond) await page.selectOption('#ie_gc_' + fila2, 'PACO SOTO');
    await page.evaluate((r) => saveRepostajeInline('g', r), fila2);
    await page.waitForTimeout(250);
    await page.evaluate(() => saveHistorico());
    await page.waitForTimeout(200);
    hist = await page.evaluate(() => JSON.parse(localStorage.getItem('partes_combustible_hist_v1') || '{}'));
    rec = hist['JJJ1010/2026-07'];
    const e2 = rec && rec.entries.find(e => e.kms === '200');
    ok('FC edit inline: litros actualizados', e2 && e2.lit === '15.5', e2 && JSON.stringify(e2));
    ok('FC edit inline: conductor asignado', e2 && e2.conductor === 'PACO SOTO');
    ok('FC edit inline: sigue habiendo 3 entradas', rec && rec.entries.length === 3);
    ok('FC edit inline: fotos intactas tras editar', rec && rec.photos && !!rec.photos['0'] && !!rec.photos['1']);

    // BORRAR el repostaje del medio (el que tiene la 2ª foto): reindexado critico
    await page.evaluate((r) => deleteRepostaje('g', r), fila2);
    await page.waitForTimeout(250);
    await page.evaluate(() => saveHistorico());
    await page.waitForTimeout(200);
    hist = await page.evaluate(() => JSON.parse(localStorage.getItem('partes_combustible_hist_v1') || '{}'));
    rec = hist['JJJ1010/2026-07'];
    ok('FC borrar medio: quedan 2 entradas (100 y 300)', rec && rec.entries.length === 2 && rec.entries.some(e => e.kms === '100') && rec.entries.some(e => e.kms === '300'), rec && JSON.stringify(rec.entries.map(e => e.kms)));
    const idx100 = rec ? rec.entries.findIndex(e => e.kms === '100') : -1;
    const idx300 = rec ? rec.entries.findIndex(e => e.kms === '300') : -1;
    const fotos = rec ? Object.keys(rec.photos || {}) : [];
    ok('FC borrar medio: la foto del repostaje 100 sigue asociada a el', rec && rec.photos && !!rec.photos[String(idx100)], 'fotos en indices: ' + JSON.stringify(fotos) + ', 100 esta en ' + idx100);
    ok('FC borrar medio: el repostaje 300 NO hereda la foto del borrado', rec && (!rec.photos || !rec.photos[String(idx300)]), 'fotos: ' + JSON.stringify(fotos) + ', 300 esta en ' + idx300);

    // Recargar y verificar que la UI pinta lo mismo
    await page.goto(BASE + '/parte_combustible.html');
    await page.waitForTimeout(300);
    await page.fill('#v_mes', '2026-07');
    await page.locator('#v_mes').dispatchEvent('change');
    await page.fill('#v_mat', 'JJJ1010');
    await page.locator('#v_mat').dispatchEvent('change');
    await page.waitForTimeout(400);
    const kmsUI = await page.evaluate(() => Array.from(document.querySelectorAll('.gk')).map(e => e.value).filter(Boolean));
    ok('FC recarga: tabla con las 2 entradas correctas', kmsUI.length === 2 && kmsUI.indexOf('100') !== -1 && kmsUI.indexOf('300') !== -1, JSON.stringify(kmsUI));
    const thumbs = await page.evaluate(() => document.querySelectorAll('.rep-thumb img').length);
    ok('FC recarga: 1 sola miniatura de foto visible', thumbs === 1, 'thumbs=' + thumbs);
    ok('FC: sin errores JS', errors.length === 0, errors.join(' | '));
    await page.close();
  }

  // ============ 3. ORDENES DE REPARACION ============
  {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => d.accept());
    await page.goto(BASE + '/orden_reparacion.html');
    await page.evaluate(() => localStorage.clear());
    await page.goto(BASE + '/orden_reparacion.html');
    await page.waitForTimeout(300);

    async function creaOrden(fecha, mat, marca, veh, concepto) {
      await page.fill('#fecha', fecha);
      await page.fill('#matricula', mat);
      await page.fill('#marca', marca);
      await page.fill('#vehiculo', veh);
      await page.fill('#concepto', concepto);
      await page.evaluate(() => saveOrden());
      await page.waitForTimeout(250);
    }
    await creaOrden('2026-07-01', 'KKK2020', 'FIAT', 'DUCATO', 'Revision frenos');
    await creaOrden('2026-07-02', 'LLL3030', 'IVECO', 'DAILY', 'Cambio bateria');
    let ordenes = await page.evaluate(() => JSON.parse(localStorage.getItem('cht_orden_reparacion_v1') || '[]'));
    ok('OR: 2 ordenes creadas', ordenes.length === 2, 'hay ' + ordenes.length);
    ok('OR: matriculas normalizadas', ordenes.every(o => /^[A-Z0-9]+$/.test(o.matricula)), JSON.stringify(ordenes.map(o => o.matricula)));

    // Cargar la primera para editar
    const idOrden = ordenes.find(o => o.matricula === 'KKK2020').id;
    await page.evaluate((id) => loadOrden(id), idOrden);
    await page.waitForTimeout(300);
    ok('OR edit: matricula cargada formateada', (await page.inputValue('#matricula')) === 'KKK-2020', await page.inputValue('#matricula'));
    ok('OR edit: concepto cargado', (await page.inputValue('#concepto')) === 'Revision frenos');
    await page.fill('#concepto', 'Revision frenos y discos');
    await page.evaluate(() => saveOrden());
    await page.waitForTimeout(300);
    ordenes = await page.evaluate(() => JSON.parse(localStorage.getItem('cht_orden_reparacion_v1') || '[]'));
    ok('OR edit: sin duplicar (siguen 2)', ordenes.length === 2, 'hay ' + ordenes.length);
    ok('OR edit: concepto actualizado', ordenes.some(o => o.concepto === 'Revision frenos y discos'));
    ok('OR edit: la otra orden intacta', ordenes.find(o => o.matricula === 'LLL3030').concepto === 'Cambio bateria');

    // Autofill de matricula conocida
    await page.evaluate(() => resetFormOR(true));
    await page.waitForTimeout(200);
    await page.fill('#matricula', 'LLL3030');
    await page.locator('#matricula').dispatchEvent('change');
    await page.waitForTimeout(300);
    ok('OR autofill: marca desde BD', (await page.inputValue('#marca')) === 'IVECO', await page.inputValue('#marca'));
    ok('OR autofill: vehiculo desde BD', (await page.inputValue('#vehiculo')) === 'DAILY');

    // Borrar una orden
    await page.evaluate((id) => deleteOrden(id), idOrden);
    await page.waitForTimeout(300);
    ordenes = await page.evaluate(() => JSON.parse(localStorage.getItem('cht_orden_reparacion_v1') || '[]'));
    ok('OR borrar: queda 1 orden', ordenes.length === 1 && ordenes[0].matricula === 'LLL3030');

    // Historial renderiza correctamente
    const histCount = await page.evaluate(() => { renderOrHistory(); return document.querySelectorAll('.or-saved-title').length; });
    ok('OR historial: renderiza 1 orden', histCount === 1, 'items=' + histCount);
    ok('OR: sin errores JS', errors.length === 0, errors.join(' | '));
    await page.close();
  }

  console.log('\n=== EDICION:', pass, 'PASS /', fail, 'FAIL ===');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();

