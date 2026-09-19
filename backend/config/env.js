/**
 * Leitura e normalizacao das variaveis de ambiente.
 *
 * Tudo que envolve credencial fica isolado aqui e NUNCA e enviado ao frontend.
 * O arquivo .env e carregado pelo proprio Node (--env-file-if-exists=.env,
 * definido nos scripts do package.json).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(here, '..', '..');

function str(name, fallback = '') {
  const value = process.env[name];
  return value === undefined || value === null ? fallback : String(value).trim();
}

function num(name, fallback) {
  const raw = str(name);
  if (raw === '') return fallback;
  const parsed = Number(raw.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function int(name, fallback) {
  return Math.trunc(num(name, fallback));
}

/**
 * Ignora valores que sao claramente o exemplo do .env.example.
 *
 * Sem isso, quem copia o arquivo e esquece de preencher acha que esta
 * configurado e so descobre o contrario quando a MisticPay devolve 401.
 */
function secret(name) {
  const value = str(name);
  const looksLikePlaceholder =
    /^(pk|sk|ci|cs)_x+$/i.test(value) ||
    /x{6,}/i.test(value) ||
    value.startsWith('troque-este') ||
    value.startsWith('seu_') ||
    value.startsWith('sua_');

  return looksLikePlaceholder ? '' : value;
}

const NODE_ENV = str('NODE_ENV', 'development');
const isProduction = NODE_ENV === 'production';

/** Segredo de sessao: em dev geramos um efemero para nao travar o primeiro run. */
let sessionSecretIsEphemeral = false;

function resolveSessionSecret() {
  const value = str('SESSION_SECRET');
  const isPlaceholder = value === '' || value.startsWith('troque-este') || value.length < 24;

  if (!isPlaceholder) return value;

  if (isProduction) {
    throw new Error(
      'SESSION_SECRET ausente ou fraco. Defina um valor aleatorio com pelo menos 24 caracteres antes de subir em producao.'
    );
  }

  // Sem SESSION_SECRET fixo nao da para guardar credenciais cifradas: a chave
  // muda a cada boot e o que foi salvo antes vira lixo.
  sessionSecretIsEphemeral = true;
  return crypto.randomBytes(48).toString('hex');
}

const config = {
  nodeEnv: NODE_ENV,
  isProduction,
  port: int('PORT', 3000),
  publicBaseUrl: str('PUBLIC_BASE_URL', `http://localhost:${int('PORT', 3000)}`).replace(/\/+$/, ''),
  trustProxy: int('TRUST_PROXY', 0),
  sessionSecret: resolveSessionSecret(),
  databaseFile: path.isAbsolute(str('DATABASE_FILE', ''))
    ? str('DATABASE_FILE')
    : path.resolve(ROOT_DIR, str('DATABASE_FILE', './data/campanha.db')),

  /**
   * Quando DATABASE_URL existe, o projeto usa Postgres (Supabase, Neon...).
   * Sem ela, usa SQLite no arquivo acima.
   */
  databaseUrl: str('DATABASE_URL'),
  databaseSsl: str('DATABASE_SSL', 'true') !== 'false',
  databasePoolMax: int('DATABASE_POOL_MAX', 3),

  /** Segredo do cron de reconciliacao (usado em serverless). */
  cronSecret: secret('CRON_SECRET'),

  campaign: {
    /** Meta inicial da campanha, em centavos. Pode ser alterada no /admin. */
    goalCents: Math.round(num('CAMPAIGN_GOAL', 2000) * 100),
    minCents: Math.round(num('DONATION_MIN', 1) * 100),
    maxCents: Math.round(num('DONATION_MAX', 1000) * 100),
    pixExpirationMinutes: int('PIX_EXPIRATION_MINUTES', 30),
  },

  gateway: {
    /** Permite trocar de gateway sem reescrever a aplicacao. */
    provider: str('PAYMENT_GATEWAY', 'misticpay').toLowerCase(),
    misticpay: {
      apiUrl: str('MISTICPAY_API_URL', 'https://api.misticpay.com').replace(/\/+$/, ''),
      publicKey: secret('MISTICPAY_PUBLIC_KEY'),
      secretKey: secret('MISTICPAY_SECRET_KEY'),
      clientId: secret('MISTICPAY_CLIENT_ID'),
      clientSecret: secret('MISTICPAY_CLIENT_SECRET'),
      webhookUrl: str('MISTICPAY_WEBHOOK_URL'),
      webhookToken: secret('MISTICPAY_WEBHOOK_TOKEN'),
      timeoutMs: int('MISTICPAY_TIMEOUT_MS', 20000),
    },
  },
};

/** true quando o SESSION_SECRET foi gerado na hora (so acontece em dev). */
export function isSessionSecretEphemeral() {
  return sessionSecretIsEphemeral;
}

/**
 * URL do webhook efetivamente enviada ao gateway.
 * @param {string} [token] token atual (pode vir do cadastro feito no painel)
 */
export function resolveWebhookUrl(token = config.gateway.misticpay.webhookToken) {
  const explicit = config.gateway.misticpay.webhookUrl;
  if (explicit) return explicit;
  if (!config.publicBaseUrl || config.publicBaseUrl.includes('localhost')) {
    // localhost nao e acessivel pela MisticPay: melhor nao mandar nada.
    return '';
  }
  return token
    ? `${config.publicBaseUrl}/api/webhooks/misticpay/${encodeURIComponent(token)}`
    : `${config.publicBaseUrl}/api/webhooks/misticpay`;
}

/** Avisos de configuracao exibidos no boot (sem vazar segredo algum). */
export function configWarnings() {
  const warnings = [];
  const mp = config.gateway.misticpay;
  const hasAccessKey = Boolean(mp.publicKey && mp.secretKey);
  const hasLegacy = Boolean(mp.clientId && mp.clientSecret);

  if (!hasAccessKey && !hasLegacy) {
    warnings.push(
      'MisticPay sem credenciais no .env. Cadastre a chave de acesso em /admin -> Integracao, ou defina MISTICPAY_PUBLIC_KEY + MISTICPAY_SECRET_KEY.'
    );
  } else if (!hasAccessKey && hasLegacy) {
    warnings.push(
      'Usando credencial legada ci/cs da MisticPay. Ela sera desligada em 30/09/2026 - migre para a chave de acesso (pk_/sk_).'
    );
  }

  if (!mp.webhookToken || mp.webhookToken.startsWith('troque-este')) {
    warnings.push(
      'MISTICPAY_WEBHOOK_TOKEN nao esta no .env (pode estar cadastrado no painel). Sem token, o endpoint de webhook fica sem essa camada de protecao.'
    );
  }

  if (!resolveWebhookUrl()) {
    warnings.push(
      'Webhook sem URL publica: as doacoes serao confirmadas apenas pela consulta ativa a MisticPay (polling).'
    );
  }

  if (config.isProduction && !config.publicBaseUrl.startsWith('https://')) {
    warnings.push('PUBLIC_BASE_URL deveria usar HTTPS em producao.');
  }

  return warnings;
}

export default config;
