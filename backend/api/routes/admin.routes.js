/**
 * Rotas do painel administrativo (/admin).
 *
 * Tudo abaixo de /api/admin exige sessao valida, com excecao do login.
 */
import { Router } from 'express';
import {
  findAdminByUsername,
  verifyPassword,
  createSession,
  destroySession,
  touchLogin,
  updateAdminPassword,
  countAdmins,
  countLoginAttempts,
  recordLoginAttempt,
  clearLoginAttempts,
} from '../../database/repositories/admin.repo.js';
import { listForAdmin, getTotalsBySource } from '../../database/repositories/donations.repo.js';
import { getAllSettings } from '../../database/repositories/settings.repo.js';
import { getAdminOverview, updateCampaignSettings } from '../../services/campaign.service.js';
import {
  getDonationStatus,
  reconcilePendingDonations,
  registerManualDonation,
  removeManualDonation,
} from '../../services/donation.service.js';
import {
  getGatewayStatus,
  saveGatewayCredentials,
  testGatewayCredentials,
} from '../../services/gateway.service.js';
import {
  requireAdmin,
  readSessionId,
  setSessionCookie,
  clearSessionCookie,
  sessionTtlHours,
} from '../middleware/auth.js';
import { loginLimiter } from '../middleware/rateLimit.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { AppError, TooManyRequestsError, UnauthorizedError, ValidationError } from '../../utils/errors.js';
import { cleanText } from '../../utils/sanitize.js';
import logger from '../../utils/logger.js';

const router = Router();
const VALID_STATUSES = ['ALL', 'PENDING', 'PAID', 'EXPIRED', 'CANCELLED', 'FAILED'];

/** Teto de tentativas de login por IP em 15 minutos (gravado no banco). */
const MAX_LOGIN_ATTEMPTS = 10;

/** POST /api/admin/login */
router.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const username = cleanText(req.body?.username, 60).toLowerCase();
    const password = String(req.body?.password ?? '');
    const ip = req.ip ?? '';

    if (!username || !password) {
      throw new ValidationError('Informe usuario e senha.');
    }

    // Rate limit persistente: o limitador em memoria nao sobrevive a serverless.
    if ((await countLoginAttempts(ip, 15)) >= MAX_LOGIN_ATTEMPTS) {
      throw new TooManyRequestsError(
        'Muitas tentativas de login. Tente novamente em alguns minutos.'
      );
    }

    if ((await countAdmins()) === 0) {
      throw new AppError(
        'Nenhum administrador cadastrado. Rode "npm run create-admin" no servidor.',
        { statusCode: 503, code: 'NO_ADMIN' }
      );
    }

    const admin = await findAdminByUsername(username);
    // Mensagem identica para usuario inexistente e senha errada (evita
    // descobrir quais usuarios existem).
    if (!admin || !verifyPassword(password, admin.password_hash)) {
      await recordLoginAttempt(ip, username);
      logger.warn('Tentativa de login invalida', { ip });
      throw new UnauthorizedError('Usuario ou senha incorretos.');
    }

    const sessionId = await createSession(admin.id, sessionTtlHours());
    await touchLogin(admin.id);
    await clearLoginAttempts(ip);
    setSessionCookie(res, sessionId);

    res.json({ ok: true, admin: { username: admin.username } });
  })
);

/** POST /api/admin/logout */
router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const sessionId = readSessionId(req);
    if (sessionId) await destroySession(sessionId);
    clearSessionCookie(res);
    res.json({ ok: true });
  })
);

// ---------------------------------------------------------------------------
// Daqui para baixo: exige autenticacao
// ---------------------------------------------------------------------------
router.use(requireAdmin);

/** GET /api/admin/me */
router.get('/me', (req, res) => {
  res.json({ admin: { username: req.admin.username } });
});

/** GET /api/admin/overview - numeros do dashboard. */
router.get(
  '/overview',
  asyncHandler(async (req, res) => {
    const [overview, bySource] = await Promise.all([getAdminOverview(), getTotalsBySource()]);
    res.json({ ...overview, bySource });
  })
);

/** GET /api/admin/donations?status=PAID&page=1&search= */
router.get(
  '/donations',
  asyncHandler(async (req, res) => {
    const status = String(req.query.status ?? 'ALL').toUpperCase();
    if (!VALID_STATUSES.includes(status)) {
      throw new ValidationError('Filtro de status invalido.');
    }

    res.json(
      await listForAdmin({
        status,
        page: req.query.page,
        perPage: req.query.perPage,
        search: cleanText(req.query.search, 60),
      })
    );
  })
);

/** GET /api/admin/donations.csv - exportacao simples. */
router.get(
  '/donations.csv',
  asyncHandler(async (req, res) => {
    const status = String(req.query.status ?? 'ALL').toUpperCase();
    const { items } = await listForAdmin({
      status: VALID_STATUSES.includes(status) ? status : 'ALL',
      page: 1,
      perPage: 200,
    });

    const header =
      'id;nome_publico;nome_pagador;valor_centavos;status;transaction_id;criado_em;pago_em';
    const escape = (value) => String(value ?? '').replace(/[;\n\r"]/g, ' ');
    const lines = items.map((item) =>
      [
        item.id,
        escape(item.name),
        escape(item.payer_name),
        item.amount,
        item.status,
        escape(item.transaction_id),
        item.created_at,
        item.paid_at ?? '',
      ].join(';')
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="doacoes.csv"');
    res.send([header, ...lines].join('\n'));
  })
);

/** POST /api/admin/donations/:transactionId/recheck - reconsulta o gateway. */
router.post(
  '/donations/:transactionId/recheck',
  asyncHandler(async (req, res) => {
    res.json(await getDonationStatus(req.params.transactionId, { force: true }));
  })
);

/** POST /api/admin/reconcile - varre pendentes e expira vencidas. */
router.post(
  '/reconcile',
  asyncHandler(async (req, res) => {
    res.json(await reconcilePendingDonations({ limit: 25 }));
  })
);

/**
 * POST /api/admin/donations/manual
 * Registra uma doacao recebida fora da plataforma (Pix direto, dinheiro...).
 */
router.post(
  '/donations/manual',
  asyncHandler(async (req, res) => {
    const donation = await registerManualDonation(req.body ?? {}, {
      adminUsername: req.admin.username,
    });
    const [overview, bySource] = await Promise.all([getAdminOverview(), getTotalsBySource()]);
    res.status(201).json({ ok: true, donation, ...overview, bySource });
  })
);

/** DELETE /api/admin/donations/:transactionId - apenas lancamentos manuais. */
router.delete(
  '/donations/:transactionId',
  asyncHandler(async (req, res) => {
    await removeManualDonation(req.params.transactionId, { adminUsername: req.admin.username });
    res.json({ ok: true });
  })
);

/* ------------------------------------------------- Integracao (gateway) */

/** GET /api/admin/gateway - situacao da integracao (sem expor segredo). */
router.get(
  '/gateway',
  asyncHandler(async (req, res) => {
    res.json(await getGatewayStatus());
  })
);

/** PUT /api/admin/gateway - cadastra/remove credenciais pelo painel. */
router.put(
  '/gateway',
  asyncHandler(async (req, res) => {
    const result = await saveGatewayCredentials(req.body ?? {}, {
      adminUsername: req.admin.username,
    });
    res.json({ ok: true, ...result });
  })
);

/** POST /api/admin/gateway/test - valida as credenciais na API da MisticPay. */
router.post(
  '/gateway/test',
  asyncHandler(async (req, res) => {
    res.json(await testGatewayCredentials());
  })
);

/** GET /api/admin/settings */
router.get(
  '/settings',
  asyncHandler(async (req, res) => {
    res.json({ settings: await getAllSettings() });
  })
);

/** PUT /api/admin/settings - altera meta, textos, imagem e valores rapidos. */
router.put(
  '/settings',
  asyncHandler(async (req, res) => {
    const result = await updateCampaignSettings(req.body ?? {});
    if (!result.updated.length) {
      throw new ValidationError('Nenhum campo valido foi enviado.', result);
    }
    logger.info('Configuracoes da campanha alteradas', {
      admin: req.admin.username,
      fields: result.updated,
    });
    res.json({ ok: true, ...result, settings: await getAllSettings() });
  })
);

/** POST /api/admin/password - troca a propria senha. */
router.post(
  '/password',
  asyncHandler(async (req, res) => {
    const currentPassword = String(req.body?.currentPassword ?? '');
    const newPassword = String(req.body?.newPassword ?? '');

    if (newPassword.length < 8) {
      throw new ValidationError('A nova senha precisa ter pelo menos 8 caracteres.');
    }

    const admin = await findAdminByUsername(req.admin.username);
    if (!admin || !verifyPassword(currentPassword, admin.password_hash)) {
      throw new UnauthorizedError('Senha atual incorreta.');
    }

    await updateAdminPassword(admin.id, newPassword);
    res.json({ ok: true });
  })
);

export default router;
