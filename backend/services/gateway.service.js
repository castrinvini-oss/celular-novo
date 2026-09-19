/**
 * Cadastro e diagnostico das credenciais do gateway pelo painel.
 *
 * O painel nunca recebe o valor real de um segredo - so uma versao mascarada
 * ("sk_1234…cdef") e a informacao de onde ele veio (.env ou painel).
 */
import config, { resolveWebhookUrl, isSessionSecretEphemeral } from '../config/env.js';
import { getGateway } from '../gateways/index.js';
import {
  SECRET_KEYS,
  getMisticpayCredentials,
  invalidateCredentialsCache,
} from '../gateways/misticpay/credentials.js';
import { setSecret, deleteSecret } from '../database/repositories/secrets.repo.js';
import { maskSecret } from '../utils/crypto.js';
import { cleanText } from '../utils/sanitize.js';
import { AppError, ValidationError } from '../utils/errors.js';
import logger from '../utils/logger.js';

/** Campos que o painel pode cadastrar. */
const FIELDS = ['publicKey', 'secretKey', 'clientId', 'clientSecret', 'webhookToken'];

const LABELS = {
  publicKey: 'Chave publica (pk_)',
  secretKey: 'Chave secreta (sk_)',
  clientId: 'Client ID legado (ci_)',
  clientSecret: 'Client Secret legado (cs_)',
  webhookToken: 'Token do webhook',
};

/** Situacao atual da integracao, sem expor segredo nenhum. */
export async function getGatewayStatus() {
  const gateway = getGateway();
  const credentials = await getMisticpayCredentials();

  const fields = FIELDS.map((field) => ({
    field,
    label: LABELS[field],
    filled: Boolean(credentials[field]),
    masked: maskSecret(credentials[field]),
    source: credentials.sources[field],
    // O que veio do ambiente nao pode ser alterado pelo painel.
    editable: credentials.sources[field] !== 'env',
  }));

  return {
    provider: gateway.name,
    apiUrl: config.gateway.misticpay.apiUrl,
    configured: await gateway.isConfigured(),
    usingAccessKey: Boolean(credentials.publicKey && credentials.secretKey),
    usingLegacy:
      Boolean(credentials.clientId && credentials.clientSecret) &&
      !(credentials.publicKey && credentials.secretKey),
    legacySunset: '2026-09-30',
    canStoreSecrets: !isSessionSecretEphemeral(),
    webhookUrl: resolveWebhookUrl(credentials.webhookToken),
    publicBaseUrl: config.publicBaseUrl,
    fields,
  };
}

/**
 * Salva (ou remove) credenciais cadastradas pelo painel.
 * Valor vazio = apagar o que estava guardado.
 */
export async function saveGatewayCredentials(payload, { adminUsername = 'admin' } = {}) {
  if (isSessionSecretEphemeral()) {
    throw new AppError(
      'Defina um SESSION_SECRET fixo no .env antes de guardar credenciais: sem ele, a chave de criptografia muda a cada reinicio e o que for salvo se perde.',
      { statusCode: 409, code: 'EPHEMERAL_SESSION_SECRET' }
    );
  }

  const credentials = await getMisticpayCredentials();
  const saved = [];
  const removed = [];
  const ignored = [];

  for (const field of FIELDS) {
    if (!(field in (payload ?? {}))) continue;

    // O .env tem prioridade: nao adianta cadastrar por cima.
    if (credentials.sources[field] === 'env') {
      ignored.push(field);
      continue;
    }

    const value = cleanText(payload[field], 200).replace(/\s+/g, '');

    if (value === '') {
      await deleteSecret(SECRET_KEYS[field]);
      removed.push(field);
      continue;
    }

    if (value.length < 8) {
      throw new ValidationError(`${LABELS[field]}: valor curto demais para ser uma credencial.`, {
        field,
      });
    }

    await setSecret(SECRET_KEYS[field], value);
    saved.push(field);
  }

  invalidateCredentialsCache();

  logger.info('Credenciais do gateway atualizadas pelo painel', {
    admin: adminUsername,
    saved,
    removed,
    ignored,
  });

  return { saved, removed, ignored, status: await getGatewayStatus() };
}

/** Testa as credenciais atuais contra a API do gateway. */
export async function testGatewayCredentials() {
  const gateway = getGateway();
  if (typeof gateway.testConnection !== 'function') {
    return { ok: await gateway.isConfigured(), message: 'Gateway sem teste automatico.' };
  }
  return gateway.testConnection();
}
