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
} from '../../database/repositories/admin.repo.js';
import { listForAdmin } from '../../database/repositories/donations.repo.js';
import { getAllSettings } from '../../database/repositories/settings.repo.js';
import { getAdminOverview, updateCampaignSettings } from '../../services/campaign.service.js';
import { getDonationStatus, reconcilePendingDonations } from '../../services/donation.service.js';
import {
  requireAdmin,
  readSessionId,
  setSessionCookie,
  clearSessionCookie,
  sessionTtlHours,
} from '../middleware/auth.js';
import { loginLimiter } from '../middleware/rateLimit.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { AppError, UnauthorizedError, ValidationError } from '../../utils/errors.js';
import { cleanText } from '../../utils/sanitize.js';
import logger from '../../utils/logger.js';

const router = Router();
const VALID_STATUSES = ['ALL', 'PENDING', 'PAID', 'EXPIRED', 'CANCELLED', 'FAILED'];

/** POST /api/admin/login */
router.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const username = cleanText(req.body?.username, 60).toLowerCase();
    const password = String(req.body?.password ?? '');

    if (!username || !password) {
      throw new ValidationError('Informe usuario e senha.');
    }

    if (countAdmins() === 0) {
      throw new AppError(
        'Nenhum administrador cadastrado. Rode "npm run create-admin" no servidor.',
        { statusCode: 503, code: 'NO_ADMIN' }
      );
    }

    const admin = findAdminByUsername(username);
    // Mensagem identica para usuario inexistente e senha errada (evita
    // descobrir quais usuarios existem).
    if (!admin || !verifyPassword(password, admin.password_hash)) {
      logger.warn('Tentativa de login invalida', { ip: req.ip });
      throw new UnauthorizedError('Usuario ou senha incorretos.');
    }

    const sessionId = createSession(admin.id, sessionTtlHours());
    touchLogin(admin.id);
    setSessionCookie(res, sessionId);

    res.json({ ok: true, admin: { username: admin.username } });
  })
);

/** POST /api/admin/logout */
router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const sessionId = readSessionId(req);
    if (sessionId) destroySession(sessionId);
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
    res.json(getAdminOverview());
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
      listForAdmin({
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
    const { items } = listForAdmin({
      status: VALID_STATUSES.includes(status) ? status : 'ALL',
      page: 1,
      perPage: 200,
    });

    const header = 'id;nome_publico;nome_pagador;valor_centavos;status;transaction_id;criado_em;pago_em';
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
    const result = await getDonationStatus(req.params.transactionId, { force: true });
    res.json(result);
  })
);

/** POST /api/admin/reconcile - varre pendentes e expira vencidas. */
router.post(
  '/reconcile',
  asyncHandler(async (req, res) => {
    res.json(await reconcilePendingDonations({ limit: 25 }));
  })
);

/** GET /api/admin/settings */
router.get(
  '/settings',
  asyncHandler(async (req, res) => {
    res.json({ settings: getAllSettings() });
  })
);

/** PUT /api/admin/settings - altera meta, textos, imagem e valores rapidos. */
router.put(
  '/settings',
  asyncHandler(async (req, res) => {
    const result = updateCampaignSettings(req.body ?? {});
    if (!result.updated.length) {
      throw new ValidationError('Nenhum campo valido foi enviado.', result);
    }
    logger.info('Configuracoes da campanha alteradas', {
      admin: req.admin.username,
      fields: result.updated,
    });
    res.json({ ok: true, ...result, settings: getAllSettings() });
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

    const admin = findAdminByUsername(req.admin.username);
    if (!admin || !verifyPassword(currentPassword, admin.password_hash)) {
      throw new UnauthorizedError('Senha atual incorreta.');
    }

    updateAdminPassword(admin.id, newPassword);
    res.json({ ok: true });
  })
);

export default router;
