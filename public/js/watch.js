/* Video oynatıcı ve izleme takibi */
(function () {
  const alertEl = document.getElementById('page-alert');
  const frameEl = document.getElementById('player-frame');
  const titleEl = document.getElementById('video-title');
  const descEl = document.getElementById('video-description');
  const noteEl = document.getElementById('provider-note');
  const topicLink = document.getElementById('topic-link');
  const trackDot = document.getElementById('track-dot');
  const trackText = document.getElementById('track-text');
  const badgeEl = document.getElementById('video-badge');
  const barEl = document.getElementById('video-bar');
  const progressLabel = document.getElementById('video-progress-label');
  const progressTime = document.getElementById('video-progress-time');
  const prevLink = document.getElementById('prev-link');
  const nextLink = document.getElementById('next-link');
  const completeBtn = document.getElementById('complete-btn');
  const playlistEl = document.getElementById('playlist');
  const playlistTopic = document.getElementById('playlist-topic');
  const thresholdText = document.getElementById('threshold-text');

  const SAVE_INTERVAL_MS = 15000;
  const MAX_DELTA_PER_REQUEST = 300;

  const state = {
    videoId: null,
    data: null,
    duration: 300,
    threshold: 90,
    watched: 0,
    position: 0,
    unsaved: 0,
    completed: false,
    playing: false,
    lastTick: null,
    tickTimer: null,
    saveTimer: null,
    saving: false,
  };

  function showError(message) {
    alertEl.textContent = message;
    alertEl.classList.remove('hidden');
  }

  function setTrackState(active, message) {
    trackDot.classList.toggle('paused', !active);
    trackText.textContent = message;
  }

  function percent() {
    if (!state.duration) return 0;
    return Math.min(100, Math.round(((state.watched + state.unsaved) / state.duration) * 100));
  }

  function renderProgress() {
    const percentValue = state.completed ? 100 : percent();
    barEl.style.width = `${percentValue}%`;
    progressLabel.textContent = `%${percentValue} izlendi`;
    progressTime.textContent = `${App.formatDuration(state.watched + state.unsaved)} / ${App.formatDuration(
      state.duration
    )}`;
    if (state.completed) {
      badgeEl.className = 'badge done';
      badgeEl.textContent = '✓ Tamamlandı';
      completeBtn.hidden = true;
    } else if (percentValue > 0) {
      badgeEl.className = 'badge progress';
      badgeEl.textContent = `%${percentValue} izlendi`;
    } else {
      badgeEl.className = 'badge empty';
      badgeEl.textContent = 'Başlanmadı';
    }
  }

  /* ------------------------- İzleme sayacı ------------------------ */

  function startTicking() {
    if (state.tickTimer) return;
    state.lastTick = Date.now();
    state.tickTimer = setInterval(() => {
      const now = Date.now();
      const elapsed = (now - state.lastTick) / 1000;
      state.lastTick = now;
      if (!state.playing) return;
      state.unsaved += Math.min(elapsed, 2);
      renderProgress();
    }, 1000);
  }

  function stopTicking() {
    if (!state.tickTimer) return;
    clearInterval(state.tickTimer);
    state.tickTimer = null;
    state.lastTick = null;
  }

  function setPlaying(playing, message) {
    state.playing = playing;
    if (playing) {
      startTicking();
      setTrackState(true, message || 'İzleme kaydediliyor…');
    } else {
      setTrackState(false, message || 'İzleme duraklatıldı.');
      saveProgress();
    }
  }

  /* --------------------------- Kaydetme --------------------------- */

  async function saveProgress(options = {}) {
    if (!state.videoId) return;
    if (state.saving && !options.force) return;
    const delta = Math.min(MAX_DELTA_PER_REQUEST, Math.floor(state.unsaved));
    if (delta <= 0 && !options.force) return;

    state.saving = true;
    const sent = delta;
    const wasCompleted = state.completed;
    state.unsaved = Math.max(0, state.unsaved - sent);

    try {
      const response = await App.post('/api/progress', {
        videoId: state.videoId,
        delta: sent,
        position: Math.floor(state.position),
        duration: state.duration,
      });
      const progress = response.progress || {};
      state.watched = progress.watchedSeconds || state.watched + sent;
      state.completed = !!progress.completed;
      state.unsaved = 0;
      renderProgress();
      if (state.completed && !wasCompleted) handleCompleted();
    } catch (error) {
      state.unsaved += sent;
      if (!options.silent) App.toast('İlerleme kaydedilemedi: ' + error.message, 'error');
    } finally {
      state.saving = false;
    }
  }

  function handleCompleted() {
    setPlaying(false, 'Video tamamlandı 🎉');
    App.toast('Tebrikler, bu videoyu tamamladınız!', 'success');
    if (state.data && state.data.nextVideo) {
      nextLink.hidden = false;
    }
    refreshPlaylist();
  }

  async function markComplete() {
    const target = Math.ceil((state.duration * state.threshold) / 100);
    let guard = 0;
    while (!state.completed && state.watched + state.unsaved < target && guard < 12) {
      state.unsaved = Math.max(state.unsaved, target - state.watched);
      await saveProgress({ force: true });
      guard += 1;
    }
    renderProgress();
  }

  /* ---------------------------- Oynatıcı -------------------------- */

  function renderPlayer(data) {
    const video = data.video;
    frameEl.innerHTML = '';

    if (video.kind === 'link') {
      const wrap = document.createElement('div');
      wrap.className = 'player-placeholder';
      wrap.innerHTML =
        '<div>Bu video gömülü olarak oynatılamıyor.<br>' +
        '<a class="btn" style="margin-top: 12px" href="' +
        App.escapeHtml(video.embedUrl) +
        '" target="_blank" rel="noopener">Videoyu yeni sekmede aç</a></div>';
      frameEl.appendChild(wrap);

      const startBtn = document.createElement('button');
      startBtn.className = 'btn ghost';
      startBtn.type = 'button';
      startBtn.textContent = '▶ İzlemeye başladım';
      startBtn.style.position = 'absolute';
      startBtn.style.left = '50%';
      startBtn.style.bottom = '14px';
      startBtn.style.transform = 'translateX(-50%)';
      startBtn.addEventListener('click', () => {
        setPlaying(true, 'İzleme kaydediliyor…');
        startBtn.remove();
      });
      frameEl.appendChild(startBtn);
      setTrackState(false, 'Videoyu açtıktan sonra "İzlemeye başladım" düğmesine basın.');
    } else if (video.kind === 'video') {
      const el = document.createElement('video');
      el.src = video.embedUrl;
      el.controls = true;
      el.playsInline = true;
      el.preload = 'metadata';
      el.setAttribute('controlsList', 'nodownload');
      el.addEventListener('loadedmetadata', () => {
        if (el.duration && Number.isFinite(el.duration)) {
          state.duration = Math.round(el.duration);
          renderProgress();
        }
        if (state.position > 0 && state.position < el.duration - 3) {
          el.currentTime = state.position;
        }
      });
      el.addEventListener('play', () => setPlaying(true, 'İzleme kaydediliyor…'));
      el.addEventListener('pause', () => setPlaying(false, 'Video duraklatıldı.'));
      el.addEventListener('timeupdate', () => {
        state.position = el.currentTime || state.position;
      });
      el.addEventListener('ended', () => {
        state.position = state.duration;
        setPlaying(false, 'Video bitti.');
        saveProgress({ force: true });
      });
      el.addEventListener('error', () => {
        frameEl.innerHTML =
          '<div class="player-placeholder">Video oynatılamadı. Bağlantıyı kontrol edin veya ' +
          '<a href="' + App.escapeHtml(video.embedUrl) + '" target="_blank" rel="noopener">yeni sekmede açın</a>.</div>';
      });
      frameEl.appendChild(el);
    } else {
      const iframe = document.createElement('iframe');
      iframe.src = video.embedUrl;
      iframe.title = video.title;
      iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture';
      iframe.allowFullscreen = true;
      iframe.referrerPolicy = 'strict-origin-when-cross-origin';
      frameEl.appendChild(iframe);

      const startBtn = document.createElement('button');
      startBtn.className = 'btn';
      startBtn.type = 'button';
      startBtn.textContent = '▶ İzlemeye başladım';
      startBtn.style.position = 'absolute';
      startBtn.style.left = '50%';
      startBtn.style.bottom = '14px';
      startBtn.style.transform = 'translateX(-50%)';
      startBtn.addEventListener('click', () => {
        setPlaying(true, 'İzleme kaydediliyor…');
        startBtn.remove();
      });
      frameEl.appendChild(startBtn);
      setTrackState(false, 'Videoyu izlerken "İzlemeye başladım" düğmesine basın.');
    }

    if (video.note) {
      noteEl.textContent = video.note;
      noteEl.classList.remove('hidden');
    } else {
      noteEl.classList.add('hidden');
    }
  }

  function playlistItem(video, currentId) {
    const percentValue = Math.max(0, Math.min(100, video.percent || 0));
    const classes = ['playlist-item'];
    if (video.completed) classes.push('done');
    if (video.id === currentId) classes.push('current');
    return `
      <a class="${classes.join(' ')}" href="/watch.html?id=${encodeURIComponent(video.id)}">
        <span class="pip-index">${video.completed ? '✓' : percentValue > 0 ? '%' + percentValue : ''}</span>
        <span class="pip-body">
          <span class="pip-title">${App.escapeHtml(video.title)}</span>
          <span class="pip-meta">${App.formatDuration(video.duration)}</span>
          <span class="mini-progress"><span style="width: ${percentValue}%"></span></span>
        </span>
      </a>
    `;
  }

  async function refreshPlaylist() {
    if (!state.data) return;
    try {
      const data = await App.get(`/api/topics/${encodeURIComponent(state.data.topic.id)}`);
      playlistEl.innerHTML = (data.videos || [])
        .map((video) => playlistItem(video, state.videoId))
        .join('');
      playlistTopic.textContent = `%${data.status.percent} tamamlandı`;
    } catch (_) {
      /* sessizce yoksay */
    }
  }

  /* ----------------------------- Init ----------------------------- */

  function bindGlobalEvents() {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        setPlaying(false, 'Sekme arka planda, sayaç durdu.');
      }
    });
    window.addEventListener('blur', () => {
      if (state.playing) setPlaying(false, 'Pencere odağı kayboldu, sayaç durdu.');
    });
    window.addEventListener('beforeunload', () => {
      saveProgress({ force: true, silent: true });
    });
    state.saveTimer = setInterval(() => saveProgress({ silent: true }), SAVE_INTERVAL_MS);
  }

  async function init() {
    const user = await App.guard();
    if (!user) return;

    App.renderTopbar(user, 'dashboard');
    App.renderFooter();
    bindGlobalEvents();

    const videoId = App.qs('id');
    if (!videoId) {
      showError('Video seçilmedi. Eğitim listesine dönüp bir video açın.');
      return;
    }
    state.videoId = videoId;

    try {
      const data = await App.get(`/api/videos/${encodeURIComponent(videoId)}`);
      state.data = data;
      state.duration = Number(data.video.duration) || 300;
      state.threshold = Number(data.completionPercent) || 90;
      state.watched = Number(data.progress.watchedSeconds) || 0;
      state.position = Number(data.progress.position) || 0;
      state.completed = !!data.progress.completed;

      document.title = `${data.video.title} — Yeni Doğan Bakım Akademisi`;
      titleEl.textContent = data.video.title;
      descEl.textContent = data.video.description || '';
      topicLink.href = `/topic.html?id=${encodeURIComponent(data.topic.id)}`;
      topicLink.textContent = `← ${data.topic.title}`;
      thresholdText.textContent = state.threshold;

      if (data.prevVideo) {
        prevLink.href = `/watch.html?id=${encodeURIComponent(data.prevVideo.id)}`;
        prevLink.hidden = false;
      }
      if (data.nextVideo) {
        nextLink.href = `/watch.html?id=${encodeURIComponent(data.nextVideo.id)}`;
        nextLink.hidden = false;
      }

      renderPlayer(data);
      renderProgress();
      refreshPlaylist();

      if (state.completed) {
        setTrackState(true, 'Bu videoyu daha önce tamamladınız.');
        completeBtn.hidden = true;
      } else {
        completeBtn.hidden = false;
      }
    } catch (error) {
      showError(error.message);
      frameEl.innerHTML = '<div class="player-placeholder">Video yüklenemedi.</div>';
    }
  }

  completeBtn.addEventListener('click', async () => {
    completeBtn.disabled = true;
    completeBtn.textContent = 'Kaydediliyor…';
    try {
      await markComplete();
      if (!state.completed) {
        App.toast('İlerleme kaydedildi. Videoyu izlemeye devam edebilirsiniz.', 'success');
      }
    } finally {
      completeBtn.disabled = false;
      completeBtn.textContent = 'Videoyu tamamladım';
      completeBtn.hidden = state.completed;
    }
  });

  init();
})();
