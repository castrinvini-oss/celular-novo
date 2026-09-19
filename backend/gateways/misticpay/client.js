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
 * As credenciais vem do .env ou do cadastro cifrado feito no painel
 * (ver credentials.js). Este arquivo roda SOMENTE no backend.
 */
import config from '../../config/env.js';
import logger from '../../utils/logger.js';
import { GatewayError } from '../gateway.interface.js';
import { getMisticpayCredentials } from './credentials.js';

const apiUrl = config.gateway.misticpay.apiUrl;
const timeoutMs = config.gateway.misticpay.timeoutMs;

/** Endpoints usados pela aplicacao (todos vindos da documentacao oficial). */
export const ENDPOINTS = {
  createTransaction: '/api/transactions/create',
  checkTransaction: '/api/transactions/check',
};

export async function hasAccessKey() {
  const { publicKey, secretKey } = await getMisticpayCredentials();
  return Boolean(publicKey && secretKey);
}

export async function hasLegacyCredentials() {
  const { clientId, clientSecret } = await getMisticpayCredentials();
  return Boolean(clientId && clientSecret);
}

export async function isConfigured() {
  return (await hasAccessKey()) || (await hasLegacyCredentials());
}

/**
 * Monta os headers de autenticacao.
 * @param {{ allowLegacy?: boolean }} options
 */
export async function authHeaders({ allowLegacy = false } = {}) {
  const { publicKey, secretKey, clientId, clientSecret } = await getMisticpayCredentials();

  if (publicKey && secretKey) {
    const basic = Buffer.from(`${publicKey}:${secretKey}`).toString('base64');
    return { Authorization: `Basic ${basic}` };
  }

  if (allowLegacy && clientId && clientSecret) {
    // Formato legado: as credenciais vao em headers proprios "ci" e "cs".
    return { ci: clientId, cs: clientSecret };
  }

  throw new GatewayError(
    'Credenciais da MisticPay nao configuradas. Cadastre a chave de acesso (pk_/sk_) no painel, em Integracao, ou defina MISTICPAY_PUBLIC_KEY e MISTICPAY_SECRET_KEY no .env.',
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
  const url = `${apiUrl}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(await authHeaders({ allowLegacy })),
  };

  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
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

    const message = data?.message || data?.error || `MisticPay retornou HTTP ${response.status}.`;

    throw new GatewayError(message, {
      statusCode: response.status === 429 ? 429 : 502,
      details: { httpStatus: response.status },
    });
  }

  return data;
}
