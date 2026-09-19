/**
 * Servidor da campanha "Celular Novo".
 *
 * Serve a API (/api/...) e os arquivos estaticos do frontend.
 * Rodar com: npm start  (ou npm run dev para hot reload)
 */
import path from 'node:path';
import express from 'express';
import config, { ROOT_DIR, configWarnings, resolveWebhookUrl } from './config/env.js';
import { migrate, closeDb } from './database/db.js';
import { purgeExpiredSessions } from './database/repositories/admin.repo.js';
import { reconcilePendingDonations } from './services/donation.service.js';
import apiRoutes from './api/routes/index.js';
import { errorHandler, notFoundHandler } from './api/middleware/errorHandler.js';
import { getGateway } from './gateways/index.js';
import logger from './utils/logger.js';

const FRONTEND_DIR = path.join(ROOT_DIR, 'frontend');

const app = express();

// Atras de proxy (Nginx, Render, Railway...) para o rate limit ver o IP real.
app.set('trust proxy', config.trustProxy);
app.disable('x-powered-by');

// ---------------------------------------------------------------------------
// Cabecalhos de seguranca (sem dependencia extra)
// ---------------------------------------------------------------------------
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "img-src 'self' data: https:",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "script-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ')
  );
  if (config.isProduction) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// Corpo JSON pequeno: nenhuma rota precisa de payload grande.
app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: false, limit: '32kb' }));

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
app.use('/api', apiRoutes);

// ---------------------------------------------------------------------------
// Frontend estatico
// ---------------------------------------------------------------------------
app.use(
  express.static(FRONTEND_DIR, {
    extensions: ['html'],
    maxAge: config.isProduction ? '1h' : 0,
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  })
);

app.get('/admin', (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'admin', 'index.html'));
});

// Qualquer rota nao-API cai na home (links compartilhados continuam abrindo).
// Caminhos com extensao (ex.: /assets/x.js) seguem para o 404 de verdade.
app.use((req, res, next) => {
  const isPage = req.method === 'GET' && !req.path.startsWith('/api') && !path.extname(req.path);
  if (!isPage) {
    next();
    return;
  }
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

app.use(notFoundHandler);
app.use(errorHandler);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
migrate();

const server = app.listen(config.port, () => {
  const gateway = getGateway();

  logger.info(`Servidor no ar em http://localhost:${config.port}`);
  logger.info(`Painel administrativo: http://localhost:${config.port}/admin`);
  logger.info(`Gateway de pagamento: ${gateway.name} (configurado: ${gateway.isConfigured()})`);

  const webhookUrl = resolveWebhookUrl();
  if (webhookUrl) logger.info(`Webhook informado ao gateway: ${webhookUrl}`);

  for (const warning of configWarnings()) logger.warn(warning);
});

/**
 * Rede de seguranca: a cada 2 minutos expira cobrancas vencidas e reconfere
 * pendentes direto na MisticPay. Cobre o caso de um webhook se perder.
 */
const reconcileTimer = setInterval(
  () => {
    reconcilePendingDonations({ limit: 10 })
      .then((result) => {
        if (result.confirmed || result.expired) {
          logger.info('Reconciliacao periodica', result);
        }
      })
      .catch((error) => logger.warn('Reconciliacao falhou', { error: error?.message }));

    purgeExpiredSessions();
  },
  2 * 60 * 1000
);
reconcileTimer.unref();

function shutdown(signal) {
  logger.info(`Recebido ${signal}, encerrando...`);
  clearInterval(reconcileTimer);
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 8000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export default app;
