/**
 * Rate limiting.
 *
 * Camada de protecao contra spam e forca bruta. Vale para todos os
 * endpoints publicos; a criacao de Pix e o login do painel tem limites
 * bem mais rigidos.
 */
import rateLimit from 'express-rate-limit';

function jsonHandler(message) {
  return (req, res) => {
    res.status(429).json({ error: { code: 'TOO_MANY_REQUESTS', message } });
  };
}

const base = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
};

/** Limite geral da API publica. */
export const apiLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  limit: 120,
  handler: jsonHandler('Muitas requisicoes. Aguarde um instante e tente de novo.'),
});

/** Criacao de cobranca Pix: caro para nos e para o gateway. */
export const createDonationLimiter = rateLimit({
  ...base,
  windowMs: 10 * 60 * 1000,
  limit: 10,
  handler: jsonHandler('Voce gerou muitos Pix seguidos. Aguarde alguns minutos.'),
});

/** Consulta de status: o frontend faz polling, entao o limite e mais folgado. */
export const statusLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  limit: 90,
  handler: jsonHandler('Consultas demais. Aguarde alguns segundos.'),
});

/** Login do painel: trava forca bruta. */
export const loginLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 8,
  skipSuccessfulRequests: true,
  handler: jsonHandler('Muitas tentativas de login. Tente novamente em 15 minutos.'),
});

/** Webhook: alto o suficiente para o gateway, baixo para um atacante. */
export const webhookLimiter = rateLimit({
  ...base,
  windowMs: 60 * 1000,
  limit: 240,
  handler: jsonHandler('Rate limit.'),
});
