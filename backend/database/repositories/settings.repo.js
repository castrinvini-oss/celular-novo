/**
 * Repositorio das configuracoes da campanha (tabela chave/valor).
 */
import { getDb } from '../db.js';
import { CAMPAIGN_DEFAULTS } from '../../config/campaign.defaults.js';

/** Todas as configuracoes, com fallback para os valores padrao. */
export function getAllSettings() {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = { ...CAMPAIGN_DEFAULTS };
  for (const item of rows) settings[item.key] = item.value;
  return settings;
}

export function getSetting(key, fallback = null) {
  const db = getDb();
  const result = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (result?.value !== undefined) return result.value;
  return CAMPAIGN_DEFAULTS[key] ?? fallback;
}

export function setSetting(key, value) {
  const db = getDb();
  db.prepare(
    `INSERT INTO settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).run(key, String(value));
}

export function setSettings(entries) {
  for (const [key, value] of Object.entries(entries)) setSetting(key, value);
}
