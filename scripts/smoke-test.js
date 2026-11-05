'use strict';

/**
 * Basit duman testi: sunucuyu gecici bir portta baslatir ve temel akislari dener.
 * Calistirmak icin: node scripts/smoke-test.js
 */

process.env.PORT = process.env.TEST_PORT || '3111';
process.env.HOST = '127.0.0.1';

const http = require('http');
const { server } = require('../server');

const BASE = `http://127.0.0.1:${process.env.PORT}`;
let cookie = '';
let passed = 0;
let failed = 0;

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const req = http.request(
      BASE + path,
      {
        method,
        headers: Object.assign(
          { Accept: 'application/json' },
          payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {},
          cookie ? { Cookie: cookie } : {}
        ),
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const setCookie = res.headers['set-cookie'];
          if (setCookie && setCookie.length) cookie = setCookie[0].split(';')[0];
          const text = Buffer.concat(chunks).toString('utf8');
          let data = null;
          try {
            data = JSON.parse(text);
          } catch (_) {
            data = text;
          }
          resolve({ status: res.statusCode, data });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function check(name, condition, extra) {
  if (condition) {
    passed += 1;
    console.log(`  OK   ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}${extra ? ' -> ' + JSON.stringify(extra) : ''}`);
  }
}


async function run() {
  console.log(`Test sunucusu: ${BASE}`);

  let res = await request('GET', '/api/health');
  check('health', res.status === 200 && res.data.ok === true, res.data);

  res = await request('GET', '/');
  check('ana sayfa HTML', res.status === 200 && String(res.data).includes('login-form'));

  res = await request('GET', '/api/auth/me');
  check('oturum yok -> 401', res.status === 401, res.status);

  res = await request('POST', '/api/auth/login', { username: 'admin', password: 'yanlis' });
  check('hatali sifre -> 401', res.status === 401, res.status);

  res = await request('POST', '/api/auth/login', { username: 'admin', password: 'Admin1234!' });
  check('admin girisi', res.status === 200 && res.data.user.role === 'admin', res.data);
  check('oturum cerezi', !!cookie);

  res = await request('GET', '/api/auth/me');
  check('me', res.status === 200 && res.data.user.username === 'admin', res.data);

  res = await request('GET', '/api/me/summary');
  check('ozet', res.status === 200 && Array.isArray(res.data.topics), res.status);

  res = await request('GET', '/api/admin/topics');
  check('admin konular', res.status === 200 && res.data.topics.length >= 6, res.status);
  const firstTopic = res.data.topics[0];

  res = await request('GET', '/api/admin/videos');
  check('admin videolar', res.status === 200 && res.data.videos.length >= 1, res.status);
  const sampleVideo = res.data.videos[0];

  res = await request('POST', '/api/admin/users', {
    username: 'test.anne',
    fullName: 'Test Anne',
    password: 'Test1234!',
    role: 'user',
  });
  check('kullanici olustur', res.status === 201 && res.data.user.username === 'test.anne', res.data);
  const testUserId = res.data.user.id;

  res = await request('GET', '/api/admin/users');
  check('admin kullanicilar', res.status === 200 && res.data.users.length >= 2, res.status);

  // Yeni kullanici olarak giris
  cookie = '';
  res = await request('POST', '/api/auth/login', { username: 'test.anne', password: 'Test1234!' });
  check('anne girisi', res.status === 200 && res.data.user.role === 'user', res.data);

  res = await request('GET', `/api/topics/${firstTopic.id}`);
  check('konu detayi', res.status === 200 && Array.isArray(res.data.videos), res.status);

  res = await request('GET', `/api/videos/${sampleVideo.id}`);
  check('video detayi', res.status === 200 && !!res.data.video.embedUrl, res.status);

  res = await request('POST', '/api/progress', {
    videoId: sampleVideo.id,
    delta: 300,
    position: 30,
    duration: 30,
  });
  check('ilerleme kaydi', res.status === 200 && res.data.progress.percent > 0, res.data);
  check('video tamamlandi', res.status === 200 && res.data.progress.completed === true, res.data);

  res = await request('GET', '/api/me/summary');
  check('ozet guncellendi', res.status === 200 && res.data.stats.completedVideos >= 1, res.data.stats);

  res = await request('GET', '/api/admin/users');
  check('anne admin API -> 403', res.status === 403, res.status);

  // Tekrar admin
  cookie = '';
  res = await request('POST', '/api/auth/login', { username: 'admin', password: 'Admin1234!' });
  check('admin tekrar girisi', res.status === 200, res.status);

  res = await request('GET', '/api/admin/report');
  check('rapor', res.status === 200 && Array.isArray(res.data.users), res.status);
  const testRow = (res.data.users || []).find((u) => u.id === testUserId);
  check('raporda ilerleme', !!testRow && testRow.stats.completedVideos >= 1, testRow && testRow.stats);

  res = await request('PATCH', '/api/admin/settings', {
    completionPercent: 90,
    siteTitle: 'Yeni Doğan Bakım Akademisi',
  });
  check('ayarlar', res.status === 200 && res.data.settings.completionPercent === 90, res.data);

  res = await request('POST', `/api/admin/users/${testUserId}/reset-progress`);
  check('ilerleme sifirlama', res.status === 200 && res.data.ok === true, res.data);

  res = await request('DELETE', `/api/admin/users/${testUserId}`);
  check('kullanici silme', res.status === 200 && res.data.ok === true, res.data);

  res = await request('POST', '/api/auth/logout');
  check('cikis', res.status === 200 && res.data.ok === true, res.data);

  console.log(`\nSonuc: ${passed} basarili, ${failed} basarisiz`);
  server.close();
  process.exit(failed ? 1 : 0);
}

server.on('listening', () => {
  run().catch((error) => {
    console.error('Test hatasi:', error);
    server.close();
    process.exit(1);
  });
});

