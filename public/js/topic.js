/* Konu detay sayfası */
(function () {
  const alertEl = document.getElementById('page-alert');
  const iconEl = document.getElementById('topic-icon');
  const titleEl = document.getElementById('topic-title');
  const descEl = document.getElementById('topic-description');
  const statusText = document.getElementById('topic-status-text');
  const percentText = document.getElementById('topic-percent-text');
  const barEl = document.getElementById('topic-bar');
  const startBtn = document.getElementById('start-btn');
  const nextBtn = document.getElementById('next-btn');
  const listEl = document.getElementById('video-list');
  const countBadge = document.getElementById('video-count-badge');
  const missingEl = document.getElementById('topic-missing');

  function showError(message) {
    alertEl.textContent = message;
    alertEl.classList.remove('hidden');
  }

  function showMissing() {
    missingEl.hidden = false;
    document.querySelectorAll('main .card, main .page-head').forEach((el) => {
      el.hidden = true;
    });
  }

  function videoItem(video, index) {
    const percent = Math.max(0, Math.min(100, video.percent || 0));
    const classes = ['playlist-item'];
    if (video.completed) classes.push('done');

    return `
      <a class="${classes.join(' ')}" href="/watch.html?id=${encodeURIComponent(video.id)}">
        <span class="pip-index">${video.completed ? '✓' : index + 1}</span>
        <span class="pip-body">
          <span class="pip-title">${App.escapeHtml(video.title)}</span>
          <span class="pip-meta">
            ${App.formatDuration(video.duration)}
            ${video.watchedSeconds ? ` · ${App.formatDuration(video.watchedSeconds)} izlendi` : ''}
            · %${percent}
          </span>
          <span class="mini-progress"><span style="width: ${percent}%"></span></span>
        </span>
      </a>
    `;
  }

  async function init() {
    const user = await App.guard();
    if (!user) return;

    App.renderTopbar(user, 'dashboard');
    App.renderFooter();

    const topicId = App.qs('id');
    if (!topicId) {
      showMissing();
      return;
    }

    try {
      const [data, summary] = await Promise.all([
        App.get(`/api/topics/${encodeURIComponent(topicId)}`),
        App.get('/api/me/summary').catch(() => null),
      ]);

      const { topic, videos, status } = data;
      document.title = `${topic.title} — Yeni Doğan Bakım Akademisi`;
      iconEl.textContent = topic.icon || '📘';
      titleEl.textContent = topic.title;
      descEl.textContent = topic.description || '';

      const percent = Math.max(0, Math.min(100, status.percent || 0));
      barEl.style.width = `${percent}%`;
      percentText.textContent = `%${percent}`;
      statusText.textContent = `${status.completedVideos} / ${status.videoCount} video tamamlandı`;
      countBadge.textContent = `${videos.length} video`;

      if (videos.length) {
        listEl.innerHTML = videos.map(videoItem).join('');
        const firstUnfinished = videos.find((v) => !v.completed) || videos[0];
        startBtn.href = `/watch.html?id=${encodeURIComponent(firstUnfinished.id)}`;
        startBtn.textContent =
          status.started && !status.completed ? 'Kaldığım yerden devam et' : 'İlk videoyu izle';
        startBtn.hidden = false;
      } else {
        listEl.innerHTML = `
          <div class="empty-state">
            <span class="emoji">🎬</span>
            Bu konuya henüz video eklenmemiş. Daha sonra tekrar kontrol edin.
          </div>
        `;
      }

      if (summary && Array.isArray(summary.topics)) {
        const index = summary.topics.findIndex((t) => t.id === topic.id);
        const next = index >= 0 ? summary.topics[index + 1] : null;
        if (next) {
          nextBtn.href = `/topic.html?id=${encodeURIComponent(next.id)}`;
          nextBtn.hidden = false;
        }
      }
    } catch (error) {
      if (error.status === 404) {
        missingEl.hidden = false;
        titleEl.textContent = 'Konu bulunamadı';
        descEl.textContent = '';
        listEl.innerHTML = '';
        return;
      }
      showError(error.message);
      listEl.innerHTML = '<div class="empty-state"><span class="emoji">⚠️</span>Videolar yüklenemedi.</div>';
    }
  }

  init();
})();
