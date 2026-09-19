/**
 * De onde vem as credenciais da MisticPay.
 *
 * Duas origens, nesta ordem de prioridade:
 *   1. variaveis de ambiente (.env, painel da Vercel) - recomendado;
 *   2. cadastro pelo painel /admin, guardado cifrado na tabela secure_settings.
 *
 * Em qualquer um dos casos o segredo vive SOMENTE no backend. O frontend
 * recebe no maximo uma versao mascarada ("sk_123…cdef") e nunca o valor real.
 */
import config from '../../config/env.js';
import { getSecrets } from '../../database/repositories/secrets.repo.js';

/** Chaves usadas na tabela secure_settings. */
export const SECRET_KEYS = {
  publicKey: 'misticpay_public_key',
  secretKey: 'misticpay_secret_key',
  clientId: 'misticpay_client_id',
  clientSecret: 'misticpay_client_secret',
  webhookToken: 'misticpay_webhook_token',
};

/** Cache curto: evita ir ao banco a cada chamada do gateway. */
const CACHE_TTL_MS = 30000;
let cache = null;
let cachedAt = 0;

export function invalidateCredentialsCache() {
  cache = null;
  cachedAt = 0;
}

async function readFromDatabase() {
  if (cache && Date.now() - cachedAt < CACHE_TTL_MS) return cache;

  try {
    const stored = await getSecrets(Object.values(SECRET_KEYS));
    cache = {
      publicKey: stored[SECRET_KEYS.publicKey] ?? '',
      secretKey: stored[SECRET_KEYS.secretKey] ?? '',
      clientId: stored[SECRET_KEYS.clientId] ?? '',
      clientSecret: stored[SECRET_KEYS.clientSecret] ?? '',
      webhookToken: stored[SECRET_KEYS.webhookToken] ?? '',
    };
  } catch {
    // Banco indisponivel ou tabela ainda nao criada: seguimos so com o .env.
    cache = { publicKey: '', secretKey: '', clientId: '', clientSecret: '', webhookToken: '' };
  }

  cachedAt = Date.now();
  return cache;
}

/**
 * Credenciais efetivas + de onde veio cada uma.
 * @returns {Promise<{ publicKey: string, secretKey: string, clientId: string,
 *   clientSecret: string, webhookToken: string, sources: Record<string, 'env'|'painel'|null> }>}
 */
export async function getMisticpayCredentials() {
  const env = config.gateway.misticpay;
  const db = await readFromDatabase();

  const pick = (fromEnv, fromDb) => ({
    value: fromEnv || fromDb || '',
    source: fromEnv ? 'env' : fromDb ? 'painel' : null,
  });

  const publicKey = pick(env.publicKey, db.publicKey);
  const secretKey = pick(env.secretKey, db.secretKey);
  const clientId = pick(env.clientId, db.clientId);
  const clientSecret = pick(env.clientSecret, db.clientSecret);
  const webhookToken = pick(env.webhookToken, db.webhookToken);

  return {
    publicKey: publicKey.value,
    secretKey: secretKey.value,
    clientId: clientId.value,
    clientSecret: clientSecret.value,
    webhookToken: webhookToken.value,
    sources: {
      publicKey: publicKey.source,
      secretKey: secretKey.source,
      clientId: clientId.source,
      clientSecret: clientSecret.source,
      webhookToken: webhookToken.source,
    },
  };
}

export async function getWebhookToken() {
  return (await getMisticpayCredentials()).webhookToken;
}
