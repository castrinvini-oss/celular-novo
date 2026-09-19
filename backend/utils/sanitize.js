/**
 * Sanitizacao de entradas vindas do navegador.
 *
 * O frontend renderiza tudo via textContent, mas o backend tambem limpa os
 * dados: nenhuma string de usuario entra no banco com HTML, caracteres de
 * controle ou tamanho ilimitado.
 */

/** Limpa uma string: tira tags, caracteres de controle e corta no limite. */
export function cleanText(value, maxLength = 200) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/<[^>]*>/g, '')            // remove tags HTML
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, ' ') // caracteres de controle
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/** Igual a cleanText, mas preserva quebras de linha (textos longos). */
export function cleanMultiline(value, maxLength = 5000) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/<[^>]*>/g, '')
    .replace(/\r\n/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxLength);
}

/** Valida uma URL de imagem (http, https ou caminho local do proprio site). */
export function cleanImageUrl(value, maxLength = 500) {
  const raw = cleanText(value, maxLength);
  if (raw === '') return '';
  if (raw.startsWith('/')) return raw;
  try {
    const url = new URL(raw);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString();
  } catch {
    /* URL invalida */
  }
  return '';
}

/** Primeiro nome + inicial do sobrenome, para a lista publica de apoiadores. */
export function publicDisplayName(name) {
  const clean = cleanText(name, 40);
  if (!clean) return null;
  const parts = clean.split(' ').filter(Boolean);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}
