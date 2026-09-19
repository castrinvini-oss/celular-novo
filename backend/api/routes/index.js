/**
 * Agregador das rotas da API.
 *
 *   /api/campaign   -> dados publicos da campanha
 *   /api/donations  -> criacao e status das doacoes
 *   /api/admin      -> painel administrativo
 *   /api/webhooks   -> notificacoes do gateway
 */
import { Router } from 'express';
import campaignRoutes from './campaign.routes.js';
import donationRoutes from './donations.routes.js';
import adminRoutes from './admin.routes.js';
import webhookRoutes from '../../webhooks/misticpay.webhook.js';
import { apiLimiter } from '../middleware/rateLimit.js';

const router = Router();

router.get('/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

router.use('/webhooks', webhookRoutes);
router.use('/campaign', apiLimiter, campaignRoutes);
router.use('/donations', donationRoutes);
router.use('/admin', adminRoutes);

export default router;
