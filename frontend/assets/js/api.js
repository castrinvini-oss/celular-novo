/**
 * Cliente da API da campanha.
 *
 * O frontend nunca fala com a MisticPay: tudo passa pelo nosso backend, que é
 * quem guarda as credenciais.
 */

async function request(path, { method = 'GET', body = null, signal } = {}) {
  const response = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
    signal,
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const error = new Error(data?.error?.message ?? 'Não foi possível concluir a operação.');
    error.code = data?.error?.code ?? 'HTTP_ERROR';
    error.status = response.status;
    error.details = data?.error?.details ?? null;
    throw error;
  }

  return data;
}

export const api = {
  getCampaign: () => request('/api/campaign'),
  getSupporters: (limit = 12) => request(`/api/campaign/supporters?limit=${limit}`),
  createDonation: (payload) => request('/api/donations', { method: 'POST', body: payload }),
  getDonationStatus: (transactionId) =>
    request(`/api/donations/${encodeURIComponent(transactionId)}/status`),
};

export default api;
