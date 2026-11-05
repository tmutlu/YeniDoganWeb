'use strict';

/**
 * Yeni Doğan Bakım Akademisi - yerel web sunucusu.
 * Harici paket gerektirmez. Calistirmak icin: npm start
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { Store } = require('./lib/store');
const { SessionStore, LoginRateLimiter } = require('./lib/security');
const {
  createApi,
  ApiError,
  sendJson,
  readJsonBody,
  parseCookies,
  SESSION_COOKIE,
} = require('./lib/api');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');

const store = new Store(DATA_DIR);
store.load();

const sessions = new SessionStore();
const limiter = new LoginRateLimiter();
const api = createApi({ store, sessions, limiter });

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/* ------------------------------------------------------------------ */
/* API yonlendirme tablosu                                             */
/* ------------------------------------------------------------------ */

const ROUTES = [
  ['POST', /^\/api\/auth\/login$/, api.login],
  ['POST', /^\/api\/auth\/logout$/, api.logout],
  ['GET', /^\/api\/auth\/me$/, api.me],
  ['POST', /^\/api\/auth\/password$/, api.changePassword],
  ['GET', /^\/api\/me\/summary$/, api.mySummary],
  ['GET', /^\/api\/topics\/([A-Za-z0-9_]+)$/, api.topicDetail],
  ['GET', /^\/api\/videos\/([A-Za-z0-9_]+)$/, api.videoDetail],
  ['POST', /^\/api\/progress$/, api.saveProgress],
  ['GET', /^\/api\/admin\/users$/, api.adminUsers],
  ['POST', /^\/api\/admin\/users$/, api.adminCreateUser],
  ['PATCH', /^\/api\/admin\/users\/([A-Za-z0-9_]+)$/, api.adminUpdateUser],
  ['DELETE', /^\/api\/admin\/users\/([A-Za-z0-9_]+)$/, api.adminDeleteUser],
  ['POST', /^\/api\/admin\/users\/([A-Za-z0-9_]+)\/reset-progress$/, api.adminResetProgress],
  ['GET', /^\/api\/admin\/topics$/, api.adminTopics],
  ['POST', /^\/api\/admin\/topics$/, api.adminCreateTopic],
  ['PATCH', /^\/api\/admin\/topics\/([A-Za-z0-9_]+)$/, api.adminUpdateTopic],
  ['DELETE', /^\/api\/admin\/topics\/([A-Za-z0-9_]+)$/, api.adminDeleteTopic],
  ['GET', /^\/api\/admin\/videos$/, api.adminVideos],
  ['POST', /^\/api\/admin\/videos$/, api.adminCreateVideo],
  ['PATCH', /^\/api\/admin\/videos\/([A-Za-z0-9_]+)$/, api.adminUpdateVideo],
  ['DELETE', /^\/api\/admin\/videos\/([A-Za-z0-9_]+)$/, api.adminDeleteVideo],
  ['GET', /^\/api\/admin\/report$/, api.adminReport],
  ['PATCH', /^\/api\/admin\/settings$/, api.adminUpdateSettings],
];

/* ------------------------------------------------------------------ */
/* API isleyici                                                        */
/* ------------------------------------------------------------------ */

async function handleApi(req, res, pathname) {
  if (pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, time: new Date().toISOString() });
  }

  for (const [method, pattern, handler] of ROUTES) {
    const match = pathname.match(pattern);
    if (!match) continue;
    if (req.method !== method) continue;

    const ctx = {
      req,
      res,
      pathname,
      params: { id: match[1] },
      body: {},
      user: null,
      token: null,
    };

    try {
      if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
        ctx.body = await readJsonBody(req);
      }
      const token = parseCookies(req)[SESSION_COOKIE];
      ctx.token = token;
      const session = sessions.get(token);
      if (session) {
        const user = store.findUserById(session.userId);
        if (user && user.active !== false) ctx.user = user;
      }
      await handler(ctx);
    } catch (error) {
      if (res.headersSent) return undefined;
      if (error instanceof ApiError) {
        return sendJson(res, error.status, { error: error.message });
      }
      console.error('[api]', pathname, req.method, error);
      return sendJson(res, 500, { error: 'Sunucu hatası oluştu. Lütfen tekrar deneyin.' });
    }
    return undefined;
  }

  if (pathname.startsWith('/api/')) {
    return sendJson(res, 404, { error: 'İstenen API adresi bulunamadı.' });
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Statik dosyalar                                                     */
/* ------------------------------------------------------------------ */

function serveStatic(req, res, pathname) {
  let relative = pathname;
  try {
    relative = decodeURIComponent(pathname);
  } catch (_) {
    relative = pathname;
  }
  if (relative === '/' || relative === '') relative = '/index.html';

  const filePath = path.normalize(path.join(PUBLIC_DIR, relative));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Erişim reddedildi.');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(
        '<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Sayfa bulunamadı</title></head>' +
          '<body style="font-family:system-ui;padding:40px;text-align:center">' +
          '<h1>404 - Sayfa bulunamadı</h1><p><a href="/">Ana sayfaya dön</a></p></body></html>'
      );
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Sunucu                                                              */
/* ------------------------------------------------------------------ */

const server = http.createServer(async (req, res) => {
  let pathname = '/';
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    pathname = url.pathname;
  } catch (_) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Geçersiz istek.');
  }

  if (pathname.startsWith('/api/')) {
    return handleApi(req, res, pathname);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Desteklenmeyen metot.');
  }
  return serveStatic(req, res, pathname);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} kullanımda. Farklı port için: set PORT=3001 && npm start`);
    process.exit(1);
  }
  throw error;
});

server.listen(PORT, HOST, () => {
  console.log('----------------------------------------------------');
  console.log('  Yeni Doğan Bakım Akademisi');
  console.log(`  Adres    : http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log('  Yönetici : admin / Admin1234!  (ilk girişte değiştirin)');
  console.log('  Veri     : data/data.enc (AES-256-GCM şifreli)');
  console.log(
    `  Özet     : ${store.data.users.length} kullanıcı | ${store.data.topics.length} konu | ${store.data.videos.length} video`
  );
  console.log('----------------------------------------------------');
});

module.exports = { server };
