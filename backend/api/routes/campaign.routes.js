/**
 * Rotas publicas da campanha (somente leitura).
 */
import { Router } from 'express';
import {
  getCampaignState,
  getPublicSupporters,
  getHighlight,
} from '../../services/campaign.service.js';
import { expireOverdue } from '../../database/repositories/donations.repo.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

/** GET /api/campaign - meta, arrecadado, progresso e textos. */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    // Em serverless nao existe timer de fundo: aproveitamos a leitura mais
    // frequente da pagina para expirar as cobrancas vencidas (1 UPDATE barato).
    await expireOverdue().catch(() => {});

    const [campaign, supporters, highlight] = await Promise.all([
      getCampaignState(),
      getPublicSupporters(12),
      getHighlight(),
    ]);

    res.json({ campaign, supporters, highlight });
  })
);

/** GET /api/campaign/supporters?limit=20 - lista publica de apoiadores. */
router.get(
  '/supporters',
  asyncHandler(async (req, res) => {
    const limit = Number.parseInt(req.query.limit, 10) || 20;
    res.json({ supporters: await getPublicSupporters(limit) });
  })
);

export default router;
