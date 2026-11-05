'use strict';

/**
 * Sifreli dosya tabanli veri deposu.
 * Veritabani yerine data/data.enc dosyasi AES-256-GCM ile sifreli tutulur.
 */

const fs = require('fs');
const path = require('path');
const security = require('./security');

const DATA_VERSION = 1;
const DEFAULT_COMPLETION_PERCENT = 90;
const DEFAULT_VIDEO_DURATION = 300; // saniye

const SEED_TOPICS = [
  {
    title: 'Yenidoğan Nedir?',
    description: 'Yenidoğan bebeğin özellikleri, ilk günlerde yaşanan değişimler ve temel bilgiler.',
    icon: '👶',
  },
  {
    title: 'Yenidoğan Bakımı',
    description: 'Göbek bakımı, alt değiştirme, giydirme, uyku düzeni ve hijyen kuralları.',
    icon: '🧷',
  },
  {
    title: 'Yenidoğan Banyosu',
    description: 'Banyo öncesi hazırlık, su sıcaklığı, güvenli yıkama teknikleri ve sonrası bakım.',
    icon: '🛁',
  },
  {
    title: 'Yenidoğan Beslenmesi',
    description: 'Beslenme sıklığı, porsiyonlar, gaz çıkarma ve beslenmeye dair pratik ipuçları.',
    icon: '🍼',
  },
  {
    title: 'Yenidoğan Emzirme',
    description: 'Doğru emzirme pozisyonları, kavrama tekniği, süt artırma ve sık görülen sorunlar.',
    icon: '🤱',
  },
  {
    title: 'Yenidoğan Takibi',
    description: 'Kilo ve boy takibi, sarılık belirtileri, aşı takvimi ve doktora ne zaman başvurulmalı.',
    icon: '📈',
  },
];

class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'data.enc');
    this.backupFile = path.join(dataDir, 'data.enc.bak');
    this.key = security.loadSecretKey(dataDir);
    this.data = null;
    this.writeQueue = Promise.resolve();
  }

  /* ---------------------------------------------------------------- */
  /* Yukleme / kaydetme                                               */
  /* ---------------------------------------------------------------- */

  load() {
    fs.mkdirSync(this.dataDir, { recursive: true });

    if (fs.existsSync(this.file)) {
      try {
        this.data = this.migrate(security.decryptJson(this.key, fs.readFileSync(this.file, 'utf8')));
      } catch (error) {
        if (fs.existsSync(this.backupFile)) {
          this.data = this.migrate(
            security.decryptJson(this.key, fs.readFileSync(this.backupFile, 'utf8'))
          );
          this.save();
          console.warn('[store] data.enc okunamadi, yedekten geri yuklendi.');
        } else {
          throw new Error(
            'Sifreli veri dosyasi okunamadi. data/secret.key dogru mu? Ayrinti: ' + error.message
          );
        }
      }
      return this.data;
    }

    this.data = this.migrate({});
    this.seed();
    this.save();
    return this.data;
  }

  migrate(data) {
    const safe = data && typeof data === 'object' ? data : {};
    safe.meta = safe.meta || {};
    safe.meta.version = DATA_VERSION;
    safe.meta.createdAt = safe.meta.createdAt || new Date().toISOString();
    safe.settings = Object.assign(
      {
        siteTitle: 'Yeni Doğan Bakım Akademisi',
        completionPercent: DEFAULT_COMPLETION_PERCENT,
        defaultVideoDuration: DEFAULT_VIDEO_DURATION,
      },
      safe.settings || {}
    );
    safe.users = Array.isArray(safe.users) ? safe.users : [];
    safe.topics = Array.isArray(safe.topics) ? safe.topics : [];
    safe.videos = Array.isArray(safe.videos) ? safe.videos : [];
    safe.progress = safe.progress && typeof safe.progress === 'object' ? safe.progress : {};
    safe.settings.completionPercent = clampNumber(
      safe.settings.completionPercent,
      1,
      100,
      DEFAULT_COMPLETION_PERCENT
    );
    safe.settings.defaultVideoDuration = clampNumber(
      safe.settings.defaultVideoDuration,
      10,
      60 * 60 * 6,
      DEFAULT_VIDEO_DURATION
    );
    return safe;
  }

  seed() {
    const now = new Date().toISOString();
    const admin = security.hashPassword('Admin1234!');

    this.data.users.push({
      id: security.randomId('usr'),
      username: 'admin',
      fullName: 'Sistem Yöneticisi',
      role: 'admin',
      salt: admin.salt,
      hash: admin.hash,
      active: true,
      createdAt: now,
      updatedAt: now,
    });

    this.data.topics = SEED_TOPICS.map((topic, index) => ({
      id: security.randomId('top'),
      title: topic.title,
      description: topic.description,
      icon: topic.icon,
      order: index + 1,
      createdAt: now,
      updatedAt: now,
    }));

    // Icerik girilene kadar arayuzu test edebilmek icin ornek video
    this.data.videos.push({
      id: security.randomId('vid'),
      topicId: this.data.topics[0].id,
      title: 'Örnek Video (test amaçlı)',
      description:
        'Bu kayıt sistemin çalıştığını görmek için eklenmiştir. Admin panelinden silip kendi videolarınızı ekleyebilirsiniz.',
      url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
      duration: 30,
      order: 1,
      createdAt: now,
      updatedAt: now,
    });

    this.data.meta.seededAt = now;
  }

  save() {
    this.data.meta.updatedAt = new Date().toISOString();
    const payload = security.encryptJson(this.key, this.data);

    this.writeQueue = this.writeQueue.then(() => {
      fs.mkdirSync(this.dataDir, { recursive: true });
      const tmpFile = `${this.file}.tmp`;
      fs.writeFileSync(tmpFile, payload, { encoding: 'utf8' });
      if (fs.existsSync(this.file)) {
        try {
          fs.copyFileSync(this.file, this.backupFile);
        } catch (_) {
          /* yedek alinamazsa devam et */
        }
      }
      fs.renameSync(tmpFile, this.file);
    });

    return this.writeQueue;
  }

  /* ---------------------------------------------------------------- */
  /* Kullanicilar                                                     */
  /* ---------------------------------------------------------------- */

  findUserByUsername(username) {
    const needle = String(username || '').trim().toLowerCase();
    return this.data.users.find((u) => String(u.username).toLowerCase() === needle) || null;
  }

  findUserById(id) {
    return this.data.users.find((u) => u.id === id) || null;
  }

  publicUser(user) {
    if (!user) return null;
    return {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
      active: user.active !== false,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  createUser({ username, fullName, password, role }) {
    const now = new Date().toISOString();
    const { salt, hash } = security.hashPassword(password);
    const user = {
      id: security.randomId('usr'),
      username: String(username).trim(),
      fullName: String(fullName || '').trim() || String(username).trim(),
      role: role === 'admin' ? 'admin' : 'user',
      salt,
      hash,
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    this.data.users.push(user);
    return user;
  }

  deleteUser(id) {
    const index = this.data.users.findIndex((u) => u.id === id);
    if (index === -1) return false;
    this.data.users.splice(index, 1);
    delete this.data.progress[id];
    return true;
  }

  resetUserProgress(userId) {
    this.data.progress[userId] = {};
  }

  /* ---------------------------------------------------------------- */
  /* Konular ve videolar                                              */
  /* ---------------------------------------------------------------- */

  sortedTopics() {
    return [...this.data.topics].sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  topicVideos(topicId) {
    return this.data.videos
      .filter((v) => v.topicId === topicId)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  findTopic(id) {
    return this.data.topics.find((t) => t.id === id) || null;
  }

  findVideo(id) {
    return this.data.videos.find((v) => v.id === id) || null;
  }

  createTopic({ title, description, icon, order }) {
    const now = new Date().toISOString();
    const topic = {
      id: security.randomId('top'),
      title: String(title).trim(),
      description: String(description || '').trim(),
      icon: icon || '📘',
      order: Number.isFinite(Number(order)) ? Number(order) : this.data.topics.length + 1,
      createdAt: now,
      updatedAt: now,
    };
    this.data.topics.push(topic);
    return topic;
  }

  deleteTopic(id) {
    const index = this.data.topics.findIndex((t) => t.id === id);
    if (index === -1) return false;
    this.data.topics.splice(index, 1);
    const removedVideoIds = this.data.videos.filter((v) => v.topicId === id).map((v) => v.id);
    this.data.videos = this.data.videos.filter((v) => v.topicId !== id);
    for (const userId of Object.keys(this.data.progress)) {
      for (const videoId of removedVideoIds) {
        delete this.data.progress[userId][videoId];
      }
    }
    return true;
  }

  createVideo({ topicId, title, description, url, duration, order }) {
    const now = new Date().toISOString();
    const video = {
      id: security.randomId('vid'),
      topicId,
      title: String(title).trim(),
      description: String(description || '').trim(),
      url: String(url).trim(),
      duration: clampNumber(duration, 1, 60 * 60 * 6, this.data.settings.defaultVideoDuration),
      order: Number.isFinite(Number(order))
        ? Number(order)
        : this.data.videos.filter((v) => v.topicId === topicId).length + 1,
      createdAt: now,
      updatedAt: now,
    };
    this.data.videos.push(video);
    return video;
  }

  deleteVideo(id) {
    const index = this.data.videos.findIndex((v) => v.id === id);
    if (index === -1) return false;
    this.data.videos.splice(index, 1);
    for (const userId of Object.keys(this.data.progress)) {
      delete this.data.progress[userId][id];
    }
    return true;
  }

  /* ---------------------------------------------------------------- */
  /* Izleme ilerlemesi                                                */
  /* ---------------------------------------------------------------- */

  getProgress(userId, videoId) {
    const userProgress = this.data.progress[userId] || {};
    return userProgress[videoId] || null;
  }

  /**
   * Artimli izleme kaydi. deltaSeconds: son kayittan bu yana izlenen saniye.
   */
  recordProgress(userId, videoId, deltaSeconds, position, durationOverride) {
    const video = this.findVideo(videoId);
    if (!video) return null;

    const duration = clampNumber(durationOverride || video.duration, 1, 60 * 60 * 6, video.duration);
    const threshold = this.data.settings.completionPercent;
    this.data.progress[userId] = this.data.progress[userId] || {};
    const existing = this.data.progress[userId][videoId] || {
      watchedSeconds: 0,
      percent: 0,
      position: 0,
      completed: false,
      firstWatchedAt: new Date().toISOString(),
      completedAt: null,
    };

    const delta = clampNumber(deltaSeconds, 0, 300, 0);
    existing.watchedSeconds = Math.min(duration + 60, (existing.watchedSeconds || 0) + delta);
    existing.position = Math.max(existing.position || 0, clampNumber(position, 0, 60 * 60 * 6, 0));
    existing.duration = duration;
    existing.percent = Math.min(100, Math.round((existing.watchedSeconds / duration) * 100));
    existing.updatedAt = new Date().toISOString();

    if (!existing.completed && existing.percent >= threshold) {
      existing.completed = true;
      existing.completedAt = new Date().toISOString();
    }

    this.data.progress[userId][videoId] = existing;
    return existing;
  }

  /** Bir kullanicinin bir konudaki durumu */
  topicStatus(userId, topicId) {
    const videos = this.topicVideos(topicId);
    const items = videos.map((video) => {
      const progress = this.getProgress(userId, video.id);
      return {
        videoId: video.id,
        watchedSeconds: progress ? progress.watchedSeconds : 0,
        percent: progress ? progress.percent : 0,
        completed: progress ? !!progress.completed : false,
      };
    });
    const completedVideos = items.filter((i) => i.completed).length;
    const totalWatched = items.reduce((sum, i) => sum + i.watchedSeconds, 0);
    const totalDuration = videos.reduce((sum, v) => sum + (v.duration || 0), 0);
    const percent =
      totalDuration > 0 ? Math.min(100, Math.round((totalWatched / totalDuration) * 100)) : 0;
    return {
      topicId,
      videoCount: videos.length,
      completedVideos,
      percent,
      completed: videos.length > 0 && completedVideos === videos.length,
      started: totalWatched > 0,
      videos: items,
    };
  }

  /** Kullanicinin tum site ilerlemesi */
  userSummary(userId) {
    const topics = this.sortedTopics().map((topic) => {
      const status = this.topicStatus(userId, topic.id);
      return {
        id: topic.id,
        title: topic.title,
        description: topic.description,
        icon: topic.icon,
        order: topic.order,
        videoCount: status.videoCount,
        completedVideos: status.completedVideos,
        percent: status.percent,
        completed: status.completed,
        started: status.started,
      };
    });

    const totalVideos = topics.reduce((sum, t) => sum + t.videoCount, 0);
    const completedVideos = topics.reduce((sum, t) => sum + t.completedVideos, 0);
    return {
      topics,
      stats: {
        totalTopics: topics.length,
        completedTopics: topics.filter((t) => t.completed).length,
        totalVideos,
        completedVideos,
        percent: totalVideos > 0 ? Math.round((completedVideos / totalVideos) * 100) : 0,
      },
    };
  }
}

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

module.exports = { Store, clampNumber, DEFAULT_COMPLETION_PERCENT };
