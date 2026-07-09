(function(global) {
  'use strict';

  var DATA_KEYS = ['partes_vehiculos_v1', 'partes_conductores_v1', 'cht_parte_servicio_diario_v1', 'cht_orden_reparacion_v1', 'partes_combustible_hist_v1', 'partes_tombstones_v1'];
  var HIST_KEY = 'partes_combustible_hist_v1';
  var TOMB_KEY = 'partes_tombstones_v1';
  var TOMB_TTL_MS = 180 * 24 * 60 * 60 * 1000;
  // Colecciones cuyos borrados dejan lapida para que el merge no los resucite
  var TOMB_TRACKED = { 'cht_parte_servicio_diario_v1': 1, 'cht_orden_reparacion_v1': 1 };
  TOMB_TRACKED[HIST_KEY] = 1;

  var _ready = false;
  var _queue = [];
  var _writeCbs = [];
  var _syncActive = false;

  function photoCutoffStr() {
    var c = new Date();
    c.setMonth(c.getMonth() - 3);
    return c.getFullYear() + '-' + String(c.getMonth() + 1).padStart(2, '0');
  }

  // Solo para localStorage: la copia remota (Drive) conserva siempre las fotos completas
  function stripOldPhotos(hist) {
    if (!hist || typeof hist !== 'object') return hist;
    var cutoff = photoCutoffStr();
    var out = {};
    Object.keys(hist).forEach(function(k) {
      var rec = hist[k];
      var mes = (rec && rec.mes) || (k.split('/')[1] || '');
      if (rec && rec.photos && Object.keys(rec.photos).length && mes && mes < cutoff) {
        var copy = Object.assign({}, rec);
        delete copy.photos;
        out[k] = copy;
      } else {
        out[k] = rec;
      }
    });
    return out;
  }

  function lsWrite(k, val) {
    var v = (_syncActive && k === HIST_KEY) ? stripOldPhotos(val) : val;
    localStorage.setItem(k, JSON.stringify(v));
  }

  function recIds(key, val) {
    if (!val) return [];
    if (key === HIST_KEY) return (typeof val === 'object') ? Object.keys(val) : [];
    return (Array.isArray(val) ? val : []).map(function(p) { return p && p.id; }).filter(Boolean);
  }

  function loadTombs() {
    try { return JSON.parse(localStorage.getItem(TOMB_KEY)) || {}; } catch(e) { return {}; }
  }

  function trackDeletions(key, oldRaw, newRaw) {
    if (!TOMB_TRACKED[key]) return;
    var o = null, n = null;
    try { o = JSON.parse(oldRaw); } catch(e) {}
    try { n = JSON.parse(newRaw); } catch(e) {}
    var after = {};
    recIds(key, n).forEach(function(id) { after[id] = 1; });
    var tombs = loadTombs();
    var changed = false;
    recIds(key, o).forEach(function(id) {
      if (!after[id]) { tombs[key + '|' + id] = new Date().toISOString(); changed = true; }
    });
    Object.keys(after).forEach(function(id) {
      if (tombs[key + '|' + id]) { delete tombs[key + '|' + id]; changed = true; }
    });
    if (changed) localStorage.setItem(TOMB_KEY, JSON.stringify(tombs));
  }

  function mergeTombs(a, b) {
    var out = {};
    var cutoff = Date.now() - TOMB_TTL_MS;
    [a, b].forEach(function(src) {
      if (!src || typeof src !== 'object') return;
      Object.keys(src).forEach(function(k) {
        var ts = src[k];
        if (!ts || new Date(ts).getTime() < cutoff) return;
        if (!out[k] || new Date(ts) > new Date(out[k])) out[k] = ts;
      });
    });
    return out;
  }

  function tombKeeps(tombs, key, id, rec) {
    var t = tombs[key + '|' + id];
    if (!t) return true;
    return new Date(rec && (rec.updatedAt || rec.createdAt) || 0) > new Date(t);
  }

  function mergeData(file, ls) {
    var result = {};
    var tombs = mergeTombs(file[TOMB_KEY], ls[TOMB_KEY]);
    var keys = {};
    Object.keys(file).forEach(function(k) { keys[k] = 1; });
    Object.keys(ls).forEach(function(k) { keys[k] = 1; });
    Object.keys(keys).forEach(function(k) {
      if (k === TOMB_KEY) return;
      var fv = file[k], lv = ls[k];
      if (fv === undefined) fv = TOMB_TRACKED[k] ? (Array.isArray(lv) ? [] : {}) : undefined;
      if (lv === undefined) lv = TOMB_TRACKED[k] ? (Array.isArray(fv) ? [] : {}) : undefined;
      if (fv === undefined) { result[k] = lv; return; }
      if (lv === undefined) { result[k] = fv; return; }
      if (k === 'partes_vehiculos_v1') {
        var mergedV = {};
        Object.keys(Object.assign({}, fv, lv)).forEach(function(mat) {
          mergedV[mat] = Object.assign({}, fv[mat], lv[mat]);
        });
        result[k] = mergedV;
      } else if (k === HIST_KEY) {
        var mergedH = {};
        var phCutoff = photoCutoffStr();
        Object.keys(Object.assign({}, fv, lv)).forEach(function(rk) {
          var a = fv[rk], b = lv[rk];
          if (a && b) {
            var win = (new Date(b.updatedAt || 0) >= new Date(a.updatedAt || 0)) ? b : a;
            // Si gana localStorage en un registro antiguo, sus fotos pueden haber sido purgadas:
            // recuperarlas del lado remoto para no perderlas al reescribir
            var mes = win.mes || (rk.split('/')[1] || '');
            if (win === b && a.photos && Object.keys(a.photos).length && mes && mes < phCutoff) {
              var ph = Object.assign({}, a.photos, win.photos || {});
              var valid = {};
              var n = (win.entries || []).length;
              Object.keys(ph).forEach(function(i) { if (parseInt(i, 10) < n) valid[i] = ph[i]; });
              if (Object.keys(valid).length) win = Object.assign({}, win, { photos: valid });
            }
            if (tombKeeps(tombs, k, rk, win)) mergedH[rk] = win;
          } else {
            var only = b || a;
            if (tombKeeps(tombs, k, rk, only)) mergedH[rk] = only;
          }
        });
        result[k] = mergedH;
      } else if (k === 'partes_conductores_v1') {
        var s = {};
        (Array.isArray(fv) ? fv : []).concat(Array.isArray(lv) ? lv : []).forEach(function(v) { if (v) s[v] = 1; });
        result[k] = Object.keys(s).sort();
      } else if (k === 'cht_parte_servicio_diario_v1' || k === 'cht_orden_reparacion_v1') {
        var m = {};
        (Array.isArray(fv) ? fv : []).concat(Array.isArray(lv) ? lv : []).forEach(function(p) {
          if (!p || !p.id) return;
          var prev = m[p.id];
          if (!prev || new Date(p.updatedAt || p.createdAt || 0) >= new Date(prev.updatedAt || prev.createdAt || 0)) m[p.id] = p;
        });
        result[k] = Object.values(m).filter(function(p) { return tombKeeps(tombs, k, p.id, p); });
      } else {
        result[k] = lv;
      }
    });
    result[TOMB_KEY] = tombs;
    return result;
  }

  function notifyWrite() {
    _writeCbs.forEach(function(cb) { try { cb(); } catch(e) {} });
  }

  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist();
  }

  var FSStorage = {
    init: function() {
      _ready = true;
      _queue.forEach(function(cb) { try { cb(); } catch(e) {} });
      _queue = [];
    },

    onReady: function(cb) {
      if (_ready) { try { cb(); } catch(e) {} }
      else _queue.push(cb);
    },

    getItem: function(key) {
      return localStorage.getItem(key);
    },

    setItem: function(key, value) {
      var oldRaw = TOMB_TRACKED[key] ? localStorage.getItem(key) : null;
      if (_syncActive && key === HIST_KEY) {
        try { lsWrite(key, JSON.parse(value)); } catch(e) { localStorage.setItem(key, value); }
      } else {
        localStorage.setItem(key, value);
      }
      trackDeletions(key, oldRaw, value);
      notifyWrite();
    },

    removeItem: function(key) {
      localStorage.removeItem(key);
      notifyWrite();
    },

    onWrite: function(cb) { _writeCbs.push(cb); },
    setSyncActive: function(flag) { _syncActive = !!flag; },
    mergeData: mergeData,

    readAll: function() {
      var out = {};
      DATA_KEYS.forEach(function(k) {
        var v = localStorage.getItem(k);
        if (v) try { out[k] = JSON.parse(v); } catch(e) {}
      });
      return out;
    },

    writeAll: function(data) {
      DATA_KEYS.forEach(function(k) {
        if (data[k] !== undefined) lsWrite(k, data[k]);
      });
    }
  };

  global.FSStorage = FSStorage;
})(window);
