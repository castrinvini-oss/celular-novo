/** Erros da aplicacao com codigo HTTP e mensagem segura para o usuario final. */
export class AppError extends Error {
  constructor(message, { statusCode = 400, code = 'BAD_REQUEST', details = null } = {}) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message, details = null) {
    super(message, { statusCode: 400, code: 'VALIDATION_ERROR', details });
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Registro nao encontrado.') {
    super(message, { statusCode: 404, code: 'NOT_FOUND' });
    this.name = 'NotFoundError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Acesso negado.') {
    super(message, { statusCode: 401, code: 'UNAUTHORIZED' });
    this.name = 'UnauthorizedError';
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Muitas tentativas. Aguarde um pouco e tente de novo.') {
    super(message, { statusCode: 429, code: 'TOO_MANY_REQUESTS' });
    this.name = 'TooManyRequestsError';
  }
}
