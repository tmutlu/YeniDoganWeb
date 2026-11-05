/* İlerleme sayfası */
(function () {
  const bodyEl = document.getElementById('progress-body');
  const statCards = document.getElementById('stat-cards');
  const alertEl = document.getElementById('page-alert');
  const thresholdText = document.getElementById('threshold-text');
  const certificateCard = document.getElementById('certificate-card');

  function showError(message) {
    alertEl.textContent = message;
    alertEl.classList.remove('hidden');
  }

  function renderStats(stats) {
    statCards.innerHTML = `
      <div class="stat-card">
        <span>Genel ilerleme</span>
        <strong>%${stats.percent || 0}</strong>
      </div>
      <div class="stat-card">
        <span>Tamamlanan konu</span>
        <strong>${stats.completedTopics || 0} / ${stats.totalTopics || 0}</strong>
      </div>
      <div class="stat-card">
        <span>İzlenen video</span>
        <strong>${stats.completedVideos || 0} / ${stats.totalVideos || 0}</strong>
      </div>
      <div class="stat-card">
        <span>Kalan video</span>
        <strong>${Math.max(0, (stats.totalVideos || 0) - (stats.completedVideos || 0))}</strong>
      </div>
    `;
  }

  function renderRows(topics) {
    if (!topics.length) {
      bodyEl.innerHTML = '<tr><td colspan="5" class="muted">Henüz konu bulunmuyor.</td></tr>';
      return;
    }

    bodyEl.innerHTML = topics
      .map((topic) => {
        const percent = Math.max(0, Math.min(100, topic.percent || 0));
        const hasVideos = topic.videoCount > 0;
        return `
          <tr>
            <td>
              <strong>${App.escapeHtml(topic.icon || '📘')} ${App.escapeHtml(topic.title)}</strong>
            </td>
            <td class="muted">${topic.completedVideos} / ${topic.videoCount}</td>
            <td>
              <div class="report-cell">
                <div class="progress ${topic.completed ? 'accent' : ''}">
                  <span style="width: ${percent}%"></span>
                </div>
                <span class="small muted">%${percent}</span>
              </div>
            </td>
            <td>${App.statusBadge(percent, topic.completed, hasVideos)}</td>
            <td>
              <a class="btn light small" href="/topic.html?id=${encodeURIComponent(topic.id)}">
                ${hasVideos ? 'İzle' : 'Detay'}
              </a>
            </td>
          </tr>
        `;
      })
      .join('');
  }

  async function init() {
    const user = await App.guard();
    if (!user) return;

    App.renderTopbar(user, 'progress');
    App.renderFooter();

    try {
      const data = await App.get('/api/me/summary');
      const stats = data.stats || {};
      thresholdText.textContent = (data.settings && data.settings.completionPercent) || 90;
      renderStats(stats);
      renderRows(data.topics || []);
      if (stats.totalVideos > 0 && stats.completedVideos === stats.totalVideos) {
        certificateCard.hidden = false;
      }
    } catch (error) {
      showError(error.message);
      bodyEl.innerHTML = '<tr><td colspan="5" class="muted">Veriler yüklenemedi.</td></tr>';
    }
  }

  init();
})();
