/**
 * Utilidades de dinheiro.
 *
 * Regra do projeto: internamente TUDO circula em centavos (inteiro).
 * A conversao para reais acontece apenas na borda (gateway e exibicao).
 */

/** Converte centavos para o formato brasileiro: 1990 -> "R$ 19,90". */
export function formatBRL(cents) {
  const value = Number(cents || 0) / 100;
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Centavos -> reais como number (para enviar ao gateway). Ex.: 455 -> 4.55 */
export function centsToReais(cents) {
  return Math.round(Number(cents)) / 100;
}

/** Reais -> centavos. */
export function reaisToCents(value) {
  return Math.round(Number(value) * 100);
}

/**
 * Converte qualquer entrada de valor (string ou number) para centavos.
 * Aceita "10", "10,50", "10.50", "R$ 1.234,56", 10.5 ...
 * Retorna null quando o valor nao e um numero valido.
 */
export function parseAmountToCents(input) {
  if (input === null || input === undefined) return null;

  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    return Math.round(input * 100);
  }

  let raw = String(input).trim();
  if (raw === '') return null;

  raw = raw.replace(/r\$/gi, '').replace(/\s/g, '');
  if (!/^[0-9.,]+$/.test(raw)) return null;

  const hasComma = raw.includes(',');
  const hasDot = raw.includes('.');

  if (hasComma && hasDot) {
    // Formato brasileiro completo: 1.234,56 -> o ponto e separador de milhar.
    raw = raw.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    raw = raw.replace(',', '.');
  } else if (hasDot) {
    // "1.234" e ambiguo. Tres casas depois do ponto = separador de milhar.
    const parts = raw.split('.');
    const isThousandSeparator =
      parts.length > 2 || (parts.length === 2 && parts[1].length === 3);
    if (isThousandSeparator) raw = parts.join('');
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return null;

  // Centavos sao a menor unidade: mais de 2 casas decimais nao existe em Pix.
  return Math.round(parsed * 100);
}

/** Percentual do progresso (0 a 100, limitado a 100 na exibicao). */
export function progressPercent(raisedCents, goalCents) {
  if (!goalCents || goalCents <= 0) return 0;
  return (Number(raisedCents) / Number(goalCents)) * 100;
}
