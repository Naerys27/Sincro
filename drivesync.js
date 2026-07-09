(function(global) {
  'use strict';

  var CLIENT_ID = '338667928622-7amjcvnueqo30ru0sko37aa4tn4ur5m9.apps.googleusercontent.com';
  var SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  var FILE_NAME = 'partes_datos.json';
  var FILES_URL = 'https://www.googleapis.com/drive/v3/files';
  var UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
  var GIS_SRC = 'https://accounts.google.com/gsi/client';
  var POLL_MS = 30000;
  var DEBOUNCE_MS = 3000;
  var NAG_MS = 24 * 60 * 60 * 1000;
  var TOKEN_TIMEOUT_MS = 30000;
  var META_KEY = 'drive_sync_meta_v1';
  var TOKEN_KEY = 'drive_sync_token_v1';
  var NAG_KEY = 'drive_sync_nag_v1';

  var _meta = loadMeta();
  var _status = _meta.connected ? 'pending' : 'disconnected';
  var _statusCbs = [];
  var _dataCbs = [];
  var _gisPromise = null;
  var _tokenClient = null;
  var _tokenCb = null;
  var _tokenPromise = null;
  var _syncing = false;
  var _syncAgain = false;
  var _debounceTimer = null;
  var _timersOn = false;
  var _lastSilentRetry = 0;

  function loadMeta() {
    try { return JSON.parse(localStorage.getItem(META_KEY)) || {}; } catch(e) { return {}; }
  }

  function saveMeta() {
    localStorage.setItem(META_KEY, JSON.stringify(_meta));
  }

  function setStatus(s) {
    if (_status === s) return;
    _status = s;
    _statusCbs.forEach(function(cb) { try { cb(s); } catch(e) {} });
    if (s === 'reauth') maybeShowNag();
  }

  function cachedToken() {
    try {
      var t = JSON.parse(sessionStorage.getItem(TOKEN_KEY));
      if (t && t.exp > Date.now() + 60000) return t.tok;
    } catch(e) {}
    return null;
  }

  function loadGIS() {
    if (global.google && google.accounts) return Promise.resolve();
    if (_gisPromise) return _gisPromise;
    _gisPromise = new Promise(function(res, rej) {
      var s = document.createElement('script');
      s.src = GIS_SRC;
      s.onload = function() { res(); };
      s.onerror = function() { _gisPromise = null; rej(new Error('offline')); };
      document.head.appendChild(s);
    });
    return _gisPromise;
  }

  function requestToken(interactive, selectAccount) {
    return loadGIS().then(function() {
      return new Promise(function(res, rej) {
        if (!_tokenClient) {
          _tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPE,
            callback: function(r) { if (_tokenCb) _tokenCb(r); },
            error_callback: function() { if (_tokenCb) _tokenCb(null); }
          });
        }
        var timer = setTimeout(function() { _tokenCb = null; rej(new Error('reauth')); }, TOKEN_TIMEOUT_MS);
        _tokenCb = function(r) {
          clearTimeout(timer);
          _tokenCb = null;
          if (r && r.access_token) {
            var exp = Date.now() + (parseInt(r.expires_in, 10) - 60) * 1000;
            sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ tok: r.access_token, exp: exp }));
            res(r.access_token);
          } else {
            rej(new Error('reauth'));
          }
        };
        _tokenClient.requestAccessToken(
          selectAccount ? { prompt: 'select_account' } : (interactive ? {} : { prompt: 'none' })
        );
      });
    });
  }

  function getToken(interactive, selectAccount) {
    if (!selectAccount) {
      var t = cachedToken();
      if (t) return Promise.resolve(t);
    }
    if (_tokenPromise) return _tokenPromise;
    _tokenPromise = requestToken(interactive, selectAccount).then(
      function(tok) { _tokenPromise = null; return tok; },
      function(e) { _tokenPromise = null; throw e; }
    );
    return _tokenPromise;
  }

  function api(url, opts, token) {
    opts = opts || {};
    opts.headers = Object.assign({ 'Authorization': 'Bearer ' + token }, opts.headers || {});
    return fetch(url, opts).then(function(r) {
      if (r.status === 401 || r.status === 403) { sessionStorage.removeItem(TOKEN_KEY); throw new Error('reauth'); }
      if (r.status === 404) throw new Error('notfound');
      if (!r.ok) throw new Error('api ' + r.status);
      return r;
    });
  }

  function findFile(token) {
    var q = encodeURIComponent("name='" + FILE_NAME + "'");
    return api(FILES_URL + '?spaces=appDataFolder&q=' + q + '&fields=files(id,version)', {}, token)
      .then(function(r) { return r.json(); })
      .then(function(j) { return (j.files && j.files[0]) || null; });
  }

  function createFile(token) {
    var boundary = 'partes' + Date.now();
    var body = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify({ name: FILE_NAME, parents: ['appDataFolder'] }) +
      '\r\n--' + boundary + '\r\nContent-Type: application/json\r\n\r\n{}\r\n--' + boundary + '--';
    return api(UPLOAD_URL + '?uploadType=multipart&fields=id,version', {
      method: 'POST',
      headers: { 'Content-Type': 'multipart/related; boundary=' + boundary },
      body: body
    }, token).then(function(r) { return r.json(); });
  }

  function getVersion(token, id) {
    return api(FILES_URL + '/' + id + '?fields=version', {}, token)
      .then(function(r) { return r.json(); })
      .then(function(j) { return j.version; });
  }

  function download(token, id) {
    return api(FILES_URL + '/' + id + '?alt=media', {}, token)
      .then(function(r) { return r.text(); })
      .then(function(t) { try { return JSON.parse(t) || {}; } catch(e) { return {}; } });
  }

  function upload(token, id, data) {
    return api(UPLOAD_URL + '/' + id + '?uploadType=media&fields=version', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }, token).then(function(r) { return r.json(); })
      .then(function(j) { return j.version; });
  }

  function ensureFileId(token) {
    if (_meta.fileId) return Promise.resolve(_meta.fileId);
    return findFile(token).then(function(f) {
      if (f) {
        _meta.fileId = f.id;
        _meta.dirty = true;
        saveMeta();
        return f.id;
      }
      return createFile(token).then(function(created) {
        _meta.fileId = created.id;
        _meta.lastVersion = created.version;
        _meta.dirty = true;
        saveMeta();
        return created.id;
      });
    });
  }

  function notifyData() {
    _dataCbs.forEach(function(cb) { try { cb(); } catch(e) {} });
  }

  function pullPush(token, id) {
    return getVersion(token, id).then(function(ver) {
      if (ver === _meta.lastVersion && !_meta.dirty) return;
      var remoteChanged = ver !== _meta.lastVersion;
      return download(token, id).then(function(remote) {
        var merged = FSStorage.mergeData(remote, FSStorage.readAll());
        FSStorage.writeAll(merged);
        if (remoteChanged) notifyData();
        var wasDirty = _meta.dirty;
        _meta.lastVersion = ver;
        saveMeta();
        if (!wasDirty) return;
        return upload(token, id, merged).then(function(newVer) {
          _meta.lastVersion = newVer;
          _meta.dirty = false;
          saveMeta();
        });
      });
    });
  }

  function handleSyncError(e) {
    if (e.message === 'notfound') {
      _meta.fileId = null;
      _meta.lastVersion = null;
      _meta.dirty = true;
      saveMeta();
      _syncAgain = true;
      return;
    }
    if (e.message === 'reauth') { setStatus('reauth'); return; }
    setStatus('pending');
    console.warn('[DriveSync]', e.message);
  }

  function syncNow(interactive, selectAccount) {
    if (!_meta.connected && !interactive) return Promise.resolve();
    if (_syncing) { _syncAgain = true; return Promise.resolve(); }
    _syncing = true;
    var token;
    return getToken(interactive, selectAccount).then(function(t) {
      token = t;
      return ensureFileId(token);
    }).then(function(id) {
      return pullPush(token, id);
    }).then(function() {
      _meta.lastSync = Date.now();
      saveMeta();
      setStatus('synced');
    }).catch(handleSyncError).then(function() {
      _syncing = false;
      if (_syncAgain) { _syncAgain = false; return syncNow(false); }
    });
  }

  function maybeShowNag() {
    if (document.getElementById('st-panel')) return; // index.html tiene su propio panel
    if (document.getElementById('_ds_nag')) return;
    var last = parseInt(localStorage.getItem(NAG_KEY) || '0', 10);
    if (Date.now() - last < NAG_MS) return;
    localStorage.setItem(NAG_KEY, String(Date.now()));
    var d = document.createElement('div');
    d.id = '_ds_nag';
    d.setAttribute('role', 'status');
    d.setAttribute('aria-live', 'polite');
    d.setAttribute('style', [
      'position:fixed;bottom:14px;left:50%;transform:translateX(-50%);z-index:9998',
      'background:#1e3a5f;color:#fff;border-radius:20px;padding:10px 18px',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:12px',
      'box-shadow:0 2px 10px rgba(0,0,0,.35);cursor:pointer;-webkit-tap-highlight-color:transparent'
    ].join(';'));
    d.textContent = '☁️ Sin sincronizar — toca para reconectar';
    d.addEventListener('click', function() {
      d.remove();
      syncNow(true);
    });
    document.body.appendChild(d);
  }

  function startTimers() {
    if (_timersOn) return;
    _timersOn = true;
    setInterval(function() {
      if (document.visibilityState === 'visible') syncNow(false);
    }, POLL_MS);
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'visible') syncNow(false);
    });
    global.addEventListener('online', function() { syncNow(false); });
    document.addEventListener('click', function() {
      if (_status !== 'reauth' || !_meta.connected) return;
      if (Date.now() - _lastSilentRetry < 60000) return;
      _lastSilentRetry = Date.now();
      syncNow(false);
    }, true);
    FSStorage.onWrite(function() {
      _meta.dirty = true;
      saveMeta();
      if (_status === 'synced') setStatus('pending');
      clearTimeout(_debounceTimer);
      _debounceTimer = setTimeout(function() { syncNow(false); }, DEBOUNCE_MS);
    });
  }

  var DriveSync = {
    connect: function() {
      sessionStorage.removeItem(TOKEN_KEY);
      _meta.connected = true;
      _meta.dirty = true;
      saveMeta();
      FSStorage.setSyncActive(true);
      startTimers();
      return syncNow(true, true).then(function() { return _status === 'synced'; });
    },

    disconnect: function() {
      var tok = cachedToken();
      if (tok && global.google && google.accounts) {
        try { google.accounts.oauth2.revoke(tok, function() {}); } catch(e) {}
      }
      sessionStorage.removeItem(TOKEN_KEY);
      _meta = {};
      saveMeta();
      FSStorage.setSyncActive(false);
      setStatus('disconnected');
    },

    syncNow: function() { return syncNow(false); },
    getStatus: function() { return _status; },
    isConnected: function() { return !!_meta.connected; },
    lastSyncTime: function() { return _meta.lastSync || null; },
    onStatusChange: function(cb) { _statusCbs.push(cb); },
    onDataChange: function(cb) { _dataCbs.push(cb); }
  };

  if (_meta.connected) {
    FSStorage.setSyncActive(true);
    startTimers();
    setTimeout(function() { syncNow(false); }, 0);
  }

  global.DriveSync = DriveSync;
})(window);
