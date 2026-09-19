/**
 * Agregador das rotas da API.
 *
 *   /api/campaign   -> dados publicos da campanha
 *   /api/donations  -> criacao e status das doacoes
 *   /api/admin      -> painel administrativo
 *   /api/webhooks   -> notificacoes do gateway
 *   /api/cron       -> manutencao (usado em serverless)
 */
import { Router } from 'express';
import campaignRoutes from './campaign.routes.js';
import donationRoutes from './donations.routes.js';
import adminRoutes from './admin.routes.js';
import cronRoutes from './cron.routes.js';
import webhookRoutes from '../../webhooks/misticpay.webhook.js';
import { apiLimiter } from '../middleware/rateLimit.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { isPostgres, query } from '../../database/db.js';

const router = Router();

/**
 * Healthcheck: usado para conferir o deploy.
 *
 * Nao responde "ok" sem antes tocar no banco - assim ele pega os erros mais
 * comuns de producao (URL errada, senha errada, tabelas nao criadas) em vez de
 * fingir que esta tudo bem.
 */
router.get(
  '/health',
  asyncHandler(async (req, res) => {
    let database = 'desconhecido';
    let databaseOk = false;
    let databaseError = null;

    try {
      await query('SELECT 1');
      database = isPostgres() ? 'postgres' : 'sqlite';
      databaseOk = true;
    } catch (error) {
      database = isPostgres() ? 'postgres' : 'sqlite';
      databaseError = error?.message ?? 'falha ao conectar';
    }

    res.status(databaseOk ? 200 : 503).json({
      ok: databaseOk,
      database,
      ...(databaseError ? { databaseError } : {}),
      time: new Date().toISOString(),
    });
  })
);

router.use('/webhooks', webhookRoutes);
router.use('/cron', cronRoutes);
router.use('/campaign', apiLimiter, campaignRoutes);
router.use('/donations', donationRoutes);
router.use('/admin', adminRoutes);

export default router;
