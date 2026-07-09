// Ciclo de sincronizacion DriveSync con la API de Google Drive SIMULADA (page.route).
// No toca la red real: googleapis.com se responde desde aqui y accounts.google.com se bloquea
// (el token se stubbea en sessionStorage, asi el flujo GIS nunca llega a ejecutarse).
const { chromium } = require('playwright');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { console.log('PASS', name); pass++; } else { console.log('FAIL', name); fail++; } }

(async () => {
  const browser = await chromium.launch();
  // SW bloqueado: su clients.claim() dispara el reload de index.html (controllerchange),
  // que re-ejecuta addInitScript y machaca el estado del test
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const BASE = 'http://localhost:8899';

  // Estado del Drive simulado
  const remote = { exists: false, id: 'f1', version: 0, data: {} };
  let failMode = null; // null | 'network' | '401'
  let uploads = 0;

  const t0 = Date.now();
  const dbg = (...a) => console.log('[t+' + (Date.now() - t0) + 'ms]', ...a);

  await context.route('https://accounts.google.com/**', r => r.abort());
  await context.route('https://www.googleapis.com/**', async (route) => {
    const req = route.request();
    const url = req.url();
    dbg('MOCK', req.method(), url.replace('https://www.googleapis.com', '').slice(0, 60), req.method() === 'PATCH' ? 'conds=' + JSON.stringify((JSON.parse(req.postData() || '{}').partes_conductores_v1 || [])) : '');
    if (failMode === 'network') return route.abort();
    if (failMode === '401') return route.fulfill({ status: 401, body: '{}' });

    if (url.includes('spaces=appDataFolder')) {
      const files = remote.exists ? [{ id: remote.id, version: String(remote.version) }] : [];
      return route.fulfill({ json: { files: files } });
    }
    if (req.method() === 'POST' && url.includes('uploadType=multipart')) {
      remote.exists = true;
      remote.version = 1;
      remote.data = {};
      return route.fulfill({ json: { id: remote.id, version: '1' } });
    }
    if (url.includes('/files/' + remote.id)) {
      if (!remote.exists) return route.fulfill({ status: 404, body: '{}' });
      if (req.method() === 'PATCH') {
        remote.data = JSON.parse(req.postData());
        remote.version++;
        uploads++;
        return route.fulfill({ json: { version: String(remote.version) } });
      }
      if (url.includes('alt=media')) return route.fulfill({ body: JSON.stringify(remote.data) });
      if (url.includes('fields=version')) return route.fulfill({ json: { version: String(remote.version) } });
    }
    return route.fulfill({ status: 500, body: '{}' });
  });

  // Remoto con datos de "otro dispositivo" + local pre-existente + sesion conectada con token valido
  remote.exists = true;
  remote.version = 3;
  remote.data = { partes_conductores_v1: ['REMOTO PEREZ'] };
  await context.addInitScript(() => {
    localStorage.setItem('drive_sync_meta_v1', JSON.stringify({ connected: true, dirty: true }));
    localStorage.setItem('partes_conductores_v1', JSON.stringify(['LOCAL GARCIA']));
    sessionStorage.setItem('drive_sync_token_v1', JSON.stringify({ tok: 'FAKE', exp: Date.now() + 3600000 }));
  });

  const page = await context.newPage();
  page.on('dialog', d => d.accept());

  console.log('=== TEST drivesync: ciclo completo con Drive simulado ===');
  await page.goto(BASE + '/index.html');
  await page.waitForFunction(() => DriveSync.getStatus() === 'synced', null, { timeout: 5000 }).catch(() => {});

  // 1. Sync inicial: merge remoto+local en ambos lados
  const conds1 = await page.evaluate(() => JSON.parse(localStorage.getItem('partes_conductores_v1')));
  ok('sync inicial: el conductor remoto llega al dispositivo', conds1.includes('REMOTO PEREZ'));
  ok('sync inicial: el conductor local se conserva', conds1.includes('LOCAL GARCIA'));
  ok('sync inicial: lo local sube a Drive (merge, no pisado)', (remote.data.partes_conductores_v1 || []).includes('LOCAL GARCIA') && remote.data.partes_conductores_v1.includes('REMOTO PEREZ'));
  ok('sync inicial: estado synced', await page.evaluate(() => DriveSync.getStatus()) === 'synced');
  ok('sync inicial: dirty limpiado tras subir', await page.evaluate(() => !JSON.parse(localStorage.getItem('drive_sync_meta_v1')).dirty));

  // 2. Cambio remoto (otro dispositivo subio) -> el sondeo lo trae
  remote.data = { partes_conductores_v1: ['REMOTO PEREZ', 'LOCAL GARCIA', 'NUEVO DEL MOVIL'] };
  remote.version++;
  await page.evaluate(() => DriveSync.syncNow());
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('partes_conductores_v1')).includes('NUEVO DEL MOVIL'), null, { timeout: 5000 }).catch(() => {});
  const conds2 = await page.evaluate(() => JSON.parse(localStorage.getItem('partes_conductores_v1')));
  ok('cambio remoto: baja al dispositivo en el siguiente sondeo', conds2.includes('NUEVO DEL MOVIL'));

  // 3. Escritura local -> debounce -> subida automatica
  const upBefore = uploads;
  await page.evaluate(() => {
    var c = JSON.parse(localStorage.getItem('partes_conductores_v1'));
    c.push('ESCRITO AQUI');
    FSStorage.setItem('partes_conductores_v1', JSON.stringify(c));
  });
  await page.waitForTimeout(4500); // debounce 3s + margen
  ok('escritura local: sube sola tras el debounce', (remote.data.partes_conductores_v1 || []).includes('ESCRITO AQUI'));
  ok('escritura local: una sola subida (debounce agrupa)', uploads === upBefore + 1);

  // 4. Sin red: queda pendiente y se recupera al volver
  failMode = 'network';
  await page.evaluate(() => {
    var c = JSON.parse(localStorage.getItem('partes_conductores_v1'));
    c.push('OFFLINE PEREZ');
    FSStorage.setItem('partes_conductores_v1', JSON.stringify(c));
  });
  await page.waitForTimeout(4000);
  ok('sin red: estado pending, no se pierde nada', await page.evaluate(() => DriveSync.getStatus()) === 'pending');
  failMode = null;
  await page.evaluate(() => DriveSync.syncNow());
  await page.waitForFunction(() => DriveSync.getStatus() === 'synced', null, { timeout: 5000 }).catch(() => {});
  ok('vuelve la red: lo pendiente sube', (remote.data.partes_conductores_v1 || []).includes('OFFLINE PEREZ'));

  // 5. Token caducado/revocado (401) -> estado reauth; con token nuevo se recupera
  failMode = '401';
  await page.evaluate(() => DriveSync.syncNow());
  await page.waitForFunction(() => DriveSync.getStatus() === 'reauth', null, { timeout: 5000 }).catch(() => {});
  ok('401: estado reauth', await page.evaluate(() => DriveSync.getStatus()) === 'reauth');
  failMode = null;
  await page.evaluate(() => {
    sessionStorage.setItem('drive_sync_token_v1', JSON.stringify({ tok: 'FAKE2', exp: Date.now() + 3600000 }));
    return DriveSync.syncNow();
  });
  await page.waitForFunction(() => DriveSync.getStatus() === 'synced', null, { timeout: 5000 }).catch(() => {});
  ok('token renovado: vuelve a synced', await page.evaluate(() => DriveSync.getStatus()) === 'synced');

  // 6. Archivo borrado en Drive (usuaria borro datos de la app) -> se recrea con el estado local
  remote.exists = false;
  remote.data = {};
  await page.evaluate(() => DriveSync.syncNow());
  await page.waitForFunction(() => DriveSync.getStatus() === 'synced', null, { timeout: 5000 }).catch(() => {});
  ok('archivo borrado: se recrea en Drive', remote.exists === true);
  ok('archivo borrado: el estado local completo se re-sube', (remote.data.partes_conductores_v1 || []).includes('OFFLINE PEREZ'));

  await browser.close();
  console.log('\n=== RESULTADO:', pass, 'PASS /', fail, 'FAIL ===');
  process.exit(fail ? 1 : 0);
})();
