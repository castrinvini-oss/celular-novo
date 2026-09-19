/**
 * Testa a camada de dados nos DOIS bancos suportados.
 *
 *   npm test
 *
 * SQLite roda em arquivo temporario; Postgres roda em PGlite (um Postgres
 * de verdade compilado para WebAssembly), entao da para validar o dialeto
 * Postgres sem instalar servidor nenhum.
 *
 * Cobre as regras que nao podem quebrar nunca:
 *   - doacao so entra no total quando esta PAID;
 *   - confirmar duas vezes nao soma duas vezes;
 *   - cobranca vencida vira EXPIRED;
 *   - sessao e tentativas de login do painel.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

import { setDriver, migrate, closeDb } from '../backend/database/db.js';
import { createSqliteDriver } from '../backend/database/drivers/sqlite.js';
import { createPostgresDriver } from '../backend/database/drivers/postgres.js';

import * as donations from '../backend/database/repositories/donations.repo.js';
import * as admins from '../backend/database/repositories/admin.repo.js';
import * as settings from '../backend/database/repositories/settings.repo.js';
import { getCampaignState, updateCampaignSettings } from '../backend/services/campaign.service.js';
import { parseSqlDatetime } from '../backend/utils/dates.js';

let failures = 0;
let checks = 0;

async function check(label, fn) {
  checks += 1;
  try {
    await fn();
    console.log(`  ok   ${label}`);
  } catch (error) {
    failures += 1;
    console.error(`  FALHOU ${label}\n         ${error.message}`);
  }
}

function donationPayload(overrides = {}) {
  return {
    transactionId: `tx-${Math.random().toString(36).slice(2, 10)}`,
    gatewayTransactionId: `gw-${Math.random().toString(36).slice(2, 10)}`,
    name: 'Maria S.',
    payerName: 'Maria Souza',
    payerDocumentMasked: '***.982.247-**',
    amount: 2000,
    message: 'boa sorte!',
    pixCopyPaste: '00020101...',
    clientIp: '203.0.113.10',
    expiresInMinutes: 30,
    ...overrides,
  };
}

async function runSuite(name) {
  console.log(`\n=== ${name} ===`);
  await migrate();

  await check('configuracoes iniciais semeadas', async () => {
    const all = await settings.getAllSettings();
    assert.equal(all.goal_cents, '200000');
    assert.equal(all.device_name, 'Samsung Galaxy A36 5G 256GB');
  });

  await check('campanha comeca zerada', async () => {
    const campaign = await getCampaignState();
    assert.equal(campaign.raisedCents, 0);
    assert.equal(campaign.percent, 0);
    assert.equal(campaign.remainingCents, 200000);
    assert.equal(campaign.goalReached, false);
  });

  const first = donationPayload();
  await check('cria doacao PENDING com expiracao no futuro', async () => {
    const created = await donations.createDonation(first);
    assert.equal(created.status, 'PENDING');
    assert.equal(Number(created.amount), 2000);
    assert.ok(created.expires_at, 'expires_at deveria estar preenchido');
    assert.ok(
      parseSqlDatetime(created.expires_at).getTime() > Date.now(),
      'expires_at deveria estar no futuro'
    );
  });

  await check('doacao PENDING nao entra no total', async () => {
    const totals = await donations.getTotals();
    assert.equal(totals.raisedCents, 0);
    assert.equal(totals.supporters, 0);
  });

  let firstId = null;
  await check('confirmar pagamento credita uma unica vez', async () => {
    const donation = await donations.findByTransactionId(first.transactionId);
    firstId = donation.id;

    const changed = await donations.markAsPaid(donation.id, { paidAmount: 2000 });
    assert.equal(changed, true, 'primeira confirmacao deveria alterar');

    const again = await donations.markAsPaid(donation.id, { paidAmount: 2000 });
    assert.equal(again, false, 'segunda confirmacao NAO pode alterar');

    const totals = await donations.getTotals();
    assert.equal(totals.raisedCents, 2000, 'total deveria contar R$ 20,00 uma unica vez');
    assert.equal(totals.supporters, 1);
  });

  await check('updateStatus nao sobrescreve doacao paga', async () => {
    const changed = await donations.updateStatus(firstId, 'FAILED');
    assert.equal(changed, false);
    const donation = await donations.findByTransactionId(first.transactionId);
    assert.equal(donation.status, 'PAID');
  });

  await check('busca pelo id do gateway (usada pelo webhook)', async () => {
    const found = await donations.findByAnyTransactionId(first.gatewayTransactionId);
    assert.ok(found);
    assert.equal(found.transaction_id, first.transactionId);
  });

  await check('progresso calculado a partir do SUM', async () => {
    const campaign = await getCampaignState();
    assert.equal(campaign.raisedCents, 2000);
    assert.equal(campaign.percent, 1);
    assert.equal(campaign.remainingCents, 198000);
  });

  await check('cobranca vencida vira EXPIRED', async () => {
    const overdue = donationPayload({ expiresInMinutes: -5 });
    await donations.createDonation(overdue);

    const expired = await donations.expireOverdue();
    assert.ok(expired >= 1, 'deveria expirar pelo menos uma cobranca');

    const donation = await donations.findByTransactionId(overdue.transactionId);
    assert.equal(donation.status, 'EXPIRED');

    const totals = await donations.getTotals();
    assert.equal(totals.raisedCents, 2000, 'expirar nao pode mexer no total');
  });

  await check('apoiadores e destaque', async () => {
    const recent = await donations.listRecentPaid(10);
    assert.equal(recent.length, 1);
    assert.equal(recent[0].name, 'Maria S.');

    const top = await donations.getTopDonation();
    assert.equal(Number(top.amount), 2000);
  });

  await check('listagem do painel com filtro e busca', async () => {
    const paid = await donations.listForAdmin({ status: 'PAID', page: 1, perPage: 10 });
    assert.equal(paid.pagination.total, 1);
    assert.equal(paid.items[0].status, 'PAID');

    const search = await donations.listForAdmin({ search: 'Maria', page: 1, perPage: 10 });
    assert.ok(search.pagination.total >= 1);

    const counts = await donations.countByStatus();
    assert.equal(counts.PAID, 1);
    assert.equal(counts.EXPIRED, 1);
  });

  await check('anti-spam por IP conta as cobrancas da ultima hora', async () => {
    const total = await donations.countRecentByIp('203.0.113.10', 60);
    assert.equal(total, 2);
    assert.equal(await donations.countRecentByIp('198.51.100.1', 60), 0);
  });

  await check('pendentes a reconciliar ignoram pagas e vencidas', async () => {
    const pending = donationPayload();
    await donations.createDonation(pending);
    const list = await donations.listPendingToReconcile(10);
    assert.equal(list.length, 1);
    assert.equal(list[0].transaction_id, pending.transactionId);
  });

  await check('evento de gateway registrado para auditoria', async () => {
    await donations.recordGatewayEvent({
      eventType: 'DEPOSITO',
      gatewayTransactionId: first.gatewayTransactionId,
      donationId: firstId,
      payload: '{"status":"COMPLETO"}',
      verified: true,
      result: 'confirmado na API: PAID',
    });
  });

  await check('administrador, sessao e logout', async () => {
    const admin = await admins.createAdmin('Chefe', 'senha-muito-forte');
    assert.equal(admin.username, 'chefe');
    assert.equal(await admins.countAdmins(), 1);

    assert.equal(admins.verifyPassword('senha-muito-forte', admin.password_hash), true);
    assert.equal(admins.verifyPassword('senha-errada', admin.password_hash), false);

    const sessionId = await admins.createSession(admin.id, 12);
    const session = await admins.findSession(sessionId);
    assert.ok(session, 'sessao deveria existir');
    assert.equal(session.username, 'chefe');

    await admins.destroySession(sessionId);
    assert.equal(await admins.findSession(sessionId), null);
  });

  await check('tentativas de login sao contadas e limpas', async () => {
    await admins.recordLoginAttempt('198.51.100.7', 'chefe');
    await admins.recordLoginAttempt('198.51.100.7', 'chefe');
    assert.equal(await admins.countLoginAttempts('198.51.100.7', 15), 2);

    await admins.clearLoginAttempts('198.51.100.7');
    assert.equal(await admins.countLoginAttempts('198.51.100.7', 15), 0);
  });

  await check('painel altera meta e valores rapidos', async () => {
    const result = await updateCampaignSettings({
      goal_cents: 300000,
      quick_amounts: [100, 500, 1000],
      campaign_title: 'Novo titulo',
      chave_invalida: 'x',
    });
    assert.ok(result.updated.includes('goal_cents'));
    assert.ok(result.rejected.includes('chave_invalida'));

    const campaign = await getCampaignState();
    assert.equal(campaign.goalCents, 300000);
    assert.deepEqual(campaign.donation.quickAmounts, [100, 500, 1000]);
    assert.equal(campaign.title, 'Novo titulo');
  });

  await check('meta atingida limita a barra em 100%', async () => {
    await updateCampaignSettings({ goal_cents: 1000 });
    const campaign = await getCampaignState();
    assert.equal(campaign.goalReached, true);
    assert.equal(campaign.percent, 200);
    assert.equal(campaign.percentCapped, 100);
    assert.equal(campaign.remainingCents, 0);
  });

  await closeDb();
}

/* ------------------------------------------------------------------ SQLite */
const tempFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'campanha-')), 'teste.db');
setDriver(createSqliteDriver({ file: tempFile }));
await runSuite('SQLite (local / VPS)');
fs.rmSync(path.dirname(tempFile), { recursive: true, force: true });

/* ---------------------------------------------------------------- Postgres */
try {
  const { PGlite } = await import('@electric-sql/pglite');
  const pglite = new PGlite();
  setDriver(createPostgresDriver({ client: pglite }));
  await runSuite('PostgreSQL / Supabase (via PGlite)');
} catch (error) {
  console.log('\n=== PostgreSQL ===');
  console.log(`  pulado: ${error.message}`);
  console.log('  (instale as dependencias de desenvolvimento: npm install)');
}

console.log(`\n${checks - failures}/${checks} verificacoes passaram.`);
process.exit(failures ? 1 : 0);
