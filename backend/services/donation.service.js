/**
 * Servico de doacoes: validacao, criacao da cobranca Pix e confirmacao.
 *
 * Principios inegociaveis deste arquivo:
 *  - o valor cobrado e SEMPRE recalculado aqui (o numero que chega do
 *    navegador serve apenas como intencao e e revalidado);
 *  - uma doacao so vira PAID depois que a propria MisticPay confirma pelo
 *    endpoint /api/transactions/check. Nem o clique do usuario, nem o corpo
 *    do webhook, sozinhos, confirmam pagamento;
 *  - confirmar duas vezes a mesma transacao nao muda o total (SUM sobre PAID
 *    + UPDATE condicional).
 */
import crypto from 'node:crypto';
import config, { resolveWebhookUrl } from '../config/env.js';
import { getGateway } from '../gateways/index.js';
import { getWebhookToken } from '../gateways/misticpay/credentials.js';
import { STATUS } from '../gateways/gateway.interface.js';
import * as donationsRepo from '../database/repositories/donations.repo.js';
import { getDonationLimits, getCampaignState } from './campaign.service.js';
import { parseAmountToCents, formatBRL } from '../utils/money.js';
import { isValidCPF, maskCPF, onlyDigits } from '../utils/cpf.js';
import { cleanText } from '../utils/sanitize.js';
import { parseSqlDatetime } from '../utils/dates.js';
import { NotFoundError, TooManyRequestsError, ValidationError } from '../utils/errors.js';
import logger from '../utils/logger.js';

/** Intervalo minimo entre duas consultas ao gateway para a MESMA doacao. */
const CHECK_THROTTLE_MS = 4000;

/** Teto de cobrancas criadas pelo mesmo IP por hora (anti-spam). */
const MAX_CHARGES_PER_IP_PER_HOUR = 15;

function newTransactionId() {
  return `doacao-${Date.now().toString(36)}-${crypto.randomBytes(5).toString('hex')}`;
}

/** Valida e normaliza tudo que veio do navegador. */
export async function validateDonationInput(input = {}) {
  const { minCents, maxCents } = await getDonationLimits();

  const amountCents = parseAmountToCents(input.amount);
  if (amountCents === null) {
    throw new ValidationError('Informe um valor valido para a doacao.', { field: 'amount' });
  }
  if (amountCents < minCents) {
    throw new ValidationError(`O valor minimo da doacao e ${formatBRL(minCents)}.`, {
      field: 'amount',
    });
  }
  if (amountCents > maxCents) {
    throw new ValidationError(`O valor maximo por doacao e ${formatBRL(maxCents)}.`, {
      field: 'amount',
    });
  }

  const payerName = cleanText(input.payerName, 80);
  if (payerName.length < 3 || !payerName.includes(' ')) {
    throw new ValidationError('Informe seu nome completo (como no seu banco).', {
      field: 'payerName',
    });
  }

  const document = onlyDigits(input.document);
  if (!isValidCPF(document)) {
    throw new ValidationError('CPF invalido. Confira os numeros e tente de novo.', {
      field: 'document',
    });
  }

  // Nome publico: so aparece na lista se o doador quiser.
  const anonymous = input.anonymous === true || input.anonymous === 'true';
  const displayName = anonymous ? null : cleanText(input.displayName || payerName, 40) || null;
  const message = cleanText(input.message, 140) || null;

  return { amountCents, payerName, document, displayName, message, anonymous };
}

/** Cria a cobranca Pix e grava a doacao como PENDING. */
export async function createPixDonation(rawInput, { clientIp = null } = {}) {
  const input = await validateDonationInput(rawInput);
  const gateway = getGateway();

  if (!(await gateway.isConfigured())) {
    throw new ValidationError(
      'O sistema de pagamento ainda nao foi configurado. Tente novamente mais tarde.'
    );
  }

  if (clientIp && (await donationsRepo.countRecentByIp(clientIp, 60)) >= MAX_CHARGES_PER_IP_PER_HOUR) {
    throw new TooManyRequestsError(
      'Voce gerou muitos Pix seguidos. Aguarde alguns minutos antes de tentar de novo.'
    );
  }

  const transactionId = newTransactionId();
  const campaign = await getCampaignState();

  const charge = await gateway.createPixCharge({
    amountCents: input.amountCents,
    transactionId,
    payerName: input.payerName,
    payerDocument: input.document,
    description: `Doacao ${formatBRL(input.amountCents)} - ${campaign.projectName}`,
    webhookUrl: resolveWebhookUrl(await getWebhookToken()),
  });

  const donation = await donationsRepo.createDonation({
    transactionId,
    gatewayTransactionId: charge.gatewayTransactionId,
    gateway: gateway.name,
    name: input.displayName,
    payerName: input.payerName,
    payerDocumentMasked: maskCPF(input.document),
    amount: input.amountCents,
    message: input.message,
    pixCopyPaste: charge.copyPaste,
    pixQrCodeBase64: charge.qrCodeBase64,
    pixQrCodeUrl: charge.qrCodeUrl,
    clientIp,
    expiresInMinutes: config.campaign.pixExpirationMinutes,
  });

  logger.info('Cobranca Pix criada', {
    transactionId,
    gatewayTransactionId: charge.gatewayTransactionId,
    amount: input.amountCents,
  });

  return donation;
}

/** Teto de sanidade para lancamento manual: R$ 1.000.000,00. */
const MANUAL_MAX_CENTS = 100000000;

/**
 * Registra uma doacao recebida FORA da plataforma (Pix direto na sua chave,
 * dinheiro, outro app) e ja confirmada por voce.
 *
 * Isto NAO e "editar o total": o valor entra como um lancamento identificado
 * (source = 'MANUAL'), com quem registrou e o motivo, e continua sendo somado
 * pela mesma regra dos demais (SUM sobre PAID). O que veio da MisticPay
 * permanece intocavel e da para separar as duas origens a qualquer momento.
 */
export async function registerManualDonation(rawInput, { adminUsername = 'admin' } = {}) {
  const amountCents = parseAmountToCents(rawInput?.amount);

  if (amountCents === null || amountCents <= 0) {
    throw new ValidationError('Informe um valor valido.', { field: 'amount' });
  }
  if (amountCents > MANUAL_MAX_CENTS) {
    throw new ValidationError(`Valor acima do limite de ${formatBRL(MANUAL_MAX_CENTS)}.`, {
      field: 'amount',
    });
  }

  const note = cleanText(rawInput?.note, 160);
  if (note.length < 3) {
    throw new ValidationError(
      'Descreva de onde veio essa doacao (ex.: "Pix direto na chave", "dinheiro na mao").',
      { field: 'note' }
    );
  }

  const anonymous = rawInput?.anonymous === true || rawInput?.anonymous === 'true';
  const displayName = anonymous ? null : cleanText(rawInput?.name, 40) || null;
  const message = cleanText(rawInput?.message, 140) || null;

  const donation = await donationsRepo.createManualDonation({
    transactionId: `manual-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`,
    name: displayName,
    payerName: displayName ?? 'Doacao externa',
    amount: amountCents,
    message,
    adminNote: `${note} (registrado por ${cleanText(adminUsername, 40)})`,
  });

  logger.info('Doacao externa registrada no painel', {
    transactionId: donation.transaction_id,
    amount: amountCents,
    admin: adminUsername,
  });

  return donation;
}

/** Remove um lancamento manual. Doacoes vindas do gateway nunca sao apagadas. */
export async function removeManualDonation(transactionId, { adminUsername = 'admin' } = {}) {
  const donation = await donationsRepo.findByTransactionId(transactionId);
  if (!donation) throw new NotFoundError('Lancamento nao encontrado.');

  if (donation.source !== 'MANUAL') {
    throw new ValidationError(
      'Só é possível remover lançamentos manuais. Doações confirmadas pela MisticPay são permanentes.'
    );
  }

  const removed = await donationsRepo.deleteManualDonation(transactionId);
  logger.info('Lancamento manual removido', { transactionId, admin: adminUsername });
  return removed;
}

/** Formato seguro enviado ao navegador (nada sensivel). */
export function toPublicDonation(donation) {
  if (!donation) return null;
  return {
    transactionId: donation.transaction_id,
    amount: Number(donation.amount),
    status: donation.status,
    name: donation.name,
    message: donation.message,
    pix: {
      copyPaste: donation.pix_copy_paste,
      qrCodeBase64: donation.pix_qrcode_base64,
      qrCodeUrl: donation.pix_qrcode_url,
    },
    createdAt: donation.created_at,
    paidAt: donation.paid_at,
    expiresAt: donation.expires_at,
  };
}

/**
 * Confirma a doacao consultando a MisticPay. E o UNICO caminho que grava PAID.
 * @returns {Promise<{ status: string, changed: boolean }>}
 */
async function confirmWithGateway(donation, { source = 'polling', rawPayload = null } = {}) {
  const gateway = getGateway();

  if (!donation.gateway_transaction_id) {
    return { status: donation.status, changed: false };
  }

  const result = await gateway.checkTransaction(
    donation.gateway_transaction_id,
    Number(donation.amount)
  );

  if (result.status === STATUS.PAID) {
    const mismatch = result.amountCents === null;
    const changed = await donationsRepo.markAsPaid(donation.id, {
      paidAmount: result.amountCents,
      mismatch,
      raw: JSON.stringify({ source, gateway: result.raw }),
    });

    if (changed) {
      logger.info('Doacao confirmada', {
        transactionId: donation.transaction_id,
        amount: donation.amount,
        source,
        mismatch,
      });
    }
    if (mismatch) {
      logger.warn('Valor confirmado diferente do cobrado - conferir manualmente', {
        transactionId: donation.transaction_id,
        expected: donation.amount,
      });
    }
    return { status: STATUS.PAID, changed };
  }

  if (result.status !== STATUS.PENDING) {
    const changed = await donationsRepo.updateStatus(donation.id, result.status);
    return { status: result.status, changed };
  }

  await donationsRepo.touchChecked(donation.id);
  if (rawPayload) {
    logger.debug('Webhook recebido mas gateway ainda reporta pendente', {
      transactionId: donation.transaction_id,
    });
  }
  return { status: STATUS.PENDING, changed: false };
}

/**
 * Status atual da doacao para o frontend.
 * Consulta a MisticPay no maximo 1x a cada CHECK_THROTTLE_MS por doacao.
 */
export async function getDonationStatus(transactionId, { force = false } = {}) {
  const donation = await donationsRepo.findByTransactionId(transactionId);
  if (!donation) throw new NotFoundError('Doacao nao encontrada.');

  if (donation.status === STATUS.PENDING) {
    const expiresAt = parseSqlDatetime(donation.expires_at);
    const expired = expiresAt && expiresAt.getTime() < Date.now();

    if (expired) {
      await donationsRepo.updateStatus(donation.id, STATUS.EXPIRED);
    } else {
      const lastCheck = parseSqlDatetime(donation.last_checked_at);
      const elapsed = lastCheck ? Date.now() - lastCheck.getTime() : Infinity;

      if (force || elapsed >= CHECK_THROTTLE_MS) {
        try {
          await confirmWithGateway(donation, { source: 'polling' });
        } catch (error) {
          // Uma falha de consulta nao pode derrubar a tela de pagamento.
          logger.warn('Falha ao consultar status na MisticPay', {
            transactionId,
            error: error?.message,
          });
        }
      }
    }
  }

  const [fresh, campaign] = await Promise.all([
    donationsRepo.findByTransactionId(transactionId),
    getCampaignState(),
  ]);

  return { donation: toPublicDonation(fresh), campaign };
}

/**
 * Processa um evento de webhook.
 *
 * O corpo recebido serve apenas para descobrir QUAL transacao mudou. O status
 * e sempre reconfirmado direto na MisticPay antes de creditar qualquer valor.
 */
export async function processWebhookEvent(body) {
  const gateway = getGateway();
  const event = gateway.parseWebhook(body);

  if (!event || !event.gatewayTransactionId) {
    await donationsRepo.recordGatewayEvent({
      eventType: 'DESCONHECIDO',
      gatewayTransactionId: null,
      donationId: null,
      payload: JSON.stringify(body ?? {}),
      verified: false,
      result: 'payload sem transactionId',
    });
    return { handled: false, reason: 'payload sem transactionId' };
  }

  const donation = await donationsRepo.findByAnyTransactionId(event.gatewayTransactionId);

  if (!donation) {
    await donationsRepo.recordGatewayEvent({
      eventType: event.eventType,
      gatewayTransactionId: event.gatewayTransactionId,
      donationId: null,
      payload: JSON.stringify(body ?? {}),
      verified: false,
      result: 'transacao desconhecida',
    });
    return { handled: false, reason: 'transacao desconhecida' };
  }

  if (event.eventType === 'INFRACTION') {
    await donationsRepo.recordGatewayEvent({
      eventType: 'INFRACTION',
      gatewayTransactionId: event.gatewayTransactionId,
      donationId: donation.id,
      payload: JSON.stringify(body ?? {}),
      verified: false,
      result: 'infracao registrada para analise manual',
    });
    logger.warn('MED/infracao recebida para uma doacao', {
      transactionId: donation.transaction_id,
    });
    return { handled: true, status: donation.status, infraction: true };
  }

  let outcome = { status: donation.status, changed: false };
  let verified = false;
  let resultText = '';

  try {
    outcome = await confirmWithGateway(donation, { source: 'webhook', rawPayload: body });
    verified = true;
    resultText = `confirmado na API: ${outcome.status}${outcome.changed ? ' (alterado)' : ''}`;
  } catch (error) {
    resultText = `falha ao reconfirmar: ${error?.message}`;
    logger.error('Webhook recebido mas a reconferencia na MisticPay falhou', {
      transactionId: donation.transaction_id,
      error: error?.message,
    });
  }

  await donationsRepo.recordGatewayEvent({
    eventType: event.eventType,
    gatewayTransactionId: event.gatewayTransactionId,
    donationId: donation.id,
    payload: JSON.stringify(body ?? {}),
    verified,
    result: resultText,
  });

  return { handled: true, status: outcome.status, changed: outcome.changed };
}

/**
 * Rotina periodica: expira cobrancas vencidas e reconfere as pendentes.
 * Funciona como rede de seguranca caso um webhook se perca.
 */
export async function reconcilePendingDonations({ limit = 10 } = {}) {
  const expired = await donationsRepo.expireOverdue();
  const pending = await donationsRepo.listPendingToReconcile(limit);

  let confirmed = 0;
  for (const item of pending) {
    try {
      const donation = await donationsRepo.findByTransactionId(item.transaction_id);
      if (!donation) continue;
      const outcome = await confirmWithGateway(donation, { source: 'reconciliacao' });
      if (outcome.changed && outcome.status === STATUS.PAID) confirmed += 1;
    } catch (error) {
      logger.debug('Reconciliacao falhou para uma doacao', {
        transactionId: item.transaction_id,
        error: error?.message,
      });
    }
  }

  return { expired, checked: pending.length, confirmed };
}
