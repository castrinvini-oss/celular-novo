/**
 * Autenticacao do painel administrativo.
 *
 * Sessao em cookie HttpOnly assinado com HMAC-SHA256. O id da sessao tambem
 * existe no banco (admin_sessions), entao e possivel revogar no logout e as
 * sessoes expiram sozinhas. Nada de JWT no localStorage.
 */
import crypto from 'node:crypto';
import config from '../../config/env.js';
import { findSession } from '../../database/repositories/admin.repo.js';
import { UnauthorizedError } from '../../utils/errors.js';

export const COOKIE_NAME = 'campanha_admin';
const SESSION_TTL_HOURS = 12;

export function sessionTtlHours() {
  return SESSION_TTL_HOURS;
}

function sign(value) {
  return crypto.createHmac('sha256', config.sessionSecret).update(value).digest('base64url');
}

/** Le os cookies do request (o Express 5 nao traz parser embutido). */
export function parseCookies(req) {
  const header = req.headers?.cookie;
  if (!header) return {};
  const cookies = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) cookies[name] = decodeURIComponent(value);
  }
  return cookies;
}

export function setSessionCookie(res, sessionId) {
  const value = `${sessionId}.${sign(sessionId)}`;
  res.cookie(COOKIE_NAME, value, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.isProduction,
    path: '/',
    maxAge: SESSION_TTL_HOURS * 60 * 60 * 1000,
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.isProduction,
    path: '/',
  });
}

/** Valida a assinatura e devolve o id da sessao, ou null. */
export function readSessionId(req) {
  const raw = parseCookies(req)[COOKIE_NAME];
  if (!raw) return null;

  const separator = raw.lastIndexOf('.');
  if (separator <= 0) return null;

  const sessionId = raw.slice(0, separator);
  const signature = raw.slice(separator + 1);
  const expected = sign(sessionId);

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  return sessionId;
}

/** Middleware: exige um administrador autenticado. */
export function requireAdmin(req, res, next) {
  const sessionId = readSessionId(req);
  const session = sessionId ? findSession(sessionId) : null;

  if (!session) {
    next(new UnauthorizedError('Sessao expirada ou invalida. Faca login novamente.'));
    return;
  }

  req.admin = { id: session.admin_id, username: session.username, sessionId };
  next();
}

/** Middleware: apenas anexa o admin, sem bloquear. */
export function attachAdmin(req, res, next) {
  const sessionId = readSessionId(req);
  const session = sessionId ? findSession(sessionId) : null;
  if (session) req.admin = { id: session.admin_id, username: session.username, sessionId };
  next();
}
