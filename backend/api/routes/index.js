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
import { isPostgres } from '../../database/db.js';

const router = Router();

router.get('/health', (req, res) => {
  res.json({
    ok: true,
    database: isPostgres() ? 'postgres' : 'sqlite',
    time: new Date().toISOString(),
  });
});

router.use('/webhooks', webhookRoutes);
router.use('/cron', cronRoutes);
router.use('/campaign', apiLimiter, campaignRoutes);
router.use('/donations', donationRoutes);
router.use('/admin', adminRoutes);

export default router;
