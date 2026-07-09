const { chromium } = require('playwright');

// Tests adversarios: intentar romper la app a proposito
(async () => {
  const BASE = 'http://localhost:8899';
  const browser = await chromium.launch();
  let pass = 0, fail = 0;
  const hallazgos = [];
  function ok(name, cond, extra) { if (cond) { console.log('PASS', name); pass++; } else { console.log('FAIL', name, extra || ''); fail++; hallazgos.push(name + (extra ? ' — ' + extra : '')); } }
  function info(name, val) { console.log('INFO', name, '->', val); }

  // ============ COMBUSTIBLE ============
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto(BASE + '/parte_combustible.html');
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE + '/parte_combustible.html');
  await page.waitForTimeout(300);

  async function selV(mat, mes) {
    await page.fill('#v_mes', mes);
    await page.locator('#v_mes').dispatchEvent('change');
    await page.fill('#v_mat', mat);
    await page.locator('#v_mat').dispatchEvent('change');
    await page.waitForTimeout(350);
  }
  async function addG(kms, eur, lit, fecha) {
    await page.evaluate(() => { if (document.getElementById('tipo_combustible').value !== 'gasolina') { document.getElementById('tipo_combustible').value = 'gasolina'; switchFuelType(); } });
    if (kms !== null) await page.fill('#nf_gk', kms);
    if (eur !== null) await page.fill('#nf_ge', eur);
    if (lit !== null) await page.fill('#nf_gl', lit);
    if (fecha) await page.fill('#nf_gf', fecha);
    await page.evaluate(() => addRepostaje('g'));
    await page.waitForTimeout(150);
  }

  // --- 1. Misma matricula escrita de 4 formas distintas: NO debe crear vehiculos duplicados ---
  await selV('MMA05505', '2026-07');
  await page.fill('#v_marca', 'SEAT'); await page.fill('#v_modelo', 'LEON');
  await addG('1000', '10', '7', '2026-07-01');
  await selV('mma-05505', '2026-07');
  await addG('2000', '20', '14', '2026-07-02');
  await selV('MMA 05505', '2026-07');
  await addG('3000', '30', '21', '2026-07-03');
  await selV('mma05505', '2026-07');
  let hist = await page.evaluate(() => JSON.parse(localStorage.getItem('partes_combustible_hist_v1') || '{}'));
  let claves = Object.keys(hist);
  ok('ADV: 4 grafias de la misma matricula = 1 solo registro', claves.length === 1 && claves[0] === 'MMA05505/2026-07', JSON.stringify(claves));
  ok('ADV: los 3 repostajes acabaron en el mismo vehiculo', hist['MMA05505/2026-07'] && hist['MMA05505/2026-07'].entries.length === 3, hist['MMA05505/2026-07'] && String(hist['MMA05505/2026-07'].entries.length));
  let db = await page.evaluate(() => JSON.parse(localStorage.getItem('partes_vehiculos_v1') || '{}'));
  ok('ADV: BD de vehiculos sin duplicados por grafia', Object.keys(db).filter(k => k.indexOf('MMA') === 0).length === 1, JSON.stringify(Object.keys(db)));

  // --- 2. Coma decimal espanola escrita a mano (teclado) en importe (FIX: normDec) ---
  await page.evaluate(() => { if (document.getElementById('tipo_combustible').value !== 'gasolina') { document.getElementById('tipo_combustible').value = 'gasolina'; switchFuelType(); } });
  await page.fill('#nf_gk', '4000');
  await page.click('#nf_ge');
  await page.keyboard.type('50,55');
  const eurValue = await page.inputValue('#nf_ge');
  ok('ADV coma decimal: "50,55" tecleado queda como "50.55" en el campo', eurValue === '50.55', JSON.stringify(eurValue));
  await page.fill('#nf_gl', '30');
  await page.evaluate(() => { addRepostaje('g'); saveHistorico(); });
  await page.waitForTimeout(200);
  hist = await page.evaluate(() => JSON.parse(localStorage.getItem('partes_combustible_hist_v1') || '{}'));
  const entComa = hist['MMA05505/2026-07'].entries.find(e => e.kms === '4000');
  ok('ADV coma decimal: se guarda 50.55, no 5055', entComa && entComa.eur === '50.55', 'eur=' + (entComa && entComa.eur));
  const totalTxt = await page.evaluate(() => document.getElementById('tg_eur') ? document.getElementById('tg_eur').textContent : '?');
  ok('ADV coma decimal: el total NO es NaN', totalTxt.indexOf('NaN') === -1, 'total=' + totalTxt);
  // Basura no numerica se rechaza al teclear
  await page.click('#nf_ge');
  await page.keyboard.type('abc12.3.4x');
  ok('ADV basura en importe: solo quedan digitos y un punto', (await page.inputValue('#nf_ge')) === '12.34', JSON.stringify(await page.inputValue('#nf_ge')));
  await page.fill('#nf_ge', '');

  // --- 2b. Aviso de importe sospechoso (>400) — cancelar el confirm impide guardarlo (FIX C) ---
  {
    let confirmMsg = null;
    const rechazar = d => { confirmMsg = d.message(); d.dismiss(); };
    page.removeAllListeners('dialog');
    page.on('dialog', rechazar);
    await page.fill('#nf_gk', '4500'); await page.fill('#nf_ge', '4055'); await page.fill('#nf_gl', '30');
    await page.evaluate(() => { addRepostaje('g'); saveHistorico(); });
    await page.waitForTimeout(200);
    hist = await page.evaluate(() => JSON.parse(localStorage.getItem('partes_combustible_hist_v1') || '{}'));
    const entAlto = hist['MMA05505/2026-07'].entries.find(e => e.kms === '4500');
    ok('ADV importe alto: se muestra confirm de aviso', confirmMsg !== null && confirmMsg.indexOf('inusualmente alto') !== -1, JSON.stringify(confirmMsg));
    ok('ADV importe alto: al cancelar NO se guarda', !entAlto);
    page.removeAllListeners('dialog');
    page.on('dialog', d => d.accept());
    // Y con confirm aceptado si se guarda
    await page.evaluate(() => { addRepostaje('g'); saveHistorico(); });
    await page.waitForTimeout(200);
    hist = await page.evaluate(() => JSON.parse(localStorage.getItem('partes_combustible_hist_v1') || '{}'));
    ok('ADV importe alto: aceptando el aviso SI se guarda', !!hist['MMA05505/2026-07'].entries.find(e => e.kms === '4500'));
  }

  // --- 3. Doble "anadir repostaje" seguido: no debe duplicar ---
  const antes = hist['MMA05505/2026-07'].entries.length;
  await page.fill('#nf_gk', '5000'); await page.fill('#nf_ge', '11'); await page.fill('#nf_gl', '8');
  await page.evaluate(() => { addRepostaje('g'); addRepostaje('g'); saveHistorico(); });
  await page.waitForTimeout(250);
  hist = await page.evaluate(() => JSON.parse(localStorage.getItem('partes_combustible_hist_v1') || '{}'));
  const tras2 = hist['MMA05505/2026-07'].entries.filter(e => e.kms === '5000').length;
  ok('ADV doble click en anadir: solo 1 repostaje nuevo', tras2 === 1, 'copias de kms=5000: ' + tras2);

  // --- 4. Repostaje solo con euros (sin litros ni kms) ---
  await page.fill('#nf_ge', '25');
  await page.evaluate(() => { addRepostaje('g'); saveHistorico(); });
  await page.waitForTimeout(200);
  const totalTxt2 = await page.evaluate(() => document.getElementById('tg_eur').textContent + ' / ' + document.getElementById('tg_lit').textContent);
  ok('ADV repostaje parcial: totales sin NaN', totalTxt2.indexOf('NaN') === -1, totalTxt2);

  // --- 5. Fecha de repostaje fuera del mes seleccionado (FIX: aviso con confirm) ---
  {
    let avisoFecha = null;
    page.removeAllListeners('dialog');
    page.on('dialog', d => { avisoFecha = d.message(); d.dismiss(); });
    await page.fill('#nf_gk', '6000'); await page.fill('#nf_ge', '12'); await page.fill('#nf_gl', '9');
    await page.fill('#nf_gf', '2026-01-15');
    await page.evaluate(() => { addRepostaje('g'); saveHistorico(); });
    await page.waitForTimeout(200);
    hist = await page.evaluate(() => JSON.parse(localStorage.getItem('partes_combustible_hist_v1') || '{}'));
    const entFuera = hist['MMA05505/2026-07'].entries.find(e => e.kms === '6000');
    ok('ADV fecha fuera de mes: se muestra aviso', avisoFecha !== null && avisoFecha.indexOf('no es del mes') !== -1, JSON.stringify(avisoFecha));
    ok('ADV fecha fuera de mes: al cancelar NO se anade', !entFuera);
    page.removeAllListeners('dialog');
    page.on('dialog', d => d.accept());
    await page.evaluate(() => { addRepostaje('g'); saveHistorico(); });
    await page.waitForTimeout(200);
    hist = await page.evaluate(() => JSON.parse(localStorage.getItem('partes_combustible_hist_v1') || '{}'));
    ok('ADV fecha fuera de mes: aceptando el aviso SI se anade', !!hist['MMA05505/2026-07'].entries.find(e => e.kms === '6000'));
  }

  // --- 6. Mes con 25 repostajes + PDF (paginacion y rendimiento) ---
  await selV('NNN7070', '2026-07');
  await page.fill('#v_marca', 'VW'); await page.fill('#v_modelo', 'CADDY');
  for (let i = 1; i <= 25; i++) {
    await addG(String(1000 + i * 100), String(10 + i), String(5 + i), '2026-07-' + String(Math.min(i, 28)).padStart(2, '0'));
  }
  await page.evaluate(() => saveHistorico());
  await page.waitForTimeout(200);
  hist = await page.evaluate(() => JSON.parse(localStorage.getItem('partes_combustible_hist_v1') || '{}'));
  // La app tiene un tope de NR=14 filas por combustible: los 11 sobrantes se descartan con un toast
  const n25 = hist['NNN7070/2026-07'] ? hist['NNN7070/2026-07'].entries.length : 0;
  ok('ADV 25 repostajes: se guardan exactamente los 14 del tope (sin corromper nada)', n25 === 14, 'guardados=' + n25);
  const kms25 = hist['NNN7070/2026-07'] ? hist['NNN7070/2026-07'].entries.map(e => e.kms) : [];
  ok('ADV 25 repostajes: los guardados son los 14 primeros en orden', kms25[0] === '1100' && kms25[13] === '2400', JSON.stringify(kms25.slice(0, 3)) + '...' + JSON.stringify(kms25.slice(-2)));
  // FIX: al superar el tope debe verse el recuadro de error persistente (no solo un toast fugaz)
  await page.fill('#nf_gk', '9999'); await page.fill('#nf_ge', '10'); await page.fill('#nf_gl', '5');
  await page.evaluate(() => addRepostaje('g'));
  await page.waitForTimeout(200);
  const errBox = await page.evaluate(() => { var e = document.getElementById('errbox'); return (e && e.style.display !== 'none') ? e.textContent : ''; });
  ok('ADV tope 14: al intentar el 15o aparece error visible con el limite', errBox.indexOf('límite de 14') !== -1 || errBox.indexOf('limite de 14') !== -1, JSON.stringify(errBox));
  let pdf25 = true;
  try {
    const dl = page.waitForEvent('download', { timeout: 15000 });
    await page.evaluate(() => makePDF());
    await dl;
  } catch (e) { pdf25 = false; }
  ok('ADV 25 repostajes: PDF se genera', pdf25);

  // --- 7. Conductor con acentos vs sin acentos: misma persona, gana la ultima grafia (FIX dedup) ---
  await selV('OOO8080', '2026-07');
  await page.evaluate(() => {
    var inputs = document.querySelectorAll('.driver-input');
    inputs[0].value = 'JOSÉ PÉREZ';
    inputs[0].dispatchEvent(new Event('input'));
    addConductorRow('JOSE PEREZ');
  });
  await page.waitForTimeout(200);
  const condsDedup = await page.evaluate(() => document.getElementById('v_conductores').value);
  const opciones = await page.evaluate(() => Array.from(document.querySelectorAll('#nf_gc option')).map(o => o.value).filter(Boolean));
  ok('ADV dedup acentos: JOSÉ PÉREZ + JOSE PEREZ = 1 sola persona', condsDedup.split('\n').filter(Boolean).length === 1 && opciones.length === 1, 'lista=' + JSON.stringify(condsDedup) + ' opciones=' + JSON.stringify(opciones));
  ok('ADV dedup acentos: gana la ultima grafia escrita', condsDedup === 'JOSE PEREZ', JSON.stringify(condsDedup));
  ok('ADV conductores: sin errores JS con acentos', errors.length === 0, errors.join(' | '));

  await page.close();

  // ============ PARTE DIARIO ============
  {
    const page2 = await browser.newPage();
    const errors2 = [];
    page2.on('pageerror', e => errors2.push(e.message));
    page2.on('dialog', d => d.accept());
    await page2.goto(BASE + '/parte_servicio_diario.html');
    await page2.evaluate(() => localStorage.clear());
    await page2.goto(BASE + '/parte_servicio_diario.html');
    await page2.waitForTimeout(300);

    // --- 8. Autofill conductor escrito SIN acentos cuando se guardo CON acentos ---
    await page2.fill('#fecha', '2026-07-01');
    await page2.fill('#conductor', 'JOSÉ MARÍA NÚÑEZ');
    await page2.fill('#parte_servicio', 'PPP9090');
    await page2.fill('#marca', 'DACIA'); await page2.fill('#modelo', 'DUSTER');
    await page2.fill('#cont_salida', '100'); await page2.fill('#cont_llegada', '200');
    await page2.fill('#hora_salida', '08:00'); await page2.fill('#hora_llegada', '12:00');
    await page2.evaluate(() => saveParteDiario());
    await page2.waitForTimeout(300);
    await page2.evaluate(() => resetForm(true));
    await page2.fill('#conductor', 'jose maria nunez');
    await page2.evaluate(() => onConductorChangePD());
    await page2.waitForTimeout(300);
    const matAuto = (await page2.inputValue('#parte_servicio')).replace(/[^A-Z0-9]/g, '');
    ok('ADV acentos: "jose maria nunez" encuentra a "JOSÉ MARÍA NÚÑEZ"', matAuto === 'PPP9090', 'matricula=' + JSON.stringify(matAuto));

    // --- 9. Doble guardado rapido del mismo parte ---
    await page2.evaluate(() => resetForm(true));
    await page2.fill('#fecha', '2026-07-02');
    await page2.fill('#conductor', 'PRUEBA DOBLE');
    await page2.fill('#parte_servicio', 'QQQ1212');
    await page2.fill('#cont_salida', '100'); await page2.fill('#cont_llegada', '150');
    await page2.fill('#hora_salida', '08:00'); await page2.fill('#hora_llegada', '10:00');
    await page2.evaluate(() => { saveParteDiario(); saveParteDiario(); });
    await page2.waitForTimeout(400);
    const partes = await page2.evaluate(() => JSON.parse(localStorage.getItem('cht_parte_servicio_diario_v1') || '[]'));
    const dobles = partes.filter(p => p.conductor === 'PRUEBA DOBLE').length;
    ok('ADV doble guardado: no duplica el parte', dobles === 1, 'copias=' + dobles);

    // --- 10. Itinerario de 400 caracteres + PDF ---
    await page2.evaluate(() => resetForm(true));
    const largo = 'Madrid - Toledo - Talavera de la Reina - Navalmoral de la Mata - Plasencia - '.repeat(6);
    await page2.fill('#fecha', '2026-07-03');
    await page2.fill('#conductor', 'TEXTO LARGO');
    await page2.fill('#parte_servicio', 'RRR1313');
    await page2.fill('#cont_salida', '100'); await page2.fill('#cont_llegada', '900');
    await page2.fill('#hora_salida', '07:00'); await page2.fill('#hora_llegada', '19:00');
    await page2.fill('#itinerario', largo);
    let pdfLargo = true;
    try {
      const dl = page2.waitForEvent('download', { timeout: 12000 });
      await page2.evaluate(() => makePDF());
      await dl;
    } catch (e) { pdfLargo = false; }
    ok('ADV itinerario 400+ chars: PDF se genera', pdfLargo);

    // --- 11. Contadores con 7 digitos (vehiculo viejo) ---
    await page2.evaluate(() => resetForm(true));
    await page2.fill('#fecha', '2026-07-04');
    await page2.fill('#conductor', 'KM ALTO');
    await page2.fill('#parte_servicio', 'SSS1414');
    await page2.fill('#cont_salida', '0999950'); await page2.fill('#cont_llegada', '1000050');
    await page2.fill('#hora_salida', '08:00'); await page2.fill('#hora_llegada', '10:00');
    const kmsCalc = await page2.inputValue('#kms_recorridos');
    ok('ADV contador 7 digitos con cero delante: kms bien calculados (100)', kmsCalc === '100', 'kms=' + kmsCalc);

    // --- 12. Coma decimal en precio del diario (FIX normDec) ---
    await page2.evaluate(() => resetForm(true));
    await page2.click('#p1');
    await page2.keyboard.type('45,90');
    ok('ADV diario coma decimal: "45,90" queda como "45.90"', (await page2.inputValue('#p1')) === '45.90', JSON.stringify(await page2.inputValue('#p1')));

    // --- 13. Importe sospechoso en diario: cancelar bloquea el guardado (FIX C) ---
    {
      let avisoImporte = null;
      page2.removeAllListeners('dialog');
      page2.on('dialog', d => { avisoImporte = d.message(); d.dismiss(); });
      await page2.evaluate(() => resetForm(true));
      await page2.fill('#fecha', '2026-07-08');
      await page2.fill('#conductor', 'IMPORTE ALTO');
      await page2.fill('#parte_servicio', 'TTT1515');
      await page2.fill('#cont_salida', '100'); await page2.fill('#cont_llegada', '200');
      await page2.fill('#hora_salida', '08:00'); await page2.fill('#hora_llegada', '12:00');
      await page2.fill('#p1', '4590'); await page2.fill('#l1', '30');
      const antesAlto = await page2.evaluate(() => JSON.parse(localStorage.getItem('cht_parte_servicio_diario_v1') || '[]').length);
      await page2.evaluate(() => saveParteDiario());
      await page2.waitForTimeout(300);
      const trasAlto = await page2.evaluate(() => JSON.parse(localStorage.getItem('cht_parte_servicio_diario_v1') || '[]').length);
      ok('ADV diario importe alto: aviso mostrado', avisoImporte !== null && avisoImporte.indexOf('inusualmente alto') !== -1, JSON.stringify(avisoImporte));
      ok('ADV diario importe alto: al cancelar NO guarda', trasAlto === antesAlto);
      page2.removeAllListeners('dialog');
      page2.on('dialog', d => d.accept());
    }

    ok('ADV diario: sin errores JS', errors2.length === 0, errors2.join(' | '));
    await page2.close();
  }

  console.log('\n=== ADVERSARIAL:', pass, 'PASS /', fail, 'FAIL ===');
  if (hallazgos.length) { console.log('HALLAZGOS:'); hallazgos.forEach(h => console.log(' -', h)); }
  await browser.close();
  process.exit(fail ? 1 : 0);
})();

