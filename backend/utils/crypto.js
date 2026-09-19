/**
 * Criptografia dos segredos guardados no banco.
 *
 * As credenciais da MisticPay podem ser cadastradas pelo painel. Elas NUNCA
 * sao gravadas em texto puro: vao cifradas com AES-256-GCM, usando uma chave
 * derivada do SESSION_SECRET.
 *
 * Consequencia importante: se o SESSION_SECRET mudar, os segredos gravados
 * deixam de ser legiveis e precisam ser cadastrados de novo. Por isso o painel
 * recusa salvar credenciais quando o SESSION_SECRET e efemero (dev).
 */
import crypto from 'node:crypto';
import config from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const SALT = 'celular-novo/gateway-credentials/v1';

let cachedKey = null;

function key() {
  if (!cachedKey) {
    cachedKey = crypto.scryptSync(config.sessionSecret, SALT, 32);
  }
  return cachedKey;
}

/** Texto puro -> "v1.<iv>.<tag>.<dados>" (tudo em base64url). */
export function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    'v1',
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

/** Devolve null quando o valor nao pode ser decifrado (ex.: SESSION_SECRET mudou). */
export function decryptSecret(stored) {
  try {
    const [version, ivB64, tagB64, dataB64] = String(stored).split('.');
    if (version !== 'v1') return null;

    const decipher = crypto.createDecipheriv(ALGORITHM, key(), Buffer.from(ivB64, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));

    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}

/** "sk_1234567890abcdef" -> "sk_123...cdef" (para exibir no painel). */
export function maskSecret(value) {
  if (!value) return '';
  const text = String(value);
  if (text.length <= 10) return '•'.repeat(text.length);
  return `${text.slice(0, 6)}…${text.slice(-4)}`;
}
