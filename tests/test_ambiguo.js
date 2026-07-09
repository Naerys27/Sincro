const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const toasts = [];
  page.on('dialog', d => d.accept());
  const BASE = 'http://localhost:8899';

  async function reset() {
    await page.goto(BASE + '/parte_servicio_diario.html');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForTimeout(200);
  }

  async function seedVehiculo(mat, marca, modelo, conductor) {
    await page.evaluate(({ mat, marca, modelo, conductor }) => {
      var db = JSON.parse(localStorage.getItem('partes_vehiculos_v1') || '{}');
      db[mat] = { marca: marca, modelo: modelo, conductor: conductor };
      localStorage.setItem('partes_vehiculos_v1', JSON.stringify(db));
    }, { mat, marca, modelo, conductor });
  }

  async function seedParte(fecha, matricula, conductor) {
    await page.evaluate(({ fecha, matricula, conductor }) => {
      var arr = JSON.parse(localStorage.getItem('cht_parte_servicio_diario_v1') || '[]');
      arr.push({ id: 'p_' + Math.random().toString(36).slice(2), fecha: fecha, parte_servicio: matricula, conductor: conductor });
      localStorage.setItem('cht_parte_servicio_diario_v1', JSON.stringify(arr));
    }, { fecha, matricula, conductor });
  }

  // ===== TEST A: conductor con UN solo vehiculo -> debe autocompletar todo como antes =====
  console.log('=== TEST A: match unico sigue autocompletando matricula+marca+modelo ===');
  await reset();
  await seedVehiculo('1111AAA', 'FORD', 'TRANSIT', 'JUAN PEREZ');
  await page.fill('#conductor', 'JUAN PEREZ');
  await page.evaluate(() => onConductorChangePD());
  await page.waitForTimeout(100);
  let mat = await page.inputValue('#parte_servicio');
  let marca = await page.inputValue('#marca');
  let modelo = await page.inputValue('#modelo');
  console.log('matricula:', mat, '| marca:', marca, '| modelo:', modelo);
  console.log(mat === '111-AAA' && marca === 'FORD' && modelo === 'TRANSIT' ? 'OK' : '*** FALLO: no autocompleto correctamente con match unico ***');

  // ===== TEST B: conductor con 2 vehiculos, con historial de partes -> elige el usado mas reciente =====
  console.log('');
  console.log('=== TEST B: conductor con 2 vehiculos, elige el usado mas recientemente segun historial ===');
  await reset();
  await seedVehiculo('2222BBB', 'CITROEN', 'JUMPER', 'MARIA LOPEZ');
  await seedVehiculo('3333CCC', 'RENAULT', 'MASTER', 'MARIA LOPEZ');
  await seedParte('2026-06-01', '2222BBB', 'MARIA LOPEZ');
  await seedParte('2026-06-20', '3333CCC', 'MARIA LOPEZ'); // mas reciente -> deberia elegir este
  await page.fill('#conductor', 'MARIA LOPEZ');
  await page.evaluate(() => onConductorChangePD());
  await page.waitForTimeout(100);
  mat = await page.inputValue('#parte_servicio');
  marca = await page.inputValue('#marca');
  modelo = await page.inputValue('#modelo');
  console.log('matricula:', mat, '| marca:', marca, '| modelo:', modelo);
  console.log(mat === '333-3CC' || mat === '333-CCC' || mat.replace(/-/g,'') === '3333CCC' ? 'revisar formato' : '');
  console.log(marca === 'RENAULT' && modelo === 'MASTER' ? 'OK: eligio el vehiculo mas usado recientemente (RENAULT MASTER)' : '*** FALLO: deberia haber elegido RENAULT MASTER (uso mas reciente), obtuvo ' + marca + ' ' + modelo + ' ***');

  // ===== TEST C: conductor con 2 vehiculos, SIN historial -> no autocompleta nada + toast =====
  console.log('');
  console.log('=== TEST C: conductor con 2 vehiculos sin historial -> no autocompleta (ambiguo) ===');
  await reset();
  await seedVehiculo('4444DDD', 'IVECO', 'DAILY', 'PEDRO GOMEZ');
  await seedVehiculo('5555EEE', 'MAN', 'TGE', 'PEDRO GOMEZ');
  page.once('console', () => {});
  await page.fill('#conductor', 'PEDRO GOMEZ');
  await page.evaluate(() => onConductorChangePD());
  await page.waitForTimeout(100);
  mat = await page.inputValue('#parte_servicio');
  marca = await page.inputValue('#marca');
  modelo = await page.inputValue('#modelo');
  const toastText = await page.evaluate(() => document.getElementById('toast') ? document.getElementById('toast').textContent : null);
  console.log('matricula:', JSON.stringify(mat), '| marca:', JSON.stringify(marca), '| modelo:', JSON.stringify(modelo), '| toast:', JSON.stringify(toastText));
  console.log(mat === '' && marca === '' && modelo === '' ? 'OK: no autocompleto con ambiguedad sin historial (deja elegir al usuario)' : '*** FALLO: autocompleto algo pese a ser ambiguo sin historial ***');

  // ===== TEST D (regresion bug 1): marca/modelo ya escritos a mano NO se sobreescriben al escribir conductor =====
  console.log('');
  console.log('=== TEST D (bug 1): marca/modelo manuales no se pisan al autocompletar por conductor ===');
  await reset();
  await seedVehiculo('6666FFF', 'FORD', 'TRANSIT', 'ANA RUIZ');
  await page.fill('#marca', 'SEAT');
  await page.fill('#modelo', 'IBIZA');
  await page.fill('#conductor', 'ANA RUIZ');
  await page.evaluate(() => onConductorChangePD());
  await page.waitForTimeout(100);
  marca = await page.inputValue('#marca');
  modelo = await page.inputValue('#modelo');
  mat = await page.inputValue('#parte_servicio');
  console.log('marca:', marca, '| modelo:', modelo, '| matricula:', mat);
  console.log(marca === 'SEAT' && modelo === 'IBIZA' ? 'OK: no se sobreescribieron marca/modelo ya escritos' : '*** FALLO: bug 1 sigue presente, se sobreescribio ***');

  // ===== TEST E (regresion): cambiar matricula a mano SI debe actualizar marca/modelo al vehiculo nuevo =====
  console.log('');
  console.log('=== TEST E: cambiar matricula manualmente SI actualiza marca/modelo (flujo de cambio de vehiculo) ===');
  await reset();
  await seedVehiculo('7777GGG', 'FORD', 'TRANSIT', 'LUIS DIAZ');
  await seedVehiculo('8888HHH', 'OPEL', 'MOVANO', 'OTRO CONDUCTOR');
  await page.fill('#conductor', 'LUIS DIAZ');
  await page.evaluate(() => onConductorChangePD());
  await page.waitForTimeout(100);
  let matAfterConductor = await page.inputValue('#parte_servicio');
  console.log('matricula tras escribir conductor:', matAfterConductor);
  // el usuario decide cambiar de vehiculo manualmente
  await page.fill('#parte_servicio', '8888HHH');
  await page.evaluate(() => onMatriculaChangePD());
  await page.waitForTimeout(100);
  marca = await page.inputValue('#marca');
  modelo = await page.inputValue('#modelo');
  console.log('marca:', marca, '| modelo:', modelo, '(se esperaba OPEL MOVANO, el vehiculo nuevo)');
  console.log(marca === 'OPEL' && modelo === 'MOVANO' ? 'OK: el cambio manual de matricula sigue actualizando marca/modelo con normalidad' : '*** FALLO: el cambio de vehiculo por matricula dejo de funcionar ***');

  await browser.close();
})();

