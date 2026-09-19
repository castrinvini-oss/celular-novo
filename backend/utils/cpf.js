/**
 * Validacao de CPF.
 *
 * A MisticPay exige "payerDocument" na criacao da cobranca, entao precisamos
 * receber o CPF do doador. Ele e validado, usado apenas na chamada ao gateway
 * e NUNCA e gravado por inteiro no banco nem exibido publicamente.
 */

/** Remove tudo que nao for digito. */
export function onlyDigits(value) {
  return String(value ?? '').replace(/\D+/g, '');
}

/** Valida CPF pelos digitos verificadores. */
export function isValidCPF(value) {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false; // 000.000.000-00, 111..., etc.

  const digits = cpf.split('').map(Number);

  for (let position = 9; position < 11; position += 1) {
    let sum = 0;
    for (let i = 0; i < position; i += 1) {
      sum += digits[i] * (position + 1 - i);
    }
    const remainder = (sum * 10) % 11;
    const checkDigit = remainder === 10 ? 0 : remainder;
    if (checkDigit !== digits[position]) return false;
  }

  return true;
}

/** 12345678909 -> "***.456.789-**" (guardado so para suporte no /admin). */
export function maskCPF(value) {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11) return null;
  return `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**`;
}
