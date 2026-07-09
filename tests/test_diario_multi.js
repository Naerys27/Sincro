const { chromium } = require('playwright');

// Exploratorio parte diario: varios vehiculos y conductores, autofills, validaciones, historial
(async () => {
  const BASE = 'http://localhost:8899';
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  const dialogs = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  let pass = 0, fail = 0;
  function ok(name, cond, extra) { if (cond) { console.log('PASS', name); pass++; } else { console.log('FAIL', name, extra || ''); fail++; } }

  async function rellenaParte(p) {
    await page.fill('#fecha', p.fecha);
    await page.fill('#conductor', p.conductor);
    await page.fill('#parte_servicio', p.mat);
    if (p.marca !== undefined) await page.fill('#marca', p.marca);
    if (p.modelo !== undefined) await page.fill('#modelo', p.modelo);
    await page.fill('#cont_salida', p.sal);
    await page.fill('#cont_llegada', p.lleg);
    await page.fill('#hora_salida', p.hs);
    await page.fill('#hora_llegada', p.hl);
    if (p.itinerario) await page.fill('#itinerario', p.itinerario);
  }
  async function guarda() {
    await page.evaluate(() => saveParteDiario());
    await page.waitForTimeout(300);
  }
  async function nuevo() {
    await page.evaluate(() => resetForm(true));
    await page.waitForTimeout(150);
  }
  async function partesGuardados() {
    return page.evaluate(() => JSON.parse(localStorage.getItem('cht_parte_servicio_diario_v1') || '[]'));
  }

  await page.goto(BASE + '/parte_servicio_diario.html');
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE + '/parte_servicio_diario.html');
  await page.waitForTimeout(300);

  // ===== 4 partes: 3 vehiculos, 3 conductores (JAVIER lleva 2 vehiculos distintos) =====
  await rellenaParte({ fecha: '2026-07-01', conductor: 'JAVIER MOLINA', mat: 'DDD4444', marca: 'FORD', modelo: 'TRANSIT', sal: '5000', lleg: '5120', hs: '08:00', hl: '13:30', itinerario: 'Madrid - Toledo - Madrid' });
  await guarda(); await nuevo();
  await rellenaParte({ fecha: '2026-07-02', conductor: 'SARA VEGA', mat: 'EEE5555', marca: 'NISSAN', modelo: 'QASHQAI', sal: '8000', lleg: '8090', hs: '09:00', hl: '12:00' });
  await guarda(); await nuevo();
  await rellenaParte({ fecha: '2026-07-03', conductor: 'JAVIER MOLINA', mat: 'FFF6666', marca: 'CITROEN', modelo: 'BERLINGO', sal: '3000', lleg: '3055', hs: '10:00', hl: '11:45' });
  await guarda(); await nuevo();
  await rellenaParte({ fecha: '2026-07-04', conductor: 'SARA VEGA', mat: 'EEE5555', sal: '8090', lleg: '8210', hs: '08:15', hl: '15:00' });
  await guarda(); await nuevo();

  const partes = await partesGuardados();
  ok('4 partes guardados', partes.length === 4, 'hay ' + partes.length);
  ok('Matriculas normalizadas en storage', partes.every(p => /^[A-Z0-9]+$/.test(p.parte_servicio)), JSON.stringify(partes.map(p => p.parte_servicio)));
  ok('Conductores en mayusculas', partes.every(p => p.conductor === p.conductor.toUpperCase()));
  const p4 = partes.find(p => p.fecha === '2026-07-04');
  ok('Parte sin marca escrita: kms calculados igualmente (120)', p4 && String(p4.kms_recorridos) === '120', p4 && JSON.stringify(p4.kms_recorridos));

  const db = await page.evaluate(() => JSON.parse(localStorage.getItem('partes_vehiculos_v1') || '{}'));
  ok('BD vehiculos: 3 matriculas registradas', db['DDD4444'] && db['EEE5555'] && db['FFF6666']);

  // ===== Autofill matricula -> marca/modelo/conductor =====
  await nuevo();
  await page.fill('#parte_servicio', 'EEE5555');
  await page.evaluate(() => { var el = document.getElementById('parte_servicio'); el.dispatchEvent(new Event('change')); el.dispatchEvent(new Event('blur')); });
  await page.waitForTimeout(300);
  ok('Autofill por matricula: marca', (await page.inputValue('#marca')) === 'NISSAN', await page.inputValue('#marca'));
  ok('Autofill por matricula: modelo', (await page.inputValue('#modelo')) === 'QASHQAI');

  // ===== Autofill conductor con UN solo vehiculo =====
  await nuevo();
  await page.fill('#conductor', 'SARA VEGA');
  await page.evaluate(() => onConductorChangePD());
  await page.waitForTimeout(300);
  const matSara = (await page.inputValue('#parte_servicio')).replace(/[^A-Z0-9]/g, '');
  ok('Conductor 1 vehiculo: autofill matricula', matSara === 'EEE5555', matSara);

  // ===== Conductor AMBIGUO (JAVIER: DDD4444 y FFF6666) -> debe elegir el mas reciente (FFF6666, 03/07) =====
  await nuevo();
  await page.fill('#conductor', 'JAVIER MOLINA');
  await page.evaluate(() => onConductorChangePD());
  await page.waitForTimeout(300);
  const matJavier = (await page.inputValue('#parte_servicio')).replace(/[^A-Z0-9]/g, '');
  ok('Conductor ambiguo: elige el vehiculo usado mas recientemente', matJavier === 'FFF6666', matJavier);
  ok('Conductor ambiguo: marca del vehiculo elegido', (await page.inputValue('#marca')) === 'CITROEN');

  // ===== Conductor ambiguo NO pisa una matricula ya escrita =====
  await nuevo();
  await page.fill('#parte_servicio', 'DDD4444');
  await page.fill('#conductor', 'JAVIER MOLINA');
  await page.evaluate(() => onConductorChangePD());
  await page.waitForTimeout(300);
  const matFija = (await page.inputValue('#parte_servicio')).replace(/[^A-Z0-9]/g, '');
  ok('Matricula ya escrita: el conductor no la cambia', matFija === 'DDD4444', matFija);

  // ===== Validacion: sin conductor no guarda (matricula desconocida para que el autofill no lo rellene) =====
  await nuevo();
  await rellenaParte({ fecha: '2026-07-05', conductor: '', mat: 'ZZZ9999', sal: '5120', lleg: '5200', hs: '08:00', hl: '12:00' });
  await page.fill('#conductor', '');
  const antesInvalido = (await partesGuardados()).length;
  await guarda();
  ok('Validacion: sin conductor NO guarda', (await partesGuardados()).length === antesInvalido);
  // Y ademas: escribir una matricula conocida SI autorrellena el conductor desde la BD (v98)
  await nuevo();
  await page.fill('#parte_servicio', 'DDD4444');
  await page.waitForTimeout(300);
  ok('Matricula conocida autorrellena conductor desde BD', (await page.inputValue('#conductor')) === 'JAVIER MOLINA');

  // ===== Validacion: llegada menor que salida =====
  await nuevo();
  await rellenaParte({ fecha: '2026-07-05', conductor: 'SARA VEGA', mat: 'EEE5555', sal: '9000', lleg: '8500', hs: '08:00', hl: '12:00' });
  const kmsCalc = await page.inputValue('#kms_recorridos');
  ok('Contador llegada < salida: kms vacio (no negativo)', kmsCalc === '', 'kms=' + kmsCalc);
  const antesNeg = (await partesGuardados()).length;
  await guarda();
  const trasNeg = (await partesGuardados()).length;
  console.log('INFO: guardar con llegada<salida:', trasNeg > antesNeg ? 'SE GUARDA (posible hueco de validacion)' : 'bloqueado');

  // ===== Edicion de un parte existente =====
  await page.goto(BASE + '/parte_servicio_diario.html');
  await page.waitForTimeout(400);
  const idPrimero = (await partesGuardados()).find(p => p.fecha === '2026-07-01');
  if (idPrimero && idPrimero.id !== undefined) {
    const edited = await page.evaluate(async (id) => {
      if (typeof loadParte === 'function') { await loadParte(id); return 'loadParte'; }
      if (typeof editParte === 'function') { await editParte(id); return 'editParte'; }
      return null;
    }, idPrimero.id);
    if (edited) {
      await page.waitForTimeout(300);
      await page.fill('#cont_llegada', '5150');
      await guarda();
      const tras = await partesGuardados();
      const p1 = tras.find(p => p.fecha === '2026-07-01');
      ok('Edicion: actualiza sin duplicar', tras.filter(p => p.fecha === '2026-07-01').length === 1 && p1 && String(p1.cont_llegada) === '5150', JSON.stringify(tras.map(p => p.fecha)));
    } else {
      console.log('INFO: sin funcion de edicion global detectable, se omite el caso');
    }
  }

  // ===== PDF de un parte completo =====
  await page.goto(BASE + '/parte_servicio_diario.html');
  await page.waitForTimeout(300);
  await rellenaParte({ fecha: '2026-07-06', conductor: 'JAVIER MOLINA', mat: 'DDD4444', marca: 'FORD', modelo: 'TRANSIT', sal: '5150', lleg: '5300', hs: '07:30', hl: '14:45', itinerario: 'Madrid - Guadalajara - Madrid' });
  let pdfOk = true;
  try {
    const dl = page.waitForEvent('download', { timeout: 10000 });
    await page.evaluate(() => makePDF());
    await dl;
  } catch (e) { pdfOk = false; }
  ok('PDF parte diario generado', pdfOk);

  ok('Sin errores JS durante toda la sesion', errors.length === 0, errors.join(' | '));
  console.log('\n=== DIARIO:', pass, 'PASS /', fail, 'FAIL ===');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();

