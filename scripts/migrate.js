/**
 * Cria/atualiza as tabelas e semeia as configuracoes iniciais da campanha.
 *
 * Uso: npm run migrate
 *
 * Usa SQLite por padrao. Se DATABASE_URL estiver definida (Supabase, Neon...),
 * roda o schema do Postgres nesse banco.
 */
import { migrate, closeDb, isPostgres } from '../backend/database/db.js';
import config from '../backend/config/env.js';

await migrate();
await closeDb();

if (isPostgres()) {
  const host = (() => {
    try {
      return new URL(config.databaseUrl).host;
    } catch {
      return '(host desconhecido)';
    }
  })();
  console.log(`Banco PostgreSQL pronto em: ${host}`);
} else {
  console.log(`Banco SQLite pronto em: ${config.databaseFile}`);
}

console.log(
  'Tabelas: donations, gateway_events, settings, admins, admin_sessions, login_attempts.'
);
