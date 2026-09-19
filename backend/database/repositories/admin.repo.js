/**
 * Repositorio de administradores e sessoes do painel.
 *
 * As senhas sao guardadas com scrypt (modulo crypto do proprio Node), em
 * formato "scrypt$N$r$p$salt$hash". Nenhuma senha em texto puro e persistida.
 */
import crypto from 'node:crypto';
import { getDb } from '../db.js';

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, SCRYPT_PARAMS.keylen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
  });
  return [
    'scrypt',
    SCRYPT_PARAMS.N,
    SCRYPT_PARAMS.r,
    SCRYPT_PARAMS.p,
    salt.toString('base64'),
    hash.toString('base64'),
  ].join('$');
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, saltB64, hashB64] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;

    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(String(password), salt, expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
    });
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function countAdmins() {
  const db = getDb();
  return Number(db.prepare('SELECT COUNT(*) AS total FROM admins').get()?.total ?? 0);
}

export function findAdminByUsername(username) {
  const db = getDb();
  const result = db.prepare('SELECT * FROM admins WHERE username = ?').get(String(username).toLowerCase());
  return result ? { ...result } : null;
}

export function createAdmin(username, password) {
  const db = getDb();
  db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run(
    String(username).toLowerCase(),
    hashPassword(password)
  );
  return findAdminByUsername(username);
}

export function updateAdminPassword(adminId, password) {
  const db = getDb();
  db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hashPassword(password), adminId);
}

export function touchLogin(adminId) {
  const db = getDb();
  db.prepare("UPDATE admins SET last_login_at = datetime('now') WHERE id = ?").run(adminId);
}

/** Cria uma sessao e devolve o id (que vai assinado no cookie). */
export function createSession(adminId, ttlHours = 12) {
  const db = getDb();
  const id = crypto.randomBytes(32).toString('hex');
  db.prepare(
    `INSERT INTO admin_sessions (id, admin_id, expires_at)
     VALUES (?, ?, datetime('now', ?))`
  ).run(id, adminId, `+${Math.max(1, Number(ttlHours) || 12)} hours`);
  return id;
}

export function findSession(sessionId) {
  if (!sessionId) return null;
  const db = getDb();
  const result = db
    .prepare(
      `SELECT s.id, s.admin_id, s.expires_at, a.username
         FROM admin_sessions s
         JOIN admins a ON a.id = s.admin_id
        WHERE s.id = ? AND s.expires_at > datetime('now')`
    )
    .get(String(sessionId));
  return result ? { ...result } : null;
}

export function destroySession(sessionId) {
  if (!sessionId) return;
  const db = getDb();
  db.prepare('DELETE FROM admin_sessions WHERE id = ?').run(String(sessionId));
}

export function purgeExpiredSessions() {
  const db = getDb();
  db.prepare("DELETE FROM admin_sessions WHERE expires_at <= datetime('now')").run();
}
