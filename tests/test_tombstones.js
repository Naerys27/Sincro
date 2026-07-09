// Lapidas de borrado: un parte borrado en un dispositivo no debe "resucitar" al
// sincronizar con otro que aun lo tiene (bug real detectado en la primera prueba).
const { chromium } = require('playwright');

(async () => {
  const BASE = 'http://localhost:8899';
  const browser = await chromium.launch();
  let pass = 0, fail = 0;
  function ok(name, cond, extra) { if (cond) { console.log('PASS', name); pass++; } else { console.log('FAIL', name, extra || ''); fail++; } }

  const page = await browser.newPage();
  await page.goto(BASE + '/parte_combustible.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(300);

  const DK = 'cht_parte_servicio_diario_v1';
  const TK = 'partes_tombstones_v1';
  const HK = 'partes_combustible_hist_v1';

  // 1. Borrar un parte deja lapida; re-anadirlo la quita
  const r1 = await page.evaluate((DK) => {
    var a = { id: 'pa', fecha: '2026-07-01', updatedAt: '2026-07-01T10:00:00Z' };
    var b = { id: 'pb', fecha: '2026-07-02', updatedAt: '2026-07-02T10:00:00Z' };
    FSStorage.setItem(DK, JSON.stringify([a, b]));
    FSStorage.setItem(DK, JSON.stringify([a])); // usuario borra pb
    var tombsTrasBorrar = JSON.parse(localStorage.getItem('partes_tombstones_v1') || '{}');
    FSStorage.setItem(DK, JSON.stringify([a, b])); // lo re-anade
    var tombsTrasReanadir = JSON.parse(localStorage.getItem('partes_tombstones_v1') || '{}');
    FSStorage.setItem(DK, JSON.stringify([a])); // borrado de nuevo para los siguientes casos
    return { conLapida: !!tombsTrasBorrar[DK + '|pb'], sinLapida: !tombsTrasReanadir[DK + '|pb'] };
  }, DK);
  ok('borrado deja lapida', r1.conLapida);
  ok('re-anadir quita la lapida', r1.sinLapida);

  // 2. Merge: el remoto (movil) aun tiene el parte borrado -> NO resucita
  const r2 = await page.evaluate((DK) => {
    var remote = {};
    remote[DK] = [
      { id: 'pa', fecha: '2026-07-01', updatedAt: '2026-07-01T10:00:00Z' },
      { id: 'pb', fecha: '2026-07-02', updatedAt: '2026-07-02T10:00:00Z' }
    ];
    var local = { partes_tombstones_v1: JSON.parse(localStorage.getItem('partes_tombstones_v1')) };
    local[DK] = [{ id: 'pa', fecha: '2026-07-01', updatedAt: '2026-07-01T10:00:00Z' }];
    var merged = FSStorage.mergeData(remote, local);
    return { ids: merged[DK].map(function(p) { return p.id; }), tombs: merged.partes_tombstones_v1 };
  }, DK);
  ok('merge: el parte borrado NO resucita', r2.ids.length === 1 && r2.ids[0] === 'pa');
  ok('merge: la lapida viaja en el resultado (llegara al otro dispositivo)', !!r2.tombs[DK + '|pb']);

  // 3. Dispositivo nuevo (local vacio): remoto trae parte + lapida mas nueva -> no aparece
  const r3 = await page.evaluate((DK) => {
    var remote = { partes_tombstones_v1: {} };
    remote[DK] = [{ id: 'px', updatedAt: '2026-07-01T10:00:00Z' }];
    remote.partes_tombstones_v1[DK + '|px'] = '2026-07-05T10:00:00Z';
    var merged = FSStorage.mergeData(remote, {});
    return merged[DK].length;
  }, DK);
  ok('dispositivo nuevo: parte con lapida mas nueva no aparece', r3 === 0);

  // 4. Re-creacion POSTERIOR al borrado gana a la lapida
  const r4 = await page.evaluate((DK) => {
    var remote = { partes_tombstones_v1: {} };
    remote.partes_tombstones_v1[DK + '|py'] = '2026-07-03T10:00:00Z';
    var local = {};
    local[DK] = [{ id: 'py', updatedAt: '2026-07-04T10:00:00Z' }]; // editado DESPUES del borrado remoto
    var merged = FSStorage.mergeData(remote, local);
    return merged[DK].length;
  }, DK);
  ok('registro re-creado despues del borrado sobrevive', r4 === 1);

  // 5. Historico combustible: mes borrado con lapida no resucita
  const r5 = await page.evaluate((HK) => {
    var remote = { partes_tombstones_v1: {} };
    remote[HK] = { 'AAA1111/2026-06': { mat: 'AAA1111', mes: '2026-06', entries: [], updatedAt: '2026-06-20T10:00:00Z' } };
    remote.partes_tombstones_v1[HK + '|AAA1111/2026-06'] = '2026-07-01T10:00:00Z';
    var merged = FSStorage.mergeData(remote, {});
    return Object.keys(merged[HK]).length;
  }, HK);
  ok('combustible: mes borrado con lapida no resucita', r5 === 0);

  // 6. Lapidas caducadas (>180 dias) se purgan en el merge
  const r6 = await page.evaluate((DK) => {
    var vieja = new Date(Date.now() - 200 * 24 * 3600 * 1000).toISOString();
    var remote = { partes_tombstones_v1: {} };
    remote.partes_tombstones_v1[DK + '|pz'] = vieja;
    var merged = FSStorage.mergeData(remote, {});
    return Object.keys(merged.partes_tombstones_v1).length;
  }, DK);
  ok('lapidas caducadas se purgan', r6 === 0);

  console.log('\n=== RESULTADO:', pass, 'PASS /', fail, 'FAIL ===');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
