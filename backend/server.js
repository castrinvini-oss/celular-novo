/**
 * Servidor da campanha "Celular Novo" (modo processo tradicional).
 *
 * Rodar com: npm start  (ou npm run dev para hot reload)
 * Na Vercel o ponto de entrada e api/index.js, que usa o mesmo backend/app.js.
 */
import app from './app.js';
import config, { configWarnings, resolveWebhookUrl } from './config/env.js';
import { migrate, closeDb, isPostgres } from './database/db.js';
import { purgeExpiredSessions, purgeOldLoginAttempts } from './database/repositories/admin.repo.js';
import { reconcilePendingDonations } from './services/donation.service.js';
import { getGateway } from './gateways/index.js';
import { getWebhookToken } from './gateways/misticpay/credentials.js';
import logger from './utils/logger.js';

await migrate();

const server = app.listen(config.port, async () => {
  const gateway = getGateway();

  logger.info(`Servidor no ar em http://localhost:${config.port}`);
  logger.info(`Painel administrativo: http://localhost:${config.port}/admin`);
  logger.info(`Banco de dados: ${isPostgres() ? 'PostgreSQL' : `SQLite (${config.databaseFile})`}`);
  logger.info(
    `Gateway de pagamento: ${gateway.name} (configurado: ${await gateway.isConfigured()})`
  );

  const webhookUrl = resolveWebhookUrl(await getWebhookToken());
  if (webhookUrl) logger.info(`Webhook informado ao gateway: ${webhookUrl}`);

  for (const warning of configWarnings()) logger.warn(warning);
});

/**
 * Rede de seguranca: a cada 2 minutos expira cobrancas vencidas e reconfere
 * pendentes direto na MisticPay. Cobre o caso de um webhook se perder.
 * (Em serverless esta mesma rotina vive em GET /api/cron/reconcile.)
 */
const reconcileTimer = setInterval(
  () => {
    reconcilePendingDonations({ limit: 10 })
      .then((result) => {
        if (result.confirmed || result.expired) logger.info('Reconciliacao periodica', result);
      })
      .catch((error) => logger.warn('Reconciliacao falhou', { error: error?.message }));

    purgeExpiredSessions().catch(() => {});
    purgeOldLoginAttempts(60).catch(() => {});
  },
  2 * 60 * 1000
);
reconcileTimer.unref();

function shutdown(signal) {
  logger.info(`Recebido ${signal}, encerrando...`);
  clearInterval(reconcileTimer);
  server.close(async () => {
    await closeDb();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 8000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export default app;
