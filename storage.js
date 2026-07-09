(function(global) {
  'use strict';

  var IDB_DB = 'partes_fss_v1';
  var IDB_STORE = 'config';
  var HANDLE_KEY = 'file_handle';
  var DATA_KEYS = ['partes_vehiculos_v1', 'partes_conductores_v1', 'cht_parte_servicio_diario_v1', 'cht_orden_reparacion_v1', 'partes_combustible_hist_v1'];

  var _handle = null;
  var _cache = {};
  var _active = false;
  var _pending = false;
  var _ready = false;
  var _queue = [];
  var _supported = typeof window.showSaveFilePicker === 'function';

  function openIDB() {
    return new Promise(function(res, rej) {
      var r = indexedDB.open(IDB_DB, 1);
      r.onupgradeneeded = function(e) { e.target.result.createObjectStore(IDB_STORE); };
      r.onsuccess = function(e) { res(e.target.result); };
      r.onerror = function(e) { rej(e.target.error); };
    });
  }

  function idbGet(key) {
    return openIDB().then(function(db) {
      return new Promise(function(res, rej) {
        var r = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
        r.onsuccess = function(e) { res(e.target.result); };
        r.onerror = function(e) { rej(e.target.error); };
      });
    });
  }

  function idbPut(key, val) {
    return openIDB().then(function(db) {
      return new Promise(function(res, rej) {
        var tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(val, key);
        tx.oncomplete = function() { res(); };
        tx.onerror = function(e) { rej(e.target.error); };
      });
    });
  }

  function idbDelete(key) {
    return openIDB().then(function(db) {
      return new Promise(function(res, rej) {
        var tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).delete(key);
        tx.oncomplete = function() { res(); };
        tx.onerror = function(e) { rej(e.target.error); };
      });
    });
  }

  async function readFile(handle) {
    var file = await handle.getFile();
    var text = await file.text();
    if (!text || !text.trim()) return {};
    try { return JSON.parse(text); } catch(e) { return {}; }
  }

  async function writeFile(handle, data) {
    var w = await handle.createWritable();
    await w.write(JSON.stringify(data, null, 2));
    await w.close();
  }

  async function queryOnly(handle) {
    try { return await handle.queryPermission({ mode: 'readwrite' }); } catch(e) { return 'denied'; }
  }

  async function requestPerm(handle) {
    try { return await handle.requestPermission({ mode: 'readwrite' }); } catch(e) { return 'denied'; }
  }

  function loadLS() {
    DATA_KEYS.forEach(function(k) {
      var v = localStorage.getItem(k);
      if (v) try { _cache[k] = JSON.parse(v); } catch(e) {}
    });
  }

  function notify() {
    _ready = true;
    _queue.forEach(function(cb) { try { cb(); } catch(e) {} });
    _queue = [];
    if (_pending) showReconnectBanner();
  }

  function showReconnectBanner() {
    if (document.getElementById('_fsr_banner')) return;
    if (document.getElementById('st-pend')) return; // index.html has its own UI
    var d = document.createElement('div');
    d.id = '_fsr_banner';
    d.setAttribute('style', [
      'position:fixed;top:0;left:0;right:0;z-index:9999',
      'background:#1e3a5f;color:#fff',
      'padding:10px 14px;display:flex;align-items:center;gap:10px',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:13px',
      'box-shadow:0 2px 10px rgba(0,0,0,.4)'
    ].join(';'));
    d.innerHTML =
      '<span style="flex:1;line-height:1.4">🔗 Archivo vinculado pero sin permiso. Toca para sincronizar los datos.</span>' +
      '<button style="flex-shrink:0;background:#3b82f6;color:#fff;border:none;border-radius:7px;padding:8px 14px;font-size:12px;font-weight:700;cursor:pointer;-webkit-tap-highlight-color:transparent">Reconectar</button>';
    d.querySelector('button').addEventListener('click', function() {
      FSStorage.reconnect().then(function(ok) {
        if (ok) {
          d.remove();
        }
      });
    });
    document.body.appendChild(d);
  }

  function photoCutoffStr() {
    var c = new Date();
    c.setMonth(c.getMonth() - 3);
    return c.getFullYear() + '-' + String(c.getMonth() + 1).padStart(2, '0');
  }

  // Solo para la copia de localStorage: el JSON vinculado conserva siempre las fotos completas
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
    var v = (_active && k === 'partes_combustible_hist_v1') ? stripOldPhotos(val) : val;
    localStorage.setItem(k, JSON.stringify(v));
  }

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
        var phCutoff = photoCutoffStr();
        Object.keys(Object.assign({}, fv, lv)).forEach(function(rk) {
          var a = fv[rk], b = lv[rk];
          if (a && b) {
            var win = (new Date(b.updatedAt || 0) >= new Date(a.updatedAt || 0)) ? b : a;
            // Si gana localStorage en un registro antiguo, sus fotos pueden haber sido purgadas:
            // recuperarlas del archivo para no perderlas del JSON al reescribirlo
            var mes = win.mes || (rk.split('/')[1] || '');
            if (win === b && a.photos && Object.keys(a.photos).length && mes && mes < phCutoff) {
              var ph = Object.assign({}, a.photos, win.photos || {});
              var valid = {};
              var n = (win.entries || []).length;
              Object.keys(ph).forEach(function(i) { if (parseInt(i, 10) < n) valid[i] = ph[i]; });
              if (Object.keys(valid).length) win = Object.assign({}, win, { photos: valid });
            }
            mergedH[rk] = win;
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

  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist();
  }

  var FSStorage = {
    init: async function() {
      _ready = false;
      _active = false;
      _pending = false;
      _cache = {};
      if (!_supported) { loadLS(); notify(); return; }
      try {
        var handle = await idbGet(HANDLE_KEY);
        if (handle) {
          var perm = await queryOnly(handle);
          if (perm === 'granted') {
            _handle = handle;
            _cache = await readFile(handle);
            _active = true;
            DATA_KEYS.forEach(function(k) {
              if (_cache[k] !== undefined) lsWrite(k, _cache[k]);
            });
          } else if (perm === 'prompt') {
            _handle = handle;
            _pending = true;
          } else {
            await idbDelete(HANDLE_KEY);
          }
        }
      } catch(e) {
        console.warn('[FSStorage] init:', e.message);
      }
      if (!_active) loadLS();
      notify();
    },

    onReady: function(cb) {
      if (_ready) { try { cb(); } catch(e) {} }
      else _queue.push(cb);
    },

    isActive: function() { return _active; },
    isPending: function() { return _pending; },
    isSupported: function() { return _supported; },

    reconnect: async function() {
      if (!_handle) return false;
      try {
        var perm = await requestPerm(_handle);
        if (perm !== 'granted') return false;
        _pending = false;
        _active = true;
        try {
          var fileData = await readFile(_handle);
          var lsData = {};
          DATA_KEYS.forEach(function(k) {
            var v = localStorage.getItem(k);
            if (v) try { lsData[k] = JSON.parse(v); } catch(e) {}
          });
          _cache = mergeData(fileData, lsData);
          if (Object.keys(lsData).length) await writeFile(_handle, _cache);
          DATA_KEYS.forEach(function(k) {
            if (_cache[k] !== undefined) lsWrite(k, _cache[k]);
          });
        } catch(e) {
          console.warn('[FSStorage] reconnect merge:', e.message);
          loadLS();
        }
        return true;
      } catch(e) {
        console.warn('[FSStorage] reconnect:', e.message);
        return false;
      }
    },

    setup: async function(useExisting) {
      if (!_supported) {
        alert('Tu navegador no soporta esta función.\nUsa Chrome o Edge (Android o escritorio).');
        return false;
      }
      try {
        var handle;
        if (useExisting) {
          var picks = await window.showOpenFilePicker({
            mode: 'readwrite',
            types: [{ description: 'Datos JSON', accept: { 'application/json': ['.json'] } }]
          });
          handle = picks[0];
        } else {
          handle = await window.showSaveFilePicker({
            suggestedName: 'partes_datos.json',
            types: [{ description: 'Datos JSON', accept: { 'application/json': ['.json'] } }]
          });
        }
        var perm = await queryOnly(handle);
        if (perm !== 'granted') {
          perm = await requestPerm(handle);
          if (perm !== 'granted') {
            alert('Se necesita permiso de escritura para usar el archivo.');
            return false;
          }
        }
        var fileData = {};
        try { fileData = await readFile(handle); } catch(e) {}
        var lsData = {};
        DATA_KEYS.forEach(function(k) {
          var v = localStorage.getItem(k);
          if (v) try { lsData[k] = JSON.parse(v); } catch(e) {}
        });
        var merged = mergeData(fileData, lsData);
        await writeFile(handle, merged);
        await idbPut(HANDLE_KEY, handle);
        _handle = handle;
        _cache = merged;
        _active = true;
        return true;
      } catch(e) {
        if (e.name === 'AbortError') return false;
        console.error('[FSStorage] setup:', e);
        alert('Error al configurar el archivo: ' + e.message);
        return false;
      }
    },

    disconnect: async function() {
      try { await idbDelete(HANDLE_KEY); } catch(e) {}
      _handle = null;
      _active = false;
    },

    getItem: function(key) {
      if (_active) {
        var v = _cache[key];
        return (v === undefined || v === null) ? null : JSON.stringify(v);
      }
      return localStorage.getItem(key);
    },

    setItem: function(key, value) {
      if (_active) {
        try { _cache[key] = JSON.parse(value); } catch(e) { _cache[key] = value; }
        writeFile(_handle, _cache).catch(function(e) {
          console.error('[FSStorage] write:', e.message);
        });
        if (key === 'partes_combustible_hist_v1' && typeof _cache[key] === 'object') lsWrite(key, _cache[key]);
        else localStorage.setItem(key, value);
        return;
      }
      localStorage.setItem(key, value);
    },

    removeItem: function(key) {
      if (_active) {
        delete _cache[key];
        writeFile(_handle, _cache).catch(function(e) {
          console.error('[FSStorage] write:', e.message);
        });
        localStorage.removeItem(key);
        return;
      }
      localStorage.removeItem(key);
    }
  };

  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible' && _pending) {
      showReconnectBanner();
    }
  });

  global.FSStorage = FSStorage;
})(window);
