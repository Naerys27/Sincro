const { chromium } = require('playwright');

// --- Parte 1: test unitario del nuevo mergeData (replica de storage.js) ---
function mergeData(file, ls) {
  var result = {};
  var keys = {};
  Object.keys(file).forEach(function(k) { keys[k] = 1; });
  Object.keys(ls).forEach(function(k) { keys[k] = 1; });
  Object.keys(keys).forEach(function(k) {
    var fv = file[k], lv = ls[k];
    if (fv === undefined) { result[k] = lv; return; }
    if (lv === undefined) { result[k] = fv; return; }
    if (k === 'cht_parte_servicio_diario_v1' || k === 'cht_orden_reparacion_v1') {
      var m = {};
      (Array.isArray(fv) ? fv : []).concat(Array.isArray(lv) ? lv : []).forEach(function(p) {
        if (!p || !p.id) return;
        var prev = m[p.id];
        if (!prev || new Date(p.updatedAt || p.createdAt || 0) >= new Date(prev.updatedAt || prev.createdAt || 0)) m[p.id] = p;
      });
      result[k] = Object.values(m);
    } else {
      result[k] = lv;
    }
  });
  return result;
}

var pass = 0, fail = 0;
function ok(name, cond) { if (cond) { console.log('PASS', name); pass++; } else { console.log('FAIL', name); fail++; } }

// El archivo tiene la version editada (mas reciente) del parte #123; localStorage tiene la vieja
var r1 = mergeData(
  { cht_parte_servicio_diario_v1: [{ id: '123', conductor: 'EDITADO EN MOVIL', updatedAt: '2026-07-03T10:00:00Z' }] },
  { cht_parte_servicio_diario_v1: [{ id: '123', conductor: 'VERSION VIEJA', updatedAt: '2026-07-01T08:00:00Z' }] }
);
ok('Partes diarios: gana la version mas reciente (file), no la de localStorage', r1.cht_parte_servicio_diario_v1[0].conductor === 'EDITADO EN MOVIL');

// Caso inverso: localStorage es mas reciente
var r2 = mergeData(
  { cht_parte_servicio_diario_v1: [{ id: '123', conductor: 'VIEJA', updatedAt: '2026-07-01T08:00:00Z' }] },
  { cht_parte_servicio_diario_v1: [{ id: '123', conductor: 'NUEVA LOCAL', updatedAt: '2026-07-03T10:00:00Z' }] }
);
ok('Partes diarios: gana localStorage cuando es mas reciente', r2.cht_parte_servicio_diario_v1[0].conductor === 'NUEVA LOCAL');

// Ordenes: usan createdAt (no tienen updatedAt)
var r3 = mergeData(
  { cht_orden_reparacion_v1: [{ id: 'a', concepto: 'GUARDADO RECIENTE', createdAt: '2026-07-03T10:00:00Z' }] },
  { cht_orden_reparacion_v1: [{ id: 'a', concepto: 'guardado antiguo', createdAt: '2026-06-01T08:00:00Z' }] }
);
ok('Ordenes: gana la version con createdAt mas reciente', r3.cht_orden_reparacion_v1[0].concepto === 'GUARDADO RECIENTE');

// Union de ids distintos sigue funcionando
var r4 = mergeData(
  { cht_parte_servicio_diario_v1: [{ id: 'x', updatedAt: '2026-07-01T00:00:00Z' }] },
  { cht_parte_servicio_diario_v1: [{ id: 'y', updatedAt: '2026-07-02T00:00:00Z' }] }
);
ok('Union por id de registros distintos intacta', r4.cht_parte_servicio_diario_v1.length === 2);

// Registros sin timestamp (datos antiguos) no rompen: localStorage gana como antes (empate 0>=0, lv procesado despues)
var r5 = mergeData(
  { cht_parte_servicio_diario_v1: [{ id: 'z', v: 'file' }] },
  { cht_parte_servicio_diario_v1: [{ id: 'z', v: 'local' }] }
);
ok('Registros legacy sin timestamp: comportamiento anterior conservado (gana local)', r5.cht_parte_servicio_diario_v1[0].v === 'local');

// --- Parte 2: XSS con Playwright ---
(async () => {
  const BASE = 'http://localhost:8899';
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('dialog', d => d.accept());
  let xssFired = false;
  await page.exposeFunction('_xssProof', () => { xssFired = true; });

  await page.goto(BASE + '/parte_combustible.html');
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE + '/parte_combustible.html');
  await page.waitForTimeout(200);

  const payload = '<img src=x onerror="window._xssProof && window._xssProof()">MALO';
  await page.evaluate((p) => {
    document.getElementById('v_conductores').value = 'CONDUCTOR NORMAL\n' + p;
    updateConductorSelects();
  }, payload);

  // Rellenar un repostaje de gasolina con ese conductor para que se pinte en la lista
  await page.evaluate((p) => {
    document.getElementById('tipo_combustible').value = 'gasolina';
    switchFuelType();
  }, payload);
  await page.fill('#nf_gk', '1000');
  await page.fill('#nf_ge', '50');
  await page.fill('#nf_gl', '30');
  const hasSel = await page.$('#nf_gc');
  if (hasSel) await page.selectOption('#nf_gc', payload);
  await page.evaluate(() => addRepostaje('g'));
  await page.waitForTimeout(400);

  // El nombre malicioso debe verse como TEXTO, no ejecutarse
  const condText = await page.evaluate(() => {
    var el = document.querySelector('.rep-conductor');
    return el ? el.textContent : null;
  });
  ok('XSS: onerror del payload NO se ejecuta en la lista de repostajes', !xssFired);
  ok('XSS: el nombre malicioso se muestra como texto plano', condText !== null && condText.indexOf('<img') !== -1);

  // Tambien en el editor inline (editRepostajeInline)
  const row = await page.evaluate(() => {
    var btn = document.querySelector('.rep-edit');
    if (!btn) return null;
    btn.click();
    return true;
  });
  await page.waitForTimeout(300);
  ok('XSS: onerror tampoco se ejecuta al abrir el editor inline', !xssFired);

  console.log('\n=== RESULTADO:', pass, 'PASS /', fail, 'FAIL ===');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();

