/**
 * Conexao com o banco (SQLite via modulo nativo do Node: node:sqlite).
 *
 * Nao existe dependencia nativa para compilar - o driver ja vem no Node 22.5+.
 * Para trocar por Postgres/MySQL no futuro basta reimplementar os
 * repositorios em backend/database/repositories.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../config/env.js';
import { CAMPAIGN_DEFAULTS } from '../config/campaign.defaults.js';

const here = path.dirname(fileURLToPath(import.meta.url));

let db = null;

/** Abre (e prepara) a conexao. Idempotente. */
export function getDb() {
  if (db) return db;

  fs.mkdirSync(path.dirname(config.databaseFile), { recursive: true });
  db = new DatabaseSync(config.databaseFile);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  return db;
}

/** Cria as tabelas (CREATE TABLE IF NOT EXISTS) e semeia as configuracoes. */
export function migrate() {
  const database = getDb();
  const schema = fs.readFileSync(path.join(here, 'schema.sql'), 'utf8');
  database.exec(schema);
  seedSettings();
  return database;
}

/** Insere apenas as chaves de configuracao que ainda nao existem. */
export function seedSettings() {
  const database = getDb();
  const insert = database.prepare(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
  );
  for (const [key, value] of Object.entries(CAMPAIGN_DEFAULTS)) {
    insert.run(key, String(value));
  }
}

/** Executa um callback dentro de uma transacao. */
export function transaction(fn) {
  const database = getDb();
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = fn(database);
    database.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      database.exec('ROLLBACK');
    } catch {
      /* a transacao ja pode ter sido desfeita */
    }
    throw error;
  }
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
