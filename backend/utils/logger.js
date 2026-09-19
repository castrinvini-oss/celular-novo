/**
 * Log simples com nivel e timestamp.
 *
 * Importante: nunca logar credenciais, CPF completo ou payload sensivel.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const currentLevel = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

function write(level, message, meta) {
  if (LEVELS[level] < currentLevel) return;
  const time = new Date().toISOString();
  const prefix = `[${time}] [${level.toUpperCase()}]`;
  if (meta === undefined) console.log(`${prefix} ${message}`);
  else console.log(`${prefix} ${message}`, meta);
}

export const logger = {
  debug: (message, meta) => write('debug', message, meta),
  info: (message, meta) => write('info', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  error: (message, meta) => write('error', message, meta),
};

export default logger;
