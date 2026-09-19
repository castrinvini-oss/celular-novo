/**
 * Repositorio de administradores, sessoes e tentativas de login.
 *
 * As senhas sao guardadas com scrypt (modulo crypto do proprio Node), em
 * formato "scrypt$N$r$p$salt$hash". Nenhuma senha em texto puro e persistida.
 */
import crypto from 'node:crypto';
import { all, one, run, sql } from '../db.js';

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

export async function countAdmins() {
  const result = await one('SELECT COUNT(*) AS total FROM admins');
  return Number(result?.total ?? 0);
}

export async function findAdminByUsername(username) {
  return one('SELECT * FROM admins WHERE username = ?', [String(username).toLowerCase()]);
}

export async function createAdmin(username, password) {
  await run('INSERT INTO admins (username, password_hash) VALUES (?, ?)', [
    String(username).toLowerCase(),
    hashPassword(password),
  ]);
  return findAdminByUsername(username);
}

export async function updateAdminPassword(adminId, password) {
  await run('UPDATE admins SET password_hash = ? WHERE id = ?', [hashPassword(password), adminId]);
}

export async function touchLogin(adminId) {
  const s = await sql();
  await run(`UPDATE admins SET last_login_at = ${s.now} WHERE id = ?`, [adminId]);
}

/* ------------------------------------------------------------- Sessoes */

/** Cria uma sessao e devolve o id (que vai assinado no cookie). */
export async function createSession(adminId, ttlHours = 12) {
  const s = await sql();
  const id = crypto.randomBytes(32).toString('hex');
  await run(
    `INSERT INTO admin_sessions (id, admin_id, expires_at)
     VALUES (?, ?, ${s.nowPlusMinutes(Math.max(1, Number(ttlHours) || 12) * 60)})`,
    [id, adminId]
  );
  return id;
}

export async function findSession(sessionId) {
  if (!sessionId) return null;
  const s = await sql();
  return one(
    `SELECT ses.id, ses.admin_id, ses.expires_at, a.username
       FROM admin_sessions ses
       JOIN admins a ON a.id = ses.admin_id
      WHERE ses.id = ? AND ses.expires_at > ${s.now}`,
    [String(sessionId)]
  );
}

export async function destroySession(sessionId) {
  if (!sessionId) return;
  await run('DELETE FROM admin_sessions WHERE id = ?', [String(sessionId)]);
}

export async function purgeExpiredSessions() {
  const s = await sql();
  await run(`DELETE FROM admin_sessions WHERE expires_at <= ${s.now}`);
}

/* -------------------------------------------------- Tentativas de login */

/**
 * Contador de tentativas por IP gravado no banco.
 *
 * Em serverless cada invocacao tem memoria propria, entao um rate limit em
 * memoria nao protege de forca bruta. Este aqui protege.
 */
export async function countLoginAttempts(ip, minutes = 15) {
  const s = await sql();
  const result = await one(
    `SELECT COUNT(*) AS total
       FROM login_attempts
      WHERE ip = ? AND created_at > ${s.nowMinusMinutes(minutes)}`,
    [String(ip ?? '')]
  );
  return Number(result?.total ?? 0);
}

export async function recordLoginAttempt(ip, username) {
  await run('INSERT INTO login_attempts (ip, username) VALUES (?, ?)', [
    String(ip ?? ''),
    username ? String(username).slice(0, 60) : null,
  ]);
}

export async function clearLoginAttempts(ip) {
  await run('DELETE FROM login_attempts WHERE ip = ?', [String(ip ?? '')]);
}

/** Limpeza das tentativas antigas (chamada pelo cron/reconciliacao). */
export async function purgeOldLoginAttempts(minutes = 60) {
  const s = await sql();
  await run(`DELETE FROM login_attempts WHERE created_at <= ${s.nowMinusMinutes(minutes)}`);
}
