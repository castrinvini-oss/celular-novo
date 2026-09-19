/**
 * Adaptador da MisticPay para o contrato interno de gateway.
 *
 * Endpoints e campos seguem a documentacao oficial (https://docs.misticpay.com/):
 *
 *   POST /api/transactions/create
 *     body: { amount, payerName, payerDocument, transactionId, description,
 *             projectWebhook? }
 *     resp: { message, data: { transactionId, transactionAmount, transactionState,
 *             qrCodeBase64, qrcodeUrl, copyPaste } }
 *
 *   POST /api/transactions/check
 *     body: { transactionId }
 *     resp: { message, transaction: { transactionId, value, transactionState, ... } }
 *
 *   Webhook de deposito (POST na projectWebhook):
 *     { transactionId, transactionType, transactionMethod, clientName,
 *       clientDocument, status, value, fee, e2e, ispb, bankName }
 */
import { centsToReais } from '../../utils/money.js';
import { GatewayError, STATUS } from '../gateway.interface.js';
import { ENDPOINTS, isConfigured, request } from './client.js';

/** Estados da MisticPay -> estados internos. */
const STATE_MAP = {
  PENDENTE: STATUS.PENDING,
  COMPLETO: STATUS.PAID,
  FALHA: STATUS.FAILED,
  CANCELADO: STATUS.CANCELLED,
  EXPIRADO: STATUS.EXPIRED,
};

export function mapState(state) {
  if (!state) return STATUS.PENDING;
  return STATE_MAP[String(state).toUpperCase()] ?? STATUS.PENDING;
}

/**
 * Normaliza o valor devolvido pela MisticPay para centavos.
 *
 * A documentacao usa duas escalas diferentes: /transactions/create e o webhook
 * devolvem centavos (455 = R$ 4,55), enquanto /transactions/check devolve reais
 * (1.12 = R$ 1,12). Como sempre sabemos quanto cobramos, testamos as duas
 * leituras contra o valor esperado e retornamos a que bate. Se nenhuma bater,
 * devolvemos null e a doacao e marcada para conferencia manual - o valor
 * creditado na campanha continua sendo o que NOS geramos, nunca o do payload.
 */
export function normalizeAmountToCents(value, expectedCents = null) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;

  const asCents = Math.round(numeric);
  const asReais = Math.round(numeric * 100);

  if (expectedCents !== null && expectedCents !== undefined) {
    if (asCents === Number(expectedCents)) return asCents;
    if (asReais === Number(expectedCents)) return asReais;
    return null;
  }

  // Sem valor esperado: numero inteiro = centavos, decimal = reais.
  return Number.isInteger(numeric) ? asCents : asReais;
}

const misticpay = {
  name: 'misticpay',

  isConfigured,

  /**
   * Cria a cobranca Pix.
   * @param {import('../gateway.interface.js').PixChargeInput} input
   */
  async createPixCharge(input) {
    const body = {
      amount: centsToReais(input.amountCents),
      payerName: input.payerName,
      payerDocument: input.payerDocument,
      transactionId: input.transactionId,
      description: input.description,
    };

    if (input.webhookUrl) body.projectWebhook = input.webhookUrl;

    const response = await request(ENDPOINTS.createTransaction, {
      method: 'POST',
      body,
      allowLegacy: true, // /create aceita ci/cs enquanto a credencial legada viver
    });

    const data = response?.data ?? response;
    const copyPaste = data?.copyPaste ?? data?.copyPasteCode ?? null;
    const gatewayTransactionId = data?.transactionId ?? null;

    if (!gatewayTransactionId || !copyPaste) {
      throw new GatewayError('A MisticPay nao devolveu os dados do Pix. Tente novamente.', {
        statusCode: 502,
        details: { received: Object.keys(data ?? {}) },
      });
    }

    return {
      gatewayTransactionId: String(gatewayTransactionId),
      copyPaste: String(copyPaste),
      qrCodeBase64: data?.qrCodeBase64 ?? null,
      qrCodeUrl: data?.qrcodeUrl ?? data?.qrCodeUrl ?? null,
      status: mapState(data?.transactionState),
      raw: data,
    };
  },

  /**
   * Consulta o estado real da transacao na MisticPay.
   * Esta e a unica fonte que autoriza marcar uma doacao como paga.
   */
  async checkTransaction(gatewayTransactionId, expectedCents = null) {
    const response = await request(ENDPOINTS.checkTransaction, {
      method: 'POST',
      body: { transactionId: String(gatewayTransactionId) },
      allowLegacy: true, // /check tambem aceita ci/cs
    });

    const transaction = response?.transaction ?? response?.data ?? null;
    if (!transaction) {
      throw new GatewayError('Transacao nao encontrada na MisticPay.', { statusCode: 404 });
    }

    return {
      status: mapState(transaction.transactionState ?? transaction.status),
      amountCents: normalizeAmountToCents(
        transaction.value ?? transaction.transactionAmount,
        expectedCents
      ),
      raw: transaction,
    };
  },

  /**
   * Le o corpo do webhook. Nao confia em nada dele alem do identificador:
   * o status e sempre reconfirmado via checkTransaction.
   */
  parseWebhook(body) {
    if (!body || typeof body !== 'object') return null;

    // Webhook de MED tem outro formato (event: "INFRACTION").
    if (body.event === 'INFRACTION') {
      return {
        eventType: 'INFRACTION',
        gatewayTransactionId: body?.transaction?.transactionId ?? null,
        status: null,
        amountCents: null,
      };
    }

    const gatewayTransactionId = body.transactionId ?? body?.transaction?.transactionId ?? null;
    if (gatewayTransactionId === null || gatewayTransactionId === undefined) return null;

    return {
      eventType: body.transactionType ?? 'DEPOSITO',
      gatewayTransactionId: String(gatewayTransactionId),
      status: mapState(body.status ?? body.transactionState),
      amountCents: normalizeAmountToCents(body.value),
      endToEndId: body.e2e ?? null,
    };
  },
};

export default misticpay;
