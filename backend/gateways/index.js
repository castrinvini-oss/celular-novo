/**
 * Fabrica de gateways.
 *
 * Para plugar outro provedor no futuro:
 *   1. crie backend/gateways/<provedor>/index.js exportando o mesmo contrato
 *      descrito em gateway.interface.js;
 *   2. registre-o no mapa GATEWAYS abaixo;
 *   3. defina PAYMENT_GATEWAY=<provedor> no .env.
 *
 * Nenhuma outra parte da aplicacao precisa ser alterada.
 */
import config from '../config/env.js';
import misticpay from './misticpay/index.js';

const GATEWAYS = {
  misticpay,
};

export function getGateway(name = config.gateway.provider) {
  const gateway = GATEWAYS[String(name).toLowerCase()];
  if (!gateway) {
    throw new Error(
      `Gateway "${name}" nao registrado. Opcoes disponiveis: ${Object.keys(GATEWAYS).join(', ')}.`
    );
  }
  return gateway;
}

export default getGateway;
