/**
 * Driver SQLite (modulo nativo do Node: node:sqlite).
 *
 * Usado no desenvolvimento local e em VPS. Nao serve para serverless
 * (Vercel/Lambda), porque o disco e efemero - la usamos o driver Postgres.
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export function createSqliteDriver({ file }) {
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');

  return {
    dialect: 'sqlite',

    /**
     * @param {string} text SQL com marcadores "?"
     * @param {unknown[]} params
     * @returns {Promise<{ rows: object[], changes: number }>}
     */
    async query(text, params = []) {
      const statement = db.prepare(text);
      const values = params.map((value) => (value === undefined ? null : value));

      // node:sqlite so permite .all() em comandos que devolvem linhas.
      const returnsRows = /^\s*(select|with|pragma)/i.test(text) || /returning/i.test(text);

      if (returnsRows) {
        const rows = statement.all(...values).map((row) => ({ ...row }));
        return { rows, changes: rows.length };
      }

      const result = statement.run(...values);
      return { rows: [], changes: Number(result.changes ?? 0) };
    },

    async exec(script) {
      db.exec(script);
    },

    async close() {
      db.close();
    },
  };
}
