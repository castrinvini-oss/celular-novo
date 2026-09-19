/**
 * Rotas de doacao.
 *
 *   POST /api/donations            -> valida, cria a cobranca Pix e devolve o QR
 *   GET  /api/donations/:id/status -> status real da cobranca (com polling)
 */
import { Router } from 'express';
import {
  createPixDonation,
  toPublicDonation,
  getDonationStatus,
} from '../../services/donation.service.js';
import { getCampaignState } from '../../services/campaign.service.js';
import { createDonationLimiter, statusLimiter } from '../middleware/rateLimit.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

/** IP real do cliente (respeita TRUST_PROXY configurado no app). */
function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || null;
}

router.post(
  '/',
  createDonationLimiter,
  asyncHandler(async (req, res) => {
    const donation = await createPixDonation(req.body ?? {}, { clientIp: clientIp(req) });
    res.status(201).json({
      donation: toPublicDonation(donation),
      campaign: await getCampaignState(),
    });
  })
);

router.get(
  '/:transactionId/status',
  statusLimiter,
  asyncHandler(async (req, res) => {
    res.json(await getDonationStatus(req.params.transactionId));
  })
);

export default router;
