'use strict';

/**
 * REST API katmani. server.js tarafindan /api ile baslayan istekler icin cagrilir.
 */

const security = require('./security');
const { resolveVideo } = require('./video');

const SESSION_COOKIE = 'ydw_session';
const MAX_BODY_BYTES = 512 * 1024;

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/* ------------------------------------------------------------------ */
/* HTTP yardimcilari                                                   */
/* ------------------------------------------------------------------ */

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new ApiError(413, 'Gönderilen veri çok büyük.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch (_) {
        reject(new ApiError(400, 'Geçersiz JSON gövdesi.'));
      }
    });
    req.on('error', () => reject(new ApiError(400, 'İstek okunamadı.')));
  });
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) {
      try {
        cookies[name] = decodeURIComponent(value);
      } catch (_) {
        cookies[name] = value;
      }
    }
  }
  return cookies;
}

function buildSessionCookie(token, maxAgeSeconds) {
  return [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ].join('; ');
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown';
}

function cleanText(value, maxLength) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function assert(condition, message, status) {
  if (!condition) throw new ApiError(status || 400, message);
}

function validateUsername(username) {
  return /^[a-zA-Z0-9._-]{3,32}$/.test(username);
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

function createApi({ store, sessions, limiter }) {
  function resolveUser(req) {
    const token = parseCookies(req)[SESSION_COOKIE];
    const session = sessions.get(token);
    if (!session) return { user: null, token };
    const user = store.findUserById(session.userId);
    if (!user || user.active === false) {
      sessions.destroy(token);
      return { user: null, token };
    }
    return { user, token };
  }

  function requireUser(ctx) {
    if (!ctx.user) throw new ApiError(401, 'Bu işlem için giriş yapmalısınız.');
    return ctx.user;
  }

  function requireAdmin(ctx) {
    const user = requireUser(ctx);
    if (user.role !== 'admin') throw new ApiError(403, 'Bu işlem için yönetici yetkisi gerekir.');
    return user;
  }

  function videoWithEmbed(video) {
    const resolved = resolveVideo(video.url);
    return {
      id: video.id,
      topicId: video.topicId,
      title: video.title,
      description: video.description,
      duration: video.duration,
      order: video.order,
      provider: resolved.provider,
      kind: resolved.kind,
      embedUrl: resolved.embedUrl,
      note: resolved.note,
      createdAt: video.createdAt,
      updatedAt: video.updatedAt,
    };
  }

  /* --------------------------- AUTH ------------------------------- */

  async function login(ctx) {
    const ip = clientIp(ctx.req);
    if (limiter.isBlocked(ip)) {
      throw new ApiError(429, 'Çok fazla hatalı deneme yapıldı. Lütfen birkaç dakika sonra tekrar deneyin.');
    }

    const username = cleanText(ctx.body.username, 64);
    const password = String(ctx.body.password || '');
    assert(username && password, 'Kullanıcı adı ve şifre zorunludur.');

    const user = store.findUserByUsername(username);
    const valid =
      user && user.active !== false && security.verifyPassword(password, user.salt, user.hash);

    if (!valid) {
      limiter.fail(ip);
      throw new ApiError(401, 'Kullanıcı adı veya şifre hatalı.');
    }

    limiter.reset(ip);
    const token = sessions.create(user.id, user.role);
    ctx.res.setHeader(
      'Set-Cookie',
      buildSessionCookie(token, Math.floor(security.SESSION_TTL_MS / 1000))
    );
    return sendJson(ctx.res, 200, { user: store.publicUser(user) });
  }

  async function logout(ctx) {
    sessions.destroy(ctx.token);
    ctx.res.setHeader('Set-Cookie', buildSessionCookie('', 0));
    return sendJson(ctx.res, 200, { ok: true });
  }

  async function me(ctx) {
    const user = requireUser(ctx);
    return sendJson(ctx.res, 200, {
      user: store.publicUser(user),
      settings: {
        siteTitle: store.data.settings.siteTitle,
        completionPercent: store.data.settings.completionPercent,
      },
    });
  }

  async function changePassword(ctx) {
    const user = requireUser(ctx);
    const currentPassword = String(ctx.body.currentPassword || '');
    const newPassword = String(ctx.body.newPassword || '');
    assert(security.verifyPassword(currentPassword, user.salt, user.hash), 'Mevcut şifre hatalı.');
    assert(newPassword.length >= 6, 'Yeni şifre en az 6 karakter olmalıdır.');

    const { salt, hash } = security.hashPassword(newPassword);
    user.salt = salt;
    user.hash = hash;
    user.updatedAt = new Date().toISOString();
    await store.save();
    return sendJson(ctx.res, 200, { ok: true });
  }

  /* --------------------------- ICERIK ----------------------------- */

  async function mySummary(ctx) {
    const user = requireUser(ctx);
    const summary = store.userSummary(user.id);
    return sendJson(ctx.res, 200, {
      ...summary,
      user: store.publicUser(user),
      settings: { completionPercent: store.data.settings.completionPercent },
    });
  }

  async function topicDetail(ctx) {
    const user = requireUser(ctx);
    const topic = store.findTopic(ctx.params.id);
    assert(topic, 'Konu bulunamadı.', 404);

    const status = store.topicStatus(user.id, topic.id);
    const videos = store.topicVideos(topic.id).map((video, index) => {
      const progress = status.videos[index];
      return {
        id: video.id,
        title: video.title,
        description: video.description,
        duration: video.duration,
        order: video.order,
        watchedSeconds: progress ? progress.watchedSeconds : 0,
        percent: progress ? progress.percent : 0,
        completed: progress ? progress.completed : false,
      };
    });

    return sendJson(ctx.res, 200, {
      topic: { id: topic.id, title: topic.title, description: topic.description, icon: topic.icon },
      videos,
      status: {
        videoCount: status.videoCount,
        completedVideos: status.completedVideos,
        percent: status.percent,
        completed: status.completed,
        started: status.started,
      },
    });
  }

  async function videoDetail(ctx) {
    const user = requireUser(ctx);
    const video = store.findVideo(ctx.params.id);
    assert(video, 'Video bulunamadı.', 404);
    const topic = store.findTopic(video.topicId);
    assert(topic, 'Videonun bağlı olduğu konu bulunamadı.', 404);

    const siblings = store.topicVideos(topic.id);
    const index = siblings.findIndex((v) => v.id === video.id);
    const progress = store.getProgress(user.id, video.id);
    const nextVideo = index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : null;
    const prevVideo = index > 0 ? siblings[index - 1] : null;

    return sendJson(ctx.res, 200, {
      video: videoWithEmbed(video),
      topic: { id: topic.id, title: topic.title, icon: topic.icon },
      progress: {
        watchedSeconds: progress ? progress.watchedSeconds : 0,
        percent: progress ? progress.percent : 0,
        position: progress ? progress.position || 0 : 0,
        completed: progress ? !!progress.completed : false,
      },
      nextVideo: nextVideo ? { id: nextVideo.id, title: nextVideo.title } : null,
      prevVideo: prevVideo ? { id: prevVideo.id, title: prevVideo.title } : null,
      completionPercent: store.data.settings.completionPercent,
    });
  }

  async function saveProgress(ctx) {
    const user = requireUser(ctx);
    const video = store.findVideo(ctx.body.videoId);
    assert(video, 'Video bulunamadı.', 404);

    const progress = store.recordProgress(
      user.id,
      video.id,
      Number(ctx.body.delta) || 0,
      Number(ctx.body.position) || 0,
      Number(ctx.body.duration) || video.duration
    );
    await store.save();

    const topicStatus = store.topicStatus(user.id, video.topicId);
    return sendJson(ctx.res, 200, {
      progress: {
        watchedSeconds: progress.watchedSeconds,
        percent: progress.percent,
        position: progress.position,
        completed: !!progress.completed,
      },
      topic: {
        id: video.topicId,
        percent: topicStatus.percent,
        completed: topicStatus.completed,
        completedVideos: topicStatus.completedVideos,
        videoCount: topicStatus.videoCount,
      },
    });
  }

  /* --------------------------- ADMIN ------------------------------ */

  async function adminUsers(ctx) {
    requireAdmin(ctx);
    const users = [...store.data.users]
      .sort((a, b) => String(a.username).localeCompare(String(b.username), 'tr'))
      .map((user) => {
        const summary = store.userSummary(user.id);
        return { ...store.publicUser(user), stats: summary.stats };
      });
    return sendJson(ctx.res, 200, { users });
  }

  async function adminCreateUser(ctx) {
    requireAdmin(ctx);
    const username = cleanText(ctx.body.username, 32);
    const fullName = cleanText(ctx.body.fullName, 80);
    const password = String(ctx.body.password || '');
    assert(validateUsername(username), 'Kullanıcı adı 3-32 karakter olmalı (harf, rakam, . _ -).');
    assert(password.length >= 6, 'Şifre en az 6 karakter olmalıdır.');
    assert(!store.findUserByUsername(username), 'Bu kullanıcı adı zaten kullanılıyor.', 409);

    const user = store.createUser({
      username,
      fullName,
      password,
      role: ctx.body.role === 'admin' ? 'admin' : 'user',
    });
    await store.save();
    return sendJson(ctx.res, 201, { user: store.publicUser(user) });
  }

  async function adminUpdateUser(ctx) {
    const admin = requireAdmin(ctx);
    const user = store.findUserById(ctx.params.id);
    assert(user, 'Kullanıcı bulunamadı.', 404);

    if (ctx.body.fullName !== undefined) {
      user.fullName = cleanText(ctx.body.fullName, 80) || user.username;
    }
    if (ctx.body.active !== undefined) {
      const active = ctx.body.active === true || ctx.body.active === 'true';
      assert(!(user.id === admin.id && !active), 'Kendi hesabınızı pasif yapamazsınız.');
      user.active = active;
    }
    if (ctx.body.role !== undefined) {
      const role = ctx.body.role === 'admin' ? 'admin' : 'user';
      assert(!(user.id === admin.id && role !== 'admin'), 'Kendi yönetici yetkinizi kaldıramazsınız.');
      user.role = role;
    }
    if (ctx.body.password) {
      const password = String(ctx.body.password);
      assert(password.length >= 6, 'Şifre en az 6 karakter olmalıdır.');
      const { salt, hash } = security.hashPassword(password);
      user.salt = salt;
      user.hash = hash;
    }
    user.updatedAt = new Date().toISOString();
    await store.save();
    return sendJson(ctx.res, 200, { user: store.publicUser(user) });
  }

  async function adminDeleteUser(ctx) {
    const admin = requireAdmin(ctx);
    const user = store.findUserById(ctx.params.id);
    assert(user, 'Kullanıcı bulunamadı.', 404);
    assert(user.id !== admin.id, 'Kendi hesabınızı silemezsiniz.');
    store.deleteUser(user.id);
    sessions.destroyForUser(user.id);
    await store.save();
    return sendJson(ctx.res, 200, { ok: true });
  }

  async function adminResetProgress(ctx) {
    requireAdmin(ctx);
    const user = store.findUserById(ctx.params.id);
    assert(user, 'Kullanıcı bulunamadı.', 404);
    store.resetUserProgress(user.id);
    await store.save();
    return sendJson(ctx.res, 200, { ok: true });
  }

  async function adminTopics(ctx) {
    requireAdmin(ctx);
    const topics = store.sortedTopics().map((topic) => ({
      ...topic,
      videoCount: store.topicVideos(topic.id).length,
    }));
    return sendJson(ctx.res, 200, { topics });
  }

  async function adminCreateTopic(ctx) {
    requireAdmin(ctx);
    const title = cleanText(ctx.body.title, 120);
    assert(title, 'Konu başlığı zorunludur.');
    const topic = store.createTopic({
      title,
      description: cleanText(ctx.body.description, 400),
      icon: cleanText(ctx.body.icon, 8),
      order: Number(ctx.body.order),
    });
    await store.save();
    return sendJson(ctx.res, 201, { topic });
  }

  async function adminUpdateTopic(ctx) {
    requireAdmin(ctx);
    const topic = store.findTopic(ctx.params.id);
    assert(topic, 'Konu bulunamadı.', 404);
    if (ctx.body.title !== undefined) {
      const title = cleanText(ctx.body.title, 120);
      assert(title, 'Konu başlığı boş olamaz.');
      topic.title = title;
    }
    if (ctx.body.description !== undefined) topic.description = cleanText(ctx.body.description, 400);
    if (ctx.body.icon !== undefined) topic.icon = cleanText(ctx.body.icon, 8) || topic.icon;
    if (ctx.body.order !== undefined && Number.isFinite(Number(ctx.body.order))) {
      topic.order = Number(ctx.body.order);
    }
    topic.updatedAt = new Date().toISOString();
    await store.save();
    return sendJson(ctx.res, 200, { topic });
  }

  async function adminDeleteTopic(ctx) {
    requireAdmin(ctx);
    assert(store.findTopic(ctx.params.id), 'Konu bulunamadı.', 404);
    store.deleteTopic(ctx.params.id);
    await store.save();
    return sendJson(ctx.res, 200, { ok: true });
  }

  async function adminVideos(ctx) {
    requireAdmin(ctx);
    const videos = store.data.videos.map((video) => {
      const topic = store.findTopic(video.topicId);
      const resolved = resolveVideo(video.url);
      return {
        id: video.id,
        topicId: video.topicId,
        topicTitle: topic ? topic.title : '-',
        title: video.title,
        description: video.description,
        url: video.url,
        provider: resolved.provider,
        duration: video.duration,
        order: video.order,
        createdAt: video.createdAt,
      };
    });
    return sendJson(ctx.res, 200, { videos });
  }

  async function adminCreateVideo(ctx) {
    requireAdmin(ctx);
    const topic = store.findTopic(ctx.body.topicId);
    assert(topic, 'Önce geçerli bir konu seçmelisiniz.');
    const title = cleanText(ctx.body.title, 140);
    const url = String(ctx.body.url || '').trim();
    assert(title, 'Video başlığı zorunludur.');
    assert(/^https?:\/\//i.test(url), 'Video bağlantısı http(s) ile başlamalıdır.');

    const video = store.createVideo({
      topicId: topic.id,
      title,
      description: cleanText(ctx.body.description, 600),
      url,
      duration: Number(ctx.body.duration),
      order: Number(ctx.body.order),
    });
    await store.save();
    return sendJson(ctx.res, 201, { video: videoWithEmbed(video) });
  }

  async function adminUpdateVideo(ctx) {
    requireAdmin(ctx);
    const video = store.findVideo(ctx.params.id);
    assert(video, 'Video bulunamadı.', 404);

    if (ctx.body.topicId !== undefined) {
      assert(store.findTopic(ctx.body.topicId), 'Geçerli bir konu seçin.');
      video.topicId = ctx.body.topicId;
    }
    if (ctx.body.title !== undefined) {
      const title = cleanText(ctx.body.title, 140);
      assert(title, 'Video başlığı boş olamaz.');
      video.title = title;
    }
    if (ctx.body.description !== undefined) video.description = cleanText(ctx.body.description, 600);
    if (ctx.body.url !== undefined) {
      const url = String(ctx.body.url).trim();
      assert(/^https?:\/\//i.test(url), 'Video bağlantısı http(s) ile başlamalıdır.');
      video.url = url;
    }
    if (ctx.body.duration !== undefined) {
      const duration = Number(ctx.body.duration);
      if (Number.isFinite(duration) && duration > 0) video.duration = Math.min(60 * 60 * 6, duration);
    }
    if (ctx.body.order !== undefined && Number.isFinite(Number(ctx.body.order))) {
      video.order = Number(ctx.body.order);
    }
    video.updatedAt = new Date().toISOString();
    await store.save();
    return sendJson(ctx.res, 200, { video: videoWithEmbed(video) });
  }

  async function adminDeleteVideo(ctx) {
    requireAdmin(ctx);
    assert(store.findVideo(ctx.params.id), 'Video bulunamadı.', 404);
    store.deleteVideo(ctx.params.id);
    await store.save();
    return sendJson(ctx.res, 200, { ok: true });
  }

  async function adminReport(ctx) {
    requireAdmin(ctx);
    const topics = store.sortedTopics();
    const rows = store.data.users.map((user) => {
      const summary = store.userSummary(user.id);
      let lastActivity = null;
      const userProgress = store.data.progress[user.id] || {};
      for (const item of Object.values(userProgress)) {
        if (item.updatedAt && (!lastActivity || item.updatedAt > lastActivity)) {
          lastActivity = item.updatedAt;
        }
      }
      return {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        active: user.active !== false,
        role: user.role,
        lastActivity,
        stats: summary.stats,
        topics: topics.map((topic) => {
          const status = store.topicStatus(user.id, topic.id);
          return {
            id: topic.id,
            title: topic.title,
            percent: status.percent,
            completed: status.completed,
            started: status.started,
            completedVideos: status.completedVideos,
            videoCount: status.videoCount,
          };
        }),
      };
    });
    return sendJson(ctx.res, 200, {
      topics: topics.map((t) => ({ id: t.id, title: t.title })),
      users: rows,
      settings: { completionPercent: store.data.settings.completionPercent },
    });
  }

  async function adminUpdateSettings(ctx) {
    requireAdmin(ctx);
    const completionPercent = Number(ctx.body.completionPercent);
    if (Number.isFinite(completionPercent)) {
      store.data.settings.completionPercent = Math.min(
        100,
        Math.max(1, Math.round(completionPercent))
      );
    }
    if (ctx.body.siteTitle !== undefined) {
      store.data.settings.siteTitle =
        cleanText(ctx.body.siteTitle, 80) || 'Yeni Doğan Bakım Akademisi';
    }
    await store.save();
    return sendJson(ctx.res, 200, { settings: store.data.settings });
  }

  return {
    login,
    logout,
    me,
    changePassword,
    mySummary,
    topicDetail,
    videoDetail,
    saveProgress,
    adminUsers,
    adminCreateUser,
    adminUpdateUser,
    adminDeleteUser,
    adminResetProgress,
    adminTopics,
    adminCreateTopic,
    adminUpdateTopic,
    adminDeleteTopic,
    adminVideos,
    adminCreateVideo,
    adminUpdateVideo,
    adminDeleteVideo,
    adminReport,
    adminUpdateSettings,
  };
}

module.exports = {
  createApi,
  ApiError,
  sendJson,
  readJsonBody,
  parseCookies,
  validateUsername,
  cleanText,
  SESSION_COOKIE,
};

