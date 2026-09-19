/**
 * Testa a aplicacao no MESMO formato em que ela roda na Vercel:
 * a funcao serverless de api/index.js, com PostgreSQL por tras.
 *
 *   npm run test:api
 *
 * O Postgres aqui e o PGlite (Postgres compilado para WebAssembly), entao o
 * teste roda sem servidor de banco instalado. O que ele prova:
 *
 *   - api/index.js funciona como handler (req, res), que e o que a Vercel espera;
 *   - todas as rotas respondem com Postgres, nao so com SQLite;
 *   - as regras de seguranca continuam valendo: webhook falso nao credita,
 *     rota do painel exige sessao, cron exige segredo.
 */
import http from 'node:http';
import assert from 'node:assert/strict';

process.env.CRON_SECRET = 'segredo-de-teste-do-cron';
process.env.SESSION_SECRET = 'sessao-de-teste-com-tamanho-suficiente-aqui';

const { setDriver, migrate, closeDb } = await import('../backend/database/db.js');
const { createPostgresDriver } = await import('../backend/database/drivers/postgres.js');
const { createAdmin } = await import('../backend/database/repositories/admin.repo.js');

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

/* ---------------------------------------------- Postgres (PGlite) + app */
const { PGlite } = await import('@electric-sql/pglite');
setDriver(createPostgresDriver({ client: new PGlite() }));
await migrate();
await createAdmin('chefe', 'senha-de-teste-123');

// Exatamente o mesmo modulo que a Vercel executa.
const { default: app } = await import('../api/index.js');

const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, resolve));
const base = `http://127.0.0.1:${server.address().port}`;

let cookie = '';

async function call(path, { method = 'GET', body = null, headers = {} } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];

  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  return { status: response.status, data };
}

console.log('\n=== Funcao serverless (api/index.js) + PostgreSQL ===');

await check('healthcheck responde apontando para o Postgres', async () => {
  const { status, data } = await call('/api/health');
  assert.equal(status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.database, 'postgres');
});

await check('campanha publica carrega com a meta de R$ 2.000', async () => {
  const { status, data } = await call('/api/campaign');
  assert.equal(status, 200);
  assert.equal(data.campaign.goalCents, 200000);
  assert.equal(data.campaign.raisedCents, 0);
  assert.equal(data.campaign.donation.quickAmounts.length, 9);
});

await check('doacao abaixo do minimo e recusada pelo backend', async () => {
  const { status, data } = await call('/api/donations', {
    method: 'POST',
    body: { amount: '0,50', payerName: 'Joao Silva', document: '52998224725' },
  });
  assert.equal(status, 400);
  assert.equal(data.error.code, 'VALIDATION_ERROR');
});

await check('CPF invalido e recusado pelo backend', async () => {
  const { status, data } = await call('/api/donations', {
    method: 'POST',
    body: { amount: '20', payerName: 'Joao Silva', document: '12345678900' },
  });
  assert.equal(status, 400);
  assert.equal(data.error.details.field, 'document');
});

await check('rota do painel exige sessao', async () => {
  const { status } = await call('/api/admin/overview');
  assert.equal(status, 401);
});

await check('webhook falso nao credita nada', async () => {
  const { status, data } = await call('/api/webhooks/misticpay', {
    method: 'POST',
    body: { transactionId: 99999999, status: 'COMPLETO', value: 200000 },
  });
  assert.equal(status, 200);
  assert.equal(data.handled, false);

  const campaign = await call('/api/campaign');
  assert.equal(campaign.data.campaign.raisedCents, 0, 'total tem que continuar zerado');
});

await check('cron exige o segredo', async () => {
  const semSegredo = await call('/api/cron/reconcile');
  assert.equal(semSegredo.status, 401);

  const comSegredo = await call('/api/cron/reconcile', {
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  assert.equal(comSegredo.status, 200);
  assert.equal(comSegredo.data.ok, true);
});

await check('login do painel funciona e abre sessao', async () => {
  const errado = await call('/api/admin/login', {
    method: 'POST',
    body: { username: 'chefe', password: 'senha-errada' },
  });
  assert.equal(errado.status, 401);

  const certo = await call('/api/admin/login', {
    method: 'POST',
    body: { username: 'chefe', password: 'senha-de-teste-123' },
  });
  assert.equal(certo.status, 200);

  const overview = await call('/api/admin/overview');
  assert.equal(overview.status, 200);
  assert.equal(overview.data.campaign.goalCents, 200000);
});

await check('painel altera a meta da campanha', async () => {
  const { status } = await call('/api/admin/settings', {
    method: 'PUT',
    body: { goal_cents: 250000 },
  });
  assert.equal(status, 200);

  const campaign = await call('/api/campaign');
  assert.equal(campaign.data.campaign.goalCents, 250000);

  await call('/api/admin/settings', { method: 'PUT', body: { goal_cents: 200000 } });
});

await check('doacao externa entra no total e pode ser removida', async () => {
  const criada = await call('/api/admin/donations/manual', {
    method: 'POST',
    body: { amount: '75,50', name: 'Tia Zuleide', note: 'Pix direto na chave' },
  });
  assert.equal(criada.status, 201);
  assert.equal(criada.data.bySource.MANUAL.cents, 7550);

  const campaign = await call('/api/campaign');
  assert.equal(campaign.data.campaign.raisedCents, 7550);
  assert.equal(campaign.data.supporters[0].name, 'Tia Z.');

  const removida = await call(
    `/api/admin/donations/${encodeURIComponent(criada.data.donation.transaction_id)}`,
    { method: 'DELETE' }
  );
  assert.equal(removida.status, 200);

  const depois = await call('/api/campaign');
  assert.equal(depois.data.campaign.raisedCents, 0);
});

await check('credenciais do gateway pelo painel, sempre mascaradas', async () => {
  const salvou = await call('/api/admin/gateway', {
    method: 'PUT',
    body: { publicKey: 'pk_teste_abcdef123456', secretKey: 'sk_teste_zyxwvu987654' },
  });
  assert.equal(salvou.status, 200);

  const status = await call('/api/admin/gateway');
  assert.equal(status.data.configured, true);
  assert.equal(status.data.usingAccessKey, true);

  const corpo = JSON.stringify(status.data);
  assert.ok(!corpo.includes('sk_teste_zyxwvu987654'), 'o segredo NAO pode voltar para a tela');
  assert.ok(corpo.includes('sk_tes'), 'a versao mascarada deveria aparecer');

  await call('/api/admin/gateway', {
    method: 'PUT',
    body: { publicKey: '', secretKey: '' },
  });
});

await check('pagina da campanha e do painel sao servidas', async () => {
  const home = await call('/');
  assert.equal(home.status, 200);
  assert.ok(String(home.data).includes('AJUDE A PÁGINA'));

  const admin = await call('/admin');
  assert.equal(admin.status, 200);
  assert.ok(String(admin.data).includes('Painel da campanha'));
});

server.close();
await closeDb();

console.log(`\n${checks - failures}/${checks} verificacoes passaram.`);
process.exit(failures ? 1 : 0);
