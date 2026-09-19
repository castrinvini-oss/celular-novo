/**
 * Rotina de manutencao acionada por HTTP.
 *
 * Em VPS isso roda sozinho num setInterval dentro do server.js. Em serverless
 * (Vercel) nao existe processo vivo entre requisicoes, entao a mesma rotina e
 * chamada por um cron externo:
 *
 *   GET /api/cron/reconcile
 *   Authorization: Bearer <CRON_SECRET>
 *
 * O que ela faz:
 *   1. expira cobrancas Pix vencidas;
 *   2. reconfere as pendentes direto na MisticPay (rede de seguranca caso um
 *      webhook se perca);
 *   3. limpa sessoes e tentativas de login antigas.
 */
import crypto from 'node:crypto';
import { Router } from 'express';
import config from '../../config/env.js';
import { reconcilePendingDonations } from '../../services/donation.service.js';
import {
  purgeExpiredSessions,
  purgeOldLoginAttempts,
} from '../../database/repositories/admin.repo.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { UnauthorizedError } from '../../utils/errors.js';
import logger from '../../utils/logger.js';

const router = Router();

function safeEquals(a, b) {
  const bufferA = Buffer.from(String(a ?? ''));
  const bufferB = Buffer.from(String(b ?? ''));
  if (bufferA.length !== bufferB.length) return false;
  return crypto.timingSafeEqual(bufferA, bufferB);
}

function authorized(req) {
  const expected = config.cronSecret;
  if (!expected) return false; // sem segredo configurado, a rota fica fechada

  const header = req.get('authorization') ?? '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  return safeEquals(bearer, expected) || safeEquals(req.query.secret, expected);
}

async function handler(req, res) {
  if (!authorized(req)) {
    throw new UnauthorizedError('Cron nao autorizado.');
  }

  const result = await reconcilePendingDonations({ limit: 25 });
  await purgeExpiredSessions();
  await purgeOldLoginAttempts(60);

  logger.info('Cron de reconciliacao executado', result);
  res.json({ ok: true, ...result });
}

router.get('/reconcile', asyncHandler(handler));
router.post('/reconcile', asyncHandler(handler));

export default router;
