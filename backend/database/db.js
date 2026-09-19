/**
 * Camada de banco de dados.
 *
 * Dois drivers com a MESMA interface:
 *   - SQLite  (padrao)  -> desenvolvimento local e VPS, sem nada para instalar
 *   - Postgres          -> quando existe DATABASE_URL (Supabase, Neon, etc.)
 *
 * Os repositorios escrevem SQL com marcadores "?" e usam o objeto SQL abaixo
 * para as poucas expressoes que mudam entre os dois bancos (datas).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../config/env.js';
import { CAMPAIGN_DEFAULTS } from '../config/campaign.defaults.js';
import { createSqliteDriver } from './drivers/sqlite.js';
import { createPostgresDriver } from './drivers/postgres.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Expressoes de data por dialeto.
 *
 * Os minutos sao sempre inteiros gerados por nos (nunca vem do usuario), e o
 * sinal e normalizado aqui: o SQLite rejeita modificadores como '+-5 minutes'.
 */
function signedMinutes(minutes) {
  const value = Math.trunc(Number(minutes) || 0);
  return { sign: value < 0 ? '-' : '+', abs: Math.abs(value) };
}

const DIALECTS = {
  sqlite: {
    now: "datetime('now')",
    nowPlusMinutes: (minutes) => {
      const { sign, abs } = signedMinutes(minutes);
      return `datetime('now', '${sign}${abs} minutes')`;
    },
    nowMinusMinutes: (minutes) => {
      const { sign, abs } = signedMinutes(minutes);
      return `datetime('now', '${sign === '-' ? '+' : '-'}${abs} minutes')`;
    },
    orderDate: (column) => `datetime(${column})`,
  },
  postgres: {
    now: 'now()',
    nowPlusMinutes: (minutes) => {
      const { sign, abs } = signedMinutes(minutes);
      return `(now() ${sign} interval '${abs} minutes')`;
    },
    nowMinusMinutes: (minutes) => {
      const { sign, abs } = signedMinutes(minutes);
      return `(now() ${sign === '-' ? '+' : '-'} interval '${abs} minutes')`;
    },
    orderDate: (column) => column,
  },
};

let driver = null;
let pool = null;

/** Injeta um driver pronto (usado pelos testes com PGlite). */
export function setDriver(customDriver) {
  driver = customDriver;
}

export function getDriver() {
  if (driver) return driver;

  if (config.databaseUrl) {
    // Import sincrono nao existe para ESM: o pool e criado sob demanda em
    // initDatabase(). Chegar aqui sem inicializar e erro de programacao.
    throw new Error('Banco Postgres ainda nao inicializado. Chame initDatabase() antes.');
  }

  driver = createSqliteDriver({ file: config.databaseFile });
  return driver;
}

/** Abre a conexao (cria o pool do Postgres quando for o caso). */
export async function initDatabase() {
  if (driver) return driver;

  if (config.databaseUrl) {
    const { default: pg } = await import('pg');
    pool = new pg.Pool({
      connectionString: config.databaseUrl,
      // Supabase exige TLS. O certificado e de uma CA publica, mas o pooler
      // apresenta um certificado que o Node nao valida por padrao.
      ssl: config.databaseSsl ? { rejectUnauthorized: false } : false,
      max: config.databasePoolMax,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000,
    });
    driver = createPostgresDriver({ client: pool });
  } else {
    driver = createSqliteDriver({ file: config.databaseFile });
  }

  return driver;
}

/** Atalhos usados pelos repositorios. */
export async function query(text, params = []) {
  return (await initDatabase()).query(text, params);
}

export async function all(text, params = []) {
  return (await query(text, params)).rows;
}

export async function one(text, params = []) {
  const { rows } = await query(text, params);
  return rows[0] ?? null;
}

export async function run(text, params = []) {
  return (await query(text, params)).changes;
}

/** Expressoes SQL dependentes do dialeto. */
export async function sql() {
  const current = await initDatabase();
  return DIALECTS[current.dialect];
}

export function isPostgres() {
  return Boolean(config.databaseUrl);
}

/** Cria as tabelas e semeia as configuracoes iniciais. */
export async function migrate() {
  const current = await initDatabase();
  const file = current.dialect === 'postgres' ? 'schema.postgres.sql' : 'schema.sqlite.sql';
  const schema = fs.readFileSync(path.join(here, file), 'utf8');

  await current.exec(schema);
  await applyColumnMigrations();
  await seedSettings();
  return current;
}

/**
 * Colunas adicionadas depois da primeira versao.
 *
 * CREATE TABLE IF NOT EXISTS nao altera tabela que ja existe, entao bancos
 * criados antes precisam do ALTER TABLE. Rodar de novo e inofensivo: o erro
 * de "coluna ja existe" e ignorado.
 */
const ADDED_COLUMNS = [
  ['donations', 'source', "TEXT NOT NULL DEFAULT 'GATEWAY'"],
  ['donations', 'admin_note', 'TEXT'],
];

async function applyColumnMigrations() {
  for (const [table, column, definition] of ADDED_COLUMNS) {
    try {
      await query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    } catch (error) {
      const message = String(error?.message ?? '').toLowerCase();
      const alreadyExists =
        message.includes('duplicate column') || message.includes('already exists');
      if (!alreadyExists) throw error;
    }
  }
}

/** Insere apenas as chaves de configuracao que ainda nao existem. */
export async function seedSettings() {
  for (const [key, value] of Object.entries(CAMPAIGN_DEFAULTS)) {
    await query('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING', [
      key,
      String(value),
    ]);
  }
}

export async function closeDb() {
  if (driver) {
    await driver.close();
    driver = null;
    pool = null;
  }
}
