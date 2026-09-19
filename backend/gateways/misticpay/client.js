/**
 * Cliente HTTP da MisticPay.
 *
 * Documentacao oficial: https://docs.misticpay.com/
 *
 * Autenticacao (conforme a documentacao atual):
 *  1. Chave de acesso (recomendada) - par pk_.../sk_... enviado no header
 *     "Authorization: Basic base64(pk:sk)". Alcanca todos os endpoints.
 *  2. Credencial legada ci/cs - headers "ci" e "cs". Funciona apenas em
 *     /api/transactions/create e /api/transactions/check e sera desligada
 *     em 30/09/2026.
 *
 * Este arquivo roda SOMENTE no backend. As credenciais nunca saem daqui.
 */
import config from '../../config/env.js';
import logger from '../../utils/logger.js';
import { GatewayError } from '../gateway.interface.js';

const mp = config.gateway.misticpay;

/** Endpoints usados pela aplicacao (todos vindos da documentacao oficial). */
export const ENDPOINTS = {
  createTransaction: '/api/transactions/create',
  checkTransaction: '/api/transactions/check',
};

export function hasAccessKey() {
  return Boolean(mp.publicKey && mp.secretKey);
}

export function hasLegacyCredentials() {
  return Boolean(mp.clientId && mp.clientSecret);
}

export function isConfigured() {
  return hasAccessKey() || hasLegacyCredentials();
}

/**
 * Monta os headers de autenticacao.
 * @param {{ allowLegacy?: boolean }} options
 */
export function authHeaders({ allowLegacy = false } = {}) {
  if (hasAccessKey()) {
    const basic = Buffer.from(`${mp.publicKey}:${mp.secretKey}`).toString('base64');
    return { Authorization: `Basic ${basic}` };
  }

  if (allowLegacy && hasLegacyCredentials()) {
    // Formato legado: as credenciais vao em headers proprios "ci" e "cs".
    return { ci: mp.clientId, cs: mp.clientSecret };
  }

  throw new GatewayError(
    'Credenciais da MisticPay nao configuradas. Defina MISTICPAY_PUBLIC_KEY e MISTICPAY_SECRET_KEY no .env.',
    { statusCode: 503 }
  );
}

/** Remove qualquer dado sensivel antes de registrar em log. */
function safeForLog(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const clone = { ...payload };
  for (const key of ['payerDocument', 'clientDocument', 'document', 'cpf']) {
    if (clone[key]) clone[key] = '***';
  }
  return clone;
}

/**
 * Executa uma requisicao na API da MisticPay.
 * @param {string} endpoint
 * @param {{ method?: string, body?: Object, allowLegacy?: boolean }} options
 */
export async function request(endpoint, { method = 'POST', body = null, allowLegacy = false } = {}) {
  const url = `${mp.apiUrl}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...authHeaders({ allowLegacy }),
  };

  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(mp.timeoutMs),
    });
  } catch (error) {
    logger.error('Falha de rede ao chamar a MisticPay', {
      endpoint,
      error: error?.message,
    });
    throw new GatewayError('Nao foi possivel falar com a MisticPay. Tente novamente em instantes.', {
      statusCode: 504,
      cause: error,
    });
  }

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text?.slice(0, 500) };
  }

  if (!response.ok) {
    logger.warn('MisticPay respondeu com erro', {
      endpoint,
      status: response.status,
      body: safeForLog(data),
    });

    const message =
      data?.message || data?.error || `MisticPay retornou HTTP ${response.status}.`;

    throw new GatewayError(message, {
      statusCode: response.status === 429 ? 429 : 502,
      details: { httpStatus: response.status },
    });
  }

  return data;
}
