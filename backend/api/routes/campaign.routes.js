/**
 * Rotas publicas da campanha (somente leitura).
 */
import { Router } from 'express';
import {
  getCampaignState,
  getPublicSupporters,
  getHighlight,
} from '../../services/campaign.service.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

/** GET /api/campaign - meta, arrecadado, progresso e textos. */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({
      campaign: getCampaignState(),
      supporters: getPublicSupporters(12),
      highlight: getHighlight(),
    });
  })
);

/** GET /api/campaign/supporters?limit=20 - lista publica de apoiadores. */
router.get(
  '/supporters',
  asyncHandler(async (req, res) => {
    const limit = Number.parseInt(req.query.limit, 10) || 20;
    res.json({ supporters: getPublicSupporters(limit) });
  })
);

export default router;
