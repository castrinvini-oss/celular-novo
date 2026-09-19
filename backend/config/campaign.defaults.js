/**
 * Conteudo inicial da campanha.
 *
 * Tudo aqui pode ser alterado depois pelo painel /admin (fica salvo na tabela
 * "settings"). Estes valores sao usados apenas na primeira execucao, ou quando
 * uma chave ainda nao existe no banco.
 */
import config from './env.js';

export const CAMPAIGN_DEFAULTS = {
  project_name: 'Celular Novo',
  campaign_title: '❤️ AJUDE A PÁGINA A CRESCER!',
  campaign_description:
    'Ajude a página de memes a comprar um celular novo e produzir conteúdos com muito mais qualidade.',
  campaign_text: [
    'Essa página começou como uma brincadeira, mas com o tempo se tornou algo que eu realmente gosto de fazer.',
    'Quero continuar criando memes, vídeos e conteúdos cada vez melhores, mas para isso preciso melhorar meu equipamento.',
    'Por isso, estou tentando arrecadar R$ 2.000 para comprar um Samsung Galaxy A36 5G 256GB e conseguir produzir conteúdos com mais qualidade.',
    'Se você gosta da página e quiser ajudar, qualquer valor faz diferença. Até mesmo R$ 1 pode ajudar a chegar mais perto da meta.',
    'E se você não puder doar, compartilhar a página também já ajuda muito! ❤️',
  ].join('\n\n'),

  device_name: 'Samsung Galaxy A36 5G 256GB',
  device_text:
    'Esse é o celular que quero comprar para melhorar a qualidade dos vídeos, memes e conteúdos da página. ❤️',
  campaign_image: '/assets/img/galaxy-a36.svg',

  goal_cents: String(config.campaign.goalCents),
  min_cents: String(config.campaign.minCents),
  max_cents: String(config.campaign.maxCents),

  /** Valores rapidos, em centavos. */
  quick_amounts: JSON.stringify([100, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000]),

  goal_reached_title: '🎉 META ATINGIDA!',
  goal_reached_text: 'Conseguimos! Muito obrigado a todos que ajudaram a página. ❤️',
};

/** Chaves que o painel administrativo pode alterar. */
export const EDITABLE_SETTINGS = Object.keys(CAMPAIGN_DEFAULTS);
