/**
 * Repositorio das configuracoes da campanha (tabela chave/valor).
 */
import { all, one, run, sql } from '../db.js';
import { CAMPAIGN_DEFAULTS } from '../../config/campaign.defaults.js';

/** Todas as configuracoes, com fallback para os valores padrao. */
export async function getAllSettings() {
  const rows = await all('SELECT key, value FROM settings');
  const settings = { ...CAMPAIGN_DEFAULTS };
  for (const item of rows) settings[item.key] = item.value;
  return settings;
}

export async function getSetting(key, fallback = null) {
  const result = await one('SELECT value FROM settings WHERE key = ?', [key]);
  if (result?.value !== undefined) return result.value;
  return CAMPAIGN_DEFAULTS[key] ?? fallback;
}

export async function setSetting(key, value) {
  const s = await sql();
  await run(
    `INSERT INTO settings (key, value, updated_at)
     VALUES (?, ?, ${s.now})
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = ${s.now}`,
    [key, String(value)]
  );
}

export async function setSettings(entries) {
  for (const [key, value] of Object.entries(entries)) await setSetting(key, value);
}
