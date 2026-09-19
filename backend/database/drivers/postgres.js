/**
 * Driver Postgres (Supabase, Neon, RDS, Postgres proprio...).
 *
 * Os repositorios escrevem SQL com marcadores "?" (padrao SQLite); aqui eles
 * sao convertidos para "$1, $2, ..." antes de ir para o banco.
 *
 * Em serverless (Vercel), use a string de conexao do **Transaction Pooler**
 * do Supabase (porta 6543): cada invocacao abre pouquissimas conexoes e o
 * pooler cuida do resto.
 */

/** "... WHERE a = ? AND b = ?" -> "... WHERE a = $1 AND b = $2" */
export function toPositionalPlaceholders(text) {
  let index = 0;
  return text.replace(/\?/g, () => {
    index += 1;
    return `$${index}`;
  });
}

/** Datas do Postgres voltam como Date; o resto do projeto trabalha com string. */
function normalizeRow(row) {
  const output = {};
  for (const [key, value] of Object.entries(row)) {
    output[key] = value instanceof Date ? value.toISOString() : value;
  }
  return output;
}

/**
 * @param {{ client: { query: Function, end?: Function, close?: Function } }} options
 *   client precisa expor query(text, params). Funciona tanto com o Pool do
 *   pacote "pg" quanto com o PGlite usado nos testes.
 */
export function createPostgresDriver({ client }) {
  return {
    dialect: 'postgres',

    async query(text, params = []) {
      const values = params.map((value) => (value === undefined ? null : value));
      const result = await client.query(toPositionalPlaceholders(text), values);

      return {
        rows: (result.rows ?? []).map(normalizeRow),
        changes: Number(result.rowCount ?? result.affectedRows ?? 0),
      };
    },

    async exec(script) {
      // PGlite (usado nos testes) tem exec() para varios comandos de uma vez;
      // o Pool do "pg" executa multiplos comandos pelo proprio query().
      if (typeof client.exec === 'function') await client.exec(script);
      else await client.query(script);
    },

    async close() {
      if (typeof client.end === 'function') await client.end();
      else if (typeof client.close === 'function') await client.close();
    },
  };
}
