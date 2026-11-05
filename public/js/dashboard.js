/* Ana sayfa: eğitim konuları ve genel ilerleme */
(function () {
  const gridEl = document.getElementById('topic-grid');
  const alertEl = document.getElementById('page-alert');
  const heroEl = document.getElementById('hero');
  const heroTitle = document.getElementById('hero-title');
  const heroText = document.getElementById('hero-text');
  const heroCta = document.getElementById('hero-cta');
  const heroStats = document.getElementById('hero-stats');
  const overallBar = document.getElementById('overall-bar');
  const overallPercent = document.getElementById('overall-percent');

  function showError(message) {
    alertEl.textContent = message;
    alertEl.classList.remove('hidden');
  }

  function topicCard(topic) {
    const hasVideos = topic.videoCount > 0;
    const percent = Math.max(0, Math.min(100, topic.percent || 0));
    const classes = ['topic-card'];
    if (topic.completed) classes.push('is-done');
    const footLabel = hasVideos
      ? `${topic.videoCount} eğitim videosu`
      : 'Video henüz eklenmedi';

    return `
      <a class="${classes.join(' ')}" href="/topic.html?id=${encodeURIComponent(topic.id)}">
        <div class="topic-card-top">
          <span class="topic-icon">${App.escapeHtml(topic.icon || '📘')}</span>
          <div style="min-width: 0">
            <h3>${App.escapeHtml(topic.title)}</h3>
            <p class="topic-desc">${App.escapeHtml(topic.description || '')}</p>
          </div>
        </div>
        <div class="progress-line">
          <span>${topic.completedVideos} / ${topic.videoCount} video</span>
          <span>%${percent}</span>
        </div>
        <div class="progress ${topic.completed ? 'accent' : ''}">
          <span style="width: ${percent}%"></span>
        </div>
        <div class="topic-card-foot">
          <span>${footLabel}</span>
          ${App.statusBadge(percent, topic.completed, hasVideos)}
        </div>
      </a>
    `;
  }

  function renderHero(data, user) {
    const stats = data.stats || {};
    heroEl.hidden = false;
    heroTitle.textContent = `${user.fullName || user.username}, hazır mısınız?`;

    heroText.textContent =
      stats.completedVideos > 0
        ? `${stats.completedVideos} videoyu tamamladınız. Kaldığınız konudan devam edebilirsiniz.`
        : 'Konuları sırayla izleyebilir, dilediğiniz zaman kaldığınız yerden devam edebilirsiniz.';

    const topics = data.topics || [];
    const nextTopic = topics.find((t) => !t.completed && t.videoCount > 0) || topics[0];
    if (nextTopic) {
      heroCta.href = `/topic.html?id=${encodeURIComponent(nextTopic.id)}`;
      heroCta.textContent =
        nextTopic.started && !nextTopic.completed ? 'Kaldığım yerden devam et' : 'İlk konuya başla';
    }

    heroStats.innerHTML = `
      <div class="stat-box">
        <strong>${stats.completedTopics || 0}/${stats.totalTopics || 0}</strong>
        <span>Tamamlanan konu</span>
      </div>
      <div class="stat-box">
        <strong>${stats.completedVideos || 0}/${stats.totalVideos || 0}</strong>
        <span>İzlenen video</span>
      </div>
      <div class="stat-box">
        <strong>%${stats.percent || 0}</strong>
        <span>Genel ilerleme</span>
      </div>
    `;
  }

  function renderTopics(topics) {
    if (!topics.length) {
      gridEl.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1">
          <span class="emoji">📚</span>
          Henüz eğitim konusu eklenmemiş. Lütfen daha sonra tekrar kontrol edin.
        </div>
      `;
      return;
    }
    gridEl.innerHTML = topics.map(topicCard).join('');
  }

  function setupPasswordForm() {
    const section = document.getElementById('password-section');
    const form = document.getElementById('password-form');
    const alertBox = document.getElementById('password-alert');
    const submit = document.getElementById('password-submit');
    if (!section || !form) return;

    section.hidden = false;

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      alertBox.className = 'alert hidden';
      alertBox.textContent = '';

      const currentPassword = document.getElementById('current-password').value;
      const newPassword = document.getElementById('new-password').value;
      const repeatPassword = document.getElementById('repeat-password').value;

      const fail = (message) => {
        alertBox.className = 'alert error';
        alertBox.textContent = message;
      };

      if (newPassword.length < 6) return fail('Yeni şifre en az 6 karakter olmalıdır.');
      if (newPassword !== repeatPassword) return fail('Yeni şifreler birbiriyle uyuşmuyor.');
      if (newPassword === currentPassword) return fail('Yeni şifre mevcut şifre ile aynı olamaz.');

      submit.disabled = true;
      submit.textContent = 'Güncelleniyor…';
      try {
        await App.post('/api/auth/password', { currentPassword, newPassword });
        alertBox.className = 'alert success';
        alertBox.textContent = 'Şifreniz güncellendi.';
        form.reset();
        App.toast('Şifreniz güncellendi.', 'success');
      } catch (error) {
        fail(error.message);
      } finally {
        submit.disabled = false;
        submit.textContent = 'Şifreyi güncelle';
      }
    });
  }

  async function init() {
    const user = await App.guard();
    if (!user) return;

    App.renderTopbar(user, 'dashboard');
    App.renderFooter();

    try {
      const data = await App.get('/api/me/summary');
      const stats = data.stats || {};
      renderHero(data, data.user || user);
      renderTopics(data.topics || []);
      overallPercent.textContent = stats.percent || 0;
      overallBar.style.width = `${stats.percent || 0}%`;
      setupPasswordForm();
    } catch (error) {
      showError(error.message);
      gridEl.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1">
          <span class="emoji">⚠️</span>
          Konular yüklenemedi.
        </div>
      `;
    }
  }

  init();
})();
