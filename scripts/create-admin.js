/**
 * Cria (ou atualiza a senha de) um administrador do painel.
 *
 * Uso interativo:   npm run create-admin
 * Uso direto:       npm run create-admin -- meuusuario "minha senha forte"
 *
 * Respeita o DATABASE_URL: com ele apontando para o Supabase, o usuario e
 * criado direto no banco de producao.
 *
 * A senha nunca e gravada em texto puro: e guardada com scrypt.
 */
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { migrate, closeDb } from '../backend/database/db.js';
import {
  findAdminByUsername,
  createAdmin,
  updateAdminPassword,
} from '../backend/database/repositories/admin.repo.js';

function isWeak(password) {
  return String(password).length < 8;
}

async function ask(question, { hidden = false } = {}) {
  const rl = readline.createInterface({ input: stdin, output: stdout, terminal: true });

  if (!hidden) {
    const answer = await rl.question(question);
    rl.close();
    return answer.trim();
  }

  // Esconde a digitacao da senha no terminal.
  const originalWrite = stdout.write.bind(stdout);
  let muted = false;
  stdout.write = (chunk, ...args) => (muted ? true : originalWrite(chunk, ...args));

  const promise = rl.question(question);
  muted = true;
  const answer = await promise;
  muted = false;
  stdout.write = originalWrite;
  stdout.write('\n');
  rl.close();
  return answer.trim();
}

async function main() {
  await migrate();

  const [argUsername, argPassword] = process.argv.slice(2);

  const username = (argUsername ?? (await ask('Usuario do painel: '))).toLowerCase();
  if (!username) {
    console.error('Usuario obrigatorio.');
    process.exitCode = 1;
    return;
  }

  const password = argPassword ?? (await ask('Senha (minimo 8 caracteres): ', { hidden: true }));
  if (isWeak(password)) {
    console.error('Senha muito curta: use pelo menos 8 caracteres.');
    process.exitCode = 1;
    return;
  }

  const existing = await findAdminByUsername(username);
  if (existing) {
    await updateAdminPassword(existing.id, password);
    console.log(`Senha do administrador "${username}" atualizada.`);
  } else {
    await createAdmin(username, password);
    console.log(`Administrador "${username}" criado.`);
  }

  console.log('Acesse o painel em /admin e faca login.');
}

try {
  await main();
} catch (error) {
  console.error('Falha ao criar administrador:', error.message);
  process.exitCode = 1;
} finally {
  await closeDb();
}
