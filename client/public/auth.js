(function (win) {
  var TOKEN_KEY = 'fdl-vtal-token';
  var USER_KEY = 'fdl-vtal-user';

  function readUser() {
    try {
      var raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function getToken() {
    try {
      return localStorage.getItem(TOKEN_KEY) || '';
    } catch (_) {
      return '';
    }
  }

  function isAuthenticated() {
    return !!getToken();
  }

  function saveSession(token, user) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(user || {}));
    } catch (_) {}
  }

  function clearSession() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch (_) {}
  }

  function hasPermission(name) {
    var user = readUser();
    if (name === 'manageAccess') {
      return !!(user && user.isPlatformAdmin);
    }
    return !!(user && user.permissions && user.permissions[name]);
  }

  function isPlatformAdminUser() {
    var user = readUser();
    return !!(user && user.isPlatformAdmin);
  }

  function authHeaders(extra) {
    var h = { 'Content-Type': 'application/json' };
    var t = getToken();
    if (t) h.Authorization = 'Bearer ' + t;
    if (extra) {
      for (var k in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, k)) h[k] = extra[k];
      }
    }
    return h;
  }

  function guardPage(options) {
    options = options || {};
    if (!isAuthenticated()) {
      win.location.replace('/login.html');
      return false;
    }
    if (options.requireDashboard && !hasPermission('dashboard')) {
      win.location.replace('/index.html');
      return false;
    }
    if (options.requireManageAccess && !isPlatformAdminUser()) {
      win.location.replace('/index.html');
      return false;
    }
    return true;
  }

  function applyNavPermissions() {
    var user = readUser();
    document.querySelectorAll('[data-require-perm]').forEach(function (el) {
      var perm = el.getAttribute('data-require-perm');
      var ok = perm && user && user.permissions && user.permissions[perm];
      el.hidden = !ok;
      if (el.tagName === 'A' && !ok) el.setAttribute('aria-hidden', 'true');
    });
    document.querySelectorAll('[data-require-platform-admin]').forEach(function (el) {
      var ok = !!(user && user.isPlatformAdmin);
      el.hidden = !ok;
      if (!ok && el.tagName === 'A') el.setAttribute('aria-hidden', 'true');
    });
    var vtEl = document.getElementById('nav-user-vt');
    if (vtEl && user) vtEl.textContent = user.vt || '';
  }

  /** Atualiza sessão com /api/auth/me e aplica menu (isPlatformAdmin, permissões). */
  function refreshNavFromServer() {
    var token = getToken();
    if (!token) {
      applyNavPermissions();
      return Promise.resolve();
    }
    return fetch('/api/auth/me', {
      headers: { Authorization: 'Bearer ' + token },
    })
      .then(function (res) {
        if (!res.ok) return applyNavPermissions();
        return res.json().then(function (data) {
          if (data.user) saveSession(token, data.user);
          applyNavPermissions();
        });
      })
      .catch(function () {
        applyNavPermissions();
      });
  }

  function fdlVtalLogout() {
    var token = getToken();
    clearSession();
    if (token) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
      }).catch(function () {});
    }
    win.location.replace('/login.html');
  }

  win.fdlVtalAuth = {
    getToken: getToken,
    getUser: readUser,
    isAuthenticated: isAuthenticated,
    saveSession: saveSession,
    clearSession: clearSession,
    hasPermission: hasPermission,
    isPlatformAdmin: isPlatformAdminUser,
    authHeaders: authHeaders,
    guardPage: guardPage,
    applyNavPermissions: applyNavPermissions,
    refreshNavFromServer: refreshNavFromServer,
    logout: fdlVtalLogout,
  };
  win.fdlVtalLogout = fdlVtalLogout;
})(typeof window !== 'undefined' ? window : globalThis);
