/**
 * Repositorio de doacoes (funciona em SQLite e em Postgres/Supabase).
 *
 * Regras que vivem aqui:
 *  - o total arrecadado e SEMPRE um SUM sobre status = 'PAID' (nunca um
 *    contador incrementado), o que torna impossivel contar duas vezes;
 *  - transaction_id e gateway_transaction_id sao UNIQUE;
 *  - marcar como paga so tem efeito uma unica vez (WHERE status <> 'PAID').
 */
import { all, one, run, sql } from '../db.js';

const PUBLIC_COLUMNS = `
  id, transaction_id, gateway_transaction_id, gateway, name, payer_name,
  payer_document_masked, amount, status, message, pix_copy_paste,
  pix_qrcode_base64, pix_qrcode_url, last_checked_at, paid_amount,
  amount_mismatch, source, admin_note, created_at, updated_at, paid_at, expires_at
`;

export async function createDonation(data) {
  const s = await sql();

  await run(
    `INSERT INTO donations (
       transaction_id, gateway_transaction_id, gateway, name, payer_name,
       payer_document_masked, amount, status, message, pix_copy_paste,
       pix_qrcode_base64, pix_qrcode_url, client_ip, expires_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ${s.nowPlusMinutes(
       data.expiresInMinutes ?? 30
     )})`,
    [
      data.transactionId,
      data.gatewayTransactionId ?? null,
      data.gateway ?? 'misticpay',
      data.name ?? null,
      data.payerName,
      data.payerDocumentMasked ?? null,
      data.amount,
      data.message ?? null,
      data.pixCopyPaste ?? null,
      data.pixQrCodeBase64 ?? null,
      data.pixQrCodeUrl ?? null,
      data.clientIp ?? null,
    ]
  );

  return findByTransactionId(data.transactionId);
}

export async function findByTransactionId(transactionId) {
  return one(`SELECT ${PUBLIC_COLUMNS} FROM donations WHERE transaction_id = ?`, [
    String(transactionId),
  ]);
}

export async function findByGatewayTransactionId(gatewayTransactionId) {
  return one(`SELECT ${PUBLIC_COLUMNS} FROM donations WHERE gateway_transaction_id = ?`, [
    String(gatewayTransactionId),
  ]);
}

/** Aceita tanto o nosso id quanto o id do gateway (o webhook manda o deles). */
export async function findByAnyTransactionId(id) {
  if (id === null || id === undefined || id === '') return null;
  return (await findByGatewayTransactionId(id)) ?? (await findByTransactionId(id));
}

export async function attachGatewayTransactionId(donationId, gatewayTransactionId) {
  const s = await sql();
  await run(
    `UPDATE donations
        SET gateway_transaction_id = ?, updated_at = ${s.now}
      WHERE id = ? AND gateway_transaction_id IS NULL`,
    [String(gatewayTransactionId), donationId]
  );
}

/**
 * Marca a doacao como paga. Idempotente: se ja estava PAID, retorna false e
 * nada e alterado (a doacao nao entra duas vezes no total).
 */
export async function markAsPaid(
  donationId,
  { paidAmount = null, mismatch = false, raw = null } = {}
) {
  const s = await sql();
  const changes = await run(
    `UPDATE donations
        SET status = 'PAID',
            paid_at = COALESCE(paid_at, ${s.now}),
            updated_at = ${s.now},
            paid_amount = ?,
            amount_mismatch = ?,
            raw_confirmation = ?,
            last_checked_at = ${s.now}
      WHERE id = ? AND status <> 'PAID'`,
    [paidAmount, mismatch ? 1 : 0, raw ? String(raw).slice(0, 4000) : null, donationId]
  );

  return changes > 0;
}

/** Atualiza status nao-pago. Nunca sobrescreve uma doacao ja confirmada. */
export async function updateStatus(donationId, status) {
  const s = await sql();
  const changes = await run(
    `UPDATE donations
        SET status = ?, updated_at = ${s.now}, last_checked_at = ${s.now}
      WHERE id = ? AND status <> 'PAID'`,
    [status, donationId]
  );
  return changes > 0;
}

export async function touchChecked(donationId) {
  const s = await sql();
  await run(`UPDATE donations SET last_checked_at = ${s.now} WHERE id = ?`, [donationId]);
}

/** Marca como EXPIRED todas as pendentes que passaram do prazo. */
export async function expireOverdue() {
  const s = await sql();
  return run(
    `UPDATE donations
        SET status = 'EXPIRED', updated_at = ${s.now}
      WHERE status = 'PENDING'
        AND expires_at IS NOT NULL
        AND expires_at < ${s.now}`
  );
}

/** Total arrecadado (centavos) e numero de apoiadores confirmados. */
export async function getTotals() {
  const result = await one(
    `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS supporters
       FROM donations
      WHERE status = 'PAID'`
  );
  return {
    raisedCents: Number(result?.total ?? 0),
    supporters: Number(result?.supporters ?? 0),
  };
}

/**
 * Registra uma doacao recebida FORA do gateway (Pix direto, dinheiro, outro
 * app) ja como paga.
 *
 * Fica marcada com source = 'MANUAL' e guarda a anotacao de quem registrou,
 * entao o total da campanha continua auditavel: da para separar, a qualquer
 * momento, o que veio confirmado pela MisticPay do que foi lancado a mao.
 * As doacoes do gateway continuam sendo criadas exclusivamente pelo fluxo
 * automatico - este caminho nunca toca nelas.
 */
export async function createManualDonation(data) {
  const s = await sql();

  await run(
    `INSERT INTO donations (
       transaction_id, gateway, name, payer_name, amount, status, message,
       source, admin_note, paid_at
     ) VALUES (?, 'manual', ?, ?, ?, 'PAID', ?, 'MANUAL', ?, ${s.now})`,
    [
      data.transactionId,
      data.name ?? null,
      data.payerName,
      data.amount,
      data.message ?? null,
      data.adminNote ?? null,
    ]
  );

  return findByTransactionId(data.transactionId);
}

/** Remove um lancamento manual. Doacoes do gateway nunca sao apagadas. */
export async function deleteManualDonation(transactionId) {
  const changes = await run(
    "DELETE FROM donations WHERE transaction_id = ? AND source = 'MANUAL'",
    [String(transactionId)]
  );
  return changes > 0;
}

/** Quanto do total veio de cada origem (para o painel). */
export async function getTotalsBySource() {
  const rows = await all(
    `SELECT source, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS quantidade
       FROM donations
      WHERE status = 'PAID'
      GROUP BY source`
  );

  const totals = { GATEWAY: { cents: 0, count: 0 }, MANUAL: { cents: 0, count: 0 } };
  for (const item of rows) {
    const key = item.source === 'MANUAL' ? 'MANUAL' : 'GATEWAY';
    totals[key] = { cents: Number(item.total), count: Number(item.quantidade) };
  }
  return totals;
}

/** Ultimas doacoes confirmadas para a vitrine publica. */
export async function listRecentPaid(limit = 20) {
  const s = await sql();
  return all(
    `SELECT name, amount, message, paid_at
       FROM donations
      WHERE status = 'PAID'
      ORDER BY ${s.orderDate('paid_at')} DESC, id DESC
      LIMIT ?`,
    [Math.max(1, Math.min(100, Number(limit) || 20))]
  );
}

/** Maior doacao confirmada (usada no destaque da pagina). */
export async function getTopDonation() {
  const s = await sql();
  return one(
    `SELECT name, amount, paid_at
       FROM donations
      WHERE status = 'PAID'
      ORDER BY amount DESC, ${s.orderDate('paid_at')} ASC
      LIMIT 1`
  );
}

/** Listagem paginada para o painel administrativo. */
export async function listForAdmin({ status = 'ALL', page = 1, perPage = 25, search = '' } = {}) {
  const filters = [];
  const params = [];

  if (status && status !== 'ALL') {
    filters.push('status = ?');
    params.push(status);
  }
  if (search) {
    filters.push(
      '(name LIKE ? OR payer_name LIKE ? OR transaction_id LIKE ? OR gateway_transaction_id LIKE ?)'
    );
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const totalRow = await one(`SELECT COUNT(*) AS total FROM donations ${where}`, params);
  const total = Number(totalRow?.total ?? 0);

  const safePerPage = Math.max(1, Math.min(200, Number(perPage) || 25));
  const totalPages = Math.max(1, Math.ceil(total / safePerPage));
  const safePage = Math.max(1, Math.min(totalPages, Number(page) || 1));
  const offset = (safePage - 1) * safePerPage;

  const items = await all(
    `SELECT id, transaction_id, gateway_transaction_id, name, payer_name,
            payer_document_masked, amount, paid_amount, amount_mismatch,
            source, admin_note, status, message, created_at, paid_at
       FROM donations
       ${where}
      ORDER BY id DESC
      LIMIT ? OFFSET ?`,
    [...params, safePerPage, offset]
  );

  return { items, pagination: { page: safePage, perPage: safePerPage, total, totalPages } };
}

/** Contagem por status, para os cards do painel. */
export async function countByStatus() {
  const rows = await all('SELECT status, COUNT(*) AS total FROM donations GROUP BY status');
  const counts = { PENDING: 0, PAID: 0, EXPIRED: 0, CANCELLED: 0, FAILED: 0 };
  for (const item of rows) counts[item.status] = Number(item.total);
  return counts;
}

/** Pendentes que ainda valem uma consulta ativa ao gateway. */
export async function listPendingToReconcile(limit = 25) {
  const s = await sql();
  return all(
    `SELECT id, transaction_id, gateway_transaction_id, amount
       FROM donations
      WHERE status = 'PENDING'
        AND gateway_transaction_id IS NOT NULL
        AND (expires_at IS NULL OR expires_at > ${s.now})
      ORDER BY ${s.orderDate('COALESCE(last_checked_at, created_at)')} ASC
      LIMIT ?`,
    [Number(limit) || 25]
  );
}

/** Quantas cobrancas este IP criou nos ultimos X minutos (anti-spam). */
export async function countRecentByIp(clientIp, minutes = 60) {
  const s = await sql();
  const result = await one(
    `SELECT COUNT(*) AS total
       FROM donations
      WHERE client_ip = ?
        AND created_at > ${s.nowMinusMinutes(Math.max(1, Number(minutes) || 60))}`,
    [String(clientIp ?? '')]
  );
  return Number(result?.total ?? 0);
}

export async function recordGatewayEvent({
  eventType,
  gatewayTransactionId,
  donationId,
  payload,
  verified,
  result,
}) {
  await run(
    `INSERT INTO gateway_events
       (event_type, gateway_transaction_id, donation_id, payload, verified, result)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      eventType ?? null,
      gatewayTransactionId ? String(gatewayTransactionId) : null,
      donationId ?? null,
      payload ? String(payload).slice(0, 8000) : null,
      verified ? 1 : 0,
      result ?? null,
    ]
  );
}
