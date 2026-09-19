/**
 * Regras da campanha: meta, progresso, textos e lista publica de apoiadores.
 *
 * O total arrecadado vem SEMPRE de um SUM no banco sobre doacoes com
 * status = 'PAID'. Nao existe nenhum caminho em que o frontend consiga
 * alterar esse numero.
 */
import { getAllSettings, setSettings } from '../database/repositories/settings.repo.js';
import {
  getTotals,
  listRecentPaid,
  getTopDonation,
  countByStatus,
} from '../database/repositories/donations.repo.js';
import { progressPercent } from '../utils/money.js';
import { cleanText, cleanMultiline, cleanImageUrl, publicDisplayName } from '../utils/sanitize.js';
import config from '../config/env.js';

const MIN_ABSOLUTE_CENTS = 100; // R$ 1,00 - piso do Pix nesta campanha
const MAX_ABSOLUTE_CENTS = 100000; // R$ 1.000,00 - teto por doacao

function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseQuickAmounts(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => toInt(item, 0))
      .filter((cents) => cents > 0)
      .slice(0, 12);
  } catch {
    return [];
  }
}

/** Limites vigentes da doacao (settings, com teto/piso absolutos). */
export function getDonationLimits() {
  const settings = getAllSettings();
  const min = Math.max(MIN_ABSOLUTE_CENTS, toInt(settings.min_cents, config.campaign.minCents));
  const max = Math.min(MAX_ABSOLUTE_CENTS, toInt(settings.max_cents, config.campaign.maxCents));
  return { minCents: min, maxCents: Math.max(min, max) };
}

/** Estado completo da campanha (usado pela home e pelo painel). */
export function getCampaignState() {
  const settings = getAllSettings();
  const { raisedCents, supporters } = getTotals();
  const goalCents = Math.max(1, toInt(settings.goal_cents, config.campaign.goalCents));
  const { minCents, maxCents } = getDonationLimits();

  const percent = progressPercent(raisedCents, goalCents);
  const remainingCents = Math.max(0, goalCents - raisedCents);

  return {
    projectName: settings.project_name,
    title: settings.campaign_title,
    description: settings.campaign_description,
    text: settings.campaign_text,
    device: {
      name: settings.device_name,
      text: settings.device_text,
      image: settings.campaign_image,
    },
    goalCents,
    raisedCents,
    remainingCents,
    supporters,
    percent: Number(percent.toFixed(2)),
    percentCapped: Number(Math.min(100, percent).toFixed(2)),
    goalReached: raisedCents >= goalCents,
    goalReachedTitle: settings.goal_reached_title,
    goalReachedText: settings.goal_reached_text,
    donation: {
      minCents,
      maxCents,
      quickAmounts: parseQuickAmounts(settings.quick_amounts),
    },
  };
}

/** Apoiadores para a vitrine publica - sem nenhum dado sensivel. */
export function getPublicSupporters(limit = 20) {
  return listRecentPaid(limit).map((item) => ({
    name: item.name ? publicDisplayName(item.name) : null,
    amount: Number(item.amount),
    message: item.message ? cleanText(item.message, 140) : null,
    paidAt: item.paid_at,
  }));
}

export function getHighlight() {
  const top = getTopDonation();
  if (!top) return null;
  return {
    name: top.name ? publicDisplayName(top.name) : null,
    amount: Number(top.amount),
    paidAt: top.paid_at,
  };
}

/** Numeros do painel administrativo. */
export function getAdminOverview() {
  const campaign = getCampaignState();
  return { campaign, counts: countByStatus() };
}

/** Campos que o painel pode alterar, com o saneamento de cada um. */
const SETTING_SANITIZERS = {
  project_name: (value) => cleanText(value, 60),
  campaign_title: (value) => cleanText(value, 120),
  campaign_description: (value) => cleanText(value, 300),
  campaign_text: (value) => cleanMultiline(value, 4000),
  device_name: (value) => cleanText(value, 120),
  device_text: (value) => cleanMultiline(value, 600),
  campaign_image: (value) => cleanImageUrl(value),
  goal_reached_title: (value) => cleanText(value, 120),
  goal_reached_text: (value) => cleanText(value, 300),
  goal_cents: (value) => {
    const cents = toInt(value, null);
    if (cents === null || cents < 100) return null; // meta minima R$ 1,00
    return String(Math.min(cents, 100000000)); // teto de sanidade: R$ 1.000.000
  },
  min_cents: (value) => {
    const cents = toInt(value, null);
    if (cents === null) return null;
    return String(Math.max(MIN_ABSOLUTE_CENTS, Math.min(cents, MAX_ABSOLUTE_CENTS)));
  },
  max_cents: (value) => {
    const cents = toInt(value, null);
    if (cents === null) return null;
    return String(Math.max(MIN_ABSOLUTE_CENTS, Math.min(cents, MAX_ABSOLUTE_CENTS)));
  },
  quick_amounts: (value) => {
    const list = Array.isArray(value) ? value : parseQuickAmounts(value);
    const cleaned = [...new Set(list.map((item) => toInt(item, 0)))]
      .filter((cents) => cents >= MIN_ABSOLUTE_CENTS && cents <= MAX_ABSOLUTE_CENTS)
      .sort((a, b) => a - b)
      .slice(0, 12);
    return cleaned.length ? JSON.stringify(cleaned) : null;
  },
};

/**
 * Atualiza as configuracoes da campanha.
 * Retorna { updated: string[], rejected: string[] }.
 */
export function updateCampaignSettings(payload) {
  const updates = {};
  const rejected = [];

  for (const [key, rawValue] of Object.entries(payload ?? {})) {
    const sanitize = SETTING_SANITIZERS[key];
    if (!sanitize) {
      rejected.push(key);
      continue;
    }
    const value = sanitize(rawValue);
    if (value === null || value === '') {
      rejected.push(key);
      continue;
    }
    updates[key] = value;
  }

  // min nunca pode passar o max.
  if (updates.min_cents && updates.max_cents) {
    if (Number(updates.min_cents) > Number(updates.max_cents)) {
      const min = updates.min_cents;
      updates.min_cents = updates.max_cents;
      updates.max_cents = min;
    }
  }

  if (Object.keys(updates).length) setSettings(updates);

  return { updated: Object.keys(updates), rejected };
}
