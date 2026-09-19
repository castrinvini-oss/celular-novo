/**
 * Controlador da página da campanha.
 *
 * Fluxo: escolher valor → gerar Pix → pagar → confirmação automática.
 * Nada aqui decide se um pagamento foi feito: o status vem sempre do backend,
 * que por sua vez confirma na MisticPay.
 */
import api from './api.js';
import {
  formatBRL,
  formatBRLShort,
  formatPercent,
  maskCurrencyInput,
  centsFromMasked,
  maskCPF,
  isValidCPF,
  timeAgo,
  initials,
} from './format.js';
import { toast, copyToClipboard, countUp, observeReveals, celebrate } from './ui.js';

const STATUS_POLL_MS = 4500;
const CAMPAIGN_REFRESH_MS = 25000;

const state = {
  campaign: null,
  previousRaised: 0,
  selectedCents: 0,
  donation: null,
  pollTimer: null,
  campaignTimer: null,
  submitting: false,
  celebratedGoal: false,
};

/* ------------------------------------------------------------- Utilitários */
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const el = (name) => $(`[data-el="${name}"]`);
const bind = (name) => $$(`[data-bind="${name}"]`);

function setText(name, value) {
  bind(name).forEach((node) => {
    node.textContent = value;
  });
}

function setFieldError(field, message = '') {
  const holder = $(`[data-error="${field}"]`);
  if (holder) holder.textContent = message;
  const input = el(field);
  if (input) input.classList.toggle('is-invalid', Boolean(message));
}

function clearErrors() {
  $$('[data-error]').forEach((node) => {
    node.textContent = '';
  });
  $$('.input').forEach((node) => node.classList.remove('is-invalid'));
}

/* --------------------------------------------------------- Render campanha */
function renderCampaignTexts(campaign) {
  setText('projectName', campaign.projectName);
  setText('campaignTitle', campaign.title);
  setText('campaignDescription', campaign.description);
  setText('deviceName', campaign.device.name);
  setText('deviceText', campaign.device.text);
  setText('goalReachedTitle', campaign.goalReachedTitle);
  setText('goalReachedText', campaign.goalReachedText);

  document.title = `${campaign.projectName} · Ajude a página a crescer ❤️`;

  const image = el('deviceImage') ?? $('[data-bind="deviceImage"]');
  if (image && campaign.device.image) {
    image.src = campaign.device.image;
    image.alt = campaign.device.name;
  }

  // Texto longo: um <p> por parágrafo, sempre via textContent (sem HTML).
  const story = $('[data-bind="campaignText"]');
  if (story) {
    story.replaceChildren(
      ...String(campaign.text)
        .split(/\n{2,}/)
        .filter(Boolean)
        .map((paragraph) => {
          const node = document.createElement('p');
          node.textContent = paragraph.trim();
          return node;
        })
    );
  }
}

function renderCampaignNumbers(campaign, { animate = true } = {}) {
  const previous = state.previousRaised;

  setText('goal', formatBRL(campaign.goalCents));
  setText('goalInline', formatBRL(campaign.goalCents));
  setText('goalShort', formatBRLShort(campaign.goalCents));
  setText('remaining', formatBRL(campaign.remainingCents));
  setText('supporters', String(campaign.supporters));
  setText('percent', formatPercent(campaign.percentCapped));
  setText('minAmount', formatBRL(campaign.donation.minCents));
  setText('maxAmount', formatBRL(campaign.donation.maxCents));

  const raisedNodes = bind('raised');
  const shortNodes = bind('raisedShort');

  if (animate && previous !== campaign.raisedCents) {
    raisedNodes.forEach((node) => countUp(node, previous, campaign.raisedCents, formatBRL));
    shortNodes.forEach((node) => countUp(node, previous, campaign.raisedCents, formatBRLShort));
  } else {
    raisedNodes.forEach((node) => {
      node.textContent = formatBRL(campaign.raisedCents);
    });
    shortNodes.forEach((node) => {
      node.textContent = formatBRLShort(campaign.raisedCents);
    });
  }

  setText(
    'percentLong',
    campaign.goalReached
      ? '100% da meta alcançada 🎉'
      : `${formatPercent(campaign.percentCapped)} da meta alcançada${
          campaign.percentCapped >= 25 ? ' 🎉' : ''
        }`
  );

  // A barra visual nunca passa de 100%.
  const fill = el('progressFill');
  if (fill) fill.style.width = `${Math.min(100, campaign.percentCapped)}%`;

  const bar = el('progressBar');
  if (bar) bar.setAttribute('aria-valuenow', String(Math.min(100, campaign.percentCapped)));

  const banner = el('goalBanner');
  const card = el('progressCard');
  if (banner) banner.classList.toggle('hidden', !campaign.goalReached);
  if (card) card.classList.toggle('is-complete', campaign.goalReached);

  if (campaign.goalReached && !state.celebratedGoal) {
    state.celebratedGoal = true;
    celebrate({ pieces: 180, duration: 4200 });
  }

  state.previousRaised = campaign.raisedCents;
}

function renderQuickAmounts(campaign) {
  const holder = el('quickAmounts');
  if (!holder) return;

  holder.replaceChildren(
    ...campaign.donation.quickAmounts.map((cents) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'amount';
      button.dataset.cents = String(cents);
      button.textContent = formatBRLShort(cents);
      button.addEventListener('click', () => selectAmount(cents));
      return button;
    })
  );
}

function renderSupporters(supporters) {
  const holder = el('supporters');
  if (!holder) return;

  if (!supporters?.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Seja a primeira pessoa a apoiar essa campanha ❤️';
    holder.replaceChildren(empty);
    return;
  }

  holder.replaceChildren(
    ...supporters.map((item, index) => {
      const row = document.createElement('div');
      row.className = 'supporter';
      row.style.animationDelay = `${Math.min(index * 60, 480)}ms`;

      const avatar = document.createElement('div');
      avatar.className = 'supporter__avatar';
      avatar.setAttribute('aria-hidden', 'true');
      avatar.textContent = item.name ? initials(item.name) : '❤';

      const info = document.createElement('div');
      const name = document.createElement('span');
      name.className = 'supporter__name';
      name.textContent = `❤️ ${item.name ?? 'Apoiador anônimo'}`;
      info.appendChild(name);

      const detail = document.createElement('small');
      detail.className = 'supporter__msg';
      detail.textContent = item.message ? item.message : timeAgo(item.paidAt);
      info.appendChild(detail);

      const amount = document.createElement('span');
      amount.className = 'supporter__amount';
      amount.textContent = formatBRL(item.amount);

      row.append(avatar, info, amount);
      return row;
    })
  );
}

/* -------------------------------------------------------------- Navegação */
function setStep(step) {
  $$('[data-panel]').forEach((panel) => {
    panel.classList.toggle('hidden', panel.dataset.panel !== step);
  });

  const order = ['form', 'pix', 'success'];
  const currentIndex = order.indexOf(step);

  $$('[data-step]').forEach((item) => {
    const index = order.indexOf(item.dataset.step);
    item.classList.toggle('is-active', index === currentIndex);
    item.classList.toggle('is-done', index < currentIndex);
  });

  const section = document.getElementById('doar');
  if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function selectAmount(cents) {
  state.selectedCents = cents;

  $$('.amount').forEach((button) => {
    button.classList.toggle('is-selected', Number(button.dataset.cents) === cents);
  });

  const input = el('customAmount');
  if (input) input.value = formatBRL(cents);
  setFieldError('amount', '');
}

/* ------------------------------------------------------------ Validação */
function validateForm() {
  clearErrors();

  const campaign = state.campaign;
  const cents = state.selectedCents;
  let valid = true;

  if (!cents) {
    setFieldError('amount', 'Escolha ou digite um valor.');
    valid = false;
  } else if (cents < campaign.donation.minCents) {
    setFieldError('amount', `O valor mínimo é ${formatBRL(campaign.donation.minCents)}.`);
    valid = false;
  } else if (cents > campaign.donation.maxCents) {
    setFieldError('amount', `O valor máximo por doação é ${formatBRL(campaign.donation.maxCents)}.`);
    valid = false;
  }

  const payerName = el('payerName').value.trim();
  if (payerName.length < 3 || !payerName.includes(' ')) {
    setFieldError('payerName', 'Digite seu nome e sobrenome.');
    valid = false;
  }

  const document_ = el('document').value;
  if (!isValidCPF(document_)) {
    setFieldError('document', 'CPF inválido.');
    valid = false;
  }

  return valid;
}

/* ------------------------------------------------------------- Pagamento */
function stopPolling() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

function setPaymentStatus(status) {
  const pill = el('statusPill');
  const text = el('statusText');
  if (!pill || !text) return;

  const spinner = pill.querySelector('.spinner');

  const labels = {
    PENDING: '🟡 Aguardando pagamento...',
    PAID: '🟢 Pagamento confirmado!',
    EXPIRED: '⌛ Pix expirado. Gere outro para continuar.',
    CANCELLED: '❌ Cobrança cancelada.',
    FAILED: '❌ O pagamento falhou.',
  };

  pill.className = 'status-pill';
  if (status === 'PAID') pill.classList.add('status-pill--paid');
  else if (status === 'PENDING') pill.classList.add('status-pill--pending');
  else pill.classList.add('status-pill--failed');

  if (spinner) spinner.classList.toggle('hidden', status !== 'PENDING');
  text.textContent = labels[status] ?? status;
}

function showPixPanel(donation) {
  state.donation = donation;

  setText('pixAmount', formatBRL(donation.amount));

  const qr = el('pixQr');
  const qrWrapper = el('pixQrWrapper');
  const source = donation.pix.qrCodeBase64 || donation.pix.qrCodeUrl;

  if (qr && source) {
    qr.src = source;
    qrWrapper?.classList.remove('hidden');
  } else {
    qrWrapper?.classList.add('hidden');
  }

  const code = el('pixCode');
  if (code) code.textContent = donation.pix.copyPaste ?? '';

  const expiresAt = donation.expiresAt ? new Date(`${donation.expiresAt.replace(' ', 'T')}Z`) : null;
  const minutes = expiresAt
    ? Math.max(1, Math.round((expiresAt.getTime() - Date.now()) / 60000))
    : 30;
  setText('pixExpiration', String(minutes));

  setPaymentStatus(donation.status);
  setStep('pix');
  startPolling(donation.transactionId);
}

function startPolling(transactionId) {
  stopPolling();
  const startedAt = Date.now();

  state.pollTimer = setInterval(async () => {
    // Para de consultar depois de 35 minutos (o Pix já terá expirado).
    if (Date.now() - startedAt > 35 * 60 * 1000) {
      stopPolling();
      return;
    }

    try {
      const result = await api.getDonationStatus(transactionId);
      const status = result.donation.status;

      if (status === 'PAID') {
        stopPolling();
        onDonationConfirmed(result.donation, result.campaign);
        return;
      }

      setPaymentStatus(status);
      if (status !== 'PENDING') stopPolling();

      if (result.campaign) {
        state.campaign = result.campaign;
        renderCampaignNumbers(result.campaign);
      }
    } catch {
      // Falha momentânea de rede não interrompe o acompanhamento.
    }
  }, STATUS_POLL_MS);
}

function onDonationConfirmed(donation, campaign) {
  setPaymentStatus('PAID');

  state.campaign = campaign;
  renderCampaignNumbers(campaign);

  setText('successAmount', formatBRL(donation.amount));
  setText('successTotal', formatBRL(campaign.raisedCents));
  setText('successPercent', formatPercent(campaign.percentCapped));

  setStep('success');
  celebrate();
  toast('Doação confirmada! Muito obrigado ❤️', 'success');

  api.getSupporters(12).then((data) => renderSupporters(data.supporters)).catch(() => {});
}

/* ---------------------------------------------------------------- Ações */
async function handleSubmit(event) {
  event.preventDefault();
  if (state.submitting) return;
  if (!validateForm()) {
    toast('Confira os campos destacados 👀', 'error');
    return;
  }

  const button = el('submitButton');
  state.submitting = true;
  button.disabled = true;
  const originalLabel = button.textContent;
  button.textContent = 'Gerando seu Pix...';

  try {
    const payload = {
      amount: state.selectedCents / 100,
      payerName: el('payerName').value.trim(),
      document: el('document').value.replace(/\D/g, ''),
      displayName: el('displayName').value.trim(),
      message: el('message').value.trim(),
      anonymous: el('anonymous').checked,
    };

    const result = await api.createDonation(payload);
    state.campaign = result.campaign;
    renderCampaignNumbers(result.campaign, { animate: false });
    showPixPanel(result.donation);
  } catch (error) {
    if (error.details?.field) setFieldError(error.details.field, error.message);
    toast(error.message, 'error');
  } finally {
    state.submitting = false;
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

async function handleCopyPix() {
  const code = state.donation?.pix?.copyPaste;
  if (!code) return;
  const ok = await copyToClipboard(code);
  toast(ok ? 'Código Pix copiado! 📋' : 'Não consegui copiar — selecione o código manualmente.', ok ? 'success' : 'error');
}

async function handleShare() {
  const shareData = {
    title: state.campaign?.projectName ?? 'Ajude a página a crescer',
    text: `${state.campaign?.title ?? 'Ajude a página'} — meta de ${formatBRLShort(
      state.campaign?.goalCents ?? 200000
    )} 📱❤️`,
    url: window.location.origin,
  };

  if (navigator.share) {
    try {
      await navigator.share(shareData);
      return;
    } catch {
      return; // usuário cancelou
    }
  }

  const ok = await copyToClipboard(window.location.origin);
  toast(ok ? 'Link copiado! Manda pros amigos ❤️' : 'Copie o link da barra do navegador.', ok ? 'success' : 'error');
}

function restart() {
  state.donation = null;
  state.selectedCents = 0;
  stopPolling();

  el('donationForm')?.reset();
  $$('.amount').forEach((button) => button.classList.remove('is-selected'));
  clearErrors();
  setStep('form');
  refreshCampaign();
}

/* --------------------------------------------------------------- Boot */
async function refreshCampaign({ animate = true } = {}) {
  try {
    const data = await api.getCampaign();
    state.campaign = data.campaign;
    renderCampaignTexts(data.campaign);
    renderCampaignNumbers(data.campaign, { animate });
    renderSupporters(data.supporters);
    return data.campaign;
  } catch {
    return null;
  }
}

function wireEvents() {
  el('donationForm')?.addEventListener('submit', handleSubmit);

  // Máscara de moeda no campo de valor personalizado.
  const amountInput = el('customAmount');
  amountInput?.addEventListener('input', (event) => {
    const { text, cents } = maskCurrencyInput(event.target.value);
    event.target.value = text;
    state.selectedCents = cents;
    $$('.amount').forEach((button) => {
      button.classList.toggle('is-selected', Number(button.dataset.cents) === cents);
    });
    setFieldError('amount', '');
  });

  amountInput?.addEventListener('blur', (event) => {
    const cents = centsFromMasked(event.target.value);
    if (cents) event.target.value = formatBRL(cents);
  });

  // Máscara de CPF.
  el('document')?.addEventListener('input', (event) => {
    event.target.value = maskCPF(event.target.value);
  });

  // Ações declarativas.
  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-action]');
    if (!trigger) return;

    const action = trigger.dataset.action;
    if (action === 'copy-pix') handleCopyPix();
    if (action === 'share') handleShare();
    if (action === 'restart') restart();
    if (action === 'back-to-form') {
      stopPolling();
      setStep('form');
    }
    if (action === 'copy-link') {
      copyToClipboard(window.location.origin).then((ok) =>
        toast(ok ? 'Link copiado! ❤️' : 'Copie o link da barra do navegador.', ok ? 'success' : 'error')
      );
    }
    if (action === 'scroll-to-donate') {
      event.preventDefault();
      setStep(state.donation && state.donation.status === 'PENDING' ? 'pix' : 'form');
    }
  });

  // Link do WhatsApp.
  const whatsapp = el('whatsappLink');
  if (whatsapp) {
    const text = encodeURIComponent(
      `Bora ajudar a página a comprar um celular novo? ❤️📱 ${window.location.origin}`
    );
    whatsapp.href = `https://wa.me/?text=${text}`;
  }

  // Ao voltar para a aba, revalida o status na hora.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.donation?.status === 'PENDING') {
      startPolling(state.donation.transactionId);
    }
  });
}

async function init() {
  wireEvents();
  observeReveals();

  const campaign = await refreshCampaign({ animate: false });
  if (campaign) {
    renderQuickAmounts(campaign);
    observeReveals();
  } else {
    toast('Não consegui carregar a campanha. Atualize a página.', 'error');
  }

  state.campaignTimer = setInterval(() => {
    if (document.visibilityState === 'visible' && !state.donation) refreshCampaign();
  }, CAMPAIGN_REFRESH_MS);
}

init();
