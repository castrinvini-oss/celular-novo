/**
 * Repositorio de doacoes.
 *
 * Regras que vivem aqui:
 *  - o total arrecadado e SEMPRE um SUM sobre status = 'PAID' (nunca um
 *    contador incrementado), o que torna impossivel contar duas vezes;
 *  - transaction_id e gateway_transaction_id sao UNIQUE;
 *  - marcar como paga so tem efeito uma unica vez (WHERE status <> 'PAID').
 */
import { getDb } from '../db.js';

const PUBLIC_COLUMNS = `
  id, transaction_id, gateway_transaction_id, gateway, name, payer_name,
  payer_document_masked, amount, status, message, pix_copy_paste,
  pix_qrcode_base64, pix_qrcode_url, last_checked_at, paid_amount,
  amount_mismatch, created_at, updated_at, paid_at, expires_at
`;

function row(result) {
  return result ? { ...result } : null;
}

export function createDonation(data) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO donations (
      transaction_id, gateway_transaction_id, gateway, name, payer_name,
      payer_document_masked, amount, status, message, pix_copy_paste,
      pix_qrcode_base64, pix_qrcode_url, client_ip, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
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
    data.expiresAt ?? null
  );

  return findByTransactionId(data.transactionId);
}

export function findByTransactionId(transactionId) {
  const db = getDb();
  return row(
    db
      .prepare(`SELECT ${PUBLIC_COLUMNS} FROM donations WHERE transaction_id = ?`)
      .get(String(transactionId))
  );
}

export function findByGatewayTransactionId(gatewayTransactionId) {
  const db = getDb();
  return row(
    db
      .prepare(`SELECT ${PUBLIC_COLUMNS} FROM donations WHERE gateway_transaction_id = ?`)
      .get(String(gatewayTransactionId))
  );
}

/** Aceita tanto o nosso id quanto o id do gateway (o webhook manda o deles). */
export function findByAnyTransactionId(id) {
  if (id === null || id === undefined || id === '') return null;
  return findByGatewayTransactionId(id) ?? findByTransactionId(id);
}

export function attachGatewayTransactionId(donationId, gatewayTransactionId) {
  const db = getDb();
  db.prepare(
    `UPDATE donations
        SET gateway_transaction_id = ?, updated_at = datetime('now')
      WHERE id = ? AND gateway_transaction_id IS NULL`
  ).run(String(gatewayTransactionId), donationId);
}

/**
 * Marca a doacao como paga. Idempotente: se ja estava PAID, retorna false e
 * nada e alterado (a doacao nao entra duas vezes no total).
 */
export function markAsPaid(donationId, { paidAmount = null, mismatch = false, raw = null } = {}) {
  const db = getDb();
  const result = db
    .prepare(
      `UPDATE donations
          SET status = 'PAID',
              paid_at = COALESCE(paid_at, datetime('now')),
              updated_at = datetime('now'),
              paid_amount = ?,
              amount_mismatch = ?,
              raw_confirmation = ?,
              last_checked_at = datetime('now')
        WHERE id = ? AND status <> 'PAID'`
    )
    .run(paidAmount, mismatch ? 1 : 0, raw ? String(raw).slice(0, 4000) : null, donationId);

  return Number(result.changes) > 0;
}

/** Atualiza status nao-pago. Nunca sobrescreve uma doacao ja confirmada. */
export function updateStatus(donationId, status) {
  const db = getDb();
  const result = db
    .prepare(
      `UPDATE donations
          SET status = ?, updated_at = datetime('now'), last_checked_at = datetime('now')
        WHERE id = ? AND status <> 'PAID'`
    )
    .run(status, donationId);
  return Number(result.changes) > 0;
}

export function touchChecked(donationId) {
  const db = getDb();
  db.prepare(`UPDATE donations SET last_checked_at = datetime('now') WHERE id = ?`).run(donationId);
}

/** Marca como EXPIRED todas as pendentes que passaram do prazo. */
export function expireOverdue() {
  const db = getDb();
  const result = db
    .prepare(
      `UPDATE donations
          SET status = 'EXPIRED', updated_at = datetime('now')
        WHERE status = 'PENDING'
          AND expires_at IS NOT NULL
          AND expires_at < datetime('now')`
    )
    .run();
  return Number(result.changes);
}

/** Total arrecadado (centavos) e numero de apoiadores confirmados. */
export function getTotals() {
  const db = getDb();
  const result = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS supporters
         FROM donations
        WHERE status = 'PAID'`
    )
    .get();
  return {
    raisedCents: Number(result?.total ?? 0),
    supporters: Number(result?.supporters ?? 0),
  };
}

/** Ultimas doacoes confirmadas para a vitrine publica. */
export function listRecentPaid(limit = 20) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT name, amount, message, paid_at
         FROM donations
        WHERE status = 'PAID'
        ORDER BY datetime(paid_at) DESC, id DESC
        LIMIT ?`
    )
    .all(Math.max(1, Math.min(100, Number(limit) || 20)));
  return rows.map((item) => ({ ...item }));
}

/** Maior doacao confirmada (usada no destaque da pagina). */
export function getTopDonation() {
  const db = getDb();
  return row(
    db
      .prepare(
        `SELECT name, amount, paid_at
           FROM donations
          WHERE status = 'PAID'
          ORDER BY amount DESC, datetime(paid_at) ASC
          LIMIT 1`
      )
      .get()
  );
}

/** Listagem paginada para o painel administrativo. */
export function listForAdmin({ status = 'ALL', page = 1, perPage = 25, search = '' } = {}) {
  const db = getDb();
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
  const total = Number(
    db.prepare(`SELECT COUNT(*) AS total FROM donations ${where}`).get(...params)?.total ?? 0
  );

  const safePerPage = Math.max(1, Math.min(200, Number(perPage) || 25));
  const totalPages = Math.max(1, Math.ceil(total / safePerPage));
  const safePage = Math.max(1, Math.min(totalPages, Number(page) || 1));
  const offset = (safePage - 1) * safePerPage;

  const rows = db
    .prepare(
      `SELECT id, transaction_id, gateway_transaction_id, name, payer_name,
              payer_document_masked, amount, paid_amount, amount_mismatch,
              status, message, created_at, paid_at
         FROM donations
         ${where}
        ORDER BY id DESC
        LIMIT ? OFFSET ?`
    )
    .all(...params, safePerPage, offset);

  return {
    items: rows.map((item) => ({ ...item })),
    pagination: { page: safePage, perPage: safePerPage, total, totalPages },
  };
}

/** Contagem por status, para os cards do painel. */
export function countByStatus() {
  const db = getDb();
  const rows = db.prepare(`SELECT status, COUNT(*) AS total FROM donations GROUP BY status`).all();
  const counts = { PENDING: 0, PAID: 0, EXPIRED: 0, CANCELLED: 0, FAILED: 0 };
  for (const item of rows) counts[item.status] = Number(item.total);
  return counts;
}

/** Pendentes que ainda valem uma consulta ativa ao gateway. */
export function listPendingToReconcile(limit = 25) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, transaction_id, gateway_transaction_id, amount
         FROM donations
        WHERE status = 'PENDING'
          AND gateway_transaction_id IS NOT NULL
          AND (expires_at IS NULL OR expires_at > datetime('now'))
        ORDER BY datetime(COALESCE(last_checked_at, created_at)) ASC
        LIMIT ?`
    )
    .all(Number(limit) || 25);
  return rows.map((item) => ({ ...item }));
}

/** Quantas cobrancas este IP criou nos ultimos X minutos (anti-spam). */
export function countRecentByIp(clientIp, minutes = 60) {
  const db = getDb();
  const result = db
    .prepare(
      `SELECT COUNT(*) AS total
         FROM donations
        WHERE client_ip = ?
          AND created_at > datetime('now', ?)`
    )
    .get(String(clientIp ?? ''), `-${Math.max(1, Number(minutes) || 60)} minutes`);
  return Number(result?.total ?? 0);
}

export function recordGatewayEvent({
  eventType,
  gatewayTransactionId,
  donationId,
  payload,
  verified,
  result,
}) {
  const db = getDb();
  db.prepare(
    `INSERT INTO gateway_events
       (event_type, gateway_transaction_id, donation_id, payload, verified, result)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    eventType ?? null,
    gatewayTransactionId ? String(gatewayTransactionId) : null,
    donationId ?? null,
    payload ? String(payload).slice(0, 8000) : null,
    verified ? 1 : 0,
    result ?? null
  );
}
