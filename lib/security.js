'use strict';

/**
 * Sifreleme, parola hash'leme ve oturum yonetimi yardimcilari.
 * Harici paket kullanilmaz; sadece Node.js "crypto" modulu.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PBKDF2_ITERATIONS = 120000;
const PBKDF2_KEYLEN = 64;
const PBKDF2_DIGEST = 'sha256';
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 saat

/* ------------------------------------------------------------------ */
/* Sifreleme anahtari                                                  */
/* ------------------------------------------------------------------ */

/**
 * Veriyi sifrelemek icin kullanilan 32 byte'lik anahtari dondurur.
 * Oncelik: YDW_SECRET ortam degiskeni -> data/secret.key dosyasi.
 * Dosya yoksa ilk calistirmada uretilir.
 */
function loadSecretKey(dataDir) {
  const fromEnv = process.env.YDW_SECRET;
  if (fromEnv && fromEnv.length >= 16) {
    return crypto.createHash('sha256').update(fromEnv).digest();
  }

  const keyFile = path.join(dataDir, 'secret.key');
  if (fs.existsSync(keyFile)) {
    const hex = fs.readFileSync(keyFile, 'utf8').trim();
    if (/^[0-9a-f]{64}$/i.test(hex)) {
      return Buffer.from(hex, 'hex');
    }
  }

  const key = crypto.randomBytes(32);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(keyFile, key.toString('hex'), { encoding: 'utf8', mode: 0o600 });
  return key;
}

/**
 * JSON verisini AES-256-GCM ile sifreler.
 * Cikti: base64(iv[12] + tag[16] + ciphertext)
 */
function encryptJson(key, value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

/**
 * encryptJson ile sifrelenmis veriyi cozer.
 */
function decryptJson(key, payload) {
  const raw = Buffer.from(String(payload), 'base64');
  if (raw.length < 29) {
    throw new Error('Sifreli veri dosyasi gecersiz.');
  }
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
}

/* ------------------------------------------------------------------ */
/* Parola hash'leme                                                    */
/* ------------------------------------------------------------------ */

function hashPassword(password, salt) {
  const usedSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto
    .pbkdf2Sync(String(password), usedSalt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST)
    .toString('hex');
  return { salt: usedSalt, hash };
}

function verifyPassword(password, salt, hash) {
  if (!salt || !hash) return false;
  const candidate = hashPassword(password, salt).hash;
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(String(hash), 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/* ------------------------------------------------------------------ */
/* Yardimcilar                                                         */
/* ------------------------------------------------------------------ */

function randomId(prefix) {
  return `${prefix || 'id'}_${crypto.randomBytes(9).toString('hex')}`;
}

function randomToken() {
  return crypto.randomBytes(32).toString('hex');
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/* ------------------------------------------------------------------ */
/* Oturum deposu (bellek ici)                                          */
/* ------------------------------------------------------------------ */

class SessionStore {
  constructor() {
    this.sessions = new Map();
    this.timer = setInterval(() => this.cleanup(), 1000 * 60 * 10);
    if (this.timer.unref) this.timer.unref();
  }

  create(userId, role) {
    const token = randomToken();
    this.sessions.set(token, {
      userId,
      role,
      createdAt: Date.now(),
      expiresAt: Date.now() + SESSION_TTL_MS,
    });
    return token;
  }

  get(token) {
    if (!token) return null;
    const session = this.sessions.get(token);
    if (!session) return null;
    if (session.expiresAt < Date.now()) {
      this.sessions.delete(token);
      return null;
    }
    return session;
  }

  destroy(token) {
    if (token) this.sessions.delete(token);
  }

  destroyForUser(userId) {
    for (const [token, session] of this.sessions.entries()) {
      if (session.userId === userId) this.sessions.delete(token);
    }
  }

  cleanup() {
    const now = Date.now();
    for (const [token, session] of this.sessions.entries()) {
      if (session.expiresAt < now) this.sessions.delete(token);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Basit giris denemesi sinirlayici (IP bazli)                         */
/* ------------------------------------------------------------------ */

class LoginRateLimiter {
  constructor(maxAttempts = 8, windowMs = 10 * 60 * 1000) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
    this.entries = new Map();
    this.timer = setInterval(() => this.cleanup(), 1000 * 60 * 5);
    if (this.timer.unref) this.timer.unref();
  }

  isBlocked(key) {
    const entry = this.entries.get(key);
    if (!entry) return false;
    if (Date.now() - entry.firstAt > this.windowMs) {
      this.entries.delete(key);
      return false;
    }
    return entry.count >= this.maxAttempts;
  }

  fail(key) {
    const entry = this.entries.get(key);
    if (!entry || Date.now() - entry.firstAt > this.windowMs) {
      this.entries.set(key, { count: 1, firstAt: Date.now() });
      return;
    }
    entry.count += 1;
  }

  reset(key) {
    this.entries.delete(key);
  }

  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.entries.entries()) {
      if (now - entry.firstAt > this.windowMs) this.entries.delete(key);
    }
  }
}

module.exports = {
  loadSecretKey,
  encryptJson,
  decryptJson,
  hashPassword,
  verifyPassword,
  randomId,
  randomToken,
  safeEqual,
  SessionStore,
  LoginRateLimiter,
  SESSION_TTL_MS,
};
