/**
 * Painel administrativo.
 *
 * A sessão vive num cookie HttpOnly assinado pelo backend — o JavaScript não
 * guarda token nenhum. Qualquer 401 devolve o usuário para a tela de login.
 */
import { formatBRL, formatPercent, timeAgo } from './format.js';
import { toast } from './ui.js';

const state = {
  filter: 'ALL',
  page: 1,
  search: '',
  settings: null,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const el = (name) => $(`[data-el="${name}"]`);

function setText(name, value) {
  $$(`[data-bind="${name}"]`).forEach((node) => {
    node.textContent = value;
  });
}

/* ------------------------------------------------------------ API helper */
async function request(path, { method = 'GET', body = null } = {}) {
  const response = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (response.status === 401) {
    showLogin();
    throw new Error(data?.error?.message ?? 'Sessão expirada.');
  }

  if (!response.ok) {
    throw new Error(data?.error?.message ?? 'Não foi possível concluir a operação.');
  }

  return data;
}

/* --------------------------------------------------------------- Telas */
function showLogin() {
  $('[data-view="login"]').classList.remove('hidden');
  $('[data-view="dashboard"]').classList.add('hidden');
}

function showDashboard() {
  $('[data-view="login"]').classList.add('hidden');
  $('[data-view="dashboard"]').classList.remove('hidden');
}

function showTab(name) {
  $$('[data-tab]').forEach((tab) => tab.classList.toggle('is-active', tab.dataset.tab === name));
  $$('[data-pane]').forEach((pane) => pane.classList.toggle('hidden', pane.dataset.pane !== name));
}

/* ------------------------------------------------------------- Overview */
async function loadOverview() {
  const { campaign, bySource } = await request('/api/admin/overview');
  setText('kpiGoal', formatBRL(campaign.goalCents));
  setText('kpiRaised', formatBRL(campaign.raisedCents));
  setText('kpiSupporters', String(campaign.supporters));
  setText('kpiPercent', formatPercent(campaign.percentCapped));

  // Deixa explícito quanto veio confirmado pelo gateway e quanto foi lançado
  // à mão — os dois somam o total, mas a origem nunca se mistura.
  if (bySource) {
    const manual = bySource.MANUAL?.cents ?? 0;
    setText(
      'kpiBreakdown',
      manual > 0
        ? `${formatBRL(bySource.GATEWAY.cents)} via Pix · ${formatBRL(manual)} manual`
        : 'tudo confirmado via Pix'
    );
  }
}

/* ------------------------------------------------------------- Doações */
/** Linha extra, discreta, embaixo do nome. */
function detailLine(text, { title = '' } = {}) {
  const small = document.createElement('small');
  small.className = 'muted';
  small.style.display = 'block';
  small.style.fontSize = '0.76rem';
  small.textContent = text;
  if (title) small.title = title;
  return small;
}

function donationRow(item) {
  const tr = document.createElement('tr');
  const isManual = item.source === 'MANUAL';

  // "Quem doou": nome público + nome do pagador, CPF mascarado e recado.
  const name = document.createElement('td');
  const displayName = document.createElement('strong');
  displayName.textContent = item.name || 'Apoiador anônimo';
  name.appendChild(displayName);

  if (item.payer_name && item.payer_name !== item.name) {
    name.appendChild(detailLine(item.payer_name, { title: 'Nome informado ao banco' }));
  }
  if (item.payer_document_masked) {
    name.appendChild(detailLine(`CPF ${item.payer_document_masked}`));
  }
  if (item.message) {
    name.appendChild(detailLine(`💬 ${item.message}`));
  }
  if (item.admin_note) {
    name.appendChild(detailLine(`📝 ${item.admin_note}`));
  }

  const amount = document.createElement('td');
  amount.className = 'amount';
  amount.textContent = formatBRL(item.amount);
  if (item.amount_mismatch) {
    const flag = document.createElement('span');
    flag.className = 'flag';
    flag.title = 'O valor confirmado pelo gateway não bateu com o cobrado. Confira manualmente.';
    flag.textContent = '⚠';
    amount.appendChild(flag);
  }

  const status = document.createElement('td');
  const pill = document.createElement('span');
  pill.className = `pill pill--${item.status}`;
  pill.textContent = item.status;
  status.appendChild(pill);

  const origin = document.createElement('td');
  const originPill = document.createElement('span');
  originPill.className = `pill pill--${isManual ? 'EXPIRED' : 'PAID'}`;
  originPill.textContent = isManual ? 'MANUAL' : 'PIX';
  originPill.title = isManual
    ? 'Lançado no painel — doação recebida fora da plataforma'
    : 'Confirmado pela MisticPay';
  origin.appendChild(originPill);

  const transaction = document.createElement('td');
  transaction.className = 'mono';
  transaction.title = `${item.transaction_id}${
    item.gateway_transaction_id ? ` · gateway: ${item.gateway_transaction_id}` : ''
  }`;
  transaction.textContent = item.transaction_id;

  const created = document.createElement('td');
  created.className = 'muted';
  created.textContent = timeAgo(item.created_at);

  const paid = document.createElement('td');
  paid.className = 'muted';
  paid.textContent = item.paid_at ? timeAgo(item.paid_at) : '—';

  const actions = document.createElement('td');
  if (item.status === 'PENDING') {
    const button = document.createElement('button');
    button.className = 'btn btn--sm btn--ghost';
    button.type = 'button';
    button.textContent = 'Reconferir';
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const result = await request(
          `/api/admin/donations/${encodeURIComponent(item.transaction_id)}/recheck`,
          { method: 'POST' }
        );
        toast(`Status na MisticPay: ${result.donation.status}`, 'success');
        await Promise.all([loadOverview(), loadDonations()]);
      } catch (error) {
        toast(error.message, 'error');
        button.disabled = false;
      }
    });
    actions.appendChild(button);
  }

  if (isManual) {
    const remove = document.createElement('button');
    remove.className = 'btn btn--sm btn--ghost';
    remove.type = 'button';
    remove.textContent = 'Remover';
    remove.title = 'Só lançamentos manuais podem ser removidos';
    remove.addEventListener('click', async () => {
      if (!window.confirm(`Remover o lançamento manual de ${formatBRL(item.amount)}?`)) return;
      remove.disabled = true;
      try {
        await request(`/api/admin/donations/${encodeURIComponent(item.transaction_id)}`, {
          method: 'DELETE',
        });
        toast('Lançamento removido.', 'success');
        await Promise.all([loadOverview(), loadDonations()]);
      } catch (error) {
        toast(error.message, 'error');
        remove.disabled = false;
      }
    });
    actions.appendChild(remove);
  }

  tr.append(name, amount, status, origin, transaction, created, paid, actions);
  return tr;
}

async function loadDonations() {
  const body = el('donationsBody');
  const params = new URLSearchParams({
    status: state.filter,
    page: String(state.page),
    perPage: '25',
  });
  if (state.search) params.set('search', state.search);

  try {
    const data = await request(`/api/admin/donations?${params}`);

    if (!data.items.length) {
      body.replaceChildren();
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 8;
      td.className = 'muted';
      td.style.cssText = 'text-align:center;padding:28px';
      td.textContent = 'Nenhuma doação encontrada com esse filtro.';
      tr.appendChild(td);
      body.appendChild(tr);
    } else {
      body.replaceChildren(...data.items.map(donationRow));
    }

    state.page = data.pagination.page;
    setText(
      'pageInfo',
      `Página ${data.pagination.page} de ${data.pagination.totalPages} · ${data.pagination.total} registro(s)`
    );

    const csv = el('csvLink');
    if (csv) csv.href = `/api/admin/donations.csv?status=${state.filter}`;
  } catch (error) {
    toast(error.message, 'error');
  }
}

/* -------------------------------------------------------- Configurações */
function centsToReaisText(cents) {
  const value = Number(cents || 0) / 100;
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace('.', ',');
}

function reaisTextToCents(text) {
  const normalized = String(text ?? '')
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}\b)/g, '')
    .replace(',', '.');
  const value = Number(normalized);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

async function loadSettings() {
  const { settings } = await request('/api/admin/settings');
  state.settings = settings;

  const form = el('settingsForm');
  const set = (name, value) => {
    const field = form.elements[name];
    if (field) field.value = value ?? '';
  };

  set('project_name', settings.project_name);
  set('campaign_title', settings.campaign_title);
  set('campaign_description', settings.campaign_description);
  set('campaign_text', settings.campaign_text);
  set('device_name', settings.device_name);
  set('device_text', settings.device_text);
  set('campaign_image', settings.campaign_image);
  set('goal_reached_title', settings.goal_reached_title);
  set('goal_reached_text', settings.goal_reached_text);
  set('goal_reais', centsToReaisText(settings.goal_cents));
  set('min_reais', centsToReaisText(settings.min_cents));
  set('max_reais', centsToReaisText(settings.max_cents));

  let quick = [];
  try {
    quick = JSON.parse(settings.quick_amounts);
  } catch {
    quick = [];
  }
  set('quick_reais', quick.map((cents) => centsToReaisText(cents)).join('; '));
}

async function saveSettings(event) {
  event.preventDefault();
  const form = event.target;
  const value = (name) => form.elements[name]?.value ?? '';

  const goalCents = reaisTextToCents(value('goal_reais'));
  const minCents = reaisTextToCents(value('min_reais'));
  const maxCents = reaisTextToCents(value('max_reais'));

  if (!goalCents || goalCents < 100) {
    toast('A meta precisa ser de pelo menos R$ 1,00.', 'error');
    return;
  }

  const quickAmounts = value('quick_reais')
    .split(/[;\n]/)
    .map((part) => reaisTextToCents(part))
    .filter((cents) => Number.isInteger(cents) && cents > 0);

  const payload = {
    project_name: value('project_name'),
    campaign_title: value('campaign_title'),
    campaign_description: value('campaign_description'),
    campaign_text: value('campaign_text'),
    device_name: value('device_name'),
    device_text: value('device_text'),
    campaign_image: value('campaign_image'),
    goal_reached_title: value('goal_reached_title'),
    goal_reached_text: value('goal_reached_text'),
    goal_cents: goalCents,
    min_cents: minCents,
    max_cents: maxCents,
    quick_amounts: quickAmounts,
  };

  try {
    const result = await request('/api/admin/settings', { method: 'PUT', body: payload });
    toast(`Salvo! ${result.updated.length} campo(s) atualizado(s). ✅`, 'success');
    if (result.rejected.length) {
      toast(`Ignorados (valor inválido): ${result.rejected.join(', ')}`, 'error');
    }
    await Promise.all([loadOverview(), loadSettings()]);
  } catch (error) {
    toast(error.message, 'error');
  }
}

/* ------------------------------------------------- Doação externa (manual) */
async function submitManualDonation(event) {
  event.preventDefault();
  const form = event.target;

  try {
    await request('/api/admin/donations/manual', {
      method: 'POST',
      body: {
        amount: form.elements.amount.value,
        name: form.elements.name.value,
        note: form.elements.note.value,
        message: form.elements.message.value,
        anonymous: form.elements.anonymous.checked,
      },
    });

    form.reset();
    form.closest('details')?.removeAttribute('open');
    toast('Doação registrada e somada ao total. ✅', 'success');
    await Promise.all([loadOverview(), loadDonations()]);
  } catch (error) {
    toast(error.message, 'error');
  }
}

/* ------------------------------------------------------ Integração (API) */
function describeSource(source) {
  if (source === 'env') return '· vindo do .env (não editável aqui)';
  if (source === 'painel') return '· salvo no painel';
  return '· não configurado';
}

async function loadGateway() {
  const status = await request('/api/admin/gateway');
  const form = el('gatewayForm');

  setText('gwProvider', status.provider);
  setText('gwConfigured', status.configured ? '✅ ok' : '❌ faltando');
  setText(
    'gwType',
    status.usingAccessKey ? 'chave de acesso' : status.usingLegacy ? 'legada ci/cs' : '—'
  );
  setText('gwWebhook', status.webhookUrl || '(sem URL pública configurada)');

  for (const field of status.fields) {
    const label = field.filled ? `${field.masked} ${describeSource(field.source)}` : '· vazio';
    setText(`gw${field.field.charAt(0).toUpperCase()}${field.field.slice(1)}`, label);

    const input = form.elements[field.field];
    if (input) {
      input.disabled = !field.editable;
      input.placeholder = field.editable
        ? input.placeholder.replace(' (definido no .env)', '')
        : 'definido no .env';
    }
  }

  const warning = el('gatewayWarning');
  const messages = [];

  if (!status.canStoreSecrets) {
    messages.push(
      '⚠️ Defina um SESSION_SECRET fixo no .env antes de salvar credenciais aqui: sem ele a chave de criptografia muda a cada reinício e o que for salvo se perde.'
    );
  }
  if (status.usingLegacy) {
    messages.push(
      `⚠️ Você está usando a credencial legada ci/cs, que a MisticPay desliga em ${status.legacySunset}. Migre para a chave de acesso (pk_/sk_).`
    );
  }

  warning.textContent = messages.join(' ');
  warning.classList.toggle('hidden', messages.length === 0);
}

async function saveGateway(event) {
  event.preventDefault();
  const form = event.target;

  // Campo vazio = "não mexer". Só enviamos o que foi realmente preenchido.
  const payload = {};
  for (const field of ['publicKey', 'secretKey', 'clientId', 'clientSecret', 'webhookToken']) {
    const input = form.elements[field];
    if (!input || input.disabled) continue;
    const value = input.value.trim();
    if (value !== '') payload[field] = value;
  }

  if (!Object.keys(payload).length) {
    toast('Preencha ao menos um campo para salvar.', 'error');
    return;
  }

  try {
    const result = await request('/api/admin/gateway', { method: 'PUT', body: payload });
    form.reset();
    toast(`Credenciais salvas (${result.saved.length} campo(s)). 🔐`, 'success');
    if (result.ignored.length) {
      toast(`Ignorados porque vêm do .env: ${result.ignored.join(', ')}`, 'error');
    }
    await loadGateway();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function testGateway() {
  setText('gwTest', 'testando…');
  try {
    const result = await request('/api/admin/gateway/test', { method: 'POST' });
    setText('gwTest', result.ok ? '✅ ok' : '❌ falhou');
    toast(result.message, result.ok ? 'success' : 'error');
  } catch (error) {
    setText('gwTest', '❌ falhou');
    toast(error.message, 'error');
  }
}

/* ---------------------------------------------------------------- Boot */
async function boot() {
  try {
    const me = await request('/api/admin/me');
    setText('adminUser', me.admin.username);
    showDashboard();
    await Promise.all([loadOverview(), loadDonations(), loadSettings(), loadGateway()]);
  } catch {
    showLogin();
  }
}

function wire() {
  el('loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = el('loginError');
    error.textContent = '';
    try {
      await request('/api/admin/login', {
        method: 'POST',
        body: { username: el('username').value, password: el('password').value },
      });
      el('password').value = '';
      await boot();
    } catch (loginError) {
      error.textContent = loginError.message;
    }
  });

  el('settingsForm').addEventListener('submit', saveSettings);
  el('manualForm').addEventListener('submit', submitManualDonation);
  el('gatewayForm').addEventListener('submit', saveGateway);

  el('passwordForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target;
    try {
      await request('/api/admin/password', {
        method: 'POST',
        body: {
          currentPassword: form.elements.currentPassword.value,
          newPassword: form.elements.newPassword.value,
        },
      });
      form.reset();
      toast('Senha atualizada. ✅', 'success');
    } catch (error) {
      toast(error.message, 'error');
    }
  });

  let searchTimer = null;
  el('search').addEventListener('input', (event) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.search = event.target.value.trim();
      state.page = 1;
      loadDonations();
    }, 350);
  });

  document.addEventListener('click', async (event) => {
    const tab = event.target.closest('[data-tab]');
    if (tab) showTab(tab.dataset.tab);

    const filter = event.target.closest('[data-filter]');
    if (filter) {
      state.filter = filter.dataset.filter;
      state.page = 1;
      $$('[data-filter]').forEach((chip) =>
        chip.classList.toggle('is-active', chip === filter)
      );
      loadDonations();
    }

    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action) return;

    if (action === 'logout') {
      await request('/api/admin/logout', { method: 'POST' }).catch(() => {});
      showLogin();
    }
    if (action === 'prev-page' && state.page > 1) {
      state.page -= 1;
      loadDonations();
    }
    if (action === 'next-page') {
      state.page += 1;
      loadDonations();
    }
    if (action === 'reload-settings') loadSettings();
    if (action === 'reload-gateway') loadGateway();
    if (action === 'test-gateway') testGateway();
    if (action === 'reconcile') {
      try {
        const result = await request('/api/admin/reconcile', { method: 'POST' });
        toast(
          `Reconferidas: ${result.checked} · confirmadas: ${result.confirmed} · expiradas: ${result.expired}`,
          'success'
        );
        await Promise.all([loadOverview(), loadDonations()]);
      } catch (error) {
        toast(error.message, 'error');
      }
    }
  });
}

wire();
boot();
