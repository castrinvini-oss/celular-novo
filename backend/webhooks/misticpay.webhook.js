/**
 * Webhook da MisticPay.
 *
 *   POST /api/webhooks/misticpay
 *   POST /api/webhooks/misticpay/:token
 *
 * A documentacao da MisticPay nao prevê assinatura criptografica nos webhooks.
 * Por isso a seguranca aqui tem duas camadas:
 *
 *  1. Token secreto na propria URL (MISTICPAY_WEBHOOK_TOKEN), comparado em
 *     tempo constante. Tambem aceito via header "x-webhook-token".
 *  2. RECONFERENCIA OBRIGATORIA: o corpo do webhook nunca confirma pagamento
 *     sozinho. Ele so indica qual transacao olhar - o status verdadeiro vem de
 *     POST /api/transactions/check na propria MisticPay.
 *
 * Consequencia: mesmo que alguem descubra a URL e poste um payload falso,
 * nenhum centavo entra no total da campanha.
 */
import crypto from 'node:crypto';
import { Router } from 'express';
import { getWebhookToken } from '../gateways/misticpay/credentials.js';
import { processWebhookEvent } from '../services/donation.service.js';
import { webhookLimiter } from '../api/middleware/rateLimit.js';
import { asyncHandler } from '../api/middleware/errorHandler.js';
import logger from '../utils/logger.js';

const router = Router();

function safeEquals(a, b) {
  const bufferA = Buffer.from(String(a ?? ''));
  const bufferB = Buffer.from(String(b ?? ''));
  if (bufferA.length !== bufferB.length) return false;
  return crypto.timingSafeEqual(bufferA, bufferB);
}

async function tokenIsValid(req) {
  const expected = await getWebhookToken();
  if (!expected) return true; // sem token configurado, nao ha o que validar

  const received = req.params.token || req.get('x-webhook-token') || req.query.token || '';
  return safeEquals(received, expected);
}

async function handleWebhook(req, res) {
  if (!(await tokenIsValid(req))) {
    logger.warn('Webhook recusado: token invalido', { ip: req.ip });
    res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Token invalido.' } });
    return;
  }

  const result = await processWebhookEvent(req.body);

  // Sempre 200 para eventos legitimos: assim o gateway nao fica reenviando
  // indefinidamente uma notificacao que ja registramos.
  res.status(200).json({ received: true, ...result });
}

router.post('/misticpay', webhookLimiter, asyncHandler(handleWebhook));
router.post('/misticpay/:token', webhookLimiter, asyncHandler(handleWebhook));

export default router;
