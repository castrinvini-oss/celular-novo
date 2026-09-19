/**
 * Formatação no padrão brasileiro.
 *
 * Toda a aplicação trabalha com CENTAVOS (número inteiro). Só na exibição
 * viramos "R$ 1.234,56".
 */

const brl = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const brlShort = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** 199000 -> "R$ 1.990,00" */
export function formatBRL(cents) {
  return brl.format(Number(cents || 0) / 100);
}

/** 199000 -> "R$ 1.990" (sem centavos, para títulos) */
export function formatBRLShort(cents) {
  const value = Number(cents || 0) / 100;
  return Number.isInteger(value) ? brlShort.format(value) : brl.format(value);
}

/** 37.5 -> "37,5%" (sem casas quando é inteiro) */
export function formatPercent(percent) {
  const value = Number(percent || 0);
  const decimals = Number.isInteger(value) ? 0 : 1;
  return `${value.toLocaleString('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}%`;
}

/**
 * Máscara de moeda para input: o usuário digita só números e o campo vira
 * "R$ 10,00". Devolve { text, cents }.
 */
export function maskCurrencyInput(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '').slice(0, 9);
  if (digits === '') return { text: '', cents: 0 };
  const cents = Number.parseInt(digits, 10);
  return { text: formatBRL(cents), cents };
}

/** Lê os centavos de um texto já mascarado. */
export function centsFromMasked(text) {
  const digits = String(text ?? '').replace(/\D/g, '');
  return digits === '' ? 0 : Number.parseInt(digits, 10);
}

/** Máscara de CPF: 12345678909 -> "123.456.789-09" */
export function maskCPF(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '').slice(0, 11);
  return digits
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3-$4');
}

/** Validação de CPF pelos dígitos verificadores (mesma regra do backend). */
export function isValidCPF(value) {
  const cpf = String(value ?? '').replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;

  const digits = cpf.split('').map(Number);
  for (let position = 9; position < 11; position += 1) {
    let sum = 0;
    for (let i = 0; i < position; i += 1) sum += digits[i] * (position + 1 - i);
    const remainder = (sum * 10) % 11;
    const check = remainder === 10 ? 0 : remainder;
    if (check !== digits[position]) return false;
  }
  return true;
}

/** "2026-09-18 21:30:00" (UTC do SQLite) -> "há 5 minutos" */
export function timeAgo(value) {
  if (!value) return '';
  const text = String(value).includes('T') ? String(value) : String(value).replace(' ', 'T');
  const date = new Date(/[zZ]$/.test(text) ? text : `${text}Z`);
  if (Number.isNaN(date.getTime())) return '';

  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return 'agora mesmo';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `há ${days} ${days === 1 ? 'dia' : 'dias'}`;
  return date.toLocaleDateString('pt-BR');
}

/** Iniciais para o avatar do apoiador. */
export function initials(name) {
  if (!name) return '❤';
  const parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}
