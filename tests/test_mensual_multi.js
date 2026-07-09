const { chromium } = require('playwright');

// Exploratorio parte combustible: 3 vehiculos, 4 conductores, cambios repetidos entre matriculas
(async () => {
  const BASE = 'http://localhost:8899';
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  let pass = 0, fail = 0;
  function ok(name, cond, extra) { if (cond) { console.log('PASS', name); pass++; } else { console.log('FAIL', name, extra || ''); fail++; } }

  async function selVehiculo(mat, mes) {
    await page.fill('#v_mes', mes);
    await page.locator('#v_mes').dispatchEvent('change');
    await page.fill('#v_mat', mat);
    await page.locator('#v_mat').dispatchEvent('change');
    await page.waitForTimeout(400);
  }
  async function addGasolina(kms, eur, lit, fecha, cond) {
    await page.evaluate(() => { if (document.getElementById('tipo_combustible').value !== 'gasolina') { document.getElementById('tipo_combustible').value = 'gasolina'; switchFuelType(); } });
    await page.fill('#nf_gk', kms);
    await page.fill('#nf_ge', eur);
    await page.fill('#nf_gl', lit);
    if (fecha) await page.fill('#nf_gf', fecha);
    if (cond) { const s = await page.$('#nf_gc'); if (s) await page.selectOption('#nf_gc', cond); }
    await page.evaluate(() => addRepostaje('g'));
    await page.waitForTimeout(250);
  }
  async function setConductores(list) {
    await page.evaluate((l) => {
      document.getElementById('v_conductores').value = l.join('\n');
      updateConductorSelects();
    }, list);
  }
  async function tablaKms() {
    return page.evaluate(() => Array.from(document.querySelectorAll('.gk')).map(e => e.value).filter(Boolean));
  }

  await page.goto(BASE + '/parte_combustible.html');
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE + '/parte_combustible.html');
  await page.waitForTimeout(300);

  // ===== Vehiculo 1: AAA1111, 2 conductoras, 3 repostajes =====
  await selVehiculo('AAA1111', '2026-07');
  await page.fill('#v_marca', 'SEAT');
  await page.fill('#v_modelo', 'IBIZA');
  await page.fill('#v_tarjeta', '1111 2222 3333 4444');
  await page.fill('#v_coste', '102');
  await setConductores(['ANA GARCIA', 'LUCIA PEREZ']);
  await addGasolina('10000', '50', '35', '2026-07-01', 'ANA GARCIA');
  await addGasolina('10500', '60', '40', '2026-07-02', 'LUCIA PEREZ');
  await addGasolina('11000', '45.50', '30.20', '2026-07-03', 'ANA GARCIA');
  ok('V1: 3 repostajes en tabla', (await tablaKms()).length === 3);

  // ===== Cambio a Vehiculo 2: BBB2222, 1 conductor =====
  await selVehiculo('BBB2222', '2026-07');
  ok('V2: tabla limpia al entrar (sin datos de V1)', (await tablaKms()).length === 0);
  await page.fill('#v_marca', 'RENAULT');
  await page.fill('#v_modelo', 'CLIO');
  await setConductores(['PEDRO RUIZ']);
  await addGasolina('20000', '70', '48', '2026-07-05', '');
  ok('V2: 1 repostaje', (await tablaKms()).length === 1);

  // ===== Cambio a Vehiculo 3: CCC3333 con matricula escrita en minusculas y con guion =====
  await selVehiculo('ccc-3333', '2026-07');
  ok('V3: tabla limpia al entrar', (await tablaKms()).length === 0);
  await page.fill('#v_marca', 'TOYOTA');
  await page.fill('#v_modelo', 'YARIS');
  await setConductores(['MARIA SANZ', 'PEDRO RUIZ']);
  await addGasolina('30000', '55', '38', '2026-07-06', 'MARIA SANZ');
  await addGasolina('30400', '65', '44', '2026-07-07', 'PEDRO RUIZ');
  ok('V3: 2 repostajes', (await tablaKms()).length === 2);

  // ===== Vuelta a V1: debe conservar exactamente sus 3 =====
  await selVehiculo('AAA1111', '2026-07');
  const kmsV1 = await tablaKms();
  ok('V1 al volver: conserva sus 3 repostajes', kmsV1.length === 3 && kmsV1.indexOf('10000') !== -1 && kmsV1.indexOf('11000') !== -1, JSON.stringify(kmsV1));
  ok('V1 al volver: marca/modelo correctos', (await page.inputValue('#v_marca')) === 'SEAT' && (await page.inputValue('#v_modelo')) === 'IBIZA');
  ok('V1 al volver: tarjeta correcta', (await page.inputValue('#v_tarjeta')) === '1111 2222 3333 4444');
  const condsV1 = await page.evaluate(() => document.getElementById('v_conductores').value);
  ok('V1 al volver: conductoras correctas', condsV1.indexOf('ANA GARCIA') !== -1 && condsV1.indexOf('LUCIA PEREZ') !== -1 && condsV1.indexOf('PEDRO') === -1, condsV1);

  // ===== Vuelta a V2 y V3: aislamiento total =====
  await selVehiculo('BBB2222', '2026-07');
  ok('V2 al volver: 1 repostaje, marca RENAULT', (await tablaKms()).length === 1 && (await page.inputValue('#v_marca')) === 'RENAULT');
  await selVehiculo('CCC3333', '2026-07');
  const kmsV3 = await tablaKms();
  ok('V3 al volver (matricula normalizada): conserva sus 2', kmsV3.length === 2, JSON.stringify(kmsV3));

  // ===== Repostaje adicional en V3 tras el baile de matriculas =====
  await addGasolina('30900', '40', '27', '2026-07-08', 'MARIA SANZ');
  ok('V3: tercer repostaje anadido tras cambios', (await tablaKms()).length === 3);
  await selVehiculo('AAA1111', '2026-07');
  ok('V1: sigue con 3 tras anadir en V3', (await tablaKms()).length === 3);

  // ===== km_ini / km_fin por vehiculo =====
  await page.fill('#km_ini', '9800');
  await page.fill('#km_fin', '11200');
  await page.evaluate(() => saveHistorico());
  await page.waitForTimeout(200);
  await selVehiculo('BBB2222', '2026-07');
  const kmIniB = await page.inputValue('#km_ini');
  ok('V2: km_ini NO hereda el de V1 (bug km)', kmIniB !== '9800', 'km_ini=' + kmIniB);
  await page.fill('#km_ini', '19500');
  await page.fill('#km_fin', '20300');
  await page.evaluate(() => saveHistorico());
  await selVehiculo('AAA1111', '2026-07');
  ok('V1: km_ini/km_fin propios al volver', (await page.inputValue('#km_ini')) === '9800' && (await page.inputValue('#km_fin')) === '11200');

  // ===== Verificacion del storage =====
  const hist = await page.evaluate(() => JSON.parse(localStorage.getItem('partes_combustible_hist_v1') || '{}'));
  ok('Storage: 3 claves de vehiculo/mes', Object.keys(hist).filter(k => k.indexOf('2026-07') !== -1).length === 3, Object.keys(hist).join(','));
  const hA = hist['AAA1111/2026-07'], hB = hist['BBB2222/2026-07'], hC = hist['CCC3333/2026-07'];
  ok('Storage: entradas correctas por vehiculo (3/1/3)', hA && hA.entries.length === 3 && hB && hB.entries.length === 1 && hC && hC.entries.length === 3);
  ok('Storage: conductor por repostaje guardado', hA && hA.entries[1].conductor === 'LUCIA PEREZ', hA && JSON.stringify(hA.entries.map(e => e.conductor)));
  ok('Storage: km por vehiculo correctos', hA && String(hA.km_ini) === '9800' && hB && String(hB.km_ini) === '19500');
  const db = await page.evaluate(() => JSON.parse(localStorage.getItem('partes_vehiculos_v1') || '{}'));
  ok('Storage: BD vehiculos con las 3 matriculas', db['AAA1111'] && db['BBB2222'] && db['CCC3333']);
  ok('Storage: marca/modelo por vehiculo', db['CCC3333'] && db['CCC3333'].marca === 'TOYOTA' && db['CCC3333'].modelo === 'YARIS');

  // ===== Recarga de pagina: persistencia =====
  await page.goto(BASE + '/parte_combustible.html');
  await page.waitForTimeout(300);
  await selVehiculo('AAA1111', '2026-07');
  ok('Tras recargar: V1 recupera sus 3 repostajes', (await tablaKms()).length === 3);
  ok('Tras recargar: km_ini persiste', (await page.inputValue('#km_ini')) === '9800');

  // ===== Mes distinto para el mismo vehiculo =====
  await selVehiculo('AAA1111', '2026-08');
  ok('Mismo vehiculo, mes nuevo: tabla vacia', (await tablaKms()).length === 0);
  ok('Mes nuevo: marca/modelo del vehiculo se mantienen', (await page.inputValue('#v_marca')) === 'SEAT');
  // Observacion: la lista de conductores NO se arrastra al mes nuevo (guardada por mat/mes) — la reponemos
  const condsMesNuevo = await page.evaluate(() => document.getElementById('v_conductores').value);
  console.log('INFO: conductores al abrir mes nuevo =', JSON.stringify(condsMesNuevo));
  await setConductores(['ANA GARCIA', 'LUCIA PEREZ']);
  await addGasolina('11500', '52', '36', '2026-08-01', 'ANA GARCIA');
  await selVehiculo('AAA1111', '2026-07');
  ok('Julio intacto tras crear agosto', (await tablaKms()).length === 3);

  // ===== Editar un repostaje inline =====
  await page.evaluate(() => { var b = document.querySelector('.rep-edit'); if (b) b.click(); });
  await page.waitForTimeout(250);
  const ieId = await page.evaluate(() => { var i = document.querySelector('[id^=ie_gk_]'); return i ? i.id : null; });
  if (ieId) {
    await page.fill('#' + ieId, '10050');
    const row = ieId.replace('ie_gk_', '');
    await page.evaluate((r) => saveRepostajeInline('g', r), row);
    await page.waitForTimeout(250);
    const kmsEd = await tablaKms();
    ok('Edicion inline: km modificado y sin duplicar filas', kmsEd.length === 3 && kmsEd.indexOf('10050') !== -1, JSON.stringify(kmsEd));
  } else { ok('Edicion inline: editor no abre', false); }

  // ===== Borrar un repostaje =====
  await page.evaluate(() => { var b = document.querySelector('.rep-del'); if (b) b.click(); });
  await page.waitForTimeout(250);
  ok('Borrado: quedan 2 repostajes', (await tablaKms()).length === 2);
  await selVehiculo('BBB2222', '2026-07');
  await selVehiculo('AAA1111', '2026-07');
  ok('Borrado persiste tras cambiar de vehiculo', (await tablaKms()).length === 2);

  // ===== PDFs de los 3 vehiculos =====
  for (const mat of ['AAA1111', 'BBB2222', 'CCC3333']) {
    await selVehiculo(mat, '2026-07');
    let pdfOk = true;
    try {
      const dl = page.waitForEvent('download', { timeout: 10000 });
      await page.evaluate(() => makePDF());
      await dl;
    } catch (e) { pdfOk = false; }
    ok('PDF ' + mat + ' generado', pdfOk);
  }

  ok('Sin errores JS durante toda la sesion', errors.length === 0, errors.join(' | '));
  console.log('\n=== MENSUAL:', pass, 'PASS /', fail, 'FAIL ===');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();

