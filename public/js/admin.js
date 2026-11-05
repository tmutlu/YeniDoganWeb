/* Yönetim paneli */
(function () {
  const alertEl = document.getElementById('page-alert');
  const tabsEl = document.getElementById('admin-tabs');
  const panels = Array.from(document.querySelectorAll('[data-panel]'));

  const state = {
    user: null,
    users: [],
    topics: [],
    videos: [],
    report: null,
  };

  function showError(message) {
    alertEl.className = 'alert error';
    alertEl.textContent = message;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function showSuccess(message) {
    alertEl.className = 'alert success';
    alertEl.textContent = message;
    setTimeout(() => {
      if (alertEl.textContent === message) alertEl.className = 'alert hidden';
    }, 4000);
  }

  function clearAlert() {
    alertEl.className = 'alert hidden';
    alertEl.textContent = '';
  }

  function fail(error) {
    showError(error.message || 'İşlem tamamlanamadı.');
  }

  /* ------------------------------ Sekmeler ------------------------ */

  function activateTab(name) {
    const target = panels.some((p) => p.dataset.panel === name) ? name : 'overview';
    panels.forEach((panel) => {
      panel.hidden = panel.dataset.panel !== target;
    });
    Array.from(tabsEl.querySelectorAll('.admin-tab')).forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === target);
    });
    if (window.location.hash !== '#' + target) {
      window.history.replaceState(null, '', '#' + target);
    }
    if (target === 'report') loadReport();
    if (target === 'videos') loadVideos();
    if (target === 'topics') loadTopics();
    if (target === 'users') loadUsers();
  }

  tabsEl.addEventListener('click', (event) => {
    const btn = event.target.closest('.admin-tab');
    if (!btn) return;
    clearAlert();
    activateTab(btn.dataset.tab);
  });

  /* --------------------------- Genel bakış ------------------------ */

  function renderOverview() {
    const statCards = document.getElementById('overview-stats');
    const totalVideos = state.videos.length;
    const adminCount = state.users.filter((u) => u.role === 'admin').length;
    const activeCount = state.users.filter((u) => u.active !== false).length;
    const overall = state.users.length
      ? Math.round(
          state.users.reduce((sum, u) => sum + ((u.stats && u.stats.percent) || 0), 0) /
            state.users.length
        )
      : 0;

    statCards.innerHTML = `
      <div class="stat-card">
        <span>Kullanıcı</span>
        <strong>${state.users.length}</strong>
      </div>
      <div class="stat-card">
        <span>Aktif kullanıcı</span>
        <strong>${activeCount}</strong>
      </div>
      <div class="stat-card">
        <span>Yönetici</span>
        <strong>${adminCount}</strong>
      </div>
      <div class="stat-card">
        <span>Konu</span>
        <strong>${state.topics.length}</strong>
      </div>
      <div class="stat-card">
        <span>Video</span>
        <strong>${totalVideos}</strong>
      </div>
      <div class="stat-card">
        <span>Ortalama ilerleme</span>
        <strong>%${overall}</strong>
      </div>
    `;
  }

  async function loadOverview() {
    const [usersData, topicsData, videosData, meData] = await Promise.all([
      App.get('/api/admin/users'),
      App.get('/api/admin/topics'),
      App.get('/api/admin/videos'),
      App.get('/api/auth/me').catch(() => null),
    ]);
    state.users = usersData.users || [];
    state.topics = topicsData.topics || [];
    state.videos = videosData.videos || [];

    const settings = (meData && meData.settings) || {};
    document.getElementById('setting-title').value = settings.siteTitle || '';
    document.getElementById('setting-threshold').value = settings.completionPercent || 90;

    renderOverview();
  }

  document.getElementById('settings-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const siteTitle = document.getElementById('setting-title').value.trim();
    const completionPercent = Number(document.getElementById('setting-threshold').value);
    try {
      await App.patch('/api/admin/settings', { siteTitle, completionPercent });
      showSuccess('Ayarlar kaydedildi.');
    } catch (error) {
      fail(error);
    }
  });

  /* --------------------------- Kullanıcılar ----------------------- */

  const userForm = document.getElementById('user-form');
  const usersBody = document.getElementById('users-body');
  const userCancel = document.getElementById('user-cancel');
  const userSubmit = document.getElementById('user-submit');
  const userSearch = document.getElementById('user-search');

  function resetUserForm() {
    userForm.reset();
    document.getElementById('user-id').value = '';
    document.getElementById('user-username').disabled = false;
    document.getElementById('user-password').required = true;
    document.getElementById('user-password-hint').textContent = 'En az 6 karakter.';
    document.getElementById('user-form-title').textContent = 'Yeni kullanıcı ekle';
    userSubmit.textContent = 'Kullanıcı ekle';
    userCancel.hidden = true;
  }

  function startUserEdit(user) {
    document.getElementById('user-id').value = user.id;
    document.getElementById('user-username').value = user.username;
    document.getElementById('user-username').disabled = true;
    document.getElementById('user-fullname').value = user.fullName || '';
    document.getElementById('user-password').value = '';
    document.getElementById('user-password').required = false;
    document.getElementById('user-password-hint').textContent =
      'Boş bırakırsanız mevcut şifre korunur.';
    document.getElementById('user-role').value = user.role === 'admin' ? 'admin' : 'user';
    document.getElementById('user-form-title').textContent = `Düzenle: ${user.username}`;
    userSubmit.textContent = 'Değişiklikleri kaydet';
    userCancel.hidden = false;
    document.getElementById('user-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function renderUsers() {
    const term = (userSearch.value || '').trim().toLowerCase();
    const list = state.users.filter((user) => {
      if (!term) return true;
      return (
        String(user.username).toLowerCase().includes(term) ||
        String(user.fullName || '').toLowerCase().includes(term)
      );
    });

    if (!list.length) {
      usersBody.innerHTML = '<tr><td colspan="5" class="muted">Kayıt bulunamadı.</td></tr>';
      return;
    }

    usersBody.innerHTML = list
      .map((user) => {
        const stats = user.stats || {};
        const percent = Math.max(0, Math.min(100, stats.percent || 0));
        const roleBadge =
          user.role === 'admin'
            ? '<span class="badge admin">Yönetici</span>'
            : '<span class="badge">Anne</span>';
        const activeBadge =
          user.active === false
            ? '<span class="badge empty">Pasif</span>'
            : '<span class="badge done">Aktif</span>';
        const isSelf = state.user && state.user.id === user.id;

        return `
          <tr>
            <td>
              <strong>${App.escapeHtml(user.fullName || user.username)}</strong>
              <div class="small muted">${App.escapeHtml(user.username)}</div>
            </td>
            <td>${roleBadge}</td>
            <td>${activeBadge}</td>
            <td>
              <div class="report-cell">
                <div class="progress ${percent === 100 ? 'accent' : ''}">
                  <span style="width: ${percent}%"></span>
                </div>
                <span class="small muted">%${percent}</span>
              </div>
              <div class="small muted">
                ${stats.completedVideos || 0}/${stats.totalVideos || 0} video
              </div>
            </td>
            <td>
              <div class="row-actions">
                <button class="btn light small" type="button" data-action="edit" data-id="${user.id}">Düzenle</button>
                <button class="btn light small" type="button" data-action="toggle" data-id="${user.id}" ${
                  isSelf ? 'disabled title="Kendi hesabınızı pasif yapamazsınız"' : ''
                }>${user.active === false ? 'Aktifleştir' : 'Pasifleştir'}</button>
                <button class="btn light small" type="button" data-action="reset" data-id="${user.id}">İlerlemeyi sıfırla</button>
                <button class="btn danger small" type="button" data-action="delete" data-id="${user.id}" ${
                  isSelf ? 'disabled title="Kendi hesabınızı silemezsiniz"' : ''
                }>Sil</button>
              </div>
            </td>
          </tr>
        `;
      })
      .join('');
  }

  async function loadUsers() {
    const data = await App.get('/api/admin/users');
    state.users = data.users || [];
    renderUsers();
    renderOverview();
  }

  userForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearAlert();

    const id = document.getElementById('user-id').value;
    const username = document.getElementById('user-username').value.trim();
    const fullName = document.getElementById('user-fullname').value.trim();
    const password = document.getElementById('user-password').value;
    const role = document.getElementById('user-role').value;

    userSubmit.disabled = true;
    try {
      if (id) {
        const payload = { fullName, role };
        if (password) payload.password = password;
        await App.patch(`/api/admin/users/${encodeURIComponent(id)}`, payload);
        showSuccess('Kullanıcı güncellendi.');
      } else {
        if (password.length < 6) throw new Error('Şifre en az 6 karakter olmalıdır.');
        await App.post('/api/admin/users', { username, fullName, password, role });
        showSuccess('Kullanıcı eklendi.');
      }
      resetUserForm();
      await loadUsers();
    } catch (error) {
      fail(error);
    } finally {
      userSubmit.disabled = false;
    }
  });

  userCancel.addEventListener('click', () => {
    resetUserForm();
    clearAlert();
  });

  userSearch.addEventListener('input', () => renderUsers());

  usersBody.addEventListener('click', async (event) => {
    const btn = event.target.closest('button[data-action]');
    if (!btn) return;
    const user = state.users.find((u) => u.id === btn.dataset.id);
    if (!user) return;

    clearAlert();
    btn.disabled = true;
    try {
      if (btn.dataset.action === 'edit') {
        startUserEdit(user);
        return;
      }
      if (btn.dataset.action === 'toggle') {
        await App.patch(`/api/admin/users/${encodeURIComponent(user.id)}`, {
          active: user.active === false,
        });
        showSuccess(`${user.username} ${user.active === false ? 'aktifleştirildi' : 'pasifleştirildi'}.`);
      }
      if (btn.dataset.action === 'reset') {
        if (!window.confirm(`${user.username} kullanıcısının tüm ilerlemesi sıfırlanacak. Onaylıyor musunuz?`)) {
          return;
        }
        await App.post(`/api/admin/users/${encodeURIComponent(user.id)}/reset-progress`);
        showSuccess('İlerleme sıfırlandı.');
      }
      if (btn.dataset.action === 'delete') {
        if (!window.confirm(`${user.username} kullanıcısı silinecek. Bu işlem geri alınamaz.`)) {
          return;
        }
        await App.del(`/api/admin/users/${encodeURIComponent(user.id)}`);
        showSuccess('Kullanıcı silindi.');
        if (document.getElementById('user-id').value === user.id) resetUserForm();
      }
      await loadUsers();
    } catch (error) {
      fail(error);
    } finally {
      btn.disabled = false;
    }
  });

  /* ----------------------------- Konular -------------------------- */

  const topicForm = document.getElementById('topic-form');
  const topicsBody = document.getElementById('topics-body');
  const topicCancel = document.getElementById('topic-cancel');
  const topicSubmit = document.getElementById('topic-submit');

  function resetTopicForm() {
    topicForm.reset();
    document.getElementById('topic-id').value = '';
    document.getElementById('topic-form-title').textContent = 'Yeni konu ekle';
    topicSubmit.textContent = 'Konu ekle';
    topicCancel.hidden = true;
  }

  function startTopicEdit(topic) {
    document.getElementById('topic-id').value = topic.id;
    document.getElementById('topic-title').value = topic.title;
    document.getElementById('topic-description').value = topic.description || '';
    document.getElementById('topic-icon').value = topic.icon || '';
    document.getElementById('topic-order').value = topic.order || '';
    document.getElementById('topic-form-title').textContent = `Düzenle: ${topic.title}`;
    topicSubmit.textContent = 'Değişiklikleri kaydet';
    topicCancel.hidden = false;
    topicForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function renderTopics() {
    document.getElementById('topic-total').textContent = `${state.topics.length} konu`;
    if (!state.topics.length) {
      topicsBody.innerHTML = '<tr><td colspan="4" class="muted">Henüz konu yok.</td></tr>';
      return;
    }
    topicsBody.innerHTML = state.topics
      .map(
        (topic) => `
        <tr>
          <td class="muted">${topic.order || '-'}</td>
          <td>
            <strong>${App.escapeHtml(topic.icon || '📘')} ${App.escapeHtml(topic.title)}</strong>
            <div class="small muted">${App.escapeHtml(topic.description || '')}</div>
          </td>
          <td>${topic.videoCount || 0}</td>
          <td>
            <div class="row-actions">
              <a class="btn light small" href="/topic.html?id=${encodeURIComponent(topic.id)}" target="_blank" rel="noopener">Görüntüle</a>
              <button class="btn light small" type="button" data-action="edit" data-id="${topic.id}">Düzenle</button>
              <button class="btn danger small" type="button" data-action="delete" data-id="${topic.id}">Sil</button>
            </div>
          </td>
        </tr>
      `
      )
      .join('');
  }

  async function loadTopics() {
    const data = await App.get('/api/admin/topics');
    state.topics = data.topics || [];
    renderTopics();
    fillTopicSelect();
    renderOverview();
  }

  topicForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearAlert();
    const id = document.getElementById('topic-id').value;
    const title = document.getElementById('topic-title').value.trim();
    const description = document.getElementById('topic-description').value.trim();
    const icon = document.getElementById('topic-icon').value.trim();
    const order = Number(document.getElementById('topic-order').value) || undefined;

    if (!title) return showError('Konu başlığı zorunludur.');

    topicSubmit.disabled = true;
    try {
      if (id) {
        await App.patch(`/api/admin/topics/${encodeURIComponent(id)}`, {
          title,
          description,
          icon,
          order,
        });
        showSuccess('Konu güncellendi.');
      } else {
        await App.post('/api/admin/topics', { title, description, icon, order });
        showSuccess('Konu eklendi.');
      }
      resetTopicForm();
      await loadTopics();
    } catch (error) {
      fail(error);
    } finally {
      topicSubmit.disabled = false;
    }
  });

  topicCancel.addEventListener('click', () => {
    resetTopicForm();
    clearAlert();
  });

  topicsBody.addEventListener('click', async (event) => {
    const btn = event.target.closest('button[data-action]');
    if (!btn) return;
    const topic = state.topics.find((t) => t.id === btn.dataset.id);
    if (!topic) return;
    clearAlert();

    if (btn.dataset.action === 'edit') {
      startTopicEdit(topic);
      return;
    }
    if (btn.dataset.action === 'delete') {
      if (
        !window.confirm(
          `"${topic.title}" konusu ve bağlı ${topic.videoCount || 0} video silinecek. Onaylıyor musunuz?`
        )
      ) {
        return;
      }
      btn.disabled = true;
      try {
        await App.del(`/api/admin/topics/${encodeURIComponent(topic.id)}`);
        showSuccess('Konu silindi.');
        if (document.getElementById('topic-id').value === topic.id) resetTopicForm();
        await loadTopics();
        await loadVideos();
      } catch (error) {
        fail(error);
      } finally {
        btn.disabled = false;
      }
    }
  });

  /* ----------------------------- Videolar -------------------------- */

  const videoForm = document.getElementById('video-form');
  const videosBody = document.getElementById('videos-body');
  const videoCancel = document.getElementById('video-cancel');
  const videoSubmit = document.getElementById('video-submit');
  const videoTopicSelect = document.getElementById('video-topic');

  function fillTopicSelect() {
    const current = videoTopicSelect.value;
    videoTopicSelect.innerHTML = state.topics
      .map(
        (topic) =>
          `<option value="${topic.id}">${App.escapeHtml(topic.icon || '📘')} ${App.escapeHtml(
            topic.title
          )}</option>`
      )
      .join('');
    if (current && state.topics.some((t) => t.id === current)) {
      videoTopicSelect.value = current;
    }
  }

  function resetVideoForm() {
    videoForm.reset();
    document.getElementById('video-id').value = '';
    document.getElementById('video-duration').value = 300;
    fillTopicSelect();
    document.getElementById('video-form-title').textContent = 'Yeni video ekle';
    videoSubmit.textContent = 'Video ekle';
    videoCancel.hidden = true;
  }

  function startVideoEdit(video) {
    document.getElementById('video-id').value = video.id;
    videoTopicSelect.value = video.topicId;
    document.getElementById('video-title').value = video.title;
    document.getElementById('video-url').value = video.url;
    document.getElementById('video-description').value = video.description || '';
    document.getElementById('video-duration').value = video.duration || 300;
    document.getElementById('video-order').value = video.order || '';
    document.getElementById('video-form-title').textContent = `Düzenle: ${video.title}`;
    videoSubmit.textContent = 'Değişiklikleri kaydet';
    videoCancel.hidden = false;
    videoForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function renderVideos() {
    document.getElementById('video-total').textContent = `${state.videos.length} video`;
    if (!state.videos.length) {
      videosBody.innerHTML =
        '<tr><td colspan="5" class="muted">Henüz video yok. Soldaki formdan ekleyebilirsiniz.</td></tr>';
      return;
    }

    const sorted = [...state.videos].sort((a, b) => {
      if (a.topicTitle !== b.topicTitle) {
        return String(a.topicTitle).localeCompare(String(b.topicTitle), 'tr');
      }
      return (a.order || 0) - (b.order || 0);
    });

    videosBody.innerHTML = sorted
      .map(
        (video) => `
        <tr>
          <td>
            <strong>${App.escapeHtml(video.title)}</strong>
            <div class="small muted">${App.escapeHtml(video.description || '')}</div>
            <a class="small" href="${App.escapeHtml(video.url)}" target="_blank" rel="noopener">Bağlantıyı aç</a>
          </td>
          <td class="small">${App.escapeHtml(video.topicTitle || '-')}</td>
          <td><span class="badge">${App.escapeHtml(video.provider)}</span></td>
          <td class="small">${App.formatDuration(video.duration)}</td>
          <td>
            <div class="row-actions">
              <a class="btn light small" href="/watch.html?id=${encodeURIComponent(video.id)}" target="_blank" rel="noopener">İzle</a>
              <button class="btn light small" type="button" data-action="edit" data-id="${video.id}">Düzenle</button>
              <button class="btn danger small" type="button" data-action="delete" data-id="${video.id}">Sil</button>
            </div>
          </td>
        </tr>
      `
      )
      .join('');
  }

  async function loadVideos() {
    const [videosData, topicsData] = await Promise.all([
      App.get('/api/admin/videos'),
      App.get('/api/admin/topics'),
    ]);
    state.videos = videosData.videos || [];
    state.topics = topicsData.topics || [];
    fillTopicSelect();
    renderTopics();
    renderVideos();
    renderOverview();
  }




  videoForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearAlert();

    const id = document.getElementById('video-id').value;
    const topicId = videoTopicSelect.value;
    const title = document.getElementById('video-title').value.trim();
    const url = document.getElementById('video-url').value.trim();
    const description = document.getElementById('video-description').value.trim();
    const duration = Number(document.getElementById('video-duration').value) || 300;
    const order = Number(document.getElementById('video-order').value) || undefined;

    if (!topicId) return showError('Önce bir konu seçin (Konular sekmesinden ekleyebilirsiniz).');
    if (!title) return showError('Video başlığı zorunludur.');
    if (!/^https?:\/\//i.test(url)) return showError('Video bağlantısı http(s) ile başlamalıdır.');

    videoSubmit.disabled = true;
    try {
      if (id) {
        await App.patch(`/api/admin/videos/${encodeURIComponent(id)}`, {
          topicId,
          title,
          url,
          description,
          duration,
          order,
        });
        showSuccess('Video güncellendi.');
      } else {
        await App.post('/api/admin/videos', {
          topicId,
          title,
          url,
          description,
          duration,
          order,
        });
        showSuccess('Video eklendi.');
      }
      resetVideoForm();
      await loadVideos();
    } catch (error) {
      fail(error);
    } finally {
      videoSubmit.disabled = false;
    }
  });

  videoCancel.addEventListener('click', () => {
    resetVideoForm();
    clearAlert();
  });

  videosBody.addEventListener('click', async (event) => {
    const btn = event.target.closest('button[data-action]');
    if (!btn) return;
    const video = state.videos.find((v) => v.id === btn.dataset.id);
    if (!video) return;
    clearAlert();

    if (btn.dataset.action === 'edit') {
      startVideoEdit(video);
      return;
    }
    if (btn.dataset.action === 'delete') {
      if (!window.confirm(`"${video.title}" videosu silinecek. Onaylıyor musunuz?`)) return;
      btn.disabled = true;
      try {
        await App.del(`/api/admin/videos/${encodeURIComponent(video.id)}`);
        showSuccess('Video silindi.');
        if (document.getElementById('video-id').value === video.id) resetVideoForm();
        await loadVideos();
      } catch (error) {
        fail(error);
      } finally {
        btn.disabled = false;
      }
    }
  });


  /* ------------------------------ Rapor --------------------------- */

  const reportHead = document.getElementById('report-head');
  const reportBody = document.getElementById('report-body');

  function renderReport(data) {
    state.report = data;
    const topics = data.topics || [];
    const users = data.users || [];

    reportHead.innerHTML = `
      <tr>
        <th>Kullanıcı</th>
        <th>Genel</th>
        <th>Son aktivite</th>
        ${topics.map((topic) => `<th>${App.escapeHtml(topic.title)}</th>`).join('')}
      </tr>
    `;

    if (!users.length) {
      reportBody.innerHTML = `<tr><td colspan="${topics.length + 3}" class="muted">Kullanıcı bulunamadı.</td></tr>`;
      return;
    }

    reportBody.innerHTML = users
      .map((user) => {
        const stats = user.stats || {};
        const overall = Math.max(0, Math.min(100, stats.percent || 0));
        return `
          <tr>
            <td>
              <strong>${App.escapeHtml(user.fullName || user.username)}</strong>
              <div class="small muted">${App.escapeHtml(user.username)}</div>
            </td>
            <td>
              <div class="report-cell">
                <div class="progress ${overall === 100 ? 'accent' : ''}">
                  <span style="width: ${overall}%"></span>
                </div>
                <span class="small muted">%${overall}</span>
              </div>
            </td>
            <td class="small muted">${user.lastActivity ? App.formatDate(user.lastActivity, true) : '-'}</td>
            ${(user.topics || [])
              .map((topic) => {
                const percent = Math.max(0, Math.min(100, topic.percent || 0));
                return `
                  <td>
                    <div class="report-cell">
                      <div class="progress ${topic.completed ? 'accent' : ''}">
                        <span style="width: ${percent}%"></span>
                      </div>
                      <span class="small muted">%${percent}</span>
                    </div>
                    <div class="small muted">${topic.completedVideos}/${topic.videoCount}</div>
                  </td>
                `;
              })
              .join('')}
          </tr>
        `;
      })
      .join('');
  }

  async function loadReport() {
    try {
      const data = await App.get('/api/admin/report');
      renderReport(data);
    } catch (error) {
      fail(error);
      reportBody.innerHTML = '<tr><td class="muted">Rapor yüklenemedi.</td></tr>';
    }
  }

  function csvCell(value) {
    const text = String(value === undefined || value === null ? '' : value);
    return '"' + text.replace(/"/g, '""') + '"';
  }

  document.getElementById('report-csv').addEventListener('click', () => {
    if (!state.report) {
      showError('Önce raporun yüklenmesini bekleyin.');
      return;
    }
    const topics = state.report.topics || [];
    const header = ['Kullanıcı adı', 'Ad soyad', 'Genel %', 'Tamamlanan video', 'Toplam video']
      .concat(topics.map((topic) => `${topic.title} %`))
      .map(csvCell)
      .join(';');

    const rows = (state.report.users || []).map((user) => {
      const stats = user.stats || {};
      const base = [
        user.username,
        user.fullName || '',
        stats.percent || 0,
        stats.completedVideos || 0,
        stats.totalVideos || 0,
      ];
      const topicCells = (user.topics || []).map((topic) => topic.percent || 0);
      return base.concat(topicCells).map(csvCell).join(';');
    });

    // Excel'in Turkce karakterleri dogru okumasi icin BOM ekleniyor.
    const blob = new Blob(['\ufeff' + [header].concat(rows).join('\r\n')], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ilerleme-raporu-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  });

  document.getElementById('report-refresh').addEventListener('click', () => {
    reportBody.innerHTML = '<tr><td class="muted">Yükleniyor…</td></tr>';
    loadReport();
  });

  /* ------------------------------ Başlat -------------------------- */

  async function init() {
    const user = await App.guard({ admin: true });
    if (!user) return;
    state.user = user;

    App.renderTopbar(user, 'admin');
    App.renderFooter();

    try {
      await loadOverview();
    } catch (error) {
      fail(error);
    }

    const initial = (window.location.hash || '').replace('#', '') || 'overview';
    if (initial !== 'overview') activateTab(initial);
  }

  init();
})();
