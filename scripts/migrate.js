/**
 * Cria/atualiza as tabelas e semeia as configuracoes iniciais da campanha.
 * Uso: npm run migrate
 */
import { migrate, closeDb } from '../backend/database/db.js';
import config from '../backend/config/env.js';

migrate();
closeDb();

console.log(`Banco pronto em: ${config.databaseFile}`);
console.log('Tabelas: donations, gateway_events, settings, admins, admin_sessions.');
