/**
 * Ponto de entrada da funcao serverless (Vercel).
 *
 * A Vercel transforma cada arquivo em /api numa funcao. Uma aplicacao Express
 * e, na pratica, um handler (req, res) — entao basta exporta-la.
 *
 * Diferencas em relacao ao backend/server.js:
 *   - nao existe listen(): quem escuta e a plataforma;
 *   - nao existe setInterval: a manutencao vira GET /api/cron/reconcile;
 *   - as tabelas NAO sao criadas a cada cold start. Rode "npm run migrate"
 *     apontando para o Supabase (ou cole o schema.postgres.sql no SQL Editor).
 */
import app from '../backend/app.js';

export default app;
