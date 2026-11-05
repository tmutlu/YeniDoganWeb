/* ==================================================================
   Ortak yardımcılar: API çağrıları, oturum kontrolü, biçimlendirme
   ================================================================== */

const App = (() => {
  let cachedUser = null;

  /* ------------------------------ API ---------------------------- */

  async function request(path, options = {}) {
    const config = {
      method: options.method || 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    };
    if (options.body !== undefined) {
      config.headers['Content-Type'] = 'application/json';
      config.body = JSON.stringify(options.body);
    }

    let response;
    try {
      response = await fetch(path, config);
    } catch (_) {
      throw new Error('Sunucuya ulaşılamadı. Yerel sunucu çalışıyor mu?');
    }

    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json') ? await response.json() : null;

    if (!response.ok) {
      const error = new Error((payload && payload.error) || `İstek başarısız (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  const get = (path) => request(path);
  const post = (path, body) => request(path, { method: 'POST', body });
  const patch = (path, body) => request(path, { method: 'PATCH', body });
  const del = (path) => request(path, { method: 'DELETE' });

  /* ---------------------------- Oturum --------------------------- */

  async function currentUser(force) {
    if (cachedUser && !force) return cachedUser;
    try {
      const data = await get('/api/auth/me');
      cachedUser = data.user;
      return cachedUser;
    } catch (error) {
      if (error.status === 401) return null;
      throw error;
    }
  }

  /**
   * Sayfa yüklenirken oturum kontrolü yapar.
   * options.admin true ise admin yetkisi de aranır.
   */
  async function guard(options = {}) {
    const user = await currentUser(true).catch(() => null);
    if (!user) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.replace('/index.html?next=' + next);
      return null;
    }
    if (options.admin && user.role !== 'admin') {
      window.location.replace('/dashboard.html');
      return null;
    }
    return user;
  }

  async function logout() {
    try {
      await post('/api/auth/logout');
    } catch (_) {
      /* yoksay */
    }
    cachedUser = null;
    window.location.replace('/index.html');
  }

  /* --------------------------- Biçimleme ------------------------- */

  function escapeHtml(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDuration(totalSeconds) {
    const seconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60);
      return `${hours} sa ${minutes % 60} dk`;
    }
    if (minutes > 0) return `${minutes} dk ${rest} sn`;
    return `${rest} sn`;
  }

  function formatDate(value, withTime) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    const options = { day: '2-digit', month: '2-digit', year: 'numeric' };
    if (withTime) {
      options.hour = '2-digit';
      options.minute = '2-digit';
    }
    return date.toLocaleString('tr-TR', options);
  }

  function initials(name) {
    const parts = String(name || '?').trim().split(/\s+/).slice(0, 2);
    return parts.map((p) => p.charAt(0).toUpperCase()).join('') || '?';
  }

  function statusBadge(percent, completed, hasVideos) {
    if (!hasVideos) return '<span class="badge empty">Video yok</span>';
    if (completed) return '<span class="badge done">✓ Tamamlandı</span>';
    if (percent > 0) return `<span class="badge progress">%${percent} izlendi</span>`;
    return '<span class="badge empty">Başlanmadı</span>';
  }

  /* --------------------------- Bildirim -------------------------- */

  function ensureToastArea() {
    let area = document.querySelector('.toast-area');
    if (!area) {
      area = document.createElement('div');
      area.className = 'toast-area';
      document.body.appendChild(area);
    }
    return area;
  }

  function toast(message, type) {
    const area = ensureToastArea();
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.textContent = message;
    area.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.25s ease';
      setTimeout(() => el.remove(), 260);
    }, 3200);
  }

  function qs(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  /* --------------------------- Üst bar --------------------------- */

  /**
   * Sayfa başına ortak üst bar.
   * active: 'dashboard' | 'progress' | 'admin' | ''
   */
  function renderTopbar(user, active) {
    const el = document.querySelector('[data-topbar]');
    if (!el) return;

    const isAdmin = user.role === 'admin';
    const link = (href, key, label) =>
      `<a href="${href}" class="${active === key ? 'active' : ''}">${label}</a>`;

    el.innerHTML = `
      <div class="container topbar-inner">
        <a class="brand" href="/dashboard.html">
          <span class="brand-logo">👶</span>
          <span class="brand-text">Yeni Doğan Bakım Akademisi<span>Anne eğitim platformu</span></span>
        </a>
        <nav class="nav">
          ${link('/dashboard.html', 'dashboard', 'Eğitimler')}
          ${link('/progress.html', 'progress', 'İlerlemem')}
          ${isAdmin ? link('/admin.html', 'admin', 'Yönetim Paneli') : ''}
          <span class="nav-user">
            <span class="avatar">${escapeHtml(initials(user.fullName || user.username))}</span>
            <span class="user-meta">
              <strong>${escapeHtml(user.fullName || user.username)}</strong>
              ${isAdmin ? 'Yönetici' : 'Anne'}
            </span>
            <button class="btn light small" type="button" data-logout>Çıkış</button>
          </span>
        </nav>
      </div>
    `;

    const logoutBtn = el.querySelector('[data-logout]');
    if (logoutBtn) logoutBtn.addEventListener('click', () => logout());
  }

  function renderFooter() {
    const el = document.querySelector('[data-footer]');
    if (!el) return;
    el.innerHTML = `
      <div class="container footer-inner">
        <span>© ${new Date().getFullYear()} Yeni Doğan Bakım Akademisi — Anne eğitim platformu</span>
        <span class="muted">Bu platform tıbbi tavsiye yerine geçmez.</span>
      </div>
    `;
  }

  return {
    get,
    post,
    patch,
    del,
    currentUser,
    guard,
    logout,
    escapeHtml,
    formatDuration,
    formatDate,
    initials,
    statusBadge,
    toast,
    renderTopbar,
    renderFooter,
    qs,
  };
})();

