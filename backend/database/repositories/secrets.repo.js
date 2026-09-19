/**
 * Segredos cadastrados pelo painel (credenciais do gateway).
 *
 * Guardados cifrados na tabela secure_settings. O valor em texto puro so
 * existe em memoria, no momento da chamada ao gateway - nunca vai para o
 * frontend, nem para o log, nem para a exportacao CSV.
 */
import { all, one, run, sql } from '../db.js';
import { encryptSecret, decryptSecret } from '../../utils/crypto.js';

export async function setSecret(key, plainValue) {
  const s = await sql();
  await run(
    `INSERT INTO secure_settings (key, value, updated_at)
     VALUES (?, ?, ${s.now})
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = ${s.now}`,
    [key, encryptSecret(plainValue)]
  );
}

export async function getSecret(key) {
  const row = await one('SELECT value FROM secure_settings WHERE key = ?', [key]);
  if (!row?.value) return null;
  return decryptSecret(row.value);
}

export async function deleteSecret(key) {
  await run('DELETE FROM secure_settings WHERE key = ?', [key]);
}

/** Quais chaves existem e quando foram atualizadas (sem devolver o valor). */
export async function listSecretKeys() {
  return all('SELECT key, updated_at FROM secure_settings ORDER BY key');
}

/** Busca varias de uma vez, ja decifradas. */
export async function getSecrets(keys) {
  const output = {};
  for (const key of keys) output[key] = await getSecret(key);
  return output;
}
