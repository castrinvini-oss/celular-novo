/**
 * Diagnostico da integracao com a MisticPay.
 *
 * Uso: npm run check-gateway
 *
 * Mostra o que esta configurado (sem imprimir segredo nenhum) e, opcionalmente,
 * consulta uma transacao real:  npm run check-gateway -- 31484480
 */
import config, { resolveWebhookUrl } from '../backend/config/env.js';
import { getGateway } from '../backend/gateways/index.js';
import { hasAccessKey, hasLegacyCredentials } from '../backend/gateways/misticpay/client.js';

function mask(value) {
  if (!value) return '(vazio)';
  if (value.length <= 8) return '***';
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

const mp = config.gateway.misticpay;

console.log('--- Configuracao do gateway ---');
console.log(`Provedor.................: ${config.gateway.provider}`);
console.log(`API......................: ${mp.apiUrl}`);
console.log(`Chave de acesso (pk/sk)..: ${hasAccessKey() ? 'sim' : 'nao'}  ${mask(mp.publicKey)}`);
console.log(`Credencial legada (ci/cs): ${hasLegacyCredentials() ? 'sim' : 'nao'}`);
console.log(`Webhook URL..............: ${resolveWebhookUrl() || '(nao configurada)'}`);
console.log(`Webhook token............: ${mp.webhookToken ? 'definido' : '(vazio)'}`);
console.log(`Meta inicial.............: R$ ${(config.campaign.goalCents / 100).toFixed(2)}`);
console.log(
  `Limites por doacao.......: R$ ${(config.campaign.minCents / 100).toFixed(2)} a R$ ${(
    config.campaign.maxCents / 100
  ).toFixed(2)}`
);

if (hasLegacyCredentials() && !hasAccessKey()) {
  console.log(
    '\nATENCAO: a autenticacao ci/cs sera desligada em 30/09/2026. Crie uma chave de acesso (pk_/sk_) no painel da MisticPay.'
  );
}

const transactionId = process.argv[2];
if (transactionId) {
  console.log(`\n--- Consultando transacao ${transactionId} ---`);
  try {
    const result = await getGateway().checkTransaction(transactionId);
    console.log(`Status normalizado: ${result.status}`);
    console.log(`Valor (centavos)..: ${result.amountCents ?? '(nao informado)'}`);
  } catch (error) {
    console.error(`Falhou: ${error.message}`);
    process.exitCode = 1;
  }
} else if (!getGateway().isConfigured()) {
  console.log('\nNenhuma credencial configurada: preencha o .env antes de gerar cobrancas.');
}
