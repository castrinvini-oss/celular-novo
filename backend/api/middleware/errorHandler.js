/**
 * Tratamento central de erros.
 *
 * Nunca devolve stack trace nem detalhe interno ao navegador: o usuario ve uma
 * mensagem util, o servidor guarda o resto no log.
 */
import { AppError } from '../../utils/errors.js';
import { GatewayError } from '../../gateways/gateway.interface.js';
import logger from '../../utils/logger.js';

export function notFoundHandler(req, res) {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: 'Rota nao encontrada.' },
  });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(error, req, res, next) {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      error: { code: error.code, message: error.message, details: error.details },
    });
    return;
  }

  if (error instanceof GatewayError) {
    logger.error('Erro do gateway de pagamento', { message: error.message });
    res.status(error.statusCode).json({
      error: { code: 'GATEWAY_ERROR', message: error.message },
    });
    return;
  }

  if (error?.type === 'entity.parse.failed') {
    res.status(400).json({
      error: { code: 'INVALID_JSON', message: 'Corpo da requisicao invalido.' },
    });
    return;
  }

  logger.error('Erro inesperado', { message: error?.message, stack: error?.stack });
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Algo deu errado. Tente novamente em instantes.' },
  });
}

/** Envolve handlers async para que rejeicoes cheguem ao errorHandler. */
export function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
