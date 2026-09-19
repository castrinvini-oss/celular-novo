/**
 * Contrato do gateway de pagamento.
 *
 * Toda a aplicacao conversa APENAS com esta interface. Para trocar a MisticPay
 * por outro provedor (Mercado Pago, Asaas, Efi, Pagar.me...), basta criar uma
 * nova pasta em backend/gateways/<provedor> exportando um objeto com estes
 * mesmos metodos e registra-lo em backend/gateways/index.js. Nenhum service,
 * rota ou tela precisa mudar.
 *
 * @typedef {Object} PixChargeInput
 * @property {number} amountCents    Valor em centavos (fonte da verdade interna).
 * @property {string} transactionId  Identificador unico gerado por nos.
 * @property {string} payerName      Nome do pagador.
 * @property {string} payerDocument  CPF do pagador (somente digitos).
 * @property {string} description    Descricao da cobranca.
 * @property {string} [webhookUrl]   URL de notificacao.
 *
 * @typedef {Object} PixChargeResult
 * @property {string}  gatewayTransactionId
 * @property {string}  copyPaste            Pix copia e cola (BR Code).
 * @property {string}  [qrCodeBase64]       Imagem do QR em data URI.
 * @property {string}  [qrCodeUrl]          URL alternativa da imagem do QR.
 * @property {string}  status               Status normalizado.
 * @property {Object}  raw                  Resposta bruta (auditoria).
 *
 * @typedef {Object} TransactionStatus
 * @property {string}  status        PENDING | PAID | EXPIRED | CANCELLED | FAILED
 * @property {number?} amountCents   Valor informado pelo gateway, em centavos.
 * @property {Object}  raw
 *
 * @typedef {Object} PaymentGateway
 * @property {string}   name
 * @property {() => boolean} isConfigured
 * @property {(input: PixChargeInput) => Promise<PixChargeResult>} createPixCharge
 * @property {(gatewayTransactionId: string, expectedCents?: number) => Promise<TransactionStatus>} checkTransaction
 * @property {(body: Object) => Object} parseWebhook
 */

/** Status normalizados usados em todo o projeto. */
export const STATUS = Object.freeze({
  PENDING: 'PENDING',
  PAID: 'PAID',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
  FAILED: 'FAILED',
});

/** Erro de gateway com codigo HTTP sugerido para a resposta da nossa API. */
export class GatewayError extends Error {
  constructor(message, { statusCode = 502, details = null, cause = null } = {}) {
    super(message);
    this.name = 'GatewayError';
    this.statusCode = statusCode;
    this.details = details;
    if (cause) this.cause = cause;
  }
}
