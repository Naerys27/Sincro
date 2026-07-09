// Replica exacta de mergeData() de storage.js (funcion privada, no exportada) para probarla aislada
function mergeData(file, ls) {
  var result = {};
  var keys = {};
  Object.keys(file).forEach(function(k) { keys[k] = 1; });
  Object.keys(ls).forEach(function(k) { keys[k] = 1; });
  Object.keys(keys).forEach(function(k) {
    var fv = file[k], lv = ls[k];
    if (fv === undefined) { result[k] = lv; return; }
    if (lv === undefined) { result[k] = fv; return; }
    if (k === 'partes_vehiculos_v1') {
      var mergedV = {};
      Object.keys(Object.assign({}, fv, lv)).forEach(function(mat) {
        mergedV[mat] = Object.assign({}, fv[mat], lv[mat]);
      });
      result[k] = mergedV;
    } else if (k === 'partes_combustible_hist_v1') {
      var mergedH = {};
      Object.keys(Object.assign({}, fv, lv)).forEach(function(rk) {
        var a = fv[rk], b = lv[rk];
        if (a && b) {
          mergedH[rk] = (new Date(b.updatedAt || 0) >= new Date(a.updatedAt || 0)) ? b : a;
        } else {
          mergedH[rk] = b || a;
        }
      });
      result[k] = mergedH;
    } else if (k === 'partes_conductores_v1') {
      var s = {};
      (Array.isArray(fv) ? fv : []).concat(Array.isArray(lv) ? lv : []).forEach(function(v) { if (v) s[v] = 1; });
      result[k] = Object.keys(s).sort();
    } else if (k === 'cht_parte_servicio_diario_v1' || k === 'cht_orden_reparacion_v1') {
      var m = {};
      (Array.isArray(fv) ? fv : []).concat(Array.isArray(lv) ? lv : []).forEach(function(p) { if (p && p.id) m[p.id] = p; });
      result[k] = Object.values(m);
    } else {
      result[k] = lv;
    }
  });
  return result;
}

var pass = 0, fail = 0;
function ok(name, cond) { if (cond) { console.log('PASS', name); pass++; } else { console.log('FAIL', name); fail++; } }

// Caso original que confirmo el bug: file (otro dispositivo, mas reciente) tenia 3 repostajes,
// localStorage de este PC (desactualizado) solo 1. Antes del fix, ganaba localStorage entero -> se perdian 2 repostajes.
var fileFromOtherDevice = {
  partes_combustible_hist_v1: {
    'AAAA111/2026-07': {
      mat: 'AAAA111', mes: '2026-07', tipo: 'gasolina',
      entries: [{ kms: '1000', eur: '50', lit: '35' }, { kms: '1500', eur: '55', lit: '38' }, { kms: '2000', eur: '60', lit: '40' }],
      updatedAt: '2026-07-03T10:00:00.000Z'
    }
  }
};
var localStorageThisPC = {
  partes_combustible_hist_v1: {
    'AAAA111/2026-07': { mat: 'AAAA111', mes: '2026-07', tipo: 'gasolina', entries: [{ kms: '1000', eur: '50', lit: '35' }], updatedAt: '2026-06-20T08:00:00.000Z' }
  }
};
var merged = mergeData(fileFromOtherDevice, localStorageThisPC);
ok('Combustible: gana el registro con updatedAt mas reciente (file), no se pierden repostajes', merged.partes_combustible_hist_v1['AAAA111/2026-07'].entries.length === 3);

// Caso inverso: localStorage es el mas reciente, debe ganar sobre el file desactualizado
var fileOld = { partes_combustible_hist_v1: { 'AAAA111/2026-07': { entries: [1], updatedAt: '2026-06-20T08:00:00.000Z' } } };
var lsNew = { partes_combustible_hist_v1: { 'AAAA111/2026-07': { entries: [1, 2, 3], updatedAt: '2026-07-03T10:00:00.000Z' } } };
var merged2 = mergeData(fileOld, lsNew);
ok('Combustible: gana localStorage cuando es el mas reciente', merged2.partes_combustible_hist_v1['AAAA111/2026-07'].entries.length === 3);

// partes_vehiculos_v1: file tiene tarjeta/coste que localStorage desactualizado no tiene -> antes se perdian, ahora se conservan
var fileVeh = { partes_vehiculos_v1: { MMM05520: { marca: 'NISSAN', modelo: 'X TRAIL', tarjeta: '9724 9900 5995 0087', coste: '102' } } };
var lsVeh = { partes_vehiculos_v1: { MMM05520: { marca: 'NISSAN', modelo: 'X TRAIL' } } };
var mergedVeh = mergeData(fileVeh, lsVeh);
ok('Vehiculos: tarjeta del file se conserva aunque ls no la tenga', mergedVeh.partes_vehiculos_v1.MMM05520.tarjeta === '9724 9900 5995 0087');
ok('Vehiculos: coste del file se conserva', mergedVeh.partes_vehiculos_v1.MMM05520.coste === '102');

// partes_vehiculos_v1: mismo campo presente en ambos, debe ganar localStorage (dispositivo activo/mas reciente en uso)
var mergedVeh2 = mergeData({ partes_vehiculos_v1: { MMM05520: { tarjeta: 'VIEJA' } } }, { partes_vehiculos_v1: { MMM05520: { tarjeta: 'NUEVA' } } });
ok('Vehiculos: campo presente en ambos, gana localStorage', mergedVeh2.partes_vehiculos_v1.MMM05520.tarjeta === 'NUEVA');

// Comportamiento previo (arrays de conductores, servicio diario, ordenes) debe seguir intacto
var r3 = mergeData(
  { partes_conductores_v1: ['ANA'], cht_parte_servicio_diario_v1: [{ id: 'a', x: 1 }] },
  { partes_conductores_v1: ['BEA'], cht_parte_servicio_diario_v1: [{ id: 'b', x: 2 }] }
);
ok('Conductores: union+dedup sigue funcionando', r3.partes_conductores_v1.length === 2);
ok('Servicio diario: union por id sigue funcionando', r3.cht_parte_servicio_diario_v1.length === 2);

console.log('\n=== RESULTADO:', pass, 'PASS /', fail, 'FAIL ===');
process.exit(fail ? 1 : 0);

